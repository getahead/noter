//! FEATURE cpt-noter-feature-core-items-today (slice 1): the item commands, their state
//! machine, evidence spans and the change log behind them.

use std::path::Path;
use std::sync::{Arc, Mutex};

use noter_core::{Clock, Core, CoreDeps, EventEmitter};
use noter_db::Insert;
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

const NOW: i64 = 1_792_137_600_000;
const STARTED: i64 = NOW - 3_600_000;

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

impl Events {
    fn named(&self, name: &str) -> Vec<Value> {
        let mut all = self.0.lock().unwrap();
        let (taken, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut *all)
            .into_iter()
            .partition(|(e, _)| *e == name);
        *all = kept;
        taken.into_iter().map(|(_, p)| p).collect()
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(NOW)
    }
}

fn open(dir: &Path) -> (Core, Arc<Events>) {
    let events = Arc::new(Events::default());
    let deps = CoreDeps::new(Arc::new(FixedClock), events.clone());
    (Core::open(dir, deps).expect("core opens"), events)
}

fn ctx() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

/// Plain SQL beside the core, for state the commands cannot reach yet (owners, closed items).
fn exec(dir: &Path, sql: &str) {
    noter_db::rusqlite::Connection::open(dir.join("noter.db"))
        .unwrap()
        .execute_batch(sql)
        .unwrap();
}

fn row(table: &'static str, values: &[(&'static str, Value)]) -> Insert {
    Insert {
        table,
        values: values.to_vec(),
    }
}

fn call(id: &str, started: i64) -> Insert {
    row(
        "calls",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("started_at", json!(started)),
            ("ended_at", json!(started + 600_000)),
            ("title", json!(format!("Call {id}"))),
            ("call_type", json!("planning")),
            ("status", json!("ready")),
            ("mode_used", json!("cloud_redacted")),
        ],
    )
}

fn item(id: &str, call_id: &str, kind: &str, status: &str, review: &str) -> Insert {
    row(
        "items",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("call_id", json!(call_id)),
            ("kind", json!(kind)),
            ("text", json!(format!("Text of {id}"))),
            ("lang", json!("en")),
            ("status", json!(status)),
            ("review_state", json!(review)),
            ("created_by", json!("llm")),
            ("is_engineering", json!(0)),
        ],
    )
}

fn span(item_id: &str, call_id: &str, t0: i64, t1: i64) -> Insert {
    row(
        "item_spans",
        &[
            ("item_id", json!(item_id)),
            ("call_id", json!(call_id)),
            ("t0_ms", json!(t0)),
            ("t1_ms", json!(t1)),
        ],
    )
}

fn segment(id: &str, call_id: &str, t0: i64, t1: i64, text: &str) -> Insert {
    row(
        "segments",
        &[
            ("id", json!(id)),
            ("call_id", json!(call_id)),
            ("channel", json!("sys")),
            ("t0_ms", json!(t0)),
            ("t1_ms", json!(t1)),
            ("text", json!(text)),
            ("text_norm", json!(text.to_lowercase())),
            ("pass", json!("live")),
        ],
    )
}

fn speaker(id: &str, call_id: &str, label: &str, person: &str) -> Insert {
    row(
        "speakers",
        &[
            ("id", json!(id)),
            ("call_id", json!(call_id)),
            ("label", json!(label)),
            ("channel", json!("sys")),
            ("person_id", json!(person)),
            ("named_by", json!("you")),
            ("pass", json!("live")),
        ],
    )
}

