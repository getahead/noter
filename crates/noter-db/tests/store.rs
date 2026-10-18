//! FEATURE cpt-noter-feature-core-storage: open, migrate, write with the change row, read, close.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use noter_db::rusqlite::{Connection, MAIN_DB};
use noter_db::{ChangeMeta, Migration, Mutation, OpenError, Store, StoreState, MIGRATIONS};
use noter_protocol::model::Actor;
use noter_protocol::{ErrorCode, ErrorDetail, EvidenceId, JobId, LlmRunId, Rev, RuntimeChoice};
use serde_json::json;

const NOTES: &[Migration] = &[Migration {
    owner: "test",
    version: 1,
    name: "notes",
    // Not idempotent on purpose: running it twice fails. The trigger forces a failure after the row write.
    sql: "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, body TEXT, rev INTEGER NOT NULL);
          CREATE TRIGGER changes_boom AFTER INSERT ON changes WHEN NEW.reason = 'boom'
          BEGIN SELECT RAISE(ABORT, 'boom'); END;",
}];

fn db_path(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().join("Noter").join("noter.db")
}

fn open(path: &Path) -> Store {
    Store::open(path, &[MIGRATIONS, NOTES]).expect("store opens")
}

fn note(id: &str, base_rev: Option<u32>, title: &str) -> Mutation {
    Mutation {
        entity_type: "note",
        table: "notes",
        id: id.into(),
        base_rev: base_rev.map(Rev),
        values: vec![("title", json!(title))],
    }
}

fn meta(reason: &str) -> ChangeMeta {
    ChangeMeta {
        actor: Actor::You,
        summary: "Renamed the note".into(),
        reason: reason.into(),
        evidence_ids: vec![],
        batch_id: None,
        undoable: true,
    }
}

fn count(store: &Store, sql: &'static str) -> i64 {
    store
        .read(move |c| c.query_row(sql, [], |r| r.get(0)))
        .unwrap()
}

fn raw(path: &Path) -> Connection {
    Connection::open(path).unwrap()
}

#[test]
fn fresh_start_creates_private_file_at_newest_schema() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let store = open(&path);
    assert_eq!(store.state(), StoreState::Ready);
    let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&path), 0o600);
    assert_eq!(mode(path.parent().unwrap()), 0o700);
    assert_eq!(count(&store, "SELECT count(*) FROM schema_migrations"), 2);
    let pragmas = store
        .read_snapshot(|c| {
            let wal: String = c.query_row("PRAGMA journal_mode", [], |r| r.get(0))?;
            let fk: i64 = c.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
            let vacuum: i64 = c.query_row("PRAGMA auto_vacuum", [], |r| r.get(0))?;
            let busy: i64 = c.query_row("PRAGMA busy_timeout", [], |r| r.get(0))?;
            Ok((wal, fk, vacuum, busy))
        })
        .unwrap();
    assert_eq!(pragmas.0, "wal");
    assert_eq!(pragmas.1, 1);
    assert_eq!(pragmas.2, 2, "incremental auto-vacuum");
    assert!(pragmas.3 > 0);
}

#[test]
fn second_start_runs_no_migration() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    open(&path).close();
    let store = open(&path); // NOTES would fail if it ran again
    assert_eq!(count(&store, "SELECT count(*) FROM schema_migrations"), 2);
}

#[test]
fn failed_migration_keeps_the_previous_version_and_accepts_no_writes() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    open(&path).close();
    let bad = &[
        NOTES[0],
        Migration {
            owner: "test",
            version: 2,
            name: "broken",
            sql: "CREATE TABLE half (x INTEGER); SELECT * FROM missing_table;",
        },
    ];
    let err = Store::open(&path, &[MIGRATIONS, bad])
        .err()
        .expect("migration fails");
    assert!(
        matches!(
            err,
            OpenError::Migration {
                owner: "test",
                version: 2,
                ..
            }
        ),
        "{err:?}"
    );
    let c = raw(&path);
    let half: i64 = c
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name = 'half'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(half, 0, "the failed migration rolled back");
    let max: i64 = c
        .query_row(
            "SELECT max(version) FROM schema_migrations WHERE owner = 'test'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(max, 1);
}

#[test]
fn schema_ahead_of_the_binary_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    open(&path).close();
    let err = Store::open(&path, &[MIGRATIONS])
        .err()
        .expect("schema ahead");
    assert!(
        matches!(err, OpenError::SchemaAhead { ref owner, version: 1 } if owner == "test"),
        "{err:?}"
    );
}

