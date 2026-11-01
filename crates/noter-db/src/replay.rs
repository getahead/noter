//! Undo and redo of logged changes: one transaction on the writer restores the before-values
//! (undo) or applies the after-values again (redo, as new `applied` rows linked by `redo_of`).
//! The restore is generic over `entity_type` + `field`/`delta`: the table is the entity type
//! (or its plural), a `setting` row is a key of `settings`.

use std::collections::BTreeSet;

use noter_protocol::{BatchId, ChangeId, CoreError, ErrorCode};
use rusqlite::types::Value as Sql;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Transaction};
use serde_json::{Map, Value};

use crate::change::{as_text, from_sql, ident};
use crate::{internal, Store};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Undo,
    Redo,
}

/// What `change_undo` / `change_redo` name: one change, or every change of a batch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Handle {
    Change(ChangeId),
    Batch(BatchId),
}

/// What a committed reversal did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reversed {
    /// Changes undone or applied again.
    pub done: u32,
    /// Changes kept because their target was edited later.
    pub skipped: u32,
    /// The entities whose rows moved, as `(entity_type, entity_id)`; a setting is its key.
    pub touched: Vec<(String, String)>,
}

/// Whether a change of this entity can be replayed at all: hotkeys and the setup state live
/// in memory beside their row, so a replay would leave the app out of step with the file.
// shortcut: two names known here, a flag on the change row when a third kind needs it.
pub fn replayable(entity_type: &str, field: Option<&str>) -> bool {
    !(entity_type == "setting" && matches!(field, Some("hotkeys" | "setup")))
}

/// Undone and not edited later, so redo would apply it (the `redoable` of a History row).
pub fn redoable(conn: &Connection, change_id: &str) -> bool {
    let Ok(root) = root_of(conn, change_id) else {
        return false;
    };
    let Ok(latest) = latest_of(conn, &root.id) else {
        return false;
    };
    latest.status == "undone"
        && root.undoable
        && replayable(&root.entity_type, root.field.as_deref())
        && matches!(plan(conn, &latest, Direction::Redo), Ok(Some(_)))
}

impl Store {
    /// Undo or redo a change or a batch in one transaction on the writer; `now` stamps redo rows.
    // @cpt-algo:cpt-noter-algo-core-history-undo-replay:p1
    // @cpt-state:cpt-noter-state-core-history-undo-change:p1
    pub fn reverse(&self, dir: Direction, handle: Handle, now: i64) -> Result<Reversed, CoreError> {
        self.on_writer(move |conn| {
            // @cpt-begin:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-try
            let tx = conn
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(internal)?;
            // @cpt-end:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-try
            // @cpt-begin:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-rollback
            // Any error drops the transaction: nothing is restored and no row is appended.
            let reversed = reverse_tx(&tx, dir, &handle, now)?;
            // @cpt-end:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-rollback
            // @cpt-begin:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-commit
            tx.commit().map_err(internal)?;
            // @cpt-end:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-commit
            // @cpt-begin:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-return
            Ok(reversed)
            // @cpt-end:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-return
        })
    }
}

/// One `changes` row, everything a redo row copies.
struct Row {
    id: String,
    entity_type: String,
    entity_id: String,
    field: Option<String>,
    before: Option<String>,
    after: Option<String>,
    delta: Option<Vec<u8>>,
    status: String,
    batch_id: Option<String>,
    undoable: bool,
    redo_of: Option<String>,
    actor: String,
    summary: String,
    reason: String,
    evidence_ids: String,
    confidence: Option<String>,
    proposal_kind: Option<String>,
    surface: Option<String>,
}

const COLUMNS: &str = "id, entity_type, entity_id, field, before, after, delta, status, batch_id, undoable, \
                       redo_of, actor, summary, reason, evidence_ids, confidence, proposal_kind, surface";

