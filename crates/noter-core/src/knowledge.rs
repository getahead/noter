//! Knowledge sources in the composition root: the five folder-source commands over
//! `noter-knowledge`, the folder panel through `NativeOps`, the watchers and the `source_sync`
//! job on the scheduler. MCP sources are slice 2 (`source_add_mcp` and `source_revoke_token`
//! answer `not_implemented` until then).

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, Weak};

use noter_jobs::{BoxFuture, JobHandler, Request, RunCtx, Stop, Trigger};
use noter_protocol::ipc::CommandCtx;
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::json;

use crate::{lock, object, Core};

/// The watched folders, the run each source's last sync request got, and the runs whose
/// handler has returned but which the scheduler has not closed yet.
#[derive(Default)]
pub(crate) struct Sources {
    watchers: noter_knowledge::Watchers,
    runs: Mutex<HashMap<SourceId, JobRunId>>,
    closing: Mutex<HashMap<SourceId, JobRunId>>,
}

struct SyncJob(Weak<Core>);

impl JobHandler for SyncJob {
    fn run<'a>(&'a self, ctx: &'a mut RunCtx) -> BoxFuture<'a, Result<(), Stop>> {
        Box::pin(async move {
            let Some(core) = self.0.upgrade() else {
                return Err(Stop::Cancelled);
            };
            core.sync_source(ctx).await
        })
    }
}

pub(crate) fn register(core: &Arc<Core>) {
    core.jobs
        .register(JobKind::SourceSync, Arc::new(SyncJob(Arc::downgrade(core))));
}

/// Once the scheduler has started: watches every folder source and syncs each once (changes
/// made while the app was closed).
pub(crate) fn resume(core: &Arc<Core>) {
    let Ok(list) = noter_knowledge::list(core.store()) else {
        return;
    };
    for source in list.sources {
        if source.kind == SourceKind::Folder && source.mode == SourceMode::Indexed {
            core.watch_source(&source);
            let _ = core.enqueue_sync(&source.id);
        }
    }
}

impl Core {
    /// A limited scope names only call types the core knows. People are checked once 2.23's
    /// `people` table lands.
    fn check_scope(&self, scope: &SourceScope) -> Result<(), CoreError> {
        let SourceScope::Limited { call_types, .. } = scope else {
            return Ok(());
        };
        let known = self.call_types_now().call_types;
        if call_types.iter().all(|t| known.iter().any(|k| k.id == *t)) {
            return Ok(());
        }
        Err(
            CoreError::new(ErrorCode::InvalidInput, "an unknown call type").with_detail(
                ErrorDetail::Validation {
                    field: "scope.call_types".into(),
                    rule: noter_protocol::error::ValidationRule::InvalidFormat,
                },
            ),
        )
    }

    pub(crate) fn list_sources(&self) -> Result<SourceList, CoreError> {
        self.ready()?;
        noter_knowledge::list(self.store())
    }

    // @cpt-flow:cpt-noter-flow-core-knowledge-folder:p1
    /// Adds a watched folder: the open panel when no path is given (closing it is `cancelled`
    /// with nothing written), then the source row, its watcher and its first sync.
    pub(crate) async fn add_folder_source(
        &self,
        ctx: &CommandCtx,
        args: SourceAddFolderArgs,
    ) -> Result<SourceRow, CoreError> {
        self.ready()?;
        self.check_scope(&args.scope)?;
        // @cpt-begin:cpt-noter-flow-core-knowledge-folder:p1:inst-folder-pick
        let path = match args.path {
            Some(path) => path,
            None => self
                .deps
                .native_ops
                .save_panel("Knowledge folder", crate::SaveKind::Folder)
                .await
                .ok_or_else(|| CoreError::new(ErrorCode::Cancelled, "no folder chosen"))?
                .to_string_lossy()
                .into_owned(),
        };
        // @cpt-end:cpt-noter-flow-core-knowledge-folder:p1:inst-folder-pick
        let dir = noter_knowledge::validate_folder(&path)?;
        let meta = self.change_meta(ctx, "Added a folder source".into(), "source_add_folder");
        let row = noter_knowledge::add_folder(self.store(), meta, &dir, args.privacy, args.scope)?;
        // @cpt-begin:cpt-noter-flow-core-knowledge-folder:p1:inst-folder-return
        self.emit_entity_changed(&EntityChanged::Source {
            source: row.clone(),
        });
        self.watch_source(&row);
        // @cpt-end:cpt-noter-flow-core-knowledge-folder:p1:inst-folder-return
        // @cpt-begin:cpt-noter-flow-core-knowledge-folder:p1:inst-folder-index
        self.enqueue_sync(&row.id)?;
        // @cpt-end:cpt-noter-flow-core-knowledge-folder:p1:inst-folder-index
        Ok(row)
    }

