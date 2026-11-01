//! noter-core: the composition root. [`Core`] implements `CoreApi` for the IPC host
//! (`apps/desktop/src-tauri`) and `noter-core-harness`; neither depends on Tauri here.
//! Every later feature plugs its service in through [`CoreDeps`] and this crate.

mod accounts;
mod app;
mod archive;
mod capture;
mod chunks;
mod first_run;
mod glossary;
mod handoff;
mod history;
mod hotkeys;
mod hub;
mod items;
mod jobs;
mod library;
mod log;
mod merge;
mod models;
mod native_ops;
mod notices;
mod notify;
mod playback;
mod postcall;
mod recovery;
mod self_test;
mod settings;
mod share;
mod speakers;
mod surfaces;
#[cfg(feature = "harness")]
pub mod testing;
mod today;
mod transcript;
mod tray;

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use noter_db::{ChangeMeta, Direction, Migration, OpenError, Store};
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Map, Value};

use app::WholeState;
pub use capture::{CaptureEvent, Surfaces};
pub use first_run::{
    detection, BoxFuture, BundleFile, BundleSpec, CalendarAttendee, CalendarEvent, ChunkSink,
    EnvironmentReading, FetchError, ModelSource, NativeServices, Updater,
};
pub use hotkeys::{ShortcutRegistrar, ShortcutTaken, DEFAULT_HOTKEYS};
use hub::AnyHub;
pub use hub::{StreamHub, StreamMsg, Subscribed, LAG_LIMIT};
pub use models::PinnedModels;
pub use native_ops::{ClipboardText, LaunchRequest, NativeOps, SaveKind};
pub use noter_jobs::{PowerSource, Request, Trigger};
/// The one model-download allow-list check: noter-llm's, the egress gate (decision D14).
pub use noter_llm::allowed_download_url;
pub use noter_llm::{
    Adapters, CliConfig, KeychainLocked, Llm, MemorySecrets, OllamaConfig, Scripted, Secret,
    SecretStore,
};
use noter_protocol::ipc::Sink;
pub use notify::{Notification, NotificationKind};
pub use settings::default_settings;
pub use surfaces::Placement;
pub use tray::{TrayAction, TrayEntry, TrayGlyph, TrayItem, TrayModel};

/// `~/Library/Application Support/Noter`: where the app keeps `noter.db` and `logs/`.
pub fn default_data_dir() -> Option<std::path::PathBuf> {
    noter_db::default_path()?.parent().map(Path::to_path_buf)
}

/// Time as the core sees it (a fixed clock in tests and the harness).
pub trait Clock: Send + Sync {
    fn now(&self) -> TimestampMs;
}

/// The wall clock.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> TimestampMs {
        let since = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        TimestampMs(since.as_millis() as i64)
    }
}

/// Where events go: Tauri's `emit` in the app, event lines in the harness. Names come from
/// `event_names`. Called while the core holds the state's lock, so it must not call back into it.
pub trait EventEmitter: Send + Sync {
    fn emit(&self, event: &'static str, payload: Value);
}

/// What the core needs from its host. Later features add their seams here (shortcuts,
/// native services, model source, updater, engine launcher).
#[derive(Clone)]
pub struct CoreDeps {
    pub clock: Arc<dyn Clock>,
    pub events: Arc<dyn EventEmitter>,
    /// The app's version as the host knows it (`app_snapshot.app_version`); `dev` until set.
    pub app_version: String,
    /// Global shortcuts; accepts every chord until the host sets its own (`with_shortcuts`).
    pub shortcuts: Arc<dyn ShortcutRegistrar>,
    /// Permissions, environment and the login item (`noter-native` in the app).
    pub native: Arc<dyn NativeServices>,
    /// Model bundles to download (the pinned manifest in the app).
    pub models: Arc<dyn ModelSource>,
    /// Downloaded app updates (`tauri-plugin-updater` in the app).
    pub updater: Arc<dyn Updater>,
    /// Where model bundles go (the App Group container's `models/`); `<data>/models` if unset.
    pub models_dir: Option<std::path::PathBuf>,
    /// Starts the engine (`ProcessLauncher` in the app, a scripted engine in the harness, S12).
    pub engine: Arc<dyn noter_engine_client::EngineLauncher>,
    pub engine_config: noter_engine_client::Config,
    /// Record prompt and call window (AppKit in the app, recorded calls in the harness, TL-2).
    pub surfaces: Arc<dyn Surfaces>,
    /// The LLM runtimes (the locked-down CLIs and Ollama in the app, the scripted runtime in
    /// the harness and tests, TL-13); none until the host sets them.
    pub llm: Adapters,
    /// API keys (the Keychain in the app, memory in the harness and tests).
    pub secrets: Arc<dyn SecretStore>,
    /// Whether the Mac is on battery, for the jobs that do not run on it (mains power if unset).
    pub power: Arc<dyn noter_jobs::PowerSource>,
    /// Save panel and the native asks to come (`NativeOps`); every panel cancels until set.
    pub native_ops: Arc<dyn NativeOps>,
}

impl CoreDeps {
    /// The clock and events; every other seam starts empty (no Mac, no models, no updater).
    pub fn new(clock: Arc<dyn Clock>, events: Arc<dyn EventEmitter>) -> Self {
        Self {
            clock,
            events,
            app_version: "dev".into(),
            shortcuts: Arc::new(hotkeys::AcceptAll),
            native: Arc::new(first_run::NoNative),
            models: Arc::new(first_run::NoModels),
            updater: Arc::new(first_run::NoUpdater),
            models_dir: None,
            engine: Arc::new(self_test::NoEngine),
            engine_config: noter_engine_client::Config::default(),
            surfaces: Arc::new(capture::NoSurfaces),
            llm: Adapters::none(),
            secrets: Arc::new(MemorySecrets::default()),
            power: Arc::new(jobs::AcPower),
            native_ops: Arc::new(native_ops::NoNativeOps),
        }
    }

    pub fn with_power(mut self, power: Arc<dyn noter_jobs::PowerSource>) -> Self {
        self.power = power;
        self
    }

