// @cpt-component:cpt-noter-component-core-postcall:p1
//! Post-call outputs (`cpt-noter-feature-core-postcall`): the PostCall job chunks the live
//! transcript and writes the sections, one router run per section in the stated order, each
//! committed as its own logged batch with its suggested items; the Regeneration job writes them
//! again after the archive pass or on request, merged with the user's edits; the outputs
//! commands read, edit and compare them. The archive pass itself is `archive.rs`.

use std::collections::HashMap;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::sync::{Arc, Weak};

use noter_db::rusqlite::{params, Connection, OptionalExtension};
use noter_db::{Logged, Mutation};
use noter_jobs::{BoxFuture, JobHandler, Request, RunCtx, Stop, Trigger};
use noter_llm::{
    Failure, LlmRuntime, Packet, PacketContext, PacketItem, Privacy, RunRequest, Skill,
    SourceClass, TaskKind,
};
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::{event_names, CommandCtx};
use noter_protocol::model::settings::{AuditWhat, SummaryLanguage};
use noter_protocol::model::*;
use noter_protocol::skills::{ExtractedItem, ParticipantNotes, PostCallOutput};
use noter_protocol::*;
use serde_json::{json, Value};

use crate::merge::merge;
use crate::notify::{Notification, NotificationKind};
use crate::{lock, object, to_json, Core};

/// The post-call skill's contract version, as `summary_versions.skill_version` records it.
const SKILL_VERSION: &str = "1.0.0";

/// The call types whose skill writes extras (standup blockers, planning Jira-ready items,
/// interview scorecard, incident timeline).
const EXTRAS: [&str; 4] = ["standup", "planning", "interview", "incident"];

/// The sections of a call of this type, in the order they are written. Role reviews come last
/// and only for enabled agents (none before the agents table, M4).
pub(crate) fn sections_of(call_type: &str) -> Vec<SectionKind> {
    let mut kinds = vec![
        SectionKind::Summary,
        SectionKind::Decisions,
        SectionKind::ActionItems,
        SectionKind::OpenQuestions,
        SectionKind::PerParticipant,
        SectionKind::Risks,
    ];
    if EXTRAS.contains(&call_type) {
        kinds.push(SectionKind::CallTypeExtras);
    }
    kinds
}

// @cpt-state:cpt-noter-state-core-postcall-section:p1
/// Whether a section may move from `from` to `to` (`cpt-noter-state-core-postcall-section`).
pub(crate) fn can(from: &SectionState, to: &SectionState) -> bool {
    use SectionState::*;
    match (from, to) {
        // @cpt-begin:cpt-noter-state-core-postcall-section:p1:inst-st-writing
        (Pending, Writing) => true,
        // @cpt-end:cpt-noter-state-core-postcall-section:p1:inst-st-writing
        // @cpt-begin:cpt-noter-state-core-postcall-section:p1:inst-st-ready
        (Writing, Ready) => true,
        // @cpt-end:cpt-noter-state-core-postcall-section:p1:inst-st-ready
        // @cpt-begin:cpt-noter-state-core-postcall-section:p1:inst-st-empty
        (Writing, Empty) => true,
        // @cpt-end:cpt-noter-state-core-postcall-section:p1:inst-st-empty
        // @cpt-begin:cpt-noter-state-core-postcall-section:p1:inst-st-failed
        (Writing, Failed { .. }) => true,
        // @cpt-end:cpt-noter-state-core-postcall-section:p1:inst-st-failed
        // @cpt-begin:cpt-noter-state-core-postcall-section:p1:inst-st-retry
        (Failed { .. }, Writing) => true,
        // @cpt-end:cpt-noter-state-core-postcall-section:p1:inst-st-retry
        // @cpt-begin:cpt-noter-state-core-postcall-section:p1:inst-st-regenerate
        (Ready, Writing) => true,
        // @cpt-end:cpt-noter-state-core-postcall-section:p1:inst-st-regenerate
        // @cpt-begin:cpt-noter-state-core-postcall-section:p1:inst-st-empty-retry
        (Empty, Writing) => true,
        // @cpt-end:cpt-noter-state-core-postcall-section:p1:inst-st-empty-retry
        // Continue Recording returns an unfinished section to pending for the next stop.
        (Writing, Pending) => true,
        _ => false,
    }
}

/// The aggregate of a call's sections: writing while any runs, then ready, partially failed or
/// failed.
fn aggregate(states: &[SectionState]) -> OutputsStatus {
    use SectionState::*;
    if states.iter().any(|s| matches!(s, Pending | Writing)) {
        return OutputsStatus::Writing;
    }
    let failed = states.iter().filter(|s| matches!(s, Failed { .. })).count();
    match failed {
        0 => OutputsStatus::Ready,
        n if n == states.len() => OutputsStatus::Failed,
        _ => OutputsStatus::PartiallyFailed,
    }
}

/// The sections of running work that have no committed row to read them from: writing, or
/// failed with their typed failure. Committed sections are read from the store.
// shortcut: in memory; after a restart an unwritten section of a failed run reads pending
// until it is regenerated (no column for the failure in `summaries`).
#[derive(Default)]
pub(crate) struct Sections(
    std::sync::Mutex<HashMap<(CallId, SectionKind), SectionState>>,
    /// The options of the regeneration queued for a call (none for the archive's own).
    std::sync::Mutex<HashMap<CallId, RegenerateArgs>>,
);

impl Sections {
    fn get(&self, call: &CallId, kind: SectionKind) -> Option<SectionState> {
        lock(&self.0).get(&(call.clone(), kind)).cloned()
    }

    /// Moves a section on if the state machine allows it; a committed state leaves the map.
    fn set(&self, call: &CallId, kind: SectionKind, to: SectionState) {
        let mut map = lock(&self.0);
        let key = (call.clone(), kind);
        let from = map.get(&key).cloned().unwrap_or(SectionState::Pending);
        if !can(&from, &to) {
            return;
        }
        match to {
            SectionState::Writing | SectionState::Failed { .. } => map.insert(key, to),
            _ => map.remove(&key),
        };
    }

    /// A new generation: forget the failures of the last one.
    fn clear(&self, call: &CallId) {
        lock(&self.0).retain(|(c, _), _| c != call);
    }

    /// The run ended: what it was still writing goes back to pending.
    fn settle(&self, call: &CallId) {
        lock(&self.0).retain(|(c, _), s| c != call || !matches!(s, SectionState::Writing));
    }

    fn request(&self, args: &RegenerateArgs) {
        lock(&self.1).insert(args.call_id.clone(), args.clone());
    }

    fn take_request(&self, call: &CallId) -> Option<RegenerateArgs> {
        lock(&self.1).remove(call)
    }
}

/// The call as post-call reads it.
struct Header {
    call_type: String,
    sensitive: bool,
    status: String,
    outputs_status: String,
    archive_status: String,
}

fn header(c: &Connection, call: &str) -> noter_db::rusqlite::Result<Option<Header>> {
    c.query_row(
        "SELECT call_type, privacy_class, status, outputs_status, archive_status
         FROM calls WHERE id = ?1",
        [call],
        |r| {
            Ok(Header {
                call_type: r.get(0)?,
                sensitive: r.get::<_, String>(1)? == "sensitive",
                status: r.get(2)?,
                outputs_status: r.get(3)?,
                archive_status: r.get(4)?,
            })
        },
    )
    .optional()
}

/// One stored section: its row and current version, and the provenance of its newest generation.
struct Stored {
    id: String,
    call_id: String,
    rev: u32,
    kind: SectionKind,
    body_md: String,
    lang: String,
    from_pass: String,
    user_edited: bool,
    regenerated_with_edits: bool,
    versions: u32,
    writer: Option<WriterInfo>,
}

fn word<T: serde::de::DeserializeOwned>(text: &str) -> Option<T> {
    serde_json::from_value(Value::String(text.into())).ok()
}

fn text_of<T: serde::Serialize>(v: &T) -> String {
    to_json(v).as_str().unwrap_or_default().to_owned()
}

