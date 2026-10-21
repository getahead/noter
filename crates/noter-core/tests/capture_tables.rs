//! The M1 tables (DESIGN-core 3.7: calls, speakers, segments, marks, gaps): what they accept,
//! what they refuse, and that deleting a call takes its capture rows with it.

use noter_db::{ChangeMeta, Insert, Mutation, Store};
use noter_protocol::model::Actor;
use serde_json::{json, Value};

fn open(dir: &tempfile::TempDir) -> Store {
    Store::open(
        &dir.path().join("noter.db"),
        &[noter_db::MIGRATIONS, noter_core::MIGRATIONS],
    )
    .unwrap()
}

fn meta(reason: &str) -> ChangeMeta {
    ChangeMeta {
        actor: Actor::You,
        summary: reason.into(),
        reason: reason.into(),
        evidence_ids: vec![],
        batch_id: None,
        undoable: true,
        surface: None,
    }
}

fn call(id: &str, extra: &[(&'static str, Value)]) -> Mutation {
    let mut values = vec![
        ("started_at", json!(1_792_137_600_000_i64)),
        ("title", json!("Planning")),
        ("call_type", json!("planning")),
        ("status", json!("recording")),
        ("mode_used", json!("cloud_redacted")),
    ];
    for (column, value) in extra {
        values.retain(|(c, _)| c != column);
        values.push((column, value.clone()));
    }
    Mutation {
        entity_type: "call",
        table: "calls",
        id: id.into(),
        base_rev: None,
        bump_rev: true,
        values,
    }
}

fn row(table: &'static str, values: &[(&'static str, Value)]) -> Insert {
    Insert {
        table,
        values: values.to_vec(),
    }
}

/// A speaker, a segment, a mark and a gap of one call.
fn capture(call_id: &str, n: &str) -> Vec<Insert> {
    let spk = format!("spk_{n}");
    vec![
        row(
            "speakers",
            &[
                ("id", json!(spk)),
                ("call_id", json!(call_id)),
                ("label", json!("spk_1")),
                ("n", json!(1)),
                ("channel", json!("sys")),
                ("pass", json!("live")),
            ],
        ),
        row(
            "segments",
            &[
                ("id", json!(format!("seg_{n}"))),
                ("call_id", json!(call_id)),
                ("speaker_id", json!(spk)),
                ("channel", json!("sys")),
                ("t0_ms", json!(1000)),
                ("t1_ms", json!(2000)),
                ("text", json!("Hello")),
                ("text_norm", json!("hello")),
                ("lang", json!("en")),
                ("pass", json!("live")),
            ],
        ),
        row(
            "marks",
            &[
                ("id", json!(format!("mrk_{n}"))),
                ("call_id", json!(call_id)),
                ("at_ms", json!(1500)),
            ],
        ),
        row(
            "gaps",
            &[
                ("call_id", json!(call_id)),
                ("t0_ms", json!(3000)),
                ("t1_ms", json!(4000)),
                ("reason", json!("paused")),
            ],
        ),
    ]
}

/// `rows[i]` with `column` set to `value`.
fn with(rows: &[Insert], i: usize, column: &'static str, value: Value) -> Insert {
    let mut r = rows[i].clone();
    r.values.retain(|(c, _)| *c != column);
    r.values.push((column, value));
    r
}

fn count(store: &Store, sql: String) -> i64 {
    store
        .read(move |c| c.query_row(&sql, [], |r| r.get(0)))
        .unwrap()
}

#[test]
fn a_call_is_stored_with_its_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    let written = store.write(call("call_1", &[]), meta("start")).unwrap();
    assert_eq!(written.rev.0, 1);
    let r = &written.record;
    assert_eq!(r["privacy_class"], "normal");
    assert_eq!(r["outputs_status"], "not_started");
    assert_eq!(r["archive_status"], "not_started");
    assert_eq!(r["audio_deleted"], 0);
    assert_eq!(r["audio_not_stored"], 0);
    assert_eq!(r["ended_at"], Value::Null);
}

#[test]
fn capture_rows_are_stored_and_deleted_with_their_call() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    for id in ["call_1", "call_2"] {
        store.write(call(id, &[]), meta("start")).unwrap();
    }
    let mut rows = capture("call_1", "1");
    rows.extend(capture("call_2", "2"));
    store.insert_batch(rows).unwrap();
    for table in ["speakers", "segments", "marks", "gaps"] {
        assert_eq!(
            count(&store, format!("SELECT count(*) FROM {table}")),
            2,
            "{table}"
        );
    }
    let corrections: String = store
        .read(|c| {
            c.query_row(
                "SELECT corrections FROM segments WHERE id = 'seg_1'",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(corrections, "[]");

    store
        .delete("call", "calls", vec!["call_1".into()], meta("calls_delete"))
        .unwrap();
    for (table, key) in [
        ("calls", "id"),
        ("speakers", "call_id"),
        ("segments", "call_id"),
        ("marks", "call_id"),
        ("gaps", "call_id"),
    ] {
        let sql = format!("SELECT count(*) FROM {table} WHERE {key} = 'call_1'");
        assert_eq!(count(&store, sql), 0, "{table} of the deleted call");
    }
    assert_eq!(
        count(&store, "SELECT count(*) FROM segments".into()),
        1,
        "the other call keeps its rows"
    );
}

#[test]
fn the_tables_refuse_what_the_design_does_not_allow() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    for bad in [
        ("status", json!("interrupted")),
        ("privacy_class", json!("secret")),
        ("outputs_status", json!("done")),
        ("archive_status", json!("writing")),
        ("mode_used", json!("cloud_raw")),
    ] {
        let refused = store.write(call("call_x", &[bad.clone()]), meta("start"));
        assert!(refused.is_err(), "{bad:?}");
    }
    store.write(call("call_1", &[]), meta("start")).unwrap();
    let base = capture("call_1", "1");
    for (what, bad) in [
        ("speaker channel", with(&base, 0, "channel", json!("both"))),
        ("speaker pass", with(&base, 0, "pass", json!("offline"))),
        (
            "speaker named_by",
            with(&base, 0, "named_by", json!("guess")),
        ),
        ("segment pass", with(&base, 1, "pass", json!("offline"))),
        ("segment channel", with(&base, 1, "channel", json!("both"))),
        (
            "segment speaker",
            with(&base, 1, "speaker_id", json!("spk_none")),
        ),
        ("gap reason", with(&base, 3, "reason", json!("lunch"))),
        ("mark call", with(&base, 2, "call_id", json!("call_none"))),
    ] {
        let mut rows = base.clone();
        let i = rows.iter().position(|r| r.table == bad.table).unwrap();
        rows[i] = bad;
        assert!(store.insert_batch(rows).is_err(), "{what}");
    }
    store.insert_batch(base.clone()).unwrap();
    // One speaker per label and pass; one gap per start offset.
    let same_label = with(&base, 0, "id", json!("spk_9"));
    assert!(store.insert_batch(vec![same_label.clone()]).is_err());
    let archive = with(&[same_label], 0, "pass", json!("archive"));
    store.insert_batch(vec![archive]).unwrap();
    assert!(store.insert_batch(vec![base[3].clone()]).is_err());
}
