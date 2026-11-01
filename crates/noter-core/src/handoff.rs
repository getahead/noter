//! The handoff commands (FEATURE cpt-noter-feature-core-handoff): noter-handoff's prompts,
//! versions, mappings and launch order wired to the items, the router and `NativeOps`.

use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::sync::Arc;

use noter_db::rusqlite::OptionalExtension;
use noter_db::ChangeMeta;
use noter_handoff::{Begin, Facts, NewVersion, Quote};
use noter_llm::{Cancel, Failure, LlmRuntime, Privacy, Provenance, RunRequest, Skill, TaskKind};
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::CommandCtx;
use noter_protocol::model::*;
use noter_protocol::skills::HandoffPromptOutput;
use noter_protocol::*;
use serde_json::Value;

use crate::settings::invalid;
use crate::{internal, lock, Core};

/// The handoff skill's version, recorded in `llm_runs`.
const SKILL_VERSION: &str = "1";
/// The longest prompt an edit may save, in characters.
const MAX_PROMPT: usize = 100_000;

fn not_found() -> CoreError {
    CoreError::new(ErrorCode::NotFound, "this item no longer exists")
}

fn prompt_not_ready() -> CoreError {
    CoreError::new(ErrorCode::PromptNotReady, "the prompt is not written yet")
}

/// The runtime a target's own tool runs on.
fn runtime_of(target: HandoffTarget) -> RuntimeChoice {
    match target {
        HandoffTarget::ClaudeCode => RuntimeChoice::ClaudeAccount,
        HandoffTarget::Codex => RuntimeChoice::ChatgptAccount,
    }
}

fn failure(f: Failure) -> CoreError {
    match f {
        Failure::Unavailable(e) | Failure::Storage(e) => e,
        Failure::Budget => CoreError::new(ErrorCode::BudgetPaused, "the budget is spent"),
        other => CoreError::new(ErrorCode::Internal, format!("the prompt failed: {other:?}")),
    }
}

/// The version a use records: the user's edit if there is one, else the generated prompt.
fn used(view: &HandoffView) -> Option<&VersionMeta> {
    let kind = if view.edited {
        VersionKind::UserEdit
    } else {
        VersionKind::Generated
    };
    view.versions.iter().rev().find(|v| v.kind == kind)
}

impl Core {
    // @cpt-flow:cpt-noter-flow-core-handoff-prompt:p1
    // @cpt-dod:cpt-noter-dod-core-handoff-prompts:p1
    // @cpt-begin:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-get
    /// The drawer's view: the item, the prompt state, the usable and generated bodies, the
    /// versions, the target and its repository and launch plan.
    pub(crate) fn handoff_view(&self, item_id: &str) -> Result<HandoffView, CoreError> {
        self.ready()?;
        let item = self.item_view(item_id)?.ok_or_else(not_found)?;
        let versions = noter_handoff::versions(self.store(), item_id)?;
        // @cpt-begin:cpt-noter-algo-core-handoff-build:p1:inst-build-keep-edit
        let generated = versions
            .iter()
            .rev()
            .find(|v| v.meta.kind == VersionKind::Generated);
        let edit = versions
            .iter()
            .rev()
            .find(|v| v.meta.kind == VersionKind::UserEdit);
        let usable = edit.or(generated);
        // @cpt-end:cpt-noter-algo-core-handoff-build:p1:inst-build-keep-edit
        let mappings = noter_handoff::repos(self.store())?;
        let (repo, unmapped_key) = noter_handoff::resolve(&mappings, item.linked_issue.as_deref());
        let target = self
            .handoffs
            .target(item_id)
            .or(item.handoff.as_ref().map(|h| h.target))
            .or(repo.as_ref().map(|r| r.default_tool))
            .unwrap_or(HandoffTarget::ClaudeCode);
        Ok(HandoffView {
            state: self.handoffs.state(item_id, usable.is_some()),
            rev: versions.last().map(|v| Rev(v.meta.n)),
            prompt_md: usable.map(|v| v.body_md.clone()),
            generated_md: generated.map(|v| v.body_md.clone()),
            edited: edit.is_some(),
            versions: versions.iter().map(|v| v.meta.clone()).collect(),
            target,
            repo,
            unmapped_key,
            launch: self.deps.native_ops.launch_plan(target),
            default_action: match &item.owner {
                Some(owner) if !owner.is_you => HandoffAction::CopyPrompt,
                _ => HandoffAction::Open,
            },
            last: item.handoff.clone(),
            item,
        })
    }
    // @cpt-end:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-get