    pub fn with_llm(mut self, adapters: Adapters) -> Self {
        self.llm = adapters;
        self
    }

    pub fn with_secrets(mut self, secrets: Arc<dyn SecretStore>) -> Self {
        self.secrets = secrets;
        self
    }

    pub fn with_native_ops(mut self, ops: Arc<dyn NativeOps>) -> Self {
        self.native_ops = ops;
        self
    }

    pub fn with_surfaces(mut self, surfaces: Arc<dyn Surfaces>) -> Self {
        self.surfaces = surfaces;
        self
    }

    pub fn with_engine(mut self, engine: Arc<dyn noter_engine_client::EngineLauncher>) -> Self {
        self.engine = engine;
        self
    }

    pub fn with_engine_config(mut self, config: noter_engine_client::Config) -> Self {
        self.engine_config = config;
        self
    }

    pub fn with_app_version(mut self, version: impl Into<String>) -> Self {
        self.app_version = version.into();
        self
    }

    pub fn with_shortcuts(mut self, shortcuts: Arc<dyn ShortcutRegistrar>) -> Self {
        self.shortcuts = shortcuts;
        self
    }

    pub fn with_models_dir(mut self, dir: std::path::PathBuf) -> Self {
        self.models_dir = Some(dir);
        self
    }

    pub fn with_native(mut self, native: Arc<dyn NativeServices>) -> Self {
        self.native = native;
        self
    }

    pub fn with_models(mut self, models: Arc<dyn ModelSource>) -> Self {
        self.models = models;
        self
    }

    pub fn with_updater(mut self, updater: Arc<dyn Updater>) -> Self {
        self.updater = updater;
        self
    }
}

/// Why the core did not start.
#[derive(Debug)]
pub enum BootError {
    /// The data folder or its log could not be created.
    Io(std::io::Error),
    /// The database did not open (corrupt, migration failed, newer than this app).
    Store(OpenError),
    /// Stored state could not be read.
    Load(CoreError),
}

impl std::fmt::Display for BootError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "cannot prepare the data folder: {e}"),
            Self::Store(e) => write!(f, "{e}"),
            Self::Load(e) => write!(f, "cannot read the stored settings: {e}"),
        }
    }
}

impl std::error::Error for BootError {}

/// The core: one per process, shared by every window and native surface.
pub struct Core {
    deps: CoreDeps,
    store: Arc<Store>,
    /// The LLM router and its egress gate (`noter-llm`).
    llm: Llm,
    /// API keys and runtime availability (`accounts_get`, `api_key_set`).
    accounts: Arc<accounts::Accounts>,
    /// Pipeline jobs; `capture_guard` is the session manager's input to it.
    jobs: noter_jobs::Scheduler,
    capture_guard: tokio::sync::watch::Sender<noter_jobs::CaptureGuardState>,
    /// `noter.db`, `logs/`, `audio/` and the user's `skills/` live here.
    data_dir: std::path::PathBuf,
    log: log::Logger,
    /// The app snapshot's slices, kept whole; a window's snapshot is a copy.
    app: Mutex<AppSnapshot>,
    /// One stream hub per Channel message type, for routing acks, reloads and shutdown.
    hubs: Mutex<Vec<Arc<dyn AnyHub>>>,
    /// The settings as stored; writes hold this lock, so they apply one at a time.
    settings: Mutex<Settings>,
    /// App hotkeys and their registration status; writes hold this lock, then `settings`.
    hotkeys: Mutex<HotkeyList>,
    settings_hooks: Hooks<SettingsSection>,
    glossary_hooks: Hooks<GlossaryList>,
    /// First run's stored setup state and the settings values it follows.
    first_run: Mutex<first_run::State>,
    /// Model downloads, shown in the setup status.
    downloads: Mutex<models::Downloads>,
    /// This core, for the tasks first run spawns (set by `start_first_run`).
    this: std::sync::OnceLock<std::sync::Weak<Core>>,
    /// The async runtime first run started on, for work that macOS notices start on its own
    /// threads.
    runtime: std::sync::OnceLock<tokio::runtime::Handle>,
    /// The engine supervisor; the engine starts on first need.
    engine: self_test::Engine,
    /// The self-test's Channel messages.
    self_test_hub: std::sync::OnceLock<Arc<StreamHub<SelfTestMsg>>>,
    /// The capture machine's bookkeeping; held by each capture command while it applies.
    capture: tokio::sync::Mutex<capture::Session>,
    capture_hooks: Hooks<CaptureEvent>,
    /// The call window's state, the presenting memory and the tray the native layer shows.
    windows: Mutex<surfaces::Windows>,
    /// The capture phase as last published, for commands that wait on the engine.
    capture_phase: tokio::sync::watch::Sender<CapturePhase>,
    /// The call the main window reports it shows (`window_report_view`).
    viewed: Mutex<Option<CallId>>,
    /// Notifications waiting for the call to end, one per call.
    held: Mutex<Vec<Notification>>,
    /// Per-call audio folders (`audio/<call_id>/` beside `models/` in the App Group container).
    audio_dir: std::path::PathBuf,
    /// Replay state, `playback:state`.
    playback: playback::Playback,
    /// The live transcript: batching, streams, speakers.
    transcript: transcript::Transcript,
    /// Post-call sections being written, or failed, that have no committed row yet.
    postcall: postcall::Sections,
    /// Handoff prompts being written, and each item's wanted target.
    handoffs: noter_handoff::Generations,
}

/// Other features' callbacks for a change, run after it committed.
type Hooks<T> = Mutex<Vec<Box<dyn Fn(&T) + Send + Sync>>>;

