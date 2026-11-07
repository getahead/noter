//! Retrieval in the composition root: `noter-retrieval` on the core's store, engine and jobs
//! (FEATURE `cpt-noter-feature-core-retrieval-ask`, slice 1: search, scope presets, the index
//! rebuild at start), with knowledge sources' chunks as its documents (2.24).

use std::collections::HashSet;
use std::sync::{Arc, Weak};

use noter_db::rusqlite::{self, Connection};
use noter_jobs::{BoxFuture, JobHandler, Request, RunCtx, Stop, Trigger};
use noter_protocol::model::*;
use noter_protocol::*;
use noter_retrieval::{DocHits, DocQuery, DocumentSource, Evidence, Hit, Privacy};
use serde_json::json;

use crate::{object, Core};

/// Retrieval's documents: knowledge chunks by keyword and by vector, each ranking through the
/// sources' policy as it stands now (`noter_knowledge::permitted_chunks`).
struct Documents;

impl DocumentSource for Documents {
    fn permitted_chunks(&self, conn: &Connection, q: &DocQuery<'_>) -> rusqlite::Result<DocHits> {
        let scope = AskScope {
            call_types: q.call_types.to_vec(),
            include_documents: true,
            ..AskScope::default()
        };
        let cloud = q.privacy == Privacy::Cloud;
        let keyword = noter_knowledge::keyword_chunks(conn, q.fts, q.fetch)?;
        let semantic = match q.vector {
            Some(v) => {
                let far = 1.0 - noter_retrieval::MIN_SIMILARITY;
                noter_knowledge::nearest_chunks(conn, v, q.fetch, far)?
            }
            None => vec![],
        };
        // The chunks a cloud request lost only because their source is sensitive.
        let mut skipped: HashSet<ChunkId> = HashSet::new();
        let mut permit = |ids: Vec<ChunkId>| -> rusqlite::Result<Vec<Hit>> {
            let allowed = noter_knowledge::permitted_chunks(conn, &ids, &scope, cloud)?;
            if cloud {
                for p in noter_knowledge::permitted_chunks(conn, &ids, &scope, false)? {
                    if !allowed.iter().any(|a| a.chunk_id == p.chunk_id) {
                        skipped.insert(p.chunk_id);
                    }
                }
            }
            Ok(allowed.into_iter().map(document_hit).collect())
        };
        let keyword = permit(keyword)?;
        let semantic = permit(semantic)?;
        Ok(DocHits {
            keyword,
            semantic,
            sensitive_skipped: skipped.len() as u32,
        })
    }
}

/// A permitted chunk as retrieval ranks it: its heading path is the section, and its text is
/// the body without the "title › headings" line every chunk starts with (the provenance says it).
fn document_hit(p: noter_knowledge::Permitted) -> Hit {
    let section = (!p.heading_path.is_empty()).then(|| p.heading_path.join(" › "));
    let body = p
        .text
        .split_once("\n\n")
        .map_or_else(|| p.text.clone(), |(_, body)| body.to_string());
    Hit {
        evidence: Evidence::Document {
            document_id: p.document_id.clone(),
            chunk_id: p.chunk_id.clone(),
        },
        target: HitTarget::Document {
            document_id: p.document_id.clone(),
            chunk_id: p.chunk_id.clone(),
        },
        title: p.title.clone(),
        text: body,
        lang: None,
        call: None,
        provenance: Provenance::Document {
            source_id: p.source_id,
            document_id: p.document_id,
            chunk_id: p.chunk_id,
            title: p.title,
            section,
            source_name: p.source_name,
        },
        keyword: false,
        semantic: false,
        score: 0.0,
    }
}

/// The `IndexRebuild` job: fills the vector indexes, keyword-only meanwhile.
struct RebuildJob(Weak<Core>);

impl JobHandler for RebuildJob {
    fn run<'a>(&'a self, ctx: &'a mut RunCtx) -> BoxFuture<'a, Result<(), Stop>> {
        Box::pin(async move {
            let core = self.0.upgrade().ok_or(Stop::Cancelled)?;
            noter_retrieval::rebuild(core.store(), &core.engine, &core.index, ctx).await
        })
    }
}

pub(crate) fn register(core: &Arc<Core>) {
    core.jobs.register(
        JobKind::IndexRebuild,
        Arc::new(RebuildJob(Arc::downgrade(core))),
    );
}

impl Core {
    /// At open: hybrid when the vector indexes hold every committed row; otherwise keyword-only
    /// until the rebuild `start_rebuild` queues has filled them.
    pub(crate) fn check_index(&self) {
        if matches!(self.store().read(noter_retrieval::stale), Ok(false)) {
            self.index.ready();
        }
    }

    /// Queues the rebuild once the scheduler runs, when the indexes lack rows (the vector
    /// tables are new or a previous rebuild did not finish). The maintenance trigger is M5's.
    // shortcut: items written after start get their vectors at the next start (or from topic
    // attachment, which embeds them, in 2.22 slice 3); chunks are indexed as they are written.
    pub(crate) fn start_rebuild(&self) {
        if !matches!(self.store().read(noter_retrieval::stale), Ok(true)) {
            return;
        }
        let queued = self
            .jobs
            .trigger(Request::new(JobKind::IndexRebuild, Trigger::OnDemand));
        if let Err(e) = queued {
            self.log(object(json!({
                "level": "error", "module": "retrieval", "code": "rebuild_not_queued",
                "message": e.message
            })));
        }
    }

    /// `search`: one retrieval for every section, the query embedded locally when the vector
    /// indexes are ready. Reads on the pool; never logs the query or what it found.
    pub(crate) async fn search_library(
        &self,
        args: SearchArgs,
    ) -> Result<SearchResults, CoreError> {
        self.ready()?;
        let request = noter_retrieval::search_request(&args)?;
        let (vector, mode) = self.query_vector(request.text()).await;
        let request = request.with_vector(vector);
        self.store()
            .read(|c| noter_retrieval::search(c, &args.query, &request, mode, &Documents))
    }

    /// A query's local embedding when the vector indexes are ready, and the mode the request
    /// runs in: keyword-only while they rebuild, or when this embedding failed.
    pub(crate) async fn query_vector(&self, text: &str) -> (Option<Vec<f32>>, SearchMode) {
        let mode = self.index.mode();
        if mode != SearchMode::Hybrid || text.trim().is_empty() {
            return (None, mode);
        }
        match noter_retrieval::embed_query(&self.engine, text).await {
            Some(vector) => (Some(vector), mode),
            // The indexes are complete; only this request ran without vectors.
            None => (
                None,
                SearchMode::KeywordOnly {
                    rebuild_progress: 1.0,
                },
            ),
        }
    }

    /// `ask_scope_presets`: readable scopes from the current library.
    pub(crate) fn scope_presets(&self) -> Result<ScopePresetList, CoreError> {
        self.ready()?;
        let now = self.deps.clock.now();
        let types = self.call_types_now().call_types;
        self.store()
            .read(|c| noter_retrieval::scope_presets(c, now, &types))
    }
}
