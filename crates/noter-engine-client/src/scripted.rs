//! A scripted engine over an in-memory pipe, for the supervisor's tests and for
//! `noter-core-harness` (decision D3: in M0 it answers `ready`, `ack`, `pong` and the
//! self-test; replaying recordings comes with the engine's file mode in M1). A [`Script`]
//! adds timed steps bound to commands (`.plans/engine-script-format.md`, TL-3).

use std::collections::VecDeque;
use std::fmt;
use std::io;
use std::sync::{Arc, Mutex, MutexGuard};

use noter_protocol::engine::{
    EngineCommand, EngineCommandLine, EngineErrorCode, EngineEvent, EngineEventLine,
    ENGINE_PROTOCOL_VERSION,
};
use noter_protocol::{AudioChannel, PermissionState, TimestampMs};
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader, DuplexStream};
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;

use crate::launch::{EngineIo, EngineLauncher, LaunchFuture};

/// The engine sends levels at most this often.
const LEVELS_EVERY: std::time::Duration = std::time::Duration::from_millis(100);

/// What a script step does when it is due.
#[derive(Debug, Clone, PartialEq)]
enum Action {
    /// Send this event on the engine's stdout (the engine adds `seq` and `at`).
    Event(Box<EngineEvent>),
    /// End the engine as [`ScriptedEngine::kill_current`] does.
    Kill,
}

/// One step: `action` runs `after_ms` (tokio time) after each `ack` of the command `on` names.
#[derive(Debug, Clone, PartialEq)]
struct Step {
    on: String,
    after_ms: u64,
    action: Action,
}

/// An engine script: JSON Lines steps bound to commands, in file order.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Script {
    steps: Vec<Step>,
}

/// The first line of a script that does not parse (1-based).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptError {
    pub line: usize,
    pub message: String,
}

impl fmt::Display for ScriptError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "line {}: {}", self.line, self.message)
    }
}

impl std::error::Error for ScriptError {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawStep {
    on: String,
    after_ms: u64,
    event: Option<EngineEvent>,
    kill: Option<bool>,
}

impl Script {
    /// Parses JSON Lines steps; blank lines and `//` lines are skipped; `Err` names the first bad line.
    pub fn parse(text: &str) -> Result<Script, ScriptError> {
        let mut steps = Vec::new();
        for (i, line) in text.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() || line.starts_with("//") {
                continue;
            }
            let fail = |message: String| ScriptError {
                line: i + 1,
                message,
            };
            let raw: RawStep = serde_json::from_str(line).map_err(|e| fail(e.to_string()))?;
            // A known tag with missing fields fails differently from an unknown one: catches typos.
            if let Err(e) =
                serde_json::from_value::<EngineCommand>(serde_json::json!({ "type": raw.on }))
            {
                if e.to_string().starts_with("unknown variant") {
                    return Err(fail(format!("`on`: {e}")));
                }
            }
            let action = match (raw.event, raw.kill) {
                (Some(event), None) => Action::Event(Box::new(event)),
                (None, Some(true)) => Action::Kill,
                _ => return Err(fail("a step has either `event` or `\"kill\": true`".into())),
            };
            steps.push(Step {
                on: raw.on,
                after_ms: raw.after_ms,
                action,
            });
        }
        Ok(Script { steps })
    }

    pub fn len(&self) -> usize {
        self.steps.len()
    }

    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }
}

/// How one launched engine behaves.
#[derive(Debug, Clone)]
pub struct Behaviour {
    /// The launch itself fails (binary missing, spawn refused).
    pub launch_fails: bool,
    /// The version `ready` reports; `None` never sends `ready`.
    pub protocol_version: Option<String>,
    /// Answers `ping` with `pong`.
    pub answer_ping: bool,
    /// Answers every command but `ping` and `shutdown` with `error { code: bad_command }`.
    pub reject: bool,
    /// Answers nothing (a hung engine).
    pub hang: bool,
    /// The self-test fails with this reason; only the microphone stream arrives.
    pub self_test_failure: Option<EngineErrorCode>,
    /// Raw stdout lines sent right after `ready`; a line that parses sets the next `seq`.
    pub raw_after_ready: Vec<String>,
    /// Milliseconds (tokio time) before each self-test event after the `ack`, with levels every
    /// 100 ms in between; 0 sends them all at once, without levels.
    pub self_test_pace_ms: u64,
    /// A `self_test_line` with this text follows each stream that arrives.
    pub self_test_line: Option<String>,
}

