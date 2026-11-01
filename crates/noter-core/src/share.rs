//! Share content: the scope of a call's outputs rendered for Slack, Jira or Markdown
//! (`cpt-noter-algo-core-items-today-format`), as plain text plus the rich forms for the clipboard.

use noter_protocol::model::*;
use noter_protocol::CoreError;

/// What a scope renders to: the chosen format's text, the Markdown and HTML twins, and the counts.
pub(crate) struct Rendered {
    pub text: String,
    pub markdown: String,
    pub html: String,
    pub sections: u32,
    pub items: u32,
    pub unreviewed: u32,
}

pub(crate) fn render(
    _outputs: &CallOutputs,
    _scope: &ShareScope,
    _format: ShareFormat,
) -> Result<Rendered, CoreError> {
    todo!("share rendering")
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
