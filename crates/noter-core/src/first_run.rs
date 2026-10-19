//! First run (`docs/features/core/core-first-run.md`): the setup status and its choices,
//! permissions asked through [`NativeServices`], the environment, the login item, the
//! detection rule and `update_install`. Setup state is stored under the settings key `setup`
//! and never bumps the settings revision; the call display and audio storage are settings
//! sections written through the settings path (decision D2).

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Weak};

use noter_db::rusqlite::params;
use noter_db::{Logged, Store};
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::{event_names, CommandCtx};
use noter_protocol::model::*;
use noter_protocol::*;
use serde::{Deserialize, Serialize};

use crate::app::WholeState;
use crate::{internal, lock, settings, Core};

/// A boxed future, so the seams stay object-safe.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// What the Mac reports for `EnvironmentState`; the core adds permissions and the update.
#[derive(Debug, Clone, PartialEq)]
pub struct EnvironmentReading {
    pub displays: Vec<DisplayInfo>,
    pub output_device: Option<OutputDeviceInfo>,
    pub output_route: OutputRoute,
    pub notifications: NotificationAuth,
    pub online: bool,
    pub disk_free_mb: u32,
}

impl Default for EnvironmentReading {
    fn default() -> Self {
        Self {
            displays: vec![],
            output_device: None,
            output_route: OutputRoute::Unknown,
            notifications: NotificationAuth::NotDetermined,
            online: true,
            disk_free_mb: 0,
        }
    }
}

/// macOS services (`noter-native` in the app, a scripted Mac in the harness).
pub trait NativeServices: Send + Sync {
    /// The permission's state, without prompting. System audio is never asked here.
    fn permission(&self, kind: PermissionKind) -> PermissionState;
    /// Shows the macOS prompt; resolves with the answer.
    fn request_permission(&self, kind: PermissionKind) -> BoxFuture<'_, PermissionState>;
    fn environment(&self) -> EnvironmentReading;
    /// Calls `on_change` with each new reading (displays, route, reachability, disk…).
    fn on_change(&self, on_change: Box<dyn Fn(EnvironmentReading) + Send + Sync>) {
        let _ = on_change;
    }
    fn set_login_item(&self, on: bool) -> Result<(), CoreError>;
}

/// One pinned model bundle of the compiled-in manifest: the files of one model folder at a
/// pinned commit, each verified by its own sha256 (decision D12).
#[derive(Debug, Clone, PartialEq)]
pub struct BundleSpec {
    pub name: String,
    pub files: Vec<BundleFile>,
    pub required_for_capture: bool,
}

/// One file of a bundle, at `path` inside the bundle's folder.
#[derive(Debug, Clone, PartialEq)]
pub struct BundleFile {
    pub path: String,
    pub url: String,
    pub size_bytes: u64,
    pub sha256: String,
}

impl BundleSpec {
    pub fn size_bytes(&self) -> u64 {
        self.files.iter().map(|f| f.size_bytes).sum()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum FetchError {
    Offline,
    Http(u16),
    Io(String),
}

/// Receives a fetched bundle's bytes; returns false to stop (pause).
pub type ChunkSink<'a> = Box<dyn FnMut(&[u8]) -> bool + Send + 'a>;

/// Where model bundles come from (pinned URLs in the app, tiny bundles in the harness).
pub trait ModelSource: Send + Sync {
    fn manifest(&self) -> Vec<BundleSpec>;
    /// Streams one file of a bundle from `from_byte`; `chunk` returns false to stop (pause).
    fn fetch<'a>(
        &'a self,
        file: &'a BundleFile,
        from_byte: u64,
        chunk: ChunkSink<'a>,
    ) -> BoxFuture<'a, Result<(), FetchError>>;
}

/// The app updater (`tauri-plugin-updater` in the app).
pub trait Updater: Send + Sync {
    /// A downloaded and verified update, if any.
    fn ready(&self) -> Option<UpdateInfo>;
    /// Installs the downloaded update without relaunching.
    fn install(&self) -> BoxFuture<'_, Result<(), CoreError>>;
    /// Relaunches Noter after an install and the core's shutdown.
    fn relaunch(&self) {}
}

/// No Mac: nothing granted, an empty environment (tests and hosts without native services).
pub(crate) struct NoNative;

impl NativeServices for NoNative {
    fn permission(&self, _: PermissionKind) -> PermissionState {
        PermissionState::NotAsked
    }
    fn request_permission(&self, _: PermissionKind) -> BoxFuture<'_, PermissionState> {
        Box::pin(async { PermissionState::NotAsked })
    }
    fn environment(&self) -> EnvironmentReading {
        EnvironmentReading::default()
    }
    fn set_login_item(&self, _: bool) -> Result<(), CoreError> {
        Ok(())
    }
}

