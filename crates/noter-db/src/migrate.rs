//! Numbered migrations. Each crate that owns tables passes its own list to `Store::open`;
//! a migration is identified by its owner and number, so lists never touch each other.

use rusqlite::{params, Connection};

use crate::{now_ms, sqlite_err, OpenError};

/// One numbered migration of one owner (a crate that owns tables).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Migration {
    pub owner: &'static str,
    pub version: u32,
    pub name: &'static str,
    pub sql: &'static str,
}

/// noter-db's own migrations: the change log, then the model-run and egress audit tables
/// (written by noter-llm, which may not touch SQLite itself).
// @cpt-dbtable:cpt-noter-dbtable-changes:p1
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        owner: "noter-db",
        version: 1,
        name: "changes",
        sql: include_str!("../migrations/0001_changes.sql"),
    },
    // @cpt-dbtable:cpt-noter-dbtable-llm-runs:p1
    // @cpt-dbtable:cpt-noter-dbtable-audit-log:p1
    Migration {
        owner: "noter-db",
        version: 2,
        name: "llm runs and audit log",
        sql: include_str!("../migrations/0002_llm_runs_audit_log.sql"),
    },
];

const HISTORY: &str = "CREATE TABLE IF NOT EXISTS schema_migrations (
    owner TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, applied_at INTEGER NOT NULL,
    PRIMARY KEY (owner, version))";

// @cpt-algo:cpt-noter-algo-core-storage-migrate:p1
// @cpt-dod:cpt-noter-dod-core-storage-migrations:p1
pub(crate) fn run(conn: &mut Connection, lists: &[&[Migration]]) -> Result<(), OpenError> {
    let known: Vec<Migration> = lists.iter().flat_map(|l| l.iter().copied()).collect();
    validate(&known)?;
    conn.execute_batch(HISTORY).map_err(sqlite_err)?;
    // @cpt-begin:cpt-noter-algo-core-storage-migrate:p1:inst-read-applied
    let applied = applied(conn).map_err(sqlite_err)?;
    // @cpt-end:cpt-noter-algo-core-storage-migrate:p1:inst-read-applied
    let is_known = |owner: &str, version: u32| {
        known
            .iter()
            .any(|m| m.owner == owner && m.version == version)
    };
    // @cpt-begin:cpt-noter-algo-core-storage-migrate:p1:inst-if-ahead
    if let Some((owner, version)) = applied.iter().find(|(o, v)| !is_known(o, *v)) {
        // @cpt-begin:cpt-noter-algo-core-storage-migrate:p1:inst-return-ahead
        return Err(OpenError::SchemaAhead {
            owner: owner.clone(),
            version: *version,
        });
        // @cpt-end:cpt-noter-algo-core-storage-migrate:p1:inst-return-ahead
    }
    // @cpt-end:cpt-noter-algo-core-storage-migrate:p1:inst-if-ahead
    // @cpt-begin:cpt-noter-algo-core-storage-migrate:p1:inst-for-pending
    for m in known
        .iter()
        .filter(|m| !applied.iter().any(|(o, v)| o == m.owner && *v == m.version))
    {
        // @cpt-begin:cpt-noter-algo-core-storage-migrate:p1:inst-try-apply
        let result = apply(conn, m);
        // @cpt-end:cpt-noter-algo-core-storage-migrate:p1:inst-try-apply
        // @cpt-begin:cpt-noter-algo-core-storage-migrate:p1:inst-catch-apply
        if let Err(e) = result {
            return Err(OpenError::Migration {
                owner: m.owner,
                version: m.version,
                message: e.to_string(),
            });
        }
        // @cpt-end:cpt-noter-algo-core-storage-migrate:p1:inst-catch-apply
    }
    // @cpt-end:cpt-noter-algo-core-storage-migrate:p1:inst-for-pending
    // @cpt-begin:cpt-noter-algo-core-storage-migrate:p1:inst-return-migrated
    Ok(())
    // @cpt-end:cpt-noter-algo-core-storage-migrate:p1:inst-return-migrated
}

/// Within one owner, numbers must strictly increase in list order.
fn validate(known: &[Migration]) -> Result<(), OpenError> {
    for (i, m) in known.iter().enumerate() {
        if known[..i]
            .iter()
            .any(|p| p.owner == m.owner && p.version >= m.version)
        {
            return Err(OpenError::InvalidMigrations(format!(
                "{} migration {} is duplicated or out of order",
                m.owner, m.version
            )));
        }
    }
    Ok(())
}

fn applied(conn: &Connection) -> rusqlite::Result<Vec<(String, u32)>> {
    let mut stmt = conn.prepare("SELECT owner, version FROM schema_migrations")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

/// The migration and its history row in one transaction; dropping it on error rolls both back.
fn apply(conn: &mut Connection, m: &Migration) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(m.sql)?;
    tx.execute(
        "INSERT INTO schema_migrations (owner, version, name, applied_at) VALUES (?1, ?2, ?3, ?4)",
        params![m.owner, m.version, m.name, now_ms()],
    )?;
    tx.commit()
}
