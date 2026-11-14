//! App-level state every window renders from (`app_snapshot`), and the whole-state
//! payloads with their versions.

use noter_protocol::ipc::{event_names, Caller, CommandCtx};
use noter_protocol::model::*;
use noter_protocol::*;
use serde::Serialize;

use crate::Core;

// @cpt-dod:cpt-noter-dod-core-ipc-host-snapshot:p1
pub(super) fn app_snapshot(core: &Core, ctx: &CommandCtx) -> AppSnapshot {
    // @cpt-begin:cpt-noter-flow-core-ipc-host-window-open:p1:inst-app-snapshot
    let mut snapshot = core.app().clone();
    snapshot.accounts = core.accounts.view();
    snapshot.window = match ctx.caller {
        Caller::Window { label } => label,
        Caller::Native { .. } => WindowLabel::Main,
    };
    // @cpt-end:cpt-noter-flow-core-ipc-host-window-open:p1:inst-app-snapshot
    snapshot
}

// @cpt-flow:cpt-noter-flow-core-ipc-host-banner-dismiss:p1
pub(super) async fn banner_dismiss(
    core: &Core,
    args: BannerDismissArgs,
) -> Result<BannerSet, CoreError> {
    if args.banner == BannerKind::RecordingInterruptedByQuit {
        // The call the banner offered to resume ends at its last audio.
        core.drop_interrupted()?;
    }
    // @cpt-begin:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-dismiss
    let mut app = core.app();
    let before = app.banners.banners.len();
    // @cpt-end:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-dismiss
    // @cpt-begin:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-remove-banner
    app.banners.banners.retain(|b| b.kind() != args.banner);
    if app.banners.banners.len() == before {
        return Ok(app.banners.clone());
    }
    // @cpt-end:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-remove-banner
    // @cpt-begin:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-emit-banners
    let set = core.publish(event_names::BANNERS_CHANGED, &mut app.banners);
    // @cpt-end:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-emit-banners
    // @cpt-begin:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-return-banners
    Ok(set)
    // @cpt-end:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-return-banners
}

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

/// Stamps a whole-state payload with the next version of its kind and sends it.
// @cpt-algo:cpt-noter-algo-core-ipc-host-version:p1
pub(crate) fn publish<T: WholeState>(
    events: &dyn crate::EventEmitter,
    event: &'static str,
    state: &mut T,
) -> T {
    // @cpt-begin:cpt-noter-algo-core-ipc-host-version:p1:inst-increment
    // The counter is the slice's own version: 1 at core start, kept in memory.
    let next = StateVersion(state.version().0 + 1);
    // @cpt-end:cpt-noter-algo-core-ipc-host-version:p1:inst-increment
    // @cpt-begin:cpt-noter-algo-core-ipc-host-version:p1:inst-stamp
    *state.version() = next;
    let stamped = state.clone();
    // @cpt-end:cpt-noter-algo-core-ipc-host-version:p1:inst-stamp
    // @cpt-begin:cpt-noter-algo-core-ipc-host-version:p1:inst-emit-event
    events.emit(event, crate::to_json(&stamped));
    // @cpt-end:cpt-noter-algo-core-ipc-host-version:p1:inst-emit-event
    // @cpt-begin:cpt-noter-algo-core-ipc-host-version:p1:inst-return-version
    stamped
    // @cpt-end:cpt-noter-algo-core-ipc-host-version:p1:inst-return-version
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

impl WholeState for PrivacyStatus {
    fn version(&mut self) -> &mut StateVersion {
        &mut self.version
    }
}

impl WholeState for PresentingState {
    fn version(&mut self) -> &mut StateVersion {
        &mut self.version
    }
}
