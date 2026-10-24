// @cpt-component:cpt-noter-component-core-engine-supervisor:p1
//! # noter-engine-client — the engine supervisor
//!
//! Starts the Swift engine on first need through an [`EngineLauncher`] (the real process, or a
//! scripted engine in tests and in `noter-core-harness`), checks the protocol major on `ready`,
//! writes command lines, reads event lines on a dedicated task, counts `seq` gaps, resolves
//! `ack`, `error` and `pong` by command id, routes every other event to subscribers, checks
//! liveness with `ping` and restarts a dead engine with back-off
//! (`docs/features/core/core-engine-foundation.md`). No Tauri dependency.

mod capture;
mod launch;
pub mod scripted;

pub use capture::{CaptureFact, Degraded, EngineSession};
pub use launch::{EngineIo, EngineLauncher, LaunchFuture, ProcessLauncher};

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use noter_protocol::engine::{
    EngineCommand, EngineCommandLine, EngineErrorCode, EngineEvent, EngineEventLine,
    ENGINE_PROTOCOL_VERSION,
};
use noter_protocol::{CoreError, ErrorCode};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{broadcast, oneshot};
use tokio::time::{timeout, Instant};

/// Timing of the supervisor.
#[derive(Debug, Clone)]
pub struct Config {
    /// How long a new engine may take to send `ready`.
    pub start_timeout: Duration,
    /// How long `ping` waits for `pong` before the engine counts as dead.
    pub ping_timeout: Duration,
    /// How long an engine asked to `shutdown` may take before it is killed.
    pub grace: Duration,
    /// Failed restarts within `failed_start_window` that stop the retries.
    pub max_failed_starts: usize,
    pub failed_start_window: Duration,
    /// First restart delay; doubles per failed restart, up to five minutes.
    pub restart_backoff: Duration,
    /// How long a command waits for its `ack` or `error` before the engine is pinged.
    pub command_timeout: Duration,
    /// How often the liveness task pings a ready engine.
    pub liveness_interval: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            start_timeout: Duration::from_secs(10),
            ping_timeout: Duration::from_secs(2),
            grace: Duration::from_secs(2),
            max_failed_starts: 3,
            failed_start_window: Duration::from_secs(60),
            restart_backoff: Duration::from_millis(500),
            command_timeout: Duration::from_secs(10),
            liveness_interval: Duration::from_secs(5),
        }
    }
}

// @cpt-state:cpt-noter-state-core-engine-foundation-process:p1
/// The engine process as the supervisor sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineState {
    NotStarted,
    Starting,
    Ready,
    Restarting,
    Unavailable,
    Stopped,
}

/// What `ready` reported.
#[derive(Debug, Clone, PartialEq)]
pub struct ReadyInfo {
    pub protocol_version: String,
    pub engine_version: String,
    pub models: Vec<String>,
    pub sandboxed: bool,
}

/// Protocol anomalies since the client was created.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Stats {
    /// Events whose `seq` was not the previous `seq + 1`.
    pub gaps: u64,
    /// Lines that did not parse (logged without their content).
    pub unparsable: u64,
}

/// Why a command did not succeed.
#[derive(Debug, Clone, PartialEq)]
pub enum CommandError {
    /// The engine answered `error` for this command.
    Engine {
        code: EngineErrorCode,
        message: String,
    },
    /// The engine is not running and could not be started, or died before answering.
    Unavailable,
}

impl From<CommandError> for CoreError {
    fn from(e: CommandError) -> Self {
        match e {
            CommandError::Unavailable => unavailable("engine unavailable"),
            CommandError::Engine { code, message } => {
                // The contract's code where it has one; the rest are the engine's bugs.
                let typed = match code {
                    EngineErrorCode::PermissionMissing => ErrorCode::PermissionMissing,
                    EngineErrorCode::ModelMissing => ErrorCode::ModelMissing,
                    EngineErrorCode::DiskFull => ErrorCode::DiskFull,
                    _ => ErrorCode::Internal,
                };
                CoreError::new(typed, format!("engine {code:?}: {message}"))
            }
        }
    }
}

fn unavailable(why: &str) -> CoreError {
    CoreError::new(ErrorCode::EngineUnavailable, why)
}

fn major(version: &str) -> &str {
    version.split('.').next().unwrap_or(version)
}

type Reply = oneshot::Sender<Result<(), CommandError>>;

struct Shared {
    state: EngineState,
    /// Counts engine processes; a reader only reports for its own process.
    generation: u64,
    ready_info: Option<ReadyInfo>,
    ready: Option<oneshot::Sender<ReadyInfo>>,
    pending: HashMap<u64, Reply>,
    pings: VecDeque<oneshot::Sender<()>>,
    failures: VecDeque<Instant>,
    stats: Stats,
    detection: (bool, Vec<String>),
    session: Option<capture::Session>,
}

