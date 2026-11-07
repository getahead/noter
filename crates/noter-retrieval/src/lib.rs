//! noter-retrieval: retrieval and Ask (DESIGN-core `cpt-noter-component-core-retrieval`). The
//! keyword shadows and vector indexes over calls and items, the one retrieval function behind
//! search, Ask, the copilot and the pre-call brief, sectioned search, Ask scope presets and the
//! index rebuild. noter-core wires it to the store, the engine and the jobs; this crate touches
//! SQLite only through noter-db and calls the engine only for embeddings.

// @cpt-component:cpt-noter-component-core-retrieval:p1

mod index;
mod normalize;
mod presets;
mod retrieve;
mod search;

use noter_db::Migration;

pub use index::{embed_query, missing, rebuild, stale, Embedder, Index, Readiness, Run, DIMS};
pub use normalize::{normalize, terms};
pub use presets::scope_presets;
pub use retrieve::{
    day_number, prepare, retrieve, DocHits, DocQuery, DocumentSource, Evidence, Hit, NoDocuments,
    Prepared, Privacy, Query, Retrieved, Scope, MIN_SIMILARITY, OVER_FETCH, RRF_K,
};
pub use search::{search, search_request, DEFAULT_LIMIT, MAX_LIMIT};

/// noter-retrieval's own tables; the list runs after noter-core's (its triggers read
/// `segments`, `items` and `chunks`).
// @cpt-dbtable:cpt-noter-dbtable-topics:p1
// @cpt-dbtable:cpt-noter-dbtable-suppressions:p1
// @cpt-dbtable:cpt-noter-dbtable-ask-threads:p1
pub const MIGRATIONS: &[Migration] = &[Migration {
    owner: "noter-retrieval",
    version: 1,
    name: "topics, ask threads, keyword and vector indexes",
    sql: include_str!("../migrations/0001_retrieval.sql"),
}];

#[cfg(test)]
mod tests;
