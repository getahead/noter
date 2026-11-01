//! FEATURE cpt-noter-feature-core-history-undo (slice 1): `history_list`, `change_undo` and
//! `change_redo` over changes the M0/M1 write path logged, with the events that follow a commit.

use std::path::Path;
use std::sync::{Arc, Mutex};

use noter_core::{Clock, Core, CoreDeps, EventEmitter};
use noter_db::{ChangeMeta, Insert, Mutation};
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

const NOW: i64 = 1_792_137_600_000;

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

fn main_window() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

fn row(table: &'static str, values: &[(&'static str, Value)]) -> Insert {
    Insert {
        table,
        values: values.to_vec(),
    }
}

fn call(id: &str) -> Insert {
    row(
        "calls",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("started_at", json!(NOW - 3_600_000)),
            ("ended_at", json!(NOW - 3_000_000)),
            ("title", json!(format!("Call {id}"))),
            ("call_type", json!("planning")),
            ("status", json!("ready")),
            ("mode_used", json!("cloud_redacted")),
        ],
    )
}

fn seed(core: &Core, ids: &[&str]) {
    core.store()
        .insert_batch(ids.iter().map(|id| call(id)).collect())
        .unwrap();
}

fn meta(summary: &str) -> ChangeMeta {
    ChangeMeta {
        actor: Actor::You,
        summary: summary.into(),
        reason: "test".into(),
        evidence_ids: vec![],
        batch_id: None,
        undoable: true,
        surface: None,
    }
}

fn set_title(id: &str, title: &str) -> Mutation {
    Mutation {
        entity_type: "call",
        table: "calls",
        id: id.into(),
        base_rev: None,
        bump_rev: true,
        values: vec![("title", json!(title))],
    }
}

async fn rename(core: &Core, id: &str, rev: u32, title: &str) -> Result<CallMutation, CoreError> {
    core.call_update(
        &main_window(),
        CallUpdateArgs {
            call_id: CallId::new(id),
            rev: Rev(rev),
            title: Some(title.into()),
            call_type: None,
        },
    )
    .await
}

fn list_args(target: HistoryTarget) -> HistoryListArgs {
    HistoryListArgs {
        target,
        actor: ActorFilter::All,
        job_id: None,
        from: None,
        to: None,
        page: PageRequest {
            cursor: None,
            limit: None,
        },
    }
}

async fn terms(core: &Core) -> usize {
    let list = core.glossary_list(&main_window(), NoArgs {}).await.unwrap();
    list.terms.len()
}

async fn history(core: &Core, args: HistoryListArgs) -> Page<ChangeRow> {
    core.history_list(&main_window(), args).await.unwrap()
}

fn target_change(id: &ChangeId) -> UndoTarget {
    UndoTarget::Change {
        change_id: id.clone(),
    }
}

async fn undo(core: &Core, target: UndoTarget) -> Result<UndoResult, CoreError> {
    core.change_undo(&main_window(), UndoArgs { target }).await
}

async fn redo(core: &Core, target: UndoTarget) -> Result<UndoResult, CoreError> {
    core.change_redo(&main_window(), RedoArgs { target }).await
}

fn title_of(core: &Core, id: &'static str) -> String {
    core.store()
        .read(move |c| c.query_row("SELECT title FROM calls WHERE id = ?1", [id], |r| r.get(0)))
        .unwrap()
}

fn rev_of(core: &Core, id: &'static str) -> u32 {
    core.store()
        .read(move |c| c.query_row("SELECT rev FROM calls WHERE id = ?1", [id], |r| r.get(0)))
        .unwrap()
}

#[tokio::test]
async fn history_lists_the_change_with_who_what_and_whether_it_can_be_reversed() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core, &["call_a"]);
    let done = rename(&core, "call_a", 1, "Planning").await.unwrap();

    let page = history(&core, list_args(HistoryTarget::All)).await;
    assert_eq!(page.rows.len(), 1);
    let change = &page.rows[0];
    assert_eq!(change.id, done.change_id);
    assert_eq!(change.actor, Actor::You);
    assert_eq!(change.entity.kind, EntityKind::Call);
    assert_eq!(change.entity.id, "call_a");
    assert_eq!(change.entity.label, "Planning");
    assert_eq!(change.field.as_deref(), Some("title"));
    assert_eq!(change.before.as_deref(), Some("Call call_a"));
    assert_eq!(change.after.as_deref(), Some("Planning"));
    assert_eq!(change.summary, "Changed call info");
    assert_eq!((change.batch_id.is_none(), change.batch_size), (true, 1));
    assert_eq!(change.status, ChangeStatus::Applied);
    assert!(change.undoable && !change.redoable);
    assert!(page.next_cursor.is_none());

    let other = HistoryTarget::Call {
        call_id: CallId::new("call_other"),
    };
    let none = history(&core, list_args(other)).await;
    assert!(none.rows.is_empty() && none.next_cursor.is_none());
    let mine = HistoryTarget::Call {
        call_id: CallId::new("call_a"),
    };
    assert_eq!(history(&core, list_args(mine)).await.rows.len(), 1);
}

