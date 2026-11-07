//! Retrieval in the composition root: `noter-retrieval` on the core's store, engine and jobs
//! (FEATURE `cpt-noter-feature-core-retrieval-ask`, slice 1: search, scope presets, the index
//! rebuild at start).

use std::sync::{Arc, Weak};

use noter_jobs::{BoxFuture, JobHandler, Request, RunCtx, Stop, Trigger};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::json;

use crate::{object, Core};

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
        self.store().read(|c| {
            noter_retrieval::search(
                c,
                &args.query,
                &request,
                mode,
                &noter_retrieval::NoDocuments,
            )
        })
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