/// noter-core's own tables: settings and the glossary, calls and their capture data.
// @cpt-dbtable:cpt-noter-dbtable-settings:p1
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        owner: "noter-core",
        version: 1,
        name: "settings and glossary",
        sql: include_str!("../migrations/0001_settings_glossary.sql"),
    },
    // @cpt-dbtable:cpt-noter-dbtable-calls:p1
    // @cpt-dbtable:cpt-noter-dbtable-speakers:p1
    // @cpt-dbtable:cpt-noter-dbtable-segments:p1
    // @cpt-dbtable:cpt-noter-dbtable-marks:p1
    // @cpt-dbtable:cpt-noter-dbtable-gaps:p1
    Migration {
        owner: "noter-core",
        version: 2,
        name: "calls and capture data",
        sql: include_str!("../migrations/0002_calls_capture.sql"),
    },
    // @cpt-dbtable:cpt-noter-dbtable-call-tags:p1
    Migration {
        owner: "noter-core",
        version: 3,
        name: "call tags",
        sql: include_str!("../migrations/0003_call_tags.sql"),
    },
    // @cpt-dbtable:cpt-noter-dbtable-items:p1
    // @cpt-dbtable:cpt-noter-dbtable-item-spans:p1
    Migration {
        owner: "noter-core",
        version: 4,
        name: "items and item spans",
        sql: include_str!("../migrations/0004_items.sql"),
    },
    // @cpt-dbtable:cpt-noter-dbtable-summaries:p1
    // @cpt-dbtable:cpt-noter-dbtable-summary-versions:p1
    Migration {
        owner: "noter-core",
        version: 5,
        name: "summaries",
        sql: include_str!("../migrations/0005_summaries.sql"),
    },
    Migration {
        owner: "noter-core",
        version: 6,
        name: "speaker names and constraints",
        sql: include_str!("../migrations/0006_speaker_constraints.sql"),
    },
    // @cpt-dbtable:cpt-noter-dbtable-chunks:p1
    Migration {
        owner: "noter-core",
        version: 7,
        name: "chunks and crosstalk",
        sql: include_str!("../migrations/0007_chunks.sql"),
    },
];

impl Core {
    /// Opens the core on `data_dir` (`noter.db`, `logs/`): the same call for the app, the
    /// harness and the tests.
    pub fn open(data_dir: &Path, deps: CoreDeps) -> Result<Core, BootError> {
        let log = log::Logger::open(data_dir).map_err(BootError::Io)?;
        let store = match Store::open(
            &data_dir.join("noter.db"),
            &[noter_db::MIGRATIONS, MIGRATIONS, noter_handoff::MIGRATIONS],
        ) {
            Ok(store) => Arc::new(store),
            Err(e) => {
                let record =
                    json!({ "level": "error", "module": "storage", "code": open_error_kind(&e) });
                let _ = log.write(object(record), deps.clock.now().0);
                return Err(BootError::Store(e));
            }
        };
        let snapshot = app::fresh_snapshot(&deps.app_version);
        let settings = settings::load(&store).map_err(BootError::Load)?;
        let first_run = first_run::load(&store, &settings).map_err(BootError::Load)?;
        let models_dir = deps
            .models_dir
            .clone()
            .unwrap_or_else(|| data_dir.join("models"));
        let audio_dir = models_dir.parent().unwrap_or(data_dir).join("audio");
        let downloads = models::Downloads::load(deps.models.manifest(), models_dir);
        let engine =
            noter_engine_client::EngineClient::new(deps.engine.clone(), deps.engine_config.clone());
        let accounts = Arc::new(
            accounts::Accounts::load(
                store.clone(),
                deps.secrets.clone(),
                deps.events.clone(),
                deps.clock.clone(),
                snapshot.accounts.clone(),
            )
            .map_err(BootError::Load)?,
        );
        let clock = deps.clock.clone();
        let revoked = Arc::downgrade(&accounts);
        let llm = Llm::new(store.clone(), deps.llm.clone(), move || clock.now())
            .with_secrets(deps.secrets.clone())
            .on_key_rejected(move |runtime, run| {
                if let Some(accounts) = revoked.upgrade() {
                    accounts.revoked(runtime, run);
                }
            });
        let (jobs, capture_guard) = jobs::build(store.clone(), &deps);
        let core = Core {
            deps,
            store,
            llm,
            accounts,
            jobs,
            capture_guard,
            data_dir: data_dir.to_path_buf(),
            log,
            app: Mutex::new(snapshot),
            hubs: Mutex::new(vec![]),
            settings: Mutex::new(settings),
            hotkeys: Mutex::new(hotkeys::fresh_list()),
            settings_hooks: Mutex::new(vec![]),
            glossary_hooks: Mutex::new(vec![]),
            first_run: Mutex::new(first_run),
            downloads: Mutex::new(downloads),
            this: std::sync::OnceLock::new(),
            runtime: std::sync::OnceLock::new(),
            engine,
            self_test_hub: std::sync::OnceLock::new(),
            capture: tokio::sync::Mutex::new(capture::Session::default()),
            capture_hooks: Mutex::new(vec![]),
            windows: Mutex::new(surfaces::Windows::default()),
            capture_phase: tokio::sync::watch::channel(CapturePhase::Idle).0,
            viewed: Mutex::new(None),
            held: Mutex::new(Vec::new()),
            audio_dir,
            playback: playback::Playback::new(),
            transcript: transcript::Transcript::new(data_dir.to_path_buf()),
            postcall: postcall::Sections::default(),
            handoffs: noter_handoff::Generations::default(),
        };
        core.start_hotkeys().map_err(BootError::Load)?;
        core.retry_audio_removals();
        core.init_call_window();
        core.refresh_tray();
        Ok(core)
    }

    /// Ends the core: every stream ends with `shutdown`, then the writer drains its queue and
    /// checkpoints. Idempotent.
    pub async fn shutdown(&self) {
        for hub in self.hubs() {
            hub.end_all(StreamEndReason::Shutdown);
        }
        self.engine.shutdown().await;
        self.store.close();
    }

    /// The store, for the services the core composes.
    pub fn store(&self) -> &Store {
        &self.store
    }

    /// The LLM router: every model call goes through it and its egress gate.
    pub fn llm(&self) -> &Llm {
        &self.llm
    }

