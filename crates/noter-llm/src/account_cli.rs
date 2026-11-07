//! The account CLI seam (TL-32): what the credentials service asks of Claude Code, Codex and
//! Ollama beyond running a skill. The real implementation drives the pinned CLIs
//! (`adapters/cli.rs`); [`ScriptedAccountCli`] answers from a script for tests and
//! noter-core-harness; [`NoAccountCli`] is the default (nothing installed).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_protocol::model::{AccountIdentity, AccountProvider, CliTool};
use serde::Deserialize;
use tokio::sync::Notify;

use crate::runtime::{lock, BoxFuture};

/// What a CLI reports about itself and its sign-in.
#[derive(Debug, Clone, PartialEq)]
pub struct CliStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    /// The version is inside the tested range.
    pub supported: bool,
    /// Who the CLI is signed in as; `None` when signed out (and for Ollama).
    pub identity: Option<AccountIdentity>,
}

impl CliStatus {
    pub fn missing() -> Self {
        Self {
            installed: false,
            path: None,
            version: None,
            supported: false,
            identity: None,
        }
    }
}

/// Why a CLI action did not happen. The text is for the log: never a token or a transcript.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliError {
    Missing,
    Unsupported,
    Offline,
    Failed(String),
}

/// How a browser sign-in ended.
#[derive(Debug, Clone, PartialEq)]
pub enum LoginOutcome {
    SignedIn(AccountIdentity),
    Cancelled,
    Failed(String),
}

/// A sign-in the CLI started: the page it opened, the one-time code if the provider uses one,
/// and the end of the sign-in.
pub struct LoginStart {
    pub url: String,
    pub code: Option<String>,
    pub done: BoxFuture<'static, LoginOutcome>,
}

pub trait AccountCli: Send + Sync {
    fn status(&self, tool: CliTool) -> BoxFuture<'_, CliStatus>;
    fn login(&self, provider: AccountProvider) -> BoxFuture<'_, Result<LoginStart, CliError>>;
    /// Ends a sign-in that is waiting for the browser.
    fn cancel(&self, provider: AccountProvider);
    fn logout(&self, provider: AccountProvider) -> BoxFuture<'_, Result<(), CliError>>;
    /// Installs `tool` and reports what it is afterwards; a failed install leaves the old one.
    fn install(&self, tool: CliTool) -> BoxFuture<'_, Result<CliStatus, CliError>>;
}

pub fn tool_of(provider: AccountProvider) -> CliTool {
    match provider {
        AccountProvider::Claude => CliTool::ClaudeCode,
        AccountProvider::Chatgpt => CliTool::Codex,
    }
}

/// No CLI anywhere: nothing is installed and nothing installs.
pub struct NoAccountCli;

impl AccountCli for NoAccountCli {
    fn status(&self, _: CliTool) -> BoxFuture<'_, CliStatus> {
        Box::pin(async { CliStatus::missing() })
    }

    fn login(&self, _: AccountProvider) -> BoxFuture<'_, Result<LoginStart, CliError>> {
        Box::pin(async { Err(CliError::Missing) })
    }

    fn cancel(&self, _: AccountProvider) {}

    fn logout(&self, _: AccountProvider) -> BoxFuture<'_, Result<(), CliError>> {
        Box::pin(async { Err(CliError::Missing) })
    }

    fn install(&self, _: CliTool) -> BoxFuture<'_, Result<CliStatus, CliError>> {
        Box::pin(async { Err(CliError::Failed("no installer".into())) })
    }
}

/// How a scripted install ends.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstallScript {
    /// `offline` or any other text: the install fails with it and the old install stays.
    #[serde(default)]
    pub fail: Option<String>,
    #[serde(default)]
    pub delay_ms: u64,
    /// The version a successful install leaves (`1.0.0` when unset).
    #[serde(default)]
    pub version: Option<String>,
}

/// How a scripted sign-in ends.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginScript {
    #[serde(default = "page")]
    pub url: String,
    #[serde(default)]
    pub code: Option<String>,
    /// `signed_in` (as `login_identity`), `cancel`, or any other text for a failure.
    #[serde(default = "signed_in")]
    pub outcome: String,
    #[serde(default)]
    pub delay_ms: u64,
}