fn row_from(r: &rusqlite::Row) -> rusqlite::Result<Row> {
    Ok(Row {
        id: r.get(0)?,
        entity_type: r.get(1)?,
        entity_id: r.get(2)?,
        field: r.get(3)?,
        before: r.get(4)?,
        after: r.get(5)?,
        delta: r.get(6)?,
        status: r.get(7)?,
        batch_id: r.get(8)?,
        undoable: r.get(9)?,
        redo_of: r.get(10)?,
        actor: r.get(11)?,
        summary: r.get(12)?,
        reason: r.get(13)?,
        evidence_ids: r.get(14)?,
        confidence: r.get(15)?,
        proposal_kind: r.get(16)?,
        surface: r.get(17)?,
    })
}

fn rows(conn: &Connection, filter: &str, arg: &str) -> Result<Vec<Row>, CoreError> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {COLUMNS} FROM changes WHERE {filter} ORDER BY rowid"
        ))
        .map_err(unreadable)?;
    let found = stmt
        .query_map([arg], row_from)
        .map_err(unreadable)?
        .collect::<Result<_, _>>()
        .map_err(unreadable)?;
    Ok(found)
}

fn unreadable(e: impl std::fmt::Display) -> CoreError {
    CoreError::new(ErrorCode::ChangeLogUnreadable, e.to_string())
}

fn not_found(what: &str) -> CoreError {
    CoreError::new(ErrorCode::NotFound, format!("no such {what}"))
}

/// The change a handle names, or the original of a redo row: redo rows are handles for it.
fn root_of(conn: &Connection, id: &str) -> Result<Row, CoreError> {
    let row = rows(conn, "id = ?1", id)?
        .pop()
        .ok_or_else(|| not_found("change"))?;
    match row.redo_of {
        Some(root) => rows(conn, "id = ?1", &root)?
            .pop()
            .ok_or_else(|| unreadable("a redo row without its original")),
        None => Ok(row),
    }
}

/// The newest row of a change's chain (the original and its redo rows): its status is the
/// change's current state.
fn latest_of(conn: &Connection, root: &str) -> Result<Row, CoreError> {
    rows(conn, "id = ?1 OR redo_of = ?1", root)?
        .pop()
        .ok_or_else(|| not_found("change"))
}

