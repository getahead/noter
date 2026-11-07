//! FEATURE cpt-noter-feature-core-credentials-privacy (slice 1): removing a key, preparing a
//! sign-in and installing a CLI as a job. The CLIs are behind `noter_llm::AccountCli` (TL-32).

use std::sync::{Arc, Weak};

use noter_jobs::{BoxFuture, JobHandler, Request, RunCtx, Stop, Trigger};
use noter_llm::{tool_of, CliError};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::Value;

use crate::Core;

fn cli_code(e: CliError) -> CoreError {
    match e {
        CliError::Missing => CoreError::new(ErrorCode::CliMissing, "the tool is not installed"),
        CliError::Unsupported => CoreError::new(
            ErrorCode::CliVersionUnsupported,
            "the installed version is not supported",
        ),
        CliError::Offline => CoreError::new(ErrorCode::Offline, "the install could not download"),
        CliError::Failed(text) => crate::internal(text),
    }
}

impl Core {
    // @cpt-flow:cpt-noter-flow-core-credentials-privacy-keys:p1
    pub(crate) async fn remove_key(
        &self,
        ctx: &noter_protocol::ipc::CommandCtx,
        provider: KeyProvider,
    ) -> Result<AccountsView, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-keys:p1:inst-key-remove
        self.ready()?;
        let meta = self.change_meta(
            ctx,
            format!("Removed the {provider:?} API key"),
            "api_key_remove",
        );
        self.accounts.remove(meta, provider)?;
        let availability = self.llm.refresh().await;
        Ok(self.accounts.observe(Some(availability)))
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-keys:p1:inst-key-remove
    }

    // @cpt-flow:cpt-noter-flow-core-credentials-privacy-prepare:p1
    pub(crate) async fn signin_prepare(
        &self,
        provider: AccountProvider,
    ) -> Result<SignInPrepare, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-prepare:p1:inst-prepare-check
        let tool = tool_of(provider);
        let status = self.deps.account_cli.status(tool).await;
        if !status.installed {
            return Err(cli_code(CliError::Missing));
        }
        if !status.supported {
            return Err(cli_code(CliError::Unsupported));
        }
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-prepare:p1:inst-prepare-check
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-prepare:p1:inst-prepare-return
        Ok(SignInPrepare {
            provider,
            cli: CliInfo {
                tool,
                installed: true,
                path: status.path,
                version: status.version,
                supported: true,
            },
            existing: status.identity,
            needs_personal_use_confirmation: provider == AccountProvider::Claude,
        })
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-prepare:p1:inst-prepare-return
    }

    pub(crate) fn queue_install(&self, tool: CliTool) -> Result<JobAccepted, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-prepare:p1:inst-install-request
        // `CliTool` is the contract's closed set: nothing else deserializes into it.
        let subject = serde_json::to_value(tool)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned));
        let mut req = Request::new(JobKind::CliInstall, Trigger::OnDemand);
        req.subject = subject;
        let queued = self.in_runtime(|| self.jobs.trigger(req))?;
        queued
            .map(|job_run_id| JobAccepted { job_run_id })
            .ok_or_else(|| crate::internal("the install could not be queued"))
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-prepare:p1:inst-install-request
    }

    /// The `CliInstall` job: install, report progress, recheck the version, then recompute
    /// availability. Nothing signs in or switches because an install succeeded.
    async fn install_job(&self, ctx: &mut RunCtx) -> Result<(), Stop> {
        let tool: CliTool = ctx
            .subject()
            .and_then(|s| serde_json::from_value(Value::String(s.to_owned())).ok())
            .ok_or_else(|| Stop::Failed(crate::internal("an install names its tool")))?;
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-prepare:p1:inst-install-run
        ctx.commit_batch(vec![], vec![], Some(0.1)).await?;
        let installed = self.deps.account_cli.install(tool).await;
        installed.map_err(|e| Stop::Failed(cli_code(e)))?;
        ctx.commit_batch(vec![], vec![], Some(0.8)).await?;
        let status = self.deps.account_cli.status(tool).await;
        if !status.installed {
            return Err(Stop::Failed(cli_code(CliError::Missing)));
        }
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-prepare:p1:inst-install-run
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-prepare:p1:inst-install-complete
        let availability = self.llm.refresh().await;
        self.accounts.observe(Some(availability));
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-prepare:p1:inst-install-complete
        Ok(())
    }
}

/// The scheduler's handler for the `CliInstall` job.
pub(crate) struct InstallJob(Weak<Core>);

impl JobHandler for InstallJob {
    fn run<'a>(&'a self, ctx: &'a mut RunCtx) -> BoxFuture<'a, Result<(), Stop>> {
        Box::pin(async move {
            let Some(core) = self.0.upgrade() else {
                return Err(Stop::Cancelled);
            };
            core.install_job(ctx).await
        })
    }
}

pub(crate) fn register(core: &Arc<Core>) {
    core.jobs.register(
        JobKind::CliInstall,
        Arc::new(InstallJob(Arc::downgrade(core))),
    );
}
