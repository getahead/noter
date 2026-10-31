//! FEATURE cpt-noter-feature-core-history-undo: undo and redo of logged changes and batches on the
//! single writer, later-edit detection, every wrong-state error and rollback without leftovers.

use std::path::{Path, PathBuf};

use noter_db::rusqlite::Connection;
use noter_db::{
    ChangeMeta, Direction, Handle, Logged, Migration, Mutation, Reversed, Store, MIGRATIONS,
};
use noter_protocol::model::Actor;
use noter_protocol::{BatchId, ChangeId, CoreError, ErrorCode};
use serde_json::{json, Value};

const TABLES: &[Migration] = &[Migration {
    owner: "test",
    version: 1,
    name: "notes",
    sql: "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, body TEXT, pinned INTEGER, rev INTEGER NOT NULL);
          CREATE TABLE calls (id TEXT PRIMARY KEY, title TEXT, rev INTEGER NOT NULL);
          CREATE TABLE segments (id TEXT PRIMARY KEY, call_id TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
                                 start_ms INTEGER NOT NULL, text TEXT NOT NULL);
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
}];

const NOW: i64 = 1_792_137_600_000;

fn path(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().join("Noter").join("noter.db")
}

fn open(path: &Path) -> Store {
    Store::open(path, &[MIGRATIONS, TABLES]).expect("store opens")
}

fn raw(path: &Path) -> Connection {
    Connection::open(path).unwrap()
}

fn meta(reason: &str) -> ChangeMeta {
    ChangeMeta {
        actor: Actor::You,
        summary: "Edited".into(),
        reason: reason.into(),
        evidence_ids: vec![],
        batch_id: None,
        undoable: true,
        surface: None,
    }
}

fn set(id: &str, column: &'static str, value: Value) -> Mutation {
    Mutation {
        entity_type: "note",
        table: "notes",
        id: id.into(),
        base_rev: None,
        bump_rev: true,
        values: vec![(column, value)],
    }
}

fn title(store: &Store, id: &'static str) -> Option<String> {
    store
        .read(move |c| c.query_row("SELECT title FROM notes WHERE id = ?1", [id], |r| r.get(0)))
        .unwrap()
}

fn rev(store: &Store, id: &'static str) -> i64 {
    store
        .read(move |c| c.query_row("SELECT rev FROM notes WHERE id = ?1", [id], |r| r.get(0)))
        .unwrap()
}

fn count(store: &Store, sql: &'static str) -> i64 {
    store
        .read(move |c| c.query_row(sql, [], |r| r.get(0)))
        .unwrap()
}

fn change(id: &impl std::fmt::Display) -> Handle {
    Handle::Change(ChangeId::new(id.to_string()))
}

fn undo(store: &Store, handle: Handle) -> Result<Reversed, CoreError> {
    store.reverse(Direction::Undo, handle, NOW)
}

fn redo(store: &Store, handle: Handle) -> Result<Reversed, CoreError> {
    store.reverse(Direction::Redo, handle, NOW)
}

fn code<T: std::fmt::Debug>(r: Result<T, CoreError>) -> ErrorCode {
    r.expect_err("an error").code
}

/// Three notes titled `a1..a3` written as one batch to `b1..b3`; returns the batch id.
fn batch_of_three(store: &Store) -> BatchId {
    for n in 1..=3 {
        let id = format!("n{n}");
        store
            .write(set(&id, "title", json!(format!("a{n}"))), meta("seed"))
            .unwrap();
    }
    let written = store
        .write_batch(
            (1..=3)
                .map(|n| set(&format!("n{n}"), "title", json!(format!("b{n}"))))
                .collect(),
            meta("batch"),
        )
        .unwrap();
    written[0].batch_id.clone().unwrap()
}

