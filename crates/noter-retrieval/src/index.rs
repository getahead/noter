//! Index readiness (`cpt-noter-state-core-retrieval-ask-index`) and the rebuild of the vector
//! indexes from canonical data (`cpt-noter-algo-core-retrieval-ask-rebuild`). The keyword shadows
//! are kept by the migration's triggers; the vectors come from `chunks.embedding` and from the
//! items' text embedded locally, in bounded batches, never inside a writer transaction.

use std::sync::{Mutex, MutexGuard};

use noter_db::rusqlite::{params, Connection};
use noter_db::{ChangeMeta, Logged, Store};
use noter_engine_client::{EngineClient, EngineLauncher};
use noter_jobs::{BoxFuture, RunCtx, Stop};
use noter_protocol::model::SearchMode;
use noter_protocol::{CoreError, ErrorCode};

/// bge-m3 dimensions.
pub const DIMS: usize = 1024;
/// Chunk vectors copied per writer transaction.
const CHUNK_BATCH: i64 = 200;
/// Item texts per embedding request and writer transaction.
const ITEM_BATCH: i64 = 32;

/// Local text embeddings (the engine's bge-m3): one finite `DIMS`-value row per text, in order.
pub trait Embedder: Send + Sync {
    fn embed(&self, texts: Vec<String>) -> BoxFuture<'_, Result<Vec<Vec<f32>>, String>>;
}

impl<L: EngineLauncher> Embedder for EngineClient<L> {
    fn embed(&self, texts: Vec<String>) -> BoxFuture<'_, Result<Vec<Vec<f32>>, String>> {
        Box::pin(async move {
            let id = ulid::Ulid::generate();
            // One text comes back inline; a batch through a file in the container.
            let out = (texts.len() != 1).then(|| format!("index/embed-{id}.f32"));
            let wanted = texts.len();
            let rows = self
                .embed_texts(format!("emb_{id}"), texts, out)
                .await
                .map_err(|e| format!("{e:?}"))?;
            let valid = rows.len() == wanted
                && rows
                    .iter()
                    .all(|v| v.len() == DIMS && v.iter().all(|x| x.is_finite()));
            valid
                .then_some(rows)
                .ok_or_else(|| "embeddings of the wrong shape".into())
        })
    }
}

/// The query's embedding, or `None` (the request runs keyword-only) when the engine fails.
pub async fn embed_query(embedder: &dyn Embedder, text: &str) -> Option<Vec<f32>> {
    if text.trim().is_empty() {
        return None;
    }
    embedder.embed(vec![text.to_owned()]).await.ok()?.pop()
}

/// What the rebuild needs from its job run (`noter_jobs::RunCtx`): safe boundaries, where it
/// may pause or stop, and the run's change metadata.
pub trait Run: Send {
    fn checkpoint(&mut self) -> BoxFuture<'_, Result<(), Stop>>;
    fn change_meta(&self, summary: &str) -> Option<ChangeMeta>;
}

impl Run for RunCtx {
    fn checkpoint(&mut self) -> BoxFuture<'_, Result<(), Stop>> {
        Box::pin(RunCtx::checkpoint(self))
    }

    fn change_meta(&self, summary: &str) -> Option<ChangeMeta> {
        RunCtx::change_meta(self, summary)
    }
}

/// Whether searches can use the vector indexes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Readiness {
    Hybrid,
    KeywordOnly { progress: f32 },
}

// @cpt-state:cpt-noter-state-core-retrieval-ask-index:p1
/// The readiness the core shares between searches and the rebuild job; keyword-only until the
/// indexes are known to hold every committed change.
pub struct Index(Mutex<Readiness>);

impl Default for Index {
    fn default() -> Self {
        Self(Mutex::new(Readiness::KeywordOnly { progress: 0.0 }))
    }
}

impl Index {
    pub fn readiness(&self) -> Readiness {
        *self.lock()
    }

    pub fn mode(&self) -> SearchMode {
        match self.readiness() {
            Readiness::Hybrid => SearchMode::Hybrid,
            Readiness::KeywordOnly { progress } => SearchMode::KeywordOnly {
                rebuild_progress: progress,
            },
        }
    }

