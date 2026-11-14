//! FEATURE cpt-noter-feature-core-credentials-privacy, slice 2: own-account sign-in sessions,
//! binding, the account test and sign-out, on the scripted account CLI, the scripted runtime,
//! the in-memory Keychain stand-in and tokio's paused time.

use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{
    AccountCli, Adapters, Clock, Core, CoreDeps, EventEmitter, MemorySecrets, Scripted,
    ScriptedAccountCli, ToolScript,
};
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::Value;

type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

const T0: i64 = 1_790_000_000_000;
const CODE: &str = "ABCD-9137-ONE-TIME";

struct TickClock(AtomicI64);

impl Clock for TickClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(self.0.load(Ordering::SeqCst))
    }
}

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

impl Events {
    /// `step`, or `error` once it ended in one, of each progress event of `provider`.
    fn progress(&self, provider: &str) -> Vec<String> {
        let all = self.0.lock().unwrap();
        all.iter()
            .filter(|(e, p)| *e == event_names::SIGNIN_PROGRESS && p["provider"] == provider)
            .map(|(_, p)| match p["error"].as_str() {
                Some(error) => error.to_owned(),
                None => p["step"].as_str().unwrap().to_owned(),
            })
            .collect()
    }

    fn dump(&self) -> String {
        format!("{:?}", self.0.lock().unwrap())
    }
}

struct World {
    core: Arc<Core>,
    events: Arc<Events>,
    cli: ScriptedAccountCli,
    gated_cli: Arc<GatedStatusCli>,
    scripted: Scripted,
}

#[derive(Default)]
struct GatedStatusCli {
    inner: ScriptedAccountCli,
    hold_next: std::sync::atomic::AtomicBool,
    started: tokio::sync::Notify,
    release: tokio::sync::Notify,
}

impl AccountCli for GatedStatusCli {
    fn status(&self, tool: CliTool) -> BoxFuture<'_, noter_llm::CliStatus> {
        let inner = self.inner.clone();
        Box::pin(async move {
            let status = inner.status(tool).await;
            if self.hold_next.swap(false, Ordering::SeqCst) {
                self.started.notify_one();
                self.release.notified().await;
            }
            status
        })
    }

    fn login(
        &self,
        provider: AccountProvider,
    ) -> BoxFuture<'_, Result<noter_llm::LoginStart, noter_llm::CliError>> {
        self.inner.login(provider)
    }

    fn cancel(&self, provider: AccountProvider) {
        self.inner.cancel(provider);
    }

    fn logout(&self, provider: AccountProvider) -> BoxFuture<'_, Result<(), noter_llm::CliError>> {
        self.inner.logout(provider)
    }

    fn install(
        &self,
        tool: CliTool,
    ) -> BoxFuture<'_, Result<noter_llm::CliStatus, noter_llm::CliError>> {
        self.inner.install(tool)
    }
}

fn open(dir: &Path, script: Option<&str>) -> World {
    let events = Arc::new(Events::default());
    let cli = ScriptedAccountCli::new();
    let gated_cli = Arc::new(GatedStatusCli {
        inner: cli.clone(),
        ..GatedStatusCli::default()
    });
    let clock = Arc::new(TickClock(AtomicI64::new(T0)));
    let scripted = script.map_or_else(Scripted::new, |s| Scripted::parse(s).unwrap());
    let deps = CoreDeps::new(clock, events.clone())
        .with_llm(Adapters::scripted(&scripted))
        .with_secrets(Arc::new(MemorySecrets::default()))
        .with_account_cli(gated_cli.clone());
    let core = Arc::new(Core::open(dir, deps).expect("core opens"));
    core.start_first_run();
    World {
        core,
        events,
        cli,
        gated_cli,
        scripted,
    }
}

fn from(label: WindowLabel) -> CommandCtx {
    CommandCtx {
        caller: Caller::Window { label },
    }
}

fn settings() -> CommandCtx {
    from(WindowLabel::Settings)
}

fn tool(json: &str) -> ToolScript {
    serde_json::from_str(json).unwrap()
}

/// Claude Code installed and able to sign in as `plan`, after `delay_ms`.
fn claude(w: &World, plan: &str, delay_ms: u64) {
    w.cli.set(tool(&format!(
        r#"{{"tool":"claude_code","installed":true,"path":"/bin/claude","version":"2.1.296",
            "login_identity":{{"email":"ann@example.com","plan":"{plan}"}},
            "login":{{"delay_ms":{delay_ms},"code":"{CODE}"}}}}"#
    )));
}