#[test]
fn undo_and_redo_with_the_same_handle_any_number_of_times() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&path(&dir));
    store
        .write(set("n1", "title", json!("old")), meta("seed"))
        .unwrap();
    let edit = store
        .write(set("n1", "title", json!("new")), meta("edit"))
        .unwrap();
    assert_eq!(rev(&store, "n1"), 2);

    let done = undo(&store, change(&edit.change_id)).unwrap();
    assert_eq!((done.done, done.skipped), (1, 0));
    assert_eq!(title(&store, "n1").as_deref(), Some("old"));
    assert_eq!(rev(&store, "n1"), 3, "undo moves the revision");
    assert_eq!(done.touched, vec![("note".to_string(), "n1".to_string())]);

    assert_eq!(
        code(undo(&store, change(&edit.change_id))),
        ErrorCode::AlreadyUndone
    );
    let redone = redo(&store, change(&edit.change_id)).unwrap();
    assert_eq!(redone.done, 1);
    assert_eq!(title(&store, "n1").as_deref(), Some("new"));
    assert_eq!(rev(&store, "n1"), 4);
    // The original stays undone; the new row is applied, linked and keeps reason and actor.
    let rows: Vec<(String, String, Option<String>, String)> = store
        .read(|c| {
            let mut q = c.prepare(
                "SELECT status, reason, redo_of, actor FROM changes WHERE entity_id = 'n1' ORDER BY rowid",
            )?;
            let rows = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
            rows.collect()
        })
        .unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].0, "applied");
    assert_eq!(
        rows[1],
        ("undone".into(), "edit".into(), None, "you".into())
    );
    assert_eq!(
        rows[2],
        (
            "applied".into(),
            "edit".into(),
            Some(edit.change_id.to_string()),
            "you".into()
        )
    );
    assert_eq!(
        code(redo(&store, change(&edit.change_id))),
        ErrorCode::NotUndone
    );

    // The same handle undoes the redo row again, and redoes it again, much later.
    undo(&store, change(&edit.change_id)).unwrap();
    assert_eq!(title(&store, "n1").as_deref(), Some("old"));
    redo(&store, change(&edit.change_id)).unwrap();
    assert_eq!(title(&store, "n1").as_deref(), Some("new"));
}

#[test]
fn a_redo_row_is_a_handle_for_the_same_change() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&path(&dir));
    store
        .write(set("n1", "title", json!("old")), meta("seed"))
        .unwrap();
    let edit = store
        .write(set("n1", "title", json!("new")), meta("edit"))
        .unwrap();
    undo(&store, change(&edit.change_id)).unwrap();
    redo(&store, change(&edit.change_id)).unwrap();
    let redo_row: String = store
        .read(|c| {
            c.query_row(
                "SELECT id FROM changes WHERE redo_of IS NOT NULL",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    undo(&store, change(&redo_row)).unwrap();
    assert_eq!(title(&store, "n1").as_deref(), Some("old"));
}

#[test]
fn an_edit_after_the_change_blocks_undo_and_redo() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&path(&dir));
    let first = store
        .write(set("n1", "title", json!("a")), meta("one"))
        .unwrap();
    store
        .write(set("n1", "title", json!("b")), meta("two"))
        .unwrap();
    assert_eq!(
        code(undo(&store, change(&first.change_id))),
        ErrorCode::EditedLater
    );
    assert_eq!(title(&store, "n1").as_deref(), Some("b"));
    assert_eq!(
        count(
            &store,
            "SELECT count(*) FROM changes WHERE status = 'undone'"
        ),
        0
    );

    let edit = store
        .write(set("n1", "body", json!("x")), meta("three"))
        .unwrap();
    undo(&store, change(&edit.change_id)).unwrap();
    store
        .write(set("n1", "body", json!("y")), meta("four"))
        .unwrap();
    assert_eq!(
        code(redo(&store, change(&edit.change_id))),
        ErrorCode::EditedLater
    );
}

