//! Share content: the scope of a call's outputs rendered for Slack, Jira or Markdown
//! (`cpt-noter-algo-core-items-today-format`), as plain text plus the rich forms for the clipboard.

use std::path::{Path, PathBuf};

use noter_db::rusqlite::OptionalExtension;
use noter_protocol::error::ValidationRule;
use noter_protocol::model::*;
use noter_protocol::{CallId, CoreError, ErrorCode};

use crate::settings::invalid;
use crate::transcript::segments_of;
use crate::{internal, ClipboardText, Core, SaveKind};

/// What a scope renders to: the chosen format's text, the Markdown and HTML twins, and the counts.
pub(crate) struct Rendered {
    pub text: String,
    pub markdown: String,
    pub html: String,
    pub sections: u32,
    pub items: u32,
    pub unreviewed: u32,
}

/// One line of an item: its text and the facts that follow it.
struct Line {
    text: String,
    /// `Some(done)` for an action item's checkbox.
    check: Option<bool>,
    facts: Vec<String>,
    /// Evidence: the time label and the link to that moment.
    links: Vec<(String, String)>,
}

enum Block {
    Heading(String),
    /// A line of a text section's Markdown body.
    Text(String),
    Item(Line),
}

fn title(kind: SectionKind) -> &'static str {
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

fn line_of(item: &ItemView) -> Line {
    let mut facts = vec![];
    if let Some(o) = &item.owner {
        facts.push(o.display_name.clone());
    }
    if let Some(d) = &item.due {
        facts.push(format!("due {}", d.0));
    }
    if item.review == ReviewState::Suggested {
        facts.push("Not reviewed".into());
    }
    // shortcut: no deep-link scheme is registered yet, so evidence links are `noter://` URLs the
    // app will own; point them at the registered handler when the scheme lands.
    let links = item
        .spans
        .iter()
        .map(|s| {
            let s0 = s.t0_ms.0 / 1000;
            (
                format!("{}:{:02}", s0 / 60, s0 % 60),
                format!("noter://call/{}?t={}", s.call_id, s.t0_ms.0),
            )
        })
        .collect();
    Line {
        text: item.text.clone(),
        check: (item.kind == ItemKind::ActionItem).then_some(item.status == ItemStatus::Done),
        facts,
        links,
    }
}

