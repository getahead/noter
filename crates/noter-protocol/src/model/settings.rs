//! Settings, hotkeys, repositories, glossary, privacy audit and the screen-share test.
//!
//! Settings are typed per pane. `settings_update` replaces one whole section
//! (wanted state, never a toggle), guarded by the settings `rev`.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::{CouncilMode, HandoffTarget};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct Settings {
    /// Monotonic per `settings:changed`; the UI keeps the highest.
    pub version: StateVersion,
    pub rev: Rev,
    pub general: GeneralSettings,
    pub audio: AudioSettings,
    pub privacy: PrivacySettings,
    pub runtimes: RuntimeSettings,
    pub copilot: CopilotSettings,
    pub call_screen: CallScreenSettings,
    pub menu_bar: MenuBarSettings,
    pub today: TodaySettings,
    pub performance: PerformanceSettings,
    pub maintenance: MaintenanceSettings,
    pub evidence: EvidenceSettings,
    pub updates: UpdateSettings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct IgnoredApp {
    pub bundle_id: String,
    pub app_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SummaryLanguage {
    En,
    Ru,
    De,
    LanguageOfTheCall,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct GeneralSettings {
    pub storage_path: String,
    /// Read-only: the folder is in iCloud Drive or Dropbox (discouraged).
    pub storage_in_cloud_folder: bool,
    pub ignored_apps: Vec<IgnoredApp>,
    pub summary_language: SummaryLanguage,
    /// Read-only mirror of macOS notification permission.
    pub notifications_enabled: bool,
    /// **Launch at login** (registered with `SMAppService`).
    pub launch_at_login: bool,
    /// **Offer to record when a call starts**: automatic call detection, which also needs
    /// a passed self-test.
    pub offer_to_record: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionBackend {
    WhisperTurboNoterLoop,
    WhisperProStreaming,
    ParakeetTdtV3,
    WhisperLargeV3,
}

/// Replay during capture is headphones-only (owner decision 17 Oct). Devices the user
/// marked as headphones lift only an `unknown` route; detected speakers always refuse.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AudioOutputSettings {
    /// Core Audio UIDs of output devices the user marked as headphones.
    pub headphones_devices: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AudioRetention {
    Days7,
    Days30,
    Days90,
    Forever,
    NeverStore,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AudioSettings {
    pub live_backend: TranscriptionBackend,
    pub offline_backend: TranscriptionBackend,
    pub output: AudioOutputSettings,
    pub exclude_own_sounds: bool,
    /// A changed retention applies to existing calls from the next nightly Retention run.
    pub retention: AudioRetention,
    /// Read-only: how many calls' audio the next Retention run deletes (ignored on update).
    pub retention_next_run_deletes: u32,
    /// `null` = system default input.
    #[serde(default)]
    pub mic_device: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PrivacySettings {
    pub mode: PrivacyMode,
    pub pseudonymise_names: bool,
    /// Talk-time and "who was silent" (off by default, D47). Computed from the moment they are
    /// switched on; past calls are not back-computed (D5).
    pub behaviour_metrics: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct RuntimeSettings {
    pub live_copilot: RuntimeChoice,
    pub post_call: RuntimeChoice,
    pub search_answers: RuntimeChoice,
    #[serde(default)]
    pub local_model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CopilotSettings {
    /// Pin and dismiss cards with keys.
    pub card_keys: CardKeySettings,
    /// Dismiss with keys (modifiers + ⇧ + 1–3) is on.
    pub dismiss_with_keys: bool,
    pub default_cap_usd: f32,
    /// Call types the copilot is muted for.
    pub muted_call_types: Vec<CallTypeId>,
    pub default_council_live: CouncilMode,
    pub default_council_post_call: CouncilMode,
}

/// Card keys as one setting: pin = `modifiers` + 1–3, dismiss = `modifiers` + ⇧ + 1–3.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct CardKeySettings {
    pub enabled: bool,
    /// Default ⌃⌥⌘. At least one must be on (`invalid_input`, `no_modifier`).
    pub modifiers: Modifiers,
}

/// Modifier keys of a key combination. Shift is not offered for card keys: dismiss adds it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Modifiers {
    pub control: bool,
    pub option: bool,
    pub command: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CallLayoutPreference {
    /// Dedicated on a second display, floating on one.
    Auto,
    Floating,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallScreenSettings {
    #[serde(default)]
    pub display_id: Option<DisplayId>,
    pub layout: CallLayoutPreference,
    pub open_automatically: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MenuBarTitle {
    None,
    ElapsedTime,
    NewestCard,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct MenuBarSettings {
    pub title: MenuBarTitle,
    pub hidden_actions: Vec<HotkeyAction>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DashboardHorizon {
    Today,
    ThisWeek,
}

/// How Today ranks the items on each call card (D3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TodayRanking {
    /// The default (PRD order): owed to people on today's calls, then due date, then age.
    OwedToTodaysPeople,
    /// "Due date, then owed to you".
    DueThenOwedToYou,
}

/// Settings › General › group **Today**.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TodaySettings {
    pub horizon: DashboardHorizon,
    /// Calendar identifiers hidden from Today.
    pub hidden_calendars: Vec<String>,
    pub ranking: TodayRanking,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PerformanceSettings {
    pub near_pct: u16,
    pub over_pct: u16,
    pub retention_days: u16,
    pub sampled_stages: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct MaintenanceSettings {
    /// "02:00".
    pub window_start: String,
    pub window_end: String,
    pub allow_on_battery: bool,
    pub backups_kept: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct EvidenceSettings {
    pub jira: bool,
    pub bitbucket: bool,
    pub github: bool,
    pub later_calls: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum UpdateChannel {
    Stable,
    Beta,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct UpdateSettings {
    pub channel: UpdateChannel,
    pub install_automatically: bool,
}

/// One whole section to replace.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "section", content = "value", rename_all = "snake_case")]
pub enum SettingsSection {
    General(GeneralSettings),
    Audio(AudioSettings),
    Privacy(PrivacySettings),
    Runtimes(RuntimeSettings),
    Copilot(CopilotSettings),
    CallScreen(CallScreenSettings),
    MenuBar(MenuBarSettings),
    Today(TodaySettings),
    Performance(PerformanceSettings),
    Maintenance(MaintenanceSettings),
    Evidence(EvidenceSettings),
    Updates(UpdateSettings),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SettingsUpdateArgs {
    pub rev: Rev,
    pub section: SettingsSection,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AppIdArgs {
    pub bundle_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct StorageMoveArgs {
    /// `null` = the core shows the open panel.
    #[serde(default)]
    pub path: Option<String>,
}

// ── hotkeys ───────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum HotkeyAction {
    StartStop,
    Pause,
    MarkMoment,
    CatchMeUp,
    AskAboutCall,
    OpenCallScreen,
    HideForPresenting,
    /// ⌃⌥⌘K: mute the copilot; while muted the same key unmutes.
    MuteCopilot,
    /// ⌃⌥⌘Z: undo the last card action (a card key; pin and dismiss keys are `CardKeySettings`).
    UndoCardAction,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HotkeyStatus {
    /// App hotkeys: registered at launch and kept registered.
    Registered,
    /// Card keys: registered only while capture runs, the copilot is on, not muted and not
    /// hidden for presenting.
    RegisteredDuringCapture,
    Conflict {
        owner: Option<String>,
    },
    ReservedBySystem,
    NotSet,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HotkeyBinding {
    pub action: HotkeyAction,
    /// Tauri accelerator syntax, e.g. "Ctrl+Alt+Super+R"; `null` = none.
    pub shortcut: Option<String>,
    pub default_shortcut: Option<String>,
    pub status: HotkeyStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HotkeyList {
    pub version: StateVersion,
    pub bindings: Vec<HotkeyBinding>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HotkeySetArgs {
    pub action: HotkeyAction,
    /// `null` clears; the core refuses a shortcut without a modifier.
    #[serde(default)]
    pub shortcut: Option<String>,
}

// ── repositories ──────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct RepoMapping {
    pub id: RepoMappingId,
    /// Jira project key or component, e.g. "VSTOR" or "VSTOR/ui".
    pub key: String,
    pub local_path: String,
    pub default_tool: HandoffTarget,
    pub path_exists: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct RepoList {
    pub mappings: Vec<RepoMapping>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct RepoUpsertArgs {
    #[serde(default)]
    pub id: Option<RepoMappingId>,
    pub key: String,
    /// `null` = the core shows the open panel.
    #[serde(default)]
    pub local_path: Option<String>,
    pub default_tool: HandoffTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct RepoIdArgs {
    pub id: RepoMappingId,
}

// ── glossary ──────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct GlossaryTerm {
    pub id: GlossaryTermId,
    pub rev: Rev,
    pub term: String,
    pub variants_latin: Vec<String>,
    pub variants_cyrillic: Vec<String>,
    pub spoken_forms: Vec<String>,
    pub lang: Option<Lang>,
    /// Apply future matches without a proposal ("Always for this term").
    pub always_apply: bool,
    pub added_from: Option<CallRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct GlossaryList {
    pub terms: Vec<GlossaryTerm>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct GlossaryUpsertArgs {
    #[serde(default)]
    pub id: Option<GlossaryTermId>,
    #[serde(default)]
    pub rev: Option<Rev>,
    pub term: String,
    pub variants_latin: Vec<String>,
    pub variants_cyrillic: Vec<String>,
    pub spoken_forms: Vec<String>,
    #[serde(default)]
    pub lang: Option<Lang>,
    pub always_apply: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct GlossaryIdArgs {
    pub id: GlossaryTermId,
}

// ── privacy audit ─────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AuditWhat {
    TranscriptDelta,
    FullTranscript,
    Outputs,
    DocumentExcerpts,
    SearchQuestion,
    EvidenceLookup,
    LiveMcpQuery,
    HandoffPrompt,
}

/// One row of `audit_log`: one per LLM run (the packet) plus, for a run on a cloud runtime,
/// one per noter-mcp tool result, redacted before it left (O2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AuditKind {
    /// The packet a run started with.
    Run,
    /// A noter-mcp tool result returned to a cloud run.
    ToolResult,
    /// A live lookup in one of the user's MCP sources (only in "Cloud allowed", D1).
    Lookup,
}

/// "14:32 — 1.8 KB of transcript from the planning call went to Claude".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AuditEntry {
    pub id: AuditId,
    pub kind: AuditKind,
    /// The run this row belongs to; a `tool_result` row links to its run's row through it.
    pub llm_run_id: Option<LlmRunId>,
    pub at: TimestampMs,
    pub call: Option<CallRef>,
    pub runtime: Option<RuntimeChoice>,
    pub destination: String,
    pub what: AuditWhat,
    pub bytes_out: u32,
    pub redacted: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AuditListArgs {
    #[serde(default)]
    pub from: Option<TimestampMs>,
    #[serde(default)]
    pub to: Option<TimestampMs>,
    pub page: PageRequest,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AuditExportArgs {
    #[serde(default)]
    pub from: Option<TimestampMs>,
    #[serde(default)]
    pub to: Option<TimestampMs>,
    pub format: crate::model::LogFormat,
}

// ── screen share test ─────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum NoterSurface {
    CallWindow,
    RecordPrompt,
    MainWindow,
    SettingsWindow,
    MenuBarTitle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ShareVisibility {
    Hidden,
    Visible,
    DependsOnApp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ShareTestRow {
    pub surface: NoterSurface,
    pub window_share: ShareVisibility,
    pub app_share: ShareVisibility,
    pub display_share: ShareVisibility,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CaptureTestOutcome {
    NotRun,
    Passed {
        at: TimestampMs,
    },
    Failed {
        code: crate::error::ErrorCode,
    },
    /// Refused while a call is being recorded.
    BlockedByCall,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ShareTestResult {
    pub rows: Vec<ShareTestRow>,
    pub capture_test: CaptureTestOutcome,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ShareTestArgs {
    /// Run the optional capture test (asks for Screen Recording once).
    pub run_capture_test: bool,
}
