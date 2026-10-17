//! The one error type every command returns, and the closed list of codes.
//!
//! Rule (DESIGN 3.3, Error handling): every code maps to a named state in the
//! States table of the screen that sent the command. The mapping table is in
//! DESIGN-core 3.3 › Error codes. A code not in this enum is a contract break.
//! `message` is developer text for the local log; the UI never shows it and it
//! never contains transcript, document or model text.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CoreError {
    pub code: ErrorCode,
    /// Developer text for the log. Not localised, not shown.
    pub message: String,
    /// True when the same command may succeed if sent again unchanged
    /// (the UI offers **Try Again**; it never retries by itself).
    pub retryable: bool,
    pub detail: Option<ErrorDetail>,
}

impl CoreError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        let retryable = code.default_retryable();
        Self {
            code,
            message: message.into(),
            retryable,
            detail: None,
        }
    }
    pub fn with_detail(mut self, detail: ErrorDetail) -> Self {
        self.detail = Some(detail);
        self
    }
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}
impl std::error::Error for CoreError {}

/// Structured detail for the codes that need more than a name.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ErrorDetail {
    /// `conflict`: the record changed since `rev`; the current record is attached as JSON-free fields.
    Conflict { current_rev: Rev },
    /// `invalid_input`: which field broke which rule, for the form's inline error.
    Validation { field: String, rule: ValidationRule },
    /// `disk_low` / `disk_full`.
    DiskSpace { free_mb: u32 },
    /// `permission_missing` / `permission_denied`.
    Permission { kind: PermissionKind },
    /// `runtime_unavailable`: which runtime and the one-step fix the UI may offer.
    Runtime {
        runtime: RuntimeChoice,
        reason: RuntimeUnavailableReason,
        fix: Option<RuntimeChoice>,
    },
    /// `hotkey_conflict`: the app that owns the shortcut, when macOS says.
    HotkeyOwner { owner: Option<String> },
    /// `partially_applied`: a batch where some rows were edited later and skipped.
    Partial { applied: u32, skipped: u32 },
    /// `cli_version_unsupported`.
    CliVersion {
        tool: String,
        found: String,
        supported: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ValidationRule {
    Required,
    TooLong,
    TooShort,
    Duplicate,
    InvalidFormat,
    OutOfRange,
    NoModifier,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeUnavailableReason {
    NoKey,
    KeyRejected,
    RateLimited,
    QuotaExhausted,
    AccountSignedOut,
    CliMissing,
    CliVersionUnsupported,
    LocalModelNotReady,
    Offline,
    SensitiveCallNeedsLocal,
}

/// Closed list of error codes. Grouped by the area that raises them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    // ── generic ───────────────────────────────────────────────
    /// The record does not exist (deleted, or a stale link).
    NotFound,
    /// `rev` is stale: "Item changed since".
    Conflict,
    /// Input failed validation; see `ErrorDetail::Validation`.
    InvalidInput,
    /// The calling window may not call this command (PM-08 window scoping).
    WindowNotAllowed,
    /// The command belongs to a feature behind a flag that is off (copilot, screen context).
    FeatureDisabled,
    /// The core is shutting down or still starting.
    NotReady,
    /// A draft command the core does not implement yet (fake and early core builds).
    NotImplemented,
    /// Anything unmapped: the UI shows its section-level error with **Try Again**.
    Internal,

    // ── setup, permissions, disk ──────────────────────────────
    /// Audio permissions or the self-test are missing: every start control reads **Finish Setup…** (PM-30).
    SetupIncomplete,
    /// A macOS permission is not granted yet.
    PermissionMissing,
    /// The user denied the permission; the fix is **Open System Settings…**.
    PermissionDenied,
    /// Under 2 GB free: warning, capture still allowed.
    DiskLow,
    /// Under 500 MB free: capture refuses to start.
    DiskFull,
    /// A download had no connection.
    Offline,
    /// A downloaded model failed its checksum.
    ChecksumFailed,
    /// The speech model is not downloaded yet (self-test, start).
    ModelNotReady,

    // ── capture ───────────────────────────────────────────────
    /// Start while a capture already runs.
    AlreadyRecording,
    /// Stop, pause or mark with no capture running for that call.
    NotRecording,
    /// The call-ended or new-meeting notice the answer refers to is gone.
    NoticeExpired,
    /// Continue Recording after its 5-minute window.
    ContinueWindowClosed,
    /// The engine sidecar is not running and could not be restarted.
    EngineUnavailable,
    /// The record prompt's detection expired (15 s) or was answered elsewhere.
    DetectionExpired,

    // ── transcript and audio ──────────────────────────────────
    /// Audio removed by retention or by the user.
    AudioDeleted,
    /// Replay during capture is headphones-only (owner decision 17 Oct): on speakers the
    /// meeting app's own microphone would send it to the call, echo cancellation or not.
    ReplayNeedsHeadphones,
    /// Replay during capture while Noter's own sounds are not excluded.
    OwnSoundsNotExcluded,
    /// Output route could not be identified during capture.
    OutputRouteUnknown,
    /// The archive pass has replaced the live transcript at this span.
    TranscriptUpgraded,

    // ── copilot ───────────────────────────────────────────────
    /// No visible card with that number (card keys).
    NoSuchCard,
    /// The card already expired or was removed.
    CardGone,
    /// Copilot paused by the per-call budget.
    BudgetPaused,
    /// The copilot is muted or off for this call (sensitive without a local model).
    CopilotOff,

    // ── items, outputs, handoff ───────────────────────────────
    /// Outputs or a section are still being written.
    OutputsNotReady,
    /// Sharing a scope that contains suggested items not yet reviewed.
    UnreviewedInScope,
    /// No repository mapped for the item's project key.
    RepoNotMapped,
    /// The mapped folder no longer exists.
    RepoPathMissing,
    /// No URL handler for the chosen launch path.
    NoLinkHandler,
    /// Automation (Terminal or iTerm) denied.
    AutomationDenied,
    /// The handoff prompt could not be written.
    PromptNotReady,

    // ── library, search, ask ──────────────────────────────────
    /// Full-text and vector indexes are rebuilding; keyword-only results.
    IndexRebuilding,
    /// Search failed.
    SearchFailed,
    /// The answer stream was stopped by the user.
    AnswerStopped,

    // ── history and maintenance ───────────────────────────────
    /// The undo or redo window has passed.
    UndoExpired,
    /// Some changes of the batch were edited later; `ErrorDetail::Partial`.
    PartiallyApplied,
    /// A proposal could not be applied ("Couldn't apply").
    ProposalNotApplicable,
    /// The change log could not be read.
    ChangeLogUnreadable,
    /// A job cannot run now (a call is live, or on battery).
    JobBlocked,
    /// Evidence tool (`acli`, `bkt`, `gh`) is not installed or not signed in.
    EvidenceToolMissing,

    // ── runtimes, keys and accounts ───────────────────────────
    /// See `ErrorDetail::Runtime`.
    RuntimeUnavailable,
    /// The API key was rejected by the provider.
    KeyRejected,
    /// The Keychain is locked.
    KeychainLocked,
    /// Claude Code or Codex is not installed.
    CliMissing,
    /// The installed CLI is outside the tested version range.
    CliVersionUnsupported,
    /// Sign-in cancelled in the browser.
    SignInCancelled,
    /// Sign-in timed out after 5 minutes.
    SignInTimedOut,
    /// The account's plan does not qualify.
    PlanNotEligible,
    /// The provider ended the account session.
    AccountSignedOut,
    /// Personal use was not confirmed for a Claude account.
    PersonalUseNotConfirmed,

    // ── sources ───────────────────────────────────────────────
    /// A knowledge-source sync failed.
    SourceSyncFailed,
    /// The OAuth token for an indexed MCP source expired.
    SourceSignInExpired,

    // ── settings ──────────────────────────────────────────────
    /// The shortcut is taken by another app.
    HotkeyConflict,
    /// The shortcut is reserved by macOS or VoiceOver.
    HotkeyReserved,
    /// The storage folder is inside iCloud Drive or Dropbox.
    StorageInCloudFolder,
    /// The user cancelled a native open or save panel.
    Cancelled,
}

impl ErrorCode {
    /// Whether **Try Again** makes sense by default.
    pub fn default_retryable(self) -> bool {
        use ErrorCode::*;
        matches!(
            self,
            Internal
                | NotReady
                | Offline
                | EngineUnavailable
                | SearchFailed
                | SourceSyncFailed
                | KeychainLocked
                | ChangeLogUnreadable
        )
    }

    /// Every code, in declaration order (used by the contract tests and the exporter).
    pub const ALL: &'static [ErrorCode] = &[
        ErrorCode::NotFound,
        ErrorCode::Conflict,
        ErrorCode::InvalidInput,
        ErrorCode::WindowNotAllowed,
        ErrorCode::FeatureDisabled,
        ErrorCode::NotReady,
        ErrorCode::NotImplemented,
        ErrorCode::Internal,
        ErrorCode::SetupIncomplete,
        ErrorCode::PermissionMissing,
        ErrorCode::PermissionDenied,
        ErrorCode::DiskLow,
        ErrorCode::DiskFull,
        ErrorCode::Offline,
        ErrorCode::ChecksumFailed,
        ErrorCode::ModelNotReady,
        ErrorCode::AlreadyRecording,
        ErrorCode::NotRecording,
        ErrorCode::NoticeExpired,
        ErrorCode::ContinueWindowClosed,
        ErrorCode::EngineUnavailable,
        ErrorCode::DetectionExpired,
        ErrorCode::AudioDeleted,
        ErrorCode::ReplayNeedsHeadphones,
        ErrorCode::OwnSoundsNotExcluded,
        ErrorCode::OutputRouteUnknown,
        ErrorCode::TranscriptUpgraded,
        ErrorCode::NoSuchCard,
        ErrorCode::CardGone,
        ErrorCode::BudgetPaused,
        ErrorCode::CopilotOff,
        ErrorCode::OutputsNotReady,
        ErrorCode::UnreviewedInScope,
        ErrorCode::RepoNotMapped,
        ErrorCode::RepoPathMissing,
        ErrorCode::NoLinkHandler,
        ErrorCode::AutomationDenied,
        ErrorCode::PromptNotReady,
        ErrorCode::IndexRebuilding,
        ErrorCode::SearchFailed,
        ErrorCode::AnswerStopped,
        ErrorCode::UndoExpired,
        ErrorCode::PartiallyApplied,
        ErrorCode::ProposalNotApplicable,
        ErrorCode::ChangeLogUnreadable,
        ErrorCode::JobBlocked,
        ErrorCode::EvidenceToolMissing,
        ErrorCode::RuntimeUnavailable,
        ErrorCode::KeyRejected,
        ErrorCode::KeychainLocked,
        ErrorCode::CliMissing,
        ErrorCode::CliVersionUnsupported,
        ErrorCode::SignInCancelled,
        ErrorCode::SignInTimedOut,
        ErrorCode::PlanNotEligible,
        ErrorCode::AccountSignedOut,
        ErrorCode::PersonalUseNotConfirmed,
        ErrorCode::SourceSyncFailed,
        ErrorCode::SourceSignInExpired,
        ErrorCode::HotkeyConflict,
        ErrorCode::HotkeyReserved,
        ErrorCode::StorageInCloudFolder,
        ErrorCode::Cancelled,
    ];
}