/// The running engine: its stdin and its reader task.
struct Conn {
    stdin: Box<dyn AsyncWrite + Unpin + Send>,
    generation: u64,
    reader: tokio::task::JoinHandle<()>,
}

impl Drop for Conn {
    fn drop(&mut self) {
        // The reader owns stdout; aborting it drops the pipe and ends the process.
        self.reader.abort();
    }
}

struct Inner<L> {
    launcher: L,
    config: Config,
    /// Held while starting and while writing, so lines never interleave.
    conn: tokio::sync::Mutex<Option<Conn>>,
    shared: Mutex<Shared>,
    events: broadcast::Sender<EngineEventLine>,
    facts: broadcast::Sender<CaptureFact>,
    next_id: AtomicU64,
}

/// The engine supervisor. Cheap to clone; every clone talks to the same engine.
// @cpt-dod:cpt-noter-dod-core-engine-foundation-supervisor:p1
pub struct EngineClient<L> {
    inner: Arc<Inner<L>>,
}

impl<L> Clone for EngineClient<L> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

async fn write_line(
    stdin: &mut (dyn AsyncWrite + Unpin + Send),
    id: u64,
    cmd: EngineCommand,
) -> std::io::Result<()> {
    let mut line = serde_json::to_vec(&EngineCommandLine { id, cmd })?;
    line.push(b'\n');
    stdin.write_all(&line).await?;
    stdin.flush().await
}

impl<L: EngineLauncher> EngineClient<L> {
    pub fn new(launcher: L, config: Config) -> Self {
        Self {
            inner: Arc::new(Inner {
                launcher,
                config,
                conn: tokio::sync::Mutex::new(None),
                shared: Mutex::new(Shared {
                    state: EngineState::NotStarted,
                    generation: 0,
                    ready_info: None,
                    ready: None,
                    pending: HashMap::new(),
                    pings: VecDeque::new(),
                    failures: VecDeque::new(),
                    stats: Stats::default(),
                    detection: (false, Vec::new()),
                    session: None,
                }),
                events: broadcast::channel(1024).0,
                facts: broadcast::channel(256).0,
                next_id: AtomicU64::new(1),
            }),
        }
    }

    fn shared(&self) -> MutexGuard<'_, Shared> {
        self.inner.shared.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn next_id(&self) -> u64 {
        self.inner.next_id.fetch_add(1, Ordering::Relaxed)
    }

    pub fn state(&self) -> EngineState {
        self.shared().state
    }

    pub fn stats(&self) -> Stats {
        self.shared().stats
    }

    /// Every event that is not a reply (`ack`, `error` for a command, `pong`), in order.
    pub fn events(&self) -> broadcast::Receiver<EngineEventLine> {
        self.inner.events.subscribe()
    }

    /// The detection rule sent after every `ready` (off until the self-test passed).
    pub fn set_detection_rule(&self, enabled: bool, known_bundle_ids: Vec<String>) {
        self.shared().detection = (enabled, known_bundle_ids);
    }

    /// The running engine, started first if needed; `engine_unavailable` if it cannot start.
    pub async fn ensure_ready(&self) -> Result<ReadyInfo, CoreError> {
        let mut conn = self.inner.conn.lock().await;
        if conn.is_some() {
            let s = self.shared();
            if s.state == EngineState::Ready {
                if let Some(info) = &s.ready_info {
                    return Ok(info.clone());
                }
            }
        }
        self.start(&mut conn).await
    }

