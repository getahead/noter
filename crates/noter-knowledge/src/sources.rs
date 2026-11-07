//! Source rows: read, add a folder, edit with a revision guard and remove with the whole local
//! index. Every write goes through the change-log writer and logs no document content.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use noter_db::rusqlite::types::Type;
use noter_db::rusqlite::{self, params, Connection, OptionalExtension, Row, Transaction};
use noter_db::{ChangeMeta, Logged, Store};
use noter_llm::{Secret, SecretStore};
use noter_protocol::error::ValidationRule;
use noter_protocol::model::{
    DeleteResult, SourceAddMcpArgs, SourceKind, SourceList, SourceMode, SourceRow, SourceScope,
    SourceStatus, SourceUpdateArgs,
};
use noter_protocol::{CoreError, ErrorCode, ErrorDetail, PrivacyClass, Rev, SourceId, TimestampMs};
use serde_json::{json, Value};

use crate::internal;
use crate::mcp::{interval, McpSource, DEFAULT_SCHEDULE};

const COLUMNS: &str = "s.id, s.rev, s.kind, s.mode, s.name, s.location, s.schedule, \
     s.privacy_class, s.scope, s.status, s.last_sync_at, s.token_ref IS NOT NULL, \
     (SELECT COUNT(*) FROM documents d WHERE d.source_id = s.id)";

/// A snake-case enum as its column keeps it, or a tagged value as JSON.
pub(crate) fn text<T: serde::Serialize>(v: &T) -> String {
    match serde_json::to_value(v) {
        Ok(Value::String(s)) => s,
        Ok(other) => other.to_string(),
        Err(_) => String::new(),
    }
}

fn parse<T: serde::de::DeserializeOwned>(i: usize, raw: String, json: bool) -> rusqlite::Result<T> {
    let value = if json {
        serde_json::from_str(&raw)
    } else {
        serde_json::from_value(Value::String(raw))
    };
    value.map_err(|e| rusqlite::Error::FromSqlConversionFailure(i, Type::Text, Box::new(e)))
}

fn row(r: &Row<'_>) -> rusqlite::Result<SourceRow> {
    Ok(SourceRow {
        id: SourceId::new(r.get::<_, String>(0)?),
        rev: Rev(r.get(1)?),
        kind: parse(2, r.get(2)?, false)?,
        mode: parse(3, r.get(3)?, false)?,
        name: r.get(4)?,
        location: r.get(5)?,
        schedule: r.get(6)?,
        privacy: parse(7, r.get(7)?, false)?,
        scope: parse(8, r.get(8)?, true)?,
        status: parse(9, r.get(9)?, true)?,
        last_sync_at: r.get::<_, Option<i64>>(10)?.map(TimestampMs),
        has_token: r.get(11)?,
        documents: r.get(12)?,
    })
}

/// One source as Settings shows it, or `None` when it is gone.
pub fn get(conn: &Connection, id: &SourceId) -> rusqlite::Result<Option<SourceRow>> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM sources s WHERE s.id = ?1"),
        [id.as_str()],
        row,
    )
    .optional()
}

/// Every source, by name.
pub fn list(store: &Store) -> Result<SourceList, CoreError> {
    // @cpt-begin:cpt-noter-flow-core-knowledge-manage:p1:inst-manage-list
    let sources = store.read(|c| {
        let mut st = c.prepare(&format!(
            "SELECT {COLUMNS} FROM sources s ORDER BY s.name, s.id"
        ))?;
        let rows = st.query_map([], row)?;
        rows.collect()
    })?;
    Ok(SourceList { sources })
    // @cpt-end:cpt-noter-flow-core-knowledge-manage:p1:inst-manage-list
}

fn invalid(field: &str, rule: ValidationRule, message: &str) -> CoreError {
    CoreError::new(ErrorCode::InvalidInput, message).with_detail(ErrorDetail::Validation {
        field: field.into(),
        rule,
    })
}

