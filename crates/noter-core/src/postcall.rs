// @cpt-component:cpt-noter-component-core-postcall:p1
//! Post-call outputs (`cpt-noter-feature-core-postcall`, slice 1): the PostCall job writes the
//! sections from the live transcript, one router run per section in the stated order, each
//! committed as its own logged batch; the outputs commands read, edit and compare them.
//! Archive install, re-chunking, the merge regeneration and notifications are slice 2.

use std::collections::HashMap;
use std::sync::{Arc, Weak};

use noter_db::rusqlite::{Connection, OptionalExtension};
use noter_db::Mutation;
use noter_jobs::{BoxFuture, JobHandler, Request, RunCtx, Stop, Trigger};
use noter_llm::{
    Failure, LlmRuntime, Packet, PacketItem, Privacy, RunRequest, Skill, SourceClass, TaskKind,
};
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::{event_names, CommandCtx};
use noter_protocol::model::settings::AuditWhat;
use noter_protocol::model::*;
use noter_protocol::skills::{ExtractedItem, ParticipantNotes, PostCallOutput};
use noter_protocol::*;
use serde_json::{json, Value};

use crate::{lock, to_json, Core};

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
// until slice 2's retry stores the failure (no column for it in `summaries`).
#[derive(Default)]
pub(crate) struct Sections(std::sync::Mutex<HashMap<(CallId, SectionKind), SectionState>>);

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
        // shortcut: no error code names an output that stayed invalid; Internal until the
        // contract has one.
        Failure::Invalid { .. } => ErrorCode::Internal,
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