fn page() -> String {
    "https://claude.ai/login/scripted".into()
}

fn signed_in() -> String {
    "signed_in".into()
}

impl Default for LoginScript {
    fn default() -> Self {
        Self {
            url: page(),
            code: None,
            outcome: signed_in(),
            delay_ms: 0,
        }
    }
}

/// One tool as scripted: replaced whole by each [`ScriptedAccountCli::set`].
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolScript {
    pub tool: CliTool,
    #[serde(default)]
    pub installed: bool,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default = "yes")]
    pub supported: bool,
    /// Who the CLI is signed in as now.
    #[serde(default)]
    pub identity: Option<AccountIdentity>,
    /// Who it signs in as when a scripted sign-in succeeds.
    #[serde(default)]
    pub login_identity: Option<AccountIdentity>,
    #[serde(default)]
    pub install: InstallScript,
    #[serde(default)]
    pub login: LoginScript,
}

fn yes() -> bool {
    true
}

impl ToolScript {
    fn status(&self) -> CliStatus {
        if !self.installed {
            return CliStatus::missing();
        }
        CliStatus {
            installed: true,
            path: self.path.clone(),
            version: self.version.clone(),
            supported: self.supported,
            identity: self.identity.clone(),
        }
    }
}

#[derive(Default)]
struct State {
    tools: HashMap<CliTool, ToolScript>,
    /// Installs and sign-ins asked for, oldest first (`install:ClaudeCode`, `login:Claude`).
    log: Vec<String>,
}

/// The scripted CLIs; cloning shares them.
#[derive(Clone, Default)]
pub struct ScriptedAccountCli {
    state: Arc<Mutex<State>>,
    /// One per provider: cancelling Claude's sign-in never touches ChatGPT's.
    cancel: Arc<[Notify; 2]>,
}

impl ScriptedAccountCli {
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces the script of `script.tool`.
    pub fn set(&self, script: ToolScript) {
        lock(&self.state).tools.insert(script.tool, script);
    }

    pub fn log(&self) -> Vec<String> {
        lock(&self.state).log.clone()
    }

    fn cancel_of(&self, provider: AccountProvider) -> &Notify {
        &self.cancel[usize::from(provider == AccountProvider::Chatgpt)]
    }

    fn script(&self, tool: CliTool) -> Option<ToolScript> {
        lock(&self.state).tools.get(&tool).cloned()
    }
}

