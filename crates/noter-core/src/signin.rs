//! FEATURE cpt-noter-feature-core-credentials-privacy (slice 2): the user's own Claude and
//! ChatGPT accounts. The CLIs own the sign-in; the core owns the session (a task that outlives
//! the sheet), the checks, the binding and the sign-out. Only identity, plan and times are kept.

use std::sync::Arc;
use std::time::Duration;

use noter_db::ChangeMeta;
use noter_jobs::BoxFuture;
use noter_llm::{tool_of, Failure, LoginOutcome};
use noter_protocol::error::RuntimeUnavailableReason;
use noter_protocol::ipc::{event_names, CommandCtx};
use noter_protocol::model::*;
use noter_protocol::*;
use tokio::sync::Notify;

use crate::accounts::{runtime_of, Connection, Session};
use crate::credentials::cli_code;
use crate::{lock, Core};

/// A browser sign-in is abandoned five minutes after it starts.
const DEADLINE: Duration = Duration::from_secs(300);

const ACCOUNTS: [AccountProvider; 2] = [AccountProvider::Claude, AccountProvider::Chatgpt];

fn account_runtime(provider: AccountProvider) -> RuntimeChoice {
    match provider {
        AccountProvider::Claude => RuntimeChoice::ClaudeAccount,
        AccountProvider::Chatgpt => RuntimeChoice::ChatgptAccount,
    }
}

fn key_provider(provider: AccountProvider) -> KeyProvider {
    match provider {
        AccountProvider::Claude => KeyProvider::Anthropic,
        AccountProvider::Chatgpt => KeyProvider::Codex,
    }
}

/// Claude: Pro or Max. ChatGPT: Plus, Pro, Business or Enterprise.
// shortcut: the plan is matched by name as the CLI reports it; the Q8 spike (owner Mac) may add
// a verified signal for Claude.
fn eligible(provider: AccountProvider, plan: &str) -> bool {
    let plan = plan.to_lowercase();
    let plans: &[&str] = match provider {
        AccountProvider::Claude => &["pro", "max"],
        AccountProvider::Chatgpt => &["plus", "pro", "business", "enterprise"],
    };
    plans.iter().any(|p| plan.contains(p))
}

// @cpt-begin:cpt-noter-algo-core-credentials-privacy-check-account:p1:inst-check-error
/// The contract error of a failed test request; never the request or its answer.
fn account_error(failure: Failure) -> CoreError {
    let offline = || {
        CoreError::new(
            ErrorCode::Offline,
            "the account could not be checked offline",
        )
    };
    let ended = || {
        CoreError::new(
            ErrorCode::AccountSignedOut,
            "the provider ended the sign-in",
        )
    };
    match failure {
        Failure::Runtime { code } => match code.as_str() {
            "offline" => offline(),
            "plan_not_eligible" => {
                CoreError::new(ErrorCode::PlanNotEligible, "the plan cannot be used")
            }
            "account_signed_out" => ended(),
            other => CoreError::new(
                ErrorCode::RuntimeUnavailable,
                format!("the account runtime failed ({other})"),
            ),
        },
        Failure::Timeout => offline(),
        Failure::Cancelled => CoreError::new(ErrorCode::SignInCancelled, "the check was cancelled"),
        Failure::Unavailable(e) => match &e.detail {
            Some(ErrorDetail::Runtime {
                reason: RuntimeUnavailableReason::Offline,
                ..
            }) => offline(),
            Some(ErrorDetail::Runtime {
                reason: RuntimeUnavailableReason::AccountSignedOut,
                ..
            }) => ended(),
            _ => e,
        },
        Failure::Storage(e) => e,
        Failure::Invalid { reason } => crate::internal(reason),
        Failure::Budget => crate::internal("the check did not run"),
    }
}
// @cpt-end:cpt-noter-algo-core-credentials-privacy-check-account:p1:inst-check-error

impl Core {
    /// Availability and the accounts as they are now: each connected account's CLI is asked
    /// whether its sign-in is still there.
    pub(crate) async fn refresh_accounts(&self) -> AccountsView {
        let availability = self.llm.refresh().await;
        self.detect_ended().await;
        self.accounts.observe(Some(availability))
    }

