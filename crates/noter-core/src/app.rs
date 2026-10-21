//! App-level state every window renders from (`app_snapshot`), and the whole-state
//! payloads with their versions.

use noter_protocol::model::*;
use noter_protocol::*;
use serde::Serialize;

/// The app snapshot of a core that just started: every slice at version 1. Slices whose
/// feature comes later hold its first-run defaults until that feature owns them.
pub(crate) fn fresh_snapshot(app_version: &str) -> AppSnapshot {
    let v1 = StateVersion(1);
    let permissions: Vec<PermissionRow> = [
        PermissionKind::Microphone,
        PermissionKind::SystemAudio,
        PermissionKind::Calendar,
        PermissionKind::Notifications,
        PermissionKind::ScreenRecording,
        PermissionKind::AutomationTerminal,
        PermissionKind::AutomationBrowser,
    ]
    .into_iter()
    .map(|kind| PermissionRow {
        kind,
        state: PermissionState::NotAsked,
    })
    .collect();
    let steps = [
        SetupStep::Welcome,
        SetupStep::Models,
        SetupStep::Permissions,
        SetupStep::CallDisplay,
        SetupStep::AudioStorage,
        SetupStep::Assistants,
    ]
    .into_iter()
    .map(|step| StepRow {
        step,
        state: StepState::Todo,
    })
    .collect();
    AppSnapshot {
        contract_version: CONTRACT_VERSION.into(),
        app_version: app_version.into(),
        window: WindowLabel::Main,
        setup: SetupStatus {
            version: v1,
            complete: false,
            steps,
            models: ModelsStatus {
                bundles: vec![],
                total_mb: 0,
                done_mb: 0,
                error: None,
            },
            permissions: permissions.clone(),
            self_test: SelfTestState::NotRun,
            call_display: None,
            detection_enabled: false,
        },
        capture: CaptureState {
            version: v1,
            phase: CapturePhase::Idle,
            call_id: None,
            title: None,
            started_at: None,
            recorded_ms: DurationMs(0),
            sensitive: false,
            pause: None,
            notice: None,
            continue_until: None,
            output_route: OutputRoute::Unknown,
            replay_available: false,
            audio_not_stored: false,
            audio_writing: false,
        },
        detection: DetectionChanged {
            version: v1,
            detection: None,
        },
        copilot: None,
        privacy: PrivacyStatus {
            version: v1,
            mode: PrivacyMode::CloudRedacted,
            effective: EffectiveMode::CloudRedacted,
        },
        presenting: PresentingState {
            version: v1,
            hidden: false,
        },
        degraded: DegradedSet {
            version: v1,
            states: vec![],
        },
        accounts: AccountsView {
            version: v1,
            keys: vec![],
            accounts: vec![],
            local: LocalRuntimeView {
                cli: CliInfo {
                    tool: CliTool::Ollama,
                    installed: false,
                    path: None,
                    version: None,
                    supported: false,
                },
                running: false,
                models: vec![],
                default_model: None,
            },
        },
        features: FeatureFlags {
            copilot: false,
            council: false,
            screen_context: false,
            behaviour_metrics: false,
        },
        // shortcut: fixed prefs until the native services read the macOS locale (first-run feature).
        prefs: UiPrefs {
            time_format: TimeFormat::H24,
            first_weekday: 1,
            time_zone: "UTC".into(),
        },
        proposals: ProposalCounts {
            version: v1,
            waiting: 0,
            needs_attention: 0,
        },
        banners: BannerSet {
            version: v1,
            banners: vec![],
        },
        environment: EnvironmentState {
            version: v1,
            displays: vec![],
            output_route: OutputRoute::Unknown,
            output_device: None,
            permissions,
            notifications: NotificationAuth::NotDetermined,
            online: true,
            update: None,
            disk_free_mb: 0,
        },
    }
}

/// A whole-state payload: the full state of one kind and its `version`.
pub(crate) trait WholeState: Serialize + Clone {
    fn version(&mut self) -> &mut StateVersion;
}

impl WholeState for BannerSet {
    fn version(&mut self) -> &mut StateVersion {
        &mut self.version
    }
}

impl WholeState for DegradedSet {
    fn version(&mut self) -> &mut StateVersion {
        &mut self.version
    }
}

impl WholeState for PresentingState {
    fn version(&mut self) -> &mut StateVersion {
        &mut self.version
    }
}
