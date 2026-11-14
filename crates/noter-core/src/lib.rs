//! noter-core: the composition root. [`Core`] implements `CoreApi` for the IPC host
//! (`apps/desktop/src-tauri`) and `noter-core-harness`; neither depends on Tauri here.
//! Every later feature plugs its service in through [`CoreDeps`] and this crate.

mod accounts;
mod app;
mod archive;
mod ask;
mod audio;
mod audit;
mod capture;
mod carry;
mod chunks;
mod credentials;
mod first_run;
mod glossary;
mod handoff;
mod history;
mod hotkeys;
mod hub;
mod ipc;
mod items;
mod jobs;
mod knowledge;
mod library;
mod log;
mod mcp;
mod merge;
mod models;
mod native_ops;
mod notices;
mod notify;
mod people;
mod playback;
mod postcall;
mod privacy;
mod profiles;
mod recovery;
mod retrieval;
mod self_test;
mod settings;
mod share;
mod signin;
mod speakers;
mod surfaces;
#[cfg(feature = "harness")]
pub mod testing;
mod today;
mod transcript;
mod tray;
mod util;

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use noter_db::{ChangeMeta, Migration, OpenError, Store};
use noter_protocol::ipc::{event_names, Caller, CommandCtx};
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
pub use knowledge::HttpMcp;
pub use mcp::{McpRegistration, McpSession};
pub use models::PinnedModels;
pub use native_ops::{ClipboardText, LaunchRequest, NativeOps, SaveKind};
pub use noter_jobs::{PowerSource, Request, Trigger};
pub use noter_knowledge::{
    Audit as McpAudit, Listing, McpError, McpSource, Page as McpPage, Remote as McpRemote,
    ScriptedListing, ScriptedMcp, ScriptedOauth, ScriptedPage, ScriptedServer,
};
/// The one model-download allow-list check: noter-llm's, the egress gate (decision D14).
pub use noter_llm::allowed_download_url;
pub use noter_llm::{
    AccountCli, Adapters, CliAccounts, CliConfig, KeychainLocked, Llm, MemorySecrets, NoAccountCli,
    OllamaConfig, Scripted, ScriptedAccountCli, Secret, SecretStore, ToolScript,
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
    /// Claude Code, Codex and Ollama as accounts and installs (the pinned CLIs in the app, a
    /// scripted one in the harness and tests, TL-32); nothing is installed until the host sets it.
    pub account_cli: Arc<dyn AccountCli>,
    /// Whether the Mac is on battery, for the jobs that do not run on it (mains power if unset).
    pub power: Arc<dyn noter_jobs::PowerSource>,
    /// Save panel and the native asks to come (`NativeOps`); every panel cancels until set.
    pub native_ops: Arc<dyn NativeOps>,
    /// Indexed MCP servers (TL-42; scripted in the harness and tests); no server is valid until
    /// set.
    pub mcp_source: Arc<dyn noter_knowledge::McpSource>,
    /// The `noter-mcp` binary a run that may use tools starts under its CLI (the sidecar in the
    /// app, the built test binary in tests); without it runs have no tools.
    pub mcp_binary: Option<std::path::PathBuf>,
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
            account_cli: Arc::new(NoAccountCli),
            power: Arc::new(jobs::AcPower),
            native_ops: Arc::new(native_ops::NoNativeOps),
            mcp_source: Arc::new(ScriptedMcp::default()),
            mcp_binary: None,
        }
    }

    pub fn with_mcp_source(mut self, mcp: Arc<dyn noter_knowledge::McpSource>) -> Self {
        self.mcp_source = mcp;
        self
    }

    pub fn with_mcp_binary(mut self, binary: std::path::PathBuf) -> Self {
        self.mcp_binary = Some(binary);
        self
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

    pub fn with_account_cli(mut self, cli: Arc<dyn AccountCli>) -> Self {
        self.account_cli = cli;
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
    /// Live policy for model requests; completed requests are pruned on the next update.
    privacy_watches: Mutex<Vec<privacy::Watch>>,
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
    /// Serializes hide/restore transitions without blocking native focus callbacks on `windows`.
    // @cpt-flow:cpt-noter-flow-core-native-surfaces-presenting:p1
    presenting_transition: Mutex<()>,
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
    /// Knowledge sources: folder watchers and their sync runs.
    sources: knowledge::Sources,
    /// The noter-mcp runs and the socket they reach the core on.
    mcp: mcp::McpRuns,
    /// Whether searches can use the vector indexes (`noter-retrieval`).
    index: noter_retrieval::Index,
    /// Ask turns that have not ended, and their Channel messages.
    ask: ask::Turns,
    ask_hub: std::sync::OnceLock<Arc<StreamHub<AskMsg>>>,
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
    Migration {
        owner: "noter-core",
        version: 8,
        name: "audio deletion time",
        sql: include_str!("../migrations/0008_audio_deleted_at.sql"),
    },
    Migration {
        owner: "noter-core",
        version: 9,
        name: "output speaker naming state",
        sql: include_str!("../migrations/0009_names_updated.sql"),
    },
    // @cpt-dbtable:cpt-noter-dbtable-people:p1
    // @cpt-dbtable:cpt-noter-dbtable-call-participants:p1
    // @cpt-dbtable:cpt-noter-dbtable-voice-profiles:p1
    Migration {
        owner: "noter-core",
        version: 10,
        name: "people, aliases, participants and voice profiles",
        sql: include_str!("../migrations/0010_people.sql"),
    },
];

impl Core {
    /// Opens the core on `data_dir` (`noter.db`, `logs/`): the same call for the app, the
    /// harness and the tests.
    pub fn open(data_dir: &Path, deps: CoreDeps) -> Result<Core, BootError> {
        let log = log::Logger::open(data_dir).map_err(BootError::Io)?;
        let store = match Store::open(
            &data_dir.join("noter.db"),
            &[
                noter_db::MIGRATIONS,
                MIGRATIONS,
                noter_handoff::MIGRATIONS,
                noter_knowledge::MIGRATIONS,
                noter_retrieval::MIGRATIONS,
            ],
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
        let mcp = mcp::McpRuns::default();
        let llm = match &deps.mcp_binary {
            Some(binary) => llm.with_tool_host(Arc::new(mcp.host()), binary.clone()),
            None => llm,
        };
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
            privacy_watches: Mutex::new(vec![]),
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
            presenting_transition: Mutex::new(()),
            capture_phase: tokio::sync::watch::channel(CapturePhase::Idle).0,
            viewed: Mutex::new(None),
            held: Mutex::new(Vec::new()),
            audio_dir,
            playback: playback::Playback::new(),
            transcript: transcript::Transcript::new(),
            postcall: postcall::Sections::default(),
            handoffs: noter_handoff::Generations::default(),
            sources: knowledge::Sources::default(),
            mcp,
            index: noter_retrieval::Index::default(),
            ask: ask::Turns::default(),
            ask_hub: std::sync::OnceLock::new(),
        };
        Core::discard_stale_mcp_configs(data_dir);
        core.check_index();
        core.start_hotkeys().map_err(BootError::Load)?;
        core.retry_audio_removals();
        core.init_call_window();
        core.refresh_tray();
        Ok(core)
    }

    /// Ends the core: every stream ends with `shutdown`, then the writer drains its queue and
    /// checkpoints. Idempotent.
    pub async fn shutdown(&self) {
        self.close_mcp();
        self.cancel_asks();
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

    pub(crate) fn store_handle(&self) -> Arc<Store> {
        Arc::clone(&self.store)
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

    /// Replaces the degraded set and sends `degraded:changed`; a call switched to local is the
    /// effective privacy while it lasts, sent first as `privacy:changed`.
    pub fn set_degraded(&self, states: Vec<DegradedState>) -> DegradedSet {
        let mut app = self.app();
        let switched = states
            .iter()
            .any(|s| matches!(s, DegradedState::SwitchedToLocal { .. }));
        let effective = match (switched, app.privacy.effective) {
            (true, _) => EffectiveMode::SwitchedToLocal,
            (false, EffectiveMode::SwitchedToLocal) => match app.privacy.mode {
                PrivacyMode::CloudAllowed => EffectiveMode::Cloud,
                PrivacyMode::CloudRedacted => EffectiveMode::CloudRedacted,
                PrivacyMode::LocalOnly => EffectiveMode::LocalOnly,
            },
            (false, e) => e,
        };
        if app.privacy.effective != effective {
            app.privacy.effective = effective;
            self.publish(event_names::PRIVACY_CHANGED, &mut app.privacy);
        }
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

pub(crate) use noter_db::lock;

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

pub(crate) use noter_protocol::internal;