pub(crate) fn not_found() -> CoreError {
    CoreError::new(ErrorCode::NotFound, "this source no longer exists")
}

/// The folder a path names, resolved: it must exist, be a directory and be readable. A path the
/// caller supplies is checked like this every time, never taken as a grant.
pub fn validate_folder(path: &str) -> Result<PathBuf, CoreError> {
    // @cpt-begin:cpt-noter-flow-core-knowledge-folder:p1:inst-folder-validate
    let unavailable = |e: std::io::Error| match e.kind() {
        std::io::ErrorKind::PermissionDenied => {
            CoreError::new(ErrorCode::PermissionDenied, "the folder cannot be read")
        }
        _ => CoreError::new(ErrorCode::NotFound, "the folder is not available"),
    };
    let dir = Path::new(path).canonicalize().map_err(unavailable)?;
    if !dir.is_dir() {
        return Err(invalid(
            "path",
            ValidationRule::InvalidFormat,
            "a source must be a folder",
        ));
    }
    std::fs::read_dir(&dir).map_err(unavailable)?;
    Ok(dir)
    // @cpt-end:cpt-noter-flow-core-knowledge-folder:p1:inst-folder-validate
}

/// Inserts an indexed folder source (idle, never synced) and returns its row.
pub fn add_folder(
    store: &Store,
    meta: ChangeMeta,
    dir: &Path,
    privacy: PrivacyClass,
    scope: SourceScope,
) -> Result<SourceRow, CoreError> {
    let location = dir.to_string_lossy().into_owned();
    if taken(store, SourceKind::Folder, &location)? {
        return Err(invalid(
            "path",
            ValidationRule::Duplicate,
            "this folder is already a source",
        ));
    }
    let id = new_id();
    let name = dir
        .file_name()
        .map_or_else(|| location.clone(), |n| n.to_string_lossy().into_owned());
    // @cpt-begin:cpt-noter-flow-core-knowledge-folder:p1:inst-folder-store
    let source = Insert {
        kind: SourceKind::Folder,
        mode: SourceMode::Indexed,
        name,
        location,
        schedule: None,
        privacy,
        scope,
        token_ref: None,
    };
    source.write(store, meta, &id)?;
    // @cpt-end:cpt-noter-flow-core-knowledge-folder:p1:inst-folder-store
    store.read(move |c| get(c, &id))?.ok_or_else(not_found)
}

fn new_id() -> SourceId {
    SourceId::new(format!("src_{}", ulid::Ulid::generate()))
}

/// Whether a source of `kind` already reads `location`.
fn taken(store: &Store, kind: SourceKind, location: &str) -> Result<bool, CoreError> {
    let (kind, location) = (text(&kind), location.to_string());
    let found = store.read(move |c| {
        c.query_row(
            "SELECT 1 FROM sources WHERE kind = ?1 AND location = ?2",
            [&kind, &location],
            |_| Ok(()),
        )
        .optional()
    })?;
    Ok(found.is_some())
}

/// A new source row: idle, never synced.
struct Insert {
    kind: SourceKind,
    mode: SourceMode,
    name: String,
    location: String,
    schedule: Option<String>,
    privacy: PrivacyClass,
    scope: SourceScope,
    token_ref: Option<String>,
}

impl Insert {
    fn write(self, store: &Store, mut meta: ChangeMeta, id: &SourceId) -> Result<(), CoreError> {
        meta.undoable = false;
        let mutation = noter_db::Mutation {
            entity_type: "source",
            table: "sources",
            id: id.as_str().into(),
            base_rev: None,
            bump_rev: true,
            values: vec![
                ("kind", json!(text(&self.kind))),
                ("mode", json!(text(&self.mode))),
                ("name", json!(self.name)),
                ("location", json!(self.location)),
                ("schedule", json!(self.schedule)),
                ("privacy_class", json!(text(&self.privacy))),
                ("scope", json!(text(&self.scope))),
                ("token_ref", json!(self.token_ref)),
                ("status", json!(text(&SourceStatus::Idle))),
            ],
        };
        store.write(mutation, meta).map(|_| ())
    }
}