impl AccountCli for ScriptedAccountCli {
    fn status(&self, tool: CliTool) -> BoxFuture<'_, CliStatus> {
        Box::pin(async move {
            self.script(tool)
                .map_or_else(CliStatus::missing, |s| s.status())
        })
    }

    fn login(&self, provider: AccountProvider) -> BoxFuture<'_, Result<LoginStart, CliError>> {
        Box::pin(async move {
            let tool = tool_of(provider);
            let script = self
                .script(tool)
                .filter(|s| s.installed)
                .ok_or(CliError::Missing)?;
            if !script.supported {
                return Err(CliError::Unsupported);
            }
            lock(&self.state).log.push(format!("login:{provider:?}"));
            let this = self.clone();
            let outcome = script.login.clone();
            let identity = script.login_identity.clone();
            let done: BoxFuture<'static, LoginOutcome> = Box::pin(async move {
                let wait = tokio::time::sleep(Duration::from_millis(outcome.delay_ms));
                tokio::select! {
                    () = this.cancel_of(provider).notified() => LoginOutcome::Cancelled,
                    () = wait => match (outcome.outcome.as_str(), identity) {
                        ("signed_in", Some(identity)) => {
                            if let Some(s) = lock(&this.state).tools.get_mut(&tool) {
                                s.identity = Some(identity.clone());
                            }
                            LoginOutcome::SignedIn(identity)
                        }
                        ("cancel", _) => LoginOutcome::Cancelled,
                        (other, _) => LoginOutcome::Failed(other.to_owned()),
                    },
                }
            });
            Ok(LoginStart {
                url: script.login.url,
                code: script.login.code,
                done,
            })
        })
    }

    fn cancel(&self, provider: AccountProvider) {
        self.cancel_of(provider).notify_waiters();
    }

    fn logout(&self, provider: AccountProvider) -> BoxFuture<'_, Result<(), CliError>> {
        Box::pin(async move {
            match lock(&self.state).tools.get_mut(&tool_of(provider)) {
                Some(s) if s.installed => {
                    s.identity = None;
                    Ok(())
                }
                _ => Err(CliError::Missing),
            }
        })
    }

    fn install(&self, tool: CliTool) -> BoxFuture<'_, Result<CliStatus, CliError>> {
        Box::pin(async move {
            lock(&self.state).log.push(format!("install:{tool:?}"));
            let script = self.script(tool);
            let install = script
                .as_ref()
                .map(|s| s.install.clone())
                .unwrap_or_default();
            tokio::time::sleep(Duration::from_millis(install.delay_ms)).await;
            if let Some(fail) = install.fail {
                return Err(if fail == "offline" {
                    CliError::Offline
                } else {
                    CliError::Failed(fail)
                });
            }
            let mut installed = script.unwrap_or_else(|| ToolScript {
                tool,
                installed: false,
                path: None,
                version: None,
                supported: true,
                identity: None,
                login_identity: None,
                install: InstallScript::default(),
                login: LoginScript::default(),
            });
            installed.installed = true;
            installed.supported = true;
            installed
                .path
                .get_or_insert_with(|| format!("/scripted/bin/{tool:?}"));
            installed.version = Some(install.version.unwrap_or_else(|| "1.0.0".into()));
            let status = installed.status();
            lock(&self.state).tools.insert(tool, installed);
            Ok(status)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn script(json: &str) -> ToolScript {
        serde_json::from_str(json).unwrap()
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_install_keeps_the_old_one_and_a_retry_installs() {
        let cli = ScriptedAccountCli::new();
        cli.set(script(
            r#"{"tool":"claude_code","installed":true,"version":"2.1.1","install":{"fail":"offline"}}"#,
        ));
        assert_eq!(
            cli.install(CliTool::ClaudeCode).await,
            Err(CliError::Offline)
        );
        let old = cli.status(CliTool::ClaudeCode).await;
        assert_eq!(old.version.as_deref(), Some("2.1.1"));
        cli.set(script(
            r#"{"tool":"claude_code","install":{"delay_ms":50,"version":"2.1.9"}}"#,
        ));
        assert!(!cli.status(CliTool::ClaudeCode).await.installed);
        let done = cli.install(CliTool::ClaudeCode).await.unwrap();
        assert_eq!(done.version.as_deref(), Some("2.1.9"));
        assert!(cli.status(CliTool::ClaudeCode).await.installed);
        assert_eq!(cli.log(), ["install:ClaudeCode", "install:ClaudeCode"]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_sign_in_ends_signed_in_cancelled_or_failed() {
        let cli = ScriptedAccountCli::new();
        let who = r#"{"email":"ann@example.com","plan":"Max"}"#;
        cli.set(script(&format!(
            r#"{{"tool":"claude_code","installed":true,"version":"2.1.1","login_identity":{who},"login":{{"delay_ms":100}}}}"#
        )));
        let start = cli.login(AccountProvider::Claude).await.unwrap();
        let LoginOutcome::SignedIn(identity) = start.done.await else {
            panic!("signed in")
        };
        assert_eq!(identity.email, "ann@example.com");
        assert_eq!(
            cli.status(CliTool::ClaudeCode).await.identity,
            Some(identity)
        );
        cli.logout(AccountProvider::Claude).await.unwrap();
        assert_eq!(cli.status(CliTool::ClaudeCode).await.identity, None);
        // A waiting sign-in ends cancelled.
        let start = cli.login(AccountProvider::Claude).await.unwrap();
        let waiting = tokio::spawn(start.done);
        tokio::task::yield_now().await;
        cli.cancel(AccountProvider::Claude);
        assert_eq!(waiting.await.unwrap(), LoginOutcome::Cancelled);
        // A tool that is not installed cannot sign in.
        assert!(matches!(
            cli.login(AccountProvider::Chatgpt).await,
            Err(CliError::Missing)
        ));
    }
}
