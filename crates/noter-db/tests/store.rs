//! FEATURE cpt-noter-feature-core-storage: open, migrate, write with the change row, read, close.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use noter_db::rusqlite::{Connection, MAIN_DB};
use noter_db::{ChangeMeta, Insert, Migration, Mutation, OpenError, Store, StoreState, MIGRATIONS};
use noter_protocol::ipc::NativeSurface;
use noter_protocol::model::Actor;
use noter_protocol::{
    CoreError, ErrorCode, ErrorDetail, EvidenceId, JobId, LlmRunId, Rev, RuntimeChoice,
};
use serde_json::json;

const NOTES: &[Migration] = &[Migration {
    owner: "test",
    version: 1,
    name: "notes",
    // Not idempotent on purpose: running it twice fails. The trigger forces a failure after the row write.
    sql: "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, body TEXT, score REAL, pinned INTEGER, rev INTEGER NOT NULL);
          CREATE TABLE prefs (id TEXT PRIMARY KEY, value TEXT);
          CREATE TABLE calls (id TEXT PRIMARY KEY, title TEXT, rev INTEGER NOT NULL);
          CREATE TABLE segments (id TEXT PRIMARY KEY, call_id TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
                                 start_ms INTEGER NOT NULL, text TEXT NOT NULL);
          CREATE TABLE marks (id TEXT PRIMARY KEY, call_id TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
                              at_ms INTEGER NOT NULL, source TEXT NOT NULL);
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
        bump_rev: true,
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
        surface: None,
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
    assert_eq!(count(&store, "SELECT count(*) FROM schema_migrations"), 3);
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
    assert_eq!(count(&store, "SELECT count(*) FROM schema_migrations"), 3);
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
    assert_eq!(row.5.as_deref(), Some("First"), "the new value, as text");
    assert_eq!(
        (row.6.as_str(), row.7.as_str()),
        ("Renamed the note", "user edit")
    );
    assert_eq!(row.8, r#"["evd_1"]"#);
    assert_eq!((row.9.as_str(), row.10, row.11), ("applied", 1, None));
    assert!(row.12 > 1_700_000_000_000, "epoch ms");
}

#[test]
fn an_update_bumps_rev_and_records_only_what_changed() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    store
        .write(note("not_1", None, "First"), meta("create"))
        .unwrap();
    // Two columns change, one is written with its old value.
    let mut two = note("not_1", Some(1), "Second");
    two.values.push(("score", json!(4.5)));
    two.values.push(("body", json!(null)));
    let w = store.write(two, meta("edit")).unwrap();
    assert_eq!(w.rev, Rev(2));
    assert_eq!(w.record["title"], json!("Second"));
    let row = change_row(&store, &w.change_id.0);
    assert_eq!(
        (row.0, row.1, row.2),
        (None, None, None),
        "several columns: delta only"
    );
    assert_eq!(
        row.3,
        Some(json!({ "title": ["First", "Second"], "score": [null, 4.5] }))
    );
    // One column: field, before and after; no delta.
    let w = store
        .write(note("not_1", None, "Third"), meta("job"))
        .unwrap();
    assert_eq!(w.rev, Rev(3), "without a base rev the write goes through");
    let row = change_row(&store, &w.change_id.0);
    let one = (
        Some("title".to_string()),
        Some("Second".to_string()),
        Some("Third".to_string()),
        None,
    );
    assert_eq!(row, one);
    assert_eq!(count(&store, "SELECT count(*) FROM changes"), 3);
}

/// `field`, `before`, `after` and `delta` (as JSON) of one change row.
fn change_row(
    store: &Store,
    id: &str,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<serde_json::Value>,
) {
    let id = id.to_string();
    store
        .read(move |c| {
            c.query_row(
                "SELECT field, before, after, delta FROM changes WHERE id = ?1",
                [id],
                |r| {
                    let delta: Option<Vec<u8>> = r.get(3)?;
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        delta.map(|d| serde_json::from_slice(&d).unwrap()),
                    ))
                },
            )
        })
        .unwrap()
}