    async fn detect_ended(&self) {
        for provider in ACCOUNTS {
            let Some(connection) = self.accounts.connection(provider) else {
                continue;
            };
            let status = self.deps.account_cli.status(tool_of(provider)).await;
            // @cpt-begin:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-ended
            // @cpt-begin:cpt-noter-state-core-credentials-privacy-account:p1:inst-account-provider-ended
            if status.installed
                && status.auth_known
                && status.identity.is_none()
                && connection.ended_at.is_none()
            {
                let mut meta = self.account_meta(
                    format!("The {provider:?} sign-in was ended by the provider"),
                    "provider_ended",
                );
                meta.undoable = false;
                let at = self.deps.clock.now();
                // A write that fails leaves the account looking signed in until the next read.
                let _ = self.accounts.ended(meta, provider, at);
            } else if status.installed
                && status.auth_known
                && status.identity.as_ref() == Some(&connection.identity)
                && connection.ended_at.is_some()
            {
                let mut meta = self.account_meta(
                    format!("The {provider:?} sign-in is active again"),
                    "provider_session_recovered",
                );
                meta.undoable = false;
                let _ = self.accounts.revived(meta, provider);
            }
            // @cpt-end:cpt-noter-state-core-credentials-privacy-account:p1:inst-account-provider-ended
            // @cpt-end:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-ended
        }
    }

    /// A change the user did not type: the provider ended a session.
    fn account_meta(&self, summary: String, reason: &str) -> ChangeMeta {
        ChangeMeta {
            actor: Actor::You,
            summary,
            reason: reason.into(),
            evidence_ids: vec![],
            batch_id: None,
            undoable: true,
            surface: None,
        }
    }

    fn signin_progress(
        &self,
        session: &SignInSessionId,
        provider: AccountProvider,
        step: SignInStep,
        identity: Option<AccountIdentity>,
        error: Option<ErrorCode>,
    ) {
        let progress = SignInProgress {
            session_id: session.clone(),
            provider,
            step,
            identity,
            error,
        };
        self.deps
            .events
            .emit(event_names::SIGNIN_PROGRESS, crate::to_json(&progress));
    }

    /// Ends the provider's session with `code` unless something else ended it first: the login
    /// is stopped, so a late success finds nothing to bind.
    // @cpt-begin:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-fail
    // @cpt-begin:cpt-noter-state-core-credentials-privacy-account:p1:inst-account-failed
    fn fail_session(
        &self,
        provider: AccountProvider,
        id: &SignInSessionId,
        step: SignInStep,
        code: ErrorCode,
    ) {
        if self.accounts.end(provider, id) {
            self.deps.account_cli.cancel(provider);
            self.signin_progress(id, provider, step, None, Some(code));
        }
    }
    // @cpt-end:cpt-noter-state-core-credentials-privacy-account:p1:inst-account-failed
    // @cpt-end:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-fail

    /// Stops the provider's pending sign-in, if any, as cancelled.
    fn cancel_pending(&self, provider: AccountProvider) {
        if let Some(session) = self.accounts.session(provider) {
            self.fail_session(
                provider,
                &session.id,
                SignInStep::WaitingForBrowser,
                ErrorCode::SignInCancelled,
            );
            session.stop.notify_one();
        }
    }

    // @cpt-flow:cpt-noter-flow-core-credentials-privacy-signin:p1
    // @cpt-dod:cpt-noter-dod-core-credentials-privacy-signin:p1
    pub(crate) async fn signin_start(
        &self,
        ctx: &CommandCtx,
        args: SignInStartArgs,
    ) -> Result<SignInSession, CoreError> {
        self.ready()?;
        let provider = args.provider;
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-validate
        if provider == AccountProvider::Claude && !args.personal_use_confirmed {
            return Err(CoreError::new(
                ErrorCode::PersonalUseNotConfirmed,
                "Claude accounts are for personal use only",
            ));
        }
        self.signin_prepare(provider).await?;
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-validate
        let Some(core) = self.this() else {
            return Err(crate::internal("the core is not running"));
        };
        self.cancel_pending(provider);
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-start
        // @cpt-begin:cpt-noter-algo-core-credentials-privacy-secret-boundary:p1:inst-secret-account
        // The unmodified CLI runs the login and keeps the token: Noter gets a page, a code and,
        // at the end, an identity and a plan.
        let login = self
            .deps
            .account_cli
            .login(provider)
            .await
            .map_err(cli_code)?;
        // @cpt-end:cpt-noter-algo-core-credentials-privacy-secret-boundary:p1:inst-secret-account
        let expires_at = TimestampMs(self.deps.clock.now().0 + DEADLINE.as_millis() as i64);
        let session = SignInSession {
            id: SignInSessionId::new(format!("sis_{}", ulid::Ulid::generate())),
            provider,
            url: login.url,
            code: login.code,
            expires_at,
        };
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-start
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-wait
        // @cpt-begin:cpt-noter-state-core-credentials-privacy-account:p1:inst-account-start
        let pending = Session {
            id: session.id.clone(),
            expires_at,
            confirmed: args.personal_use_confirmed,
            stop: Arc::new(Notify::new()),
        };
        self.accounts.begin(provider, pending.clone());
        self.signin_progress(
            &session.id,
            provider,
            SignInStep::WaitingForBrowser,
            None,
            None,
        );
        let summary = format!("Signed in to {provider:?}");
        let mut meta = self.change_meta(ctx, summary, "account_signin");
        meta.undoable = false;
        let done = login.done;
        // The task is the core's: closing the sheet does not end it.
        self.spawn(async move { core.run_signin(provider, pending, done, meta).await });
        // @cpt-end:cpt-noter-state-core-credentials-privacy-account:p1:inst-account-start
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-wait
        Ok(session)
    }