fn world(core: &Core) {
    core.store()
        .insert_batch(vec![
            call("call_a", STARTED),
            call("call_b", STARTED - 86_400_000),
            speaker("spk_anna", "call_a", "Anna Koval", "per_anna"),
            item("itm_1", "call_a", "action_item", "open", "suggested"),
            item("itm_2", "call_a", "decision", "open", "accepted"),
            item("itm_3", "call_a", "open_question", "open", "suggested"),
            item("itm_4", "call_a", "risk", "open", "rejected"),
            item("itm_5", "call_b", "action_item", "done", "accepted"),
            item(
                "itm_hand",
                "call_a",
                "action_item",
                "handed_off",
                "accepted",
            ),
            span("itm_1", "call_a", 10_000, 20_000),
            segment("seg_1", "call_a", 9_000, 15_000, "Anna will draft the spec"),
            segment("seg_2", "call_a", 15_000, 21_000, "by Friday"),
            segment("seg_3", "call_a", 90_000, 95_000, "unrelated"),
        ])
        .unwrap();
}

fn page(filter: ItemFilter, limit: Option<u32>, cursor: Option<Cursor>) -> ItemsListArgs {
    ItemsListArgs {
        filter,
        page: PageRequest { cursor, limit },
    }
}

async fn list(core: &Core, filter: ItemFilter) -> Vec<ItemView> {
    core.items_list(&ctx(), page(filter, None, None))
        .await
        .unwrap()
        .rows
}

async fn get(core: &Core, id: &str) -> Result<ItemDetail, CoreError> {
    core.item_get(
        &ctx(),
        ItemIdArgs {
            item_id: ItemId::new(id),
        },
    )
    .await
}

async fn view(core: &Core, id: &str) -> ItemView {
    get(core, id).await.unwrap().item
}

async fn done(core: &Core, id: &str, rev: u32, done: bool) -> Result<ItemMutation, CoreError> {
    core.item_set_done(
        &ctx(),
        ItemDoneArgs {
            item_id: ItemId::new(id),
            rev: Rev(rev),
            done,
        },
    )
    .await
}

async fn review(
    core: &Core,
    id: &str,
    rev: u32,
    decision: ReviewDecision,
) -> Result<ItemMutation, CoreError> {
    core.item_review(
        &ctx(),
        ItemReviewArgs {
            item_id: ItemId::new(id),
            rev: Rev(rev),
            decision,
        },
    )
    .await
}

async fn edit(
    core: &Core,
    id: &str,
    rev: u32,
    patch: ItemPatch,
) -> Result<ItemMutation, CoreError> {
    core.item_edit(
        &ctx(),
        ItemEditArgs {
            item_id: ItemId::new(id),
            rev: Rev(rev),
            patch,
        },
    )
    .await
}

async fn reopen(core: &Core, id: &str, rev: u32) -> Result<ItemMutation, CoreError> {
    core.item_reopen(
        &ctx(),
        ItemReopenArgs {
            item_id: ItemId::new(id),
            rev: Rev(rev),
        },
    )
    .await
}

async fn answer(
    core: &Core,
    id: &str,
    rev: u32,
    answer: HandoffLandedAnswer,
) -> Result<ItemMutation, CoreError> {
    core.item_answer_handoff_landed(
        &ctx(),
        HandoffLandedArgs {
            item_id: ItemId::new(id),
            rev: Rev(rev),
            answer,
        },
    )
    .await
}

async fn review_all(
    core: &Core,
    call_id: &str,
    kinds: Vec<ItemKind>,
) -> Result<ItemsBatchResult, CoreError> {
    core.items_review_all(
        &ctx(),
        ReviewAllArgs {
            call_id: CallId::new(call_id),
            kinds,
        },
    )
    .await
}

async fn undo(core: &Core, target: UndoTarget) -> UndoResult {
    core.change_undo(&ctx(), UndoArgs { target }).await.unwrap()
}

fn change(id: &ChangeId) -> UndoTarget {
    UndoTarget::Change {
        change_id: id.clone(),
    }
}

async fn history(core: &Core, id: &str) -> Vec<ChangeRow> {
    core.history_list(
        &ctx(),
        HistoryListArgs {
            target: HistoryTarget::Item {
                item_id: ItemId::new(id),
            },
            actor: ActorFilter::All,
            job_id: None,
            from: None,
            to: None,
            page: PageRequest {
                cursor: None,
                limit: None,
            },
        },
    )
    .await
    .unwrap()
    .rows
}

