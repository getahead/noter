//! A scripted engine over an in-memory pipe, for the supervisor's tests and for
//! `noter-core-harness` (decision D3: in M0 it answers `ready`, `ack`, `pong` and the
//! self-test; replaying recordings comes with the engine's file mode in M1).

use std::collections::VecDeque;
use std::io;
use std::sync::{Arc, Mutex, MutexGuard};

use noter_protocol::engine::{
    EngineCommand, EngineCommandLine, EngineErrorCode, EngineEvent, EngineEventLine,
    ENGINE_PROTOCOL_VERSION,
};
use noter_protocol::{AudioChannel, TimestampMs};
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader, DuplexStream};
use tokio::sync::oneshot;

use crate::launch::{EngineIo, EngineLauncher};

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
        }
    }
}

#[derive(Default)]
struct State {
    queue: VecDeque<Behaviour>,
    default: Behaviour,
    launches: usize,
    commands: Vec<EngineCommand>,
    kill: Option<oneshot::Sender<()>>,
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

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl EngineLauncher for ScriptedEngine {
    async fn launch(&self) -> io::Result<EngineIo> {
        let (behaviour, kill) = {
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
            (b, rx)
        };
        let (core, engine) = tokio::io::duplex(1 << 16);
        let (stdout, stdin) = tokio::io::split(core);
        tokio::spawn(run(self.clone(), behaviour, engine, kill));
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

async fn run(
    engine: ScriptedEngine,
    b: Behaviour,
    io: DuplexStream,
    mut kill: oneshot::Receiver<()>,
) {
    let (r, w) = tokio::io::split(io);
    let mut out = Out { w, seq: 0 };
    if let Some(version) = &b.protocol_version {
        out.emit(EngineEvent::Ready {
            protocol_version: version.clone(),
            engine_version: "scripted".into(),
            models: Vec::new(),
            sandboxed: true,
        })
        .await;
    }
    for raw in &b.raw_after_ready {
        if let Ok(line) = serde_json::from_str::<EngineEventLine>(raw) {
            out.seq = line.seq;
        }
        out.raw(raw).await;
    }
    let mut lines = BufReader::new(r).lines();
    loop {
        let next = tokio::select! {
            _ = &mut kill => return,
            next = lines.next_line() => next,
        };
        let Ok(Some(line)) = next else { return };
        let Ok(EngineCommandLine { id, cmd }) = serde_json::from_str(&line) else {
            continue;
        };
        engine.lock().commands.push(cmd.clone());
        if b.hang {
            continue;
        }
        let ack = EngineEvent::Ack { cmd_id: id };
        match cmd {
            EngineCommand::Ping => {
                if b.answer_ping {
                    out.emit(EngineEvent::Pong).await;
                }
            }
            EngineCommand::Shutdown => {
                out.emit(ack).await;
                return;
            }
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
                out.emit(EngineEvent::SelfTestStream {
                    channel: AudioChannel::Mic,
                })
                .await;
                if b.self_test_failure.is_none() {
                    out.emit(EngineEvent::SelfTestStream {
                        channel: AudioChannel::Sys,
                    })
                    .await;
                }
                out.emit(EngineEvent::SelfTestResult {
                    passed: b.self_test_failure.is_none(),
                    failure: b.self_test_failure,
                    own_sounds_leak: false,
                })
                .await;
            }
            _ => out.emit(ack).await,
        }
    }
}
