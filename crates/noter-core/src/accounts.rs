//! `accounts_get` and `api_key_set` (2.15 llm-gate delivers these credentials steps; own
//! accounts, key removal and the Privacy pane are M3). A key goes to the [`SecretStore`] only
//! once its runtime accepted it; `settings` keeps its status and verification time, never the
//! key. The view is shared by the command results, the snapshot slice and `accounts:changed`.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use noter_db::{ChangeMeta, Store};
use noter_llm::{key_account, Availability, Failure, KeychainLocked, Secret, SecretStore};
use noter_protocol::error::{RuntimeUnavailableReason, ValidationRule};
use noter_protocol::ipc::event_names;
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::Value;

use crate::app::{self, WholeState};
use crate::{lock, Clock, EventEmitter};

/// The `settings` row that holds each key's status (never the key).
const KEYS_ROW: &str = "keys";

const PROVIDERS: [KeyProvider; 2] = [KeyProvider::Anthropic, KeyProvider::Codex];

pub(crate) fn runtime_of(provider: KeyProvider) -> RuntimeChoice {
    match provider {
        KeyProvider::Anthropic => RuntimeChoice::ClaudeApiKey,
        KeyProvider::Codex => RuntimeChoice::CodexApiKey,
    }
}

fn account_of(provider: KeyProvider) -> &'static str {
    key_account(runtime_of(provider)).expect("an API-key runtime has a key account")
}

fn provider_of(runtime: RuntimeChoice) -> Option<KeyProvider> {
    PROVIDERS.into_iter().find(|p| runtime_of(*p) == runtime)
}

/// Configured with its verification time, or rejected.
type Saved = HashMap<KeyProvider, KeyStatus>;

struct State {
    saved: Saved,
    verifying: HashSet<KeyProvider>,
    /// The runtimes as last observed.
    availability: Vec<Availability>,
    view: AccountsView,
}

pub(crate) struct Accounts {
    store: Arc<Store>,
    secrets: Arc<dyn SecretStore>,
    events: Arc<dyn EventEmitter>,
    clock: Arc<dyn Clock>,
    state: Mutex<State>,
}

impl WholeState for AccountsView {
    fn version(&mut self) -> &mut StateVersion {
        &mut self.version
    }
}