fn reverse_tx(
    tx: &Transaction,
    dir: Direction,
    handle: &Handle,
    now: i64,
) -> Result<Reversed, CoreError> {
    // @cpt-begin:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-load
    let roots = match handle {
        Handle::Change(id) => vec![root_of(tx, id.as_str())?],
        Handle::Batch(id) => {
            let members = rows(tx, "batch_id = ?1 AND redo_of IS NULL", id.as_str())?;
            if members.is_empty() {
                return Err(not_found("batch"));
            }
            members
        }
    };
    // @cpt-end:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-load
    let (mut irreversible, mut undone, mut applied) = (false, false, false);
    let mut chosen = Vec::new();
    for root in &roots {
        let latest = latest_of(tx, &root.id)?;
        let replay = root.undoable && replayable(&root.entity_type, root.field.as_deref());
        match (dir, latest.status.as_str()) {
            (Direction::Undo, "applied") if replay => chosen.push(latest),
            (Direction::Redo, "undone") if replay => chosen.push(latest),
            (Direction::Undo, "undone") => undone = true,
            (Direction::Redo, "applied" | "proposed" | "rejected") => applied = true,
            // Irreversible, proposed or rejected: these commands never touch them.
            _ => irreversible = true,
        }
    }
    if chosen.is_empty() {
        // @cpt-begin:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-undo-guard
        // @cpt-begin:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-redo-guard
        return Err(if irreversible {
            CoreError::new(ErrorCode::NotUndoable, "this change cannot be reversed")
        } else if undone {
            CoreError::new(ErrorCode::AlreadyUndone, "this change is already undone")
        } else {
            debug_assert!(applied);
            CoreError::new(ErrorCode::NotUndone, "this change is not undone")
        });
        // @cpt-end:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-redo-guard
        // @cpt-end:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-undo-guard
    }
    // Undo walks the log backwards so a later change to a column is restored first.
    if dir == Direction::Undo {
        chosen.reverse();
    }
    let mut done = 0;
    let mut skipped = 0;
    let mut touched = BTreeSet::new();
    let mut settings_moved = false;
    for latest in &chosen {
        // @cpt-begin:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-check-later
        let Some(act) = plan(tx, latest, dir)? else {
            // @cpt-begin:cpt-noter-state-core-history-undo-change:p1:inst-st-ineligible
            // @cpt-begin:cpt-noter-state-core-history-undo-change:p1:inst-st-redo-blocked
            skipped += 1;
            continue;
            // @cpt-end:cpt-noter-state-core-history-undo-change:p1:inst-st-redo-blocked
            // @cpt-end:cpt-noter-state-core-history-undo-change:p1:inst-st-ineligible
        };
        // @cpt-end:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-check-later
        let target = match &act {
            Act::Setting { key, .. } => (latest.entity_type.clone(), key.clone()),
            _ => (latest.entity_type.clone(), latest.entity_id.clone()),
        };
        settings_moved |= matches!(act, Act::Setting { .. });
        // @cpt-begin:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-before
        // @cpt-begin:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-after
        act.run(tx)?;
        match dir {
            Direction::Undo => {
                // @cpt-begin:cpt-noter-state-core-history-undo-change:p1:inst-st-undo
                tx.execute(
                    "UPDATE changes SET status = 'undone' WHERE id = ?1",
                    [&latest.id],
                )
                .map_err(internal)?;
                // @cpt-end:cpt-noter-state-core-history-undo-change:p1:inst-st-undo
            }
            Direction::Redo => {
                // @cpt-begin:cpt-noter-state-core-history-undo-change:p1:inst-st-redo
                append_redo(tx, latest, now)?
                // @cpt-end:cpt-noter-state-core-history-undo-change:p1:inst-st-redo
            }
        }
        // @cpt-end:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-after
        // @cpt-end:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-before
        touched.insert(target);
        done += 1;
    }
    // @cpt-begin:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-all-skipped
    if done == 0 {
        return Err(CoreError::new(
            ErrorCode::EditedLater,
            "every change was edited later",
        ));
    }
    // @cpt-end:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-all-skipped
    if settings_moved {
        let rev: Option<String> = tx
            .query_row("SELECT value FROM settings WHERE key = 'rev'", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(internal)?;
        let next = rev.map_or(Ok(1), |v| v.parse::<u32>()).map_err(internal)? + 1;
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('rev', ?1)",
            [next.to_string()],
        )
        .map_err(internal)?;
    }
    Ok(Reversed {
        done,
        skipped,
        touched: touched.into_iter().collect(),
    })
}

/// A redo is a new applied row linked to the original, with the same actor, reason, evidence
/// and batch.
fn append_redo(tx: &Transaction, latest: &Row, now: i64) -> Result<(), CoreError> {
    let root = latest.redo_of.as_deref().unwrap_or(&latest.id);
    tx.execute(
        "INSERT INTO changes (id, ts, actor, entity_type, entity_id, field, before, after, delta, summary,
                              reason, evidence_ids, confidence, status, batch_id, proposal_kind, undoable,
                              redo_of, surface)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'applied', ?14, ?15, 1, ?16, ?17)",
        params![
            format!("chg_{}", ulid::Ulid::generate()),
            now,
            latest.actor,
            latest.entity_type,
            latest.entity_id,
            latest.field,
            latest.before,
            latest.after,
            latest.delta,
            latest.summary,
            latest.reason,
            latest.evidence_ids,
            latest.confidence,
            latest.batch_id,
            latest.proposal_kind,
            root,
            latest.surface,
        ],
    )
    .map_err(internal)?;
    Ok(())
}

/// One column of a change: the value before and after, as text.
struct Op {
    column: String,
    before: Option<String>,
    after: Option<String>,
}

