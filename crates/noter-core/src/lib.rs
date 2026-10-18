//! noter-core: the composition root. [`Core`] implements `CoreApi` for the IPC host
//! (`apps/desktop/src-tauri`) and `noter-core-harness`; neither depends on Tauri here.
//! Every later feature plugs its service in through [`CoreDeps`] and this crate.

mod app;
mod hub;
mod log;

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use noter_db::{OpenError, Store};
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Map, Value};

use app::WholeState;
use hub::AnyHub;
pub use hub::{StreamHub, StreamMsg, Subscribed, LAG_LIMIT};
use noter_protocol::ipc::Sink;

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
}

impl CoreDeps {
    pub fn new(clock: Arc<dyn Clock>, events: Arc<dyn EventEmitter>) -> Self {
        Self {
            clock,
            events,
            app_version: "dev".into(),
        }
    }

    pub fn with_app_version(mut self, version: impl Into<String>) -> Self {
        self.app_version = version.into();
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
}

impl std::fmt::Display for BootError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "cannot prepare the data folder: {e}"),
            Self::Store(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for BootError {}

/// The core: one per process, shared by every window and native surface.
pub struct Core {
    deps: CoreDeps,
    store: Store,
    log: log::Logger,
    /// The app snapshot's slices, kept whole; a window's snapshot is a copy.
    app: Mutex<AppSnapshot>,
    /// One stream hub per Channel message type, for routing acks, reloads and shutdown.
    hubs: Mutex<Vec<Arc<dyn AnyHub>>>,
}

impl Core {
    /// Opens the core on `data_dir` (`noter.db`, `logs/`): the same call for the app, the
    /// harness and the tests.
    pub fn open(data_dir: &Path, deps: CoreDeps) -> Result<Core, BootError> {
        let log = log::Logger::open(data_dir).map_err(BootError::Io)?;
        let store = match Store::open(&data_dir.join("noter.db"), &[noter_db::MIGRATIONS]) {
            Ok(store) => store,
            Err(e) => {
                let record =
                    json!({ "level": "error", "module": "storage", "code": open_error_kind(&e) });
                let _ = log.write(object(record), deps.clock.now().0);
                return Err(BootError::Store(e));
            }
        };
        let snapshot = app::fresh_snapshot(&deps.app_version);
        Ok(Core {
            deps,
            store,
            log,
            app: Mutex::new(snapshot),
            hubs: Mutex::new(vec![]),
        })
    }

    /// Ends the core: every stream ends with `shutdown`, then the writer drains its queue and
    /// checkpoints. Idempotent.
    pub async fn shutdown(&self) {
        for hub in self.hubs() {
            hub.end_all(StreamEndReason::Shutdown);
        }
        self.store.close();
    }

    /// The store, for the services the core composes.
    pub fn store(&self) -> &Store {
        &self.store
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

    fn app(&self) -> MutexGuard<'_, AppSnapshot> {
        self.app
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Stamps a whole-state payload with the next version of its kind and sends it.
    // @cpt-algo:cpt-noter-algo-core-ipc-host-version:p1
    fn publish<T: WholeState>(&self, event: &'static str, state: &mut T) -> T {
        // @cpt-begin:cpt-noter-algo-core-ipc-host-version:p1:inst-increment
        // The counter is the slice's own version: 1 at core start, kept in memory.
        let next = StateVersion(state.version().0 + 1);
        // @cpt-end:cpt-noter-algo-core-ipc-host-version:p1:inst-increment
        // @cpt-begin:cpt-noter-algo-core-ipc-host-version:p1:inst-stamp
        *state.version() = next;
        let stamped = state.clone();
        // @cpt-end:cpt-noter-algo-core-ipc-host-version:p1:inst-stamp
        // @cpt-begin:cpt-noter-algo-core-ipc-host-version:p1:inst-emit-event
        self.deps.events.emit(event, to_json(&stamped));
        // @cpt-end:cpt-noter-algo-core-ipc-host-version:p1:inst-emit-event
        // @cpt-begin:cpt-noter-algo-core-ipc-host-version:p1:inst-return-version
        stamped
        // @cpt-end:cpt-noter-algo-core-ipc-host-version:p1:inst-return-version
    }
}

// @cpt-interface:cpt-noter-interface-core-ipc:p1
impl CoreApi for Core {
    async fn app_snapshot(
        &self,
        ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<AppSnapshot, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-ipc-host-window-open:p1:inst-app-snapshot
        let mut snapshot = self.app().clone();
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

fn to_json<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

fn object(v: Value) -> Map<String, Value> {
    match v {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}