impl Default for Behaviour {
    fn default() -> Self {
        Self {
            launch_fails: false,
            protocol_version: Some(ENGINE_PROTOCOL_VERSION.to_string()),
            answer_ping: true,
            reject: false,
            hang: false,
            self_test_failure: None,
            raw_after_ready: Vec::new(),
            self_test_pace_ms: 0,
            self_test_line: None,
        }
    }
}

struct State {
    queue: VecDeque<Behaviour>,
    default: Behaviour,
    launches: usize,
    commands: Vec<EngineCommand>,
    kill: Option<oneshot::Sender<()>>,
    inject: Option<mpsc::UnboundedSender<EngineEvent>>,
    system_audio: PermissionState,
    script: Arc<Script>,
}

impl Default for State {
    fn default() -> Self {
        State {
            queue: VecDeque::new(),
            default: Behaviour::default(),
            launches: 0,
            commands: Vec::new(),
            kill: None,
            inject: None,
            system_audio: PermissionState::Granted,
            script: Arc::default(),
        }
    }
}

/// An [`EngineLauncher`] whose engines follow a script: queued behaviours for the next
/// launches, then the default one.
#[derive(Clone, Default)]
pub struct ScriptedEngine {
    state: Arc<Mutex<State>>,
}

impl ScriptedEngine {
    pub fn new() -> Self {
        Self::default()
    }

    /// The next launch behaves like this (queued in order).
    pub fn then(self, behaviour: Behaviour) -> Self {
        self.lock().queue.push_back(behaviour);
        self
    }

    /// Launches after the queue is used up behave like this.
    pub fn with_default(self, behaviour: Behaviour) -> Self {
        self.lock().default = behaviour;
        self
    }

    /// Engines of this launcher play `script` on top of their behaviour.
    pub fn with_script(self, script: Script) -> Self {
        self.lock().script = Arc::new(script);
        self
    }

    pub fn launches(&self) -> usize {
        self.lock().launches
    }

    /// Every command any engine of this script received, in order.
    pub fn commands(&self) -> Vec<EngineCommand> {
        self.lock().commands.clone()
    }

    /// The current engine dies: its stdout closes.
    pub fn kill_current(&self) {
        if let Some(kill) = self.lock().kill.take() {
            let _ = kill.send(());
        }
    }

    /// Sends `event` now on the current engine's stdout (next `seq`); `false` when no engine runs.
    pub fn inject(&self, event: EngineEvent) -> bool {
        self.lock()
            .inject
            .as_ref()
            .is_some_and(|tx| tx.send(event).is_ok())
    }

    /// What the system-audio tap hears in later self-tests: `Granted` both streams, `Denied`
    /// only zeros (`zero_buffers`), `NotAsked` nothing at all (`device_unavailable`).
    pub fn set_system_audio(&self, state: PermissionState) {
        self.lock().system_audio = state;
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

// @cpt-dod:cpt-noter-dod-core-harness-fixture:p1
impl EngineLauncher for ScriptedEngine {
    fn launch(&self) -> LaunchFuture<'_> {
        Box::pin(self.start())
    }
}

impl ScriptedEngine {
    async fn start(&self) -> io::Result<EngineIo> {
        let (behaviour, kill, inject, script) = {
            let mut s = self.lock();
            s.launches += 1;
            let b = s.queue.pop_front().unwrap_or_else(|| s.default.clone());
            if b.launch_fails {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "scripted launch failure",
                ));
            }
            let (tx, rx) = oneshot::channel();
            s.kill = Some(tx);
            let (inject_tx, inject_rx) = mpsc::unbounded_channel();
            s.inject = Some(inject_tx);
            (b, rx, inject_rx, s.script.clone())
        };
        let (core, engine) = tokio::io::duplex(1 << 16);
        let (stdout, stdin) = tokio::io::split(core);
        tokio::spawn(run(self.clone(), behaviour, script, engine, kill, inject));
        Ok(EngineIo {
            stdin: Box::new(stdin),
            stdout: Box::new(stdout),
        })
    }
}