    // @cpt-flow:cpt-noter-flow-core-knowledge-manage:p1
    pub(crate) fn update_source(
        &self,
        ctx: &CommandCtx,
        args: SourceUpdateArgs,
    ) -> Result<SourceRow, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-knowledge-manage:p1:inst-manage-update
        if let Some(scope) = &args.scope {
            self.check_scope(scope)?;
        }
        // @cpt-end:cpt-noter-flow-core-knowledge-manage:p1:inst-manage-update
        let meta = self.change_meta(ctx, "Edited a source".into(), "source_update");
        let before = args.rev;
        let row = noter_knowledge::update(self.store(), meta, args)?;
        // @cpt-begin:cpt-noter-flow-core-knowledge-manage:p1:inst-manage-invalidate
        // No retrieval cache to drop: retrieval reads the source's policy on every request
        // (`permitted_chunks`), and a sync rechecks it in the transaction that publishes.
        // @cpt-end:cpt-noter-flow-core-knowledge-manage:p1:inst-manage-invalidate
        // @cpt-begin:cpt-noter-flow-core-knowledge-manage:p1:inst-manage-return
        if row.rev != before {
            self.emit_entity_changed(&EntityChanged::Source {
                source: row.clone(),
            });
        }
        Ok(row)
        // @cpt-end:cpt-noter-flow-core-knowledge-manage:p1:inst-manage-return
    }

    /// Queues a sync of an indexed source and returns its row; a live source is never indexed.
    pub(crate) fn reindex_source(&self, args: SourceIdArgs) -> Result<SourceRow, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-knowledge-manage:p1:inst-manage-reindex
        let id = args.source_id;
        let row = self
            .store()
            .read(move |c| noter_knowledge::get(c, &id))?
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "this source no longer exists"))?;
        if row.mode == SourceMode::Live {
            return Err(CoreError::new(
                ErrorCode::InvalidInput,
                "a live source is not indexed",
            ));
        }
        self.enqueue_sync(&row.id)?;
        Ok(row)
        // @cpt-end:cpt-noter-flow-core-knowledge-manage:p1:inst-manage-reindex
    }

    // @cpt-flow:cpt-noter-flow-core-knowledge-remove:p1
    // @cpt-dod:cpt-noter-dod-core-knowledge-removal:p1
    /// Stops the source's sync and watcher, then removes it with its whole local index; a
    /// failed removal keeps the source and watches it again.
    pub(crate) fn remove_source(
        &self,
        ctx: &CommandCtx,
        args: SourceIdArgs,
    ) -> Result<DeleteResult, CoreError> {
        self.ready()?;
        let id = args.source_id;
        // @cpt-begin:cpt-noter-flow-core-knowledge-remove:p1:inst-remove-request
        if let Some(run) = lock(&self.sources.runs).remove(&id) {
            // A run that already ended is fine: a late worker finds no source and stops.
            let _ = self.jobs.cancel(&run);
        }
        self.sources.watchers.unwatch(&id);
        // @cpt-end:cpt-noter-flow-core-knowledge-remove:p1:inst-remove-request
        // @cpt-begin:cpt-noter-flow-core-knowledge-remove:p1:inst-remove-index
        let meta = self.change_meta(ctx, "Removed a source".into(), "source_remove");
        let removed = noter_knowledge::remove(self.store(), meta, &id);
        // @cpt-end:cpt-noter-flow-core-knowledge-remove:p1:inst-remove-index
        let result = match removed {
            Ok(result) => result,
            Err(e) => {
                let back = id.clone();
                if let Ok(Some(row)) = self.store().read(move |c| noter_knowledge::get(c, &back)) {
                    self.watch_source(&row);
                }
                return Err(e);
            }
        };
        // @cpt-begin:cpt-noter-algo-core-knowledge-remove-index:p1:inst-drop-invalidate
        // Retrieval keeps no cache of hits; late workers find no source row and are rejected.
        // @cpt-end:cpt-noter-algo-core-knowledge-remove-index:p1:inst-drop-invalidate
        // @cpt-begin:cpt-noter-flow-core-knowledge-remove:p1:inst-remove-return
        self.emit_entity_changed(&EntityChanged::Removed {
            kind: EntityKind::Source,
            id: id.0,
        });
        Ok(result)
        // @cpt-end:cpt-noter-flow-core-knowledge-remove:p1:inst-remove-return
    }

    /// Queues the source's sync. A sync already queued or running for it is the same work: the
    /// mark makes a running one look at the folder again, and a request that met a run already
    /// past its last look is sent again once that run has closed.
    fn enqueue_sync(&self, id: &SourceId) -> Result<(), CoreError> {
        self.sources.watchers.mark(id);
        let run = self.trigger_sync(id)?;
        if run.is_some() && lock(&self.sources.closing).get(id) == run.as_ref() {
            self.resend_after(id, run);
        }
        Ok(())
    }

    fn trigger_sync(&self, id: &SourceId) -> Result<Option<JobRunId>, CoreError> {
        let req = Request {
            kind: JobKind::SourceSync,
            trigger: Trigger::OnDemand,
            subject: Some(id.0.clone()),
        };
        let run = self.in_runtime(|| self.jobs.trigger(req))?;
        if let Some(run) = &run {
            lock(&self.sources.runs).insert(id.clone(), run.clone());
        }
        Ok(run)
    }

    /// Triggers again until the scheduler answers with a run other than `closing`.
    fn resend_after(&self, id: &SourceId, closing: Option<JobRunId>) {
        let Some(this) = self.this.get().and_then(Weak::upgrade) else {
            return;
        };
        let id = id.clone();
        self.spawn(async move {
            for _ in 0..200 {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                match this.trigger_sync(&id) {
                    Ok(run) if run != closing => return,
                    Err(_) => return,
                    Ok(_) => {}
                }
            }
        });
    }

    /// Watches a folder source; each change queues its sync.
    fn watch_source(&self, row: &SourceRow) {
        let Some(this) = self.this.get().cloned() else {
            return;
        };
        let watched = self
            .sources
            .watchers
            .watch(&row.id, Path::new(&row.location), move |id| {
                if let Some(core) = this.upgrade() {
                    let _ = core.enqueue_sync(id);
                }
            });
        if watched.is_err() {
            self.log(object(json!({
                "level": "warn", "module": "knowledge", "code": "watch_failed"
            })));
        }
    }

    async fn sync_source(&self, ctx: &mut RunCtx) -> Result<(), Stop> {
        let Some(id) = ctx.subject().map(SourceId::new) else {
            return Ok(());
        };
        let clock = self.deps.clock.clone();
        let container = self
            .audio_dir
            .parent()
            .unwrap_or(&self.data_dir)
            .to_path_buf();
        let changed = || self.sources.watchers.take_changed(&id);
        let published = |source: SourceRow| {
            self.emit_entity_changed(&EntityChanged::Source { source });
        };
        let env = noter_knowledge::SyncEnv {
            store: self.store(),
            engine: &self.engine,
            container: &container,
            now: &move || clock.now(),
            changed: &changed,
            published: &published,
        };
        let result = noter_knowledge::sync(&env, ctx, &id).await;
        // A request after the sync's last look waits for this run to close, then runs again.
        let run = ctx.run_id().clone();
        lock(&self.sources.closing).insert(id.clone(), run.clone());
        if self.sources.watchers.is_changed(&id) {
            self.resend_after(&id, Some(run));
        }
        result
    }
}
