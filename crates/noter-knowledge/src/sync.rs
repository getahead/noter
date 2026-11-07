//! The sync job of an indexed folder source (`cpt-noter-algo-core-knowledge-sync`): enumerate,
//! skip what did not change, extract, chunk, embed outside any transaction, then replace each
//! changed document in one writer transaction. The source's status follows
//! `cpt-noter-state-core-knowledge-source`; progress never carries document text.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use noter_db::rusqlite::{params, Transaction};
use noter_db::{ChangeMeta, Logged, Store};
use noter_engine_client::{EngineClient, EngineLauncher};
use noter_jobs::{RunCtx, Stop};
use noter_protocol::model::{CountEntry, SourceKind, SourceMode, SourceRow, SourceStatus};
use noter_protocol::{CoreError, ErrorCode, SourceId, TimestampMs};
use sha2::{Digest, Sha256};

use crate::chunk::{self, Chunk};
use crate::extract::{self, Extracted, Format};
use crate::internal;
use crate::sources::{get, not_found, text};

/// Texts per `embed_texts` request.
const EMBED_BATCH: usize = 32;
/// Files larger than this are not indexed.
const MAX_BYTES: u64 = 32 * 1024 * 1024;
/// How often one run looks again when the folder changed while it ran.
const PASSES: usize = 3;

/// What a sync needs from the core.
pub struct SyncEnv<'a, L> {
    pub store: &'a Store,
    pub engine: &'a EngineClient<L>,
    /// The engine's container: embeddings are written under its `knowledge/` folder.
    pub container: &'a Path,
    pub now: &'a (dyn Fn() -> TimestampMs + Send + Sync),
    /// Whether the folder changed since the last call (the watcher's mark), clearing it.
    pub changed: &'a (dyn Fn() -> bool + Send + Sync),
    /// Called with the source row after each committed status or progress change.
    pub published: &'a (dyn Fn(SourceRow) + Send + Sync),
}

#[derive(Default)]
struct Counts {
    added: u32,
    changed: u32,
    removed: u32,
}

impl Counts {
    fn entries(&self) -> Vec<CountEntry> {
        [
            ("added", self.added),
            ("changed", self.changed),
            ("removed", self.removed),
        ]
        .into_iter()
        .map(|(label, n)| CountEntry {
            label: label.into(),
            n,
        })
        .collect()
    }
}

/// A file of the folder as the enumeration found it.
struct Found {
    path: PathBuf,
    format: Format,
    modified: Option<i64>,
}

/// A document as the index has it.
struct Known {
    id: String,
    hash: String,
    modified: Option<i64>,
}

fn failed(code: ErrorCode, message: &str) -> Stop {
    Stop::Failed(CoreError::new(code, message))
}

fn status_logged(id: &SourceId, status: &SourceStatus) -> Logged {
    Logged {
        entity_type: "source",
        entity_id: id.as_str().into(),
        field: Some("status".into()),
        before: None,
        after: Some(text(status)),
        delta: None,
    }
}

/// How a run ends: its counts and error code for `sync_runs`, and whether it moves the last
/// successful sync time.
struct End<'a> {
    run: &'a str,
    counts: &'a Counts,
    error: Option<String>,
    synced: bool,
}