struct Out<W> {
    w: W,
    seq: u64,
}

impl<W: AsyncWrite + Unpin> Out<W> {
    async fn emit(&mut self, event: EngineEvent) {
        self.seq += 1;
        let line = EngineEventLine {
            seq: self.seq,
            at: TimestampMs(0),
            event,
        };
        let text = serde_json::to_string(&line).unwrap_or_default();
        self.raw(&text).await;
    }

    async fn raw(&mut self, line: &str) {
        let _ = self.w.write_all(format!("{line}\n").as_bytes()).await;
    }
}

/// Queues the script's steps bound to `cmd`, due `after_ms` from now; same instant keeps file order.
fn schedule(due: &mut Vec<(Instant, Action)>, script: &Script, cmd: &EngineCommand) {
    let tag = serde_json::to_value(cmd).ok();
    let tag = tag.as_ref().and_then(|v| v["type"].as_str());
    let now = Instant::now();
    for step in script.steps.iter().filter(|s| Some(s.on.as_str()) == tag) {
        due.push((
            now + std::time::Duration::from_millis(step.after_ms),
            step.action.clone(),
        ));
    }
    due.sort_by_key(|(at, _)| *at);
}

// @cpt-algo:cpt-noter-algo-core-harness-scripted-engine:p1
async fn run(
    engine: ScriptedEngine,
    b: Behaviour,
    script: Arc<Script>,
    io: DuplexStream,
    mut kill: oneshot::Receiver<()>,
    mut inject: mpsc::UnboundedReceiver<EngineEvent>,
) {
    let (r, w) = tokio::io::split(io);
    let mut out = Out { w, seq: 0 };
    // @cpt-begin:cpt-noter-algo-core-harness-scripted-engine:p1:inst-ready
    if let Some(version) = &b.protocol_version {
        out.emit(EngineEvent::Ready {
            protocol_version: version.clone(),
            engine_version: "scripted".into(),
            models: Vec::new(),
            sandboxed: true,
        })
        .await;
    }
    // @cpt-end:cpt-noter-algo-core-harness-scripted-engine:p1:inst-ready
    for raw in &b.raw_after_ready {
        if let Ok(line) = serde_json::from_str::<EngineEventLine>(raw) {
            out.seq = line.seq;
        }
        out.raw(raw).await;
    }
    let mut lines = BufReader::new(r).lines();
    // Paced self-test events, each due at its instant, in order.
    let mut due: VecDeque<(Instant, EngineEvent)> = VecDeque::new();
    // Script steps, each due at its instant, in order.
    let mut steps: Vec<(Instant, Action)> = Vec::new();
    // @cpt-begin:cpt-noter-algo-core-harness-scripted-engine:p1:inst-for-commands
    loop {
        let next_due = due.front().map(|(at, _)| *at);
        let next_step = steps.first().map(|(at, _)| *at);
        let next = tokio::select! {
            biased;
            _ = &mut kill => return,
            _ = async { tokio::time::sleep_until(next_due.unwrap_or_else(Instant::now)).await }, if next_due.is_some() => {
                if let Some((_, event)) = due.pop_front() {
                    out.emit(event).await;
                }
                continue;
            }
            _ = async { tokio::time::sleep_until(next_step.unwrap_or_else(Instant::now)).await }, if next_step.is_some() => {
                match steps.remove(0).1 {
                    Action::Event(event) => out.emit(*event).await,
                    // @cpt-begin:cpt-noter-algo-core-harness-scripted-engine:p1:inst-return-engine
                    Action::Kill => return,
                    // @cpt-end:cpt-noter-algo-core-harness-scripted-engine:p1:inst-return-engine
                }
                continue;
            }
            Some(event) = inject.recv() => {
                out.emit(event).await;
                continue;
            }
            next = lines.next_line() => next,
        };
        // @cpt-begin:cpt-noter-algo-core-harness-scripted-engine:p1:inst-return-engine
        let Ok(Some(line)) = next else { return };
        // @cpt-end:cpt-noter-algo-core-harness-scripted-engine:p1:inst-return-engine
        let Ok(EngineCommandLine { id, cmd }) = serde_json::from_str(&line) else {
            continue;
        };
        engine.lock().commands.push(cmd.clone());
        if b.hang {
            continue;
        }
        // @cpt-begin:cpt-noter-algo-core-harness-scripted-engine:p1:inst-ack-command
        let ack = EngineEvent::Ack { cmd_id: id };
        match cmd {
            EngineCommand::Ping => {
                if b.answer_ping {
                    out.emit(EngineEvent::Pong).await;
                }
            }
            // @cpt-begin:cpt-noter-algo-core-harness-scripted-engine:p1:inst-return-engine
            EngineCommand::Shutdown => {
                out.emit(ack).await;
                return;
            }
            // @cpt-end:cpt-noter-algo-core-harness-scripted-engine:p1:inst-return-engine
            _ if b.reject => {
                out.emit(EngineEvent::Error {
                    cmd_id: Some(id),
                    code: EngineErrorCode::BadCommand,
                    message: "scripted rejection".into(),
                })
                .await;
            }
            EngineCommand::SelfTest { .. } => {
                out.emit(ack).await;
                schedule(&mut steps, &script, &cmd);
                // @cpt-begin:cpt-noter-algo-core-harness-scripted-engine:p1:inst-start-section
                let failure = b.self_test_failure.or(match engine.lock().system_audio {
                    PermissionState::Granted => None,
                    PermissionState::Denied => Some(EngineErrorCode::ZeroBuffers),
                    // A channel that delivers nothing, as the engine reports it.
                    _ => Some(EngineErrorCode::DeviceUnavailable),
                });
                let mut events = Vec::new();
                let channels = [AudioChannel::Mic, AudioChannel::Sys];
                for channel in &channels[..if failure.is_none() { 2 } else { 1 }] {
                    events.push(EngineEvent::SelfTestStream { channel: *channel });
                    if let Some(text) = &b.self_test_line {
                        events.push(EngineEvent::SelfTestLine {
                            channel: *channel,
                            text: text.clone(),
                        });
                    }
                }
                events.push(EngineEvent::SelfTestResult {
                    passed: failure.is_none(),
                    failure,
                    own_sounds_leak: false,
                });
                // A new self-test cancels the rest of the previous one, as the real engine does.
                due.clear();
                if b.self_test_pace_ms == 0 {
                    for event in events {
                        out.emit(event).await;
                    }
                } else {
                    let step = std::time::Duration::from_millis(b.self_test_pace_ms);
                    let now = Instant::now();
                    let mut timed: Vec<_> = events
                        .into_iter()
                        .enumerate()
                        .map(|(i, e)| (step * (i as u32 + 1), e))
                        .collect();
                    // Level meters move while the test runs, at most every 100 ms like the engine's.
                    let end = timed.last().map_or(step, |(t, _)| *t);
                    let sys_db = if failure.is_none() { -30.0 } else { -120.0 };
                    let mut t = LEVELS_EVERY;
                    while t < end {
                        timed.push((
                            t,
                            EngineEvent::Levels {
                                call_id: None,
                                mic_db: -30.0,
                                sys_db,
                            },
                        ));
                        t += LEVELS_EVERY;
                    }
                    timed.sort_by_key(|(t, _)| *t); // stable: a stream comes before a level at its instant
                    due.extend(timed.into_iter().map(|(t, e)| (now + t, e)));
                }
                // @cpt-end:cpt-noter-algo-core-harness-scripted-engine:p1:inst-start-section
            }
            _ => {
                out.emit(ack).await;
                // @cpt-begin:cpt-noter-algo-core-harness-scripted-engine:p1:inst-start-section
                schedule(&mut steps, &script, &cmd);
                // @cpt-end:cpt-noter-algo-core-harness-scripted-engine:p1:inst-start-section
            }
        }
        // @cpt-end:cpt-noter-algo-core-harness-scripted-engine:p1:inst-ack-command
    }
    // @cpt-end:cpt-noter-algo-core-harness-scripted-engine:p1:inst-for-commands
}