    /// The view after a change, to the drawer through `entity:changed`; a deleted item has
    /// none.
    fn handoff_published(&self, item_id: &str) {
        if let Ok(handoff) = self.handoff_view(item_id) {
            self.emit_entity_changed(&EntityChanged::Handoff { handoff });
        }
    }

    pub(crate) fn generate_handoff(
        &self,
        args: HandoffGenerateArgs,
    ) -> Result<HandoffView, CoreError> {
        let item_id = args.item_id.as_str();
        let view = self.handoff_view(item_id)?;
        // @cpt-begin:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-cache
        if view.state == PromptState::Generating || (!args.regenerate && view.prompt_md.is_some()) {
            return Ok(view);
        }
        // @cpt-end:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-cache
        let core = self
            .this()
            .ok_or_else(|| internal("the core is not started"))?;
        if let Begin::Started { id, cancel } = self.handoffs.begin(item_id) {
            let item_id = item_id.to_string();
            self.spawn(async move { core.finish_handoff(item_id, id, cancel).await });
        }
        self.handoff_view(item_id)
    }

    // @cpt-begin:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-complete
    /// Generation `id`: the model run, then the new version while the generation is current,
    /// then the ready (or failed) view. A cancelled or superseded run publishes nothing.
    async fn finish_handoff(self: Arc<Self>, item_id: String, id: u64, cancel: Cancel) {
        let written = match self.write_handoff(&item_id, cancel).await {
            Ok((output, md, run)) => self.handoffs.finish(&item_id, id, || {
                let meta = ChangeMeta {
                    actor: Actor::Model {
                        llm_run_id: run.llm_run_id.clone(),
                        runtime: run.runtime,
                        model: run.model.clone(),
                    },
                    summary: "Wrote handoff prompt".into(),
                    reason: "handoff_generate".into(),
                    evidence_ids: vec![],
                    batch_id: None,
                    undoable: false,
                    surface: None,
                };
                noter_handoff::append(
                    self.store(),
                    meta,
                    NewVersion {
                        item_id: &item_id,
                        kind: VersionKind::Generated,
                        output: Some(&output),
                        body_md: &md,
                        now: self.deps.clock.now(),
                        base_n: None,
                    },
                )
            }),
            Err(e) => self.handoffs.fail(&item_id, id, e.code).then_some(Err(e)),
        };
        if written.is_some() {
            self.handoff_published(&item_id);
        }
    }
    // @cpt-end:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-complete

    // @cpt-algo:cpt-noter-algo-core-handoff-build:p1
    /// The handoff skill on the item's facts through the router: the target's runtime, then
    /// local; a sensitive call stays local.
    async fn write_handoff(
        &self,
        item_id: &str,
        cancel: Cancel,
    ) -> Result<(Value, String, Provenance), CoreError> {
        let view = self.handoff_view(item_id)?;
        let facts = self.handoff_facts(&view)?;
        // @cpt-begin:cpt-noter-algo-core-handoff-build:p1:inst-build-route
        let mode = lock(&self.settings).privacy.mode;
        let (_privacy, rx) = tokio::sync::watch::channel(Privacy {
            mode,
            sensitive: facts.sensitive,
            offline: false,
        });
        let mut req = RunRequest::new(
            Skill::Handoff,
            SKILL_VERSION,
            noter_handoff::packet(&facts),
            TaskKind::Handoff {
                target: runtime_of(view.target),
            },
            rx,
        );
        req.cancel = cancel;
        req.call_id = Some(view.item.call.id.clone());
        self.llm().refresh().await;
        let done = self.llm().run_once(req).await.map_err(failure)?;
        // @cpt-end:cpt-noter-algo-core-handoff-build:p1:inst-build-route
        // @cpt-begin:cpt-noter-algo-core-handoff-build:p1:inst-build-render
        let out: HandoffPromptOutput = serde_json::from_value(done.output).map_err(internal)?;
        let permitted: Vec<String> = facts.linked_issue.into_iter().collect();
        let out = noter_handoff::checked(out, &permitted);
        let md = noter_handoff::render(&out);
        // @cpt-end:cpt-noter-algo-core-handoff-build:p1:inst-build-render
        // @cpt-begin:cpt-noter-algo-core-handoff-build:p1:inst-build-return
        let output = serde_json::to_value(&out).map_err(internal)?;
        Ok((output, md, done.provenance))
        // @cpt-end:cpt-noter-algo-core-handoff-build:p1:inst-build-return
    }

