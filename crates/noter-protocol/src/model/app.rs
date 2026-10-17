//! App-level state every window needs: the snapshot a window asks for when it
//! opens, reloads or comes back after a crash (snapshot, then stream).

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::{AccountsView, CaptureState, CallDetection, CopilotStatus, ProposalCounts, SetupStatus, WindowLabel};

/// `app_snapshot`: everything app-level a window renders from, in one call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AppSnapshot {
    /// Must equal `CONTRACT_VERSION` of the bindings the UI was built with; the
    /// bridge refuses to start on a major mismatch (one bundle, so this only
    /// catches dev-loop skew).
    pub contract_version: String,
    pub app_version: String,
    /// The window that asked; scopes which commands it may call.
    pub window: WindowLabel,
    pub setup: SetupStatus,
    pub capture: CaptureState,
    /// The record prompt's pending detection, if any.
    pub detection: Option<CallDetection>,
    pub copilot: Option<CopilotStatus>,
    pub privacy: PrivacyStatus,
    pub hidden_for_presenting: bool,
    pub degraded: Vec<DegradedState>,
    pub accounts: AccountsView,
    pub features: FeatureFlags,
    pub prefs: UiPrefs,
    pub proposals: ProposalCounts,
    pub banners: Vec<AppBanner>,
    pub environment: EnvironmentState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PrivacyStatus {
    pub mode: PrivacyMode,
    /// What applies right now (sensitive call, switched to local, ...).
    pub effective: EffectiveMode,
}

/// Build and runtime feature flags (DESIGN › Copilot behind a flag).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FeatureFlags {
    pub copilot: bool,
    /// Council (several agents) versus the single-agent copilot (PM-01, D9).
    pub council: bool,
    /// v1.x.
    pub screen_context: bool,
    /// Talk-time and "who was silent" rows exist only when on (D47).
    pub behaviour_metrics: bool,
}

/// Preferences the WebView cannot read itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct UiPrefs {
    pub time_format: TimeFormat,
    /// 1 = Monday ... 7 = Sunday.
    pub first_weekday: u8,
    /// IANA zone, for formatting timestamps.
    pub time_zone: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TimeFormat {
    H12,
    H24,
}

/// Environment facts the core observes (event `env:changed`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct EnvironmentState {
    pub displays: Vec<DisplayInfo>,
    pub output_route: OutputRoute,
    pub permissions: Vec<PermissionRow>,
    pub notifications_enabled: bool,
    pub online: bool,
    pub update: Option<UpdateInfo>,
    /// Free space on the storage volume.
    pub disk_free_mb: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct DisplayInfo {
    pub id: DisplayId,
    pub name: String,
    pub is_main: bool,
    /// The display that currently shows the call app's window.
    pub holds_call_app: bool,
    pub width_pt: u32,
    pub height_pt: u32,
}

/// Audio output route; replay during capture needs headphones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum OutputRoute {
    Headphones,
    Speakers,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PermissionRow {
    pub kind: PermissionKind,
    pub state: PermissionState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct UpdateInfo {
    pub version: String,
    pub notes_md: String,
    /// Downloaded and verified; installs on next launch.
    pub ready: bool,
}

/// Banners at app level (MW-R5) that are not degraded states of a live function.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AppBanner {
    /// "Noter quit during a recording" (PM-46).
    RecordingInterruptedByQuit { call: CallRef },
    UpdateReady { version: String },
    /// Performance roll-up failed.
    RollUpFailed { at: TimestampMs },
}

/// One row of PRD › Live copilot loop › Degraded states, plus the app-wide
/// degraded conditions. Sent as the full current set (`degraded:changed`), so
/// a missed event can never leave a stale banner.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DegradedState {
    SecondAudioSource { call_id: CallId, app_name: String, bundle_id: String, since: TimestampMs },
    NothingHeard { call_id: CallId, since: TimestampMs },
    BudgetPaused { call_id: CallId, spent_usd: f32, cap_usd: f32 },
    SwitchedToLocal { call_id: Option<CallId>, reason: crate::error::RuntimeUnavailableReason, retry_at: Option<TimestampMs> },
    TranscriptionStalled { call_id: CallId, since: TimestampMs },
    SystemAudioLost { call_id: CallId, since: TimestampMs },
    DeviceChanged { call_id: CallId, device_name: String, gap_ms: DurationMs },
    ArchivePending { call_id: CallId },
    DiskLow { free_mb: u32 },
    DiskFull { free_mb: u32 },
    AgentPaused { agent: AgentRef, reason: crate::error::RuntimeUnavailableReason, fix: Option<RuntimeChoice> },
    KeywordOnlySearch { progress: f32 },
    NoAssistant,
    SetupIncomplete,
    CopilotOff { call_id: CallId, reason: CopilotOffReason },
    HotkeyNotRegistered { action: crate::model::HotkeyAction },
    CalendarAccessDenied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CopilotOffReason {
    /// Sensitive call and no local model.
    SensitiveNoLocalModel,
    FlagOff,
    Muted,
    NoRuntime,
}

/// Event `degraded:changed`: the full current set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct DegradedSet {
    pub states: Vec<DegradedState>,
}

/// Event `banners:changed`: the full current set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct BannerSet {
    pub banners: Vec<AppBanner>,
}

/// Event `app:presenting`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PresentingState {
    pub hidden: bool,
}
