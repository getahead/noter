//! `noter-core-harness`: a `CoreApi` without Tauri, over the JSON Lines wire format of
//! docs/HARNESS.md › noter-core-harness wire format, for the conformance suite and the UI E2E
//! flows (`apps/desktop/tests/support/stdio-transport.ts`). Never shipped.
//!
//! ```text
//! → {"id": 7, "window": "main", "cmd": "item_set_done", "args": {…}, "channel": false}
//! ← {"id": 7, "ok": <result>}  |  {"id": 7, "error": <CoreError>}
//! ← {"id": 7, "message": <Channel message>}     (after the result of its subscribing command)
//! ← {"event": "entity:changed", "payload": <whole state>}
//! ```

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

pub mod boot;

use noter_protocol::ipc::{dispatch_json, Caller, CommandCtx, CoreApi, Sink};
use noter_protocol::model::WindowLabel;
use noter_protocol::{CoreError, ErrorCode, ErrorDetail};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;
use tokio::task::{JoinHandle, JoinSet};

/// Sends protocol lines to the one writer task of an [`Output`]; clones share it, so lines never
/// interleave. A send returns `false` once the output has ended.
#[derive(Clone)]
pub struct Lines(mpsc::UnboundedSender<Option<String>>);

impl Lines {
    fn send(&self, line: Value) -> bool {
        self.0.send(Some(line.to_string())).is_ok()
    }

    /// `{"event", "payload"}` for an event the core emits.
    pub fn event(&self, event: &str, payload: Value) -> bool {
        self.send(json!({ "event": event, "payload": payload }))
    }
}

// @cpt-dod:cpt-noter-dod-core-harness-wire:p1
/// The harness's stdout: one task writes every line and flushes it, so nothing but protocol
/// lines reaches the stream (logs go to stderr).
pub struct Output {
    lines: Lines,
    writer: JoinHandle<std::io::Result<()>>,
}

impl Output {
    pub fn new<W: AsyncWrite + Unpin + Send + 'static>(mut out: W) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<Option<String>>();
        let writer = tokio::spawn(async move {
            // `None` ends the output even while Channels still hold a sender.
            while let Some(Some(line)) = rx.recv().await {
                out.write_all(line.as_bytes()).await?;
                out.write_all(b"\n").await?;
                out.flush().await?;
            }
            out.shutdown().await
        });
        Self {
            lines: Lines(tx),
            writer,
        }
    }

    /// A handle for the core's event emitter.
    pub fn lines(&self) -> Lines {
        self.lines.clone()
    }
}

#[derive(Deserialize)]
struct Request {
    id: u64,
    window: WindowLabel,
    cmd: String,
    #[serde(default = "no_args")]
    args: Value,
    #[serde(default)]
    channel: bool,
}

fn no_args() -> Value {
    json!({})
}

// @cpt-flow:cpt-noter-flow-core-harness-session:p1
/// Serves request lines from `input` until it ends: one task per request, so a slow command or
/// an open stream never holds up the next line. At the end of input it waits for every answer,
/// then ends `output`.
pub async fn serve<C: CoreApi, R: AsyncRead + Unpin>(
    core: Arc<C>,
    input: R,
    output: Output,
) -> std::io::Result<()> {
    serve_with(core, Arc::new(NoControls), input, output).await
}

/// A boxed future, so [`Controls`] stays object-safe.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// What the harness adds around a core: the scenario controls (`harness.<name>` requests,
/// docs/TEST-PLAN.md › The scenario layer) and the shutdown at the end of input.
pub trait Controls: Send + Sync + 'static {
    /// `harness.<name>` with its arguments; `harness.fail_next` is handled by [`serve_with`].
    fn control<'a>(&'a self, name: &'a str, args: Value)
        -> BoxFuture<'a, Result<Value, CoreError>>;
    /// Runs once stdin has ended and every answer is written, before the output ends, so the
    /// core can still end its streams with `shutdown`.
    fn shutdown(&self) -> BoxFuture<'_, ()>;
}