    /// Waits for the browser, the deadline or a cancel, then checks and commits the account.
    async fn run_signin(
        &self,
        provider: AccountProvider,
        session: Session,
        done: BoxFuture<'static, LoginOutcome>,
        meta: ChangeMeta,
    ) {
        let id = session.id.clone();
        let waiting = SignInStep::WaitingForBrowser;
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-check
        let outcome = tokio::select! {
            outcome = done => outcome,
            () = session.stop.notified() => return,
            () = tokio::time::sleep(DEADLINE) => {
                self.fail_session(provider, &id, waiting, ErrorCode::SignInTimedOut);
                return;
            }
        };
        let identity = match outcome {
            LoginOutcome::SignedIn(identity) => identity,
            LoginOutcome::Cancelled => {
                self.fail_session(provider, &id, waiting, ErrorCode::SignInCancelled);
                return;
            }
            LoginOutcome::Failed(text) => {
                let code = if text == "offline" {
                    ErrorCode::Offline
                } else {
                    ErrorCode::Internal
                };
                self.fail_session(provider, &id, waiting, code);
                return;
            }
        };
        if !self.accounts.current(provider, &id) {
            return;
        }
        let signed = Some(identity.clone());
        self.signin_progress(&id, provider, SignInStep::SignedIn, signed.clone(), None);
        let step = |step| self.signin_progress(&id, provider, step, signed.clone(), None);
        let expiry = Some((&id, session.expires_at));
        let checked = self
            .check_account(provider, &identity, session.confirmed, expiry, &step)
            .await;
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-check
        if let Err((at, e)) = checked {
            self.fail_session(provider, &id, at, e.code);
            return;
        }
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-return
        // @cpt-begin:cpt-noter-state-core-credentials-privacy-account:p1:inst-account-connected
        let connection = self.connection_of(identity.clone(), session.confirmed);
        match self.accounts.connect(meta, provider, Some(&id), connection) {
            Ok(true) => self.signin_progress(&id, provider, SignInStep::Done, Some(identity), None),
            Ok(false) => {}
            Err(_) => {
                let at = SignInStep::SendingTestRequest;
                self.fail_session(provider, &id, at, ErrorCode::Internal);
            }
        }
        // @cpt-end:cpt-noter-state-core-credentials-privacy-account:p1:inst-account-connected
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-return
    }

    fn connection_of(&self, identity: AccountIdentity, confirmed: bool) -> Connection {
        Connection {
            identity,
            since: self.deps.clock.now(),
            personal_use_confirmed: confirmed,
            default_for_new_agents: false,
            ended_at: None,
        }
    }