/// The Keychain account of an indexed MCP source's token (TL-33); the row keeps only this name.
pub fn token_account(id: &SourceId) -> String {
    format!("source:{}", id.as_str())
}

fn keychain_locked() -> CoreError {
    CoreError::new(ErrorCode::KeychainLocked, "the Keychain is locked")
}

/// A schedule an indexed MCP source can sync on.
fn checked_schedule(schedule: &str) -> Result<String, CoreError> {
    match interval(schedule) {
        Some(_) => Ok(schedule.to_string()),
        None => Err(invalid(
            "schedule",
            ValidationRule::InvalidFormat,
            "an unknown schedule",
        )),
    }
}

// @cpt-flow:cpt-noter-flow-core-knowledge-mcp:p1
/// Adds an MCP source and returns its row. Indexed: the server's own sign-in through `mcp`, the
/// token into `secrets` under [`token_account`] and only that name in the row; a failed insert
/// deletes the new Keychain item. Live: the configuration alone, with no token and no index. A
/// failed or cancelled sign-in writes nothing but the `lookup` audit rows of its requests (at
/// `now`), each committed before its request left.
pub async fn add_mcp(
    store: &Store,
    meta: ChangeMeta,
    now: &(dyn Fn() -> TimestampMs + Send + Sync),
    mcp: &dyn McpSource,
    secrets: &dyn SecretStore,
    args: SourceAddMcpArgs,
) -> Result<SourceRow, CoreError> {
    // @cpt-begin:cpt-noter-flow-core-knowledge-mcp:p1:inst-mcp-request
    let server = args.server.trim().to_string();
    if server.is_empty() {
        return Err(invalid(
            "server",
            ValidationRule::Required,
            "a source needs a server",
        ));
    }
    let schedule = match (args.mode, args.schedule.as_deref()) {
        (SourceMode::Live, None) => None,
        (SourceMode::Live, Some(_)) => {
            return Err(invalid(
                "schedule",
                ValidationRule::InvalidFormat,
                "a live source is not scheduled",
            ))
        }
        (SourceMode::Indexed, s) => Some(checked_schedule(s.unwrap_or(DEFAULT_SCHEDULE))?),
    };
    if taken(store, SourceKind::Mcp, &server)? {
        return Err(invalid(
            "server",
            ValidationRule::Duplicate,
            "this server is already a source",
        ));
    }
    // @cpt-end:cpt-noter-flow-core-knowledge-mcp:p1:inst-mcp-request
    let id = new_id();
    let token_ref = match args.mode {
        SourceMode::Indexed => {
            // @cpt-begin:cpt-noter-flow-core-knowledge-mcp:p1:inst-mcp-oauth
            let unaudited: Mutex<Option<CoreError>> = Mutex::new(None);
            let audit = |destination: &str, request: &[u8]| {
                let row =
                    noter_llm::audit_lookup(store, meta.clone(), now(), destination, request, None);
                let Err(e) = row else {
                    return true;
                };
                *unaudited.lock().unwrap_or_else(|p| p.into_inner()) = Some(e);
                false
            };
            let token = mcp.oauth(&server, &audit).await.map_err(|e| {
                let failed = unaudited.lock().unwrap_or_else(|p| p.into_inner()).take();
                failed.unwrap_or_else(|| e.into())
            })?;
            let token = Secret::new(token);
            let account = token_account(&id);
            secrets
                .set(&account, &token)
                .map_err(|_| keychain_locked())?;
            Some(account)
            // @cpt-end:cpt-noter-flow-core-knowledge-mcp:p1:inst-mcp-oauth
        }
        // @cpt-begin:cpt-noter-flow-core-knowledge-mcp:p1:inst-mcp-live
        // The relay (D1) reads this row; no credential is copied and no runtime's own MCP
        // config is touched.
        SourceMode::Live => None,
        // @cpt-end:cpt-noter-flow-core-knowledge-mcp:p1:inst-mcp-live
    };
    // @cpt-begin:cpt-noter-flow-core-knowledge-mcp:p1:inst-mcp-store
    let source = Insert {
        kind: SourceKind::Mcp,
        mode: args.mode,
        name: server.clone(),
        location: server,
        schedule,
        privacy: args.privacy,
        scope: args.scope,
        token_ref: token_ref.clone(),
    };
    if let Err(e) = source.write(store, meta, &id) {
        if let Some(account) = &token_ref {
            let _ = secrets.remove(account);
        }
        return Err(e);
    }
    // @cpt-end:cpt-noter-flow-core-knowledge-mcp:p1:inst-mcp-store
    store.read(move |c| get(c, &id))?.ok_or_else(not_found)
}