fn codex(w: &World, plan: &str, delay_ms: u64) {
    w.cli.set(tool(&format!(
        r#"{{"tool":"codex","installed":true,"path":"/bin/codex","version":"0.163.0",
            "login_identity":{{"email":"bob@example.com","plan":"{plan}"}},
            "login":{{"delay_ms":{delay_ms},"url":"https://chatgpt.com/device"}}}}"#
    )));
}

/// A CLI that is installed and signed out, or signed in as `identity`.
fn bare(w: &World, tool_json: &str) {
    w.cli.set(tool(tool_json));
}

const CLAUDE: AccountProvider = AccountProvider::Claude;
const CHATGPT: AccountProvider = AccountProvider::Chatgpt;

fn start(provider: AccountProvider, confirmed: bool) -> SignInStartArgs {
    SignInStartArgs {
        provider,
        personal_use_confirmed: confirmed,
    }
}

fn pair(provider: AccountProvider) -> AccountProviderArgs {
    AccountProviderArgs { provider }
}

fn sign_out(provider: AccountProvider, also_in_cli: bool) -> SignOutArgs {
    SignOutArgs {
        provider,
        also_in_cli,
    }
}

fn status(view: &AccountsView, provider: AccountProvider) -> AccountStatus {
    view.accounts
        .iter()
        .find(|a| a.provider == provider)
        .unwrap()
        .status
        .clone()
}

fn is_signed_in(view: &AccountsView, provider: AccountProvider) -> bool {
    matches!(status(view, provider), AccountStatus::SignedIn { .. })
}

async fn view(w: &World) -> AccountsView {
    w.core.accounts_get(&settings(), NoArgs {}).await.unwrap()
}

async fn wait(ms: u64) {
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

async fn connect(w: &World, provider: AccountProvider, confirmed: bool) {
    w.core
        .account_signin_start(&settings(), start(provider, confirmed))
        .await
        .unwrap();
    wait(1_000).await;
}

/// The saved account metadata, as stored.
fn account_row(w: &World) -> String {
    w.core
        .store()
        .read(|c| {
            c.query_row(
                "SELECT value FROM settings WHERE key = 'accounts'",
                [],
                |r| r.get(0),
            )
        })
        .unwrap()
}

async fn use_roles(w: &World, post_call: RuntimeChoice, others: RuntimeChoice) {
    let current = w.core.settings_get(&settings(), NoArgs {}).await.unwrap();
    let mut roles = current.runtimes.clone();
    roles.live_copilot = others;
    roles.post_call = post_call;
    roles.search_answers = others;
    let section = SettingsSection::Runtimes(roles);
    let args = SettingsUpdateArgs {
        rev: current.rev,
        section,
    };
    w.core.settings_update(&settings(), args).await.unwrap();
}

async fn roles(w: &World) -> RuntimeSettings {
    let s = w.core.settings_get(&settings(), NoArgs {}).await.unwrap();
    s.runtimes
}

#[tokio::test(start_paused = true)]
async fn start_needs_confirmation_for_claude_only_and_a_usable_cli() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    let err = w
        .core
        .account_signin_start(&settings(), start(CLAUDE, true))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::CliMissing);
    claude(&w, "Max", 0);
    let err = w
        .core
        .account_signin_start(&settings(), start(CLAUDE, false))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::PersonalUseNotConfirmed);
    assert!(w.cli.log().is_empty(), "no browser login was started");
    codex(&w, "Plus", 0);
    let session = w
        .core
        .account_signin_start(&settings(), start(CHATGPT, false))
        .await
        .unwrap();
    assert_eq!(session.provider, CHATGPT);
    bare(
        &w,
        r#"{"tool":"claude_code","installed":true,"version":"9.9.9","supported":false}"#,
    );
    let err = w
        .core
        .account_signin_start(&settings(), start(CLAUDE, true))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::CliVersionUnsupported);
}

