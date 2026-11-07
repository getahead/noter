//! Knowledge sources in the composition root: the seven source commands over `noter-knowledge`,
//! the folder panel through `NativeOps`, indexed MCP servers through `CoreDeps.mcp_source` with
//! their tokens in `CoreDeps.secrets`, the watchers and the `source_sync` job on the scheduler
//! (hourly, a pass that queues each indexed MCP source its schedule makes due).

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

    /// Adds an MCP source: an indexed one signs in to its server and is synced now and on its
    /// schedule; a live one is stored for the relay and never indexed.
    pub(crate) async fn add_mcp_source(
        &self,
        ctx: &CommandCtx,
        args: SourceAddMcpArgs,
    ) -> Result<SourceRow, CoreError> {
        self.ready()?;
        self.check_scope(&args.scope)?;
        let meta = self.change_meta(ctx, "Added an MCP source".into(), "source_add_mcp");
        let mcp = self.deps.mcp_source.as_ref();
        let secrets = self.deps.secrets.as_ref();
        let clock = self.deps.clock.clone();
        let now = move || clock.now();
        let row = noter_knowledge::add_mcp(self.store(), meta, &now, mcp, secrets, args).await?;
        // @cpt-begin:cpt-noter-flow-core-knowledge-mcp:p1:inst-mcp-schedule
        // The hourly pass queues it again whenever its schedule makes it due.
        if row.mode == SourceMode::Indexed {
            self.enqueue_sync(&row.id)?;
        }
        // @cpt-end:cpt-noter-flow-core-knowledge-mcp:p1:inst-mcp-schedule
        // @cpt-begin:cpt-noter-flow-core-knowledge-mcp:p1:inst-mcp-return
        self.emit_entity_changed(&EntityChanged::Source {
            source: row.clone(),
        });
        Ok(row)
        // @cpt-end:cpt-noter-flow-core-knowledge-mcp:p1:inst-mcp-return
    }

    /// Revokes an indexed MCP source's token: its sync stops, the Keychain item goes, the source
    /// is sign-in-expired.
    pub(crate) fn revoke_source_token(
        &self,
        ctx: &CommandCtx,
        args: SourceIdArgs,
    ) -> Result<SourceRow, CoreError> {
        self.ready()?;
        let id = args.source_id;
        let meta = self.change_meta(
            ctx,
            "Revoked a source's sign-in".into(),
            "source_revoke_token",
        );
        let stop = || {
            if let Some(run) = lock(&self.sources.runs).remove(&id) {
                let _ = self.jobs.cancel(&run);
            }
        };
        let row =
            noter_knowledge::revoke(self.store(), meta, self.deps.secrets.as_ref(), &id, stop)?;
        self.emit_entity_changed(&EntityChanged::Source {
            source: row.clone(),
        });
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
    /// Stops the source's sync and watcher, then removes it with its whole local index; a
    /// failed removal keeps the source and watches it again.
    pub(crate) fn remove_source(
        &self,
        ctx: &CommandCtx,
        args: SourceIdArgs,
    ) -> Result<DeleteResult, CoreError> {
        self.ready()?;
        let id = args.source_id;
        // @cpt-begin:cpt-noter-flow-core-knowledge-remove:p1:inst-remove-index
        // An MCP source's token goes first: a locked Keychain keeps the source as it was.
        let lookup = id.clone();
        let row = self
            .store()
            .read(move |c| noter_knowledge::get(c, &lookup))?
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "this source no longer exists"))?;
        if row.has_token {
            let account = noter_knowledge::token_account(&id);
            self.deps
                .secrets
                .remove(&account)
                .map_err(|_| CoreError::new(ErrorCode::KeychainLocked, "the Keychain is locked"))?;
        }
        // @cpt-end:cpt-noter-flow-core-knowledge-remove:p1:inst-remove-index
        // @cpt-begin:cpt-noter-flow-core-knowledge-remove:p1:inst-remove-request
        if let Some(run) = lock(&self.sources.runs).remove(&id) {
            // A run that already ended is fine: a late worker finds no source and stops.
            let _ = self.jobs.cancel(&run);
        }
        self.sources.watchers.unwatch(&id);
        lock(&self.sources.closing).remove(&id);
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

    /// The scheduled pass: a sync for each indexed MCP source its schedule makes due.
    fn queue_due_sources(&self) {
        let Ok(list) = noter_knowledge::list(self.store()) else {
            return;
        };
        let now = self.deps.clock.now();
        for source in list.sources {
            if noter_knowledge::due(&source, now) {
                let _ = self.enqueue_sync(&source.id);
            }
        }
    }

    async fn sync_source(&self, ctx: &mut RunCtx) -> Result<(), Stop> {
        let Some(id) = ctx.subject().map(SourceId::new) else {
            self.queue_due_sources();
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
            mcp: self.deps.mcp_source.as_ref(),
            secrets: self.deps.secrets.as_ref(),
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

/// The real indexed-MCP transport (TL-42): noter-llm's streamable-HTTP client with the server's
/// OAuth behind the `McpSource` seam. The app sets it through `CoreDeps::with_mcp_source`; tests
/// and noter-core-harness keep the scripted servers.
pub struct HttpMcp(noter_llm::McpClient);

impl HttpMcp {
    /// `open` shows a URL (the server's sign-in page) in the user's browser.
    pub fn new(open: Arc<dyn Fn(&str) + Send + Sync>) -> Self {
        Self(noter_llm::McpClient::new(open))
    }
}

fn mcp_error(e: noter_llm::McpClientError) -> noter_knowledge::McpError {
    use noter_knowledge::McpError;
    use noter_llm::McpClientError as E;
    match e {
        E::Cancelled => McpError::Cancelled,
        E::Offline => McpError::Offline,
        E::Unauthorized => McpError::Rejected,
        E::Invalid => McpError::Invalid,
        E::Unaudited => McpError::Unaudited,
    }
}

fn mcp_call<'a>(
    server: &'a str,
    token: &'a str,
    remote: &'a noter_knowledge::Remote<'a>,
) -> noter_llm::Call<'a> {
    noter_llm::Call {
        server,
        token,
        audit: remote.audit,
        renewed: remote.renewed,
    }
}