impl<L: EngineLauncher> SyncEnv<'_, L> {
    /// Writes the source's status and the run's end if the source still exists, then publishes
    /// the row.
    /// `meta` is `None` once the scheduler has closed the run: nothing is written then.
    fn finish(
        &self,
        meta: Option<ChangeMeta>,
        id: &SourceId,
        status: SourceStatus,
        end: End<'_>,
    ) -> Result<(), CoreError> {
        let Some(meta) = meta else {
            return Ok(());
        };
        let id = id.clone();
        let now = (self.now)().0;
        let (run, error, synced) = (end.run.to_string(), end.error, end.synced);
        let (added, changed, removed) = (end.counts.added, end.counts.changed, end.counts.removed);
        let written = self.store.write_with(meta, move |tx| {
            get(tx, &id).map_err(internal)?.ok_or_else(not_found)?;
            tx.execute(
                "UPDATE sources SET status = ?1,
                     last_sync_at = CASE WHEN ?2 THEN ?3 ELSE last_sync_at END WHERE id = ?4",
                params![text(&status), synced, now, id.as_str()],
            )
            .map_err(internal)?;
            tx.execute(
                "UPDATE sync_runs SET finished_at = ?1, added = ?2, changed = ?3, removed = ?4,
                     error = ?5 WHERE id = ?6",
                params![now, added, changed, removed, error, run],
            )
            .map_err(internal)?;
            let row = get(tx, &id).map_err(internal)?.ok_or_else(not_found)?;
            Ok((row, vec![status_logged(&id, &status)]))
        });
        match written {
            Ok(w) => {
                (self.published)(w.value);
                Ok(())
            }
            // Removed meanwhile: nothing to finish.
            Err(e) if e.code == ErrorCode::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    }
}

// @cpt-algo:cpt-noter-algo-core-knowledge-sync:p1
// @cpt-state:cpt-noter-state-core-knowledge-source:p1
/// Syncs the folder source `id` within the job run `ctx`. A removed source ends the run as
/// cancelled with nothing written; a live source is refused.
pub async fn sync<L: EngineLauncher>(
    env: &SyncEnv<'_, L>,
    ctx: &mut RunCtx,
    id: &SourceId,
) -> Result<(), Stop> {
    // @cpt-begin:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-start
    let source = {
        let id = id.clone();
        env.store.read(move |c| get(c, &id))?
    };
    let Some(source) = source else {
        return Err(Stop::Cancelled);
    };
    if source.mode == SourceMode::Live || source.kind != SourceKind::Folder {
        return Err(failed(
            ErrorCode::InvalidInput,
            "only indexed folder sources sync here",
        ));
    }
    let run = format!("syn_{}", ulid::Ulid::generate());
    let started = (env.now)().0;
    // @cpt-begin:cpt-noter-state-core-knowledge-source:p1:inst-status-start
    // @cpt-begin:cpt-noter-state-core-knowledge-source:p1:inst-status-retry
    let indexing = SourceStatus::Indexing {
        done: 0,
        total: None,
    };
    let (source_id, run_id) = (id.clone(), run.clone());
    let start_meta = ctx.change_meta("sync started").ok_or(Stop::Cancelled)?;
    let row = env
        .store
        .write_with(start_meta, move |tx| {
            get(tx, &source_id)
                .map_err(internal)?
                .ok_or_else(not_found)?;
            tx.execute(
                "INSERT INTO sync_runs (id, source_id, started_at) VALUES (?1, ?2, ?3)",
                params![run_id, source_id.as_str(), started],
            )
            .map_err(internal)?;
            tx.execute(
                "UPDATE sources SET status = ?1 WHERE id = ?2",
                params![text(&indexing), source_id.as_str()],
            )
            .map_err(internal)?;
            let row = get(tx, &source_id)
                .map_err(internal)?
                .ok_or_else(not_found)?;
            Ok((row, vec![status_logged(&source_id, &indexing)]))
        })
        .map_err(|e| match e.code {
            ErrorCode::NotFound => Stop::Cancelled,
            _ => Stop::Failed(e),
        })?;
    (env.published)(row.value);
    // @cpt-end:cpt-noter-state-core-knowledge-source:p1:inst-status-retry
    // @cpt-end:cpt-noter-state-core-knowledge-source:p1:inst-status-start
    // @cpt-end:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-start
    let mut counts = Counts::default();
    let outcome = passes(env, ctx, id, Path::new(&source.location), &mut counts).await;
    let end = |error: Option<String>, synced| End {
        run: &run,
        counts: &counts,
        error,
        synced,
    };
    match outcome {
        Ok(()) => {
            // @cpt-begin:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-return
            // @cpt-begin:cpt-noter-state-core-knowledge-source:p1:inst-status-done
            let meta = ctx.change_meta("sync finished");
            env.finish(meta, id, SourceStatus::Idle, end(None, true))?;
            ctx.commit_batch(vec![], counts.entries(), Some(1.0))
                .await?;
            Ok(())
            // @cpt-end:cpt-noter-state-core-knowledge-source:p1:inst-status-done
            // @cpt-end:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-return
        }
        Err(Stop::Cancelled) => {
            // @cpt-begin:cpt-noter-state-core-knowledge-source:p1:inst-status-cancel
            let meta = ctx.change_meta("sync cancelled");
            env.finish(
                meta,
                id,
                SourceStatus::Idle,
                end(Some("cancelled".into()), false),
            )?;
            Err(Stop::Cancelled)
            // @cpt-end:cpt-noter-state-core-knowledge-source:p1:inst-status-cancel
        }
        Err(Stop::Failed(e)) => {
            // @cpt-begin:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-failure
            // @cpt-begin:cpt-noter-state-core-knowledge-source:p1:inst-status-failed
            let status = SourceStatus::Failed {
                code: e.code,
                at: (env.now)(),
            };
            let meta = ctx.change_meta("sync failed");
            env.finish(meta, id, status, end(Some(text(&e.code)), false))?;
            Err(Stop::Failed(e))
            // @cpt-end:cpt-noter-state-core-knowledge-source:p1:inst-status-failed
            // @cpt-end:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-failure
        }
    }
}

