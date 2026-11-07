//! noter-retrieval: retrieval and Ask (DESIGN-core `cpt-noter-component-core-retrieval`). The
//! keyword shadows and vector indexes over calls and items, the one retrieval function behind
//! search, Ask, the copilot and the pre-call brief, sectioned search, Ask scope presets, the
//! index rebuild, and topic threads with the attachment of new items to them. noter-core wires
//! it to the store, the engine and the jobs; this crate touches SQLite only through noter-db and
//! calls the engine only for embeddings.

// @cpt-component:cpt-noter-component-core-retrieval:p1

mod ask;
mod index;
mod normalize;
mod presets;
mod retrieve;
mod search;
mod topics;

use noter_db::Migration;

pub use ask::{
    ask_query, begin_turn, check_answer, check_start, delete_thread, evidence_id, finish_turn,
    only_weak, prior_turns, sensitive, thread, threads, Checked, Ending, NewTurn, Prior, ASK_HITS,
    NOT_FOUND_MD,
};
pub use index::{embed_query, missing, rebuild, stale, Embedder, Index, Readiness, Run, DIMS};
pub use normalize::{normalize, terms};
pub use presets::scope_presets;
pub use retrieve::{
    day_number, prepare, retrieve, DocHits, DocQuery, DocumentSource, Evidence, Hit, NoDocuments,
    Prepared, Privacy, Query, Retrieved, Scope, MIN_SIMILARITY, OVER_FETCH, RRF_K,
};
pub use search::{search, search_request, DEFAULT_LIMIT, MAX_LIMIT};
pub use topics::{
    attach_topics, keep_separate, merge, refresh_centroids, rename, thread_items, topic_list,
    topic_name, topic_row, Attached, NewItem, ATTACH_SIMILARITY, SUGGEST_SIMILARITY,
};

/// noter-retrieval's own tables; the list runs after noter-core's (its triggers read
/// `segments`, `items` and `chunks`).
// @cpt-dbtable:cpt-noter-dbtable-topics:p1
// @cpt-dbtable:cpt-noter-dbtable-suppressions:p1
// @cpt-dbtable:cpt-noter-dbtable-ask-threads:p1
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        owner: "noter-retrieval",
        version: 1,
        name: "topics, ask threads, keyword and vector indexes",
        sql: include_str!("../migrations/0001_retrieval.sql"),
    },
    Migration {
        owner: "noter-retrieval",
        version: 2,
        name: "ask turn flags",
        sql: include_str!("../migrations/0002_ask_turn_flags.sql"),
    },
    Migration {
        owner: "noter-retrieval",
        version: 3,
        name: "topic alias ids and the item topic index",
        sql: include_str!("../migrations/0003_topic_alias_ids.sql"),
    },
];

#[cfg(test)]
mod tests;