    // @cpt-begin:cpt-noter-algo-core-handoff-build:p1:inst-build-evidence
    /// The item's evidence spans as transcript words with speaker and time (the archive pass
    /// when the call has one), the call's decisions and its privacy class.
    fn handoff_facts(&self, view: &HandoffView) -> Result<Facts, CoreError> {
        let item = view.item.clone();
        let repo = view
            .repo
            .as_ref()
            .map(|r| (r.key.clone(), r.local_path.clone()));
        let target = view.target;
        self.store().read(move |c| {
            let mut quotes = Vec::new();
            let mut stmt = c.prepare(
                "SELECT s.id, COALESCE(sp.label, ''), s.t0_ms, s.text FROM segments s
                 LEFT JOIN speakers sp ON sp.id = s.speaker_id
                 WHERE s.call_id = ?1 AND s.t1_ms > ?2 AND s.t0_ms < ?3
                   AND (?4 IS NULL OR s.channel = ?4)
                   AND s.pass = (CASE WHEN EXISTS (SELECT 1 FROM segments
                       WHERE call_id = ?1 AND pass = 'archive') THEN 'archive' ELSE 'live' END)
                 ORDER BY s.t0_ms",
            )?;
            for span in &item.spans {
                let channel = span.channel.map(|ch| match ch {
                    AudioChannel::Mic => "mic",
                    AudioChannel::Sys => "sys",
                });
                let rows = stmt.query_map(
                    noter_db::rusqlite::params![
                        span.call_id.as_str(),
                        span.t0_ms.0,
                        span.t1_ms.0,
                        channel
                    ],
                    |r| {
                        let t0: i64 = r.get(2)?;
                        Ok(Quote {
                            segment_id: r.get(0)?,
                            speaker: r.get(1)?,
                            at: format!("{}:{:02}", t0 / 60_000, t0 / 1000 % 60),
                            text: r.get(3)?,
                        })
                    },
                )?;
                for q in rows {
                    quotes.push(q?);
                }
            }
            let decisions = c
                .prepare(
                    "SELECT text FROM items WHERE call_id = ?1 AND kind = 'decision'
                     AND review_state != 'rejected' AND id != ?2 ORDER BY rowid",
                )?
                .query_map([item.call.id.as_str(), item.id.as_str()], |r| r.get(0))?
                .collect::<Result<Vec<String>, _>>()?;
            let sensitive = c
                .query_row(
                    "SELECT privacy_class = 'sensitive' FROM calls WHERE id = ?1",
                    [item.call.id.as_str()],
                    |r| r.get(0),
                )
                .optional()?
                .unwrap_or(false);
            Ok(Facts {
                kind: item.kind,
                text: item.text,
                call_title: item.call.title,
                linked_issue: item.linked_issue,
                evidence: quotes,
                decisions,
                repo,
                target,
                sensitive,
            })
        })
    }
    // @cpt-end:cpt-noter-algo-core-handoff-build:p1:inst-build-evidence

    pub(crate) fn cancel_handoff(&self, args: ItemIdArgs) -> Result<HandoffView, CoreError> {
        let item_id = args.item_id.as_str();
        self.handoff_view(item_id)?;
        if self.handoffs.cancel(item_id) {
            self.handoff_published(item_id);
        }
        self.handoff_view(item_id)
    }

    // @cpt-begin:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-edit
    // @cpt-begin:cpt-noter-state-core-handoff-prompt:p1:inst-st-use
    /// A user edit on the current `rev`: a new version beside the generated one; the item's own
    /// text is untouched.
    pub(crate) fn edit_handoff(
        &self,
        ctx: &CommandCtx,
        args: HandoffEditArgs,
    ) -> Result<HandoffView, CoreError> {
        let item_id = args.item_id.as_str();
        match args.prompt_md.trim().chars().count() {
            0 => return Err(invalid("prompt_md", ValidationRule::Required)),
            n if n > MAX_PROMPT => return Err(invalid("prompt_md", ValidationRule::TooLong)),
            _ => {}
        }
        if self.handoff_view(item_id)?.rev.is_none() {
            return Err(prompt_not_ready());
        }
        noter_handoff::append(
            self.store(),
            self.change_meta(ctx, "Edited handoff prompt".into(), "handoff_edit"),
            NewVersion {
                item_id,
                kind: VersionKind::UserEdit,
                output: None,
                body_md: &args.prompt_md,
                now: self.deps.clock.now(),
                base_n: Some(args.rev.0),
            },
        )?;
        self.handoff_published(item_id);
        // @cpt-begin:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-return
        self.handoff_view(item_id)
        // @cpt-end:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-return
    }
    // @cpt-end:cpt-noter-state-core-handoff-prompt:p1:inst-st-use
    // @cpt-end:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-edit