/// The validation field a refused command names.
fn refused(e: &CoreError) -> String {
    assert_eq!(e.code, ErrorCode::InvalidInput, "{e:?}");
    match &e.detail {
        Some(ErrorDetail::Validation { field, .. }) => field.clone(),
        other => panic!("no validation detail: {other:?}"),
    }
}

fn ids(rows: &[ItemView]) -> Vec<&str> {
    rows.iter().map(|i| i.id.as_str()).collect()
}

// ── read ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn items_list_filters_by_call_kind_status_review_and_due() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    exec(
        dir.path(),
        "UPDATE items SET due_date = '2026-10-17' WHERE id = 'itm_2'",
    );

    assert_eq!(list(&core, ItemFilter::default()).await.len(), 6);
    let f = ItemFilter {
        call_id: Some(CallId::new("call_b")),
        ..Default::default()
    };
    assert_eq!(ids(&list(&core, f).await), ["itm_5"]);
    let f = ItemFilter {
        kinds: vec![ItemKind::Decision, ItemKind::Risk],
        ..Default::default()
    };
    assert_eq!(ids(&list(&core, f).await), ["itm_2", "itm_4"]);
    let f = ItemFilter {
        statuses: vec![ItemStatus::Done],
        ..Default::default()
    };
    assert_eq!(ids(&list(&core, f).await), ["itm_5"]);
    let f = ItemFilter {
        reviews: vec![ReviewState::Suggested],
        ..Default::default()
    };
    assert_eq!(ids(&list(&core, f).await), ["itm_1", "itm_3"]);
    let f = ItemFilter {
        due_before: Some(LocalDate("2026-10-18".into())),
        ..Default::default()
    };
    assert_eq!(ids(&list(&core, f).await), ["itm_2"]);
    let f = ItemFilter {
        due_before: Some(LocalDate("soon".into())),
        ..Default::default()
    };
    let bad = core
        .items_list(&ctx(), page(f, None, None))
        .await
        .unwrap_err();
    assert_eq!(refused(&bad), "filter.due_before");
}

#[tokio::test]
async fn items_list_pages_are_stable_and_complete_views() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);

    let mut seen: Vec<String> = vec![];
    let mut cursor = None;
    loop {
        let p = core
            .items_list(&ctx(), page(ItemFilter::default(), Some(2), cursor))
            .await
            .unwrap();
        assert_eq!(p.total, Some(6));
        seen.extend(p.rows.iter().map(|i| i.id.as_str().to_string()));
        cursor = p.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    // Newest call first, then the item id.
    assert_eq!(
        seen,
        ["itm_1", "itm_2", "itm_3", "itm_4", "itm_hand", "itm_5"]
    );
    let first = list(&core, ItemFilter::default()).await.remove(0);
    assert_eq!(first.call.id.as_str(), "call_a");
    assert_eq!(first.call.title, "Call call_a");
    assert_eq!(first.spans.len(), 1);
    assert_eq!(first.spans[0].t0_ms, OffsetMs(10_000));
    assert_eq!(first.owed, Owed::Other);
    assert!(!first.edited);
    assert!(first.topic.is_none());

    let bad = core
        .items_list(
            &ctx(),
            page(ItemFilter::default(), None, Some(Cursor("nope".into()))),
        )
        .await
        .unwrap_err();
    assert_eq!(refused(&bad), "page.cursor");
}