    // @cpt-flow:cpt-noter-flow-core-engine-foundation-start:p1
    async fn start(&self, conn: &mut Option<Conn>) -> Result<ReadyInfo, CoreError> {
        *conn = None;
        // @cpt-begin:cpt-noter-state-core-engine-foundation-process:p1:inst-st-start
        {
            let mut s = self.shared();
            if s.state != EngineState::Restarting {
                s.state = EngineState::Starting;
            }
        }
        // @cpt-end:cpt-noter-state-core-engine-foundation-process:p1:inst-st-start
        let Ok(io) = self.inner.launcher.launch().await else {
            return Err(self.failed_start("the engine did not launch"));
        };
        // @cpt-begin:cpt-noter-flow-core-engine-foundation-start:p1:inst-reader
        let (ready_tx, ready_rx) = oneshot::channel();
        let generation = {
            let mut s = self.shared();
            s.generation += 1;
            s.ready = Some(ready_tx);
            s.generation
        };
        let reader = tokio::spawn(self.clone().read_events(generation, io.stdout));
        let c = conn.insert(Conn {
            stdin: io.stdin,
            generation,
            reader,
        });
        // @cpt-end:cpt-noter-flow-core-engine-foundation-start:p1:inst-reader
        // @cpt-begin:cpt-noter-flow-core-engine-foundation-start:p1:inst-wait-ready
        let Ok(Ok(info)) = timeout(self.inner.config.start_timeout, ready_rx).await else {
            *conn = None;
            return Err(self.failed_start("no ready from the engine"));
        };
        // @cpt-end:cpt-noter-flow-core-engine-foundation-start:p1:inst-wait-ready
        // @cpt-begin:cpt-noter-flow-core-engine-foundation-start:p1:inst-if-major
        if major(&info.protocol_version) != major(ENGINE_PROTOCOL_VERSION) {
            // @cpt-begin:cpt-noter-flow-core-engine-foundation-start:p1:inst-return-major
            // @cpt-begin:cpt-noter-state-core-engine-foundation-process:p1:inst-st-unavailable
            // Never guess around a version: stop it, give it the grace period, then kill it.
            let _ = write_line(&mut *c.stdin, self.next_id(), EngineCommand::Shutdown).await;
            let _ = timeout(self.inner.config.grace, &mut c.reader).await;
            *conn = None;
            self.shared().state = EngineState::Unavailable;
            return Err(unavailable("the engine speaks another protocol major"));
            // @cpt-end:cpt-noter-state-core-engine-foundation-process:p1:inst-st-unavailable
            // @cpt-end:cpt-noter-flow-core-engine-foundation-start:p1:inst-return-major
        }
        // @cpt-end:cpt-noter-flow-core-engine-foundation-start:p1:inst-if-major
        // @cpt-begin:cpt-noter-state-core-engine-foundation-process:p1:inst-st-ready
        // @cpt-begin:cpt-noter-state-core-engine-foundation-process:p1:inst-st-restarted
        let (enabled, known_bundle_ids) = {
            let mut s = self.shared();
            s.state = EngineState::Ready;
            s.ready_info = Some(info.clone());
            s.failures.clear();
            s.detection.clone()
        };
        // @cpt-end:cpt-noter-state-core-engine-foundation-process:p1:inst-st-restarted
        // @cpt-end:cpt-noter-state-core-engine-foundation-process:p1:inst-st-ready
        // @cpt-begin:cpt-noter-flow-core-engine-foundation-start:p1:inst-set-detection
        // @cpt-begin:cpt-noter-flow-core-engine-capture-detect:p1:inst-set-detection
        // Its `ack` has no waiter; a dead pipe shows up as end of stdout.
        let cmd = EngineCommand::SetDetection {
            enabled,
            known_bundle_ids,
        };
        let _ = write_line(&mut *c.stdin, self.next_id(), cmd).await;
        // @cpt-end:cpt-noter-flow-core-engine-capture-detect:p1:inst-set-detection
        // @cpt-end:cpt-noter-flow-core-engine-foundation-start:p1:inst-set-detection
        self.spawn_liveness(generation);
        // @cpt-begin:cpt-noter-flow-core-engine-foundation-start:p1:inst-return-ready
        Ok(info)
        // @cpt-end:cpt-noter-flow-core-engine-foundation-start:p1:inst-return-ready
    }

    /// A start failed. A request's start makes the engine unavailable until the next request;
    /// while restarting, three failures within a minute stop the retries.
    fn failed_start(&self, why: &str) -> CoreError {
        let mut s = self.shared();
        let now = Instant::now();
        s.failures.push_back(now);
        let window = self.inner.config.failed_start_window;
        while s.failures.front().is_some_and(|t| now - *t > window) {
            s.failures.pop_front();
        }
        // @cpt-begin:cpt-noter-state-core-engine-foundation-process:p1:inst-st-giveup
        if s.state != EngineState::Restarting
            || s.failures.len() >= self.inner.config.max_failed_starts
        {
            s.state = EngineState::Unavailable;
        }
        // @cpt-end:cpt-noter-state-core-engine-foundation-process:p1:inst-st-giveup
        unavailable(why)
    }