    /// The indexes hold every committed change.
    pub fn ready(&self) {
        // @cpt-begin:cpt-noter-state-core-retrieval-ask-index:p1:inst-index-ready
        *self.lock() = Readiness::Hybrid;
        // @cpt-end:cpt-noter-state-core-retrieval-ask-index:p1:inst-index-ready
    }

    /// A rebuild runs (or the vectors became unavailable): keyword-only at `progress`.
    pub fn rebuilding(&self, progress: f32) {
        // @cpt-begin:cpt-noter-state-core-retrieval-ask-index:p1:inst-index-rebuilding
        *self.lock() = Readiness::KeywordOnly { progress };
        // @cpt-end:cpt-noter-state-core-retrieval-ask-index:p1:inst-index-rebuilding
    }

    fn lock(&self) -> MutexGuard<'_, Readiness> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// Rows whose vectors the indexes lack: `(chunks, items)`.
pub fn missing(conn: &Connection) -> noter_db::rusqlite::Result<(i64, i64)> {
    conn.query_row(
        "SELECT (SELECT count(*) FROM chunks c WHERE c.embedding IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM chunk_vec v WHERE v.chunk_id = c.id)),
                (SELECT count(*) FROM items i WHERE i.review_state != 'rejected'
                   AND NOT EXISTS (SELECT 1 FROM item_vec v WHERE v.item_id = i.id))",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
}

/// The vector indexes lack rows: run the rebuild.
pub fn stale(conn: &Connection) -> noter_db::rusqlite::Result<bool> {
    missing(conn).map(|(chunks, items)| chunks + items > 0)
}

type ChunkRow = (i64, String, Vec<u8>, String, i64);
type ItemRow = (i64, String, String, String, i64);

/// Chunks after `after` (rowid) that have an embedding but no vector row.
fn missing_chunks(c: &Connection, after: i64) -> noter_db::rusqlite::Result<Vec<ChunkRow>> {
    let mut stmt = c.prepare(
        "SELECT ch.rowid, ch.id, ch.embedding, ch.call_id, k.started_at
         FROM chunks ch JOIN calls k ON k.id = ch.call_id
         WHERE ch.embedding IS NOT NULL AND ch.rowid > ?1
           AND NOT EXISTS (SELECT 1 FROM chunk_vec v WHERE v.chunk_id = ch.id)
         ORDER BY ch.rowid LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![after, CHUNK_BATCH], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
    })?;
    rows.collect()
}

/// Items after `after` (rowid), not rejected, that have no vector row.
fn missing_items(c: &Connection, after: i64) -> noter_db::rusqlite::Result<Vec<ItemRow>> {
    let mut stmt = c.prepare(
        "SELECT i.rowid, i.id, i.text, i.call_id, k.started_at
         FROM items i JOIN calls k ON k.id = i.call_id
         WHERE i.review_state != 'rejected' AND i.rowid > ?1
           AND NOT EXISTS (SELECT 1 FROM item_vec v WHERE v.item_id = i.id)
         ORDER BY i.rowid LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![after, ITEM_BATCH], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
    })?;
    rows.collect()
}

fn failed(e: impl std::fmt::Display) -> Stop {
    Stop::Failed(CoreError::new(ErrorCode::Internal, e.to_string()))
}

use noter_protocol::internal;

/// The change row of one index batch: which table, how many rows; no content.
fn logged(table: &str, rows: usize) -> Logged {
    Logged {
        entity_type: "index",
        entity_id: table.into(),
        field: Some("rows".into()),
        before: None,
        after: Some(rows.to_string()),
        delta: None,
    }
}

