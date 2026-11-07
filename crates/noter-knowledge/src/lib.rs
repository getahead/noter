//! noter-knowledge: knowledge sources (DESIGN-core cpt-noter-component-core-knowledge). Folder
//! sources watched through `notify`, indexed MCP servers through the [`McpSource`] seam with
//! their tokens in the Keychain, text extraction for the six formats, heading chunks, the
//! sync job on the M2 scheduler with bge-m3 embeddings from the engine, the source policy that
//! retrieval applies to document hits, and removal in one transaction. noter-core wires it to its
//! commands, the scheduler and the native folder panel; this crate touches SQLite only through
//! noter-db.

// @cpt-component:cpt-noter-component-core-knowledge:p1

mod chunk;
mod extract;
mod mcp;
mod policy;
mod sources;
mod sync;
mod watch;

use noter_db::Migration;

pub use chunk::{normalize, Chunk};
pub use mcp::{
    due, Listing, McpError, McpSource, Page, RemoteDoc, ScriptedListing, ScriptedMcp,
    ScriptedOauth, ScriptedPage, ScriptedServer,
};
pub use policy::{keyword_chunks, nearest_chunks, permitted_chunks, Permitted};
pub use sources::{
    add_folder, add_mcp, get, list, remove, revoke, token_account, update, validate_folder,
};
pub use sync::{sync, SyncEnv};
pub use watch::Watchers;

/// noter-knowledge's own tables (TL-34); it runs after noter-core's list (the policy reads
/// `calls` and `speakers`).
// @cpt-dbtable:cpt-noter-dbtable-sources:p1
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        owner: "noter-knowledge",
        version: 1,
        name: "sources and their index",
        sql: include_str!("../migrations/0001_sources.sql"),
    },
    Migration {
        owner: "noter-knowledge",
        version: 2,
        name: "document keywords at word starts",
        sql: include_str!("../migrations/0002_doc_keywords.sql"),
    },
];

fn internal(e: impl std::fmt::Display) -> noter_protocol::CoreError {
    noter_protocol::CoreError::new(noter_protocol::ErrorCode::Internal, e.to_string())
}