    // @cpt-flow:cpt-noter-flow-core-handoff-repositories:p1
    // @cpt-begin:cpt-noter-flow-core-handoff-repositories:p1:inst-repo-target
    /// The wanted target, and its launch line; nothing is generated or opened.
    pub(crate) fn target_handoff(&self, args: HandoffTargetArgs) -> Result<HandoffView, CoreError> {
        let item_id = args.item_id.as_str();
        self.handoff_view(item_id)?;
        self.handoffs.set_target(item_id, args.target);
        self.handoff_published(item_id);
        // @cpt-begin:cpt-noter-flow-core-handoff-repositories:p1:inst-repo-return
        self.handoff_view(item_id)
        // @cpt-end:cpt-noter-flow-core-handoff-repositories:p1:inst-repo-return
    }
    // @cpt-end:cpt-noter-flow-core-handoff-repositories:p1:inst-repo-target

    pub(crate) fn list_repos(&self) -> Result<RepoList, CoreError> {
        self.ready()?;
        Ok(RepoList {
            mappings: noter_handoff::repos(self.store())?,
        })
    }

    // @cpt-begin:cpt-noter-flow-core-handoff-repositories:p1:inst-repo-upsert
    /// Saves a mapping; without a folder the core asks for one with the folder panel, and
    /// closing it is `cancelled` with nothing changed.
    pub(crate) async fn upsert_repo(
        &self,
        ctx: &CommandCtx,
        args: RepoUpsertArgs,
    ) -> Result<RepoList, CoreError> {
        self.ready()?;
        let path = match args.local_path {
            Some(path) => path,
            None => self
                .deps
                .native_ops
                .save_panel(&args.key, crate::SaveKind::Folder)
                .await
                .ok_or_else(|| CoreError::new(ErrorCode::Cancelled, "no folder chosen"))?
                .to_string_lossy()
                .into_owned(),
        };
        let meta = self.change_meta(ctx, format!("Mapped {}", args.key.trim()), "repo_upsert");
        let mappings = noter_handoff::upsert_repo(
            self.store(),
            meta,
            args.id,
            &args.key,
            &path,
            args.default_tool,
        )?;
        Ok(RepoList { mappings })
    }
    // @cpt-end:cpt-noter-flow-core-handoff-repositories:p1:inst-repo-upsert

    pub(crate) fn remove_repo(
        &self,
        ctx: &CommandCtx,
        args: RepoIdArgs,
    ) -> Result<RepoList, CoreError> {
        self.ready()?;
        let meta = self.change_meta(ctx, "Removed a repository mapping".into(), "repo_remove");
        Ok(RepoList {
            mappings: noter_handoff::remove_repo(self.store(), meta, &args.id)?,
        })
    }

    // @cpt-flow:cpt-noter-flow-core-handoff-use:p1
    // @cpt-dod:cpt-noter-dod-core-handoff-launch:p1
    // @cpt-begin:cpt-noter-flow-core-handoff-use:p1:inst-use-request
    /// The usable prompt and the version a use records; `prompt_not_ready` while there is
    /// none or it is being written.
    fn prompt_to_use(&self, item_id: &str) -> Result<(HandoffView, String, String), CoreError> {
        let view = self.handoff_view(item_id)?;
        let md = match (&view.state, &view.prompt_md) {
            (PromptState::Generating, _) | (_, None) => return Err(prompt_not_ready()),
            (_, Some(md)) => md.clone(),
        };
        let version = used(&view).ok_or_else(prompt_not_ready)?;
        let edited = if view.edited { "edited" } else { "unedited" };
        let record = format!("{} {edited}", version.id.as_str());
        Ok((view, md, record))
    }
    // @cpt-end:cpt-noter-flow-core-handoff-use:p1:inst-use-request