    // @cpt-algo:cpt-noter-algo-core-credentials-privacy-check-account:p1
    /// Identity and plan come from the CLI only; the test request is the plan signal (TL-31).
    /// On failure the step it failed at comes with the error; nothing was bound.
    async fn check_account(
        &self,
        provider: AccountProvider,
        identity: &AccountIdentity,
        confirmed: bool,
        session: Option<(&SignInSessionId, TimestampMs)>,
        step: &(dyn Fn(SignInStep) + Sync),
    ) -> Result<(), (SignInStep, CoreError)> {
        let at = SignInStep::SignedIn;
        // @cpt-begin:cpt-noter-algo-core-credentials-privacy-check-account:p1:inst-check-session
        if let Some((id, expires_at)) = session {
            if self.deps.clock.now() >= expires_at {
                let expired = CoreError::new(ErrorCode::SignInTimedOut, "the sign-in expired");
                return Err((at, expired));
            }
            if !self.accounts.current(provider, id) {
                let ended = CoreError::new(ErrorCode::SignInCancelled, "the sign-in ended");
                return Err((at, ended));
            }
        }
        // @cpt-end:cpt-noter-algo-core-credentials-privacy-check-account:p1:inst-check-session
        step(SignInStep::CheckingPlan);
        let at = SignInStep::CheckingPlan;
        // @cpt-begin:cpt-noter-algo-core-credentials-privacy-check-account:p1:inst-check-plan
        if provider == AccountProvider::Claude && !confirmed {
            let unconfirmed = CoreError::new(
                ErrorCode::PersonalUseNotConfirmed,
                "Claude accounts are for personal use only",
            );
            return Err((at, unconfirmed));
        }
        if !eligible(provider, &identity.plan) {
            let plan = CoreError::new(ErrorCode::PlanNotEligible, "the plan cannot be used");
            return Err((at, plan));
        }
        // @cpt-end:cpt-noter-algo-core-credentials-privacy-check-account:p1:inst-check-plan
        step(SignInStep::SendingTestRequest);
        self.test_request(provider)
            .await
            .map_err(|e| (SignInStep::SendingTestRequest, e))?;
        // @cpt-begin:cpt-noter-algo-core-credentials-privacy-check-account:p1:inst-check-return
        Ok(())
        // @cpt-end:cpt-noter-algo-core-credentials-privacy-check-account:p1:inst-check-return
    }

    /// The short test request through the router and the gate, on the account's own runtime.
    async fn test_request(&self, provider: AccountProvider) -> Result<DurationMs, CoreError> {
        let privacy = noter_llm::Privacy {
            mode: lock(&self.settings).privacy.mode,
            sensitive: false,
            offline: !self.app().environment.online,
        };
        let started = tokio::time::Instant::now();
        self.llm
            .verify_account(account_runtime(provider), privacy)
            .await
            .map_err(account_error)?;
        let ms = started.elapsed().as_millis();
        Ok(DurationMs(u32::try_from(ms).unwrap_or(u32::MAX)))
    }