fn pass(text: &str) -> TranscriptPass {
    if text == "archive" {
        TranscriptPass::Archive
    } else {
        TranscriptPass::Live
    }
}

/// A generated version's provenance from its `llm_runs` row; `None` without a model run.
fn writer_at(
    r: &noter_db::rusqlite::Row,
    at: usize,
) -> noter_db::rusqlite::Result<Option<WriterInfo>> {
    let runtime: Option<String> = r.get(at)?;
    let Some(runtime) = runtime.as_deref().and_then(word::<RuntimeChoice>) else {
        return Ok(None);
    };
    Ok(Some(WriterInfo {
        runtime,
        model: r.get(at + 1)?,
        skill: r.get(at + 2)?,
        skill_version: r.get::<_, Option<String>>(at + 3)?.unwrap_or_default(),
        generated_at: TimestampMs(r.get(at + 4)?),
        from_pass: pass(&r.get::<_, String>(at + 5)?),
    }))
}

const STORED: &str = "SELECT s.id, s.call_id, s.rev, s.kind, v.body_md, v.lang, v.from_pass,
        s.user_edited, s.regenerated_with_edits,
        (SELECT count(*) FROM summary_versions WHERE summary_id = s.id),
        l.runtime_choice, l.model, c.call_type, g.skill_version, g.created_at, g.from_pass
    FROM summaries s
    JOIN calls c ON c.id = s.call_id
    JOIN summary_versions v ON v.id = s.current_version_id
    LEFT JOIN summary_versions g ON g.id = (SELECT id FROM summary_versions
        WHERE summary_id = s.id AND kind = 'generated' ORDER BY n DESC LIMIT 1)
    LEFT JOIN llm_runs l ON l.id = g.llm_run_id";

fn stored_row(r: &noter_db::rusqlite::Row) -> noter_db::rusqlite::Result<Option<Stored>> {
    let Some(kind) = word(&r.get::<_, String>(3)?) else {
        return Ok(None);
    };
    Ok(Some(Stored {
        id: r.get(0)?,
        call_id: r.get(1)?,
        rev: r.get(2)?,
        kind,
        body_md: r.get(4)?,
        lang: r.get(5)?,
        from_pass: r.get(6)?,
        user_edited: r.get(7)?,
        regenerated_with_edits: r.get(8)?,
        versions: r.get(9)?,
        writer: writer_at(r, 10)?,
    }))
}

/// The sections of a call (`by` = "call_id"), or one section (`by` = "id").
fn stored(c: &Connection, by: &str, value: &str) -> noter_db::rusqlite::Result<Vec<Stored>> {
    let mut stmt = c.prepare(&format!(
        "{STORED} WHERE s.{by} = ?1 AND s.agent_id IS NULL"
    ))?;
    let rows = stmt.query_map([value], stored_row)?;
    Ok(rows
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .flatten()
        .collect())
}

fn section(
    stored: Option<&Stored>,
    kind: SectionKind,
    live: Option<SectionState>,
) -> OutputSection {
    let committed = stored.map(|s| {
        if s.body_md.trim().is_empty() {
            SectionState::Empty
        } else {
            SectionState::Ready
        }
    });
    OutputSection {
        kind,
        state: live
            .filter(|l| committed.is_none() || *l == SectionState::Writing)
            .or(committed)
            .unwrap_or(SectionState::Pending),
        summary_id: stored.map(|s| SummaryId::new(s.id.clone())),
        rev: stored.map(|s| Rev(s.rev)),
        body_md: stored.map(|s| s.body_md.clone()),
        // Items arrive with the items tables (2.18); until then their sections carry them as
        // Markdown.
        items: vec![],
        reviews: vec![],
        writer: stored.and_then(|s| s.writer.clone()),
        user_edited: stored.is_some_and(|s| s.user_edited),
        regenerated_with_edits: stored.is_some_and(|s| s.regenerated_with_edits),
        version_count: stored.map_or(0, |s| s.versions),
    }
}

fn not_found(what: &str) -> CoreError {
    CoreError::new(ErrorCode::NotFound, format!("no such {what}"))
}

/// The router's failure as the section's typed error; `None` when the run was cancelled.
fn code_of(failure: &Failure) -> Option<ErrorCode> {
    Some(match failure {
        Failure::Unavailable(e) | Failure::Storage(e) => e.code,
        Failure::Runtime { code } => word(code).unwrap_or(ErrorCode::RuntimeUnavailable),
        Failure::Budget => ErrorCode::BudgetPaused,
        Failure::Timeout => ErrorCode::RuntimeUnavailable,
        Failure::Invalid { .. } => ErrorCode::OutputInvalid,
        Failure::Cancelled => return None,
    })
}

/// Model text kept out of raw HTML when it lands in a Markdown body.
fn plain(text: &str) -> String {
    text.replace('<', "&lt;")
}

fn items_md(items: &[ExtractedItem]) -> String {
    items
        .iter()
        .map(|i| format!("- {}\n  > {}", plain(&i.text), plain(&i.quote)))
        .collect::<Vec<_>>()
        .join("\n")
}