pub(crate) struct NoModels;

impl ModelSource for NoModels {
    fn manifest(&self) -> Vec<BundleSpec> {
        vec![]
    }
    fn fetch<'a>(
        &'a self,
        _: &'a BundleFile,
        _: u64,
        _: ChunkSink<'a>,
    ) -> BoxFuture<'a, Result<(), FetchError>> {
        Box::pin(async { Err(FetchError::Offline) })
    }
}

pub(crate) struct NoUpdater;

impl Updater for NoUpdater {
    fn ready(&self) -> Option<UpdateInfo> {
        None
    }
    fn install(&self) -> BoxFuture<'_, Result<(), CoreError>> {
        Box::pin(async { Err(CoreError::new(ErrorCode::NotFound, "no updater")) })
    }
}

impl WholeState for SetupStatus {
    fn version(&mut self) -> &mut StateVersion {
        &mut self.version
    }
}

impl WholeState for EnvironmentState {
    fn version(&mut self) -> &mut StateVersion {
        &mut self.version
    }
}

const ALL_STEPS: [SetupStep; 6] = [
    SetupStep::Welcome,
    SetupStep::Models,
    SetupStep::Permissions,
    SetupStep::CallDisplay,
    SetupStep::AudioStorage,
    SetupStep::Assistants,
];

const ALL_PERMISSIONS: [PermissionKind; 7] = [
    PermissionKind::Microphone,
    PermissionKind::SystemAudio,
    PermissionKind::Calendar,
    PermissionKind::Notifications,
    PermissionKind::ScreenRecording,
    PermissionKind::AutomationTerminal,
    PermissionKind::AutomationBrowser,
];

/// The settings key of the stored setup state.
const SETUP_KEY: &str = "setup";

/// The setup state as stored under `setup`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Stored {
    pub(crate) steps: Vec<StepRow>,
    pub(crate) self_test: SelfTestState,
    /// System Audio Recording as the last short engine test (F1) inferred it.
    #[serde(default)]
    pub(crate) system_audio: Option<PermissionState>,
}

impl Default for Stored {
    fn default() -> Self {
        Self {
            steps: ALL_STEPS
                .iter()
                .map(|&step| StepRow {
                    step,
                    state: StepState::Todo,
                })
                .collect(),
            self_test: SelfTestState::NotRun,
            system_audio: None,
        }
    }
}

/// First run's own state: what is stored, plus the settings values it follows (cached so a
/// settings hook never takes the settings lock again).
pub(crate) struct State {
    pub(crate) stored: Stored,
    /// A self-test is running (shown, never stored).
    pub(crate) self_test_running: bool,
    pub(crate) offer_to_record: bool,
    call_display: Option<DisplayId>,
    /// An install waits for the capture to stop.
    install_pending: bool,
    /// A system-audio re-check (D-19) runs, or when the last one ended.
    pub(crate) probing: bool,
    pub(crate) last_probe: Option<std::time::Instant>,
}