/// Stops the source's authenticated work (`stop`), deletes its token from the Keychain, then
/// clears the row's reference and marks it sign-in-expired. A Keychain failure leaves the token
/// and the row as they were and says so.
pub fn revoke(
    store: &Store,
    mut meta: ChangeMeta,
    secrets: &dyn SecretStore,
    id: &SourceId,
    stop: impl FnOnce(),
) -> Result<SourceRow, CoreError> {
    let current = {
        let id = id.clone();
        store.read(move |c| get(c, &id))?.ok_or_else(not_found)?
    };
    if current.kind != SourceKind::Mcp || current.mode != SourceMode::Indexed {
        return Err(invalid(
            "source_id",
            ValidationRule::InvalidFormat,
            "only an indexed MCP source holds a token",
        ));
    }
    // @cpt-begin:cpt-noter-flow-core-knowledge-remove:p1:inst-remove-revoke
    stop();
    let account = token_account(id);
    secrets.remove(&account).map_err(|_| keychain_locked())?;
    // @cpt-end:cpt-noter-flow-core-knowledge-remove:p1:inst-remove-revoke
    // @cpt-begin:cpt-noter-flow-core-knowledge-remove:p1:inst-remove-revoked
    // @cpt-begin:cpt-noter-state-core-knowledge-source:p1:inst-status-revoked
    meta.undoable = false;
    let id = id.clone();
    let written = store.write_with(meta, move |tx| {
        let current = get(tx, &id).map_err(internal)?.ok_or_else(not_found)?;
        tx.execute(
            "UPDATE sources SET token_ref = NULL, status = ?1, rev = ?2 WHERE id = ?3",
            params![
                text(&SourceStatus::SignInExpired),
                current.rev.0 + 1,
                id.as_str()
            ],
        )
        .map_err(internal)?;
        let row = get(tx, &id).map_err(internal)?.ok_or_else(not_found)?;
        // The account name only, never the token.
        let logged = Logged {
            entity_type: "source",
            entity_id: id.as_str().into(),
            field: Some("token_ref".into()),
            before: current.has_token.then_some(account),
            after: None,
            delta: None,
        };
        Ok((row, vec![logged]))
    })?;
    Ok(written.value)
    // @cpt-end:cpt-noter-state-core-knowledge-source:p1:inst-status-revoked
    // @cpt-end:cpt-noter-flow-core-knowledge-remove:p1:inst-remove-revoked
}

/// The columns an edit changes: `(column, stored, wanted)` for each present field that differs.
fn changes(current: &SourceRow, args: &SourceUpdateArgs) -> Vec<(&'static str, Value, Value)> {
    [
        args.name
            .as_ref()
            .map(|n| ("name", json!(current.name), json!(n.trim()))),
        args.schedule
            .as_ref()
            .map(|s| ("schedule", json!(current.schedule), json!(s))),
        args.privacy.map(|p| {
            (
                "privacy_class",
                json!(text(&current.privacy)),
                json!(text(&p)),
            )
        }),
        args.scope
            .as_ref()
            .map(|s| ("scope", json!(text(&current.scope)), json!(text(s)))),
    ]
    .into_iter()
    .flatten()
    .filter(|(_, old, new)| old != new)
    .collect()
}