#[tokio::test(start_paused = true)]
async fn both_providers_sign_in_independently_and_no_code_is_recorded() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    claude(&w, "Max", 200);
    codex(&w, "Business", 50);
    let session = w
        .core
        .account_signin_start(&from(WindowLabel::Main), start(CLAUDE, true))
        .await
        .unwrap();
    assert_eq!(session.code.as_deref(), Some(CODE));
    assert_eq!(session.expires_at, TimestampMs(T0 + 300_000));
    let signing = view(&w).await;
    let session_id = session.id.clone();
    assert_eq!(
        status(&signing, CLAUDE),
        AccountStatus::SigningIn { session_id }
    );
    assert_eq!(status(&signing, CHATGPT), AccountStatus::NotSignedIn);
    // ChatGPT finishes first while Claude still waits for its browser.
    w.core
        .account_signin_start(&settings(), start(CHATGPT, false))
        .await
        .unwrap();
    wait(100).await;
    let mid = view(&w).await;
    assert!(is_signed_in(&mid, CHATGPT));
    assert!(matches!(
        status(&mid, CLAUDE),
        AccountStatus::SigningIn { .. }
    ));
    wait(500).await;
    let AccountStatus::SignedIn { identity, since } = status(&view(&w).await, CLAUDE) else {
        panic!("claude signed in")
    };
    assert_eq!(identity.email, "ann@example.com");
    assert_eq!(since, TimestampMs(T0));
    assert_eq!(
        w.events.progress("claude"),
        [
            "waiting_for_browser",
            "signed_in",
            "checking_plan",
            "sending_test_request",
            "done"
        ]
    );
    // The test requests went through the gate on each account's own runtime.
    let runtimes: Vec<_> = w.scripted.received().iter().map(|r| r.runtime).collect();
    assert!(runtimes.contains(&RuntimeChoice::ClaudeAccount));
    assert!(runtimes.contains(&RuntimeChoice::ChatgptAccount));
    // Identity and plan are metadata; the one-time code is in no row and no event.
    let rows: String = w
        .core
        .store()
        .read(|c| {
            let mut all =
                c.prepare("SELECT COALESCE(before,'') || COALESCE(after,'') FROM changes")?;
            let rows = all.query_map([], |r| r.get::<_, String>(0))?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?.join("\n"))
        })
        .unwrap();
    assert!(rows.contains("ann@example.com"));
    assert!(!rows.contains(CODE) && !account_row(&w).contains(CODE));
    assert!(!w.events.dump().contains(CODE));
}

#[tokio::test(start_paused = true)]
async fn the_session_times_out_at_five_minutes_and_a_late_success_binds_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    claude(&w, "Max", 400_000);
    w.core
        .account_signin_start(&settings(), start(CLAUDE, true))
        .await
        .unwrap();
    wait(299_000).await;
    assert!(matches!(
        status(&view(&w).await, CLAUDE),
        AccountStatus::SigningIn { .. }
    ));
    wait(2_000).await;
    assert_eq!(status(&view(&w).await, CLAUDE), AccountStatus::NotSignedIn);
    assert_eq!(
        w.events.progress("claude"),
        ["waiting_for_browser", "sign_in_timed_out"]
    );
    // The browser would have finished at 400 s: nothing is accepted.
    wait(200_000).await;
    assert_eq!(status(&view(&w).await, CLAUDE), AccountStatus::NotSignedIn);
    assert_eq!(w.events.progress("claude").len(), 2);
    assert!(w.scripted.received().is_empty());
}

#[tokio::test(start_paused = true)]
async fn cancel_ends_only_the_matching_active_session() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    claude(&w, "Max", 60_000);
    codex(&w, "Plus", 60_000);
    let a = w
        .core
        .account_signin_start(&settings(), start(CLAUDE, true))
        .await
        .unwrap();
    w.core
        .account_signin_start(&settings(), start(CHATGPT, false))
        .await
        .unwrap();
    let stale = SignInSessionArgs {
        session_id: SignInSessionId::new("sis_nope"),
    };
    let err = w
        .core
        .account_signin_cancel(&settings(), stale)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::NotFound);
    let after = w
        .core
        .account_signin_cancel(&settings(), SignInSessionArgs { session_id: a.id })
        .await
        .unwrap();
    assert_eq!(status(&after, CLAUDE), AccountStatus::NotSignedIn);
    assert!(matches!(
        status(&after, CHATGPT),
        AccountStatus::SigningIn { .. }
    ));
    wait(1_000).await;
    assert_eq!(
        w.events.progress("claude"),
        ["waiting_for_browser", "sign_in_cancelled"]
    );
    // ChatGPT's own session still completes.
    wait(70_000).await;
    assert!(is_signed_in(&view(&w).await, CHATGPT));
}