pub(crate) fn load(store: &Store, settings: &Settings) -> Result<State, CoreError> {
    let row: Option<String> = store.read(|c| {
        c.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [SETUP_KEY],
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            noter_db::rusqlite::Error::QueryReturnedNoRows => Ok(None),
            e => Err(e),
        })
    })?;
    let stored = row
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default();
    Ok(State {
        stored,
        self_test_running: false,
        offer_to_record: settings.general.offer_to_record,
        call_display: settings.call_screen.display_id.clone(),
        install_pending: false,
        probing: false,
        last_probe: None,
    })
}

// @cpt-algo:cpt-noter-algo-core-first-run-detection-rule:p1
/// Whether call detection runs, and whether `SetupIncomplete` belongs in the degraded set.
/// It never affects `capture_start` (O1).
pub fn detection(offer_to_record: bool, self_test: &SelfTestState) -> (bool, bool) {
    let passed = matches!(self_test, SelfTestState::Passed { .. });
    // @cpt-begin:cpt-noter-algo-core-first-run-detection-rule:p1:inst-if-detect
    if offer_to_record && passed {
        // @cpt-begin:cpt-noter-algo-core-first-run-detection-rule:p1:inst-detect-on
        return (true, false);
        // @cpt-end:cpt-noter-algo-core-first-run-detection-rule:p1:inst-detect-on
    }
    // @cpt-end:cpt-noter-algo-core-first-run-detection-rule:p1:inst-if-detect
    // @cpt-begin:cpt-noter-algo-core-first-run-detection-rule:p1:inst-detect-off
    // @cpt-begin:cpt-noter-algo-core-first-run-detection-rule:p1:inst-return-detection
    (false, !passed)
    // @cpt-end:cpt-noter-algo-core-first-run-detection-rule:p1:inst-return-detection
    // @cpt-end:cpt-noter-algo-core-first-run-detection-rule:p1:inst-detect-off
}

/// System Audio Recording cannot be queried: a passed self-test means granted, only zeros
/// means off; otherwise the short engine test's inference (F1), if any.
pub(crate) fn system_audio(stored: &Stored) -> PermissionState {
    // The newest finding wins: a probe or prompt after the self-test, until the next self-test.
    if let Some(heard) = stored.system_audio {
        return heard;
    }
    match &stored.self_test {
        SelfTestState::Passed { .. } => PermissionState::Granted,
        SelfTestState::Failed {
            reason: SelfTestFailure::ZeroBuffers,
        } => PermissionState::Denied,
        _ => PermissionState::NotAsked,
    }
}

