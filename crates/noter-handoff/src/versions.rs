//! `prompt_versions`: every generated prompt and every edit of an item, numbered per item.

use noter_db::rusqlite::{params, OptionalExtension};
use noter_db::{ChangeMeta, Logged, Store};
use noter_protocol::model::{VersionKind, VersionMeta};
use noter_protocol::{CoreError, ErrorCode, TimestampMs, VersionId};
use serde_json::Value;

use crate::internal;

/// One stored version.
#[derive(Debug, Clone, PartialEq)]
pub struct Version {
    pub meta: VersionMeta,
    /// The skill's output (generated versions only).
    pub output: Option<Value>,
    pub body_md: String,
    pub file_path: String,
}

/// A version to append.
#[derive(Debug, Clone, Copy)]
pub struct NewVersion<'a> {
    pub item_id: &'a str,
    pub kind: VersionKind,
    pub output: Option<&'a Value>,
    pub body_md: &'a str,
    pub now: TimestampMs,
}

/// Where `handoff_open` writes the prompt, relative to the data folder.
pub fn file_path(item_id: &str) -> String {
    format!("handoffs/{item_id}.md")
}

fn kind_of(s: &str) -> VersionKind {
    match s {
        "user_edit" => VersionKind::UserEdit,
        _ => VersionKind::Generated,
    }
}

fn kind_name(k: VersionKind) -> &'static str {
    match k {
        VersionKind::Generated => "generated",
        VersionKind::UserEdit => "user_edit",
    }
}

/// The time a `ver_` id was made (its ULID's timestamp, taken from the core's clock).
fn created_at(id: &str) -> TimestampMs {
    let ms = id
        .strip_prefix("ver_")
        .and_then(|u| ulid::Ulid::from_string(u).ok())
        .map_or(0, |u| u.timestamp_ms());
    TimestampMs(ms as i64)
}

/// An item's versions, oldest first.
pub fn versions(store: &Store, item_id: &str) -> Result<Vec<Version>, CoreError> {
    let item_id = item_id.to_string();
    store.read(move |c| {
        c.prepare(
            "SELECT id, n, kind, output_json, body_md, file_path FROM prompt_versions
             WHERE item_id = ?1 ORDER BY n",
        )?
        .query_map([item_id], |r| {
            let id: String = r.get(0)?;
            let output: Option<String> = r.get(3)?;
            Ok(Version {
                meta: VersionMeta {
                    created_at: created_at(&id),
                    id: VersionId::new(id),
                    n: r.get(1)?,
                    kind: kind_of(&r.get::<_, String>(2)?),
                    writer: None,
                },
                output: output.and_then(|o| serde_json::from_str(&o).ok()),
                body_md: r.get(4)?,
                file_path: r.get(5)?,
            })
        })?
        .collect()
    })
}

// @cpt-begin:cpt-noter-algo-core-handoff-build:p1:inst-build-store
/// Appends the item's next version with its change row (the item's handoff, the prompt before
/// and after), in one writer transaction; `not_found` when the item is gone. Versions are
/// history, so the change is never undoable.
pub fn append(
    store: &Store,
    mut meta: ChangeMeta,
    v: NewVersion<'_>,
) -> Result<Version, CoreError> {
    meta.undoable = false;
    let random = ulid::Ulid::generate().random();
    let id = format!(
        "ver_{}",
        ulid::Ulid::from_parts(v.now.0.max(0) as u64, random)
    );
    let item_id = v.item_id.to_string();
    let kind = v.kind;
    let output = v.output.map(Value::to_string);
    let body = v.body_md.to_string();
    let path = file_path(v.item_id);
    let written = store.write_with(meta, move |tx| {
        let exists = tx
            .query_row("SELECT 1 FROM items WHERE id = ?1", [&item_id], |_| Ok(()))
            .optional()
            .map_err(internal)?;
        if exists.is_none() {
            return Err(CoreError::new(
                ErrorCode::NotFound,
                "this item no longer exists",
            ));
        }
        let (n, before): (u32, Option<String>) = tx
            .query_row(
                "SELECT COALESCE(MAX(n), 0),
                        (SELECT body_md FROM prompt_versions WHERE item_id = ?1 ORDER BY n DESC LIMIT 1)
                 FROM prompt_versions WHERE item_id = ?1",
                [&item_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(internal)?;
        tx.execute(
            "INSERT INTO prompt_versions (id, item_id, n, kind, output_json, body_md, file_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, item_id, n + 1, kind_name(kind), output, body, path],
        )
        .map_err(internal)?;
        let version = Version {
            meta: VersionMeta {
                created_at: created_at(&id),
                id: VersionId::new(id.clone()),
                n: n + 1,
                kind,
                writer: None,
            },
            output: output.and_then(|o| serde_json::from_str(&o).ok()),
            body_md: body.clone(),
            file_path: path,
        };
        let logged = Logged {
            entity_type: "handoff",
            entity_id: item_id,
            field: Some("prompt_md".into()),
            before,
            after: Some(body),
            delta: None,
        };
        Ok((version, vec![logged]))
    })?;
    Ok(written.value)
}
// @cpt-end:cpt-noter-algo-core-handoff-build:p1:inst-build-store