fn speaker_name(label: &SpeakerLabel) -> String {
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

/// One section's generated text, as the job commits it.
struct Generated {
    body_md: String,
    lang: Lang,
    llm_run_id: Option<String>,
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

/// Registers the PostCall handler on the core's scheduler.
pub(crate) fn register(core: &Arc<Core>) {
    core.jobs.register(
        JobKind::PostCall,
        Arc::new(PostCallJob(Arc::downgrade(core))),
    );
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

    /// The evidence packet: every confirmed live segment and mark, by id.
    fn packet(&self, call: &CallId, sensitive: bool) -> Result<Packet, CoreError> {
        let source = if sensitive {
            SourceClass::Sensitive
        } else {
            SourceClass::Normal
        };
        let id = call.clone();
        let (segments, marks) = self.store().read(move |c| {
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
            Ok((segments, marks))
        })?;
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
    ) -> Result<Generated, Option<ErrorCode>> {
        if packet.items.is_empty() {
            // Nothing was said: every section is validly empty, and nothing goes to a model.
            return Ok(Generated {
                body_md: String::new(),
                lang: Lang::En,
                llm_run_id: None,
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
        let done = self.llm().run_once(req).await.map_err(|f| code_of(&f))?;
        // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-model
        let out: PostCallOutput =
            serde_json::from_value(done.output).map_err(|_| Some(ErrorCode::Internal))?;
        Ok(Generated {
            body_md: body_of(kind, &out),
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

    /// The rows one generated section commits: a new version, and the section pointing at it.
    fn section_rows(
        &self,
        call: &CallId,
        kind: SectionKind,
        existing: Option<&Stored>,
        g: &Generated,
    ) -> Vec<Mutation> {
        // @cpt-begin:cpt-noter-algo-core-postcall-store:p1:inst-store-version
        let summary = existing.map_or_else(
            || format!("sum_{}", ulid::Ulid::generate()),
            |s| s.id.clone(),
        );
        let version = format!("ver_{}", ulid::Ulid::generate());
        let mut section = vec![("current_version_id", json!(version))];
        if existing.is_none() {
            section.extend([
                ("call_id", json!(call.as_str())),
                ("kind", json!(text_of(&kind))),
            ]);
        }
        vec![
            Mutation {
                entity_type: "summary_version",
                table: "summary_versions",
                id: version,
                base_rev: None,
                bump_rev: false,
                values: vec![
                    ("summary_id", json!(summary)),
                    ("n", json!(existing.map_or(0, |s| s.versions) + 1)),
                    ("kind", json!("generated")),
                    ("body_md", json!(g.body_md)),
                    ("lang", json!(text_of(&g.lang))),
                    ("skill_version", json!(SKILL_VERSION)),
                    ("llm_run_id", json!(g.llm_run_id)),
                    ("from_pass", json!("live")),
                    ("created_at", json!(self.deps.clock.now().0)),
                ],
            },
            Mutation {
                entity_type: "summary",
                table: "summaries",
                id: summary,
                // A section written meanwhile fails the batch rather than being overwritten.
                base_rev: existing.map(|s| Rev(s.rev)),
                bump_rev: true,
                values: section,
            },
        ]
        // @cpt-end:cpt-noter-algo-core-postcall-store:p1:inst-store-version
    }

    /// The PostCall run: every section in order, each validated, committed and published before
    /// the next; a failed section is recorded and the next one runs; the run fails at the end
    /// with the first failed section's typed error.
    async fn write_outputs(&self, ctx: &mut RunCtx, call: &CallId) -> Result<(), Stop> {
        let Some(head) = self.current(call)? else {
            return Ok(());
        };
        let kinds = sections_of(&head.call_type);
        let packet = self.packet(call, head.sensitive)?;
        let privacy = Privacy {
            mode: lock(&self.settings).privacy.mode,
            sensitive: head.sensitive,
            offline: !self.app().environment.online,
        };
        self.postcall.clear(call);
        let mut first_failure: Option<ErrorCode> = None;
        let mut committed = 0;
        let total = kinds.len();
        // @cpt-begin:cpt-noter-flow-core-postcall-write:p1:inst-write-sections
        for (n, kind) in kinds.into_iter().enumerate() {
            ctx.checkpoint().await?;
            // shortcut: an edited section is kept as it is; slice 2 merges a new generation in.
            if self
                .stored_section(call, kind)?
                .is_some_and(|s| s.user_edited)
            {
                committed += 1;
                continue;
            }
            // @cpt-begin:cpt-noter-flow-core-postcall-write:p1:inst-write-validate
            self.postcall.set(call, kind, SectionState::Writing);
            self.progress(call, kind, SectionState::Writing);
            let generated = self.generate(call, kind, &packet, privacy).await;
            // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-validate
            let g = match generated {
                Ok(g) => g,
                Err(None) => return Err(Stop::Cancelled),
                // @cpt-begin:cpt-noter-flow-core-postcall-write:p1:inst-write-failed-section
                Err(Some(code)) => {
                    let failed = SectionState::Failed {
                        code,
                        local_fallback_available: self.local_fallback(),
                    };
                    self.postcall.set(call, kind, failed.clone());
                    self.progress(call, kind, failed);
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
            // An edit that landed while the model ran stays the current version.
            let existing = self.stored_section(call, kind)?;
            if let Some(edited) = existing.as_ref().filter(|s| s.user_edited) {
                let state = section(Some(edited), kind, None).state;
                self.postcall.set(call, kind, state.clone());
                self.progress(call, kind, state);
                committed += 1;
                continue;
            }
            let mut rows = self.section_rows(call, kind, existing.as_ref(), &g);
            let first = committed == 0 && now.status == "processing";
            if first {
                // @cpt-begin:cpt-noter-state-core-library-calls-status:p1:inst-st-ready
                rows.push(call_mutation(
                    call,
                    vec![
                        ("status", json!("ready")),
                        ("outputs_status", json!("writing")),
                    ],
                ));
                // @cpt-end:cpt-noter-state-core-library-calls-status:p1:inst-st-ready
            }
            // @cpt-begin:cpt-noter-algo-core-postcall-store:p1:inst-store-commit
            let progress = Some((n + 1) as f32 / total as f32);
            ctx.commit_batch(rows, vec![], progress).await?;
            // @cpt-end:cpt-noter-algo-core-postcall-store:p1:inst-store-commit
            // @cpt-begin:cpt-noter-algo-core-postcall-store:p1:inst-store-return
            let state = if g.body_md.is_empty() {
                SectionState::Empty
            } else {
                SectionState::Ready
            };
            // @cpt-end:cpt-noter-algo-core-postcall-store:p1:inst-store-return
            committed += 1;
            self.postcall.set(call, kind, state.clone());
            self.progress(call, kind, state);
            if first {
                self.publish_call_row(call);
            }
            // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-commit
        }
        // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-sections
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
        match first_failure {
            Some(code) => Err(Stop::Failed(CoreError::new(
                code,
                "a post-call section was not written",
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
        // No per-call files or index hold a section's body yet (summary.md is slice 2, FTS M3).
        let section = self.section_now(&args.call_id, stored.kind)?;
        self.progress(&args.call_id, stored.kind, section.state.clone());
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

    /// `outputs_regenerate`: queues a Regeneration run of the call; no sections means all.
    // shortcut: the run's handler is a seam until slice 2, which carries the requested sections,
    // runtime and local rewrite into the merge.
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
            let state = self.section_now(&call, s.kind)?.state;
            self.progress(&call, s.kind, state);
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
        assert_eq!(code_of(&invalid), Some(ErrorCode::Internal));
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