/// Single deltas (`field`, `before`, `after`) and several-column deltas (`{"col": [before, after]}`).
// @cpt-begin:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-deltas
fn ops(row: &Row) -> Result<Vec<Op>, CoreError> {
    if let Some(blob) = &row.delta {
        let Value::Object(columns) = serde_json::from_slice(blob).map_err(unreadable)? else {
            return Err(unreadable("a delta that is not an object"));
        };
        return columns
            .into_iter()
            .map(|(column, pair)| match pair.as_array().map(Vec::as_slice) {
                Some([before, after]) if ident(&column) => Ok(Op {
                    column,
                    before: as_text(before),
                    after: as_text(after),
                }),
                _ => Err(unreadable("a delta entry that is not [before, after]")),
            })
            .collect();
    }
    match &row.field {
        // A setting's field is a bound key; any other is spliced into SQL as a column name.
        Some(field) if row.entity_type == "setting" || ident(field) => Ok(vec![Op {
            column: field.clone(),
            before: row.before.clone(),
            after: row.after.clone(),
        }]),
        _ => Err(unreadable(
            "a change with neither a usable field nor a delta",
        )),
    }
}
// @cpt-end:cpt-noter-algo-core-history-undo-replay:p1:inst-replay-deltas

type Values = Vec<(String, Option<String>)>;

/// What restoring one change does to its row.
enum Act {
    Setting {
        key: String,
        value: Option<String>,
    },
    Update {
        table: String,
        id: String,
        sets: Values,
        bump: bool,
    },
    Insert {
        table: String,
        id: String,
        values: Values,
    },
    Delete {
        table: String,
        id: String,
    },
}

impl Act {
    fn run(&self, tx: &Transaction) -> Result<(), CoreError> {
        let text = |v: &Option<String>| v.clone().map_or(Sql::Null, Sql::Text);
        match self {
            Act::Setting {
                key,
                value: Some(v),
            } => tx.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                [key, v],
            ),
            Act::Setting { key, value: None } => {
                tx.execute("DELETE FROM settings WHERE key = ?1", [key])
            }
            Act::Delete { table, id } => {
                tx.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])
            }
            Act::Update {
                table,
                id,
                sets,
                bump,
            } => {
                let mut assigns: Vec<String> =
                    sets.iter().map(|(c, _)| format!("{c} = ?")).collect();
                if *bump {
                    assigns.push("rev = rev + 1".into());
                }
                let mut args: Vec<Sql> = sets.iter().map(|(_, v)| text(v)).collect();
                args.push(Sql::Text(id.clone()));
                tx.execute(
                    &format!("UPDATE {table} SET {} WHERE id = ?", assigns.join(", ")),
                    params_from_iter(args),
                )
            }
            Act::Insert { table, id, values } => {
                let names: String = values.iter().map(|(c, _)| format!("{c}, ")).collect();
                let mut args: Vec<Sql> = values.iter().map(|(_, v)| text(v)).collect();
                args.push(Sql::Text(id.clone()));
                tx.execute(
                    &format!(
                        "INSERT INTO {table} ({names}id) VALUES ({}?)",
                        "?, ".repeat(values.len())
                    ),
                    params_from_iter(args),
                )
            }
        }
        .map(drop)
        .map_err(restore_error)
    }
}

/// A restore that a unique or foreign-key constraint refuses means another row got in the way.
fn restore_error(e: rusqlite::Error) -> CoreError {
    match &e {
        rusqlite::Error::SqliteFailure(f, _)
            if f.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            CoreError::new(
                ErrorCode::Conflict,
                "restoring would clash with a row that exists now",
            )
        }
        _ => internal(e),
    }
}

struct Column {
    name: String,
    required: bool,
}

