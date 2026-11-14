//! noter-handoff: the handoff launcher (DESIGN-core cpt-noter-component-core-handoff). Renders the
//! handoff skill's output, keeps every prompt version (`prompt_versions`), the repository mappings
//! and the in-flight generations, and orders the launch paths. noter-core wires it to the items,
//! the router and `NativeOps`; this crate touches SQLite only through noter-db.

// @cpt-component:cpt-noter-component-core-handoff:p1

mod generations;
mod launch;
mod prompt;
mod repos;
mod versions;

use noter_db::Migration;

pub use generations::{Begin, Generations};
pub use launch::launch;
pub use prompt::{checked, packet, render, Facts, Quote};
pub use repos::{remove_repo, repos, resolve, upsert_repo};
pub use versions::{append, file_path, versions, NewVersion, Version};

/// noter-handoff's own table; it runs after noter-core's list (`prompt_versions` references
/// `items`).
// @cpt-dbtable:cpt-noter-dbtable-prompt-versions:p1
pub const MIGRATIONS: &[Migration] = &[Migration {
    owner: "noter-handoff",
    version: 1,
    name: "prompt versions",
    sql: include_str!("../migrations/0001_prompt_versions.sql"),
}];

use noter_protocol::internal;