impl Core {
    /// Starts first run's reactions: the login item and the detection rule follow settings
    /// (decision D7), environment changes are broadcast. The host calls it once after `open`.
    pub fn start_first_run(self: &Arc<Self>) {
        let _ = self.this.set(Arc::downgrade(self));
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            let _ = self.runtime.set(runtime);
        }
        let weak: Weak<Core> = Arc::downgrade(self);
        self.on_settings_changed(move |section| {
            if let Some(core) = weak.upgrade() {
                core.settings_section_changed(section);
            }
        });
        let weak = Arc::downgrade(self);
        self.deps.native.on_change(Box::new(move |reading| {
            if let Some(core) = weak.upgrade() {
                core.native_changed(reading);
            }
        }));
        let launch = lock(&self.settings).general.launch_at_login;
        self.apply_login_item(launch);
        self.environment_changed(self.deps.native.environment());
    }

    fn apply_login_item(&self, on: bool) {
        if let Err(e) = self.deps.native.set_login_item(on) {
            self.log(crate::object(serde_json::json!({
                "level": "warn", "module": "first_run", "message": format!("login item: {}", e.message)
            })));
        }
    }

    /// This core as an `Arc`, for spawned tasks; `None` before `start_first_run`.
    pub(crate) fn this(&self) -> Option<Arc<Core>> {
        self.this.get().and_then(Weak::upgrade)
    }

    /// Runs inside the settings write (settings lock held): uses the section, never the lock.
    fn settings_section_changed(&self, section: &SettingsSection) {
        match section {
            SettingsSection::General(g) => {
                let self_test = {
                    let mut fr = lock(&self.first_run);
                    fr.offer_to_record = g.offer_to_record;
                    fr.stored.self_test.clone()
                };
                self.apply_login_item(g.launch_at_login);
                // The engine hears the new detection rule (settings never calls first run back).
                let (on, _) = detection(g.offer_to_record, &self_test);
                if let Some(core) = self.this() {
                    self.spawn(async move { core.send_detection(on).await });
                }
            }
            SettingsSection::CallScreen(c) => {
                lock(&self.first_run).call_display = c.display_id.clone();
            }
            _ => return,
        }
        self.refresh_setup();
    }

    /// A new reading from the Mac: `env:changed` when it differs, and the permission rows of
    /// the setup status follow.
    pub fn environment_changed(&self, reading: EnvironmentReading) {
        self.refresh_environment(reading);
        self.refresh_setup();
    }

    /// Re-reads the environment (permission rows included) from the Mac.
    pub(crate) fn refresh_environment_now(&self) {
        self.refresh_environment(self.deps.native.environment());
    }

    /// A change notice from macOS: the new reading, a system-audio re-check (D-19) and, back
    /// online, the downloads the network stopped.
    pub(crate) fn native_changed(&self, reading: EnvironmentReading) {
        self.environment_changed(reading.clone());
        self.recheck_system_audio();
        self.resume_downloads_online(&reading);
    }

    fn permission_rows(&self, stored: &Stored) -> Vec<PermissionRow> {
        ALL_PERMISSIONS
            .iter()
            .map(|&kind| PermissionRow {
                kind,
                state: if kind == PermissionKind::SystemAudio {
                    system_audio(stored)
                } else {
                    self.deps.native.permission(kind)
                },
            })
            .collect()
    }

    // @cpt-algo:cpt-noter-algo-core-first-run-status:p1
    fn refresh_environment(&self, reading: EnvironmentReading) {
        let stored = lock(&self.first_run).stored.clone();
        let headphones = lock(&self.settings).audio.output.headphones_devices.clone();
        // @cpt-begin:cpt-noter-algo-core-first-run-status:p1:inst-build-env
        let output_device = reading.output_device.map(|mut d| {
            d.marked_headphones = headphones.contains(&d.uid);
            d
        });
        let output_route = match &output_device {
            Some(d) if d.marked_headphones => OutputRoute::Headphones,
            _ => reading.output_route,
        };
        let mut app = self.app();
        let next = EnvironmentState {
            version: app.environment.version,
            displays: reading.displays,
            output_route,
            output_device,
            permissions: self.permission_rows(&stored),
            notifications: reading.notifications,
            online: reading.online,
            update: self.deps.updater.ready(),
            disk_free_mb: reading.disk_free_mb,
        };
        // @cpt-end:cpt-noter-algo-core-first-run-status:p1:inst-build-env
        // @cpt-begin:cpt-noter-algo-core-first-run-status:p1:inst-emit-changes
        if next != app.environment {
            app.environment = next;
            self.publish(event_names::ENV_CHANGED, &mut app.environment);
        }
    }

    /// Recomputes the setup status and the degraded set; sends `setup:changed` when it changed.
    pub(crate) fn refresh_setup(&self) {
        self.refresh_setup_with(false);
    }

    /// `announce`: send `setup:changed` even when nothing changed (a re-check ended).
    pub(crate) fn refresh_setup_with(&self, announce: bool) {
        let (stored, offer, call_display) = {
            let s = lock(&self.first_run);
            let mut stored = s.stored.clone();
            if s.self_test_running {
                stored.self_test = SelfTestState::Running;
            }
            (stored, s.offer_to_record, s.call_display.clone())
        };
        // @cpt-begin:cpt-noter-algo-core-first-run-status:p1:inst-build-setup
        let (detection_enabled, incomplete) = detection(offer, &stored.self_test);
        let complete = stored
            .steps
            .iter()
            .all(|r| matches!(r.state, StepState::Done | StepState::Skipped));
        let permissions = self.permission_rows(&stored);
        let models = lock(&self.downloads).status();
        let mut app = self.app();
        let next = SetupStatus {
            version: app.setup.version,
            complete,
            steps: stored.steps,
            models,
            permissions,
            self_test: stored.self_test,
            call_display,
            detection_enabled,
        };
        // @cpt-end:cpt-noter-algo-core-first-run-status:p1:inst-build-setup
        if announce || next != app.setup {
            app.setup = next;
            self.publish(event_names::SETUP_CHANGED, &mut app.setup);
        }
        let has = app
            .degraded
            .states
            .contains(&DegradedState::SetupIncomplete);
        drop(app);
        if incomplete != has {
            let mut states = self.app().degraded.states.clone();
            states.retain(|s| *s != DegradedState::SetupIncomplete);
            if incomplete {
                states.push(DegradedState::SetupIncomplete);
            }
            self.set_degraded(states);
        }
        // @cpt-end:cpt-noter-algo-core-first-run-status:p1:inst-emit-changes
    }

    /// Sets the self-test state as `harness.world_set` seeds it (feature `harness`).
    /// shortcut: in memory only, not stored under `setup`; store it if a harness restart needs it.
    #[cfg(feature = "harness")]
    pub(crate) fn seed_self_test(&self, state: SelfTestState) {
        let mut fr = lock(&self.first_run);
        fr.stored.self_test = state;
        fr.stored.system_audio = None;
        drop(fr);
        self.refresh_environment(self.deps.native.environment());
        self.refresh_setup();
    }

    // @cpt-dod:cpt-noter-dod-core-first-run-status:p1
    // @cpt-begin:cpt-noter-algo-core-first-run-status:p1:inst-return-status
    pub(crate) fn setup_now(&self) -> SetupStatus {
        self.refresh_setup();
        self.app().setup.clone()
    }
    // @cpt-end:cpt-noter-algo-core-first-run-status:p1:inst-return-status

    /// Writes the stored setup state (never the settings revision).
    /// The caller holds the first-run lock across its read-modify-write.
    pub(crate) fn store_setup(
        &self,
        ctx: &CommandCtx,
        before: &Stored,
        stored: &Stored,
        command: &str,
    ) -> Result<(), CoreError> {
        let before = serde_json::to_value(before).map_err(internal)?;
        let after = serde_json::to_value(stored).map_err(internal)?;
        let meta = self.change_meta(ctx, "Changed setup".into(), command);
        self.store().write_with(meta, move |tx| {
            tx.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                params![SETUP_KEY, after.to_string()],
            )
            .map_err(internal)?;
            let logged = Logged {
                entity_type: "setting",
                entity_id: "settings".into(),
                field: Some(SETUP_KEY.into()),
                before: Some(before.to_string()),
                after: Some(after.to_string()),
                delta: None,
            };
            Ok(((), vec![logged]))
        })?;
        Ok(())
    }

    // @cpt-flow:cpt-noter-flow-core-first-run-choices:p2
    pub(crate) fn set_step(
        &self,
        ctx: &CommandCtx,
        args: StepArgs,
    ) -> Result<SetupStatus, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-first-run-choices:p2:inst-choice-call
        // Decision D10: the Assistants step may be marked done or skipped in M0; connecting an
        // assistant is M3.
        let mut state = lock(&self.first_run);
        let mut stored = state.stored.clone();
        for row in stored.steps.iter_mut().filter(|r| r.step == args.step) {
            row.state = args.state;
        }
        // @cpt-begin:cpt-noter-state-core-first-run-self-test:p1:inst-st-skipped
        // Skipping the Permissions step before any self-test skips the test (detection stays off).
        if args.step == SetupStep::Permissions
            && args.state == StepState::Skipped
            && stored.self_test == SelfTestState::NotRun
        {
            stored.self_test = SelfTestState::Skipped;
        }
        // @cpt-end:cpt-noter-state-core-first-run-self-test:p1:inst-st-skipped
        // @cpt-end:cpt-noter-flow-core-first-run-choices:p2:inst-choice-call
        self.store_setup(ctx, &state.stored, &stored, "setup_set_step")?;
        state.stored = stored;
        drop(state);
        // @cpt-begin:cpt-noter-flow-core-first-run-choices:p2:inst-recompute
        // @cpt-begin:cpt-noter-flow-core-first-run-choices:p2:inst-return-choice
        Ok(self.setup_now())
        // @cpt-end:cpt-noter-flow-core-first-run-choices:p2:inst-return-choice
        // @cpt-end:cpt-noter-flow-core-first-run-choices:p2:inst-recompute
    }

    pub(crate) fn set_call_display(
        &self,
        ctx: &CommandCtx,
        args: CallDisplayArgs,
    ) -> Result<SetupStatus, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-first-run-choices:p2:inst-validate-display
        if let Some(id) = &args.display_id {
            let displays = self.deps.native.environment().displays;
            if !displays.iter().any(|d| &d.id == id) {
                return Err(settings::invalid("display_id", ValidationRule::OutOfRange));
            }
        }
        // @cpt-end:cpt-noter-flow-core-first-run-choices:p2:inst-validate-display
        let mut settings = lock(&self.settings);
        let mut call_screen = settings.call_screen.clone();
        call_screen.display_id = args.display_id;
        self.write_choice(
            ctx,
            &mut settings,
            SettingsSection::CallScreen(call_screen),
            "setup_set_call_display",
        )?;
        drop(settings);
        Ok(self.setup_now())
    }

    pub(crate) fn set_audio_storage(
        &self,
        ctx: &CommandCtx,
        args: AudioStorageArgs,
    ) -> Result<SetupStatus, CoreError> {
        // Decision D8 F2: "never store" wins; storing with a NeverStore retention contradicts.
        let retention = match (args.never_store_audio, args.retention) {
            (true, _) => AudioRetention::NeverStore,
            (false, AudioRetention::NeverStore) => {
                return Err(settings::invalid("retention", ValidationRule::OutOfRange))
            }
            (false, r) => r,
        };
        let mut settings = lock(&self.settings);
        let mut audio = settings.audio.clone();
        audio.retention = retention;
        self.write_choice(
            ctx,
            &mut settings,
            SettingsSection::Audio(audio),
            "setup_set_audio_storage",
        )?;
        drop(settings);
        Ok(self.setup_now())
    }

    /// A choice that lives in a settings section: the settings write path, the next settings
    /// revision and `settings:changed` (decision D2).
    fn write_choice(
        &self,
        ctx: &CommandCtx,
        settings: &mut Settings,
        section: SettingsSection,
        command: &str,
    ) -> Result<(), CoreError> {
        // @cpt-begin:cpt-noter-flow-core-first-run-choices:p2:inst-write-choice
        let rev = self.write_section(ctx, settings, &section, None, command)?;
        self.settings_written(settings, section, rev);
        // @cpt-end:cpt-noter-flow-core-first-run-choices:p2:inst-write-choice
        Ok(())
    }

    // @cpt-flow:cpt-noter-flow-core-first-run-permission:p1
    pub(crate) async fn request_permission(
        &self,
        ctx: &CommandCtx,
        args: PermissionArgs,
    ) -> Result<PermissionRow, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-first-run-permission:p1:inst-permission-call
        let kind = args.kind;
        // @cpt-end:cpt-noter-flow-core-first-run-permission:p1:inst-permission-call
        // @cpt-begin:cpt-noter-flow-core-first-run-permission:p1:inst-if-system-audio
        // A permission already off is not asked again (macOS shows no second prompt).
        let current = if kind == PermissionKind::SystemAudio {
            system_audio(&lock(&self.first_run).stored)
        } else {
            self.deps.native.permission(kind)
        };
        let state = if current == PermissionState::Denied
            || (kind == PermissionKind::SystemAudio && current == PermissionState::Granted)
        {
            current
        } else if kind == PermissionKind::SystemAudio {
            // @cpt-begin:cpt-noter-flow-core-first-run-permission:p1:inst-system-audio
            // Decision F1: the engine opens the tap briefly (macOS prompts); what it heard is
            // the inference until a full self-test decides.
            let heard = self.prompt_system_audio().await;
            let mut fr = lock(&self.first_run);
            if heard != PermissionState::NotAsked && fr.stored.system_audio != Some(heard) {
                let mut stored = fr.stored.clone();
                stored.system_audio = Some(heard);
                if self
                    .store_setup(ctx, &fr.stored, &stored, "permission_request")
                    .is_ok()
                {
                    fr.stored = stored;
                }
            }
            system_audio(&fr.stored)
            // @cpt-end:cpt-noter-flow-core-first-run-permission:p1:inst-system-audio
        } else {
            self.deps.native.request_permission(kind).await
        };
        // @cpt-end:cpt-noter-flow-core-first-run-permission:p1:inst-if-system-audio
        // @cpt-begin:cpt-noter-flow-core-first-run-permission:p1:inst-emit-permission
        self.environment_changed(self.deps.native.environment());
        // @cpt-end:cpt-noter-flow-core-first-run-permission:p1:inst-emit-permission
        // @cpt-begin:cpt-noter-flow-core-first-run-permission:p1:inst-if-denied
        if state == PermissionState::Denied {
            return Err(
                CoreError::new(ErrorCode::PermissionDenied, format!("{kind:?} denied"))
                    .with_detail(ErrorDetail::Permission { kind }),
            );
        }
        // @cpt-end:cpt-noter-flow-core-first-run-permission:p1:inst-if-denied
        // @cpt-begin:cpt-noter-flow-core-first-run-permission:p1:inst-return-permission
        Ok(PermissionRow { kind, state })
        // @cpt-end:cpt-noter-flow-core-first-run-permission:p1:inst-return-permission
    }

    // @cpt-flow:cpt-noter-flow-core-first-run-update:p2
    pub(crate) async fn install_update(&self) -> Result<Ack, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-first-run-update:p2:inst-update-call
        // @cpt-begin:cpt-noter-flow-core-first-run-update:p2:inst-if-no-update
        // Decision D8 F3: an update must be ready before the recording state matters.
        if !self.deps.updater.ready().is_some_and(|u| u.ready) {
            return Err(CoreError::new(ErrorCode::NotFound, "no update is ready"));
        }
        // @cpt-end:cpt-noter-flow-core-first-run-update:p2:inst-if-no-update
        // @cpt-end:cpt-noter-flow-core-first-run-update:p2:inst-update-call
        // @cpt-begin:cpt-noter-flow-core-first-run-update:p2:inst-if-recording
        if self.app().capture.phase != CapturePhase::Idle {
            // shortcut: capture (M1) installs it on the next stop from `install_pending`.
            lock(&self.first_run).install_pending = true;
            return Ok(Ack {});
        }
        // @cpt-end:cpt-noter-flow-core-first-run-update:p2:inst-if-recording
        // Install first: a failed install leaves the core running. Then shut down in order
        // and relaunch into the new version.
        // @cpt-begin:cpt-noter-flow-core-first-run-update:p2:inst-install
        self.deps.updater.install().await?;
        self.shutdown().await;
        self.deps.updater.relaunch();
        // @cpt-end:cpt-noter-flow-core-first-run-update:p2:inst-install
        // @cpt-begin:cpt-noter-flow-core-first-run-update:p2:inst-return-update
        Ok(Ack {})
        // @cpt-end:cpt-noter-flow-core-first-run-update:p2:inst-return-update
    }
}