/// The table an entity type is stored in: its own name or the plural (`summary`: `summaries`).
fn table_of(conn: &Connection, entity_type: &str) -> Result<String, CoreError> {
    let ies = entity_type
        .strip_suffix('y')
        .map(|stem| format!("{stem}ies"));
    for name in [entity_type.to_string(), format!("{entity_type}s")]
        .into_iter()
        .chain(ies)
    {
        let found: Option<String> = conn
            .query_row(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1 AND name != 'changes'",
                [&name],
                |r| r.get(0),
            )
            .optional()
            .map_err(internal)?;
        if let Some(table) = found.filter(|t| ident(t)) {
            return Ok(table);
        }
    }
    Err(CoreError::new(
        ErrorCode::NotUndoable,
        format!("{entity_type} changes cannot be replayed"),
    ))
}

fn columns_of(conn: &Connection, table: &str) -> Result<Vec<Column>, CoreError> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(internal)?;
    let columns = stmt
        .query_map([], |r| {
            let (notnull, default, pk): (bool, Option<String>, i64) =
                (r.get(3)?, r.get(4)?, r.get(5)?);
            Ok(Column {
                name: r.get(1)?,
                required: notnull && default.is_none() && pk == 0,
            })
        })
        .map_err(internal)?
        .collect::<Result<_, _>>()
        .map_err(internal)?;
    Ok(columns)
}

fn current_row(
    conn: &Connection,
    table: &str,
    id: &str,
) -> Result<Option<Map<String, Value>>, CoreError> {
    let mut stmt = conn
        .prepare(&format!("SELECT * FROM {table} WHERE id = ?1"))
        .map_err(internal)?;
    let names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
    stmt.query_row([id], |row| {
        names
            .iter()
            .enumerate()
            .map(|(i, name)| Ok((name.clone(), from_sql(row.get_ref(i)?))))
            .collect()
    })
    .optional()
    .map_err(internal)
}

/// What restoring `row` would do, or `None` when its target was edited since: each column
/// must still hold the value the change left (undo) or the value the undo restored (redo).
fn plan(conn: &Connection, row: &Row, dir: Direction) -> Result<Option<Act>, CoreError> {
    let (expected, target): (Values, Values) = ops(row)?
        .into_iter()
        .map(|op| match dir {
            Direction::Undo => ((op.column.clone(), op.after), (op.column, op.before)),
            Direction::Redo => ((op.column.clone(), op.before), (op.column, op.after)),
        })
        .unzip();
    if row.entity_type == "setting" {
        let key = row
            .field
            .clone()
            .ok_or_else(|| unreadable("a setting without a key"))?;
        let held: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [&key], |r| {
                r.get(0)
            })
            .optional()
            .map_err(internal)?;
        let value = target.into_iter().next().and_then(|(_, v)| v);
        return Ok((held == expected[0].1).then_some(Act::Setting { key, value }));
    }
    let table = table_of(conn, &row.entity_type)?;
    let columns = columns_of(conn, &table)?;
    let found = current_row(conn, &table, &row.entity_id)?;
    let held = |column: &str| found.as_ref().and_then(|r| r.get(column)).and_then(as_text);
    if expected.iter().any(|(c, v)| held(c) != *v) {
        return Ok(None);
    }
    // A row that carries a value for every column it cannot do without can be inserted whole.
    let whole = |values: &Values| {
        columns
            .iter()
            .filter(|c| c.required && c.name != "rev")
            .all(|c| values.iter().any(|(n, v)| *n == c.name && v.is_some()))
    };
    let several = target.len() >= 2;
    let has_rev = columns.iter().any(|c| c.name == "rev");
    let id = row.entity_id.clone();
    Ok(match found {
        Some(_) if several && target.iter().all(|(_, v)| v.is_none()) && whole(&expected) => {
            Some(Act::Delete { table, id })
        }
        Some(_) => Some(Act::Update {
            bump: has_rev && target.iter().all(|(c, _)| c != "rev"),
            table,
            id,
            sets: target,
        }),
        None if several && whole(&target) => {
            let mut values: Values = target.into_iter().filter(|(_, v)| v.is_some()).collect();
            if has_rev && values.iter().all(|(c, _)| c != "rev") {
                values.push(("rev".into(), Some("1".into())));
            }
            Some(Act::Insert { table, id, values })
        }
        None => None,
    })
}
