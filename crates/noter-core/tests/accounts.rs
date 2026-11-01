//! FEATURE cpt-noter-feature-core-llm-gate, the credentials steps it delivers (flow
//! `cpt-noter-flow-core-credentials-privacy-keys` 1-5, algo `-availability`, algo
//! `-secret-boundary` for API keys, state `-key` without removal): `accounts_get` and
//! `api_key_set` on the scripted runtime with the in-memory Keychain stand-in (TL-13).

use std::path::Path;
use std::sync::{Arc, Mutex};

use noter_core::{
    Adapters, Clock, Core, CoreDeps, EventEmitter, MemorySecrets, Scripted, Secret, SecretStore,
};
use noter_llm::{
    LlmRuntime, Packet, PacketItem, Privacy, RunRequest, Skill, SourceClass, TaskKind,
};
use noter_protocol::error::RuntimeUnavailableReason;
use noter_protocol::ipc::{dispatch_json, event_names, Caller, CommandCtx, CoreApi};
use noter_protocol::model::settings::AuditWhat;
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

const NOW: TimestampMs = TimestampMs(1_790_000_000_000);
const KEY: &str = "sk-ant-api03-THE-SECRET-KEY-VALUE";
const OTHER_KEY: &str = "sk-ant-api03-A-REPLACEMENT-KEY";

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

impl Events {
    fn take(&self) -> Vec<(&'static str, Value)> {
        std::mem::take(&mut self.0.lock().unwrap())
    }

    /// The key statuses each `accounts:changed` carried, for `provider`.
    fn statuses(&self, provider: &str) -> Vec<String> {
        self.take()
            .into_iter()
            .filter(|(e, _)| *e == event_names::ACCOUNTS_CHANGED)
            .map(|(_, p)| {
                let keys = p["keys"].as_array().cloned().unwrap_or_default();
                let key = keys.iter().find(|k| k["provider"] == provider).unwrap();
                key["status"]["type"].as_str().unwrap().to_owned()
            })
            .collect()
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        NOW
    }
}

struct World {
    core: Core,
    events: Arc<Events>,
    secrets: Arc<MemorySecrets>,
    scripted: Scripted,
}