#[tokio::test]
async fn item_get_resolves_evidence_spans_to_current_transcript_words() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);

    let detail = get(&core, "itm_1").await.unwrap();
    assert_eq!(detail.item.id.as_str(), "itm_1");
    assert_eq!(detail.evidence.len(), 1);
    let evidence = &detail.evidence[0];
    assert_eq!(evidence.source, EvidenceSource::Call);
    assert_eq!(evidence.span.as_ref().unwrap().t1_ms, OffsetMs(20_000));
    assert_eq!(evidence.summary, "Anna will draft the spec by Friday");
    assert!(detail.history.is_empty());

    // A span that overlaps no segment any more still resolves, with no words.
    core.store()
        .insert_batch(vec![span("itm_1", "call_a", 300_000, 310_000)])
        .unwrap();
    assert_eq!(get(&core, "itm_1").await.unwrap().evidence.len(), 2);

    assert_eq!(
        get(&core, "itm_nope").await.unwrap_err().code,
        ErrorCode::NotFound
    );
}

#[tokio::test]
async fn item_owner_chip_comes_from_the_named_speaker() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    exec(
        dir.path(),
        "UPDATE items SET owner_person_id = 'per_anna' WHERE id = 'itm_1'",
    );
    let item = view(&core, "itm_1").await;
    let owner = item.owner.unwrap();
    assert_eq!(owner.id.as_str(), "per_anna");
    assert_eq!(owner.display_name, "Anna Koval");
    assert_eq!(owner.initials, "AK");
    assert_eq!(item.owed, Owed::ToYou);
}

// ── tick ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ticking_a_suggestion_accepts_and_completes_it_and_undo_restores_both() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    world(&core);

    let ticked = done(&core, "itm_1", 1, true).await.unwrap();
    assert_eq!(ticked.item.status, ItemStatus::Done);
    assert_eq!(ticked.item.review, ReviewState::Accepted);
    assert_eq!(ticked.item.rev, Rev(2));
    assert_eq!(ticked.item.done_at, Some(TimestampMs(NOW)));
    let published = events.named(event_names::ENTITY_CHANGED);
    assert_eq!(published.len(), 1);
    assert_eq!(published[0]["type"], "item");
    assert_eq!(published[0]["item"]["status"], "done");

    // The wanted state is already there: no second effect.
    let again = done(&core, "itm_1", 2, true).await.unwrap();
    assert_eq!(again.item.rev, Rev(2));
    assert_eq!(again.change_id, ticked.change_id);
    assert_eq!(history(&core, "itm_1").await.len(), 1);

    assert_eq!(undo(&core, change(&ticked.change_id)).await.undone, 1);
    let back = view(&core, "itm_1").await;
    assert_eq!(back.status, ItemStatus::Open);
    assert_eq!(back.review, ReviewState::Suggested);
    assert_eq!(back.done_at, None);
    assert_eq!(back.rev, Rev(3));
    assert_eq!(events.named(event_names::ENTITY_CHANGED).len(), 1);
}

#[tokio::test]
async fn unticking_returns_a_done_item_to_open_and_keeps_its_review() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    let open_again = done(&core, "itm_5", 1, false).await.unwrap().item;
    assert_eq!(open_again.status, ItemStatus::Open);
    assert_eq!(open_again.review, ReviewState::Accepted);
}

#[tokio::test]
async fn a_stale_tick_is_a_conflict_that_names_the_current_rev_and_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    world(&core);
    done(&core, "itm_1", 1, true).await.unwrap();
    events.named(event_names::ENTITY_CHANGED);

    let stale = done(&core, "itm_1", 1, false).await.unwrap_err();
    assert_eq!(stale.code, ErrorCode::Conflict);
    assert_eq!(
        stale.detail,
        Some(ErrorDetail::Conflict {
            current_rev: Rev(2)
        })
    );
    assert_eq!(view(&core, "itm_1").await.status, ItemStatus::Done);
    assert_eq!(history(&core, "itm_1").await.len(), 1);
    assert!(events.named(event_names::ENTITY_CHANGED).is_empty());
}