    /// Open in the target tool: the mapped folder checked, the prompt written to
    /// `handoffs/<item>.md`, the launch order tried, and only then the item handed off.
    pub(crate) async fn open_handoff(
        &self,
        ctx: &CommandCtx,
        args: ItemIdArgs,
    ) -> Result<HandoffOpenResult, CoreError> {
        let item_id = args.item_id.as_str();
        let (view, md, record) = self.prompt_to_use(item_id)?;
        // @cpt-begin:cpt-noter-flow-core-handoff-use:p1:inst-use-file
        let repo = view
            .repo
            .clone()
            .ok_or_else(|| CoreError::new(ErrorCode::RepoNotMapped, "no repository mapped"))?;
        if !Path::new(&repo.local_path).is_dir() {
            return Err(CoreError::new(
                ErrorCode::RepoPathMissing,
                "the mapped folder is gone",
            ));
        }
        let file = self.data_dir.join(noter_handoff::file_path(item_id));
        write_private(&file, &md)?;
        // @cpt-end:cpt-noter-flow-core-handoff-use:p1:inst-use-file
        // @cpt-begin:cpt-noter-flow-core-handoff-use:p1:inst-use-open
        // @cpt-begin:cpt-noter-algo-core-handoff-launch:p1:inst-launch-handlers
        let plan = self.deps.native_ops.launch_plan(view.target);
        // @cpt-end:cpt-noter-algo-core-handoff-launch:p1:inst-launch-handlers
        // @cpt-begin:cpt-noter-algo-core-handoff-launch:p1:inst-launch-short
        // @cpt-begin:cpt-noter-algo-core-handoff-launch:p1:inst-launch-safe
        // Only the folder and the file's path go to the native layer, which encodes them as
        // URL data or one quoted shell word; the prompt's text never travels.
        let req = crate::LaunchRequest {
            target: view.target,
            cwd: repo.local_path.clone().into(),
            prompt_file: file.clone(),
        };
        // @cpt-end:cpt-noter-algo-core-handoff-launch:p1:inst-launch-safe
        // @cpt-end:cpt-noter-algo-core-handoff-launch:p1:inst-launch-short
        let ops = &self.deps.native_ops;
        let path_used = noter_handoff::launch(&plan, |p| ops.launch(p, &req))
            .await
            .map_err(|code| CoreError::new(code, "the tool did not open"))?;
        // @cpt-end:cpt-noter-flow-core-handoff-use:p1:inst-use-open
        // @cpt-begin:cpt-noter-flow-core-handoff-use:p1:inst-use-record
        let mutation = self.hand_off(
            ctx,
            item_id,
            view.target,
            Some(&repo.local_path),
            &format!("handoff_open: {record}"),
        )?;
        // @cpt-end:cpt-noter-flow-core-handoff-use:p1:inst-use-record
        // @cpt-begin:cpt-noter-flow-core-handoff-use:p1:inst-use-publish
        self.handoff_published(item_id);
        // @cpt-end:cpt-noter-flow-core-handoff-use:p1:inst-use-publish
        // @cpt-begin:cpt-noter-algo-core-handoff-launch:p1:inst-launch-return
        // @cpt-begin:cpt-noter-flow-core-handoff-use:p1:inst-use-return
        Ok(HandoffOpenResult {
            path_used,
            item: mutation.item,
            prompt_file: file.to_string_lossy().into_owned(),
        })
        // @cpt-end:cpt-noter-flow-core-handoff-use:p1:inst-use-return
        // @cpt-end:cpt-noter-algo-core-handoff-launch:p1:inst-launch-return
    }

    /// Copy Prompt: the Markdown on the clipboard, then the item handed off; works without a
    /// mapping or Automation.
    pub(crate) async fn copy_handoff(
        &self,
        ctx: &CommandCtx,
        args: ItemIdArgs,
    ) -> Result<HandoffCopyResult, CoreError> {
        let item_id = args.item_id.as_str();
        let (view, md, record) = self.prompt_to_use(item_id)?;
        // @cpt-begin:cpt-noter-flow-core-handoff-use:p1:inst-use-copy
        let text = crate::ClipboardText {
            plain: md.clone(),
            markdown: Some(md.clone()),
            html: None,
        };
        self.deps
            .native_ops
            .clipboard_write(&text)
            .await
            .map_err(|_| internal("the clipboard did not take the prompt"))?;
        // @cpt-end:cpt-noter-flow-core-handoff-use:p1:inst-use-copy
        let cwd = view.repo.as_ref().map(|r| r.local_path.as_str());
        let reason = format!("handoff_copy: {record}");
        let mutation = self.hand_off(ctx, item_id, view.target, cwd, &reason)?;
        self.handoff_published(item_id);
        Ok(HandoffCopyResult {
            chars: md.chars().count() as u32,
            item: mutation.item,
        })
    }
}

/// Writes `text` to `path` readable by the user only, replacing it whole.
fn write_private(path: &Path, text: &str) -> Result<(), CoreError> {
    let dir = path.parent().ok_or_else(|| internal("no folder"))?;
    std::fs::create_dir_all(dir).map_err(internal)?;
    let tmp = path.with_extension("md.tmp");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)
        .map_err(internal)?;
    file.write_all(text.as_bytes()).map_err(internal)?;
    file.sync_all().map_err(internal)?;
    std::fs::rename(&tmp, path).map_err(internal)
}