#[tokio::test]
async fn history_pages_newest_first_and_filters_by_actor_job_and_period() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core, &["call_a"]);
    for (n, rev) in (1..=5).zip(1..) {
        rename(&core, "call_a", rev, &format!("T{n}"))
            .await
            .unwrap();
    }
    let mut by_job = meta("Tidied");
    by_job.actor = Actor::Job {
        job_id: JobId::new("job_1"),
        name: "Tidy".into(),
    };
    by_job.reason = "nightly".into();
    core.store()
        .write(set_title("call_a", "By a job"), by_job)
        .unwrap();

    let mut seen = Vec::new();
    let mut cursor = None;
    loop {
        let mut args = list_args(HistoryTarget::All);
        args.page = PageRequest {
            cursor: cursor.clone(),
            limit: Some(2),
        };
        let page = history(&core, args).await;
        assert!(page.rows.len() <= 2);
        seen.extend(page.rows.iter().map(|r| r.after.clone().unwrap()));
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(seen, ["By a job", "T5", "T4", "T3", "T2", "T1"]);

    let mut jobs = list_args(HistoryTarget::All);
    jobs.actor = ActorFilter::Jobs;
    let page = history(&core, jobs.clone()).await;
    assert_eq!(page.rows.len(), 1);
    assert!(matches!(&page.rows[0].actor, Actor::Job { job_id, .. } if job_id.as_str() == "job_1"));
    assert_eq!(page.rows[0].reason.as_deref(), Some("nightly"));
    jobs.job_id = Some(JobId::new("job_2"));
    assert!(history(&core, jobs).await.rows.is_empty());
    let mut you = list_args(HistoryTarget::All);
    you.actor = ActorFilter::You;
    assert_eq!(history(&core, you).await.rows.len(), 5);
    let mut models = list_args(HistoryTarget::All);
    models.actor = ActorFilter::Models;
    assert!(history(&core, models).await.rows.is_empty());

    // Rows are stamped with the wall clock of the run: a period in 1970 is empty.
    let mut old = list_args(HistoryTarget::All);
    old.to = Some(TimestampMs(1));
    assert!(history(&core, old).await.rows.is_empty());
    let mut reversed = list_args(HistoryTarget::All);
    reversed.from = Some(TimestampMs(10));
    reversed.to = Some(TimestampMs(5));
    let err = core
        .history_list(&main_window(), reversed)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
    assert_eq!(
        err.detail,
        Some(ErrorDetail::Validation {
            field: "to".into(),
            rule: ValidationRule::OutOfRange
        })
    );
}

#[tokio::test]
async fn undo_and_redo_much_later_with_the_same_handle_publish_the_whole_call() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    seed(&core, &["call_a"]);
    let done = rename(&core, "call_a", 1, "Renamed").await.unwrap();
    events.named(event_names::ENTITY_CHANGED);
    let handle = target_change(&done.change_id);

    let undone = undo(&core, handle.clone()).await.unwrap();
    assert_eq!(
        undone,
        UndoResult {
            undone: 1,
            skipped_edited_later: 0
        }
    );
    assert_eq!(title_of(&core, "call_a"), "Call call_a");
    assert_eq!(rev_of(&core, "call_a"), 3);
    let sent = events.named(event_names::ENTITY_CHANGED);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["call"]["title"], "Call call_a");
    assert_eq!(sent[0]["call"]["rev"], 3);

    let page = history(&core, list_args(HistoryTarget::All)).await;
    assert_eq!(page.rows[0].status, ChangeStatus::Undone);
    assert!(!page.rows[0].undoable && page.rows[0].redoable);

    // A client still holding the pre-undo revision is told the call changed.
    let stale = rename(&core, "call_a", 2, "Stale").await.unwrap_err();
    assert_eq!(stale.code, ErrorCode::Conflict);

    let redone = redo(&core, handle.clone()).await.unwrap();
    assert_eq!(redone.undone, 1);
    assert_eq!(title_of(&core, "call_a"), "Renamed");
    assert_eq!(rev_of(&core, "call_a"), 4);
    assert_eq!(events.named(event_names::ENTITY_CHANGED).len(), 1);
    let page = history(&core, list_args(HistoryTarget::All)).await;
    assert_eq!(page.rows.len(), 2, "the redo is a new row, the log stays");
    assert_eq!(page.rows[0].status, ChangeStatus::Applied);
    assert!(page.rows[0].undoable && !page.rows[0].redoable);
    assert!(!page.rows[1].redoable, "already redone");

    assert_eq!(
        redo(&core, handle).await.unwrap_err().code,
        ErrorCode::NotUndone
    );
}