#[tokio::test(start_paused = true)]
async fn offline_and_ineligible_plans_leave_everything_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(
        dir.path(),
        Some(r#"{"on": "ask-answer", "fail": "offline"}"#),
    );
    let before = view(&w).await;
    claude(&w, "Max", 0);
    connect(&w, CLAUDE, true).await;
    assert_eq!(w.events.progress("claude").last().unwrap(), "offline");
    codex(&w, "Free", 0);
    connect(&w, CHATGPT, false).await;
    assert_eq!(
        w.events.progress("chatgpt").last().unwrap(),
        "plan_not_eligible"
    );
    claude(&w, "Free", 0);
    connect(&w, CLAUDE, true).await;
    assert_eq!(
        w.events.progress("claude").last().unwrap(),
        "plan_not_eligible"
    );
    let after = view(&w).await;
    assert_eq!(status(&after, CLAUDE), AccountStatus::NotSignedIn);
    assert_eq!(status(&after, CHATGPT), AccountStatus::NotSignedIn);
    assert_eq!(after.keys, before.keys);
}

#[tokio::test(start_paused = true)]
async fn use_existing_runs_the_same_checks_and_claude_needs_a_recorded_confirmation() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    bare(
        &w,
        r#"{"tool":"claude_code","installed":true,"version":"2.1.296",
            "identity":{"email":"ann@example.com","plan":"Pro"}}"#,
    );
    bare(
        &w,
        r#"{"tool":"codex","installed":true,"version":"0.163.0",
            "identity":{"email":"bob@example.com","plan":"Free"}}"#,
    );
    let err = w
        .core
        .account_use_existing(&settings(), pair(CLAUDE))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::PersonalUseNotConfirmed);
    let err = w
        .core
        .account_use_existing(&settings(), pair(CHATGPT))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::PlanNotEligible);
    bare(
        &w,
        r#"{"tool":"codex","installed":true,"version":"0.163.0",
            "identity":{"email":"bob@example.com","plan":"Enterprise"}}"#,
    );
    let ok = w
        .core
        .account_use_existing(&settings(), pair(CHATGPT))
        .await
        .unwrap();
    assert!(is_signed_in(&ok, CHATGPT));
    assert_eq!(status(&ok, CLAUDE), AccountStatus::NotSignedIn);
    // A tool that is signed out cannot be reused.
    bare(
        &w,
        r#"{"tool":"codex","installed":true,"version":"0.163.0"}"#,
    );
    w.core
        .account_sign_out(&settings(), sign_out(CHATGPT, false))
        .await
        .unwrap();
    let err = w
        .core
        .account_use_existing(&settings(), pair(CHATGPT))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::AccountSignedOut);
}

#[tokio::test(start_paused = true)]
async fn a_confirmed_sign_in_lets_a_later_reuse_of_claude_through() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    claude(&w, "Max", 0);
    connect(&w, CLAUDE, true).await;
    // The provider ends the session; the CLI later holds a sign-in again on its own.
    bare(
        &w,
        r#"{"tool":"claude_code","installed":true,"version":"2.1.296"}"#,
    );
    assert!(matches!(
        status(&view(&w).await, CLAUDE),
        AccountStatus::SignedOutByProvider { .. }
    ));
    bare(
        &w,
        r#"{"tool":"claude_code","installed":true,"version":"2.1.296","auth_known":false}"#,
    );
    assert!(matches!(
        status(&view(&w).await, CLAUDE),
        AccountStatus::SignedOutByProvider { .. }
    ));
    bare(
        &w,
        r#"{"tool":"claude_code","installed":true,"version":"2.1.296",
            "identity":{"email":"ann@example.com","plan":"Max"}}"#,
    );
    let back = w
        .core
        .account_use_existing(&settings(), pair(CLAUDE))
        .await
        .unwrap();
    assert!(is_signed_in(&back, CLAUDE));
}

