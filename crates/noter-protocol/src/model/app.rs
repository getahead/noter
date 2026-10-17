//! App-level state every window needs: the snapshot a window asks for when it
//! opens, reloads or comes back after a crash (snapshot, then stream).

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::{
    AccountsView, CaptureState, CopilotStatus, DetectionChanged, ProposalCounts, SetupStatus,
    WindowLabel,
};

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
    // Every slice below that has an event carries that event's `version`, so the
    // UI can tell whether an event that arrives later is newer than the snapshot.
    pub setup: SetupStatus,
    pub capture: CaptureState,
    /// The record prompt's pending detection, if any (as `capture:detected` sends it).
    pub detection: DetectionChanged,
    pub copilot: Option<CopilotStatus>,
    pub privacy: PrivacyStatus,
    /// Hidden for presenting (as `app:presenting` sends it).
    pub presenting: PresentingState,
    /// As `degraded:changed` sends it.
    pub degraded: DegradedSet,
    pub accounts: AccountsView,
    pub features: FeatureFlags,
    pub prefs: UiPrefs,
    pub proposals: ProposalCounts,
    /// As `banners:changed` sends it.
    pub banners: BannerSet,
    pub environment: EnvironmentState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PrivacyStatus {
    pub version: StateVersion,
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
    pub version: StateVersion,
    pub displays: Vec<DisplayInfo>,
    pub output_route: OutputRoute,
    /// The current audio output device, so Settings can offer to mark it as headphones
    /// (`AudioOutputSettings.headphones_devices`).
    pub output_device: Option<OutputDeviceInfo>,
    pub permissions: Vec<PermissionRow>,
    /// macOS notification authorization, read from `UNUserNotificationCenter` settings.
    pub notifications: NotificationAuth,
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

/// Audio output route; replay during capture needs headphones (owner decision 17 Oct).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum OutputRoute {
    /// Detected headphones, or an unclassified device the user marked as headphones.
    Headphones,
    /// Detected speakers; replay during capture is always refused.
    Speakers,
    /// Could not be classified and not marked as headphones.
    Unknown,
}

/// An audio output device as Core Audio reports it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct OutputDeviceInfo {
    /// Core Audio device UID.
    pub uid: String,
    pub name: String,
    /// The user marked this device as headphones.
    pub marked_headphones: bool,
}

/// macOS notification authorization (`UNAuthorizationStatus`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum NotificationAuth {
    /// Not asked yet; the first notification Noter wants to send asks.
    NotDetermined,
    /// Off in System Settings: "Notifications are off".
    Denied,
    /// Allowed (including provisional delivery).
    Authorized,
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
    /// "Noter quit during a recording" (PM-46). While shown (until dismissed or another
    /// capture starts), **Resume Recording** is `capture_resume_interrupted`.
    RecordingInterruptedByQuit {
        call: CallRef,
    },
    UpdateReady {
        version: String,
    },
    /// Performance roll-up failed.
    RollUpFailed {
        at: TimestampMs,
    },
}

/// One row of PRD › Live copilot loop › Degraded states, plus the app-wide
/// degraded conditions. Sent as the full current set (`degraded:changed`), so
/// a missed event can never leave a stale banner.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DegradedState {
    /// Another app plays into the tap. **Keep** is `capture_keep_source`, **Exclude** is
    /// `capture_exclude_source`. (Nothing heard is `CaptureNotice::NothingHeard`, not a degraded state.)
    SecondAudioSource {
        call_id: CallId,
        app_name: String,
        bundle_id: String,
        since: TimestampMs,
    },
    BudgetPaused {
        call_id: CallId,
        spent_usd: f32,
        cap_usd: f32,
    },
    SwitchedToLocal {
        call_id: Option<CallId>,
        reason: crate::error::RuntimeUnavailableReason,
        retry_at: Option<TimestampMs>,
    },
    TranscriptionStalled {
        call_id: CallId,
        since: TimestampMs,
    },
    /// Microphone access is off during capture: only system audio is recorded.
    MicrophoneOff {
        call_id: CallId,
    },
    /// System audio is exact digital zeros: access is probably off (it cannot be queried) or
    /// nothing plays. `confidence` 0..1 that access is off. Capture continues with the mic.
    SystemAudioSilent {
        call_id: CallId,
        since: TimestampMs,
        confidence: f32,
    },
    /// The engine stopped and could not be restarted: "Not recording · engine stopped" with
    /// **Try Again**; the NT-3 notification is sent.
    CaptureFailed {
        call_id: CallId,
        since: TimestampMs,
    },
    DeviceChanged {
        call_id: CallId,
        device_name: String,
        gap_ms: DurationMs,
    },
    ArchivePending {
        call_id: CallId,
    },
    /// Under 2 GB free: a warning, never a rejection.
    DiskLow {
        free_mb: u32,
    },
    /// Under 500 MB free: no new capture; a running capture stops writing audio
    /// (`CaptureState.audio_writing`) and the transcript continues.
    DiskFull {
        free_mb: u32,
    },
    AgentPaused {
        agent: AgentRef,
        reason: crate::error::RuntimeUnavailableReason,
        fix: Option<RuntimeChoice>,
    },
    KeywordOnlySearch {
        progress: f32,
    },
    NoAssistant,
    /// The self-test has not passed: automatic call detection stays off. Manual starts work (O1).
    SetupIncomplete,
    CopilotOff {
        call_id: CallId,
        reason: CopilotOffReason,
    },
    HotkeyNotRegistered {
        action: crate::model::HotkeyAction,
    },
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
    pub version: StateVersion,
    pub states: Vec<DegradedState>,
}

/// Event `banners:changed`: the full current set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct BannerSet {
    pub version: StateVersion,
    pub banners: Vec<AppBanner>,
}

/// The kind of an `AppBanner`, for `banner_dismiss`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum BannerKind {
    RecordingInterruptedByQuit,
    UpdateReady,
    RollUpFailed,
}

impl AppBanner {
    pub fn kind(&self) -> BannerKind {
        match self {
            AppBanner::RecordingInterruptedByQuit { .. } => BannerKind::RecordingInterruptedByQuit,
            AppBanner::UpdateReady { .. } => BannerKind::UpdateReady,
            AppBanner::RollUpFailed { .. } => BannerKind::RollUpFailed,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct BannerDismissArgs {
    pub banner: BannerKind,
}

/// Event `app:presenting`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PresentingState {
    pub version: StateVersion,
    pub hidden: bool,
}

/// `window_report_view`: which call the main window shows right now, so the core sends
/// no notification for it while that window is frontmost (`null` = no call page).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ViewReportArgs {
    #[serde(default)]
    pub call_id: Option<CallId>,
}
