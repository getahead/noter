//! FEATURE cpt-noter-feature-core-credentials-privacy, slice 1: `api_key_remove`, the Privacy
//! pane's `audit_list` and `audit_export`, the `storage_move` guard, `account_signin_prepare`
//! and `cli_install` on the scripted account CLI and the in-memory Keychain stand-in.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{
    Adapters, BoxFuture, Clock, Core, CoreDeps, EventEmitter, MemorySecrets, NativeOps, SaveKind,
    Scripted, ScriptedAccountCli, SecretStore, ToolScript,
};
use noter_llm::Skill;
use noter_protocol::ipc::{dispatch_json, event_names, Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

const KEY: &str = "sk-ant-api03-THE-SECRET-KEY-VALUE";
const SECRET_TEXT: &str = "Ann agreed to ship the importer behind the blue door.";

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
    fn named(&self, name: &str) -> Vec<Value> {
        let all = self.0.lock().unwrap();
        all.iter()
            .filter(|(e, _)| *e == name)
            .map(|(_, p)| p.clone())
            .collect()
    }

    fn key_statuses(&self, provider: &str) -> Vec<String> {
        self.named(event_names::ACCOUNTS_CHANGED)
            .iter()
            .map(|p| {
                let keys = p["keys"].as_array().unwrap();
                let key = keys.iter().find(|k| k["provider"] == provider).unwrap();
                key["status"]["type"].as_str().unwrap().to_owned()
            })
            .collect()
    }

    fn runs(&self) -> Vec<JobRunRow> {
        self.named("jobs:progress")
            .into_iter()
            .map(|p| serde_json::from_value::<JobProgress>(p).unwrap().run)
            .collect()
    }
}

/// The save panel: answers `path` once, then cancels.
struct Panel(Mutex<Option<PathBuf>>);

impl NativeOps for Panel {
    fn save_panel<'a>(&'a self, _: &'a str, _: SaveKind) -> BoxFuture<'a, Option<PathBuf>> {
        Box::pin(async { self.0.lock().unwrap().take() })
    }
}

struct World {
    core: Arc<Core>,
    events: Arc<Events>,
    secrets: Arc<MemorySecrets>,
    cli: ScriptedAccountCli,
    clock: Arc<TickClock>,
    panel: Arc<Panel>,
}