#[tokio::test]
async fn a_tick_refuses_rejected_and_handed_off_items_and_unknown_ids() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    // A handed-off row asks "did it land" instead (D75); a rejected one is restored first.
    assert_eq!(
        refused(&done(&core, "itm_hand", 1, true).await.unwrap_err()),
        "status"
    );
    assert_eq!(
        refused(&done(&core, "itm_4", 1, true).await.unwrap_err()),
        "review"
    );
    assert_eq!(
        refused(&done(&core, "itm_2", 1, false).await.unwrap_err()),
        "status"
    );
    assert_eq!(
        done(&core, "itm_nope", 1, true).await.unwrap_err().code,
        ErrorCode::NotFound
    );
    assert_eq!(view(&core, "itm_hand").await.rev, Rev(1));
}

// ── review ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn review_accepts_rejects_and_restores_without_touching_status() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);

    let accepted = review(&core, "itm_1", 1, ReviewDecision::Accept)
        .await
        .unwrap();
    assert_eq!(accepted.item.review, ReviewState::Accepted);
    assert_eq!(accepted.item.status, ItemStatus::Open);
    let rejected = review(&core, "itm_3", 1, ReviewDecision::Reject)
        .await
        .unwrap();
    assert_eq!(rejected.item.review, ReviewState::Rejected);
    let restored = review(&core, "itm_3", 2, ReviewDecision::Restore)
        .await
        .unwrap();
    assert_eq!(restored.item.review, ReviewState::Suggested);
    assert_eq!(restored.item.rev, Rev(3));

    // An accepted row is not rejected from the review row; only a rejected row is restored.
    for (id, decision) in [
        ("itm_2", ReviewDecision::Reject),
        ("itm_2", ReviewDecision::Restore),
        ("itm_4", ReviewDecision::Accept),
    ] {
        let e = review(&core, id, 1, decision).await.unwrap_err();
        assert_eq!(refused(&e), "review");
    }
    let stale = review(&core, "itm_1", 1, ReviewDecision::Reject)
        .await
        .unwrap_err();
    assert_eq!(stale.code, ErrorCode::Conflict);
}

#[tokio::test]
async fn undoing_a_review_restores_the_review_state_and_bumps_rev() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    let accepted = review(&core, "itm_1", 1, ReviewDecision::Accept)
        .await
        .unwrap();
    undo(&core, change(&accepted.change_id)).await;
    let back = view(&core, "itm_1").await;
    assert_eq!(back.review, ReviewState::Suggested);
    assert_eq!(back.status, ItemStatus::Open);
    assert_eq!(back.rev, Rev(3));
}

#[tokio::test]
async fn review_all_accepts_the_suggested_rows_as_one_batch_and_counts_the_rest() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    world(&core);

    let result = review_all(&core, "call_a", vec![]).await.unwrap();
    assert_eq!(ids(&result.items), ["itm_1", "itm_3"]);
    assert!(result
        .items
        .iter()
        .all(|i| i.review == ReviewState::Accepted && i.rev == Rev(2)));
    // The accepted decision, the rejected risk and the handed-off action are not suggested.
    assert_eq!(result.skipped, 3);
    assert_eq!(events.named(event_names::ENTITY_CHANGED).len(), 2);
    let batch_id = result.batch_id.expect("a batch id");

    let undone = undo(&core, UndoTarget::Batch { batch_id }).await;
    assert_eq!(undone.undone, 2);
    for id in ["itm_1", "itm_3"] {
        let back = view(&core, id).await;
        assert_eq!(back.review, ReviewState::Suggested);
        assert_eq!(back.rev, Rev(3));
    }
}

#[tokio::test]
async fn review_all_by_kind_leaves_other_kinds_and_an_empty_selection_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    let only = review_all(&core, "call_a", vec![ItemKind::OpenQuestion])
        .await
        .unwrap();
    assert_eq!(ids(&only.items), ["itm_3"]);
    assert_eq!(view(&core, "itm_1").await.review, ReviewState::Suggested);

    let none = review_all(&core, "call_b", vec![]).await.unwrap();
    assert!(none.items.is_empty());
    assert_eq!(none.batch_id, None);
    assert_eq!(
        review_all(&core, "call_nope", vec![])
            .await
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
}

