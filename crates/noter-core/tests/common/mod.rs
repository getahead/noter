use std::path::Path;

use noter_db::Insert;
use serde_json::{json, Value};

use noter_db::rusqlite;

pub fn exec(dir: &Path, sql: &str) -> rusqlite::Result<()> {
    rusqlite::Connection::open(dir.join("noter.db"))
        .unwrap()
        .execute_batch(sql)
}

pub fn count(dir: &Path, sql: &str) -> i64 {
    rusqlite::Connection::open(dir.join("noter.db"))
        .unwrap()
        .query_row(sql, [], |r| r.get(0))
        .unwrap()
}

pub fn text(dir: &Path, sql: &str) -> Option<String> {
    rusqlite::Connection::open(dir.join("noter.db"))
        .unwrap()
        .query_row(sql, [], |r| r.get(0))
        .unwrap()
}

pub fn row(table: &'static str, values: &[(&'static str, Value)]) -> Insert {
    Insert {
        table,
        values: values.to_vec(),
    }
}

pub fn call(id: &str, started: i64) -> Insert {
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

pub fn person(id: &str, name: &str) -> Insert {
    row(
        "people",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("display_name", json!(name)),
            ("short_name", json!(name)),
        ],
    )
}

pub fn part(call_id: &str, person: &str) -> Insert {
    row(
        "call_participants",
        &[
            ("id", json!(format!("cpp_{call_id}_{person}"))),
            ("call_id", json!(call_id)),
            ("person_id", json!(person)),
        ],
    )
}

pub fn speaker(
    id: &str,
    call_id: &str,
    label: &str,
    person: Option<&str>,
    n: Option<i64>,
) -> Insert {
    row(
        "speakers",
        &[
            ("id", json!(id)),
            ("call_id", json!(call_id)),
            ("label", json!(label)),
            ("n", json!(n)),
            ("channel", json!("sys")),
            ("person_id", json!(person)),
            ("named_by", json!(person.map(|_| "you"))),
            ("pass", json!("live")),
        ],
    )
}

pub fn item(id: &str, call_id: &str, kind: &str, owner: Option<&str>) -> Insert {
    row(
        "items",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("call_id", json!(call_id)),
            ("kind", json!(kind)),
            ("text", json!(format!("Text of {id}"))),
            ("lang", json!("en")),
            ("status", json!("open")),
            ("review_state", json!("accepted")),
            ("created_by", json!("llm")),
            ("is_engineering", json!(0)),
            ("owner_person_id", json!(owner)),
        ],
    )
}