#[tokio::test(start_paused = true)]
async fn bind_needs_a_connected_account_returns_a_change_id_and_undo_restores_it() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    let bind = |agent_ids, default_for_new_agents| AccountBindArgs {
        provider: CHATGPT,
        agent_ids,
        default_for_new_agents,
    };
    let err = w
        .core
        .account_bind_agents(&settings(), bind(vec![], true))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::AccountSignedOut);
    codex(&w, "Plus", 0);
    connect(&w, CHATGPT, false).await;
    let unknown = bind(vec![AgentId::new("agt_nobody")], true);
    let err = w
        .core
        .account_bind_agents(&settings(), unknown)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::NotFound);
    assert!(account_row(&w).contains(r#""default_for_new_agents":false"#));
    let bound = w
        .core
        .account_bind_agents(&settings(), bind(vec![], true))
        .await
        .unwrap();
    assert!(account_row(&w).contains(r#""default_for_new_agents":true"#));
    assert!(is_signed_in(&bound.accounts, CHATGPT));
    let target = UndoTarget::Change {
        change_id: bound.change_id,
    };
    let args = UndoArgs { target };
    let undone = w
        .core
        .change_undo(&from(WindowLabel::Main), args)
        .await
        .unwrap();
    assert_eq!(undone.undone, 1);
    assert!(account_row(&w).contains(r#""default_for_new_agents":false"#));
    // The sign-in itself is not undone, and a settings write still takes the new revision.
    assert!(is_signed_in(&view(&w).await, CHATGPT));
    use_roles(&w, RuntimeChoice::ChatgptAccount, RuntimeChoice::Local).await;
}

#[tokio::test(start_paused = true)]
async fn the_account_test_goes_through_the_gate_and_reports_latency_or_the_error() {
    let dir = tempfile::tempdir().unwrap();
    // One answer for the sign-in's own test, then a slow one, then offline.
    let script = r#"{"on": "ask-answer"}
{"on": "ask-answer", "after_ms": 40}
{"on": "ask-answer", "fail": "offline"}"#;
    let w = open(dir.path(), Some(script));
    let err = w
        .core
        .account_test(&settings(), pair(CHATGPT))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::AccountSignedOut);
    codex(&w, "Pro", 0);
    connect(&w, CHATGPT, false).await;
    let seen = w.scripted.received().len();
    let ok = w
        .core
        .account_test(&settings(), pair(CHATGPT))
        .await
        .unwrap();
    assert!(ok.ok && ok.error.is_none());
    assert!(ok.latency_ms.is_some_and(|ms| ms.0 >= 40));
    assert_eq!(w.scripted.received().len(), seen + 1);
    let runs: i64 = w
        .core
        .store()
        .read(|c| c.query_row("SELECT COUNT(*) FROM llm_runs", [], |r| r.get(0)))
        .unwrap();
    assert_eq!(runs, 2, "the sign-in test and this one are both logged");
    let failed = w
        .core
        .account_test(&settings(), pair(CHATGPT))
        .await
        .unwrap();
    assert!(!failed.ok);
    assert_eq!(failed.error, Some(ErrorCode::Offline));
}

#[tokio::test(start_paused = true)]
async fn sign_out_falls_back_to_the_key_runtime_or_leaves_the_role_unavailable() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    let key = ApiKeySetArgs {
        provider: KeyProvider::Anthropic,
        key: "sk-ant-api03-KEY".into(),
    };
    w.core.api_key_set(&settings(), key).await.unwrap();
    claude(&w, "Max", 0);
    codex(&w, "Plus", 0);
    connect(&w, CLAUDE, true).await;
    connect(&w, CHATGPT, false).await;
    use_roles(
        &w,
        RuntimeChoice::ChatgptAccount,
        RuntimeChoice::ClaudeAccount,
    )
    .await;
    let out = w
        .core
        .account_sign_out(&settings(), sign_out(CLAUDE, false))
        .await
        .unwrap();
    assert_eq!(status(&out, CLAUDE), AccountStatus::NotSignedIn);
    assert!(is_signed_in(&out, CHATGPT));
    let now = roles(&w).await;
    assert_eq!(now.live_copilot, RuntimeChoice::ClaudeApiKey);
    assert_eq!(now.search_answers, RuntimeChoice::ClaudeApiKey);
    assert_eq!(now.post_call, RuntimeChoice::ChatgptAccount);
    // The CLI was not asked to sign out.
    let claude_cli = w.cli.status(CliTool::ClaudeCode).await;
    assert!(claude_cli.identity.is_some(), "also_in_cli was false");
    // ChatGPT has no key: its role stays on the account, which now reads as not signed in.
    let out = w
        .core
        .account_sign_out(&settings(), sign_out(CHATGPT, true))
        .await
        .unwrap();
    assert_eq!(status(&out, CHATGPT), AccountStatus::NotSignedIn);
    assert_eq!(roles(&w).await.post_call, RuntimeChoice::ChatgptAccount);
    assert!(w.cli.status(CliTool::Codex).await.identity.is_none());
    assert!(!account_row(&w).contains("bob@example.com"));
}

#[tokio::test(start_paused = true)]
async fn sign_out_cancels_a_pending_sign_in_and_a_failed_logout_is_reported() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    claude(&w, "Max", 60_000);
    w.core
        .account_signin_start(&settings(), start(CLAUDE, true))
        .await
        .unwrap();
    let out = w
        .core
        .account_sign_out(&settings(), sign_out(CLAUDE, false))
        .await
        .unwrap();
    assert_eq!(status(&out, CLAUDE), AccountStatus::NotSignedIn);
    wait(70_000).await;
    assert_eq!(status(&view(&w).await, CLAUDE), AccountStatus::NotSignedIn);
    // The tool is gone: the CLI logout fails and the error says so, not "signed out".
    bare(&w, r#"{"tool":"claude_code"}"#);
    let err = w
        .core
        .account_sign_out(&settings(), sign_out(CLAUDE, true))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::CliMissing);
}

#[tokio::test(start_paused = true)]
async fn a_provider_ended_session_pauses_the_roles_and_keeps_the_binding() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    codex(&w, "Plus", 0);
    connect(&w, CHATGPT, false).await;
    let bind = AccountBindArgs {
        provider: CHATGPT,
        agent_ids: vec![],
        default_for_new_agents: true,
    };
    w.core.account_bind_agents(&settings(), bind).await.unwrap();
    use_roles(&w, RuntimeChoice::ChatgptAccount, RuntimeChoice::Local).await;
    // The provider ends the session on its side.
    bare(
        &w,
        r#"{"tool":"codex","installed":true,"version":"0.163.0",
            "login_identity":{"email":"bob@example.com","plan":"Plus"},
            "login":{"delay_ms":500}}"#,
    );
    assert_eq!(
        status(&view(&w).await, CHATGPT),
        AccountStatus::SignedOutByProvider {
            at: TimestampMs(T0)
        }
    );
    assert_eq!(roles(&w).await.post_call, RuntimeChoice::ChatgptAccount);
    assert!(account_row(&w).contains(r#""default_for_new_agents":true"#));
    // One step repairs it: a new sign-in goes through signing_in again.
    w.core
        .account_signin_start(&settings(), start(CHATGPT, false))
        .await
        .unwrap();
    assert!(matches!(
        status(&view(&w).await, CHATGPT),
        AccountStatus::SigningIn { .. }
    ));
    wait(1_000).await;
    assert!(is_signed_in(&view(&w).await, CHATGPT));
}

#[tokio::test(start_paused = true)]
async fn an_unknown_probe_preserves_sign_in_and_a_confirmed_identity_recovers_it() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    claude(&w, "Max", 0);
    connect(&w, CLAUDE, true).await;
    bare(
        &w,
        r#"{"tool":"claude_code","installed":true,"version":"2.1.296","auth_known":false}"#,
    );
    assert!(is_signed_in(&view(&w).await, CLAUDE));
    bare(
        &w,
        r#"{"tool":"claude_code","installed":true,"version":"2.1.296","auth_known":true}"#,
    );
    assert!(matches!(
        status(&view(&w).await, CLAUDE),
        AccountStatus::SignedOutByProvider { .. }
    ));
    bare(
        &w,
        r#"{"tool":"claude_code","installed":true,"version":"2.1.296","auth_known":true,
            "identity":{"email":"ann@example.com","plan":"Max"}}"#,
    );
    assert!(is_signed_in(&view(&w).await, CLAUDE));
}