#[test]
fn migrations_out_of_order_or_duplicated_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let twice = &[NOTES[0], NOTES[0]];
    let err = Store::open(&path, &[MIGRATIONS, twice])
        .err()
        .expect("invalid set");
    assert!(matches!(err, OpenError::InvalidMigrations(_)), "{err:?}");
}

#[test]
fn a_corrupt_file_fails_the_open() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, vec![0x5a; 8192]).unwrap();
    let err = Store::open(&path, &[MIGRATIONS]).err().expect("corrupt");
    assert!(matches!(err, OpenError::Corrupt(_)), "{err:?}");
}

#[test]
fn a_damaged_page_fails_the_quick_check() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    {
        let store = open(&path);
        for i in 0..200 {
            store
                .write(
                    note(&format!("not_{i:03}"), None, &"x".repeat(200)),
                    meta("seed"),
                )
                .unwrap();
        }
        store.close();
    }
    let mut bytes = std::fs::read(&path).unwrap();
    let page = 4096;
    let last = bytes.len() / page - 1;
    for b in &mut bytes[last * page + 8..(last + 1) * page] {
        *b = 0xff;
    }
    std::fs::write(&path, bytes).unwrap();
    let err = Store::open(&path, &[MIGRATIONS, NOTES])
        .err()
        .expect("quick check fails");
    assert!(matches!(err, OpenError::Corrupt(_)), "{err:?}");
}

#[test]
fn an_insert_commits_the_row_at_rev_1_with_its_change_row() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    let mut m = meta("user edit");
    m.evidence_ids = vec![EvidenceId::new("evd_1")];
    let w = store.write(note("not_1", None, "First"), m).unwrap();
    assert_eq!(w.rev, Rev(1));
    assert!(w.change_id.as_str().starts_with("chg_"));
    assert_eq!(w.batch_id, None);
    assert_eq!(w.record["title"], json!("First"));
    assert_eq!(w.record["rev"], json!(1));
    let id = w.change_id.0.clone();
    let row = store
        .read(move |c| {
            c.query_row(
                "SELECT actor, entity_type, entity_id, field, before, after, summary, reason,
                        evidence_ids, status, undoable, batch_id, ts
                 FROM changes WHERE id = ?1",
                [id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, Option<String>>(4)?,
                        r.get::<_, Option<String>>(5)?,
                        r.get::<_, String>(6)?,
                        r.get::<_, String>(7)?,
                        r.get::<_, String>(8)?,
                        r.get::<_, String>(9)?,
                        r.get::<_, i64>(10)?,
                        r.get::<_, Option<String>>(11)?,
                        r.get::<_, i64>(12)?,
                    ))
                },
            )
        })
        .unwrap();
    assert_eq!(row.0, "you");
    assert_eq!((row.1.as_str(), row.2.as_str()), ("note", "not_1"));
    assert_eq!(row.3.as_deref(), Some("title"));
    assert_eq!(row.4, None, "no before for an insert");
    let after: serde_json::Value = serde_json::from_str(row.5.as_deref().unwrap()).unwrap();
    assert_eq!(after["title"], json!("First"));
    assert_eq!(
        (row.6.as_str(), row.7.as_str()),
        ("Renamed the note", "user edit")
    );
    assert_eq!(row.8, r#"["evd_1"]"#);
    assert_eq!((row.9.as_str(), row.10, row.11), ("applied", 1, None));
    assert!(row.12 > 1_700_000_000_000, "epoch ms");
}

#[test]
fn an_update_bumps_rev_and_records_before_and_after() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    store
        .write(note("not_1", None, "First"), meta("create"))
        .unwrap();
    let mut two = note("not_1", Some(1), "Second");
    two.values.push(("body", json!(null)));
    let w = store.write(two, meta("edit")).unwrap();
    assert_eq!(w.rev, Rev(2));
    assert_eq!(w.record["title"], json!("Second"));
    let id = w.change_id.0.clone();
    let (field, before, after): (Option<String>, String, String) = store
        .read(move |c| {
            c.query_row(
                "SELECT field, before, after FROM changes WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
        })
        .unwrap();
    assert_eq!(field, None, "several columns changed");
    let before: serde_json::Value = serde_json::from_str(&before).unwrap();
    let after: serde_json::Value = serde_json::from_str(&after).unwrap();
    assert_eq!(
        (before["title"].clone(), before["rev"].clone()),
        (json!("First"), json!(1))
    );
    assert_eq!(
        (after["title"].clone(), after["rev"].clone()),
        (json!("Second"), json!(2))
    );
    // Without a base rev (a record that is not user-editable) the write goes through.
    assert_eq!(
        store
            .write(note("not_1", None, "Third"), meta("job"))
            .unwrap()
            .rev,
        Rev(3)
    );
    assert_eq!(count(&store, "SELECT count(*) FROM changes"), 3);
}