fn remote_doc(r: noter_llm::Resource) -> noter_knowledge::RemoteDoc {
    noter_knowledge::RemoteDoc {
        uri: r.uri,
        title: r.title,
        // The server's version stands for the content hash: unchanged pages are not read again.
        hash: r.version,
    }
}

impl noter_knowledge::McpSource for HttpMcp {
    fn oauth<'a>(
        &'a self,
        server: &'a str,
        audit: noter_knowledge::Audit<'a>,
    ) -> BoxFuture<'a, Result<String, noter_knowledge::McpError>> {
        Box::pin(async move { self.0.sign_in(server, audit).await.map_err(mcp_error) })
    }

    fn list_resources<'a>(
        &'a self,
        server: &'a str,
        token: &'a str,
        remote: &'a noter_knowledge::Remote<'a>,
    ) -> BoxFuture<'a, Result<Option<noter_knowledge::Listing>, noter_knowledge::McpError>> {
        Box::pin(async move {
            let listed = self.0.list(&mcp_call(server, token, remote)).await;
            Ok(listed
                .map_err(mcp_error)?
                .map(|r| noter_knowledge::Listing {
                    items: r.items.into_iter().map(remote_doc).collect(),
                    complete: r.complete,
                }))
        })
    }

    fn read_resource<'a>(
        &'a self,
        server: &'a str,
        token: &'a str,
        uri: &'a str,
        remote: &'a noter_knowledge::Remote<'a>,
    ) -> BoxFuture<'a, Result<noter_knowledge::Page, noter_knowledge::McpError>> {
        Box::pin(async move {
            let read = self.0.read(&mcp_call(server, token, remote), uri).await;
            let contents = read.map_err(mcp_error)?;
            Ok(noter_knowledge::Page {
                // The listing's title is the page's.
                title: String::new(),
                mime: contents.mime,
                text: contents.text,
            })
        })
    }

    fn seed_query<'a>(
        &'a self,
        server: &'a str,
        token: &'a str,
        query: &'a str,
        remote: &'a noter_knowledge::Remote<'a>,
    ) -> BoxFuture<'a, Result<noter_knowledge::Listing, noter_knowledge::McpError>> {
        Box::pin(async move {
            let found = self.0.search(&mcp_call(server, token, remote), query).await;
            Ok(noter_knowledge::Listing {
                items: found
                    .map_err(mcp_error)?
                    .into_iter()
                    .map(remote_doc)
                    .collect(),
                complete: false,
            })
        })
    }
}