    /// Sends a command and waits for its `ack` or `error`.
    pub async fn command(&self, cmd: EngineCommand) -> Result<(), CommandError> {
        self.ensure_ready()
            .await
            .map_err(|_| CommandError::Unavailable)?;
        let id = self.next_id();
        let (tx, rx) = oneshot::channel();
        {
            let mut conn = self.inner.conn.lock().await;
            let Some(c) = conn.as_mut() else {
                return Err(CommandError::Unavailable);
            };
            self.shared().pending.insert(id, tx);
            if write_line(&mut *c.stdin, id, cmd).await.is_err() {
                self.shared().pending.remove(&id);
                return Err(CommandError::Unavailable);
            }
        }
        match timeout(self.inner.config.command_timeout, rx).await {
            Ok(reply) => reply.unwrap_or(Err(CommandError::Unavailable)),
            Err(_) => {
                // No reply in time: a missed ping ends this engine and restarts it.
                self.shared().pending.remove(&id);
                let _ = self.ping().await;
                Err(CommandError::Unavailable)
            }
        }
    }

    /// Liveness: `ping` must be answered by `pong` in time, or the engine is restarted.
    pub async fn ping(&self) -> Result<(), CommandError> {
        self.ensure_ready()
            .await
            .map_err(|_| CommandError::Unavailable)?;
        let generation = self.shared().generation;
        self.ping_connection(generation).await
    }