#[tokio::test]
async fn a_batch_with_one_row_edited_later_reverses_two_and_counts_one() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    seed(&core, &["call_a", "call_b", "call_c"]);
    let written = core
        .store()
        .write_batch(
            ["call_a", "call_b", "call_c"]
                .iter()
                .map(|id| set_title(id, "Bulk"))
                .collect(),
            meta("Renamed three calls"),
        )
        .unwrap();
    let batch = UndoTarget::Batch {
        batch_id: written[0].batch_id.clone().unwrap(),
    };
    rename(&core, "call_b", 2, "Edited later").await.unwrap();
    events.named(event_names::ENTITY_CHANGED);

    let page = history(&core, list_args(HistoryTarget::All)).await;
    let members: Vec<_> = page.rows.iter().filter(|r| r.batch_id.is_some()).collect();
    assert_eq!(members.len(), 3);
    assert!(members.iter().all(|r| r.batch_size == 3));

    let done = undo(&core, batch.clone()).await.unwrap();
    assert_eq!(
        done,
        UndoResult {
            undone: 2,
            skipped_edited_later: 1
        }
    );
    assert_eq!(title_of(&core, "call_a"), "Call call_a");
    assert_eq!(title_of(&core, "call_b"), "Edited later");
    assert_eq!(title_of(&core, "call_c"), "Call call_c");
    assert_eq!(events.named(event_names::ENTITY_CHANGED).len(), 2);

    // Only the kept row is left, and it was edited later: every target skipped.
    assert_eq!(
        undo(&core, batch.clone()).await.unwrap_err().code,
        ErrorCode::EditedLater
    );
    assert_eq!(redo(&core, batch).await.unwrap().undone, 2);
    assert_eq!(title_of(&core, "call_a"), "Bulk");
}

#[tokio::test]
async fn every_wrong_state_returns_its_typed_error() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core, &["call_a", "call_b"]);
    let done = rename(&core, "call_a", 1, "Renamed").await.unwrap();
    let handle = target_change(&done.change_id);

    let missing = target_change(&ChangeId::new("chg_missing"));
    assert_eq!(
        undo(&core, missing.clone()).await.unwrap_err().code,
        ErrorCode::NotFound
    );
    assert_eq!(
        redo(&core, missing).await.unwrap_err().code,
        ErrorCode::NotFound
    );
    assert_eq!(
        redo(&core, handle.clone()).await.unwrap_err().code,
        ErrorCode::NotUndone
    );
    undo(&core, handle.clone()).await.unwrap();
    assert_eq!(
        undo(&core, handle.clone()).await.unwrap_err().code,
        ErrorCode::AlreadyUndone
    );
    // An edit after the undo blocks the redo and hides Redo.
    rename(&core, "call_a", 3, "Newer").await.unwrap();
    assert_eq!(
        redo(&core, handle).await.unwrap_err().code,
        ErrorCode::EditedLater
    );
    let page = history(&core, list_args(HistoryTarget::All)).await;
    let original = page.rows.iter().find(|r| r.id == done.change_id).unwrap();
    assert!(!original.redoable);

    // Deleting a call is irreversible and its log keeps no content.
    core.calls_delete(
        &main_window(),
        CallsDeleteArgs {
            call_ids: vec![CallId::new("call_a")],
        },
    )
    .await
    .unwrap();
    let page = history(&core, list_args(HistoryTarget::All)).await;
    let tombstone = &page.rows[0];
    assert!(!tombstone.undoable);
    assert_eq!(
        undo(&core, target_change(&tombstone.id))
            .await
            .unwrap_err()
            .code,
        ErrorCode::NotUndoable
    );
    assert!(
        page.rows
            .iter()
            .filter(|r| r.entity.id == "call_a")
            .all(|r| r.before.is_none() && r.after.is_none()),
        "no title of a deleted call comes back through History"
    );
}

#[tokio::test]
async fn a_log_the_core_cannot_read_is_change_log_unreadable() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core, &["call_a"]);
    let raw = noter_db::rusqlite::Connection::open(dir.path().join("noter.db")).unwrap();
    raw.execute(
        "INSERT INTO changes (id, ts, actor, entity_type, entity_id, summary, reason, status)
         VALUES ('chg_odd', 1, 'robot', 'widget', 'w1', 's', 'r', 'applied')",
        [],
    )
    .unwrap();
    let err = core
        .history_list(&main_window(), list_args(HistoryTarget::All))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ChangeLogUnreadable);
}

