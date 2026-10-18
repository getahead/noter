//! The one write path: a mutation and its `changes` row commit in one transaction.

use noter_protocol::ipc::NativeSurface;
use noter_protocol::model::Actor;
use noter_protocol::{BatchId, ChangeId, CoreError, ErrorCode, ErrorDetail, EvidenceId, Rev};
use rusqlite::types::{Value as Sql, ValueRef};
use rusqlite::{params, params_from_iter, OptionalExtension, Transaction, TransactionBehavior};
use serde_json::{Map, Value};

use crate::{internal, now_ms, Store};

/// The wanted state of one row: `values` are the columns to set. `id` and `rev` are the store's.
#[derive(Debug, Clone, PartialEq)]
pub struct Mutation {
    /// Written to `changes.entity_type` (`item`, `call`, …).
    pub entity_type: &'static str,
    pub table: &'static str,
    pub id: String,
    /// The `rev` the caller last saw, for user-editable records; `None` skips the check.
    pub base_rev: Option<Rev>,
    /// Whether the write moves the row's `rev`; `false` leaves it alone (or the table has none).
    pub bump_rev: bool,
    pub values: Vec<(&'static str, Value)>,
}

/// Who wrote, and why: the change row's metadata, shared by every row of a batch.
#[derive(Debug, Clone, PartialEq)]
pub struct ChangeMeta {
    pub actor: Actor,
    pub summary: String,
    pub reason: String,
    pub evidence_ids: Vec<EvidenceId>,
    pub batch_id: Option<BatchId>,
    pub undoable: bool,
    /// The native surface (menu, menu bar, hotkey, notification) that sent the command, if any.
    pub surface: Option<NativeSurface>,
}

/// A committed write: the stored row, its new `rev` and its change row.
#[derive(Debug, Clone, PartialEq)]
pub struct Written {
    pub entity_type: &'static str,
    pub id: String,
    /// The stored row, column by column.
    pub record: Value,
    pub rev: Rev,
    pub change_id: ChangeId,
    pub batch_id: Option<BatchId>,
}

struct Committed {
    record: Value,
    rev: Rev,
    change_id: ChangeId,
}

impl Store {
    /// Write one row with its change row.
    pub fn write(&self, mutation: Mutation, meta: ChangeMeta) -> Result<Written, CoreError> {
        let mut written = self.commit(vec![mutation], meta)?;
        Ok(written.remove(0))
    }

    /// Write several rows in one transaction, every change row under one batch id
    /// (the caller's, or a new `bat_` id). One stale row fails them all.
    pub fn write_batch(
        &self,
        mutations: Vec<Mutation>,
        mut meta: ChangeMeta,
    ) -> Result<Vec<Written>, CoreError> {
        meta.batch_id
            .get_or_insert_with(|| BatchId::new(format!("bat_{}", ulid::Ulid::generate())));
        self.commit(mutations, meta)
    }