// ── edit ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn editing_text_keeps_the_generated_wording_for_the_diff() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    let patch = ItemPatch {
        text: Some("  Draft the drawer spec  ".into()),
        ..Default::default()
    };
    let edited = edit(&core, "itm_1", 1, patch).await.unwrap();
    assert_eq!(edited.item.text, "Draft the drawer spec");
    assert!(edited.item.edited);
    assert_eq!(edited.item.rev, Rev(2));
    // Editing alone does not accept; the review row does that next with the new rev.
    assert_eq!(edited.item.review, ReviewState::Suggested);
    let accepted = review(&core, "itm_1", 2, ReviewDecision::Accept)
        .await
        .unwrap();
    assert!(accepted.item.edited);
    // A second edit keeps the first generated text.
    let patch = ItemPatch {
        text: Some("Final".into()),
        ..Default::default()
    };
    edit(&core, "itm_1", 3, patch).await.unwrap();
    let generated: String = core
        .store()
        .read(|c| {
            c.query_row(
                "SELECT generated_text FROM items WHERE id = 'itm_1'",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(generated, "Text of itm_1");
}

#[tokio::test]
async fn editing_sets_and_clears_nullable_fields_explicitly() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    let set = ItemPatch {
        kind: Some(ItemKind::Risk),
        due: Some(OptionalDate::Set {
            date: LocalDate("2026-10-17".into()),
        }),
        owner: Some(OptionalPerson::Set {
            person: PersonRef::Existing {
                person_id: PersonId::new("per_anna"),
            },
        }),
        linked_issue: Some(OptionalText::Set {
            text: "VSTOR-9912".into(),
        }),
        is_engineering: Some(true),
        ..Default::default()
    };
    let after = edit(&core, "itm_1", 1, set).await.unwrap().item;
    assert_eq!(after.kind, ItemKind::Risk);
    assert_eq!(after.due, Some(LocalDate("2026-10-17".into())));
    assert_eq!(after.owner.unwrap().id.as_str(), "per_anna");
    assert_eq!(after.linked_issue.as_deref(), Some("VSTOR-9912"));
    assert!(after.is_engineering);
    assert!(!after.edited);

    let clear = ItemPatch {
        due: Some(OptionalDate::Clear),
        owner: Some(OptionalPerson::Clear),
        linked_issue: Some(OptionalText::Clear),
        ..Default::default()
    };
    let cleared = edit(&core, "itm_1", 2, clear).await.unwrap().item;
    assert_eq!(cleared.due, None);
    assert!(cleared.owner.is_none());
    assert_eq!(cleared.linked_issue, None);
    // An omitted field stays as it is.
    assert_eq!(cleared.kind, ItemKind::Risk);
}

#[tokio::test]
async fn an_invalid_edit_names_its_field_and_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    let owner = |person| ItemPatch {
        owner: Some(OptionalPerson::Set { person }),
        ..Default::default()
    };
    let cases: Vec<(ItemPatch, &str)> = vec![
        (ItemPatch::default(), "patch"),
        (
            ItemPatch {
                text: Some("   ".into()),
                ..Default::default()
            },
            "text",
        ),
        (
            ItemPatch {
                text: Some("x".repeat(1001)),
                ..Default::default()
            },
            "text",
        ),
        (
            ItemPatch {
                due: Some(OptionalDate::Set {
                    date: LocalDate("2026-13-40".into()),
                }),
                ..Default::default()
            },
            "due",
        ),
        (
            owner(PersonRef::Existing {
                person_id: PersonId::new("per_nobody"),
            }),
            "owner",
        ),
        (
            owner(PersonRef::New {
                display_name: "New Person".into(),
                email: None,
            }),
            "owner",
        ),
        (
            ItemPatch {
                linked_issue: Some(OptionalText::Set {
                    text: "not a key".into(),
                }),
                ..Default::default()
            },
            "linked_issue",
        ),
        (
            ItemPatch {
                topic_id: Some(TopicId::new("top_none")),
                ..Default::default()
            },
            "topic_id",
        ),
    ];
    for (patch, field) in cases {
        let e = edit(&core, "itm_1", 1, patch).await.unwrap_err();
        assert_eq!(refused(&e), field);
    }
    let stale = ItemPatch {
        text: Some("ok".into()),
        ..Default::default()
    };
    assert_eq!(
        edit(&core, "itm_1", 9, stale).await.unwrap_err().code,
        ErrorCode::Conflict
    );
    assert_eq!(view(&core, "itm_1").await.rev, Rev(1));
    assert!(history(&core, "itm_1").await.is_empty());
}