// @cpt-algo:cpt-noter-algo-core-items-today-format:p1
pub(crate) fn render(
    outputs: &CallOutputs,
    scope: &ShareScope,
    format: ShareFormat,
) -> Result<Rendered, CoreError> {
    // @cpt-begin:cpt-noter-algo-core-items-today-format:p1:inst-format-scope
    let chosen: Vec<&OutputSection> = outputs
        .sections
        .iter()
        .filter(|s| scope.sections.is_empty() || scope.sections.contains(&s.kind))
        .collect();
    let known =
        |id: &noter_protocol::ItemId| chosen.iter().any(|s| s.items.iter().any(|i| &i.id == id));
    if !scope.item_ids.iter().all(known) {
        return Err(invalid("scope.item_ids", ValidationRule::OutOfRange));
    }
    // @cpt-end:cpt-noter-algo-core-items-today-format:p1:inst-format-scope
    // @cpt-begin:cpt-noter-algo-core-items-today-format:p1:inst-format-ready
    let ready: Vec<&OutputSection> = chosen
        .into_iter()
        .filter(|s| s.state == SectionState::Ready)
        .collect();
    // @cpt-end:cpt-noter-algo-core-items-today-format:p1:inst-format-ready
    let picked = |i: &&ItemView| {
        i.review != ReviewState::Rejected
            && (scope.item_ids.is_empty() || scope.item_ids.contains(&i.id))
    };
    // @cpt-begin:cpt-noter-algo-core-items-today-format:p1:inst-format-review
    let unreviewed = ready
        .iter()
        .flat_map(|s| s.items.iter().filter(picked))
        .filter(|i| i.review == ReviewState::Suggested)
        .count() as u32;
    if unreviewed > 0 && !scope.include_unreviewed {
        return Err(CoreError::new(
            ErrorCode::UnreviewedInScope,
            format!("{unreviewed} suggested items are not reviewed"),
        ));
    }
    // @cpt-end:cpt-noter-algo-core-items-today-format:p1:inst-format-review
    // @cpt-begin:cpt-noter-algo-core-items-today-format:p1:inst-format-render
    let (mut blocks, mut sections, mut items) = (vec![], 0, 0);
    for s in ready {
        let lines: Vec<Line> = s.items.iter().filter(picked).map(line_of).collect();
        // Choosing items chooses items only: a text section's body is not one of them.
        let body = s.body_md.as_deref().filter(|_| scope.item_ids.is_empty());
        if lines.is_empty() && body.is_none() {
            continue;
        }
        sections += 1;
        items += lines.len() as u32;
        blocks.push(Block::Heading(title(s.kind).into()));
        blocks.extend(
            body.into_iter()
                .flat_map(str::lines)
                .map(|l| Block::Text(l.into())),
        );
        blocks.extend(lines.into_iter().map(Block::Item));
    }
    if blocks.is_empty() {
        return Err(CoreError::new(
            ErrorCode::OutputsNotReady,
            "nothing to share yet",
        ));
    }
    // @cpt-end:cpt-noter-algo-core-items-today-format:p1:inst-format-render
    // @cpt-begin:cpt-noter-algo-core-items-today-format:p1:inst-format-return
    let markdown = markdown(&blocks);
    let text = match format {
        ShareFormat::Markdown => markdown.clone(),
        ShareFormat::Slack => slack(&blocks),
        ShareFormat::Jira => jira(&blocks),
    };
    Ok(Rendered {
        text,
        markdown,
        html: html(&blocks),
        sections,
        items,
        unreviewed,
    })
    // @cpt-end:cpt-noter-algo-core-items-today-format:p1:inst-format-return
}