#[tokio::test(start_paused = true)]
async fn a_stale_provider_probe_cannot_end_a_replacement_identity() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    claude(&w, "Max", 0);
    connect(&w, CLAUDE, true).await;

    bare(
        &w,
        r#"{"tool":"claude_code","installed":true,"version":"2.1.296","auth_known":true}"#,
    );
    w.gated_cli.hold_next.store(true, Ordering::SeqCst);
    let core = w.core.clone();
    let old_refresh =
        tokio::spawn(async move { core.accounts_get(&from(WindowLabel::Main), NoArgs {}).await });
    w.gated_cli.started.notified().await;

    bare(
        &w,
        r#"{"tool":"claude_code","installed":true,"version":"2.1.296",
            "identity":{"email":"new@example.com","plan":"Max"},
            "login_identity":{"email":"new@example.com","plan":"Max"}}"#,
    );
    w.core
        .account_signin_start(&settings(), start(CLAUDE, true))
        .await
        .unwrap();
    wait(1_000).await;
    assert_eq!(w.events.progress("claude").last().unwrap(), "done");

    w.gated_cli.release.notify_one();
    let refreshed = old_refresh.await.unwrap().unwrap();
    assert_eq!(
        status(&refreshed, CLAUDE),
        AccountStatus::SignedIn {
            identity: AccountIdentity {
                email: "new@example.com".into(),
                plan: "Max".into(),
            },
            since: TimestampMs(T0),
        }
    );
}