    // @cpt-flow:cpt-noter-flow-core-storage-write:p1
    // @cpt-dod:cpt-noter-dod-core-storage-change-log:p1
    fn commit(
        &self,
        mutations: Vec<Mutation>,
        meta: ChangeMeta,
    ) -> Result<Vec<Written>, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-storage-write:p1:inst-submit
        let targets: Vec<(&'static str, String)> = mutations
            .iter()
            .map(|m| (m.entity_type, m.id.clone()))
            .collect();
        let batch_id = meta.batch_id.clone();
        // @cpt-end:cpt-noter-flow-core-storage-write:p1:inst-submit
        // @cpt-begin:cpt-noter-flow-core-storage-write:p1:inst-run-change-tx
        let result = self.on_writer(move |conn| change_tx(conn, &mutations, &meta));
        // @cpt-end:cpt-noter-flow-core-storage-write:p1:inst-run-change-tx
        let committed = match result {
            // @cpt-begin:cpt-noter-flow-core-storage-write:p1:inst-if-conflict
            Err(e) if e.code == ErrorCode::Conflict => {
                // @cpt-begin:cpt-noter-flow-core-storage-write:p1:inst-return-conflict
                return Err(e);
                // @cpt-end:cpt-noter-flow-core-storage-write:p1:inst-return-conflict
            }
            // @cpt-end:cpt-noter-flow-core-storage-write:p1:inst-if-conflict
            other => other?,
        };
        // @cpt-begin:cpt-noter-flow-core-storage-write:p1:inst-after-commit
        let written = committed
            .into_iter()
            .zip(targets)
            .map(|(c, (entity_type, id))| Written {
                entity_type,
                id,
                record: c.record,
                rev: c.rev,
                change_id: c.change_id,
                batch_id: batch_id.clone(),
            })
            .collect();
        // @cpt-end:cpt-noter-flow-core-storage-write:p1:inst-after-commit
        // @cpt-begin:cpt-noter-flow-core-storage-write:p1:inst-return-written
        Ok(written)
        // @cpt-end:cpt-noter-flow-core-storage-write:p1:inst-return-written
    }
}

// @cpt-algo:cpt-noter-algo-core-storage-change-tx:p1
fn change_tx(
    conn: &mut rusqlite::Connection,
    mutations: &[Mutation],
    meta: &ChangeMeta,
) -> Result<Vec<Committed>, CoreError> {
    // @cpt-begin:cpt-noter-algo-core-storage-change-tx:p1:inst-begin
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(internal)?;
    // @cpt-end:cpt-noter-algo-core-storage-change-tx:p1:inst-begin
    let mut out = Vec::with_capacity(mutations.len());
    for m in mutations {
        check(m)?;
        // @cpt-begin:cpt-noter-algo-core-storage-change-tx:p1:inst-select-current
        let before = select_row(&tx, m).map_err(internal)?;
        let stored_rev = before.as_ref().and_then(rev_of);
        // @cpt-end:cpt-noter-algo-core-storage-change-tx:p1:inst-select-current
        // @cpt-begin:cpt-noter-algo-core-storage-change-tx:p1:inst-if-stale
        if m.base_rev.is_some_and(|base| Some(base) != stored_rev) {
            // @cpt-begin:cpt-noter-algo-core-storage-change-tx:p1:inst-return-stale
            tx.rollback().map_err(internal)?;
            let current_rev = stored_rev.unwrap_or(Rev(0));
            return Err(CoreError::new(
                ErrorCode::Conflict,
                format!("{} {} changed since its rev", m.entity_type, m.id),
            )
            .with_detail(ErrorDetail::Conflict { current_rev }));
            // @cpt-end:cpt-noter-algo-core-storage-change-tx:p1:inst-return-stale
        }
        // @cpt-end:cpt-noter-algo-core-storage-change-tx:p1:inst-if-stale
        // @cpt-begin:cpt-noter-algo-core-storage-change-tx:p1:inst-write-row
        let new_rev = m.bump_rev.then(|| Rev(stored_rev.map_or(1, |r| r.0 + 1)));
        write_row(&tx, m, new_rev, before.is_some()).map_err(internal)?;
        let after = select_row(&tx, m).map_err(internal)?.unwrap_or(Value::Null);
        let rev = rev_of(&after).unwrap_or(Rev(0));
        // @cpt-end:cpt-noter-algo-core-storage-change-tx:p1:inst-write-row
        // @cpt-begin:cpt-noter-algo-core-storage-change-tx:p1:inst-insert-change
        let change_id = ChangeId::new(format!("chg_{}", ulid::Ulid::generate()));
        let field = match m.values.as_slice() {
            [(column, _)] => Some(*column),
            _ => None,
        };
        tx.execute(
            "INSERT INTO changes (id, ts, actor, entity_type, entity_id, field, before, after, summary, reason,
                                  evidence_ids, status, batch_id, undoable, surface)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'applied', ?12, ?13, ?14)",
            params![
                change_id.as_str(),
                now_ms(),
                actor_column(&meta.actor),
                m.entity_type,
                m.id,
                field,
                before.map(|b| b.to_string()),
                after.to_string(),
                meta.summary,
                meta.reason,
                serde_json::to_string(&meta.evidence_ids).map_err(internal)?,
                meta.batch_id.as_ref().map(BatchId::as_str),
                meta.undoable,
                meta.surface.map(surface_column),
            ],
        )
        .map_err(internal)?;
        // @cpt-end:cpt-noter-algo-core-storage-change-tx:p1:inst-insert-change
        out.push(Committed {
            record: after,
            rev,
            change_id,
        });
    }
    // @cpt-begin:cpt-noter-algo-core-storage-change-tx:p1:inst-commit
    tx.commit().map_err(internal)?;
    // @cpt-end:cpt-noter-algo-core-storage-change-tx:p1:inst-commit
    // @cpt-begin:cpt-noter-algo-core-storage-change-tx:p1:inst-return-tx
    Ok(out)
    // @cpt-end:cpt-noter-algo-core-storage-change-tx:p1:inst-return-tx
}