// ── reopen ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn reopen_returns_closed_and_handed_off_items_to_open_keeping_review() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    core.store()
        .insert_batch(vec![
            item(
                "itm_ans",
                "call_a",
                "open_question",
                "answered_in_call",
                "accepted",
            ),
            item(
                "itm_ev",
                "call_a",
                "action_item",
                "closed_by_evidence",
                "accepted",
            ),
        ])
        .unwrap();
    exec(
        dir.path(),
        "UPDATE items SET done_at = 5 WHERE id = 'itm_5'",
    );
    for id in ["itm_5", "itm_hand", "itm_ans", "itm_ev"] {
        let opened = reopen(&core, id, 1).await.unwrap().item;
        assert_eq!(opened.status, ItemStatus::Open, "{id}");
        assert_eq!(opened.review, ReviewState::Accepted, "{id}");
        assert_eq!(opened.done_at, None);
        assert_eq!(opened.rev, Rev(2));
    }
    // An open item has nothing to reopen.
    assert_eq!(
        refused(&reopen(&core, "itm_2", 1).await.unwrap_err()),
        "status"
    );
    assert_eq!(
        reopen(&core, "itm_5", 1).await.unwrap_err().code,
        ErrorCode::Conflict
    );
}

// ── create ────────────────────────────────────────────────────────────────────

fn create_args(text: &str) -> ItemCreateArgs {
    ItemCreateArgs {
        call_id: CallId::new("call_a"),
        kind: ItemKind::ActionItem,
        text: text.into(),
        owner: None,
        due: None,
        span: None,
    }
}

fn span_of(call: &str, t0: u32, t1: u32) -> Option<TimeSpan> {
    Some(TimeSpan {
        call_id: CallId::new(call),
        channel: None,
        t0_ms: OffsetMs(t0),
        t1_ms: OffsetMs(t1),
    })
}

#[tokio::test]
async fn creating_an_item_makes_an_accepted_user_item_with_its_span_and_undo_removes_it() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    world(&core);
    let mut a = create_args("  Send the notes  ");
    a.due = Some(LocalDate("2026-10-20".into()));
    a.owner = Some(PersonRef::Existing {
        person_id: PersonId::new("per_anna"),
    });
    a.span = span_of("call_a", 1_000, 5_000);
    let made = core.item_create(&ctx(), a).await.unwrap();
    let item = &made.item;
    assert!(item.id.as_str().starts_with("itm_"));
    assert_eq!(item.text, "Send the notes");
    assert_eq!(item.status, ItemStatus::Open);
    assert_eq!(item.review, ReviewState::Accepted);
    assert_eq!(item.created_by, CreatedBy::User);
    assert_eq!(item.rev, Rev(1));
    assert_eq!(item.due, Some(LocalDate("2026-10-20".into())));
    assert_eq!(item.spans.len(), 1);
    assert_eq!(events.named(event_names::ENTITY_CHANGED).len(), 1);
    assert_eq!(history(&core, item.id.as_str()).await.len(), 1);

    undo(&core, change(&made.change_id)).await;
    assert_eq!(
        get(&core, item.id.as_str()).await.unwrap_err().code,
        ErrorCode::NotFound
    );
}