#[test]
fn single_values_are_stored_as_text_and_null_stays_null() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    store
        .write(note("not_1", None, "First"), meta("create"))
        .unwrap();
    let mut score = note("not_1", None, "unused");
    score.values = vec![("score", json!(2.5))];
    let row = change_row(
        &store,
        &store
            .write(score.clone(), meta("score"))
            .unwrap()
            .change_id
            .0,
    );
    assert_eq!(row, (Some("score".into()), None, Some("2.5".into()), None));
    score.values = vec![("score", json!(null))];
    let row = change_row(
        &store,
        &store.write(score, meta("clear")).unwrap().change_id.0,
    );
    assert_eq!(row, (Some("score".into()), Some("2.5".into()), None, None));
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
        ("score", json!(2.5)),
        ("pinned", json!(true)),
        ("body", json!(["a"])),
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
    assert_eq!(written[1].record["score"], json!(2.5));
    assert_eq!(written[1].record["pinned"], json!(1));
    assert_eq!(written[1].record["body"], json!(r#"["a"]"#));
    let delta = change_row(&store, &written[1].change_id.0).3;
    let inserted = json!({ "title": [null, "Two"], "score": [null, 2.5], "pinned": [null, 1], "body": [null, r#"["a"]"#] });
    assert_eq!(
        delta,
        Some(inserted),
        "an insert of several columns: delta from null"
    );
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
}

#[test]
fn fts5_and_sqlite_vec_are_loaded() {
    let dir = tempfile::tempdir().unwrap();
    let search = &[Migration {
        owner: "search-test",
        version: 1,
        name: "fts and vec",
        sql: "CREATE VIRTUAL TABLE t_fts USING fts5(body);
              INSERT INTO t_fts (body) VALUES ('quarterly roadmap review'), ('lunch');
              CREATE VIRTUAL TABLE t_vec USING vec0(embedding float[2]);
              INSERT INTO t_vec (rowid, embedding) VALUES (1, '[0.0, 1.0]'), (2, '[1.0, 0.0]');",
    }];
    let store = Store::open(&db_path(&dir), &[MIGRATIONS, search]).unwrap();
    let hit: String = store
        .read_snapshot(|c| {
            c.query_row(
                "SELECT body FROM t_fts WHERE t_fts MATCH 'roadmap'",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(hit, "quarterly roadmap review");
    let nearest: i64 = store
        .read(|c| {
            c.query_row(
                "SELECT rowid FROM t_vec WHERE embedding MATCH '[0.9, 0.1]' ORDER BY distance LIMIT 1",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(nearest, 2);
    let version: String = store
        .read(|c| c.query_row("SELECT vec_version()", [], |r| r.get(0)))
        .unwrap();
    assert!(version.starts_with('v'));
}

#[test]
fn a_snapshot_read_cannot_write() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    let err = store
        .read_snapshot(|c| c.execute("INSERT INTO notes (id, rev) VALUES ('not_x', 1)", []))
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Internal);
    assert_eq!(count(&store, "SELECT count(*) FROM notes"), 0);
    // The writer writes again afterwards.
    store
        .write(note("not_1", None, "First"), meta("create"))
        .unwrap();
    assert_eq!(count(&store, "SELECT count(*) FROM notes"), 1);
}

#[test]
fn a_panicking_job_does_not_stop_the_writer() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    let err = store
        .read_snapshot(|_| -> noter_db::rusqlite::Result<i64> { panic!("bug in a read model") })
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Internal);
    assert_eq!(store.state(), StoreState::Ready);
    store
        .write(note("not_1", None, "First"), meta("after the panic"))
        .unwrap();
    assert_eq!(count(&store, "SELECT count(*) FROM changes"), 1);
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

#[test]
fn a_native_surface_is_recorded_on_the_change_row() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    let mut m = meta("hotkey");
    m.surface = Some(NativeSurface::MenuBar);
    let id = store
        .write(note("not_1", None, "First"), m)
        .unwrap()
        .change_id
        .0;
    let first = store
        .write(note("not_2", None, "Second"), meta("ui"))
        .unwrap()
        .change_id
        .0;
    let surfaces: Vec<Option<String>> = store
        .read(move |c| {
            let mut s = c.prepare(
                "SELECT surface FROM changes WHERE id IN (?1, ?2) ORDER BY id = ?1 DESC",
            )?;
            let rows = s.query_map([id, first], |r| r.get(0))?;
            rows.collect()
        })
        .unwrap();
    assert_eq!(surfaces, [Some("menu_bar".to_string()), None]);
}

#[test]
fn a_write_that_does_not_bump_rev_leaves_it_alone() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    store
        .write(note("not_1", None, "First"), meta("create"))
        .unwrap();
    let mut keep = note("not_1", Some(1), "Renamed");
    keep.bump_rev = false;
    let w = store.write(keep, meta("hotkeys")).unwrap();
    assert_eq!(
        (w.rev, w.record["title"].clone()),
        (Rev(1), json!("Renamed"))
    );
    // A table without a rev column.
    let pref = |value: &str| Mutation {
        entity_type: "pref",
        table: "prefs",
        id: "hotkeys".into(),
        base_rev: None,
        bump_rev: false,
        values: vec![("value", json!(value))],
    };
    assert_eq!(store.write(pref("a"), meta("setup")).unwrap().rev, Rev(0));
    let w = store.write(pref("b"), meta("setup")).unwrap();
    assert_eq!((w.rev, w.record["value"].clone()), (Rev(0), json!("b")));
    assert_eq!(count(&store, "SELECT count(*) FROM changes"), 4);
}

fn logged(id: &str, field: &str, before: Option<&str>, after: Option<&str>) -> noter_db::Logged {
    noter_db::Logged {
        entity_type: "note",
        entity_id: id.into(),
        field: Some(field.into()),
        before: before.map(String::from),
        after: after.map(String::from),
        delta: None,
    }
}

#[test]
fn a_custom_write_commits_with_the_change_rows_it_reports() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    let done = store
        .write_with(meta("custom"), |tx| {
            tx.execute(
                "INSERT INTO notes (id, title, rev) VALUES ('not_1', 'First', 1)",
                [],
            )
            .map_err(|e| CoreError::new(ErrorCode::Internal, e.to_string()))?;
            Ok((7, vec![logged("not_1", "title", None, Some("First"))]))
        })
        .unwrap();
    assert_eq!(
        (done.value, done.change_ids.len(), done.batch_id),
        (7, 1, None)
    );
    let row = change_row(&store, &done.change_ids[0].0);
    assert_eq!(
        row,
        (Some("title".into()), None, Some("First".into()), None)
    );
    // Several rows share a new batch id; a delta is stored as JSON.
    let mut several = logged("not_2", "x", None, None);
    several.field = None;
    several.delta = Some(json!({ "title": [null, "Two"], "body": [null, "b"] }));
    let done = store
        .write_with(meta("two"), move |_| {
            Ok((
                (),
                vec![
                    logged("not_1", "title", Some("First"), Some("One")),
                    several,
                ],
            ))
        })
        .unwrap();
    assert!(done
        .batch_id
        .as_ref()
        .is_some_and(|b| b.as_str().starts_with("bat_")));
    let delta = change_row(&store, &done.change_ids[1].0).3;
    assert_eq!(
        delta,
        Some(json!({ "title": [null, "Two"], "body": [null, "b"] }))
    );
    assert_eq!(count(&store, "SELECT count(*) FROM changes"), 3);
}

#[test]
fn a_custom_write_that_logs_nothing_or_fails_leaves_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    let silent = store.write_with(meta("silent"), |tx| {
        tx.execute("INSERT INTO notes (id, rev) VALUES ('not_1', 1)", [])
            .map_err(|e| CoreError::new(ErrorCode::Internal, e.to_string()))?;
        Ok(((), vec![]))
    });
    assert_eq!(
        silent.unwrap_err().code,
        ErrorCode::Internal,
        "every write has its change row"
    );
    let stale = store.write_with(
        meta("stale"),
        |tx| -> Result<((), Vec<noter_db::Logged>), CoreError> {
            tx.execute("INSERT INTO notes (id, rev) VALUES ('not_2', 1)", [])
                .map_err(|e| CoreError::new(ErrorCode::Internal, e.to_string()))?;
            Err(CoreError::new(ErrorCode::Conflict, "settings changed"))
        },
    );
    assert_eq!(stale.unwrap_err().code, ErrorCode::Conflict);
    let boom = store.write_with(meta("boom"), |_| {
        Ok(((), vec![logged("not_3", "title", None, Some("x"))]))
    });
    assert_eq!(
        boom.unwrap_err().code,
        ErrorCode::Internal,
        "the trigger refuses reason boom"
    );
    assert_eq!(count(&store, "SELECT count(*) FROM notes"), 0);
    assert_eq!(count(&store, "SELECT count(*) FROM changes"), 0);
}

#[test]
fn a_write_that_breaks_a_unique_index_is_a_duplicate() {
    let dir = tempfile::tempdir().unwrap();
    let tags = &[Migration {
        owner: "tags-test",
        version: 1,
        name: "tags",
        sql: "CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, rev INTEGER NOT NULL);
              CREATE UNIQUE INDEX tags_name ON tags (lower(name));",
    }];
    let store = Store::open(&db_path(&dir), &[MIGRATIONS, NOTES, tags]).unwrap();
    let tag = |id: &str, name: &str| Mutation {
        entity_type: "tag",
        table: "tags",
        id: id.into(),
        base_rev: None,
        bump_rev: true,
        values: vec![("name", json!(name))],
    };
    store.write(tag("tag_1", "Backend"), meta("add")).unwrap();
    let err = store
        .write(tag("tag_2", "backend"), meta("add"))
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
    assert!(matches!(
        err.detail,
        Some(ErrorDetail::Validation {
            rule: noter_protocol::error::ValidationRule::Duplicate,
            ..
        })
    ));
    assert_eq!(count(&store, "SELECT count(*) FROM changes"), 1);
}

fn call(id: &str) -> Mutation {
    Mutation {
        entity_type: "call",
        table: "calls",
        id: id.into(),
        base_rev: None,
        bump_rev: true,
        values: vec![("title", json!("Standup"))],
    }
}

fn segment(id: &str, call_id: &str, text: &str) -> Insert {
    Insert {
        table: "segments",
        values: vec![
            ("id", json!(id)),
            ("call_id", json!(call_id)),
            ("start_ms", json!(1200)),
            ("text", json!(text)),
        ],
    }
}

#[test]
fn capture_data_is_inserted_in_one_batch_without_change_rows() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    store.write(call("cal_1"), meta("start")).unwrap();
    // Segments from the engine, and a mark the user pressed: capture data either way.
    let mark = Insert {
        table: "marks",
        values: vec![
            ("id", json!("mrk_1")),
            ("call_id", json!("cal_1")),
            ("at_ms", json!(3000)),
            ("source", json!("user")),
        ],
    };
    store
        .insert_batch(vec![
            segment("seg_1", "cal_1", "Hello"),
            segment("seg_2", "cal_1", "Hi"),
            mark,
        ])
        .unwrap();
    assert_eq!(count(&store, "SELECT count(*) FROM segments"), 2);
    assert_eq!(
        count(&store, "SELECT count(*) FROM marks WHERE source = 'user'"),
        1
    );
    assert_eq!(
        count(&store, "SELECT count(*) FROM changes"),
        1,
        "only the call's own write"
    );
    let text: String = store
        .read(|c| {
            c.query_row("SELECT text FROM segments WHERE id = 'seg_2'", [], |r| {
                r.get(0)
            })
        })
        .unwrap();
    assert_eq!(text, "Hi");
    store.insert_batch(vec![]).unwrap();
}

#[test]
fn one_bad_row_fails_the_whole_capture_batch() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    store.write(call("cal_1"), meta("start")).unwrap();
    let duplicate = vec![
        segment("seg_1", "cal_1", "Hello"),
        segment("seg_1", "cal_1", "Again"),
    ];
    let orphan = vec![
        segment("seg_1", "cal_1", "Hello"),
        segment("seg_2", "cal_none", "x"),
    ];
    let mut bad_table = segment("seg_3", "cal_1", "x");
    bad_table.table = "segments; DROP TABLE changes";
    let mut bad_column = segment("seg_4", "cal_1", "x");
    bad_column.values.push(("text = 1 --", json!(1)));
    let mut empty = segment("seg_5", "cal_1", "x");
    empty.values.clear();
    for batch in [
        duplicate,
        orphan,
        vec![segment("seg_1", "cal_1", "Hello"), bad_table],
        vec![bad_column],
        vec![empty],
    ] {
        assert_eq!(
            store.insert_batch(batch).unwrap_err().code,
            ErrorCode::Internal
        );
    }
    assert_eq!(count(&store, "SELECT count(*) FROM segments"), 0);
}

#[test]
fn deleting_calls_cascades_with_one_content_free_change_row_each() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    for id in ["cal_1", "cal_2", "cal_3"] {
        store.write(call(id), meta("start")).unwrap();
    }
    store
        .insert_batch(vec![
            segment("seg_1", "cal_1", "Secret plan"),
            segment("seg_2", "cal_2", "Budget"),
            segment("seg_3", "cal_3", "Kept"),
        ])
        .unwrap();
    let mut m = meta("calls_delete");
    m.summary = "Deleted 2 calls".into();
    // Asked for an undoable delete: a deletion never is.
    m.undoable = true;
    let ids = ["cal_1", "cal_2", "cal_gone"].map(String::from).to_vec();
    let deleted = store.delete("call", "calls", ids, m).unwrap();
    let deleted_ids: Vec<&str> = deleted.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(deleted_ids, ["cal_1", "cal_2"], "a missing id is skipped");
    assert_eq!(count(&store, "SELECT count(*) FROM calls"), 1);
    assert_eq!(
        count(&store, "SELECT count(*) FROM segments"),
        1,
        "segments go with their call"
    );
    for (id, change_id) in deleted {
        let change_id = change_id.0;
        let row: (String, String, String, String, i64, String) = store
            .read(move |c| {
                c.query_row(
                    "SELECT actor, entity_type, entity_id, summary, undoable, status FROM changes WHERE id = ?1",
                    [change_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
                )
            })
            .unwrap();
        assert_eq!(
            row,
            (
                "you".into(),
                "call".into(),
                id,
                "Deleted 2 calls".into(),
                0,
                "applied".into()
            )
        );
    }
    assert_eq!(
        count(
            &store,
            "SELECT count(*) FROM changes WHERE reason = 'calls_delete'
               AND (field IS NOT NULL OR before IS NOT NULL OR after IS NOT NULL OR delta IS NOT NULL)"
        ),
        0,
        "no record content"
    );
    assert!(store
        .delete("call", "calls", vec![], meta("x"))
        .unwrap()
        .is_empty());
}

#[test]
fn a_failed_delete_leaves_everything() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&db_path(&dir));
    store.write(call("cal_1"), meta("start")).unwrap();
    let one = || vec!["cal_1".to_string()];
    assert_eq!(
        store
            .delete("call", "calls", one(), meta("boom"))
            .unwrap_err()
            .code,
        ErrorCode::Internal,
        "the change row failed: the delete rolls back"
    );
    assert_eq!(
        store
            .delete("call", "calls; DROP TABLE changes", one(), meta("x"))
            .unwrap_err()
            .code,
        ErrorCode::Internal
    );
    assert_eq!(count(&store, "SELECT count(*) FROM calls"), 1);
    assert_eq!(count(&store, "SELECT count(*) FROM changes"), 1);
}

#[test]
fn the_audit_log_is_append_only_and_names_its_kind() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    open(&path).close();
    let conn = raw(&path);
    conn.execute_batch(
        "INSERT INTO llm_runs (id, adapter, runtime_choice, model, skill, skill_version, prompt_hash)
         VALUES ('llm_1', 'scripted', 'local', 'm', 'post-call', '1.0.0', 'h');
         INSERT INTO audit_log (id, ts, kind, what, destination, llm_run_id, bytes_out, payload_hash)
         VALUES ('aud_1', 1, 'run', 'outputs', 'api.anthropic.com', 'llm_1', 10, 'h');",
    )
    .unwrap();
    assert!(conn
        .execute("UPDATE audit_log SET bytes_out = 1", [])
        .is_err());
    assert!(conn.execute("DELETE FROM audit_log", []).is_err());
    let other_kind =
        "INSERT INTO audit_log (id, ts, kind, what, destination, bytes_out, payload_hash)
                      VALUES ('aud_2', 1, 'other', 'outputs', 'x', 1, 'h')";
    assert!(conn.execute(other_kind, []).is_err());
}