#[tokio::test]
async fn settings_and_glossary_changes_undo_and_publish_their_own_state() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    let ctx = main_window();
    let settings = core.settings_get(&ctx, NoArgs {}).await.unwrap();
    let mut general = settings.general.clone();
    general.launch_at_login = !general.launch_at_login;
    let updated = core
        .settings_update(
            &ctx,
            SettingsUpdateArgs {
                rev: settings.rev,
                section: SettingsSection::General(general.clone()),
            },
        )
        .await
        .unwrap();
    events.named(event_names::SETTINGS_CHANGED);
    let page = history(&core, list_args(HistoryTarget::All)).await;
    let change = page
        .rows
        .iter()
        .find(|r| r.entity.kind == EntityKind::Setting)
        .unwrap();
    assert!(
        change.undoable && change.before.is_none(),
        "JSON sections are not inline text"
    );

    undo(&core, target_change(&change.id)).await.unwrap();
    let back = core.settings_get(&ctx, NoArgs {}).await.unwrap();
    assert_eq!(back.general, settings.general);
    assert!(
        back.rev.0 > updated.rev.0,
        "the revision moves with the undo"
    );
    assert_eq!(events.named(event_names::SETTINGS_CHANGED).len(), 1);
    redo(&core, target_change(&change.id)).await.unwrap();
    assert_eq!(
        core.settings_get(&ctx, NoArgs {}).await.unwrap().general,
        general
    );

    core.glossary_upsert(
        &ctx,
        GlossaryUpsertArgs {
            id: None,
            rev: None,
            term: "Kubernetes".into(),
            variants_latin: vec![],
            variants_cyrillic: vec![],
            spoken_forms: vec![],
            lang: None,
            always_apply: false,
        },
    )
    .await
    .unwrap();
    let page = history(&core, list_args(HistoryTarget::All)).await;
    let added = page
        .rows
        .iter()
        .find(|r| r.entity.kind == EntityKind::Glossary)
        .unwrap();
    undo(&core, target_change(&added.id)).await.unwrap();
    assert_eq!(terms(&core).await, 0);
    redo(&core, target_change(&added.id)).await.unwrap();
    assert_eq!(terms(&core).await, 1);
}

#[tokio::test]
async fn a_transcript_change_refreshes_the_call_file_and_the_speakers() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    core.store()
        .insert_batch(vec![
            call("call_a"),
            row(
                "speakers",
                &[
                    ("id", json!("spk_1")),
                    ("call_id", json!("call_a")),
                    ("label", json!("spk_1")),
                    ("n", json!(1)),
                    ("channel", json!("sys")),
                    ("pass", json!("live")),
                ],
            ),
            row(
                "segments",
                &[
                    ("id", json!("seg_1")),
                    ("call_id", json!("call_a")),
                    ("speaker_id", json!("spk_1")),
                    ("channel", json!("sys")),
                    ("t0_ms", json!(0)),
                    ("t1_ms", json!(1000)),
                    ("text", json!("kubernets")),
                    ("text_norm", json!("kubernets")),
                    ("pass", json!("live")),
                ],
            ),
        ])
        .unwrap();
    let fixed = core
        .store()
        .write(
            Mutation {
                entity_type: "segment",
                table: "segments",
                id: "seg_1".into(),
                base_rev: None,
                bump_rev: false,
                values: vec![
                    ("text", json!("Kubernetes")),
                    ("text_norm", json!("kubernetes")),
                ],
            },
            meta("Fixed a term"),
        )
        .unwrap();
    let renamed = core
        .store()
        .write(
            Mutation {
                entity_type: "speaker",
                table: "speakers",
                id: "spk_1".into(),
                base_rev: None,
                bump_rev: false,
                values: vec![("label", json!("Dana"))],
            },
            meta("Named a speaker"),
        )
        .unwrap();

    undo(&core, target_change(&fixed.change_id)).await.unwrap();
    let file = dir.path().join("audio/call_a/transcript.jsonl");
    let lines = std::fs::read_to_string(&file).unwrap();
    assert!(lines.contains("kubernets") && !lines.contains("Kubernetes"));

    events.named(event_names::ENTITY_CHANGED);
    undo(&core, target_change(&renamed.change_id))
        .await
        .unwrap();
    let sent = events.named(event_names::ENTITY_CHANGED);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["type"], "speakers");
    assert_eq!(sent[0]["call_id"], "call_a");
    redo(&core, target_change(&fixed.change_id)).await.unwrap();
    assert!(std::fs::read_to_string(&file)
        .unwrap()
        .contains("Kubernetes"));
}