struct NoControls;

impl Controls for NoControls {
    fn control<'a>(&'a self, name: &'a str, _: Value) -> BoxFuture<'a, Result<Value, CoreError>> {
        Box::pin(async move { Err(invalid(&format!("no control harness.{name}"))) })
    }
    fn shutdown(&self) -> BoxFuture<'_, ()> {
        Box::pin(async {})
    }
}

/// `harness.fail_next`: the next call of a command from a window fails with this error, once.
type FailNext = Arc<Mutex<HashMap<(WindowLabel, String), CoreError>>>;

#[derive(Deserialize)]
struct FailNextArgs {
    window: WindowLabel,
    cmd: String,
    code: ErrorCode,
    #[serde(default)]
    detail: Option<ErrorDetail>,
}

/// [`serve`] with the harness's controls.
pub async fn serve_with<C: CoreApi, R: AsyncRead + Unpin>(
    core: Arc<C>,
    controls: Arc<dyn Controls>,
    input: R,
    output: Output,
) -> std::io::Result<()> {
    let fails: FailNext = Arc::default();
    let mut input = BufReader::new(input);
    let mut tasks = JoinSet::new();
    let mut buf = Vec::new();
    // @cpt-begin:cpt-noter-flow-core-harness-session:p1:inst-request
    while {
        buf.clear();
        input.read_until(b'\n', &mut buf).await? > 0
    } {
        let line = String::from_utf8_lossy(&buf).trim().to_string();
        if line.is_empty() {
            continue;
        }
        // @cpt-end:cpt-noter-flow-core-harness-session:p1:inst-request
        let (core, controls, fails, out) = (
            core.clone(),
            controls.clone(),
            fails.clone(),
            output.lines(),
        );
        // @cpt-begin:cpt-noter-flow-core-harness-session:p1:inst-dispatch
        tasks.spawn(async move { dispatch(&*core, &*controls, &fails, &line, &out).await });
        // @cpt-end:cpt-noter-flow-core-harness-session:p1:inst-dispatch
    }
    // @cpt-begin:cpt-noter-flow-core-harness-session:p1:inst-if-eof
    // @cpt-begin:cpt-noter-flow-core-harness-session:p1:inst-return-exit
    while tasks.join_next().await.is_some() {}
    controls.shutdown().await;
    output.lines.0.send(None).ok();
    output.writer.await.map_err(std::io::Error::other)?
    // @cpt-end:cpt-noter-flow-core-harness-session:p1:inst-return-exit
    // @cpt-end:cpt-noter-flow-core-harness-session:p1:inst-if-eof
}