/// The stored row when `args.rev` is current, else `conflict` with the current revision.
fn guarded(conn: &Connection, args: &SourceUpdateArgs) -> Result<SourceRow, CoreError> {
    let current = get(conn, &args.source_id)
        .map_err(internal)?
        .ok_or_else(not_found)?;
    if current.rev != args.rev {
        return Err(
            CoreError::new(ErrorCode::Conflict, "the source changed since its rev").with_detail(
                ErrorDetail::Conflict {
                    current_rev: current.rev,
                },
            ),
        );
    }
    if let Some(schedule) = &args.schedule {
        if current.kind == SourceKind::Folder || current.mode == SourceMode::Live {
            return Err(invalid(
                "schedule",
                ValidationRule::InvalidFormat,
                "only an indexed MCP source is scheduled",
            ));
        }
        checked_schedule(schedule)?;
    }
    Ok(current)
}

/// Replaces the fields `args` carries when `args.rev` is current: one logged change, and a
/// privacy change moves the source's vectors to the new partition in the same transaction. A
/// stale revision is `conflict` with nothing written; an edit that changes nothing writes
/// nothing.
pub fn update(
    store: &Store,
    mut meta: ChangeMeta,
    args: SourceUpdateArgs,
) -> Result<SourceRow, CoreError> {
    // @cpt-begin:cpt-noter-flow-core-knowledge-manage:p1:inst-manage-update
    if args.name.as_ref().is_some_and(|n| n.trim().is_empty()) {
        return Err(invalid(
            "name",
            ValidationRule::Required,
            "a source needs a name",
        ));
    }
    let check = args.clone();
    let current = store.read(move |c| Ok(guarded(c, &check)))??;
    if changes(&current, &args).is_empty() {
        return Ok(current);
    }
    // @cpt-end:cpt-noter-flow-core-knowledge-manage:p1:inst-manage-update
    meta.undoable = false;
    let written = store.write_with(meta, move |tx| {
        // @cpt-begin:cpt-noter-flow-core-knowledge-manage:p1:inst-manage-commit
        let current = guarded(tx, &args)?;
        let wanted = changes(&current, &args);
        for (column, _, new) in &wanted {
            let value = new.as_str().map(String::from);
            tx.execute(
                &format!("UPDATE sources SET {column} = ?1 WHERE id = ?2"),
                params![value, args.source_id.as_str()],
            )
            .map_err(internal)?;
        }
        // One edit is one revision, however many fields it carries.
        tx.execute(
            "UPDATE sources SET rev = ?1 WHERE id = ?2",
            params![current.rev.0 + 1, args.source_id.as_str()],
        )
        .map_err(internal)?;
        if let Some((_, _, privacy)) = wanted.iter().find(|(c, _, _)| *c == "privacy_class") {
            repartition(tx, &args.source_id, privacy.as_str().unwrap_or("normal"))
                .map_err(internal)?;
        }
        let row = get(tx, &args.source_id)
            .map_err(internal)?
            .ok_or_else(not_found)?;
        Ok((row, vec![logged(&args.source_id, &wanted)]))
        // @cpt-end:cpt-noter-flow-core-knowledge-manage:p1:inst-manage-commit
    })?;
    Ok(written.value)
}