    /// A stream hub for one Channel message type; the core routes `stream_ack`,
    /// `stream_unsubscribe`, webview reloads and shutdown to it.
    pub fn stream_hub<M: StreamMsg>(&self, coalesce_ms: Option<i64>) -> Arc<StreamHub<M>> {
        let hub = Arc::new(StreamHub::new(self.deps.clock.clone(), coalesce_ms));
        self.hubs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(hub.clone());
        hub
    }

    /// A subscribing command: the caller's window owns the subscription (a native surface owns
    /// none), and the snapshot and the Channel start come from the hub under its lock.
    // @cpt-flow:cpt-noter-flow-core-ipc-host-window-open:p1
    // @cpt-dod:cpt-noter-dod-core-ipc-host-stream-hub:p1
    pub fn subscribe<M: StreamMsg, S>(
        &self,
        hub: &StreamHub<M>,
        key: &str,
        ctx: &CommandCtx,
        channel: Sink<M>,
        snapshot: impl FnOnce() -> Result<S, CoreError>,
    ) -> Result<Subscribed<S>, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-ipc-host-window-open:p1:inst-subscribe
        let window = match ctx.caller {
            Caller::Window { label } => Some(label),
            Caller::Native { .. } => None,
        };
        // @cpt-end:cpt-noter-flow-core-ipc-host-window-open:p1:inst-subscribe
        // @cpt-begin:cpt-noter-flow-core-ipc-host-window-open:p1:inst-run-subscribe
        hub.subscribe(key, window, channel, snapshot)
        // @cpt-end:cpt-noter-flow-core-ipc-host-window-open:p1:inst-run-subscribe
    }

    /// A webview loaded a page or was destroyed (the IPC host tells the core): its
    /// subscriptions end, and the page subscribes again.
    pub fn webview_reset(&self, label: WindowLabel) {
        for hub in self.hubs() {
            hub.end_webview(label);
        }
    }

    fn hubs(&self) -> Vec<Arc<dyn AnyHub>> {
        self.hubs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// Replaces the app banners (update ready, interrupted recording, roll-up failed) and
    /// sends `banners:changed`.
    pub fn set_banners(&self, banners: Vec<AppBanner>) -> BannerSet {
        let mut app = self.app();
        app.banners.banners = banners;
        self.publish(event_names::BANNERS_CHANGED, &mut app.banners)
    }

    /// Replaces the degraded set and sends `degraded:changed`.
    pub fn set_degraded(&self, states: Vec<DegradedState>) -> DegradedSet {
        let mut app = self.app();
        app.degraded.states = states;
        self.publish(event_names::DEGRADED_CHANGED, &mut app.degraded)
    }

    /// Sends `entity:changed` for a record a service changed after its commit.
    pub fn emit_entity_changed(&self, change: &EntityChanged) {
        self.deps
            .events
            .emit(event_names::ENTITY_CHANGED, to_json(change));
    }

    /// Writes a core log record; it keeps only allow-listed fields with identifiers and numbers.
    pub fn log(&self, record: Map<String, Value>) {
        let _ = self.log.write(record, self.deps.clock.now().0);
    }

    /// Spawns on the caller's runtime, or on the one first run started on (macOS notices
    /// arrive on threads outside it); with neither, the work is dropped.
    pub(crate) fn spawn(&self, work: impl std::future::Future<Output = ()> + Send + 'static) {
        match tokio::runtime::Handle::try_current() {
            Ok(runtime) => drop(runtime.spawn(work)),
            Err(_) => {
                if let Some(runtime) = self.runtime.get() {
                    drop(runtime.spawn(work));
                }
            }
        }
    }

    /// Runs `f` inside the core's runtime when the caller is on a thread outside it (the
    /// scheduler spawns its workers on the current one).
    pub(crate) fn in_runtime<T>(&self, f: impl FnOnce() -> T) -> T {
        let _entered = match tokio::runtime::Handle::try_current() {
            Ok(_) => None,
            Err(_) => self.runtime.get().map(tokio::runtime::Handle::enter),
        };
        f()
    }

    fn app(&self) -> MutexGuard<'_, AppSnapshot> {
        self.app
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Stamps a whole-state payload with the next version of its kind and sends it.
    fn publish<T: WholeState>(&self, event: &'static str, state: &mut T) -> T {
        app::publish(&*self.deps.events, event, state)
    }
}

// @cpt-interface:cpt-noter-interface-core-ipc:p1
impl Core {
    /// Who wrote, for the change row: the user, through a window or a native surface.
    pub(crate) fn change_meta(
        &self,
        ctx: &CommandCtx,
        summary: String,
        reason: &str,
    ) -> ChangeMeta {
        let surface = match ctx.caller {
            Caller::Native { surface } => Some(surface),
            Caller::Window { .. } => None,
        };
        ChangeMeta {
            actor: Actor::You,
            summary,
            reason: reason.into(),
            evidence_ids: vec![],
            batch_id: None,
            undoable: true,
            surface,
        }
    }
}

pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl CoreApi for Core {
    async fn setup_status(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<SetupStatus, CoreError> {
        Ok(self.setup_now())
    }

    async fn setup_set_step(
        &self,
        ctx: &CommandCtx,
        args: StepArgs,
    ) -> Result<SetupStatus, CoreError> {
        self.set_step(ctx, args)
    }

    async fn setup_set_call_display(
        &self,
        ctx: &CommandCtx,
        args: CallDisplayArgs,
    ) -> Result<SetupStatus, CoreError> {
        self.set_call_display(ctx, args)
    }

    async fn setup_set_audio_storage(
        &self,
        ctx: &CommandCtx,
        args: AudioStorageArgs,
    ) -> Result<SetupStatus, CoreError> {
        self.set_audio_storage(ctx, args)
    }

    async fn permission_request(
        &self,
        ctx: &CommandCtx,
        args: PermissionArgs,
    ) -> Result<PermissionRow, CoreError> {
        self.request_permission(ctx, args).await
    }

    async fn self_test_run(
        &self,
        ctx: &CommandCtx,
        args: SelfTestArgs,
        channel: Sink<SelfTestMsg>,
    ) -> Result<SubscriptionHandle, CoreError> {
        self.start_self_test(ctx, args, channel)
    }

    async fn share_test_run(
        &self,
        _ctx: &CommandCtx,
        args: ShareTestArgs,
    ) -> Result<ShareTestResult, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-services-share-test:p1:inst-test-request
        self.share_test(args).await
        // @cpt-end:cpt-noter-flow-core-native-services-share-test:p1:inst-test-request
    }

    async fn models_download(
        &self,
        _ctx: &CommandCtx,
        args: ModelsDownloadArgs,
    ) -> Result<SetupStatus, CoreError> {
        self.download_models(args)
    }

    async fn audio_play(
        &self,
        _ctx: &CommandCtx,
        args: PlayAudioArgs,
    ) -> Result<PlaybackState, CoreError> {
        self.play_audio(args).await
    }

    async fn audio_stop(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<PlaybackState, CoreError> {
        self.stop_audio().await
    }

    async fn transcript_subscribe(
        &self,
        ctx: &CommandCtx,
        args: TranscriptSubscribeArgs,
        channel: Sink<TranscriptMsg>,
    ) -> Result<TranscriptSnapshot, CoreError> {
        let snapshot = self.subscribe_transcript(ctx, args, channel)?;
        // A live call's lines come from the engine: it runs once someone watches them.
        if snapshot.live {
            let _ = self.engine.ensure_ready().await;
        }
        Ok(snapshot)
    }

    async fn levels_subscribe(
        &self,
        ctx: &CommandCtx,
        args: SubscribeLevelsArgs,
        channel: Sink<LevelsMsg>,
    ) -> Result<SubscriptionHandle, CoreError> {
        let handle = self.subscribe_levels(ctx, args, channel)?;
        // The meters are the engine's: it runs once someone watches them.
        let _ = self.engine.ensure_ready().await;
        Ok(handle)
    }

    async fn transcript_span(
        &self,
        _ctx: &CommandCtx,
        args: SpanArgs,
    ) -> Result<SpanPreview, CoreError> {
        self.span_preview(args)
    }

    async fn transcript_rename_speaker(
        &self,
        ctx: &CommandCtx,
        args: RenameSpeakerArgs,
    ) -> Result<SpeakerMutation, CoreError> {
        self.rename_speaker(ctx, args)
    }

    async fn transcript_name_speakers(
        &self,
        ctx: &CommandCtx,
        args: NameSpeakersArgs,
    ) -> Result<SpeakerMutation, CoreError> {
        self.name_speakers(ctx, args)
    }

    async fn transcript_fix_term(
        &self,
        ctx: &CommandCtx,
        args: FixTermArgs,
    ) -> Result<FixTermResult, CoreError> {
        self.fix_term(ctx, args)
    }

    async fn update_install(&self, _ctx: &CommandCtx, _args: NoArgs) -> Result<Ack, CoreError> {
        self.install_update().await
    }

    async fn calls_list(
        &self,
        _ctx: &CommandCtx,
        args: CallsListArgs,
    ) -> Result<Page<CallRow>, CoreError> {
        self.list_calls(args)
    }

    async fn call_get(&self, _ctx: &CommandCtx, args: CallIdArgs) -> Result<CallDetail, CoreError> {
        self.get_call(args)
    }

    async fn call_update(
        &self,
        ctx: &CommandCtx,
        args: CallUpdateArgs,
    ) -> Result<CallMutation, CoreError> {
        self.update_call(ctx, args)
    }

    async fn call_types_list(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<CallTypeList, CoreError> {
        Ok(self.call_types_now())
    }

    async fn calls_delete(
        &self,
        ctx: &CommandCtx,
        args: CallsDeleteArgs,
    ) -> Result<DeleteResult, CoreError> {
        self.delete_calls(ctx, args)
    }

    async fn outputs_get(
        &self,
        _ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CallOutputs, CoreError> {
        self.outputs_now(&args.call_id)
    }

    async fn output_edit(
        &self,
        ctx: &CommandCtx,
        args: OutputEditArgs,
    ) -> Result<OutputMutation, CoreError> {
        self.edit_output(ctx, args)
    }

    async fn outputs_regenerate(
        &self,
        _ctx: &CommandCtx,
        args: RegenerateArgs,
    ) -> Result<JobAccepted, CoreError> {
        self.queue_regeneration(&args)
    }

    async fn output_versions(
        &self,
        _ctx: &CommandCtx,
        args: SummaryIdArgs,
    ) -> Result<VersionList, CoreError> {
        self.output_version_list(&args.summary_id)
    }

    async fn output_version_get(
        &self,
        _ctx: &CommandCtx,
        args: VersionGetArgs,
    ) -> Result<VersionBody, CoreError> {
        self.output_version(&args)
    }

    async fn history_list(
        &self,
        _ctx: &CommandCtx,
        args: HistoryListArgs,
    ) -> Result<Page<ChangeRow>, CoreError> {
        self.history_page(args)
    }

    async fn history_export(
        &self,
        _ctx: &CommandCtx,
        args: HistoryExportArgs,
    ) -> Result<ExportResult, CoreError> {
        self.export_history(args).await
    }

    async fn change_undo(
        &self,
        _ctx: &CommandCtx,
        args: UndoArgs,
    ) -> Result<UndoResult, CoreError> {
        self.reverse_change(Direction::Undo, args.target)
    }

    async fn change_redo(
        &self,
        _ctx: &CommandCtx,
        args: RedoArgs,
    ) -> Result<UndoResult, CoreError> {
        self.reverse_change(Direction::Redo, args.target)
    }

    async fn items_list(
        &self,
        _ctx: &CommandCtx,
        args: ItemsListArgs,
    ) -> Result<Page<ItemView>, CoreError> {
        self.list_items(args)
    }

    async fn today_get(&self, _ctx: &CommandCtx, _args: NoArgs) -> Result<TodayView, CoreError> {
        self.today_view()
    }

    async fn call_tags_set(
        &self,
        ctx: &CommandCtx,
        args: TagsSetArgs,
    ) -> Result<TagsSetResult, CoreError> {
        self.set_call_tags(ctx, args)
    }

    async fn share_copy(
        &self,
        _ctx: &CommandCtx,
        args: ShareCopyArgs,
    ) -> Result<ShareResult, CoreError> {
        self.copy_share(args).await
    }

    async fn calls_export(
        &self,
        _ctx: &CommandCtx,
        args: ExportCallsArgs,
    ) -> Result<ExportResult, CoreError> {
        self.export_calls(args).await
    }

    async fn tags_list(&self, _ctx: &CommandCtx, _args: NoArgs) -> Result<TagList, CoreError> {
        self.list_tags()
    }

    async fn item_get(&self, _ctx: &CommandCtx, args: ItemIdArgs) -> Result<ItemDetail, CoreError> {
        self.get_item(args)
    }

    async fn item_set_done(
        &self,
        ctx: &CommandCtx,
        args: ItemDoneArgs,
    ) -> Result<ItemMutation, CoreError> {
        self.set_item_done(ctx, args)
    }

    async fn item_review(
        &self,
        ctx: &CommandCtx,
        args: ItemReviewArgs,
    ) -> Result<ItemMutation, CoreError> {
        self.review_item(ctx, args)
    }

    async fn items_review_all(
        &self,
        ctx: &CommandCtx,
        args: ReviewAllArgs,
    ) -> Result<ItemsBatchResult, CoreError> {
        self.review_all_items(ctx, args)
    }

    async fn item_edit(
        &self,
        ctx: &CommandCtx,
        args: ItemEditArgs,
    ) -> Result<ItemMutation, CoreError> {
        self.edit_item(ctx, args)
    }

    async fn item_reopen(
        &self,
        ctx: &CommandCtx,
        args: ItemReopenArgs,
    ) -> Result<ItemMutation, CoreError> {
        self.reopen_item(ctx, args)
    }

    async fn item_create(
        &self,
        ctx: &CommandCtx,
        args: ItemCreateArgs,
    ) -> Result<ItemMutation, CoreError> {
        self.create_item(ctx, args)
    }

    async fn item_answer_handoff_landed(
        &self,
        ctx: &CommandCtx,
        args: HandoffLandedArgs,
    ) -> Result<ItemMutation, CoreError> {
        self.answer_handoff(ctx, args)
    }

    async fn handoff_get(
        &self,
        _ctx: &CommandCtx,
        args: ItemIdArgs,
    ) -> Result<HandoffView, CoreError> {
        self.handoff_view(args.item_id.as_str())
    }

    async fn handoff_generate(
        &self,
        _ctx: &CommandCtx,
        args: HandoffGenerateArgs,
    ) -> Result<HandoffView, CoreError> {
        self.generate_handoff(args)
    }

    async fn handoff_cancel(
        &self,
        _ctx: &CommandCtx,
        args: ItemIdArgs,
    ) -> Result<HandoffView, CoreError> {
        self.cancel_handoff(args)
    }

    async fn handoff_edit(
        &self,
        ctx: &CommandCtx,
        args: HandoffEditArgs,
    ) -> Result<HandoffView, CoreError> {
        self.edit_handoff(ctx, args)
    }

    async fn handoff_set_target(
        &self,
        _ctx: &CommandCtx,
        args: HandoffTargetArgs,
    ) -> Result<HandoffView, CoreError> {
        self.target_handoff(args)
    }

    async fn handoff_open(
        &self,
        ctx: &CommandCtx,
        args: ItemIdArgs,
    ) -> Result<HandoffOpenResult, CoreError> {
        self.open_handoff(ctx, args).await
    }

    async fn handoff_copy(
        &self,
        ctx: &CommandCtx,
        args: ItemIdArgs,
    ) -> Result<HandoffCopyResult, CoreError> {
        self.copy_handoff(ctx, args).await
    }

    async fn repos_list(&self, _ctx: &CommandCtx, _args: NoArgs) -> Result<RepoList, CoreError> {
        self.list_repos()
    }

    async fn repo_upsert(
        &self,
        ctx: &CommandCtx,
        args: RepoUpsertArgs,
    ) -> Result<RepoList, CoreError> {
        self.upsert_repo(ctx, args).await
    }

    async fn repo_remove(&self, ctx: &CommandCtx, args: RepoIdArgs) -> Result<RepoList, CoreError> {
        self.remove_repo(ctx, args)
    }

    async fn window_show_call(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<CallWindowState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-show-call
        Ok(self.show_call(true))
        // @cpt-end:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-show-call
    }

    async fn window_hide_call(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<CallWindowState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-layout-commands
        Ok(self.hide_call())
        // @cpt-end:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-layout-commands
    }

    async fn window_call_state(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<CallWindowState, CoreError> {
        Ok(self.call_window_now())
    }

    async fn window_share_warning_seen(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<CallWindowState, CoreError> {
        Ok(self.share_warning_seen())
    }

    async fn window_set_call_layout(
        &self,
        ctx: &CommandCtx,
        args: CallLayoutArgs,
    ) -> Result<CallWindowState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-layout-commands
        self.set_call_layout(ctx, args)
        // @cpt-end:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-layout-commands
    }

    async fn window_set_collapsed(
        &self,
        _ctx: &CommandCtx,
        args: CollapseArgs,
    ) -> Result<CallWindowState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-layout-commands
        Ok(self.set_call_collapsed(args.collapsed))
        // @cpt-end:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-layout-commands
    }

    async fn app_set_hidden_for_presenting(
        &self,
        _ctx: &CommandCtx,
        args: HiddenArgs,
    ) -> Result<PresentingState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-presenting-call
        Ok(self.set_hidden_for_presenting(args.hidden))
        // @cpt-end:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-presenting-call
    }

    async fn window_navigate(
        &self,
        _ctx: &CommandCtx,
        args: NavigateArgs,
    ) -> Result<Ack, CoreError> {
        self.navigate(args.target);
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-return-nav
        Ok(Ack {})
        // @cpt-end:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-return-nav
    }

    async fn window_report_view(
        &self,
        _ctx: &CommandCtx,
        args: ViewReportArgs,
    ) -> Result<Ack, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-report-view
        self.report_view(args.call_id);
        // @cpt-end:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-report-view
        Ok(Ack {})
    }

    async fn window_announce(
        &self,
        _ctx: &CommandCtx,
        args: AnnounceArgs,
    ) -> Result<Ack, CoreError> {
        self.announce(args)?;
        Ok(Ack {})
    }

    async fn open_external(
        &self,
        _ctx: &CommandCtx,
        args: OpenExternalArgs,
    ) -> Result<Ack, CoreError> {
        self.open_external(args.target)?;
        Ok(Ack {})
    }

    async fn settings_get(&self, _ctx: &CommandCtx, _args: NoArgs) -> Result<Settings, CoreError> {
        Ok(lock(&self.settings).clone())
    }

    async fn settings_update(
        &self,
        ctx: &CommandCtx,
        args: SettingsUpdateArgs,
    ) -> Result<Settings, CoreError> {
        self.update_settings(ctx, args)
    }

    async fn settings_unignore_app(
        &self,
        ctx: &CommandCtx,
        args: AppIdArgs,
    ) -> Result<Settings, CoreError> {
        self.unignore_app(ctx, args)
    }

    async fn hotkeys_list(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<HotkeyList, CoreError> {
        Ok(lock(&self.hotkeys).clone())
    }

    async fn hotkey_set(
        &self,
        ctx: &CommandCtx,
        args: HotkeySetArgs,
    ) -> Result<HotkeyList, CoreError> {
        self.set_hotkey(ctx, args)
    }

    async fn hotkeys_reset(
        &self,
        ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<HotkeyList, CoreError> {
        self.reset_hotkeys(ctx)
    }

    async fn glossary_list(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<GlossaryList, CoreError> {
        self.glossary()
    }

    async fn glossary_upsert(
        &self,
        ctx: &CommandCtx,
        args: GlossaryUpsertArgs,
    ) -> Result<GlossaryList, CoreError> {
        self.upsert_term(ctx, args)
    }

    async fn glossary_remove(
        &self,
        ctx: &CommandCtx,
        args: GlossaryIdArgs,
    ) -> Result<GlossaryList, CoreError> {
        self.remove_term(ctx, args)
    }

    async fn capture_start(
        &self,
        ctx: &CommandCtx,
        args: CaptureStartArgs,
    ) -> Result<CaptureState, CoreError> {
        self.start_call(ctx, args).await
    }

    async fn capture_stop(
        &self,
        ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CaptureState, CoreError> {
        self.stop_call(ctx, args).await
    }

    async fn capture_set_paused(
        &self,
        ctx: &CommandCtx,
        args: CapturePauseArgs,
    ) -> Result<CaptureState, CoreError> {
        self.pause_call(ctx, args).await
    }

    async fn capture_mark_moment(
        &self,
        _ctx: &CommandCtx,
        args: MarkMomentArgs,
    ) -> Result<MarkView, CoreError> {
        self.mark_moment(args).await
    }

    async fn capture_continue(
        &self,
        ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CaptureState, CoreError> {
        self.continue_call(ctx, args).await
    }

    async fn capture_discard(
        &self,
        ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CaptureState, CoreError> {
        self.discard_call(ctx, args).await
    }

    async fn capture_resume_interrupted(
        &self,
        ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CaptureState, CoreError> {
        self.resume_interrupted(ctx, args).await
    }

    async fn capture_answer_call_end(
        &self,
        ctx: &CommandCtx,
        args: CallEndAnswerArgs,
    ) -> Result<CaptureState, CoreError> {
        self.answer_call_end(ctx, args).await
    }

    async fn capture_hold_notice(
        &self,
        _ctx: &CommandCtx,
        args: NoticeHoldArgs,
    ) -> Result<CaptureState, CoreError> {
        self.hold_notice(args).await
    }

    async fn capture_answer_new_meeting(
        &self,
        ctx: &CommandCtx,
        args: NewMeetingAnswerArgs,
    ) -> Result<CaptureState, CoreError> {
        self.answer_new_meeting(ctx, args).await
    }

    async fn capture_keep_recording(
        &self,
        _ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CaptureState, CoreError> {
        self.keep_recording(args).await
    }

    async fn capture_keep_source(
        &self,
        _ctx: &CommandCtx,
        args: KeepSourceArgs,
    ) -> Result<CaptureState, CoreError> {
        self.keep_source(args).await
    }

    async fn capture_exclude_source(
        &self,
        _ctx: &CommandCtx,
        args: ExcludeSourceArgs,
    ) -> Result<CaptureState, CoreError> {
        self.exclude_source(args).await
    }

    async fn capture_dismiss_detection(
        &self,
        _ctx: &CommandCtx,
        args: DismissDetectionArgs,
    ) -> Result<Ack, CoreError> {
        self.dismiss_detection(args)
    }

    async fn capture_ignore_app(
        &self,
        ctx: &CommandCtx,
        args: IgnoreAppArgs,
    ) -> Result<Ack, CoreError> {
        self.ignore_app(ctx, args)
    }

    async fn capture_set_sensitive(
        &self,
        ctx: &CommandCtx,
        args: SensitiveArgs,
    ) -> Result<CaptureState, CoreError> {
        self.set_call_sensitive(ctx, args).await
    }

    // @cpt-flow:cpt-noter-flow-core-credentials-privacy-keys:p1
    async fn accounts_get(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<AccountsView, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-keys:p1:inst-key-read
        let availability = self.llm.refresh().await;
        Ok(self.accounts.observe(Some(availability)))
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-keys:p1:inst-key-read
    }

    async fn api_key_set(
        &self,
        ctx: &CommandCtx,
        args: ApiKeySetArgs,
    ) -> Result<AccountsView, CoreError> {
        let (provider, candidate) = accounts::candidate(args)?;
        // @cpt-begin:cpt-noter-state-core-credentials-privacy-key:p1:inst-key-state-verify
        self.accounts.verifying(provider, true);
        // @cpt-end:cpt-noter-state-core-credentials-privacy-key:p1:inst-key-state-verify
        let privacy = noter_llm::Privacy {
            mode: lock(&self.settings).privacy.mode,
            sensitive: false,
            offline: !self.app().environment.online,
        };
        let runtime = accounts::runtime_of(provider);
        let verified = self
            .llm
            .verify_key(runtime, candidate.clone(), privacy)
            .await;
        let meta = self.change_meta(
            ctx,
            format!("Verified the {provider:?} API key"),
            "api_key_set",
        );
        self.accounts.settle(meta, provider, &candidate, verified)
    }

    // @cpt-dod:cpt-noter-dod-core-ipc-host-snapshot:p1
    async fn app_snapshot(
        &self,
        ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<AppSnapshot, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-ipc-host-window-open:p1:inst-app-snapshot
        let mut snapshot = self.app().clone();
        snapshot.accounts = self.accounts.view();
        snapshot.window = match ctx.caller {
            Caller::Window { label } => label,
            Caller::Native { .. } => WindowLabel::Main,
        };
        // @cpt-end:cpt-noter-flow-core-ipc-host-window-open:p1:inst-app-snapshot
        Ok(snapshot)
    }

    async fn stream_ack(&self, _ctx: &CommandCtx, args: StreamAckArgs) -> Result<Ack, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-ipc-host-window-open:p1:inst-ack
        // A late ack for an ended subscription is normal: nothing to do.
        let _ = self
            .hubs()
            .iter()
            .any(|hub| hub.ack(&args.subscription_id, args.seq));
        // @cpt-end:cpt-noter-flow-core-ipc-host-window-open:p1:inst-ack
        Ok(Ack {})
    }

    async fn stream_unsubscribe(
        &self,
        _ctx: &CommandCtx,
        args: UnsubscribeArgs,
    ) -> Result<Ack, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-ipc-host-window-open:p1:inst-if-unsubscribe
        let _ = self
            .hubs()
            .iter()
            .any(|hub| hub.unsubscribe(&args.subscription_id));
        // @cpt-end:cpt-noter-flow-core-ipc-host-window-open:p1:inst-if-unsubscribe
        // @cpt-begin:cpt-noter-flow-core-ipc-host-window-open:p1:inst-return-unsubscribed
        Ok(Ack {})
        // @cpt-end:cpt-noter-flow-core-ipc-host-window-open:p1:inst-return-unsubscribed
    }

    // @cpt-flow:cpt-noter-flow-core-ipc-host-banner-dismiss:p1
    async fn banner_dismiss(
        &self,
        _ctx: &CommandCtx,
        args: BannerDismissArgs,
    ) -> Result<BannerSet, CoreError> {
        if args.banner == BannerKind::RecordingInterruptedByQuit {
            // The call the banner offered to resume ends at its last audio.
            self.drop_interrupted()?;
        }
        // @cpt-begin:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-dismiss
        let mut app = self.app();
        let before = app.banners.banners.len();
        // @cpt-end:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-dismiss
        // @cpt-begin:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-remove-banner
        app.banners.banners.retain(|b| b.kind() != args.banner);
        if app.banners.banners.len() == before {
            return Ok(app.banners.clone());
        }
        // @cpt-end:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-remove-banner
        // @cpt-begin:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-emit-banners
        let set = self.publish(event_names::BANNERS_CHANGED, &mut app.banners);
        // @cpt-end:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-emit-banners
        // @cpt-begin:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-return-banners
        Ok(set)
        // @cpt-end:cpt-noter-flow-core-ipc-host-banner-dismiss:p1:inst-return-banners
    }

    // @cpt-flow:cpt-noter-flow-core-ipc-host-log-ui:p2
    // @cpt-dod:cpt-noter-dod-core-ipc-host-log-scrub:p1
    async fn log_ui(&self, ctx: &CommandCtx, args: UiLogArgs) -> Result<Ack, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-ipc-host-log-ui:p2:inst-log-call
        let window = match ctx.caller {
            Caller::Window { label } => label.as_str(),
            Caller::Native { .. } => "native",
        };
        let record = json!({
            "level": args.level,
            "module": "ui",
            "window": window,
            "screen": args.screen,
            "code": args.code,
            "message_len": args.message.chars().count(),
        });
        // @cpt-end:cpt-noter-flow-core-ipc-host-log-ui:p2:inst-log-call
        // @cpt-begin:cpt-noter-flow-core-ipc-host-log-ui:p2:inst-log-scrub
        let line = log::scrub(object(record));
        // @cpt-end:cpt-noter-flow-core-ipc-host-log-ui:p2:inst-log-scrub
        // @cpt-begin:cpt-noter-flow-core-ipc-host-log-ui:p2:inst-log-write
        let written = self.log.append(line, self.deps.clock.now().0);
        written.map_err(|e| CoreError::new(ErrorCode::Internal, e.to_string()))?;
        // @cpt-end:cpt-noter-flow-core-ipc-host-log-ui:p2:inst-log-write
        // @cpt-begin:cpt-noter-flow-core-ipc-host-log-ui:p2:inst-log-return
        Ok(Ack {})
        // @cpt-end:cpt-noter-flow-core-ipc-host-log-ui:p2:inst-log-return
    }
}

/// What kind of failure stopped the store, for the log (its text may quote stored data).
fn open_error_kind(e: &OpenError) -> &'static str {
    match e {
        OpenError::Io(_) => "io",
        OpenError::Corrupt(_) => "corrupt",
        OpenError::SchemaAhead { .. } => "schema_ahead",
        OpenError::Migration { .. } => "migration_failed",
        OpenError::InvalidMigrations(_) => "invalid_migrations",
        OpenError::Sqlite(_) => "sqlite",
    }
}

pub(crate) fn to_json<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

fn object(v: Value) -> Map<String, Value> {
    match v {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

/// `internal`: developer text for the log only, never record text.
pub(crate) fn internal(e: impl std::fmt::Display) -> CoreError {
    CoreError::new(ErrorCode::Internal, e.to_string())
}