    /// Pings the engine process `generation` only: never starts one (the liveness task must
    /// not relaunch an engine that was just shut down).
    async fn ping_connection(&self, generation: u64) -> Result<(), CommandError> {
        let (tx, rx) = oneshot::channel();
        {
            let mut conn = self.inner.conn.lock().await;
            let Some(c) = conn.as_mut().filter(|c| c.generation == generation) else {
                return Err(CommandError::Unavailable);
            };
            self.shared().pings.push_back(tx);
            let _ = write_line(&mut *c.stdin, self.next_id(), EngineCommand::Ping).await;
        }
        match timeout(self.inner.config.ping_timeout, rx).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(_)) => Err(CommandError::Unavailable),
            Err(_) => {
                // A missed ping: end this engine; the restart takes over.
                let mut conn = self.inner.conn.lock().await;
                if conn.as_ref().is_some_and(|c| c.generation == generation) {
                    *conn = None;
                    self.on_closed(generation);
                }
                Err(CommandError::Unavailable)
            }
        }
    }

    // @cpt-begin:cpt-noter-state-core-engine-foundation-process:p1:inst-st-stopped
    /// Asks the engine to stop, waits up to the grace period for its `ack`, then ends it.
    pub async fn shutdown(&self) {
        let mut conn = self.inner.conn.lock().await;
        self.shared().state = EngineState::Stopped;
        if let Some(c) = conn.as_mut() {
            let id = self.next_id();
            let (tx, rx) = oneshot::channel();
            self.shared().pending.insert(id, tx);
            if write_line(&mut *c.stdin, id, EngineCommand::Shutdown)
                .await
                .is_ok()
            {
                let _ = timeout(self.inner.config.grace, rx).await;
            }
        }
        *conn = None;
    }
    // @cpt-end:cpt-noter-state-core-engine-foundation-process:p1:inst-st-stopped

    // @cpt-algo:cpt-noter-algo-core-engine-foundation-read-events:p1
    async fn read_events(self, generation: u64, stdout: Box<dyn AsyncRead + Unpin + Send>) {
        let mut lines = BufReader::new(stdout).lines();
        let mut last_seq: Option<u64> = None;
        // @cpt-begin:cpt-noter-algo-core-engine-foundation-read-events:p1:inst-for-lines
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            // @cpt-begin:cpt-noter-algo-core-engine-foundation-read-events:p1:inst-parse-event
            let Ok(event) = serde_json::from_str::<EngineEventLine>(&line) else {
                // Counted, never logged with its content (it may hold transcript text).
                self.shared().stats.unparsable += 1;
                continue;
            };
            // @cpt-end:cpt-noter-algo-core-engine-foundation-read-events:p1:inst-parse-event
            // @cpt-begin:cpt-noter-algo-core-engine-foundation-read-events:p1:inst-detect-gap
            if last_seq.is_some_and(|prev| event.seq != prev + 1) {
                self.shared().stats.gaps += 1;
            }
            last_seq = Some(event.seq);
            // @cpt-end:cpt-noter-algo-core-engine-foundation-read-events:p1:inst-detect-gap
            self.dispatch(event);
        }
        // @cpt-end:cpt-noter-algo-core-engine-foundation-read-events:p1:inst-for-lines
        // @cpt-begin:cpt-noter-algo-core-engine-foundation-read-events:p1:inst-on-close
        // @cpt-begin:cpt-noter-algo-core-engine-foundation-read-events:p1:inst-return-read
        self.on_closed(generation);
        // @cpt-end:cpt-noter-algo-core-engine-foundation-read-events:p1:inst-return-read
        // @cpt-end:cpt-noter-algo-core-engine-foundation-read-events:p1:inst-on-close
    }

    fn dispatch(&self, line: EngineEventLine) {
        let mut s = self.shared();
        // @cpt-begin:cpt-noter-algo-core-engine-foundation-read-events:p1:inst-correlate
        match &line.event {
            EngineEvent::Ready {
                protocol_version,
                engine_version,
                models,
                sandboxed,
            } => {
                if let Some(tx) = s.ready.take() {
                    let _ = tx.send(ReadyInfo {
                        protocol_version: protocol_version.clone(),
                        engine_version: engine_version.clone(),
                        models: models.clone(),
                        sandboxed: *sandboxed,
                    });
                }
                return;
            }
            EngineEvent::Ack { cmd_id } => {
                if let Some(tx) = s.pending.remove(cmd_id) {
                    let _ = tx.send(Ok(()));
                }
                return;
            }
            EngineEvent::Error {
                cmd_id: Some(id),
                code,
                message,
            } if s.pending.contains_key(id) => {
                if let Some(tx) = s.pending.remove(id) {
                    let _ = tx.send(Err(CommandError::Engine {
                        code: *code,
                        message: message.clone(),
                    }));
                }
                return;
            }
            EngineEvent::Pong => {
                if let Some(tx) = s.pings.pop_front() {
                    let _ = tx.send(());
                }
                return;
            }
            _ => {}
        }
        // @cpt-end:cpt-noter-algo-core-engine-foundation-read-events:p1:inst-correlate
        // @cpt-begin:cpt-noter-algo-core-engine-foundation-read-events:p1:inst-route
        drop(s);
        self.on_capture_event(&line.event);
        // No subscriber is not an error: the event is simply not wanted now.
        let _ = self.inner.events.send(line);
        // @cpt-end:cpt-noter-algo-core-engine-foundation-read-events:p1:inst-route
    }

    /// The engine's stdout closed (it exited, crashed or was killed).
    fn on_closed(&self, generation: u64) {
        let restart = {
            let mut s = self.shared();
            if s.generation != generation {
                return;
            }
            // @cpt-begin:cpt-noter-algo-core-engine-foundation-restart:p1:inst-fail-waiting
            for (_, tx) in s.pending.drain() {
                let _ = tx.send(Err(CommandError::Unavailable));
            }
            s.pings.clear();
            s.ready = None;
            // @cpt-end:cpt-noter-algo-core-engine-foundation-restart:p1:inst-fail-waiting
            // @cpt-begin:cpt-noter-state-core-engine-foundation-process:p1:inst-st-restart
            let restart = s.state == EngineState::Ready;
            if restart {
                s.state = EngineState::Restarting;
            }
            // @cpt-end:cpt-noter-state-core-engine-foundation-process:p1:inst-st-restart
            // A session running: the capture-first restart instead of the idle rule (D-12, TL-8).
            let capture = if restart {
                self.crash_during_capture(&mut s)
            } else {
                None
            };
            (restart, capture)
        };
        match restart {
            (_, Some(true)) => {
                tokio::spawn(self.clone().restart_capture());
            }
            (true, None) => {
                tokio::spawn(self.clone().restart());
            }
            _ => {}
        }
    }

    /// The supervisor schedules liveness itself: while this engine is ready it is pinged every
    /// `liveness_interval`; a missed ping ends it and the restart takes over.
    fn spawn_liveness(&self, generation: u64) {
        let client = self.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(client.inner.config.liveness_interval).await;
                {
                    let s = client.shared();
                    if s.state != EngineState::Ready || s.generation != generation {
                        return;
                    }
                }
                if client.ping_connection(generation).await.is_err() {
                    return;
                }
            }
        });
    }

    // @cpt-begin:cpt-noter-algo-core-engine-foundation-restart:p1:inst-backoff
    /// Restarts a dead engine with back-off until it is ready again or the retries stop.
    async fn restart(self) {
        let mut delay = self.inner.config.restart_backoff;
        loop {
            tokio::time::sleep(delay).await;
            let mut conn = self.inner.conn.lock().await;
            if self.state() != EngineState::Restarting {
                return;
            }
            // @cpt-begin:cpt-noter-algo-core-engine-foundation-restart:p1:inst-return-restart
            if self.start(&mut conn).await.is_ok() || self.state() != EngineState::Restarting {
                return;
            }
            // @cpt-end:cpt-noter-algo-core-engine-foundation-restart:p1:inst-return-restart
            delay = (delay * 2).min(Duration::from_secs(300));
        }
    }
    // @cpt-end:cpt-noter-algo-core-engine-foundation-restart:p1:inst-backoff
}