/// One pass over the folder, again while the watcher reports changes made during the pass.
async fn passes<L: EngineLauncher>(
    env: &SyncEnv<'_, L>,
    ctx: &mut RunCtx,
    id: &SourceId,
    dir: &Path,
    counts: &mut Counts,
) -> Result<(), Stop> {
    (env.changed)();
    for _ in 0..PASSES {
        pass(env, ctx, id, dir, counts).await?;
        if !(env.changed)() {
            break;
        }
    }
    Ok(())
}

/// Every file the index reads under `dir`, hidden entries and symbolic links left out. Any
/// unreadable directory fails the whole listing: a partial listing never deletes documents.
fn enumerate(dir: &Path) -> std::io::Result<Vec<Found>> {
    let mut out = vec![];
    let mut dirs = vec![dir.to_path_buf()];
    while let Some(d) = dirs.pop() {
        for entry in std::fs::read_dir(&d)? {
            let path = entry?.path();
            if path
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with('.'))
            {
                continue;
            }
            let meta = path.symlink_metadata()?;
            if meta.is_dir() {
                dirs.push(path);
            } else if let Some(format) = Format::of(&path) {
                if meta.is_file() && meta.len() <= MAX_BYTES {
                    let modified = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as i64);
                    out.push(Found {
                        path,
                        format,
                        modified,
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

async fn pass<L: EngineLauncher>(
    env: &SyncEnv<'_, L>,
    ctx: &mut RunCtx,
    id: &SourceId,
    dir: &Path,
    counts: &mut Counts,
) -> Result<(), Stop> {
    // @cpt-begin:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-folder
    // TL-29: no bookmark to enter; the folder is read by path.
    let files = enumerate(dir)
        .map_err(|_| failed(ErrorCode::SourceSyncFailed, "the folder could not be read"))?;
    let known: HashMap<String, Known> = {
        let id = id.clone();
        env.store.read(move |c| {
            let mut st = c.prepare(
                "SELECT uri, id, content_hash, modified_at FROM documents WHERE source_id = ?1",
            )?;
            let rows = st.query_map([id.as_str()], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    Known {
                        id: r.get(1)?,
                        hash: r.get(2)?,
                        modified: r.get(3)?,
                    },
                ))
            })?;
            rows.collect()
        })?
    };
    // @cpt-end:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-folder
    let total = files.len() as u32;
    // @cpt-begin:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-each
    for (n, file) in files.iter().enumerate() {
        ctx.checkpoint().await?;
        let uri = file.path.to_string_lossy().into_owned();
        let before = known.get(&uri);
        // @cpt-begin:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-hash
        // shortcut: an unchanged modification time skips the file unhashed; a file replaced
        // under the same time (`cp -p`, `rsync -t`) keeps its chunks until a full reindex.
        if before.is_some_and(|k| k.modified.is_some() && k.modified == file.modified) {
            continue;
        }
        let (path, format) = (file.path.clone(), file.format);
        let stored = before.map(|k| k.hash.clone());
        // Reading and parsing can take seconds (a large PDF): off the async workers.
        let read = tokio::task::spawn_blocking(move || read_file(&path, format, stored))
            .await
            .map_err(|_| failed(ErrorCode::SourceSyncFailed, "a file could not be read"))??;
        let Some((hash, doc, chunks)) = read else {
            continue;
        };
        // @cpt-end:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-hash
        // @cpt-begin:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-embed
        let vectors = embed(env, &chunks).await?;
        // @cpt-end:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-embed
        ctx.checkpoint().await?;
        // @cpt-begin:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-persist
        let replace = Replace {
            source: id.clone(),
            document: before.map(|k| k.id.clone()),
            uri,
            title: doc.title,
            mime: file.format.mime(),
            hash,
            modified: file.modified,
            indexed: (env.now)().0,
            chunks: chunks.into_iter().zip(vectors).collect(),
            status: SourceStatus::Indexing {
                done: n as u32 + 1,
                total: Some(total),
            },
        };
        let meta = ctx.change_meta("document indexed").ok_or(Stop::Cancelled)?;
        let row = env
            .store
            .write_with(meta, move |tx| replace.apply(tx))
            .map_err(|e| match e.code {
                // The source went while this file was embedded: nothing of it is published.
                ErrorCode::NotFound => Stop::Cancelled,
                _ => Stop::Failed(e),
            })?;
        if before.is_some() {
            counts.changed += 1;
        } else {
            counts.added += 1;
        }
        // @cpt-end:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-persist
        // @cpt-begin:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-progress
        (env.published)(row.value);
        let progress = (n + 1) as f32 / total.max(1) as f32;
        ctx.commit_batch(vec![], counts.entries(), Some(progress))
            .await?;
        // @cpt-end:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-progress
    }
    // @cpt-end:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-each
    // @cpt-begin:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-deleted
    let present: HashSet<String> = files
        .iter()
        .map(|f| f.path.to_string_lossy().into_owned())
        .collect();
    let vanished: Vec<String> = known
        .into_iter()
        .filter(|(uri, _)| !present.contains(uri))
        .map(|(_, k)| k.id)
        .collect();
    if !vanished.is_empty() {
        counts.removed += vanished.len() as u32;
        let source = id.clone();
        let meta = ctx
            .change_meta("documents removed")
            .ok_or(Stop::Cancelled)?;
        env.store.write_with(meta, move |tx| {
            for doc in &vanished {
                tx.execute(
                    "DELETE FROM documents WHERE id = ?1 AND source_id = ?2",
                    params![doc, source.as_str()],
                )
                .map_err(internal)?;
            }
            let logged = Logged {
                entity_type: "source",
                entity_id: source.as_str().into(),
                field: Some("documents_removed".into()),
                before: None,
                after: Some(vanished.len().to_string()),
                delta: None,
            };
            Ok(((), vec![logged]))
        })?;
    }
    // @cpt-end:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-deleted
    Ok(())
}

/// The file's content hash, text and chunks, or `None` when the content is `stored`.
fn read_file(
    path: &Path,
    format: Format,
    stored: Option<String>,
) -> Result<Option<(String, Extracted, Vec<Chunk>)>, Stop> {
    let bytes = std::fs::read(path)
        .map_err(|_| failed(ErrorCode::SourceSyncFailed, "a file could not be read"))?;
    let hash: String = Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if stored.as_deref() == Some(hash.as_str()) {
        return Ok(None);
    }
    // @cpt-begin:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-extract
    let doc = extract::extract(path, &bytes, format).map_err(|_| {
        failed(
            ErrorCode::SourceSyncFailed,
            "a file could not be read as text",
        )
    })?;
    let chunks = chunk::chunks(&doc);
    // @cpt-end:cpt-noter-algo-core-knowledge-sync:p1:inst-sync-extract
    Ok(Some((hash, doc, chunks)))
}

/// One finite 1024-value vector per chunk, in order, through the engine in batches.
async fn embed<L: EngineLauncher>(
    env: &SyncEnv<'_, L>,
    chunks: &[Chunk],
) -> Result<Vec<Vec<f32>>, Stop> {
    let unavailable = || failed(ErrorCode::EngineUnavailable, "embeddings failed");
    let mut out = Vec::with_capacity(chunks.len());
    if chunks.is_empty() {
        return Ok(out);
    }
    std::fs::create_dir_all(env.container.join("knowledge")).map_err(|_| unavailable())?;
    for batch in chunks.chunks(EMBED_BATCH) {
        let id = ulid::Ulid::generate();
        let texts = batch.iter().map(|c| c.text.clone()).collect();
        let rows = env
            .engine
            .embed_texts(
                format!("emb_{id}"),
                texts,
                Some(format!("knowledge/embed-{id}.f32")),
            )
            .await
            .map_err(|_| unavailable())?;
        out.extend(rows);
    }
    Ok(out)
}

/// One document's new state, written in one transaction after the source is checked again.
struct Replace {
    source: SourceId,
    document: Option<String>,
    uri: String,
    title: String,
    mime: &'static str,
    hash: String,
    modified: Option<i64>,
    indexed: i64,
    chunks: Vec<(Chunk, Vec<f32>)>,
    status: SourceStatus,
}

impl Replace {
    fn apply(self, tx: &Transaction<'_>) -> Result<(SourceRow, Vec<Logged>), CoreError> {
        // The source may have gone or changed its policy while this file was embedded: the
        // vector trigger reads its privacy class inside this transaction.
        get(tx, &self.source)
            .map_err(internal)?
            .ok_or_else(not_found)?;
        let doc = match &self.document {
            Some(doc) => {
                tx.execute("DELETE FROM doc_chunks WHERE document_id = ?1", [doc])
                    .map_err(internal)?;
                tx.execute(
                    "UPDATE documents SET title = ?1, mime = ?2, content_hash = ?3,
                         modified_at = ?4, indexed_at = ?5 WHERE id = ?6",
                    params![
                        self.title,
                        self.mime,
                        self.hash,
                        self.modified,
                        self.indexed,
                        doc
                    ],
                )
                .map_err(internal)?;
                doc.clone()
            }
            None => {
                let doc = format!("doc_{}", ulid::Ulid::generate());
                tx.execute(
                    "INSERT INTO documents (id, source_id, uri, title, mime, content_hash,
                         modified_at, indexed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        doc,
                        self.source.as_str(),
                        self.uri,
                        self.title,
                        self.mime,
                        self.hash,
                        self.modified,
                        self.indexed
                    ],
                )
                .map_err(internal)?;
                doc
            }
        };
        for (c, vector) in &self.chunks {
            let blob: Vec<u8> = vector.iter().flat_map(|x| x.to_le_bytes()).collect();
            tx.execute(
                "INSERT INTO doc_chunks (id, document_id, heading_path, text, text_norm,
                     token_count, embedding) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    format!("chk_{}", ulid::Ulid::generate()),
                    doc,
                    serde_json::to_string(&c.heading_path).map_err(internal)?,
                    c.text,
                    chunk::normalize(&c.text),
                    c.token_count as i64,
                    blob
                ],
            )
            .map_err(internal)?;
        }
        tx.execute(
            "UPDATE sources SET status = ?1 WHERE id = ?2",
            params![text(&self.status), self.source.as_str()],
        )
        .map_err(internal)?;
        let row = get(tx, &self.source)
            .map_err(internal)?
            .ok_or_else(not_found)?;
        // The document id and its chunk count only: no title, path or text in the log.
        let logged = Logged {
            entity_type: "source",
            entity_id: self.source.as_str().into(),
            field: Some("document".into()),
            before: None,
            after: Some(format!("{doc}: {} chunks", self.chunks.len())),
            delta: None,
        };
        Ok((row, vec![logged]))
    }
}