// @cpt-algo:cpt-noter-algo-core-harness-dispatch:p1
/// One request line: parse it, run the command as the IPC host would for that window (scope
/// check, then arguments), write the result or error line, then release held Channel messages.
async fn dispatch<C: CoreApi>(
    core: &C,
    controls: &dyn Controls,
    fails: &FailNext,
    line: &str,
    out: &Lines,
) {
    // @cpt-begin:cpt-noter-algo-core-harness-dispatch:p1:inst-parse-line
    let raw: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => {
            out.send(json!({ "id": null, "error": invalid("the request line is not JSON") }));
            return;
        }
    };
    let id = raw.get("id").cloned().unwrap_or(Value::Null);
    let req: Request = match serde_json::from_value(raw) {
        Ok(r) => r,
        Err(_) => {
            out.send(json!({ "id": id, "error": invalid("a request needs a numeric id, a window and a cmd") }));
            return;
        }
    };
    // @cpt-end:cpt-noter-algo-core-harness-dispatch:p1:inst-parse-line
    // @cpt-begin:cpt-noter-algo-core-harness-dispatch:p1:inst-ctx-scope
    let ctx = CommandCtx {
        caller: Caller::Window { label: req.window },
    };
    // @cpt-begin:cpt-noter-algo-core-harness-dispatch:p1:inst-channel-sink
    let held = req.channel.then(|| Held::new(req.id, out.clone()));
    // @cpt-end:cpt-noter-algo-core-harness-dispatch:p1:inst-channel-sink
    let failed = lock(fails).remove(&(req.window, req.cmd.clone()));
    // @cpt-begin:cpt-noter-algo-core-harness-dispatch:p1:inst-call
    let result = if req.cmd == "harness.fail_next" {
        fail_next(fails, req.args)
    } else if let Some(name) = req.cmd.strip_prefix("harness.") {
        controls.control(name, req.args).await
    } else if let Some(error) = failed {
        Err(error)
    } else {
        dispatch_json(
            core,
            &ctx,
            &req.cmd,
            req.args,
            held.as_ref().map(Held::sink),
        )
        .await
    };
    // @cpt-end:cpt-noter-algo-core-harness-dispatch:p1:inst-call
    // @cpt-end:cpt-noter-algo-core-harness-dispatch:p1:inst-ctx-scope
    // @cpt-begin:cpt-noter-algo-core-harness-dispatch:p1:inst-write-ordered
    // @cpt-begin:cpt-noter-algo-core-harness-dispatch:p1:inst-return-dispatch
    // @cpt-begin:cpt-noter-flow-core-harness-session:p1:inst-write-result
    match result {
        Ok(ok) => {
            out.send(json!({ "id": req.id, "ok": ok }));
            if let Some(h) = held {
                h.release();
            }
        }
        Err(error) => {
            out.send(json!({ "id": req.id, "error": error }));
            if let Some(h) = held {
                h.close();
            }
        }
    }
    // @cpt-end:cpt-noter-flow-core-harness-session:p1:inst-write-result
    // @cpt-end:cpt-noter-algo-core-harness-dispatch:p1:inst-return-dispatch
    // @cpt-end:cpt-noter-algo-core-harness-dispatch:p1:inst-write-ordered
}

fn fail_next(fails: &FailNext, args: Value) -> Result<Value, CoreError> {
    let a: FailNextArgs = serde_json::from_value(args)
        .map_err(|_| invalid("harness.fail_next needs window, cmd and code"))?;
    let mut error = CoreError::new(a.code, "harness.fail_next");
    error.detail = a.detail;
    lock(fails).insert((a.window, a.cmd), error);
    Ok(json!({}))
}

pub(crate) fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn internal(e: impl std::fmt::Display) -> CoreError {
    CoreError::new(ErrorCode::Internal, e.to_string())
}

fn invalid(message: &str) -> CoreError {
    CoreError::new(ErrorCode::InvalidInput, message)
}

/// The Channel of one subscribing request: messages wait until its result line is written.
enum Gate {
    Holding(Vec<Value>),
    Open,
    Closed,
}

struct Held {
    id: u64,
    out: Lines,
    gate: Arc<Mutex<Gate>>,
}

impl Held {
    fn new(id: u64, out: Lines) -> Self {
        Self {
            id,
            out,
            gate: Arc::new(Mutex::new(Gate::Holding(vec![]))),
        }
    }

    fn sink(&self) -> Sink<Value> {
        let (id, out, gate) = (self.id, self.out.clone(), self.gate.clone());
        Sink::new(move |message| match &mut *lock(&gate) {
            Gate::Holding(buf) => {
                buf.push(message);
                true
            }
            Gate::Open => out.send(json!({ "id": id, "message": message })),
            Gate::Closed => false,
        })
    }

    /// Writes the held messages in order and opens the Channel, under the sink's own lock, so a
    /// message sent meanwhile can neither be lost nor overtake them.
    fn release(self) {
        let mut gate = lock(&self.gate);
        if let Gate::Holding(buf) = std::mem::replace(&mut *gate, Gate::Open) {
            for message in buf {
                self.out.send(json!({ "id": self.id, "message": message }));
            }
        }
    }

    /// The command was refused: its messages are dropped and the core sees the Channel closed.
    fn close(self) {
        *lock(&self.gate) = Gate::Closed;
    }
}