fn open(dir: &Path, script: Option<&str>) -> World {
    let events = Arc::new(Events::default());
    let secrets = Arc::new(MemorySecrets::default());
    let scripted = script.map_or_else(Scripted::new, |s| Scripted::parse(s).unwrap());
    let deps = CoreDeps::new(Arc::new(FixedClock), events.clone())
        .with_llm(Adapters::scripted(&scripted))
        .with_secrets(secrets.clone());
    let core = Core::open(dir, deps).expect("core opens");
    World {
        core,
        events,
        secrets,
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

fn set(provider: KeyProvider, key: &str) -> ApiKeySetArgs {
    ApiKeySetArgs {
        provider,
        key: key.into(),
    }
}

fn status(view: &AccountsView, provider: KeyProvider) -> KeyStatus {
    let key = view.keys.iter().find(|k| k.provider == provider).unwrap();
    key.status.clone()
}

/// Every byte under the data folder: the database, its WAL and the logs.
fn on_disk(dir: &Path) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut todo = vec![dir.to_path_buf()];
    while let Some(path) = todo.pop() {
        if path.is_dir() {
            todo.extend(std::fs::read_dir(&path).unwrap().map(|e| e.unwrap().path()));
        } else if let Ok(content) = std::fs::read(&path) {
            bytes.extend(content);
        }
    }
    bytes
}

fn contains(haystack: &[u8], needle: &str) -> bool {
    haystack
        .windows(needle.len())
        .any(|w| w == needle.as_bytes())
}

#[tokio::test]
async fn a_fresh_core_reports_no_keys_and_the_runtimes_it_found() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    let view = w.core.accounts_get(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(status(&view, KeyProvider::Anthropic), KeyStatus::NotSet);
    assert_eq!(status(&view, KeyProvider::Codex), KeyStatus::NotSet);
    let tools: Vec<CliTool> = view.accounts.iter().map(|a| a.cli.tool).collect();
    assert_eq!(tools, [CliTool::ClaudeCode, CliTool::Codex]);
    for account in &view.accounts {
        assert!(
            account.cli.installed && account.cli.supported,
            "{account:?}"
        );
        assert_eq!(account.cli.version.as_deref(), Some("1.0.0"));
        assert_eq!(account.status, AccountStatus::NotSignedIn);
    }
    assert_eq!(view.local.cli.tool, CliTool::Ollama);
    assert!(view.local.running);
    assert_eq!(view.local.models, ["scripted"]);
    assert_eq!(view.local.default_model.as_deref(), Some("scripted"));
    // Unchanged observations keep their version; the snapshot slice is the same view.
    let again = w.core.accounts_get(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(again, view);
    let snapshot = w.core.app_snapshot(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(snapshot.accounts, view);
}

#[tokio::test]
async fn a_verified_key_goes_to_the_keychain_and_only_its_status_comes_back() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    let before = w.core.accounts_get(&settings(), NoArgs {}).await.unwrap();
    w.events.take();
    let view = w
        .core
        .api_key_set(
            &from(WindowLabel::FirstRun),
            set(KeyProvider::Anthropic, KEY),
        )
        .await
        .unwrap();
    assert_eq!(
        status(&view, KeyProvider::Anthropic),
        KeyStatus::Configured { verified_at: NOW }
    );
    assert_eq!(status(&view, KeyProvider::Codex), KeyStatus::NotSet);
    assert!(view.version > before.version);
    assert_eq!(
        w.secrets
            .get("anthropic")
            .unwrap()
            .map(|s| s.expose().to_owned()),
        Some(KEY.to_owned())
    );
    let events = w.events.take();
    let wire = serde_json::to_string(&events).unwrap();
    assert!(!wire.contains(KEY));
    let accounts: Vec<&Value> = events
        .iter()
        .filter(|(e, _)| *e == event_names::ACCOUNTS_CHANGED)
        .map(|(_, p)| p)
        .collect();
    let statuses: Vec<&Value> = accounts
        .iter()
        .map(|p| &p["keys"][0]["status"]["type"])
        .collect();
    assert_eq!(statuses, [&json!("verifying"), &json!("configured")]);
    assert_eq!(accounts[1]["version"], json!(view.version));
    // One verification call, on the key's own runtime, and the runtime is now available.
    let received = w.scripted.received();
    assert_eq!(received.len(), 1);
    assert_eq!(received[0].runtime, RuntimeChoice::ClaudeApiKey);
    let claude = w.core.llm().availability();
    let claude = claude
        .iter()
        .find(|a| a.runtime == RuntimeChoice::ClaudeApiKey);
    assert_eq!(claude.unwrap().unavailable, None);
    // The status went through the change-log writer; the key is nowhere on disk.
    let logged: i64 = w
        .core
        .store()
        .read(|c| {
            c.query_row(
                "SELECT COUNT(*) FROM changes WHERE field = 'keys'",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(logged, 1);
    w.core.shutdown().await;
    assert!(!contains(&on_disk(dir.path()), KEY));
}

#[tokio::test]
async fn only_settings_and_first_run_set_a_key_and_never_an_empty_one() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    let args = json!({"provider": "anthropic", "key": KEY});
    let err = dispatch_json(&w.core, &from(WindowLabel::Main), "api_key_set", args, None)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::WindowNotAllowed);
    let err = w
        .core
        .api_key_set(&settings(), set(KeyProvider::Codex, "  "))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
    assert!(w.scripted.received().is_empty());
    let view = w
        .core
        .accounts_get(&from(WindowLabel::Main), NoArgs {})
        .await
        .unwrap();
    assert_eq!(status(&view, KeyProvider::Codex), KeyStatus::NotSet);
}

#[tokio::test]
async fn a_rejected_first_key_is_rejected_and_stored_nowhere() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(
        dir.path(),
        Some(r#"{"on": "ask-answer", "fail": "key_rejected"}"#),
    );
    let err = w
        .core
        .api_key_set(&settings(), set(KeyProvider::Codex, KEY))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::KeyRejected);
    assert!(!err.message.contains(KEY));
    assert_eq!(w.secrets.get("codex").unwrap(), None);
    assert_eq!(w.events.statuses("codex"), ["verifying", "rejected"]);
    let view = w.core.accounts_get(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(
        status(&view, KeyProvider::Codex),
        KeyStatus::Rejected {
            reason: RuntimeUnavailableReason::KeyRejected
        }
    );
    assert_eq!(w.scripted.received()[0].runtime, RuntimeChoice::CodexApiKey);
}

#[tokio::test]
async fn a_failed_replacement_keeps_the_working_key() {
    let dir = tempfile::tempdir().unwrap();
    let script = [
        r#"{"on": "ask-answer"}"#,
        r#"{"on": "ask-answer", "fail": "key_rejected"}"#,
        r#"{"on": "ask-answer", "fail": "offline"}"#,
    ];
    let w = open(dir.path(), Some(&script.join("\n")));
    w.core
        .api_key_set(&settings(), set(KeyProvider::Anthropic, KEY))
        .await
        .unwrap();
    w.events.take();
    for code in [ErrorCode::KeyRejected, ErrorCode::Offline] {
        let err = w
            .core
            .api_key_set(&settings(), set(KeyProvider::Anthropic, OTHER_KEY))
            .await
            .unwrap_err();
        assert_eq!(err.code, code);
    }
    assert_eq!(
        w.secrets
            .get("anthropic")
            .unwrap()
            .map(|s| s.expose().to_owned()),
        Some(KEY.to_owned())
    );
    let view = w.core.accounts_get(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(
        status(&view, KeyProvider::Anthropic),
        KeyStatus::Configured { verified_at: NOW }
    );
    assert_eq!(
        w.events.statuses("anthropic"),
        ["verifying", "configured", "verifying", "configured"]
    );
}

#[tokio::test]
async fn a_locked_keychain_is_reported_until_it_opens_again() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(dir.path(), None);
    w.core
        .api_key_set(&settings(), set(KeyProvider::Anthropic, KEY))
        .await
        .unwrap();
    w.secrets.set_locked(true);
    let err = w
        .core
        .api_key_set(&settings(), set(KeyProvider::Codex, KEY))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::KeychainLocked);
    assert!(err.retryable);
    let view = w.core.accounts_get(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(
        status(&view, KeyProvider::Anthropic),
        KeyStatus::KeychainLocked
    );
    assert_eq!(status(&view, KeyProvider::Codex), KeyStatus::KeychainLocked);
    w.secrets.set_locked(false);
    let view = w.core.accounts_get(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(
        status(&view, KeyProvider::Anthropic),
        KeyStatus::Configured { verified_at: NOW }
    );
    assert_eq!(status(&view, KeyProvider::Codex), KeyStatus::NotSet);
}

#[tokio::test]
async fn a_stored_key_the_provider_rejects_becomes_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let w = open(
        dir.path(),
        Some(r#"{"on": "post-call", "fail": "key_rejected"}"#),
    );
    w.core
        .api_key_set(&settings(), set(KeyProvider::Anthropic, KEY))
        .await
        .unwrap();
    w.events.take();
    let packet = Packet {
        what: AuditWhat::FullTranscript,
        items: vec![PacketItem {
            id: "seg_1".into(),
            source: SourceClass::Normal,
            text: "Ann agreed.".into(),
        }],
        people: vec![],
    };
    let privacy = tokio::sync::watch::channel(Privacy {
        mode: PrivacyMode::CloudAllowed,
        sensitive: false,
        offline: false,
    })
    .1;
    let mut req = RunRequest::new(Skill::PostCall, "1", packet, TaskKind::PostCall, privacy);
    req.settings.configured = Some(RuntimeChoice::ClaudeApiKey);
    w.core.llm().run_once(req).await.unwrap_err();
    assert_eq!(w.events.statuses("anthropic"), ["rejected"]);
    let view = w.core.accounts_get(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(
        status(&view, KeyProvider::Anthropic),
        KeyStatus::Rejected {
            reason: RuntimeUnavailableReason::KeyRejected
        }
    );
}

#[test]
fn a_secret_given_to_the_core_never_prints() {
    assert!(!format!("{:?}", Secret::new(KEY.into())).contains(KEY));
}