impl Accounts {
    /// The saved statuses and the Keychain as they are at launch; runtimes are observed on the
    /// first `accounts_get`.
    pub(crate) fn load(
        store: Arc<Store>,
        secrets: Arc<dyn SecretStore>,
        events: Arc<dyn EventEmitter>,
        clock: Arc<dyn Clock>,
        view: AccountsView,
    ) -> Result<Self, CoreError> {
        let row: Option<String> = store.read(|c| {
            use noter_db::rusqlite::OptionalExtension;
            c.query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [KEYS_ROW],
                |r| r.get(0),
            )
            .optional()
        })?;
        let saved = row
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default();
        let accounts = Self {
            store,
            secrets,
            events,
            clock,
            state: Mutex::new(State {
                saved,
                verifying: HashSet::new(),
                availability: Vec::new(),
                view,
            }),
        };
        let mut state = lock(&accounts.state);
        let keys = accounts.keys(&state);
        state.view.keys = keys;
        drop(state);
        Ok(accounts)
    }

    pub(crate) fn view(&self) -> AccountsView {
        lock(&self.state).view.clone()
    }

    // @cpt-algo:cpt-noter-algo-core-credentials-privacy-availability:p1
    /// Recomputes the view from `availability` (or the last observed one); a changed view gets
    /// the next version and `accounts:changed`, an unchanged one keeps its version.
    pub(crate) fn observe(&self, availability: Option<Vec<Availability>>) -> AccountsView {
        let mut state = lock(&self.state);
        if let Some(availability) = availability {
            state.availability = availability;
        }
        // @cpt-begin:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-keys
        let keys = self.keys(&state);
        // @cpt-end:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-keys
        // @cpt-begin:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-clis
        let find = |runtime| state.availability.iter().find(|a| a.runtime == runtime);
        let accounts = [
            (
                AccountProvider::Claude,
                CliTool::ClaudeCode,
                RuntimeChoice::ClaudeAccount,
            ),
            (
                AccountProvider::Chatgpt,
                CliTool::Codex,
                RuntimeChoice::ChatgptAccount,
            ),
        ]
        .into_iter()
        .map(|(provider, tool, runtime)| AccountView {
            provider,
            // Sign-in arrives with the credentials feature (M3).
            status: AccountStatus::NotSignedIn,
            cli: cli_info(tool, find(runtime)),
            agents: Vec::new(),
        })
        .collect();
        let local = find(RuntimeChoice::Local);
        let running = local.is_some_and(|a| a.path.is_some());
        let models = local.map(|a| a.models.clone()).unwrap_or_default();
        let local = LocalRuntimeView {
            cli: cli_info(CliTool::Ollama, local),
            running,
            default_model: models.first().cloned(),
            models,
        };
        // @cpt-end:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-clis
        // @cpt-begin:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-version
        let next = AccountsView {
            version: state.view.version,
            keys,
            accounts,
            local,
        };
        if next != state.view {
            state.view = next;
            app::publish(
                &*self.events,
                event_names::ACCOUNTS_CHANGED,
                &mut state.view,
            );
        }
        // @cpt-end:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-version
        // @cpt-begin:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-return
        state.view.clone()
        // @cpt-end:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-return
    }

    /// Each key's status from the Keychain and the saved status, never its value.
    // @cpt-state:cpt-noter-state-core-credentials-privacy-key:p1
    fn keys(&self, state: &State) -> Vec<KeyView> {
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-keys:p1:inst-key-return
        // @cpt-begin:cpt-noter-algo-core-credentials-privacy-secret-boundary:p1:inst-secret-return
        PROVIDERS
            .into_iter()
            .map(|provider| {
                let saved = state.saved.get(&provider).cloned();
                let status = if state.verifying.contains(&provider) {
                    KeyStatus::Verifying
                } else {
                    match (self.secrets.get(account_of(provider)), saved) {
                        // @cpt-begin:cpt-noter-state-core-credentials-privacy-key:p1:inst-key-state-locked
                        (Err(KeychainLocked), _) => KeyStatus::KeychainLocked,
                        // @cpt-end:cpt-noter-state-core-credentials-privacy-key:p1:inst-key-state-locked
                        // @cpt-begin:cpt-noter-state-core-credentials-privacy-key:p1:inst-key-state-unlocked
                        (Ok(Some(_)), Some(saved)) => saved,
                        (Ok(Some(_)), None) => KeyStatus::Configured {
                            verified_at: TimestampMs(0),
                        },
                        (Ok(None), Some(rejected @ KeyStatus::Rejected { .. })) => rejected,
                        (Ok(None), _) => KeyStatus::NotSet,
                        // @cpt-end:cpt-noter-state-core-credentials-privacy-key:p1:inst-key-state-unlocked
                    }
                };
                KeyView { provider, status }
            })
            .collect()
        // @cpt-end:cpt-noter-algo-core-credentials-privacy-secret-boundary:p1:inst-secret-return
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-keys:p1:inst-key-return
    }

    /// Marks a key as being verified, or no longer, and publishes it.
    pub(crate) fn verifying(&self, provider: KeyProvider, on: bool) -> AccountsView {
        let mut state = lock(&self.state);
        if on {
            state.verifying.insert(provider);
        } else {
            state.verifying.remove(&provider);
        }
        drop(state);
        self.observe(None)
    }

    /// The outcome of verifying `candidate`: stored and configured, or the candidate's error with
    /// the prior working key kept.
    pub(crate) fn settle(
        &self,
        meta: ChangeMeta,
        provider: KeyProvider,
        candidate: &Secret,
        verified: Result<(), Failure>,
    ) -> Result<AccountsView, CoreError> {
        let account = account_of(provider);
        let outcome = match verified {
            Ok(()) => {
                // @cpt-begin:cpt-noter-flow-core-credentials-privacy-keys:p1:inst-key-store
                // @cpt-begin:cpt-noter-algo-core-credentials-privacy-secret-boundary:p1:inst-secret-key
                let stored = self.secrets.set(account, candidate);
                // @cpt-end:cpt-noter-algo-core-credentials-privacy-secret-boundary:p1:inst-secret-key
                match stored {
                    // @cpt-begin:cpt-noter-state-core-credentials-privacy-key:p1:inst-key-state-save
                    Ok(()) => {
                        let verified_at = self.clock.now();
                        self.save(meta, provider, KeyStatus::Configured { verified_at })
                    }
                    // @cpt-end:cpt-noter-state-core-credentials-privacy-key:p1:inst-key-state-save
                    Err(KeychainLocked) => Err(CoreError::new(
                        ErrorCode::KeychainLocked,
                        "the Keychain is locked",
                    )),
                }
                // @cpt-end:cpt-noter-flow-core-credentials-privacy-keys:p1:inst-key-store
            }
            Err(failure) => {
                // @cpt-begin:cpt-noter-state-core-credentials-privacy-key:p1:inst-key-state-reject
                let error = key_error(failure);
                let working = matches!(self.secrets.get(account), Ok(Some(_)))
                    && !matches!(
                        lock(&self.state).saved.get(&provider),
                        Some(KeyStatus::Rejected { .. })
                    );
                if error.code == ErrorCode::KeyRejected && !working {
                    self.save(meta, provider, rejected())?;
                }
                Err(error)
                // @cpt-end:cpt-noter-state-core-credentials-privacy-key:p1:inst-key-state-reject
            }
        };
        let view = self.verifying(provider, false);
        outcome.map(|()| view)
    }

    /// The provider rejected the stored key during a run.
    pub(crate) fn revoked(&self, runtime: RuntimeChoice, llm_run_id: &LlmRunId) {
        let Some(provider) = provider_of(runtime) else {
            return;
        };
        let meta = ChangeMeta {
            actor: Actor::Model {
                llm_run_id: llm_run_id.clone(),
                runtime,
                model: String::new(),
            },
            summary: "The provider rejected the API key".into(),
            reason: "key_rejected".into(),
            evidence_ids: Vec::new(),
            batch_id: None,
            undoable: false,
            surface: None,
        };
        if self.save(meta, provider, rejected()).is_ok() {
            self.observe(None);
        }
    }

    /// Writes one key's status through the change-log writer; the before and after values are
    /// statuses, never the key.
    fn save(
        &self,
        mut meta: ChangeMeta,
        provider: KeyProvider,
        status: KeyStatus,
    ) -> Result<(), CoreError> {
        // A Keychain write cannot be undone from History.
        meta.undoable = false;
        let mut state = lock(&self.state);
        let before = to_value(&state.saved)?;
        let mut saved = state.saved.clone();
        saved.insert(provider, status);
        let after = to_value(&saved)?;
        self.store.write_with(meta, move |tx| {
            let logged = crate::settings::put(tx, KEYS_ROW, &before, &after, None)?;
            Ok(((), vec![logged]))
        })?;
        state.saved = saved;
        Ok(())
    }
}