#[tokio::test]
async fn creating_an_item_validates_text_owner_due_span_and_call() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    let mut cases: Vec<(ItemCreateArgs, &str)> = vec![(create_args(" "), "text")];
    let mut a = create_args("x");
    a.due = Some(LocalDate("tomorrow".into()));
    cases.push((a, "due"));
    let mut a = create_args("x");
    a.owner = Some(PersonRef::Existing {
        person_id: PersonId::new("per_nobody"),
    });
    cases.push((a, "owner"));
    for (t0, t1, call) in [
        (5, 5, "call_a"),
        (9, 3, "call_a"),
        (1, 5, "call_b"),
        (1, 9_999_999, "call_a"),
    ] {
        let mut a = create_args("x");
        a.span = span_of(call, t0, t1);
        cases.push((a, "span"));
    }
    for (args, field) in cases {
        let e = core.item_create(&ctx(), args).await.unwrap_err();
        assert_eq!(refused(&e), field);
    }
    let mut a = create_args("x");
    a.call_id = CallId::new("call_nope");
    assert_eq!(
        core.item_create(&ctx(), a).await.unwrap_err().code,
        ErrorCode::NotFound
    );
    assert_eq!(list(&core, ItemFilter::default()).await.len(), 6);
}

// ── handoff ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_landed_handoff_is_done_and_another_way_says_so_in_history() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    core.store()
        .insert_batch(vec![item(
            "itm_hand2",
            "call_a",
            "action_item",
            "handed_off",
            "accepted",
        )])
        .unwrap();

    let landed = answer(&core, "itm_hand", 1, HandoffLandedAnswer::Landed)
        .await
        .unwrap();
    assert_eq!(landed.item.status, ItemStatus::Done);
    assert_eq!(landed.item.done_at, Some(TimestampMs(NOW)));
    let other = answer(&core, "itm_hand2", 1, HandoffLandedAnswer::DoneAnotherWay)
        .await
        .unwrap();
    assert_eq!(other.item.status, ItemStatus::Done);
    let rows = history(&core, "itm_hand2").await;
    assert!(
        rows[0]
            .reason
            .as_deref()
            .unwrap_or_default()
            .contains("done_another_way"),
        "{:?}",
        rows[0].reason
    );
}

#[tokio::test]
async fn keeping_a_handoff_open_changes_nothing_and_wrong_states_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    world(&core);
    let kept = answer(&core, "itm_hand", 1, HandoffLandedAnswer::KeepOpen)
        .await
        .unwrap();
    assert_eq!(kept.item.status, ItemStatus::HandedOff);
    assert_eq!(kept.item.rev, Rev(1));
    assert!(events.named(event_names::ENTITY_CHANGED).is_empty());
    assert!(history(&core, "itm_hand").await.is_empty());

    assert_eq!(
        answer(&core, "itm_hand", 7, HandoffLandedAnswer::Landed)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
    let e = answer(&core, "itm_2", 1, HandoffLandedAnswer::Landed)
        .await
        .unwrap_err();
    assert_eq!(refused(&e), "status");
}

// ── files ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_committed_change_refreshes_the_calls_items_file() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    done(&core, "itm_1", 1, true).await.unwrap();
    let text = std::fs::read_to_string(dir.path().join("audio/call_a/items.json")).unwrap();
    let items: Value = serde_json::from_str(&text).unwrap();
    let items = items.as_array().unwrap();
    assert_eq!(items.len(), 5);
    let found = items.iter().find(|i| i["id"] == "itm_1").unwrap();
    assert_eq!(found["status"], "done");
}