fn participants_md(notes: &[ParticipantNotes]) -> String {
    notes
        .iter()
        .map(|p| {
            let mut lines = vec![format!("**{}**", plain(&p.speaker_label))];
            for (label, list) in [
                ("Said", &p.said),
                ("Committed to", &p.committed_to),
                ("Asked for", &p.asked_for),
                ("Pushed back on", &p.pushed_back_on),
            ] {
                if !list.is_empty() {
                    lines.push(format!("- {label}: {}", plain(&list.join("; "))));
                }
            }
            lines.join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// The Markdown body of one section of a validated output; empty when it holds nothing.
fn body_of(kind: SectionKind, out: &PostCallOutput) -> String {
    match kind {
        SectionKind::Summary => out.summary_md.trim().to_owned(),
        SectionKind::Decisions => items_md(&out.decisions),
        SectionKind::ActionItems => items_md(&out.action_items),
        SectionKind::OpenQuestions => items_md(&out.open_questions),
        SectionKind::Risks => items_md(&out.risks),
        SectionKind::PerParticipant => participants_md(&out.per_participant),
        SectionKind::CallTypeExtras => out.extras_md.as_deref().unwrap_or("").trim().to_owned(),
        SectionKind::RoleReviews => String::new(),
    }
}

pub(crate) fn speaker_name(label: &SpeakerLabel) -> String {
    match label {
        SpeakerLabel::You => "You".into(),
        SpeakerLabel::Person { person } => person.display_name.clone(),
        SpeakerLabel::Unnamed { n } => format!("Speaker {n}"),
        SpeakerLabel::GuestYourSide => "Guest".into(),
    }
}

fn clock(ms: i64) -> String {
    let s = ms / 1000;
    format!("{:02}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60)
}

/// The `items.kind` of the items a section holds; `None` for text sections.
fn item_kind(kind: SectionKind) -> Option<&'static str> {
    Some(match kind {
        SectionKind::Decisions => "decision",
        SectionKind::ActionItems => "action_item",
        SectionKind::OpenQuestions => "open_question",
        SectionKind::Risks => "risk",
        _ => return None,
    })
}

/// The items a section of a validated output extracts.
fn items_of(kind: SectionKind, out: &PostCallOutput) -> Vec<ExtractedItem> {
    match kind {
        SectionKind::Decisions => out.decisions.clone(),
        SectionKind::ActionItems => out.action_items.clone(),
        SectionKind::OpenQuestions => out.open_questions.clone(),
        SectionKind::Risks => out.risks.clone(),
        _ => vec![],
    }
}

/// An item's identity for "already reviewed": its words, case and spacing aside.
fn identity(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches(['.', '!', '?'])
        .to_lowercase()
}

/// The heading a section has in `summary.md`.
fn heading(kind: SectionKind) -> &'static str {
    match kind {
        SectionKind::Summary => "Summary",
        SectionKind::Decisions => "Decisions",
        SectionKind::ActionItems => "Action items",
        SectionKind::OpenQuestions => "Open questions",
        SectionKind::PerParticipant => "Per participant",
        SectionKind::RoleReviews => "Role reviews",
        SectionKind::Risks => "Risks",
        SectionKind::CallTypeExtras => "Extras",
    }
}

/// D4: an agent switches itself off for a call type when at least 80 % of its cards over the
/// last ten calls of that type were dismissed. `per_call` holds (dismissed, shown) per call,
/// oldest first; fewer than ten calls with cards decide nothing.
pub(crate) fn switches_off(per_call: &[(u32, u32)]) -> bool {
    if per_call.len() < 10 {
        return false;
    }
    let last = &per_call[per_call.len() - 10..];
    let (dismissed, shown) = last
        .iter()
        .fold((0u32, 0u32), |(d, s), (cd, cs)| (d + cd, s + cs));
    shown > 0 && dismissed * 5 >= shown * 4
}

/// One section's generated text and items, as the job commits them.
struct Generated {
    body_md: String,
    lang: Lang,
    llm_run_id: Option<String>,
    items: Vec<ExtractedItem>,
}

/// What a regeneration asked for beyond the call's defaults.
#[derive(Debug, Clone, Default)]
struct Options {
    runtime: Option<RuntimeChoice>,
    model: Option<String>,
    local: bool,
}

/// The PostCall job's handler.
pub(crate) struct PostCallJob(Weak<Core>);

impl JobHandler for PostCallJob {
    fn run<'a>(&'a self, ctx: &'a mut RunCtx) -> BoxFuture<'a, Result<(), Stop>> {
        Box::pin(async move {
            let (Some(core), Some(call)) = (self.0.upgrade(), ctx.subject().map(CallId::new))
            else {
                return Ok(());
            };
            let result = core.write_outputs(ctx, &call).await;
            core.postcall.settle(&call);
            result
        })
    }
}

/// The Regeneration job's handler: after the archive pass, or for `outputs_regenerate`.
pub(crate) struct RegenerationJob(Weak<Core>);

impl JobHandler for RegenerationJob {
    fn run<'a>(&'a self, ctx: &'a mut RunCtx) -> BoxFuture<'a, Result<(), Stop>> {
        Box::pin(async move {
            let (Some(core), Some(call)) = (self.0.upgrade(), ctx.subject().map(CallId::new))
            else {
                return Ok(());
            };
            let result = core.regenerate(ctx, &call).await;
            core.postcall.settle(&call);
            result
        })
    }
}

/// Registers the PostCall, ArchivePass and Regeneration handlers on the core's scheduler.
pub(crate) fn register(core: &Arc<Core>) {
    core.jobs.register(
        JobKind::PostCall,
        Arc::new(PostCallJob(Arc::downgrade(core))),
    );
    core.jobs.register(
        JobKind::Regeneration,
        Arc::new(RegenerationJob(Arc::downgrade(core))),
    );
    crate::archive::register(core);
}

fn call_mutation(call: &CallId, values: Vec<(&'static str, Value)>) -> Mutation {
    Mutation {
        entity_type: "call",
        table: "calls",
        id: call.as_str().into(),
        base_rev: None,
        bump_rev: true,
        values,
    }
}

impl Core {
    fn progress(&self, call: &CallId, kind: SectionKind, state: SectionState) {
        let states: Vec<SectionState> = self
            .outputs_now(call)
            .map(|o| o.sections.into_iter().map(|s| s.state).collect())
            .unwrap_or_default();
        let progress = OutputsProgress {
            call_id: call.clone(),
            status: aggregate(&states),
            section: kind,
            state,
        };
        self.deps
            .events
            .emit(event_names::OUTPUTS_PROGRESS, to_json(&progress));
    }

    fn publish_call_row(&self, call: &CallId) {
        if let Ok(Some(call)) = self.call_row(call.as_str()) {
            self.emit_entity_changed(&EntityChanged::Call { call });
        }
    }

    /// The call as the job may still write to it: gone ends the job quietly, resumed cancels it.
    fn current(&self, call: &CallId) -> Result<Option<Header>, Stop> {
        // @cpt-begin:cpt-noter-algo-core-postcall-store:p1:inst-store-current
        let id = call.as_str().to_owned();
        let found = self.store().read(move |c| header(c, &id))?;
        match found {
            Some(h) if matches!(h.status.as_str(), "recording" | "paused") => Err(Stop::Cancelled),
            other => Ok(other),
        }
        // @cpt-end:cpt-noter-algo-core-postcall-store:p1:inst-store-current
    }

    /// The evidence packet: every confirmed segment of the active pass and every mark, by id,
    /// with the call's type, the configured summary language and the glossary's terms.
    fn packet(&self, call: &CallId, sensitive: bool, call_type: &str) -> Result<Packet, CoreError> {
        let source = if sensitive {
            SourceClass::Sensitive
        } else {
            SourceClass::Normal
        };
        // @cpt-begin:cpt-noter-flow-core-postcall-write:p1:inst-write-load
        let language = match lock(&self.settings).general.summary_language {
            SummaryLanguage::En => Some(Lang::En),
            SummaryLanguage::Ru => Some(Lang::Ru),
            SummaryLanguage::De => Some(Lang::De),
            SummaryLanguage::LanguageOfTheCall => None,
        };
        let id = call.clone();
        let (segments, marks, glossary) = self.store().read(move |c| {
            let segments = crate::transcript::segments_of(c, &id, None)?;
            let mut stmt =
                c.prepare("SELECT id, at_ms, note FROM marks WHERE call_id = ?1 ORDER BY at_ms")?;
            let marks = stmt
                .query_map([id.as_str()], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, Option<String>>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let glossary = c
                .prepare("SELECT term FROM glossary ORDER BY term")?
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok((segments, marks, glossary))
        })?;
        // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-load
        let mut people: Vec<String> = vec![];
        let mut items: Vec<PacketItem> = segments
            .iter()
            .map(|s| {
                if let SpeakerLabel::Person { person } = &s.speaker.label {
                    if !people.contains(&person.display_name) {
                        people.push(person.display_name.clone());
                    }
                }
                PacketItem {
                    id: s.id.as_str().to_owned(),
                    source,
                    text: format!(
                        "[{}] {}: {}",
                        clock(i64::from(s.t0_ms.0)),
                        speaker_name(&s.speaker.label),
                        s.text
                    ),
                }
            })
            .collect();
        if !items.is_empty() {
            items.extend(marks.into_iter().map(|(id, at, note)| PacketItem {
                id,
                source,
                text: format!(
                    "[{}] Marked moment: {}",
                    clock(at),
                    note.unwrap_or_default()
                ),
            }));
        }
        Ok(Packet {
            what: AuditWhat::FullTranscript,
            items,
            people,
            context: PacketContext {
                call_type: Some(call_type.to_owned()),
                language,
                glossary,
            },
        })
    }

    fn local_fallback(&self) -> bool {
        self.llm()
            .availability()
            .iter()
            .any(|a| a.runtime == RuntimeChoice::Local && a.unavailable.is_none())
    }

    /// One section through the router: its validated body, or the typed failure (`None` when
    /// the run was cancelled).
    async fn generate(
        &self,
        call: &CallId,
        kind: SectionKind,
        packet: &Packet,
        privacy: Privacy,
        options: &Options,
    ) -> Result<Generated, Option<ErrorCode>> {
        if packet.items.is_empty() {
            // Nothing was said: every section is validly empty, and nothing goes to a model.
            return Ok(Generated {
                body_md: String::new(),
                lang: Lang::En,
                llm_run_id: None,
                items: vec![],
            });
        }
        // @cpt-begin:cpt-noter-flow-core-postcall-write:p1:inst-write-model
        // One run per section, so one failure leaves the others and a section can be retried
        // alone; the gate validates schema, HTML and citations before anything is kept.
        let (_privacy, rx) = tokio::sync::watch::channel(privacy);
        let mut req = RunRequest::new(
            Skill::PostCall,
            SKILL_VERSION,
            packet.clone(),
            TaskKind::PostCall,
            rx,
        );
        req.call_id = Some(call.clone());
        req.settings.configured = if options.local {
            Some(RuntimeChoice::Local)
        } else {
            options.runtime
        };
        req.settings.model.clone_from(&options.model);
        let done = self.llm().run_once(req).await.map_err(|f| code_of(&f))?;
        // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-model
        let out: PostCallOutput =
            serde_json::from_value(done.output).map_err(|_| Some(ErrorCode::Internal))?;
        Ok(Generated {
            body_md: body_of(kind, &out),
            items: items_of(kind, &out),
            lang: out.lang,
            llm_run_id: Some(done.provenance.llm_run_id.as_str().to_owned()),
        })
    }

    fn stored_section(
        &self,
        call: &CallId,
        kind: SectionKind,
    ) -> Result<Option<Stored>, CoreError> {
        let id = call.as_str().to_owned();
        let rows = self.store().read(move |c| stored(c, "call_id", &id))?;
        Ok(rows.into_iter().find(|s| s.kind == kind))
    }

    /// The body of the section's newest generated version: the base a merge compares against.
    fn generated_base(&self, summary: &str) -> Result<String, CoreError> {
        let id = summary.to_owned();
        Ok(self
            .store()
            .read(move |c| {
                c.query_row(
                    "SELECT body_md FROM summary_versions WHERE summary_id = ?1 AND kind = 'generated'
                     ORDER BY n DESC LIMIT 1",
                    [id],
                    |r| r.get::<_, String>(0),
                )
                .optional()
            })?
            .unwrap_or_default())
    }

    fn version_row(
        &self,
        summary: &str,
        n: u32,
        kind: &str,
        body: &str,
        g: &Generated,
        from_pass: &str,
    ) -> Mutation {
        Mutation {
            entity_type: "summary_version",
            table: "summary_versions",
            id: format!("ver_{}", ulid::Ulid::generate()),
            base_rev: None,
            bump_rev: false,
            values: vec![
                ("summary_id", json!(summary)),
                ("n", json!(n)),
                ("kind", json!(kind)),
                ("body_md", json!(body)),
                ("lang", json!(text_of(&g.lang))),
                ("skill_version", json!(SKILL_VERSION)),
                ("llm_run_id", json!(g.llm_run_id)),
                ("from_pass", json!(from_pass)),
                ("created_at", json!(self.deps.clock.now().0)),
            ],
        }
    }

    /// The rows one generated section commits: a new generated version, and the section pointing
    /// at it; over the user's edit, the merge of both as the current version, the candidate kept
    /// as its own version. `None` when an edited section gets nothing new.
    fn section_rows(
        &self,
        call: &CallId,
        kind: SectionKind,
        existing: Option<&Stored>,
        g: &Generated,
        from_pass: &str,
    ) -> Result<Option<Vec<Mutation>>, CoreError> {
        // @cpt-begin:cpt-noter-algo-core-postcall-store:p1:inst-store-version
        let summary = existing.map_or_else(
            || format!("sum_{}", ulid::Ulid::generate()),
            |s| s.id.clone(),
        );
        let n = existing.map_or(0, |s| s.versions);
        let generated = self.version_row(&summary, n + 1, "generated", &g.body_md, g, from_pass);
        let mut section = vec![("current_version_id", json!(generated.id))];
        let mut rows = vec![generated];
        // @cpt-end:cpt-noter-algo-core-postcall-store:p1:inst-store-version
        if let Some(edited) = existing.filter(|s| s.user_edited) {
            // @cpt-begin:cpt-noter-algo-core-postcall-merge:p1:inst-merge-version
            let base = self.generated_base(&edited.id)?;
            if g.body_md == base {
                return Ok(None);
            }
            let merged = merge(&base, &edited.body_md, &g.body_md);
            if merged.body == g.body_md {
                section.push(("user_edited", json!(0)));
                section.push(("regenerated_with_edits", json!(0)));
            } else {
                let kept =
                    self.version_row(&summary, n + 2, "user_edit", &merged.body, g, from_pass);
                section = vec![
                    ("current_version_id", json!(kept.id)),
                    ("regenerated_with_edits", json!(1)),
                ];
                rows.push(kept);
            }
            // @cpt-end:cpt-noter-algo-core-postcall-merge:p1:inst-merge-version
        }
        if existing.is_none() {
            section.extend([
                ("call_id", json!(call.as_str())),
                ("kind", json!(text_of(&kind))),
            ]);
        }
        rows.push(Mutation {
            entity_type: "summary",
            table: "summaries",
            id: summary,
            // A section written meanwhile fails the batch rather than being overwritten.
            base_rev: existing.map(|s| Rev(s.rev)),
            bump_rev: true,
            values: section,
        });
        Ok(Some(rows))
    }

    // @cpt-algo:cpt-noter-algo-core-postcall-store:p1
    /// Commits one generated section with `extra` rows in one batch, then its suggested items,
    /// and answers the section's committed state. An edit that lands while the model writes
    /// fails the revision check; the merge then runs again on that latest edit.
    async fn commit_section(
        &self,
        ctx: &mut RunCtx,
        call: &CallId,
        kind: SectionKind,
        g: &Generated,
        extra: Vec<Mutation>,
        progress: Option<f32>,
    ) -> Result<SectionState, Stop> {
        let id = call.as_str().to_owned();
        let archived: bool = self.store().read(move |c| {
            c.query_row(
                "SELECT EXISTS (SELECT 1 FROM segments WHERE call_id = ?1 AND pass = 'archive')",
                [id],
                |r| r.get(0),
            )
        })?;
        let from_pass = if archived { "archive" } else { "live" };
        // @cpt-begin:cpt-noter-algo-core-postcall-merge:p1:inst-merge-race
        let mut attempts = 0;
        loop {
            attempts += 1;
            let existing = self.stored_section(call, kind)?;
            let Some(mut rows) = self.section_rows(call, kind, existing.as_ref(), g, from_pass)?
            else {
                // Nothing new for an edited section; the call's own rows still commit.
                if !extra.is_empty() {
                    ctx.commit_batch(extra.clone(), vec![], progress).await?;
                }
                break;
            };
            rows.extend(extra.iter().cloned());
            // @cpt-begin:cpt-noter-algo-core-postcall-store:p1:inst-store-commit
            match ctx.commit_batch(rows, vec![], progress).await {
                Err(Stop::Failed(e)) if e.code == ErrorCode::Conflict && attempts < 3 => continue,
                other => other?,
            }
            // @cpt-end:cpt-noter-algo-core-postcall-store:p1:inst-store-commit
            break;
        }
        // @cpt-end:cpt-noter-algo-core-postcall-merge:p1:inst-merge-race
        self.store_items(ctx, call, kind, &g.items).await?;
        // @cpt-begin:cpt-noter-algo-core-postcall-store:p1:inst-store-return
        let state = section(self.stored_section(call, kind)?.as_ref(), kind, None).state;
        self.postcall.set(call, kind, state.clone());
        // @cpt-begin:cpt-noter-algo-core-postcall-merge:p1:inst-merge-return
        // The merged section and its versions read through the existing fields
        // (`regenerated_with_edits`, `version_count`); a rejection kept out leaves no row.
        self.emit_entity_changed(&EntityChanged::Section {
            call_id: call.clone(),
            section: self.section_now(call, kind)?,
        });
        Ok(state)
        // @cpt-end:cpt-noter-algo-core-postcall-merge:p1:inst-merge-return
        // @cpt-end:cpt-noter-algo-core-postcall-store:p1:inst-store-return
    }

    /// The section's suggested items: new suggestions replace the still-suggested ones of the
    /// model; accepted, edited, pinned and rejected items stay, and a suggestion that matches
    /// one of them by its words is not made again. Each item's evidence becomes its spans.
    async fn store_items(
        &self,
        ctx: &mut RunCtx,
        call: &CallId,
        kind: SectionKind,
        items: &[ExtractedItem],
    ) -> Result<(), Stop> {
        let Some(item_kind) = item_kind(kind) else {
            return Ok(());
        };
        // @cpt-begin:cpt-noter-algo-core-postcall-merge:p1:inst-merge-items
        let id = call.as_str().to_owned();
        let stored: Vec<(String, String, String, String, Option<String>)> =
            self.store().read(move |c| {
                c.prepare(
                    "SELECT id, review_state, created_by, text, generated_text FROM items
                     WHERE call_id = ?1 AND kind = ?2",
                )?
                .query_map(params![id, item_kind], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                })?
                .collect()
            })?;
        let replaced: Vec<String> = stored
            .iter()
            .filter(|(_, review, by, ..)| review == "suggested" && by == "llm")
            .map(|(id, ..)| id.clone())
            .collect();
        let reviewed: Vec<String> = stored
            .iter()
            .filter(|(_, review, by, ..)| review != "suggested" || by != "llm")
            .flat_map(|(.., text, generated)| {
                std::iter::once(identity(text)).chain(generated.as_deref().map(identity))
            })
            .collect();
        let fresh: Vec<ExtractedItem> = items
            .iter()
            .filter(|i| !reviewed.contains(&identity(&i.text)))
            .cloned()
            .collect();
        // @cpt-end:cpt-noter-algo-core-postcall-merge:p1:inst-merge-items
        if replaced.is_empty() && fresh.is_empty() {
            return Ok(());
        }
        ctx.checkpoint().await?;
        let meta = ctx.change_meta("suggested items").ok_or(Stop::Cancelled)?;
        let call_id = call.as_str().to_owned();
        let written = self.store().write_with(meta, move |tx| {
            let internal =
                |e: noter_db::rusqlite::Error| CoreError::new(ErrorCode::Internal, e.to_string());
            let mut logged = vec![];
            let mut removed = vec![];
            for id in &replaced {
                // A suggestion reviewed meanwhile is the user's now and stays.
                let gone = tx
                    .execute(
                        "DELETE FROM items WHERE id = ?1 AND review_state = 'suggested'",
                        [id],
                    )
                    .map_err(internal)?;
                if gone > 0 {
                    logged.push(Logged {
                        entity_type: "item",
                        entity_id: id.clone(),
                        field: None,
                        before: None,
                        after: None,
                        delta: None,
                    });
                    removed.push(id.clone());
                }
            }
            let mut ids = vec![];
            for item in &fresh {
                let id = format!("itm_{}", ulid::Ulid::generate());
                // @cpt-begin:cpt-noter-algo-core-postcall-store:p1:inst-store-items
                // Suggested, never accepted here; owners stay unresolved and topics wait for
                // the people and topics tables.
                tx.execute(
                    "INSERT INTO items (id, rev, call_id, kind, text, lang, generated_text, due_date,
                         status, review_state, created_by, is_engineering, linked_issue_key)
                     VALUES (?1, 1, ?2, ?3, ?4, ?5, ?4, ?6, 'open', 'suggested', 'llm', ?7, ?8)",
                    params![
                        id,
                        call_id,
                        item_kind,
                        item.text,
                        crate::transcript::lang_word(&item.lang),
                        item.due.as_ref().map(|d| d.0.clone()),
                        item.is_engineering,
                        item.linked_issue
                    ],
                )
                .map_err(internal)?;
                // @cpt-end:cpt-noter-algo-core-postcall-store:p1:inst-store-items
                // @cpt-begin:cpt-noter-algo-core-postcall-store:p1:inst-store-evidence
                // Spans of call time, so the evidence survives the archive's new segment ids.
                for seg in &item.evidence_segment_ids {
                    tx.execute(
                        "INSERT OR IGNORE INTO item_spans (item_id, call_id, channel, t0_ms, t1_ms)
                         SELECT ?1, call_id, channel, t0_ms, t1_ms FROM segments
                         WHERE id = ?2 AND call_id = ?3",
                        params![id, seg.as_str(), call_id],
                    )
                    .map_err(internal)?;
                }
                // @cpt-end:cpt-noter-algo-core-postcall-store:p1:inst-store-evidence
                logged.push(Logged {
                    entity_type: "item",
                    entity_id: id.clone(),
                    field: None,
                    before: None,
                    after: Some(item.text.clone()),
                    delta: None,
                });
                ids.push(id);
            }
            Ok(((ids, removed), logged))
        })?;
        let (ids, removed) = written.value;
        for id in removed {
            self.emit_entity_changed(&EntityChanged::Removed {
                kind: EntityKind::Item,
                id,
            });
        }
        let views: Vec<ItemView> = ids
            .iter()
            .filter_map(|id| self.item_view(id).ok().flatten())
            .collect();
        self.items_published(&views);
        Ok(())
    }

    /// `summary.md` of the call from its committed sections, and `items.json`; a failure is
    /// logged, the outputs are committed.
    fn write_files(&self, call: &CallId) {
        // @cpt-begin:cpt-noter-flow-core-postcall-write:p1:inst-write-files
        let written = self.outputs_now(call).and_then(|out| {
            let body: String = out
                .sections
                .iter()
                .filter_map(|s| {
                    let md = s.body_md.as_deref().filter(|b| !b.trim().is_empty())?;
                    Some(format!("## {}\n\n{md}\n\n", heading(s.kind)))
                })
                .collect();
            let dir = self.data_dir.join("audio").join(call.as_str());
            let internal = |e: std::io::Error| CoreError::new(ErrorCode::Internal, e.to_string());
            std::fs::create_dir_all(&dir).map_err(internal)?;
            let tmp = dir.join("summary.md.tmp");
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(&tmp)
                .map_err(internal)?;
            file.write_all(body.as_bytes()).map_err(internal)?;
            file.sync_all().map_err(internal)?;
            std::fs::rename(&tmp, dir.join("summary.md")).map_err(internal)
        });
        if let Err(e) = written {
            self.log(object(json!({
                "level": "error", "module": "postcall", "code": "summary_file",
                "message_len": e.message.len()
            })));
        }
        self.items_files([call.as_str().to_owned()]);
        // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-files
    }

    /// D4 after a call: the agents whose cards were mostly dismissed over the last ten calls of
    /// this type switch off for it. Cards and agents arrive in M4; until then no agent has
    /// outcomes and nothing is inferred.
    fn evaluate_role_policy(&self, call_type: &str) {
        // @cpt-begin:cpt-noter-algo-core-postcall-notify:p1:inst-notify-no-backfill
        // shortcut: no `cards` or `agents` table before M4, so there is no history to read; M4
        // reads each agent's (dismissed, shown) per call of this type here and logs the
        // undoable switch-off.
        let outcomes: Vec<(String, Vec<(u32, u32)>)> = vec![];
        // @cpt-end:cpt-noter-algo-core-postcall-notify:p1:inst-notify-no-backfill
        for (agent, per_call) in outcomes {
            if switches_off(&per_call) {
                self.log(object(json!({
                    "level": "info", "module": "postcall", "code": "agent_switch_off",
                    "agent": agent, "call_type": call_type
                })));
            }
        }
    }

    /// The PostCall run: the chunks of the live transcript, then every section in order, each
    /// validated, committed and published before the next; a failed section is recorded and the
    /// next one runs; the run fails at the end with the first failed section's typed error.
    async fn write_outputs(&self, ctx: &mut RunCtx, call: &CallId) -> Result<(), Stop> {
        let Some(head) = self.current(call)? else {
            return Ok(());
        };
        let kinds = sections_of(&head.call_type);
        // @cpt-begin:cpt-noter-flow-core-postcall-write:p1:inst-write-packet
        self.rechunk(ctx, call).await?;
        let packet = self.packet(call, head.sensitive, &head.call_type)?;
        // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-packet
        let privacy = self.privacy_of(head.sensitive);
        self.postcall.clear(call);
        let mut first_failure: Option<ErrorCode> = None;
        let mut committed = 0;
        let total = kinds.len();
        // @cpt-begin:cpt-noter-flow-core-postcall-write:p1:inst-write-sections
        for (n, kind) in kinds.into_iter().enumerate() {
            ctx.checkpoint().await?;
            // @cpt-begin:cpt-noter-flow-core-postcall-write:p1:inst-write-validate
            self.postcall.set(call, kind, SectionState::Writing);
            self.progress(call, kind, SectionState::Writing);
            let generated = self
                .generate(call, kind, &packet, privacy, &Options::default())
                .await;
            // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-validate
            let g = match generated {
                Ok(g) => g,
                Err(None) => return Err(Stop::Cancelled),
                // @cpt-begin:cpt-noter-flow-core-postcall-write:p1:inst-write-failed-section
                Err(Some(code)) => {
                    self.section_failed(call, kind, code);
                    first_failure.get_or_insert(code);
                    // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-failed-section
                    continue;
                }
            };
            // @cpt-begin:cpt-noter-flow-core-postcall-write:p1:inst-write-commit
            // @cpt-begin:cpt-noter-algo-core-postcall-store:p1:inst-store-owner
            // Owner hints stay unresolved: no person is matched before the people tables exist.
            // @cpt-end:cpt-noter-algo-core-postcall-store:p1:inst-store-owner
            let Some(now) = self.current(call)? else {
                return Ok(());
            };
            let first = committed == 0 && now.status == "processing";
            let mut extra = vec![];
            if first {
                // @cpt-begin:cpt-noter-state-core-library-calls-status:p1:inst-st-ready
                extra.push(call_mutation(
                    call,
                    vec![
                        ("status", json!("ready")),
                        ("outputs_status", json!("writing")),
                    ],
                ));
                // @cpt-end:cpt-noter-state-core-library-calls-status:p1:inst-st-ready
            }
            let progress = Some((n + 1) as f32 / total as f32);
            let state = self
                .commit_section(ctx, call, kind, &g, extra, progress)
                .await?;
            committed += 1;
            self.postcall.set(call, kind, state.clone());
            self.progress(call, kind, state);
            if first {
                self.publish_call_row(call);
            }
            // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-commit
        }
        // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-sections
        // Role reviews run last for enabled agents: none before the agents table (M4).
        let status = match (committed, first_failure) {
            (_, None) => OutputsStatus::Ready,
            (0, Some(_)) => OutputsStatus::Failed,
            _ => OutputsStatus::PartiallyFailed,
        };
        let Some(now) = self.current(call)? else {
            return Ok(());
        };
        let mut values = vec![("outputs_status", to_json(&status))];
        let failed = committed == 0 && now.status == "processing";
        if failed {
            // @cpt-begin:cpt-noter-state-core-postcall-section:p1:inst-st-call-failed
            values.push(("status", json!("failed")));
            // @cpt-end:cpt-noter-state-core-postcall-section:p1:inst-st-call-failed
        }
        // A call with no section to write (nothing heard) is ready here.
        if committed > 0 && now.status == "processing" {
            values.push(("status", json!("ready")));
        }
        if now.outputs_status != text_of(&status) || now.status == "processing" {
            ctx.commit_batch(vec![call_mutation(call, values)], vec![], Some(1.0))
                .await?;
            self.publish_call_row(call);
        }
        self.write_files(call);
        // @cpt-begin:cpt-noter-flow-core-postcall-write:p1:inst-write-notify
        self.notify_outputs(call, status);
        self.evaluate_role_policy(&head.call_type);
        // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-notify
        // @cpt-begin:cpt-noter-flow-core-postcall-write:p1:inst-write-return
        // The session manager queued the archive pass at the stop; it checks the audio itself.
        match first_failure {
            Some(code) => Err(Stop::Failed(CoreError::new(
                code,
                "a post-call section was not written",
            ))),
            None => Ok(()),
        }
        // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-return
    }

    fn privacy_of(&self, sensitive: bool) -> Privacy {
        Privacy {
            mode: lock(&self.settings).privacy.mode,
            sensitive,
            offline: !self.app().environment.online,
        }
    }

    fn section_failed(&self, call: &CallId, kind: SectionKind, code: ErrorCode) {
        let failed = SectionState::Failed {
            code,
            local_fallback_available: self.local_fallback(),
        };
        self.postcall.set(call, kind, failed.clone());
        self.progress(call, kind, failed);
    }

    // @cpt-algo:cpt-noter-algo-core-postcall-notify:p1
    /// The outcome goes to the session manager's hold rule: held while a call is live or Noter
    /// is hidden for presenting, not sent while the main window shows the call (its page has the
    /// sections as they arrive), else posted with the call's Summary as its target.
    fn notify_outputs(&self, call: &CallId, status: OutputsStatus) {
        // @cpt-begin:cpt-noter-algo-core-postcall-notify:p1:inst-notify-session
        let kind = if status == OutputsStatus::Failed {
            NotificationKind::SummaryFailed
        } else {
            NotificationKind::SummaryReady
        };
        // @cpt-end:cpt-noter-algo-core-postcall-notify:p1:inst-notify-session
        // @cpt-begin:cpt-noter-algo-core-postcall-notify:p1:inst-notify-hold
        self.notify(Notification {
            call_id: call.clone(),
            kind,
        });
        // @cpt-end:cpt-noter-algo-core-postcall-notify:p1:inst-notify-hold
    }

    /// The Regeneration run: the requested sections (all after the archive pass) written again
    /// from the active transcript, each merged with the user's edit and its reviewed items.
    async fn regenerate(&self, ctx: &mut RunCtx, call: &CallId) -> Result<(), Stop> {
        let request = self.postcall.take_request(call);
        let Some(head) = self.current(call)? else {
            return Ok(());
        };
        // @cpt-begin:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-merge
        let call_type = request
            .as_ref()
            .and_then(|r| r.skill.as_ref())
            .map_or(head.call_type.clone(), |s| s.0.clone());
        let kinds: Vec<SectionKind> = match &request {
            Some(r) if !r.sections.is_empty() => r
                .sections
                .iter()
                .filter(|k| **k != SectionKind::RoleReviews)
                .copied()
                .collect(),
            _ => sections_of(&head.call_type),
        };
        let options = request.map_or_else(Options::default, |r| Options {
            runtime: r.runtime,
            model: r.model,
            local: r.local,
        });
        let packet = self.packet(call, head.sensitive, &call_type)?;
        let privacy = self.privacy_of(head.sensitive);
        let total = kinds.len();
        let mut first_failure = None;
        for (n, kind) in kinds.into_iter().enumerate() {
            ctx.checkpoint().await?;
            self.postcall.set(call, kind, SectionState::Writing);
            self.progress(call, kind, SectionState::Writing);
            let g = match self.generate(call, kind, &packet, privacy, &options).await {
                Ok(g) => g,
                Err(None) => return Err(Stop::Cancelled),
                Err(Some(code)) => {
                    self.section_failed(call, kind, code);
                    first_failure.get_or_insert(code);
                    continue;
                }
            };
            // @cpt-begin:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-return
            // A capture continued meanwhile: the late output is never installed.
            if self.current(call)?.is_none() {
                return Ok(());
            }
            // @cpt-end:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-return
            let progress = Some((n + 1) as f32 / total as f32);
            let state = self
                .commit_section(ctx, call, kind, &g, vec![], progress)
                .await?;
            self.postcall.set(call, kind, state.clone());
            self.progress(call, kind, state);
        }
        // @cpt-end:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-merge
        // @cpt-begin:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-publish
        // The call's aggregate follows its sections: Try Again on the failed one makes it ready.
        let states: Vec<SectionState> = self
            .outputs_now(call)?
            .sections
            .into_iter()
            .filter(|s| s.kind != SectionKind::RoleReviews)
            .map(|s| s.state)
            .collect();
        let status = aggregate(&states);
        if let Some(now) = self.current(call)? {
            if status != OutputsStatus::Writing && now.outputs_status != text_of(&status) {
                let values = vec![("outputs_status", to_json(&status))];
                ctx.commit_batch(vec![call_mutation(call, values)], vec![], Some(1.0))
                    .await?;
                self.publish_call_row(call);
            }
        }
        self.write_files(call);
        // @cpt-end:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-publish
        match first_failure {
            Some(code) => Err(Stop::Failed(CoreError::new(
                code,
                "a section was not regenerated",
            ))),
            None => Ok(()),
        }
    }

    // @cpt-flow:cpt-noter-flow-core-postcall-edit:p1
    // @cpt-begin:cpt-noter-flow-core-postcall-edit:p1:inst-edit-get
    /// `outputs_get`: every section of the call in order, with its state and provenance.
    pub(crate) fn outputs_now(&self, call: &CallId) -> Result<CallOutputs, CoreError> {
        let id = call.as_str().to_owned();
        let (head, rows) = self
            .store()
            .read(move |c| match header(c, &id)? {
                Some(head) => Ok(Some((head, stored(c, "call_id", &id)?))),
                None => Ok(None),
            })?
            .ok_or_else(|| not_found("call"))?;
        let mut kinds = sections_of(&head.call_type);
        for row in &rows {
            if !kinds.contains(&row.kind) {
                kinds.push(row.kind);
            }
        }
        let sections: Vec<OutputSection> = kinds
            .into_iter()
            .map(|kind| {
                let row = rows.iter().find(|s| s.kind == kind);
                section(row, kind, self.postcall.get(call, kind))
            })
            .collect();
        let writing = sections.iter().any(|s| s.state == SectionState::Writing);
        Ok(CallOutputs {
            call_id: call.clone(),
            status: if writing {
                OutputsStatus::Writing
            } else {
                word(&head.outputs_status).unwrap_or(OutputsStatus::NotStarted)
            },
            archive: word(&head.archive_status).unwrap_or(ArchiveStatus::NotStarted),
            // Suggested items wait for review once the items tables land (2.18).
            review_waiting: 0,
            sensitive: head.sensitive,
            written_locally: sections.iter().any(|s| {
                s.writer
                    .as_ref()
                    .is_some_and(|w| w.runtime == RuntimeChoice::Local)
            }),
            sections,
        })
    }
    // @cpt-end:cpt-noter-flow-core-postcall-edit:p1:inst-edit-get

    fn section_now(&self, call: &CallId, kind: SectionKind) -> Result<OutputSection, CoreError> {
        self.outputs_now(call)?
            .sections
            .into_iter()
            .find(|s| s.kind == kind)
            .ok_or_else(|| not_found("section"))
    }

    /// `output_edit`: a new user-edit version becomes the section's current one, under its `rev`.
    pub(crate) fn edit_output(
        &self,
        ctx: &CommandCtx,
        args: OutputEditArgs,
    ) -> Result<OutputMutation, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-postcall-edit:p1:inst-edit-validate
        let call = args.call_id.as_str().to_owned();
        let id = args.summary_id.as_str().to_owned();
        let (head, found) = self
            .store()
            .read(move |c| Ok((header(c, &call)?, stored(c, "id", &id)?.pop())))?;
        head.ok_or_else(|| not_found("call"))?;
        let stored = found.ok_or_else(|| not_found("section"))?;
        if stored.call_id != args.call_id.as_str() {
            return Err(CoreError::new(
                ErrorCode::InvalidInput,
                "the section belongs to another call",
            ));
        }
        if noter_llm::raw_html(&args.body_md) {
            return Err(
                CoreError::new(ErrorCode::InvalidInput, "Markdown only, no HTML").with_detail(
                    ErrorDetail::Validation {
                        field: "body_md".into(),
                        rule: ValidationRule::InvalidFormat,
                    },
                ),
            );
        }
        // @cpt-end:cpt-noter-flow-core-postcall-edit:p1:inst-edit-validate
        // @cpt-begin:cpt-noter-flow-core-postcall-edit:p1:inst-edit-commit
        // The generated base stays a version of its own; undo moves the section back to it.
        let version = format!("ver_{}", ulid::Ulid::generate());
        let rows = vec![
            Mutation {
                entity_type: "summary_version",
                table: "summary_versions",
                id: version.clone(),
                base_rev: None,
                bump_rev: false,
                values: vec![
                    ("summary_id", json!(stored.id)),
                    ("n", json!(stored.versions + 1)),
                    ("kind", json!("user_edit")),
                    ("body_md", json!(args.body_md)),
                    ("lang", json!(stored.lang)),
                    ("from_pass", json!(stored.from_pass)),
                    ("created_at", json!(self.deps.clock.now().0)),
                ],
            },
            Mutation {
                entity_type: "summary",
                table: "summaries",
                id: stored.id.clone(),
                base_rev: Some(args.rev),
                bump_rev: true,
                values: vec![
                    ("current_version_id", json!(version)),
                    ("user_edited", json!(1)),
                ],
            },
        ];
        let what = text_of(&stored.kind).replace('_', " ");
        let meta = self.change_meta(ctx, format!("Edited the {what}"), "output_edit");
        let written = self.store().write_batch(rows, meta)?;
        // @cpt-end:cpt-noter-flow-core-postcall-edit:p1:inst-edit-commit
        // @cpt-begin:cpt-noter-flow-core-postcall-edit:p1:inst-edit-publish
        // No index holds a section's body yet (FTS is M3).
        let section = self.section_now(&args.call_id, stored.kind)?;
        self.progress(&args.call_id, stored.kind, section.state.clone());
        self.emit_entity_changed(&EntityChanged::Section {
            call_id: args.call_id.clone(),
            section: section.clone(),
        });
        self.write_files(&args.call_id);
        Ok(OutputMutation {
            section,
            change_id: written[1].change_id.clone(),
        })
        // @cpt-end:cpt-noter-flow-core-postcall-edit:p1:inst-edit-publish
    }

    fn versions_of(&self, summary: &SummaryId) -> Result<Vec<(VersionMeta, String)>, CoreError> {
        let id = summary.as_str().to_owned();
        let rows = self.store().read(move |c| {
            let mut stmt = c.prepare(
                "SELECT v.id, v.n, v.kind, v.body_md, l.runtime_choice, l.model, k.call_type,
                        v.skill_version, v.created_at, v.from_pass
                 FROM summary_versions v
                 JOIN summaries s ON s.id = v.summary_id
                 JOIN calls k ON k.id = s.call_id
                 LEFT JOIN llm_runs l ON l.id = v.llm_run_id
                 WHERE v.summary_id = ?1 ORDER BY v.n",
            )?;
            let rows = stmt.query_map([&id], |r| {
                let kind = if r.get::<_, String>(2)? == "user_edit" {
                    VersionKind::UserEdit
                } else {
                    VersionKind::Generated
                };
                let meta = VersionMeta {
                    id: VersionId::new(r.get::<_, String>(0)?),
                    n: r.get(1)?,
                    kind,
                    writer: writer_at(r, 4)?,
                    created_at: TimestampMs(r.get(8)?),
                };
                Ok((meta, r.get::<_, String>(3)?))
            })?;
            rows.collect::<Result<Vec<_>, _>>()
        })?;
        if rows.is_empty() {
            return Err(not_found("section"));
        }
        Ok(rows)
    }

    // @cpt-begin:cpt-noter-flow-core-postcall-edit:p1:inst-edit-versions
    /// `output_versions`: every version of a section, oldest first.
    pub(crate) fn output_version_list(
        &self,
        summary: &SummaryId,
    ) -> Result<VersionList, CoreError> {
        let versions = self.versions_of(summary)?.into_iter().map(|(m, _)| m);
        Ok(VersionList {
            versions: versions.collect(),
        })
    }

    /// `output_version_get`: one version's whole body, for the UI's diff.
    pub(crate) fn output_version(&self, args: &VersionGetArgs) -> Result<VersionBody, CoreError> {
        let (meta, body_md) = self
            .versions_of(&args.summary_id)?
            .into_iter()
            .find(|(m, _)| m.id == args.version_id)
            .ok_or_else(|| not_found("version"))?;
        // @cpt-begin:cpt-noter-flow-core-postcall-edit:p1:inst-edit-return
        Ok(VersionBody { meta, body_md })
        // @cpt-end:cpt-noter-flow-core-postcall-edit:p1:inst-edit-return
    }
    // @cpt-end:cpt-noter-flow-core-postcall-edit:p1:inst-edit-versions

    /// `outputs_regenerate`: queues a Regeneration run of the call with the requested sections
    /// (none means all), runtime, model, skill and local rewrite.
    pub(crate) fn queue_regeneration(
        &self,
        args: &RegenerateArgs,
    ) -> Result<JobAccepted, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-request
        let id = args.call_id.as_str().to_owned();
        let head = self
            .store()
            .read(move |c| header(c, &id))?
            .ok_or_else(|| not_found("call"))?;
        let known = sections_of(&head.call_type);
        let unknown = args
            .sections
            .iter()
            .any(|k| *k != SectionKind::RoleReviews && !known.contains(k));
        if unknown {
            return Err(CoreError::new(
                ErrorCode::InvalidInput,
                "the call type has no such section",
            ));
        }
        let blocked = || CoreError::new(ErrorCode::JobBlocked, "a call is being recorded");
        if self.capture_guard.borrow().live {
            return Err(blocked());
        }
        let req = Request::for_call(JobKind::Regeneration, Trigger::OnDemand, &args.call_id);
        self.postcall.request(args);
        let run = self.in_runtime(|| self.jobs.trigger(req))?;
        Ok(JobAccepted {
            job_run_id: run.ok_or_else(blocked)?,
        })
        // @cpt-end:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-request
    }

    /// After an undo or redo of a section: its new state goes out as progress.
    pub(crate) fn publish_section(&self, summary: &str) -> Result<(), CoreError> {
        let id = summary.to_owned();
        let found = self.store().read(move |c| stored(c, "id", &id))?.pop();
        if let Some(s) = found {
            let call = CallId::new(s.call_id);
            let section = self.section_now(&call, s.kind)?;
            self.progress(&call, s.kind, section.state.clone());
            self.emit_entity_changed(&EntityChanged::Section {
                call_id: call.clone(),
                section,
            });
            self.write_files(&call);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn failed() -> SectionState {
        SectionState::Failed {
            code: ErrorCode::RuntimeUnavailable,
            local_fallback_available: true,
        }
    }

    // Every transition of `cpt-noter-state-core-postcall-section`, and nothing else.
    #[tokio::test(start_paused = true)]
    async fn the_section_state_machine_allows_exactly_its_transitions() {
        use SectionState::*;
        let all = [Pending, Writing, Ready, Empty, failed()];
        let allowed = [
            (Pending, Writing),
            (Writing, Ready),
            (Writing, Empty),
            (Writing, failed()),
            (failed(), Writing),
            (Ready, Writing),
            (Empty, Writing),
            (Writing, Pending),
        ];
        for from in &all {
            for to in &all {
                let want = allowed.iter().any(|(a, b)| a == from && b == to);
                assert_eq!(can(from, to), want, "{from:?} -> {to:?}");
            }
        }
        // The live map follows the machine: an illegal move leaves the section where it was.
        let live = Sections::default();
        let call = CallId::new("c");
        live.set(&call, SectionKind::Summary, Ready);
        assert_eq!(live.get(&call, SectionKind::Summary), None);
        live.set(&call, SectionKind::Summary, Writing);
        live.set(&call, SectionKind::Summary, Pending);
        assert_eq!(live.get(&call, SectionKind::Summary), None);
        live.set(&call, SectionKind::Summary, Writing);
        live.settle(&call);
        assert_eq!(live.get(&call, SectionKind::Summary), None);
    }

    #[test]
    fn an_agent_switches_off_at_eighty_percent_dismissed_over_the_last_ten_calls() {
        // Nine calls are not enough history.
        assert!(!switches_off(&[(5, 5); 9]));
        // 40 of 50 dismissed: exactly 80 %.
        assert!(switches_off(&[(4, 5); 10]));
        // 39 of 50: under.
        let mut under = vec![(4, 5); 10];
        under[0] = (3, 5);
        assert!(!switches_off(&under));
        // Only the last ten count: an old run of keeps does not save it.
        let mut long = vec![(0, 5); 5];
        long.extend([(5, 5); 10]);
        assert!(switches_off(&long));
        // Calls with no cards shown decide nothing.
        assert!(!switches_off(&[(0, 0); 10]));
    }

    #[test]
    fn an_item_is_the_same_whatever_its_case_spacing_or_final_stop() {
        assert_eq!(identity("  Ship  the API. "), identity("ship the api"));
        assert_ne!(identity("Ship the API"), identity("Ship the UI"));
        assert_eq!(heading(SectionKind::ActionItems), "Action items");
        assert_eq!(item_kind(SectionKind::Risks), Some("risk"));
        assert_eq!(item_kind(SectionKind::Summary), None);
    }

    #[test]
    fn the_aggregate_follows_the_sections() {
        use SectionState::*;
        assert_eq!(aggregate(&[Ready, Writing]), OutputsStatus::Writing);
        assert_eq!(aggregate(&[Ready, Empty]), OutputsStatus::Ready);
        assert_eq!(
            aggregate(&[Ready, failed()]),
            OutputsStatus::PartiallyFailed
        );
        assert_eq!(aggregate(&[failed(), failed()]), OutputsStatus::Failed);
    }

    #[test]
    fn the_router_failures_map_to_typed_codes() {
        let unavailable = CoreError::new(ErrorCode::CliMissing, "x");
        assert_eq!(
            code_of(&Failure::Unavailable(unavailable)),
            Some(ErrorCode::CliMissing)
        );
        let key = Failure::Runtime {
            code: "key_rejected".into(),
        };
        assert_eq!(code_of(&key), Some(ErrorCode::KeyRejected));
        assert_eq!(code_of(&Failure::Budget), Some(ErrorCode::BudgetPaused));
        assert_eq!(
            code_of(&Failure::Timeout),
            Some(ErrorCode::RuntimeUnavailable)
        );
        let invalid = Failure::Invalid {
            reason: "citations",
        };
        assert_eq!(code_of(&invalid), Some(ErrorCode::OutputInvalid));
        assert_eq!(code_of(&Failure::Cancelled), None);
    }

    #[test]
    fn model_text_lands_in_markdown_bodies_without_raw_html() {
        let item = ExtractedItem {
            text: "Ship <b>it</b>".into(),
            owner_hint: None,
            due: None,
            quote: "we ship".into(),
            evidence_segment_ids: vec![],
            is_engineering: false,
            linked_issue: None,
            topic_hint: None,
            lang: Lang::En,
        };
        let notes = ParticipantNotes {
            speaker_label: "Anna".into(),
            said: vec!["hello".into(), "bye".into()],
            committed_to: vec![],
            asked_for: vec!["time".into()],
            pushed_back_on: vec![],
            evidence_segment_ids: vec![],
        };
        let out = PostCallOutput {
            lang: Lang::En,
            summary_md: " S. ".into(),
            decisions: vec![item.clone()],
            action_items: vec![],
            open_questions: vec![],
            risks: vec![item],
            per_participant: vec![notes],
            extras_md: Some("Extras".into()),
        };
        assert_eq!(body_of(SectionKind::Summary, &out), "S.");
        let decisions = body_of(SectionKind::Decisions, &out);
        assert_eq!(decisions, "- Ship &lt;b>it&lt;/b>\n  > we ship");
        assert!(!noter_llm::raw_html(&decisions));
        assert_eq!(body_of(SectionKind::Risks, &out), decisions);
        assert_eq!(body_of(SectionKind::ActionItems, &out), "");
        assert_eq!(
            body_of(SectionKind::PerParticipant, &out),
            "**Anna**\n- Said: hello; bye\n- Asked for: time"
        );
        assert_eq!(body_of(SectionKind::CallTypeExtras, &out), "Extras");
        assert_eq!(body_of(SectionKind::RoleReviews, &out), "");
        assert_eq!(clock(3_725_000), "01:02:05");
    }

    #[test]
    fn only_the_call_types_with_extras_get_the_extras_section_and_speakers_are_named() {
        assert!(sections_of("planning").contains(&SectionKind::CallTypeExtras));
        assert!(!sections_of("one_on_one").contains(&SectionKind::CallTypeExtras));
        let names: Vec<String> = [
            SpeakerLabel::You,
            SpeakerLabel::Unnamed { n: 2 },
            SpeakerLabel::GuestYourSide,
        ]
        .iter()
        .map(speaker_name)
        .collect();
        assert_eq!(names, ["You", "Speaker 2", "Guest"]);
    }
}