fn rejected() -> KeyStatus {
    KeyStatus::Rejected {
        reason: RuntimeUnavailableReason::KeyRejected,
    }
}

fn to_value(saved: &Saved) -> Result<Value, CoreError> {
    serde_json::to_value(saved).map_err(|e| CoreError::new(ErrorCode::Internal, e.to_string()))
}

fn cli_info(tool: CliTool, a: Option<&Availability>) -> CliInfo {
    let path = a.and_then(|a| a.path.clone());
    let version = a.and_then(|a| a.version.clone());
    let supported = match (a.and_then(|a| a.tested), &version) {
        (Some(tested), Some(found)) => tested.admits(found),
        // Ollama has no tested range: it is supported once it answers.
        (None, _) => path.is_some(),
        (Some(_), None) => false,
    };
    CliInfo {
        tool,
        installed: path.is_some(),
        path,
        version,
        supported,
    }
}

/// The typed error of a failed verification; the key itself is in none of them.
fn key_error(failure: Failure) -> CoreError {
    let offline = || CoreError::new(ErrorCode::Offline, "the key could not be checked offline");
    match failure {
        Failure::Runtime { code } if code == "offline" => offline(),
        Failure::Timeout => offline(),
        // shortcut: any other runtime error reads as a rejection; split rate limits and CLI
        // failures out when the real CLIs' error codes are mapped (network-monitor run).
        Failure::Runtime { code } => CoreError::new(
            ErrorCode::KeyRejected,
            format!("the provider rejected the key ({code})"),
        ),
        Failure::Unavailable(e) => match &e.detail {
            Some(ErrorDetail::Runtime {
                reason: RuntimeUnavailableReason::Offline,
                ..
            }) => offline(),
            _ => e,
        },
        Failure::Storage(e) => e,
        Failure::Invalid { reason } => CoreError::new(ErrorCode::Internal, reason),
        Failure::Budget | Failure::Cancelled => {
            CoreError::new(ErrorCode::Internal, "the key check did not run")
        }
    }
}

/// `api_key_set`'s checks: the arguments are never logged or kept.
// @cpt-begin:cpt-noter-flow-core-credentials-privacy-keys:p1:inst-key-request
pub(crate) fn candidate(args: ApiKeySetArgs) -> Result<(KeyProvider, Secret), CoreError> {
    let raw = Secret::new(args.key);
    let trimmed = raw.expose().trim();
    if trimmed.is_empty() {
        return Err(crate::settings::invalid("key", ValidationRule::Required));
    }
    Ok((args.provider, Secret::new(trimmed.to_owned())))
}
// @cpt-end:cpt-noter-flow-core-credentials-privacy-keys:p1:inst-key-request
