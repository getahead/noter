//! API keys, the user's own Claude and ChatGPT accounts (PM-58) and the local runtime.
//! Noter never holds an account password or token; the CLI keeps the sign-in.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum KeyProvider {
    Anthropic,
    Codex,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum KeyStatus {
    NotSet,
    Verifying,
    /// "Configured · Stored in the Keychain". The key itself is never sent back.
    Configured {
        verified_at: TimestampMs,
    },
    Rejected {
        reason: crate::error::RuntimeUnavailableReason,
    },
    KeychainLocked,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct KeyView {
    pub provider: KeyProvider,
    pub status: KeyStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AccountProvider {
    /// Your Claude account, through Claude Code (Pro or Max, personal use only).
    Claude,
    /// Your ChatGPT account, through Codex (Plus, Pro, Business or Enterprise).
    Chatgpt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CliTool {
    ClaudeCode,
    Codex,
    Ollama,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CliInfo {
    pub tool: CliTool,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub supported: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AccountIdentity {
    pub email: String,
    pub plan: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AccountStatus {
    NotSignedIn,
    SigningIn {
        session_id: SignInSessionId,
    },
    SignedIn {
        identity: AccountIdentity,
        since: TimestampMs,
    },
    /// "Signed out by Claude" / "Signed out by ChatGPT".
    SignedOutByProvider {
        at: TimestampMs,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AccountView {
    pub provider: AccountProvider,
    pub status: AccountStatus,
    pub cli: CliInfo,
    /// Agents running on this account.
    pub agents: Vec<AgentRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LocalRuntimeView {
    pub cli: CliInfo,
    pub running: bool,
    pub models: Vec<String>,
    pub default_model: Option<String>,
}

/// Everything about credentials for the Models & Runtimes pane, the first-run
/// Assistants step and the agent editor's Runtime pop-up (`accounts:changed`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AccountsView {
    pub keys: Vec<KeyView>,
    pub accounts: Vec<AccountView>,
    pub local: LocalRuntimeView,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ApiKeySetArgs {
    pub provider: KeyProvider,
    /// Sent once; stored in the Keychain; never returned.
    pub key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct KeyProviderArgs {
    pub provider: KeyProvider,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AccountProviderArgs {
    pub provider: AccountProvider,
}

/// Step 1 of the sign-in sheet: Prepare.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SignInPrepare {
    pub provider: AccountProvider,
    pub cli: CliInfo,
    /// The tool is already signed in on this Mac: **Use This Account** without a browser.
    pub existing: Option<AccountIdentity>,
    pub needs_personal_use_confirmation: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CliInstallArgs {
    pub tool: CliTool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SignInStartArgs {
    pub provider: AccountProvider,
    pub personal_use_confirmed: bool,
}

/// Step 2: Sign in. The CLI opened the browser.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SignInSession {
    pub id: SignInSessionId,
    pub provider: AccountProvider,
    pub url: String,
    /// One-time code with **Copy Code**, when the provider uses one.
    pub code: Option<String>,
    /// 5 minutes after the start.
    pub expires_at: TimestampMs,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SignInSessionArgs {
    pub session_id: SignInSessionId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SignInStep {
    WaitingForBrowser,
    SignedIn,
    CheckingPlan,
    SendingTestRequest,
    Done,
}

/// Event `signin:progress`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SignInProgress {
    pub session_id: SignInSessionId,
    pub provider: AccountProvider,
    pub step: SignInStep,
    pub identity: Option<AccountIdentity>,
    /// `sign_in_cancelled`, `sign_in_timed_out`, `plan_not_eligible`, `offline`.
    pub error: Option<crate::error::ErrorCode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AccountBindArgs {
    pub provider: AccountProvider,
    pub agent_ids: Vec<AgentId>,
    /// Offer the account first for new agents.
    pub default_for_new_agents: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AccountBindResult {
    pub accounts: AccountsView,
    pub change_id: ChangeId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SignOutArgs {
    pub provider: AccountProvider,
    /// Also sign the tool out on this Mac.
    pub also_in_cli: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AccountTestResult {
    pub ok: bool,
    pub latency_ms: Option<DurationMs>,
    pub error: Option<crate::error::ErrorCode>,
}