// @cpt-algo:cpt-noter-algo-core-retrieval-ask-rebuild:p1
// @cpt-dod:cpt-noter-dod-core-retrieval-ask-search:p1
/// Fills the vector indexes from canonical data in bounded batches: keyword-only meanwhile with
/// progress, hybrid at the end. A failed batch keeps keyword-only and its progress; a retry only
/// fills what is still missing, so it cannot duplicate rows.
pub async fn rebuild(
    store: &Store,
    embedder: &dyn Embedder,
    index: &Index,
    ctx: &mut dyn Run,
) -> Result<(), Stop> {
    let (chunks, items) = store.read(missing)?;
    let total = (chunks + items).max(1) as f32;
    let mut done = 0i64;
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-rebuild:p1:inst-rebuild-start
    index.rebuilding(0.0);
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-rebuild:p1:inst-rebuild-start
    // A second pass picks up rows committed while the first ran.
    for _pass in 0..2 {
        // @cpt-begin:cpt-noter-algo-core-retrieval-ask-rebuild:p1:inst-rebuild-vectors
        let mut after = 0i64;
        loop {
            ctx.checkpoint().await?;
            // @cpt-begin:cpt-noter-algo-core-retrieval-ask-rebuild:p1:inst-rebuild-batches
            let batch = store.read(move |c| missing_chunks(c, after))?;
            // @cpt-end:cpt-noter-algo-core-retrieval-ask-rebuild:p1:inst-rebuild-batches
            let Some(last) = batch.last().map(|b| b.0) else {
                break;
            };
            after = last;
            let n = batch.len();
            let meta = ctx.change_meta("chunk vectors").ok_or(Stop::Cancelled)?;
            store.write_with(meta, move |tx| {
                for (_, id, embedding, call, started) in &batch {
                    // A chunk replaced since it was read is gone; its trigger indexed the new one.
                    tx.execute(
                        "INSERT INTO chunk_vec (chunk_id, embedding, call_id, started_at)
                         SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM chunks WHERE id = ?1)
                           AND NOT EXISTS (SELECT 1 FROM chunk_vec WHERE chunk_id = ?1)",
                        params![id, embedding, call, started],
                    )
                    .map_err(internal)?;
                }
                Ok(((), vec![logged("chunk_vec", n)]))
            })?;
            done += n as i64;
            index.rebuilding((done as f32 / total).min(0.99));
        }
        // @cpt-end:cpt-noter-algo-core-retrieval-ask-rebuild:p1:inst-rebuild-vectors
        let mut after = 0i64;
        loop {
            ctx.checkpoint().await?;
            let batch = store.read(move |c| missing_items(c, after))?;
            let Some(last) = batch.last().map(|b| b.0) else {
                break;
            };
            after = last;
            // The engine runs outside any transaction.
            let texts = batch.iter().map(|b| b.2.clone()).collect();
            // @cpt-begin:cpt-noter-algo-core-retrieval-ask-rebuild:p1:inst-rebuild-failure
            // The engine's error stays out of the run row: only that embedding failed.
            let vectors = embedder
                .embed(texts)
                .await
                .map_err(|_| failed("the engine could not embed the items"))?;
            // @cpt-end:cpt-noter-algo-core-retrieval-ask-rebuild:p1:inst-rebuild-failure
            let n = batch.len();
            let meta = ctx.change_meta("item vectors").ok_or(Stop::Cancelled)?;
            store.write_with(meta, move |tx| {
                for ((_, id, text, call, started), v) in batch.iter().zip(vectors) {
                    let blob: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
                    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-rebuild:p1:inst-rebuild-reconcile
                    // An item edited or deleted since it was read is left for the next pass.
                    tx.execute(
                        "INSERT INTO item_vec (item_id, embedding, call_id, started_at)
                         SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM items WHERE id = ?1
                           AND text = ?5) AND NOT EXISTS (SELECT 1 FROM item_vec WHERE item_id = ?1)",
                        params![id, blob, call, started, text],
                    )
                    .map_err(internal)?;
                    // @cpt-end:cpt-noter-algo-core-retrieval-ask-rebuild:p1:inst-rebuild-reconcile
                }
                Ok(((), vec![logged("item_vec", n)]))
            })?;
            done += n as i64;
            index.rebuilding((done as f32 / total).min(0.99));
        }
        if !store.read(stale)? {
            break;
        }
    }
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-rebuild:p1:inst-rebuild-return
    if store.read(stale)? {
        return Err(failed("vectors are still missing after two passes"));
    }
    index.ready();
    Ok(())
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-rebuild:p1:inst-rebuild-return
}