#[test]
fn another_column_of_the_row_is_not_a_later_edit() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&path(&dir));
    store
        .write(set("n1", "title", json!("a")), meta("seed"))
        .unwrap();
    let edit = store
        .write(set("n1", "title", json!("b")), meta("edit"))
        .unwrap();
    store
        .write(set("n1", "body", json!("note")), meta("other column"))
        .unwrap();
    undo(&store, change(&edit.change_id)).unwrap();
    assert_eq!(title(&store, "n1").as_deref(), Some("a"));
}

#[test]
fn a_batch_reverses_what_it_can_and_counts_the_rest() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&path(&dir));
    let batch = batch_of_three(&store);
    store
        .write(set("n2", "title", json!("edited later")), meta("later"))
        .unwrap();

    let done = undo(&store, Handle::Batch(batch.clone())).unwrap();
    assert_eq!((done.done, done.skipped), (2, 1));
    assert_eq!(title(&store, "n1").as_deref(), Some("a1"));
    assert_eq!(title(&store, "n2").as_deref(), Some("edited later"));
    assert_eq!(title(&store, "n3").as_deref(), Some("a3"));
    assert_eq!(
        code(undo(&store, Handle::Batch(batch.clone()))),
        ErrorCode::EditedLater,
        "the kept row is still edited later, the others are undone"
    );

    let redone = redo(&store, Handle::Batch(batch.clone())).unwrap();
    assert_eq!((redone.done, redone.skipped), (2, 0));
    assert_eq!(title(&store, "n1").as_deref(), Some("b1"));
    assert_eq!(title(&store, "n3").as_deref(), Some("b3"));
    // Redo rows keep the batch id.
    assert_eq!(
        count(
            &store,
            "SELECT count(*) FROM changes WHERE batch_id IS NOT NULL AND redo_of IS NOT NULL"
        ),
        2
    );
}

#[test]
fn a_batch_where_every_row_was_edited_later_is_edited_later() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&path(&dir));
    let batch = batch_of_three(&store);
    for n in 1..=3 {
        store
            .write(
                set(&format!("n{n}"), "title", json!("later")),
                meta("later"),
            )
            .unwrap();
    }
    assert_eq!(
        code(undo(&store, Handle::Batch(batch))),
        ErrorCode::EditedLater
    );
    assert_eq!(
        count(
            &store,
            "SELECT count(*) FROM changes WHERE status = 'undone'"
        ),
        0
    );
}

#[test]
fn every_wrong_state_has_its_error() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&path(&dir));
    assert_eq!(
        code(undo(&store, change(&"chg_missing"))),
        ErrorCode::NotFound
    );
    assert_eq!(
        code(redo(&store, Handle::Batch(BatchId::new("bat_missing")))),
        ErrorCode::NotFound
    );

    let edit = store
        .write(set("n1", "title", json!("a")), meta("edit"))
        .unwrap();
    assert_eq!(
        code(redo(&store, change(&edit.change_id))),
        ErrorCode::NotUndone
    );

    // A content-free delete is never undoable.
    let gone = store
        .delete("note", "notes", vec!["n1".into()], meta("delete"))
        .unwrap();
    assert_eq!(
        code(undo(&store, change(&gone[0].1))),
        ErrorCode::NotUndoable
    );

    // A change written as not undoable (capture moves).
    let mut capture = meta("capture");
    capture.undoable = false;
    let moved = store
        .write(set("n2", "title", json!("x")), capture)
        .unwrap();
    assert_eq!(
        code(undo(&store, change(&moved.change_id))),
        ErrorCode::NotUndoable
    );
    assert_eq!(title(&store, "n2").as_deref(), Some("x"));
}