fn open(dir: &Path, script: Option<&str>) -> World {
    let events = Arc::new(Events::default());
    let secrets = Arc::new(MemorySecrets::default());
    let cli = ScriptedAccountCli::new();
    let clock = Arc::new(TickClock(AtomicI64::new(1_790_000_000_000)));
    let panel = Arc::new(Panel(Mutex::new(None)));
    let scripted = script.map_or_else(Scripted::new, |s| Scripted::parse(s).unwrap());
    let deps = CoreDeps::new(clock.clone(), events.clone())
        .with_llm(Adapters::scripted(&scripted))
        .with_secrets(secrets.clone())
        .with_account_cli(Arc::new(cli.clone()))
        .with_native_ops(panel.clone());
    let core = Arc::new(Core::open(dir, deps).expect("core opens"));
    core.start_first_run();
    World {
        core,
        events,
        secrets,
        cli,
        clock,
        panel,
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

fn key(view: &AccountsView, provider: KeyProvider) -> KeyStatus {
    view.keys
        .iter()
        .find(|k| k.provider == provider)
        .unwrap()
        .status
        .clone()
}

fn remove(provider: KeyProvider) -> KeyProviderArgs {
    KeyProviderArgs { provider }
}

async fn set_key(w: &World, provider: KeyProvider) {
    w.core
        .api_key_set(
            &settings(),
            ApiKeySetArgs {
                provider,
                key: KEY.into(),
            },
        )
        .await
        .unwrap();
}

// ── api_key_remove ────────────────────────────────────────────

#[tokio::test]
async fn removing_a_key_empties_the_keychain_and_the_runtime_loses_it() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    set_key(&w, KeyProvider::Anthropic).await;
    let before = w.core.accounts_get(&settings(), NoArgs {}).await.unwrap();
    let view = w
        .core
        .api_key_remove(&settings(), remove(KeyProvider::Anthropic))
        .await
        .unwrap();
    assert_eq!(key(&view, KeyProvider::Anthropic), KeyStatus::NotSet);
    assert!(view.version > before.version);
    assert!(w.secrets.get("anthropic").unwrap().is_none());
    let statuses = w.events.key_statuses("anthropic");
    assert_eq!(statuses.last().map(String::as_str), Some("not_set"));
    // The next read agrees; the removal went through the change-log writer, not undoable.
    let again = w.core.accounts_get(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(key(&again, KeyProvider::Anthropic), KeyStatus::NotSet);
    let logged: i64 = w
        .core
        .store()
        .read(|c| {
            c.query_row(
                "SELECT COUNT(*) FROM changes WHERE field = 'keys' AND undoable = 0",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(logged, 2);
}

#[tokio::test]
async fn a_rejected_key_state_is_cleared_by_removal_and_other_windows_cannot_remove() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(
        dir.path(),
        Some(r#"{"on": "ask-answer", "fail": "key_rejected"}"#),
    );
    let err = w
        .core
        .api_key_set(
            &settings(),
            ApiKeySetArgs {
                provider: KeyProvider::Codex,
                key: KEY.into(),
            },
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::KeyRejected);
    let view = w.core.accounts_get(&settings(), NoArgs {}).await.unwrap();
    assert!(matches!(
        key(&view, KeyProvider::Codex),
        KeyStatus::Rejected { .. }
    ));
    for label in [WindowLabel::Main, WindowLabel::FirstRun] {
        let args = json!({"provider": "codex"});
        let err = dispatch_json(&*w.core, &from(label), "api_key_remove", args, None)
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::WindowNotAllowed);
    }
    let view = w
        .core
        .api_key_remove(&settings(), remove(KeyProvider::Codex))
        .await
        .unwrap();
    assert_eq!(key(&view, KeyProvider::Codex), KeyStatus::NotSet);
}

#[tokio::test]
async fn a_locked_keychain_refuses_removal_and_keeps_the_state() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    set_key(&w, KeyProvider::Anthropic).await;
    w.secrets.set_locked(true);
    let err = w
        .core
        .api_key_remove(&settings(), remove(KeyProvider::Anthropic))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::KeychainLocked);
    let view = w.core.accounts_get(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(
        key(&view, KeyProvider::Anthropic),
        KeyStatus::KeychainLocked
    );
    w.secrets.set_locked(false);
    assert!(w.secrets.get("anthropic").unwrap().is_some());
    let view = w
        .core
        .api_key_remove(&settings(), remove(KeyProvider::Anthropic))
        .await
        .unwrap();
    assert_eq!(key(&view, KeyProvider::Anthropic), KeyStatus::NotSet);
}

// ── audit_list and audit_export ───────────────────────────────

async fn run_at(w: &World, ts: i64) {
    w.clock.0.store(ts, Ordering::SeqCst);
    let items = vec![("seg_1".to_owned(), SECRET_TEXT.to_owned())];
    noter_core::testing::llm_run(&w.core, Skill::PostCall.id(), items)
        .await
        .unwrap();
}

fn list(from: Option<i64>, to: Option<i64>, cursor: Option<&str>, limit: u32) -> AuditListArgs {
    AuditListArgs {
        from: from.map(TimestampMs),
        to: to.map(TimestampMs),
        page: PageRequest {
            cursor: cursor.map(|c| Cursor(c.to_owned())),
            limit: Some(limit),
        },
    }
}

#[tokio::test]
async fn the_audit_pages_in_time_order_inside_the_date_range() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    for ts in [1_000, 2_000, 3_000, 4_000, 5_000] {
        run_at(&w, ts).await;
    }
    let page = w
        .core
        .audit_list(&settings(), list(None, None, None, 2))
        .await
        .unwrap();
    let at: Vec<i64> = page.rows.iter().map(|r| r.at.0).collect();
    assert_eq!(at, [1_000, 2_000]);
    let first = &page.rows[0];
    assert_eq!(first.kind, AuditKind::Run);
    assert!(first.llm_run_id.is_some());
    assert_eq!(first.runtime, Some(RuntimeChoice::ClaudeAccount));
    assert_eq!(
        first.what,
        noter_protocol::model::settings::AuditWhat::FullTranscript
    );
    assert!(first.bytes_out > 0);
    let cursor = page.next_cursor.expect("more rows follow");
    let rest = w
        .core
        .audit_list(&settings(), list(None, None, Some(&cursor.0), 10))
        .await
        .unwrap();
    let at: Vec<i64> = rest.rows.iter().map(|r| r.at.0).collect();
    assert_eq!(at, [3_000, 4_000, 5_000]);
    assert!(rest.next_cursor.is_none());
    // The range is inclusive on both ends; an empty range is an empty page, not an error.
    let range = w
        .core
        .audit_list(&settings(), list(Some(2_000), Some(4_000), None, 10))
        .await
        .unwrap();
    assert_eq!(range.rows.len(), 3);
    let none = w
        .core
        .audit_list(&settings(), list(Some(9_000), None, None, 10))
        .await
        .unwrap();
    assert!(none.rows.is_empty() && none.next_cursor.is_none());
}

#[tokio::test]
async fn bad_dates_and_cursors_are_invalid_input_and_only_settings_reads() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    let err = w
        .core
        .audit_list(&settings(), list(Some(5), Some(1), None, 10))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
    let err = w
        .core
        .audit_list(&settings(), list(None, None, Some("not a cursor"), 10))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
    let args = json!({"page": {}});
    let err = dispatch_json(&*w.core, &from(WindowLabel::Main), "audit_list", args, None)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::WindowNotAllowed);
}