    // @cpt-begin:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-cancel
    pub(crate) async fn signin_cancel(
        &self,
        session_id: &SignInSessionId,
    ) -> Result<AccountsView, CoreError> {
        let provider = self
            .accounts
            .session_provider(session_id)
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound, format!("sign-in {session_id}")))?;
        self.cancel_pending(provider);
        Ok(self.refresh_accounts().await)
    }
    // @cpt-end:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-cancel

    pub(crate) async fn use_existing(
        &self,
        ctx: &CommandCtx,
        provider: AccountProvider,
    ) -> Result<AccountsView, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-existing
        let prepared = self.signin_prepare(provider).await?;
        let identity = prepared.existing.ok_or_else(|| {
            CoreError::new(ErrorCode::AccountSignedOut, "the tool is not signed in")
        })?;
        // 1.4 gap: `account_use_existing` has no confirmation field, so Claude reuse needs one
        // recorded by an earlier `account_signin_start`.
        let confirmed = provider != AccountProvider::Claude
            || self
                .accounts
                .connection(provider)
                .is_some_and(|c| c.personal_use_confirmed);
        self.cancel_pending(provider);
        self.check_account(provider, &identity, confirmed, None, &|_| {})
            .await
            .map_err(|(_, e)| e)?;
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-existing
        // @cpt-begin:cpt-noter-state-core-credentials-privacy-account:p1:inst-account-existing
        let summary = format!("Connected {provider:?}");
        let mut meta = self.change_meta(ctx, summary, "account_use_existing");
        meta.undoable = false;
        let connection = self.connection_of(identity, confirmed);
        self.accounts.connect(meta, provider, None, connection)?;
        // @cpt-end:cpt-noter-state-core-credentials-privacy-account:p1:inst-account-existing
        Ok(self.refresh_accounts().await)
    }

    // @cpt-flow:cpt-noter-flow-core-credentials-privacy-bind-signout:p1
    // @cpt-dod:cpt-noter-dod-core-credentials-privacy-binding:p1
    pub(crate) async fn bind_agents(
        &self,
        ctx: &CommandCtx,
        args: AccountBindArgs,
    ) -> Result<AccountBindResult, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-bind-validate
        self.connected(args.provider).await?;
        // There is no `agents` table before M4: every requested agent is unknown.
        if let Some(agent) = args.agent_ids.first() {
            return Err(CoreError::new(
                ErrorCode::NotFound,
                format!("agent {agent}"),
            ));
        }
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-bind-validate
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-bind-write
        let summary = format!("Set {:?} as the default for new agents", args.provider);
        let meta = self.change_meta(ctx, summary, "account_bind_agents");
        let change_id =
            self.accounts
                .set_default(meta, args.provider, args.default_for_new_agents)?;
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-bind-write
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-bind-return
        let accounts = self.accounts.observe(None);
        Ok(AccountBindResult {
            accounts,
            change_id,
        })
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-bind-return
    }

    /// The account is connected and its tool still runs; else the typed reason.
    async fn connected(&self, provider: AccountProvider) -> Result<(), CoreError> {
        let view = self.refresh_accounts().await;
        let account = view.accounts.iter().find(|a| a.provider == provider);
        if !account.is_some_and(|a| matches!(a.status, AccountStatus::SignedIn { .. })) {
            return Err(CoreError::new(
                ErrorCode::AccountSignedOut,
                "the account is not signed in",
            ));
        }
        if !account.is_some_and(|a| a.cli.installed && a.cli.supported) {
            return Err(CoreError::new(
                ErrorCode::RuntimeUnavailable,
                "the account's tool is not usable",
            ));
        }
        Ok(())
    }

    // @cpt-begin:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-account-test
    pub(crate) async fn account_test_now(
        &self,
        provider: AccountProvider,
    ) -> Result<AccountTestResult, CoreError> {
        self.ready()?;
        self.connected(provider).await?;
        Ok(match self.test_request(provider).await {
            Ok(latency) => AccountTestResult {
                ok: true,
                latency_ms: Some(latency),
                error: None,
            },
            Err(e) => AccountTestResult {
                ok: false,
                latency_ms: None,
                error: Some(e.code),
            },
        })
    }
    // @cpt-end:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-account-test

    pub(crate) async fn sign_out(
        &self,
        ctx: &CommandCtx,
        args: SignOutArgs,
    ) -> Result<AccountsView, CoreError> {
        self.ready()?;
        let provider = args.provider;
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-signout-request
        // @cpt-begin:cpt-noter-state-core-credentials-privacy-account:p1:inst-account-signout
        self.cancel_pending(provider);
        let summary = format!("Signed out of {provider:?}");
        let mut meta = self.change_meta(ctx, summary, "account_sign_out");
        meta.undoable = false;
        self.accounts.disconnect(meta, provider)?;
        // @cpt-end:cpt-noter-state-core-credentials-privacy-account:p1:inst-account-signout
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-signout-request
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-signout-apply
        self.fall_back_roles(ctx, provider)?;
        let logout = if args.also_in_cli {
            Some(self.deps.account_cli.logout(provider).await)
        } else {
            None
        };
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-signout-apply
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-signout-return
        let view = self.refresh_accounts().await;
        // The CLI is never claimed signed out when its logout failed.
        match logout {
            Some(Err(e)) => Err(cli_code(e)),
            _ => Ok(view),
        }
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-signout-return
    }

    /// Every role on the account's runtime moves to the matching API-key runtime when its key
    /// works; with no usable key the role stays and the account reads as not signed in.
    fn fall_back_roles(
        &self,
        ctx: &CommandCtx,
        provider: AccountProvider,
    ) -> Result<(), CoreError> {
        let key = key_provider(provider);
        let keys = self.accounts.observe(None).keys;
        let usable = keys
            .iter()
            .any(|k| k.provider == key && matches!(k.status, KeyStatus::Configured { .. }));
        if !usable {
            return Ok(());
        }
        let (account, key) = (account_runtime(provider), runtime_of(key));
        let mut settings = lock(&self.settings);
        let mut roles = settings.runtimes.clone();
        let mut moved = false;
        for role in [
            &mut roles.live_copilot,
            &mut roles.post_call,
            &mut roles.search_answers,
        ] {
            if *role == account {
                *role = key;
                moved = true;
            }
        }
        if moved {
            let section = SettingsSection::Runtimes(roles);
            let rev = self.write_section(ctx, &settings, &section, None, "account_sign_out")?;
            self.settings_written(&mut settings, section, rev);
        }
        Ok(())
    }
}