#[test]
fn proposed_and_rejected_rows_are_never_applied() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&path(&dir));
    store
        .write(set("n1", "title", json!("a")), meta("seed"))
        .unwrap();
    let raw = raw(&path(&dir));
    for (id, status) in [("chg_p", "proposed"), ("chg_r", "rejected")] {
        raw.execute(
            "INSERT INTO changes (id, ts, actor, entity_type, entity_id, field, before, after, summary, reason, status, batch_id)
             VALUES (?1, 1, 'you', 'note', 'n1', 'title', 'zzz', 'a', 's', 'r', ?2, 'bat_p')",
            [id, status],
        )
        .unwrap();
    }
    assert_eq!(code(undo(&store, change(&"chg_p"))), ErrorCode::NotUndoable);
    assert_eq!(code(redo(&store, change(&"chg_r"))), ErrorCode::NotUndone);
    assert_eq!(
        code(undo(&store, Handle::Batch(BatchId::new("bat_p")))),
        ErrorCode::NotUndoable
    );
    assert_eq!(title(&store, "n1").as_deref(), Some("a"));
}

#[test]
fn a_failure_part_way_leaves_nothing_restored_and_no_orphan_row() {
    let dir = tempfile::tempdir().unwrap();
    let p = path(&dir);
    let store = open(&p);
    let batch = batch_of_three(&store);

    // The second status move fails: the first restoration must roll back with it.
    let raw = raw(&p);
    raw.execute_batch(
        "CREATE TRIGGER boom_undo BEFORE UPDATE OF status ON changes
         WHEN (SELECT count(*) FROM changes WHERE status = 'undone') = 1
         BEGIN SELECT RAISE(ABORT, 'boom'); END;",
    )
    .unwrap();
    let err = undo(&store, Handle::Batch(batch.clone())).expect_err("fails");
    assert_eq!(err.code, ErrorCode::Internal);
    for (n, id) in ["n1", "n2", "n3"].into_iter().enumerate() {
        assert_eq!(title(&store, id), Some(format!("b{}", n + 1)));
        assert_eq!(rev(&store, id), 2);
    }
    assert_eq!(
        count(
            &store,
            "SELECT count(*) FROM changes WHERE status = 'undone'"
        ),
        0
    );

    // Undo for real, then fail the second appended redo row.
    raw.execute_batch("DROP TRIGGER boom_undo").unwrap();
    undo(&store, Handle::Batch(batch.clone())).unwrap();
    let before = count(&store, "SELECT count(*) FROM changes");
    raw.execute_batch(
        "CREATE TRIGGER boom_redo BEFORE INSERT ON changes
         WHEN NEW.redo_of IS NOT NULL AND (SELECT count(*) FROM changes WHERE redo_of IS NOT NULL) = 1
         BEGIN SELECT RAISE(ABORT, 'boom'); END;",
    )
    .unwrap();
    assert!(redo(&store, Handle::Batch(batch)).is_err());
    assert_eq!(count(&store, "SELECT count(*) FROM changes"), before);
    assert_eq!(title(&store, "n1").as_deref(), Some("a1"));
    assert_eq!(title(&store, "n2").as_deref(), Some("a2"));
}

#[test]
fn created_and_deleted_rows_reverse_both_ways() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&path(&dir));
    store
        .write(
            Mutation {
                entity_type: "call",
                table: "calls",
                id: "c1".into(),
                base_rev: None,
                bump_rev: true,
                values: vec![("title", json!("Call"))],
            },
            meta("call"),
        )
        .unwrap();
    // A new row: several columns, every `before` empty.
    let created = store
        .write(
            Mutation {
                entity_type: "segment",
                table: "segments",
                id: "s1".into(),
                base_rev: None,
                bump_rev: false,
                values: vec![
                    ("call_id", json!("c1")),
                    ("start_ms", json!(5)),
                    ("text", json!("hello")),
                ],
            },
            meta("create"),
        )
        .unwrap();
    let segments = |store: &Store| count(store, "SELECT count(*) FROM segments");
    assert_eq!(segments(&store), 1);
    undo(&store, change(&created.change_id)).unwrap();
    assert_eq!(segments(&store), 0, "undoing a creation removes the row");
    redo(&store, change(&created.change_id)).unwrap();
    assert_eq!(segments(&store), 1);
    let text: String = store
        .read(|c| {
            c.query_row("SELECT text FROM segments WHERE id = 's1'", [], |r| {
                r.get(0)
            })
        })
        .unwrap();
    assert_eq!(text, "hello");

    // A logged delete (every value `[before, null]`) comes back with its values.
    let removal = store
        .write_with(meta("remove"), |tx| {
            tx.execute("DELETE FROM segments WHERE id = 's1'", [])
                .unwrap();
            Ok((
                (),
                vec![Logged {
                    entity_type: "segment",
                    entity_id: "s1".into(),
                    field: None,
                    before: None,
                    after: None,
                    delta: Some(json!({
                        "call_id": ["c1", null], "start_ms": [5, null], "text": ["hello", null]
                    })),
                }],
            ))
        })
        .unwrap();
    assert_eq!(segments(&store), 0);
    undo(&store, change(&removal.change_ids[0])).unwrap();
    assert_eq!(segments(&store), 1);
    redo(&store, change(&removal.change_ids[0])).unwrap();
    assert_eq!(segments(&store), 0);
}