#[test]
fn a_stale_rev_is_a_conflict_and_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    store
        .write(note("not_1", None, "First"), meta("create"))
        .unwrap();
    store
        .write(note("not_1", Some(1), "Second"), meta("edit"))
        .unwrap();
    let err = store
        .write(note("not_1", Some(1), "Stale"), meta("edit"))
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Conflict);
    assert_eq!(
        err.detail,
        Some(ErrorDetail::Conflict {
            current_rev: Rev(2)
        })
    );
    let missing = store
        .write(note("not_9", Some(1), "Ghost"), meta("edit"))
        .unwrap_err();
    assert_eq!(
        missing.detail,
        Some(ErrorDetail::Conflict {
            current_rev: Rev(0)
        })
    );
    assert_eq!(count(&store, "SELECT count(*) FROM changes"), 2);
    let title: String = store
        .read(|c| {
            c.query_row("SELECT title FROM notes WHERE id = 'not_1'", [], |r| {
                r.get(0)
            })
        })
        .unwrap();
    assert_eq!(title, "Second");
}

#[test]
fn a_failure_after_the_row_write_leaves_neither() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    let err = store
        .write(note("not_1", None, "First"), meta("boom"))
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Internal);
    assert_eq!(count(&store, "SELECT count(*) FROM notes"), 0);
    assert_eq!(count(&store, "SELECT count(*) FROM changes"), 0);
}

#[test]
fn an_invalid_mutation_is_internal() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    let mut bad = note("not_1", None, "x");
    bad.table = "notes; DROP TABLE changes";
    assert_eq!(
        store.write(bad, meta("x")).unwrap_err().code,
        ErrorCode::Internal
    );
    let mut empty = note("not_1", None, "x");
    empty.values.clear();
    assert_eq!(
        store.write(empty, meta("x")).unwrap_err().code,
        ErrorCode::Internal
    );
    let mut unknown = note("not_1", None, "x");
    unknown.values = vec![("nope", json!(1))];
    assert_eq!(
        store.write(unknown, meta("x")).unwrap_err().code,
        ErrorCode::Internal
    );
    assert_eq!(count(&store, "SELECT count(*) FROM changes"), 0);
}

#[test]
fn a_batch_commits_together_under_one_batch_id() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    let mut m = meta("import");
    m.actor = Actor::Job {
        job_id: JobId::new("job_reconcile"),
        name: "Reconcile".into(),
    };
    let mut two = note("not_2", None, "Two");
    two.values = vec![
        ("title", json!("Two")),
        ("body", json!(2.5)),
        ("rev", json!(7)),
    ];
    let written = store
        .write_batch(vec![note("not_1", None, "One"), two], m)
        .unwrap();
    assert_eq!(written.len(), 2);
    let batch = written[0].batch_id.clone().expect("batch id");
    assert!(batch.as_str().starts_with("bat_"));
    assert_eq!(written[1].batch_id.as_ref(), Some(&batch));
    assert_eq!(
        written[1].rev,
        Rev(1),
        "rev is the store's, not the caller's"
    );
    assert_eq!(written[1].record["body"], json!(2.5));
    let actors: Vec<String> = store
        .read(|c| {
            let mut s = c.prepare("SELECT actor FROM changes ORDER BY id")?;
            let rows = s.query_map([], |r| r.get(0))?;
            rows.collect()
        })
        .unwrap();
    assert_eq!(actors, ["job:job_reconcile", "job:job_reconcile"]);

    // One stale row fails the whole batch.
    let mut m = meta("model");
    m.actor = Actor::Model {
        llm_run_id: LlmRunId::new("llm_7"),
        runtime: RuntimeChoice::Local,
        model: "m".into(),
    };
    m.batch_id = Some(batch.clone());
    let err = store
        .write_batch(
            vec![
                note("not_3", None, "Three"),
                note("not_1", Some(9), "Stale"),
            ],
            m.clone(),
        )
        .unwrap_err();
    assert_eq!(
        err.detail,
        Some(ErrorDetail::Conflict {
            current_rev: Rev(1)
        })
    );
    assert_eq!(count(&store, "SELECT count(*) FROM notes"), 2);
    let w = store.write(note("not_3", None, "Three"), m).unwrap();
    assert_eq!(w.batch_id, Some(batch), "a caller's batch id is kept");
    let id = w.change_id.0;
    let actor: String = store
        .read(move |c| {
            c.query_row("SELECT actor FROM changes WHERE id = ?1", [id], |r| {
                r.get(0)
            })
        })
        .unwrap();
    assert_eq!(actor, "llm_run:llm_7");
}