fn export(format: LogFormat) -> AuditExportArgs {
    AuditExportArgs {
        from: None,
        to: None,
        format,
    }
}

#[tokio::test]
async fn an_export_holds_metadata_only_and_leaves_the_rows_alone() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    for ts in [1_000, 2_000, 3_000] {
        run_at(&w, ts).await;
    }
    let rows = |w: &World| -> Vec<(String, String)> {
        w.core
            .store()
            .read(|c| {
                let mut s = c.prepare("SELECT id, payload_hash FROM audit_log ORDER BY id")?;
                let r = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
                r.collect()
            })
            .unwrap()
    };
    let before = rows(&w);
    let hashes: Vec<String> = before.iter().map(|(_, h)| h.clone()).collect();
    let out = dir.path().join("audit.json");
    *w.panel.0.lock().unwrap() = Some(out.clone());
    let result = w
        .core
        .audit_export(&settings(), export(LogFormat::Json))
        .await
        .unwrap();
    assert_eq!(result.path, out.display().to_string());
    assert_eq!(result.files, 1);
    let text = std::fs::read_to_string(&out).unwrap();
    let entries: Vec<AuditEntry> = serde_json::from_str(&text).unwrap();
    assert_eq!(entries.len(), 3);
    assert!(!text.contains(SECRET_TEXT) && !text.contains("importer"));
    assert!(!text.contains(KEY));
    assert!(hashes.iter().all(|h| !text.contains(h.as_str())));
    assert!(!text.contains("redaction_map"));
    assert_eq!(rows(&w), before);
    // Markdown carries the same rows, one line each under a heading.
    let md = dir.path().join("audit.md");
    *w.panel.0.lock().unwrap() = Some(md.clone());
    w.core
        .audit_export(&settings(), export(LogFormat::Markdown))
        .await
        .unwrap();
    let text = std::fs::read_to_string(&md).unwrap();
    assert!(text.starts_with("# "));
    assert_eq!(text.matches("claude_account").count(), 3);
    assert!(!text.contains(SECRET_TEXT));
}

#[tokio::test]
async fn a_cancelled_save_panel_writes_nothing_and_a_bad_range_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    run_at(&w, 1_000).await;
    let err = w
        .core
        .audit_export(&settings(), export(LogFormat::Json))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Cancelled);
    let err = w
        .core
        .audit_export(
            &settings(),
            AuditExportArgs {
                from: Some(TimestampMs(9)),
                to: Some(TimestampMs(1)),
                format: LogFormat::Json,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
}

// ── storage_move ──────────────────────────────────────────────

#[tokio::test]
async fn storage_move_does_not_ship() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    let err = w
        .core
        .storage_move(
            &settings(),
            StorageMoveArgs {
                path: Some("/Volumes/Big/noter".into()),
            },
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::NotImplemented);
}

// ── account_signin_prepare ────────────────────────────────────

fn provider(p: AccountProvider) -> AccountProviderArgs {
    AccountProviderArgs { provider: p }
}

#[tokio::test]
async fn prepare_reports_the_cli_and_an_existing_identity() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    w.cli.set(tool(
        r#"{"tool":"claude_code","installed":true,"path":"/bin/claude","version":"2.1.296",
            "identity":{"email":"ann@example.com","plan":"Max"}}"#,
    ));
    w.cli.set(tool(
        r#"{"tool":"codex","installed":true,"path":"/bin/codex","version":"0.163.0"}"#,
    ));
    let claude = w
        .core
        .account_signin_prepare(
            &from(WindowLabel::FirstRun),
            provider(AccountProvider::Claude),
        )
        .await
        .unwrap();
    assert_eq!(claude.cli.tool, CliTool::ClaudeCode);
    assert!(claude.cli.installed && claude.cli.supported);
    assert_eq!(claude.cli.path.as_deref(), Some("/bin/claude"));
    assert_eq!(claude.existing.unwrap().email, "ann@example.com");
    assert!(claude.needs_personal_use_confirmation);
    let chatgpt = w
        .core
        .account_signin_prepare(&from(WindowLabel::Main), provider(AccountProvider::Chatgpt))
        .await
        .unwrap();
    assert_eq!(chatgpt.existing, None);
    assert!(!chatgpt.needs_personal_use_confirmation);
    let args = json!({"provider": "claude"});
    let err = dispatch_json(
        &*w.core,
        &from(WindowLabel::CallScreen),
        "account_signin_prepare",
        args,
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::WindowNotAllowed);
}