#[test]
fn settings_rows_restore_by_key_and_move_the_settings_revision() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&path(&dir));
    let written = store
        .write_with(meta("settings"), |tx| {
            tx.execute(
                "INSERT INTO settings (key, value) VALUES ('general', '{\"a\":2}'), ('rev', '2')",
                [],
            )
            .unwrap();
            Ok((
                (),
                vec![Logged {
                    entity_type: "setting",
                    entity_id: "settings".into(),
                    field: Some("general".into()),
                    before: Some("{\"a\":1}".into()),
                    after: Some("{\"a\":2}".into()),
                    delta: None,
                }],
            ))
        })
        .unwrap();
    let value = |store: &Store, key: &'static str| -> String {
        store
            .read(move |c| {
                c.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                    r.get(0)
                })
            })
            .unwrap()
    };
    let done = undo(&store, change(&written.change_ids[0])).unwrap();
    assert_eq!(value(&store, "general"), "{\"a\":1}");
    assert_eq!(value(&store, "rev"), "3");
    assert_eq!(
        done.touched,
        vec![("setting".to_string(), "general".to_string())]
    );
    redo(&store, change(&written.change_ids[0])).unwrap();
    assert_eq!(value(&store, "general"), "{\"a\":2}");
    assert_eq!(value(&store, "rev"), "4");
}

#[test]
fn state_the_app_keeps_in_memory_is_not_replayed() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&path(&dir));
    let written = store
        .write_with(meta("hotkeys"), |tx| {
            tx.execute(
                "INSERT INTO settings (key, value) VALUES ('hotkeys', 'b')",
                [],
            )
            .unwrap();
            Ok((
                (),
                vec![Logged {
                    entity_type: "setting",
                    entity_id: "settings".into(),
                    field: Some("hotkeys".into()),
                    before: Some("a".into()),
                    after: Some("b".into()),
                    delta: None,
                }],
            ))
        })
        .unwrap();
    assert!(!noter_db::replayable("setting", Some("hotkeys")));
    assert!(noter_db::replayable("setting", Some("general")));
    assert!(noter_db::replayable("call", None));
    assert_eq!(
        code(undo(&store, change(&written.change_ids[0]))),
        ErrorCode::NotUndoable
    );
}

#[test]
fn a_row_the_log_cannot_describe_is_an_unreadable_log() {
    let dir = tempfile::tempdir().unwrap();
    let p = path(&dir);
    let store = open(&p);
    raw(&p)
        .execute(
            "INSERT INTO changes (id, ts, actor, entity_type, entity_id, summary, reason, status)
             VALUES ('chg_bare', 1, 'you', 'note', 'n1', 's', 'r', 'applied')",
            [],
        )
        .unwrap();
    assert_eq!(
        code(undo(&store, change(&"chg_bare"))),
        ErrorCode::ChangeLogUnreadable
    );
}