#[test]
fn the_change_log_is_append_only() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let store = open(&path);
    let id = store
        .write(note("not_1", None, "First"), meta("create"))
        .unwrap()
        .change_id
        .0;
    store.close();
    let c = raw(&path);
    assert!(c
        .execute("UPDATE changes SET reason = 'x' WHERE id = ?1", [&id])
        .is_err());
    assert!(c
        .execute("DELETE FROM changes WHERE id = ?1", [&id])
        .is_err());
    assert_eq!(
        c.execute("UPDATE changes SET status = 'undone' WHERE id = ?1", [&id])
            .unwrap(),
        1
    );
}

#[test]
fn the_read_pool_is_read_only_and_sees_commits() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    store
        .write(note("not_1", None, "First"), meta("create"))
        .unwrap();
    let err = store
        .read(|c| c.execute("INSERT INTO notes (id, rev) VALUES ('not_x', 1)", []))
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Internal);
    // Several readers at once each get a connection.
    std::thread::scope(|s| {
        for _ in 0..4 {
            s.spawn(|| assert_eq!(count(&store, "SELECT count(*) FROM notes"), 1));
        }
    });
    assert!(store.read(|c| c.is_readonly(MAIN_DB)).unwrap());
    assert!(!store.read_snapshot(|c| c.is_readonly(MAIN_DB)).unwrap());
}

#[test]
fn fts5_and_sqlite_vec_are_loaded() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    let (hit, nearest) = store
        .read_snapshot(|c| {
            c.execute_batch(
                "CREATE VIRTUAL TABLE t_fts USING fts5(body);
                 INSERT INTO t_fts (body) VALUES ('quarterly roadmap review'), ('lunch');
                 CREATE VIRTUAL TABLE t_vec USING vec0(embedding float[2]);
                 INSERT INTO t_vec (rowid, embedding) VALUES (1, '[0.0, 1.0]'), (2, '[1.0, 0.0]');",
            )?;
            let hit: String =
                c.query_row("SELECT body FROM t_fts WHERE t_fts MATCH 'roadmap'", [], |r| r.get(0))?;
            let nearest: i64 = c.query_row(
                "SELECT rowid FROM t_vec WHERE embedding MATCH '[0.9, 0.1]' ORDER BY distance LIMIT 1",
                [],
                |r| r.get(0),
            )?;
            Ok((hit, nearest))
        })
        .unwrap();
    assert_eq!(hit, "quarterly roadmap review");
    assert_eq!(nearest, 2);
    let version: String = store
        .read(|c| c.query_row("SELECT vec_version()", [], |r| r.get(0)))
        .unwrap();
    assert!(version.starts_with('v'));
}

#[test]
fn close_drains_the_queue_checkpoints_and_refuses_later_work() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let store = open(&path);
    std::thread::scope(|s| {
        for i in 0..20 {
            let store = &store;
            s.spawn(move || {
                store
                    .write(note(&format!("not_{i}"), None, "x"), meta("load"))
                    .unwrap()
            });
        }
    });
    store.close();
    assert_eq!(store.state(), StoreState::Closed);
    let wal = PathBuf::from(format!("{}-wal", path.display()));
    assert!(
        std::fs::metadata(&wal)
            .map(|m| m.len() == 0)
            .unwrap_or(true),
        "WAL checkpointed"
    );
    let one = |c: &Connection| c.query_row("SELECT 1", [], |r| r.get::<_, i64>(0));
    assert_eq!(
        store
            .write(note("not_x", None, "x"), meta("late"))
            .unwrap_err()
            .code,
        ErrorCode::Internal
    );
    assert_eq!(store.read(one).unwrap_err().code, ErrorCode::Internal);
    assert_eq!(
        store.read_snapshot(one).unwrap_err().code,
        ErrorCode::Internal
    );
    store.close(); // idempotent
    let n: i64 = raw(&path)
        .query_row("SELECT count(*) FROM changes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 20);
}

#[test]
fn the_default_path_is_under_application_support() {
    let p = noter_db::default_path().expect("HOME is set");
    assert!(
        p.ends_with("Library/Application Support/Noter/noter.db"),
        "{}",
        p.display()
    );
}