/// `you`, `job:<id>`, `llm_run:<id>` (DESIGN-core 3.7, table `changes`).
fn actor_column(actor: &Actor) -> String {
    match actor {
        Actor::You => "you".into(),
        Actor::Job { job_id, .. } => format!("job:{job_id}"),
        Actor::Model { llm_run_id, .. } => format!("llm_run:{llm_run_id}"),
    }
}

fn surface_column(surface: NativeSurface) -> &'static str {
    match surface {
        NativeSurface::Menu => "menu",
        NativeSurface::MenuBar => "menu_bar",
        NativeSurface::Hotkey => "hotkey",
        NativeSurface::Notification => "notification",
    }
}

fn rev_of(row: &Value) -> Option<Rev> {
    row["rev"].as_u64().map(|r| Rev(r as u32))
}

/// Table and column names are spliced into SQL, so they must be plain identifiers.
fn check(m: &Mutation) -> Result<(), CoreError> {
    let ident = |s: &str| {
        s.starts_with(|c: char| c.is_ascii_lowercase())
            && s.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    };
    if ident(m.table) && !m.values.is_empty() && m.values.iter().all(|(c, _)| ident(c)) {
        Ok(())
    } else {
        Err(internal(format!("invalid mutation of {:?}", m.table)))
    }
}

fn select_row(tx: &Transaction, m: &Mutation) -> rusqlite::Result<Option<Value>> {
    let mut stmt = tx.prepare(&format!("SELECT * FROM {} WHERE id = ?1", m.table))?;
    let names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
    stmt.query_row([&m.id], |row| {
        let mut record = Map::new();
        for (i, name) in names.iter().enumerate() {
            record.insert(name.clone(), from_sql(row.get_ref(i)?));
        }
        Ok(Value::Object(record))
    })
    .optional()
}

/// Sets the given columns, and `rev` when one is given; `id` and `rev` from the caller are ignored.
fn write_row(
    tx: &Transaction,
    m: &Mutation,
    rev: Option<Rev>,
    exists: bool,
) -> rusqlite::Result<usize> {
    let mut columns: Vec<&str> = Vec::new();
    let mut args: Vec<Sql> = Vec::new();
    for (column, value) in m.values.iter().filter(|(c, _)| !matches!(*c, "id" | "rev")) {
        columns.push(column);
        args.push(to_sql(value));
    }
    if let Some(rev) = rev {
        columns.push("rev");
        args.push(Sql::Integer(rev.0.into()));
    }
    args.push(Sql::Text(m.id.clone()));
    let sql = if exists {
        let sets: Vec<String> = columns.iter().map(|c| format!("{c} = ?")).collect();
        format!("UPDATE {} SET {} WHERE id = ?", m.table, sets.join(", "))
    } else {
        let names: String = columns.iter().map(|c| format!("{c}, ")).collect();
        format!(
            "INSERT INTO {} ({names}id) VALUES ({}?)",
            m.table,
            "?, ".repeat(columns.len())
        )
    };
    tx.execute(&sql, params_from_iter(args))
}

fn to_sql(v: &Value) -> Sql {
    match v {
        Value::Null => Sql::Null,
        Value::Bool(b) => Sql::Integer((*b).into()),
        Value::Number(n) => n
            .as_i64()
            .map_or_else(|| Sql::Real(n.as_f64().unwrap_or_default()), Sql::Integer),
        Value::String(s) => Sql::Text(s.clone()),
        other => Sql::Text(other.to_string()),
    }
}

fn from_sql(v: ValueRef) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => i.into(),
        ValueRef::Real(f) => f.into(),
        ValueRef::Text(t) => String::from_utf8_lossy(t).into(),
        ValueRef::Blob(b) => b.to_vec().into(),
    }
}
