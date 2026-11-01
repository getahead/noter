//! Share content: the scope of a call's outputs rendered for Slack, Jira or Markdown
//! (`cpt-noter-algo-core-items-today-format`), as plain text plus the rich forms for the clipboard.

use noter_protocol::error::ValidationRule;
use noter_protocol::model::*;
use noter_protocol::{CoreError, ErrorCode};

use crate::settings::invalid;

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

pub(crate) fn render(
    outputs: &CallOutputs,
    scope: &ShareScope,
    format: ShareFormat,
) -> Result<Rendered, CoreError> {
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
    let ready: Vec<&OutputSection> = chosen
        .into_iter()
        .filter(|s| s.state == SectionState::Ready)
        .collect();
    let picked = |i: &&ItemView| {
        i.review != ReviewState::Rejected
            && (scope.item_ids.is_empty() || scope.item_ids.contains(&i.id))
    };
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