/// Backslash before each character in `special`.
fn escape(text: &str, special: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if special.contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn entities(text: &str, quotes: bool) -> String {
    let t = text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    if quotes {
        t.replace('"', "&quot;")
    } else {
        t
    }
}

/// A body line seen from another markup: a heading, a bullet or text, with `**bold**` runs apart.
enum Body<'a> {
    Heading(&'a str),
    Bullet(&'a str),
    Text(&'a str),
}

fn body_of(line: &str) -> Body<'_> {
    let hashes = line.chars().take_while(|c| *c == '#').count();
    if (1..=6).contains(&hashes) && line[hashes..].starts_with(' ') {
        return Body::Heading(line[hashes + 1..].trim());
    }
    match line.strip_prefix("- ").or_else(|| line.strip_prefix("* ")) {
        Some(rest) => Body::Bullet(rest),
        None => Body::Text(line),
    }
}

/// `text` with its `**bold**` runs wrapped by `open`/`close` and the rest escaped by `esc`.
fn inline(text: &str, esc: &dyn Fn(&str) -> String, open: &str, close: &str) -> String {
    text.split("**")
        .enumerate()
        .map(|(n, run)| {
            if n % 2 == 1 {
                format!("{open}{}{close}", esc(run))
            } else {
                esc(run)
            }
        })
        .collect()
}

fn facts_of(l: &Line) -> String {
    if l.facts.is_empty() {
        String::new()
    } else {
        format!(" — {}", l.facts.join(", "))
    }
}

fn markdown(blocks: &[Block]) -> String {
    let mut out = vec![];
    for b in blocks {
        out.push(match b {
            Block::Heading(h) => format!("\n## {h}"),
            // Raw HTML stays out: Markdown renders the entity as the character.
            Block::Text(t) => t.replace('<', "&lt;"),
            Block::Item(l) => {
                let check = match l.check {
                    Some(true) => "[x] ",
                    Some(false) => "[ ] ",
                    None => "",
                };
                let links: String = l
                    .links
                    .iter()
                    .map(|(t, u)| format!(" [{t}]({u})"))
                    .collect();
                format!(
                    "- {check}{}{}{links}",
                    escape(&l.text, "\\`*_[]<>"),
                    facts_of(l)
                )
            }
        });
    }
    out.join("\n").trim_start().to_string()
}

fn slack(blocks: &[Block]) -> String {
    let esc = |t: &str| entities(t, false);
    let mut out = vec![];
    for b in blocks {
        out.push(match b {
            Block::Heading(h) => format!("\n*{}*", esc(h)),
            Block::Text(t) => match body_of(t) {
                Body::Heading(h) => format!("*{}*", esc(h)),
                Body::Bullet(x) => format!("• {}", inline(x, &esc, "*", "*")),
                Body::Text(x) => inline(x, &esc, "*", "*"),
            },
            Block::Item(l) => {
                let check = match l.check {
                    Some(true) => "☑ ",
                    Some(false) => "☐ ",
                    None => "",
                };
                let links: String = l.links.iter().map(|(t, u)| format!(" <{u}|{t}>")).collect();
                format!("• {check}{}{}{links}", esc(&l.text), esc(&facts_of(l)))
            }
        });
    }
    out.join("\n").trim_start().to_string()
}

fn jira(blocks: &[Block]) -> String {
    let esc = |t: &str| escape(t, "\\{}[]*_|~^<>");
    let mut out = vec![];
    for b in blocks {
        out.push(match b {
            Block::Heading(h) => format!("\nh2. {}", esc(h)),
            Block::Text(t) => match body_of(t) {
                Body::Heading(h) => format!("h3. {}", esc(h)),
                Body::Bullet(x) => format!("* {}", inline(x, &esc, "*", "*")),
                Body::Text(x) => inline(x, &esc, "*", "*"),
            },
            Block::Item(l) => {
                let check = match l.check {
                    Some(true) => "(/) ",
                    Some(false) => "(?) ",
                    None => "",
                };
                let links: String = l.links.iter().map(|(t, u)| format!(" [{t}|{u}]")).collect();
                format!("* {check}{}{}{links}", esc(&l.text), esc(&facts_of(l)))
            }
        });
    }
    out.join("\n").trim_start().to_string()
}

fn html(blocks: &[Block]) -> String {
    let esc = |t: &str| entities(t, true);
    let mut out = String::new();
    let mut open = false;
    for b in blocks {
        let (list, markup) = match b {
            Block::Heading(h) => (false, format!("<h2>{}</h2>", esc(h))),
            Block::Text(t) => match body_of(t) {
                Body::Heading(h) => (false, format!("<h3>{}</h3>", esc(h))),
                Body::Bullet(x) => (
                    true,
                    format!("<li>{}</li>", inline(x, &esc, "<strong>", "</strong>")),
                ),
                Body::Text(x) if x.trim().is_empty() => (open, String::new()),
                Body::Text(x) => (
                    false,
                    format!("<p>{}</p>", inline(x, &esc, "<strong>", "</strong>")),
                ),
            },
            Block::Item(l) => {
                let links: String = l
                    .links
                    .iter()
                    .map(|(t, u)| format!(" <a href=\"{}\">{}</a>", esc(u), esc(t)))
                    .collect();
                (
                    true,
                    format!("<li>{}{}{links}</li>", esc(&l.text), esc(&facts_of(l))),
                )
            }
        };
        if list && !open {
            out.push_str("<ul>");
        } else if !list && open {
            out.push_str("</ul>");
        }
        open = list;
        out.push_str(&markup);
    }
    if open {
        out.push_str("</ul>");
    }
    out
}

/// What a share or export needs of the `calls` row.
struct Facts {
    title: String,
    audio_kept: bool,
}

/// A file of an export: its name, and its text or the audio file it copies.
enum Content {
    Text(String),
    Copy(PathBuf),
}

fn not_found() -> CoreError {
    CoreError::new(ErrorCode::NotFound, "this call no longer exists")
}

fn slug(title: &str, id: &str) -> String {
    let words: String = title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let words: Vec<&str> = words.split('-').filter(|w| !w.is_empty()).collect();
    format!(
        "{}-{id}",
        words.join("-").chars().take(40).collect::<String>()
    )
}

/// `00:01:02,500`.
fn srt_time(ms: u32) -> String {
    format!(
        "{:02}:{:02}:{:02},{:03}",
        ms / 3_600_000,
        ms / 60_000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
}

fn speaker_name(label: &SpeakerLabel) -> String {
    match label {
        SpeakerLabel::You => "You".into(),
        SpeakerLabel::Person { person } => person.display_name.clone(),
        SpeakerLabel::Unnamed { n } => format!("Speaker {n}"),
        SpeakerLabel::GuestYourSide => "Guest (your side)".into(),
    }
}

fn srt(segments: &[SegmentView]) -> String {
    segments
        .iter()
        .enumerate()
        .map(|(n, s)| {
            format!(
                "{}\n{} --> {}\n{}: {}\n\n",
                n + 1,
                srt_time(s.t0_ms.0),
                srt_time(s.t1_ms.0),
                speaker_name(&s.speaker.label),
                s.text
            )
        })
        .collect()
}

fn write_all(folder: &Path, files: &[(String, Content)]) -> std::io::Result<()> {
    std::fs::create_dir_all(folder)?;
    for (name, content) in files {
        let to = folder.join(name);
        match content {
            Content::Text(text) => std::fs::write(&to, text)?,
            Content::Copy(from) => drop(std::fs::copy(from, &to)?),
        }
    }
    Ok(())
}

impl Core {
    fn call_facts(&self, id: &str) -> Result<Facts, CoreError> {
        self.store()
            .read(|c| {
                c.query_row(
                    "SELECT title, audio_deleted, audio_not_stored FROM calls WHERE id = ?1",
                    [id],
                    |r| {
                        Ok(Facts {
                            title: r.get(0)?,
                            audio_kept: r.get::<_, i64>(1)? == 0 && r.get::<_, i64>(2)? == 0,
                        })
                    },
                )
                .optional()
            })?
            .ok_or_else(not_found)
    }

    /// The call's committed output sections as share reads them: post-call's sections, with the
    /// item sections carrying their `items` rows (their Markdown stands in until there are any).
    fn outputs_for_share(&self, id: &CallId) -> Result<CallOutputs, CoreError> {
        let mut outputs = self.outputs_now(id)?;
        let items = self.items_of_call(id.as_str())?;
        for s in &mut outputs.sections {
            let kind = match s.kind {
                SectionKind::Decisions => ItemKind::Decision,
                SectionKind::ActionItems => ItemKind::ActionItem,
                SectionKind::OpenQuestions => ItemKind::OpenQuestion,
                SectionKind::Risks => ItemKind::Risk,
                _ => continue,
            };
            let mine: Vec<ItemView> = items.iter().filter(|i| i.kind == kind).cloned().collect();
            if !mine.is_empty() {
                s.items = mine;
                s.body_md = None;
            }
        }
        Ok(outputs)
    }

    // @cpt-flow:cpt-noter-flow-core-items-today-share:p1
    // @cpt-dod:cpt-noter-dod-core-items-today-sharing:p1
    pub(crate) async fn copy_share(&self, args: ShareCopyArgs) -> Result<ShareResult, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-items-today-share:p1:inst-share-request
        self.ready()?;
        let outputs = self.outputs_for_share(&args.call_id)?;
        let shared = render(&outputs, &args.scope, args.format)?;
        // @cpt-end:cpt-noter-flow-core-items-today-share:p1:inst-share-request
        // @cpt-begin:cpt-noter-flow-core-items-today-share:p1:inst-share-copy
        let board = ClipboardText {
            plain: shared.text.clone(),
            markdown: Some(shared.markdown),
            html: Some(shared.html),
        };
        self.deps
            .native_ops
            .clipboard_write(&board)
            .await
            .map_err(|_| {
                CoreError::new(ErrorCode::Internal, "the clipboard did not take the copy")
            })?;
        // @cpt-begin:cpt-noter-algo-core-items-today-format:p1:inst-format-sensitive
        Ok(ShareResult {
            text: shared.text,
            sections: shared.sections,
            items: shared.items,
            unreviewed_in_scope: shared.unreviewed,
            sensitive: outputs.sensitive,
        })
        // @cpt-end:cpt-noter-algo-core-items-today-format:p1:inst-format-sensitive
        // @cpt-end:cpt-noter-flow-core-items-today-share:p1:inst-share-copy
    }

    // @cpt-flow:cpt-noter-flow-core-items-today-share:p1
    pub(crate) async fn export_calls(
        &self,
        args: ExportCallsArgs,
    ) -> Result<ExportResult, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-items-today-share:p1:inst-share-request
        self.ready()?;
        let want = &args.include;
        if args.call_ids.is_empty() {
            return Err(invalid("call_ids", ValidationRule::Required));
        }
        if !(want.summary_and_items || want.transcript || want.audio) {
            return Err(invalid("include", ValidationRule::Required));
        }
        // Everything is read before the panel opens: a call that cannot be exported fails first.
        let scope = args.scope.clone().unwrap_or(ShareScope {
            sections: vec![],
            item_ids: vec![],
            include_unreviewed: true,
        });
        let mut files: Vec<(String, Content)> = vec![];
        for id in &args.call_ids {
            let facts = self.call_facts(id.as_str())?;
            let base = slug(&facts.title, id.as_str());
            // @cpt-end:cpt-noter-flow-core-items-today-share:p1:inst-share-request
            // @cpt-begin:cpt-noter-flow-core-items-today-share:p1:inst-share-fail
            if want.audio && !facts.audio_kept {
                return Err(CoreError::new(
                    ErrorCode::AudioDeleted,
                    "the audio is no longer kept",
                ));
            }
            // @cpt-end:cpt-noter-flow-core-items-today-share:p1:inst-share-fail
            // @cpt-begin:cpt-noter-flow-core-items-today-share:p1:inst-share-export
            if want.summary_and_items {
                let outputs = self.outputs_for_share(id)?;
                let shared = render(&outputs, &scope, ShareFormat::Markdown)?;
                files.push((format!("{base}.md"), Content::Text(shared.markdown)));
            }
            // A scope names sections and items: the transcript and audio are not part of it.
            if args.scope.is_none() && want.transcript {
                let segments = self.store().read(|c| segments_of(c, id, None))?;
                let json = serde_json::to_string_pretty(&segments).map_err(internal)?;
                files.push((format!("{base}.srt"), Content::Text(srt(&segments))));
                files.push((format!("{base}.json"), Content::Text(json)));
            }
            if args.scope.is_none() && want.audio {
                for track in ["mic", "sys"] {
                    let from = self
                        .audio_dir
                        .join(id.as_str())
                        .join(format!("{track}.m4a"));
                    if from.is_file() {
                        files.push((format!("{base}-{track}.m4a"), Content::Copy(from)));
                    }
                }
            }
            // @cpt-end:cpt-noter-flow-core-items-today-share:p1:inst-share-export
        }
        // @cpt-begin:cpt-noter-flow-core-items-today-share:p1:inst-share-panel
        let panel = self
            .deps
            .native_ops
            .save_panel("Noter export", SaveKind::Folder)
            .await;
        let Some(folder) = panel else {
            return Err(CoreError::new(ErrorCode::Cancelled, "export cancelled"));
        };
        // @cpt-end:cpt-noter-flow-core-items-today-share:p1:inst-share-panel
        // @cpt-begin:cpt-noter-flow-core-items-today-share:p1:inst-share-return
        // shortcut: a file that is already there is overwritten, and a failed write leaves the
        // files before it; stage in a temporary folder when exports grow large.
        write_all(&folder, &files).map_err(|e| {
            CoreError::new(ErrorCode::Internal, format!("cannot write the export: {e}"))
        })?;
        Ok(ExportResult {
            path: folder.display().to_string(),
            files: files.len() as u32,
        })
        // @cpt-end:cpt-noter-flow-core-items-today-share:p1:inst-share-return
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use noter_protocol::*;

    fn chip(name: &str) -> PersonChip {
        PersonChip {
            id: PersonId::new("per_1"),
            display_name: name.into(),
            short_name: name.into(),
            initials: "A".into(),
            is_you: false,
        }
    }

    fn item(id: &str, text: &str, review: ReviewState) -> ItemView {
        ItemView {
            id: ItemId::new(id),
            rev: Rev(1),
            call: CallRef {
                id: CallId::new("call_1"),
                title: "Planning".into(),
                started_at: TimestampMs(0),
                call_type: CallTypeId("planning".into()),
            },
            kind: ItemKind::ActionItem,
            text: text.into(),
            lang: Lang::En,
            owner: Some(chip("Anna")),
            due: Some(LocalDate("2026-10-16".into())),
            status: ItemStatus::Open,
            review,
            created_by: CreatedBy::Llm,
            topic: None,
            is_engineering: false,
            linked_issue: None,
            spans: vec![TimeSpan {
                call_id: CallId::new("call_1"),
                channel: None,
                t0_ms: OffsetMs(83_000),
                t1_ms: OffsetMs(90_000),
            }],
            handoff: None,
            closed_by: None,
            done_at: None,
            owed: Owed::Other,
            carried_from: None,
            edited: false,
        }
    }

    fn section(kind: SectionKind, state: SectionState) -> OutputSection {
        OutputSection {
            kind,
            state,
            summary_id: None,
            rev: None,
            body_md: None,
            items: vec![],
            reviews: vec![],
            writer: None,
            user_edited: false,
            regenerated_with_edits: false,
            version_count: 1,
        }
    }

    fn outputs(sections: Vec<OutputSection>) -> CallOutputs {
        CallOutputs {
            call_id: CallId::new("call_1"),
            status: OutputsStatus::Ready,
            sections,
            archive: ArchiveStatus::Done,
            review_waiting: 0,
            sensitive: false,
            written_locally: false,
        }
    }

    fn all() -> ShareScope {
        ShareScope {
            sections: vec![],
            item_ids: vec![],
            include_unreviewed: false,
        }
    }

    fn call() -> CallOutputs {
        let mut summary = section(SectionKind::Summary, SectionState::Ready);
        summary.body_md = Some("We **agreed** to ship <script>x</script> & go.".into());
        let mut actions = section(SectionKind::ActionItems, SectionState::Ready);
        actions.items = vec![
            item("itm_1", "Ship *the* importer [now]", ReviewState::Accepted),
            item("itm_2", "Rejected idea", ReviewState::Rejected),
        ];
        outputs(vec![summary, actions])
    }

    #[test]
    fn markdown_has_owner_date_link_and_escapes_markup() {
        let r = render(&call(), &all(), ShareFormat::Markdown).unwrap();
        assert!(r.text.contains("## Action items"), "{}", r.text);
        assert!(
            r.text.contains(r"Ship \*the\* importer \[now\]"),
            "{}",
            r.text
        );
        assert!(r.text.contains("Anna"), "{}", r.text);
        assert!(r.text.contains("2026-10-16"), "{}", r.text);
        assert!(
            r.text.contains("(noter://call/call_1?t=83000)"),
            "{}",
            r.text
        );
        assert_eq!((r.sections, r.items, r.unreviewed), (2, 1, 0));
    }

    #[test]
    fn rejected_items_are_never_included() {
        for f in [ShareFormat::Slack, ShareFormat::Jira, ShareFormat::Markdown] {
            let r = render(&call(), &all(), f).unwrap();
            assert!(!r.text.contains("Rejected idea"), "{f:?}: {}", r.text);
            assert!(!r.html.contains("Rejected idea"));
        }
    }

    #[test]
    fn raw_html_never_reaches_any_form() {
        for f in [ShareFormat::Slack, ShareFormat::Jira, ShareFormat::Markdown] {
            let r = render(&call(), &all(), f).unwrap();
            for out in [&r.text, &r.markdown, &r.html] {
                assert!(!out.contains("<script>"), "{f:?}: {out}");
            }
        }
        let r = render(&call(), &all(), ShareFormat::Markdown).unwrap();
        assert!(r.html.contains("&lt;script&gt;"), "{}", r.html);
        assert!(r.html.contains("<h2>Action items</h2>"), "{}", r.html);
        assert!(r.html.contains("<strong>agreed</strong>"), "{}", r.html);
    }

    #[test]
    fn slack_and_jira_use_their_own_markup() {
        let slack = render(&call(), &all(), ShareFormat::Slack).unwrap().text;
        assert!(slack.contains("*Action items*"), "{slack}");
        assert!(slack.contains("*agreed*"), "{slack}");
        assert!(slack.contains("&lt;script&gt;"), "{slack}");
        assert!(
            slack.contains("<noter://call/call_1?t=83000|1:23>"),
            "{slack}"
        );
        assert!(slack.contains("• "), "{slack}");
        let jira = render(&call(), &all(), ShareFormat::Jira).unwrap().text;
        assert!(jira.contains("h2. Action items"), "{jira}");
        assert!(
            jira.contains("[1:23|noter://call/call_1?t=83000]"),
            "{jira}"
        );
        assert!(jira.contains(r"\[now\]"), "{jira}");
        assert!(jira.contains("* "), "{jira}");
    }

    #[test]
    fn a_scope_of_sections_renders_only_those() {
        let scope = ShareScope {
            sections: vec![SectionKind::Summary],
            ..all()
        };
        let r = render(&call(), &scope, ShareFormat::Markdown).unwrap();
        assert!(!r.text.contains("Action items"), "{}", r.text);
        assert_eq!((r.sections, r.items), (1, 0));
    }

    #[test]
    fn a_scope_of_items_renders_only_those_items() {
        let mut c = call();
        c.sections[1]
            .items
            .push(item("itm_3", "Second one", ReviewState::Accepted));
        let scope = ShareScope {
            item_ids: vec![ItemId::new("itm_3")],
            ..all()
        };
        let r = render(&c, &scope, ShareFormat::Markdown).unwrap();
        assert!(r.text.contains("Second one") && !r.text.contains("importer"));
        assert_eq!(r.items, 1);
    }

    #[test]
    fn an_item_outside_the_scope_is_invalid_input() {
        let scope = ShareScope {
            sections: vec![SectionKind::Summary],
            item_ids: vec![ItemId::new("itm_1")],
            ..all()
        };
        let e = render(&call(), &scope, ShareFormat::Markdown)
            .err()
            .unwrap();
        assert_eq!(e.code, ErrorCode::InvalidInput);
        let e = render(
            &call(),
            &ShareScope {
                item_ids: vec![ItemId::new("itm_nope")],
                ..all()
            },
            ShareFormat::Markdown,
        )
        .err()
        .unwrap();
        assert_eq!(e.code, ErrorCode::InvalidInput);
    }

    #[test]
    fn unreviewed_items_are_guarded_then_marked() {
        let mut c = call();
        c.sections[1]
            .items
            .push(item("itm_4", "Maybe this", ReviewState::Suggested));
        let e = render(&c, &all(), ShareFormat::Markdown).err().unwrap();
        assert_eq!(e.code, ErrorCode::UnreviewedInScope);
        let scope = ShareScope {
            include_unreviewed: true,
            ..all()
        };
        let r = render(&c, &scope, ShareFormat::Markdown).unwrap();
        assert!(r.text.contains("Not reviewed"), "{}", r.text);
        assert_eq!((r.items, r.unreviewed), (2, 1));
    }

    #[test]
    fn nothing_ready_is_outputs_not_ready() {
        let c = outputs(vec![
            section(SectionKind::Summary, SectionState::Writing),
            section(SectionKind::Decisions, SectionState::Pending),
            section(
                SectionKind::Risks,
                SectionState::Failed {
                    code: ErrorCode::Internal,
                    local_fallback_available: false,
                },
            ),
        ]);
        let e = render(&c, &all(), ShareFormat::Markdown).err().unwrap();
        assert_eq!(e.code, ErrorCode::OutputsNotReady);
    }

    #[test]
    fn a_section_that_is_still_writing_is_left_out_of_a_whole_call_copy() {
        let mut c = call();
        c.sections
            .push(section(SectionKind::Risks, SectionState::Writing));
        let r = render(&c, &all(), ShareFormat::Markdown).unwrap();
        assert_eq!(r.sections, 2);
    }
}