/// The change row of an edit: one field as before/after, several as a delta. Source names and
/// policy only, never document text.
fn logged(id: &SourceId, wanted: &[(&'static str, Value, Value)]) -> Logged {
    let as_text = |v: &Value| match v {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    };
    match wanted {
        [(field, old, new)] => Logged {
            entity_type: "source",
            entity_id: id.as_str().into(),
            field: Some((*field).into()),
            before: as_text(old),
            after: as_text(new),
            delta: None,
        },
        _ => Logged {
            entity_type: "source",
            entity_id: id.as_str().into(),
            field: None,
            before: None,
            after: None,
            delta: Some(Value::Object(
                wanted
                    .iter()
                    .map(|(c, old, new)| ((*c).to_string(), json!([old, new])))
                    .collect(),
            )),
        },
    }
}

/// Moves the source's vectors to the partition of its new privacy class.
fn repartition(tx: &Transaction<'_>, id: &SourceId, privacy: &str) -> rusqlite::Result<()> {
    tx.execute(
        "DELETE FROM doc_vec WHERE chunk_id IN (SELECT c.id FROM doc_chunks c
             JOIN documents d ON d.id = c.document_id WHERE d.source_id = ?1)",
        [id.as_str()],
    )?;
    tx.execute(
        "INSERT INTO doc_vec (chunk_id, privacy_class, embedding)
         SELECT c.id, ?2, c.embedding FROM doc_chunks c JOIN documents d ON d.id = c.document_id
         WHERE d.source_id = ?1 AND c.embedding IS NOT NULL",
        params![id.as_str(), privacy],
    )?;
    Ok(())
}

// @cpt-dod:cpt-noter-dod-core-knowledge-removal:p1
// @cpt-algo:cpt-noter-algo-core-knowledge-remove-index:p1
/// Deletes the source with its documents, chunks, keyword and vector entries and sync runs in
/// one transaction; a failure rolls everything back and answers `internal`. Files in the folder
/// and remote pages are never touched. Returns the documents removed plus the source.
pub fn remove(
    store: &Store,
    mut meta: ChangeMeta,
    id: &SourceId,
) -> Result<DeleteResult, CoreError> {
    meta.undoable = false;
    let id = id.clone();
    let removed = store.write_with(meta, move |tx| {
        // @cpt-begin:cpt-noter-algo-core-knowledge-remove-index:p1:inst-drop-begin
        let documents: u32 = tx
            .query_row(
                "SELECT COUNT(*) FROM documents WHERE source_id = ?1",
                [id.as_str()],
                |r| r.get(0),
            )
            .map_err(internal)?;
        // @cpt-end:cpt-noter-algo-core-knowledge-remove-index:p1:inst-drop-begin
        // @cpt-begin:cpt-noter-algo-core-knowledge-remove-index:p1:inst-drop-delete
        // The foreign keys cascade to documents, chunks and sync runs; the chunk triggers drop
        // the keyword and vector entries in the same transaction.
        let gone = tx
            .execute("DELETE FROM sources WHERE id = ?1", [id.as_str()])
            .map_err(internal)?;
        if gone == 0 {
            return Err(not_found());
        }
        let tombstone = Logged {
            entity_type: "source",
            entity_id: id.as_str().into(),
            field: None,
            before: None,
            after: None,
            delta: None,
        };
        // @cpt-end:cpt-noter-algo-core-knowledge-remove-index:p1:inst-drop-delete
        Ok((documents, vec![tombstone]))
    });
    // @cpt-begin:cpt-noter-algo-core-knowledge-remove-index:p1:inst-drop-commit
    let documents = match removed {
        Ok(custom) => custom.value,
        Err(e) if e.code == ErrorCode::NotFound => return Err(e),
        Err(e) => return Err(CoreError::new(ErrorCode::Internal, e.message)),
    };
    // @cpt-end:cpt-noter-algo-core-knowledge-remove-index:p1:inst-drop-commit
    // @cpt-begin:cpt-noter-algo-core-knowledge-remove-index:p1:inst-drop-return
    Ok(DeleteResult {
        deleted: documents + 1,
    })
    // @cpt-end:cpt-noter-algo-core-knowledge-remove-index:p1:inst-drop-return
}