#[tokio::test]
async fn prepare_names_a_missing_or_unsupported_cli() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    let err = w
        .core
        .account_signin_prepare(&settings(), provider(AccountProvider::Claude))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::CliMissing);
    w.cli.set(tool(
        r#"{"tool":"codex","installed":true,"version":"9.9.9","supported":false}"#,
    ));
    let err = w
        .core
        .account_signin_prepare(&settings(), provider(AccountProvider::Chatgpt))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::CliVersionUnsupported);
}

// ── cli_install ───────────────────────────────────────────────

async fn settle() {
    tokio::time::sleep(Duration::from_millis(500)).await;
}

#[tokio::test(start_paused = true)]
async fn an_install_job_reports_progress_and_changes_nothing_else() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    w.cli.set(tool(
        r#"{"tool":"claude_code","install":{"delay_ms":100,"version":"2.1.296"}}"#,
    ));
    let accepted = w
        .core
        .cli_install(
            &from(WindowLabel::FirstRun),
            CliInstallArgs {
                tool: CliTool::ClaudeCode,
            },
        )
        .await
        .unwrap();
    settle().await;
    let runs: Vec<_> = w
        .events
        .runs()
        .into_iter()
        .filter(|r| r.id == accepted.job_run_id)
        .collect();
    assert_eq!(runs[0].kind, JobKind::CliInstall);
    assert_eq!(runs.last().unwrap().status, JobRunStatus::Succeeded);
    assert!(runs
        .iter()
        .any(|r| r.progress.is_some_and(|p| p > 0.0 && p < 1.0)));
    assert_eq!(w.cli.log(), ["install:ClaudeCode"]);
    // The install is seen through prepare; nobody was signed in or switched by it.
    let prepared = w
        .core
        .account_signin_prepare(&settings(), provider(AccountProvider::Claude))
        .await
        .unwrap();
    assert_eq!(prepared.cli.version.as_deref(), Some("2.1.296"));
    assert_eq!(prepared.existing, None);
    let view = w.core.accounts_get(&settings(), NoArgs {}).await.unwrap();
    assert!(view
        .accounts
        .iter()
        .all(|a| a.status == AccountStatus::NotSignedIn));
}

#[tokio::test(start_paused = true)]
async fn a_failed_install_fails_the_run_keeps_the_old_install_and_a_retry_works() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    w.cli.set(tool(
        r#"{"tool":"codex","installed":true,"version":"0.163.0","install":{"fail":"offline"}}"#,
    ));
    let failed = w
        .core
        .cli_install(
            &settings(),
            CliInstallArgs {
                tool: CliTool::Codex,
            },
        )
        .await
        .unwrap();
    settle().await;
    let last = w
        .events
        .runs()
        .into_iter()
        .rfind(|r| r.id == failed.job_run_id)
        .unwrap();
    assert_eq!(last.status, JobRunStatus::Failed);
    assert_eq!(last.error, Some(ErrorCode::Offline));
    let prepared = w
        .core
        .account_signin_prepare(&settings(), provider(AccountProvider::Chatgpt))
        .await
        .unwrap();
    assert_eq!(prepared.cli.version.as_deref(), Some("0.163.0"));
    w.cli.set(tool(
        r#"{"tool":"codex","installed":true,"version":"0.163.0","install":{"version":"0.163.2"}}"#,
    ));
    let retry = w
        .core
        .cli_install(
            &settings(),
            CliInstallArgs {
                tool: CliTool::Codex,
            },
        )
        .await
        .unwrap();
    assert_ne!(retry.job_run_id, failed.job_run_id);
    settle().await;
    let last = w
        .events
        .runs()
        .into_iter()
        .rfind(|r| r.id == retry.job_run_id)
        .unwrap();
    assert_eq!(last.status, JobRunStatus::Succeeded);
    let prepared = w
        .core
        .account_signin_prepare(&settings(), provider(AccountProvider::Chatgpt))
        .await
        .unwrap();
    assert_eq!(prepared.cli.version.as_deref(), Some("0.163.2"));
}

#[tokio::test(start_paused = true)]
async fn an_install_of_a_tool_the_contract_does_not_name_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    let err = dispatch_json(
        &*w.core,
        &settings(),
        "cli_install",
        json!({"tool": "curl"}),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
    assert!(w.cli.log().is_empty());
}
