//! FEATURE cpt-noter-feature-core-mcp (slice 1): the core's side of noter-mcp. `McpRuns` holds
//! the runs the router registered (token → trusted context + allowed tools), `serve_socket`
//! answers `CoreSocketRequest`s on `<data>/run/core.sock` and the entity read tools run over the
//! existing read services.
//!
//! Socket framing: newline-delimited JSON, one JSON-RPC 2.0 message per line (at most
//! [`MAX_FRAME`] bytes), a response per request on the same connection. A connection binds to
//! the first run it authenticates; another run's token on it is refused.
//!
//! Slice 1 serves `get_transcript_span`, `get_person`, `get_decisions`, `get_open_items` and
//! `get_screen_context`; other tools are dropped from a run's allow-list. The cloud result gate
//! (`release_result`) is slice 2: until it lands a cloud run's results are refused with −32603
//! after the sensitive-call filter, never released unredacted.

use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};

use noter_db::rusqlite::types::Value as Sql;
use noter_db::rusqlite::{Connection, OptionalExtension};
use noter_protocol::mcp::*;
use noter_protocol::model::*;
use noter_protocol::{CallId, CoreError, ErrorCode, LocalDate, PersonId};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::watch;

use crate::{internal, lock, to_json, Core};

/// The tools this slice answers; a registration keeps only these.
const SERVED: &[&str] = &[
    "get_transcript_span",
    "get_person",
    "get_decisions",
    "get_open_items",
    "get_screen_context",
];
const MAX_FRAME: u64 = 1 << 20;
/// Most items one read returns, newest first.
const MAX_ITEMS: usize = 50;
const MAX_RECENT_CALLS: usize = 10;

const PARAMS: Rpc = (-32602, "invalid params");
const FORBIDDEN: Rpc = (-32001, "not allowed for this run");
const MISSING: Rpc = (-32002, "not found");
const INTERNAL: Rpc = (-32603, "internal error");

/// A JSON-RPC error code and its fixed message: nothing in it names a record.
type Rpc = (i32, &'static str);

/// What the router tells the core about a run it is about to start.
pub struct McpRegistration {
    /// The `llm_runs` row of the run; also the config's file name.
    pub llm_run_id: String,
    pub call_id: Option<CallId>,
    pub cloud: bool,
    pub tools: Vec<String>,
}

/// `cpt-noter-state-core-mcp-session`; closing and closed runs are not listed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpSession {
    Registered,
    Active,
}

#[derive(PartialEq)]
enum State {
    Registered,
    Active,
    Closing,
}

struct Run {
    /// The trusted context: the child's own claims never replace it.
    ctx: McpRunContext,
    tools: Vec<String>,
    state: State,
    /// `true` ends the run's connections and in-flight work.
    cancel: watch::Sender<bool>,
    config: PathBuf,
}

pub(crate) struct McpRuns {
    runs: Mutex<Vec<Run>>,
    serving: Mutex<Option<PathBuf>>,
    /// `true` when the core shuts down.
    stop: watch::Sender<bool>,
}

impl Default for McpRuns {
    fn default() -> Self {
        McpRuns {
            runs: Mutex::default(),
            serving: Mutex::default(),
            stop: watch::channel(false).0,
        }
    }
}

/// The checked context of one request.
struct Trusted {
    run_id: String,
    cloud: bool,
    cancel: watch::Receiver<bool>,
}

fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = u8::from(a.len() != b.len());
    for i in 0..a.len().max(b.len()) {
        diff |= a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0);
    }
    diff == 0
}

/// 32 random bytes as hex.
fn new_token() -> Result<String, CoreError> {
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| std::io::Read::read_exact(&mut f, &mut bytes))
        .map_err(internal)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn private_dir(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

impl Core {
    /// `<data>/run/core.sock`, unless that is too long for a `sockaddr_un` (about 104 bytes):
    /// then a 0700 folder under the temp dir named by a hash of the data folder. The run configs
    /// carry whichever path is used.
    fn socket_path(&self) -> PathBuf {
        let preferred = self.data_dir.join("run").join("core.sock");
        if preferred.as_os_str().len() < 100 {
            return preferred;
        }
        use sha2::{Digest, Sha256};
        let hash = Sha256::digest(self.data_dir.as_os_str().as_encoded_bytes());
        let tag: String = hash.iter().take(4).map(|b| format!("{b:02x}")).collect();
        std::env::temp_dir()
            .join(format!("noter-{tag}"))
            .join("core.sock")
    }

    /// Startup cleanup: no run survives a restart, so every config left in `run/mcp` is stale.
    // @cpt-begin:cpt-noter-algo-core-mcp-close:p1:inst-close-return
    pub(crate) fn discard_stale_mcp_configs(data_dir: &Path) {
        let _ = std::fs::remove_dir_all(data_dir.join("run").join("mcp"));
    }
    // @cpt-end:cpt-noter-algo-core-mcp-close:p1:inst-close-return

    /// The router registers a run before it starts the CLI: the core binds a fresh token to the
    /// run's trusted context and writes the 0600 config `noter-mcp` reads. Returns the token (the
    /// child's `NOTER_MCP_TOKEN`) and the config path.
    // @cpt-flow:cpt-noter-flow-core-mcp-start:p1
    // @cpt-state:cpt-noter-state-core-mcp-session:p1
    pub fn register_mcp_run(&self, reg: McpRegistration) -> Result<(String, PathBuf), CoreError> {
        let valid = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-';
        if reg.llm_run_id.is_empty() || !reg.llm_run_id.chars().all(valid) {
            return Err(CoreError::new(ErrorCode::InvalidInput, "bad run id"));
        }
        let mut tools: Vec<String> = Vec::new();
        for tool in reg.tools {
            if SERVED.contains(&tool.as_str()) && !tools.contains(&tool) {
                tools.push(tool);
            }
        }
        // @cpt-begin:cpt-noter-flow-core-mcp-start:p1:inst-start-register
        let token = new_token()?;
        let ctx = McpRunContext {
            token: token.clone(),
            llm_run_id: reg.llm_run_id,
            call_id: reg.call_id,
            cloud: reg.cloud,
        };
        // @cpt-end:cpt-noter-flow-core-mcp-start:p1:inst-start-register
        // @cpt-begin:cpt-noter-flow-core-mcp-start:p1:inst-start-config
        let run_dir = self.data_dir.join("run");
        let dir = run_dir.join("mcp");
        private_dir(&run_dir).map_err(internal)?;
        private_dir(&dir).map_err(internal)?;
        let config = dir.join(format!("{}.json", ctx.llm_run_id));
        let body = json!({
            "socket": self.socket_path(),
            "run_id": ctx.llm_run_id,
            "call_id": ctx.call_id,
            "cloud": ctx.cloud,
            "tools": tools,
        });
        {
            let mut runs = lock(&self.mcp.runs);
            if runs.iter().any(|r| r.ctx.llm_run_id == ctx.llm_run_id) {
                return Err(CoreError::new(
                    ErrorCode::InvalidInput,
                    "run already registered",
                ));
            }
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&config)
                .and_then(|mut f| f.write_all(body.to_string().as_bytes()))
                .map_err(internal)?;
            runs.push(Run {
                ctx,
                tools,
                state: State::Registered,
                cancel: watch::channel(false).0,
                config: config.clone(),
            });
        }
        // @cpt-end:cpt-noter-flow-core-mcp-start:p1:inst-start-config
        Ok((token, config))
    }

    /// Where the run is in `cpt-noter-state-core-mcp-session`; `None` once closed (or never
    /// registered).
    pub fn mcp_session(&self, run_id: &str) -> Option<McpSession> {
        lock(&self.mcp.runs)
            .iter()
            .find(|r| r.ctx.llm_run_id == run_id)
            .and_then(|r| match r.state {
                State::Registered => Some(McpSession::Registered),
                State::Active => Some(McpSession::Active),
                State::Closing => None,
            })
    }

    /// A run ended, timed out, was cancelled or lost its CLI: revoke its token, end its
    /// connections and in-flight work, remove the secret-bearing config. Committed audit and
    /// staged records stay. Idempotent; `false` when no such run was registered.
    // @cpt-algo:cpt-noter-algo-core-mcp-close:p1
    pub fn close_mcp_run(&self, run_id: &str) -> bool {
        // @cpt-begin:cpt-noter-algo-core-mcp-close:p1:inst-close-revoke
        // @cpt-begin:cpt-noter-state-core-mcp-session:p1:inst-session-closing
        // @cpt-begin:cpt-noter-state-core-mcp-session:p1:inst-session-start-failed
        let (cancel, config) = {
            let mut runs = lock(&self.mcp.runs);
            let Some(run) = runs.iter_mut().find(|r| r.ctx.llm_run_id == run_id) else {
                return false;
            };
            run.state = State::Closing;
            (run.cancel.clone(), run.config.clone())
        };
        // @cpt-end:cpt-noter-state-core-mcp-session:p1:inst-session-start-failed
        // @cpt-end:cpt-noter-state-core-mcp-session:p1:inst-session-closing
        let _ = cancel.send(true);
        // @cpt-end:cpt-noter-algo-core-mcp-close:p1:inst-close-revoke
        // @cpt-begin:cpt-noter-algo-core-mcp-close:p1:inst-close-resources
        // The run's connections end on `cancel`; no per-call cache or redaction map exists yet.
        // @cpt-end:cpt-noter-algo-core-mcp-close:p1:inst-close-resources
        // @cpt-begin:cpt-noter-algo-core-mcp-close:p1:inst-close-files
        let _ = std::fs::remove_file(config);
        // @cpt-end:cpt-noter-algo-core-mcp-close:p1:inst-close-files
        // @cpt-begin:cpt-noter-state-core-mcp-session:p1:inst-session-closed
        lock(&self.mcp.runs).retain(|r| r.ctx.llm_run_id != run_id);
        // @cpt-end:cpt-noter-state-core-mcp-session:p1:inst-session-closed
        true
    }

    /// Ends the socket and every run; called by `shutdown`.
    pub(crate) fn close_mcp(&self) {
        let _ = self.mcp.stop.send(true);
        let ids: Vec<String> = lock(&self.mcp.runs)
            .iter()
            .map(|r| r.ctx.llm_run_id.clone())
            .collect();
        for id in ids {
            self.close_mcp_run(&id);
        }
        if let Some(path) = lock(&self.mcp.serving).take() {
            let _ = std::fs::remove_file(path);
        }
    }

    /// Starts answering on `<data>/run/core.sock` (0600) and returns its path; one task per
    /// connection. Already serving: the same path.
    pub async fn serve_socket(self: &Arc<Self>) -> Result<PathBuf, CoreError> {
        if let Some(path) = lock(&self.mcp.serving).clone() {
            return Ok(path);
        }
        let path = self.socket_path();
        private_dir(path.parent().unwrap_or(&self.data_dir)).map_err(internal)?;
        let _ = std::fs::remove_file(&path);
        let listener = UnixListener::bind(&path).map_err(internal)?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(internal)?;
        *lock(&self.mcp.serving) = Some(path.clone());
        let core = Arc::downgrade(self);
        let mut stop = self.mcp.stop.subscribe();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { break };
                        tokio::spawn(connection(core.clone(), stream));
                    }
                    _ = stop.wait_for(|s| *s) => break,
                }
            }
        });
        Ok(path)
    }

    /// One request line to its response; `bound` is the run this connection serves.
    fn answer(&self, line: &str, bound: &mut Option<Trusted>) -> CoreSocketResponse {
        // @cpt-begin:cpt-noter-algo-core-mcp-authorize:p1:inst-auth-params
        let envelope = serde_json::from_str::<CoreSocketRequest>(line)
            .ok()
            .filter(|r| r.jsonrpc == "2.0");
        let Some(req) = envelope else {
            let id = serde_json::from_str::<Value>(line)
                .ok()
                .and_then(|v| v["id"].as_u64())
                .unwrap_or(0);
            return respond(id, Err(PARAMS));
        };
        // @cpt-end:cpt-noter-algo-core-mcp-authorize:p1:inst-auth-params
        // @cpt-begin:cpt-noter-flow-core-mcp-read:p1:inst-read-authorize
        let authorized = self.authorize(&req);
        // @cpt-end:cpt-noter-flow-core-mcp-read:p1:inst-read-authorize
        let result = authorized.and_then(|trusted| {
            if bound.as_ref().is_some_and(|b| b.run_id != trusted.run_id) {
                return Err(FORBIDDEN);
            }
            let run_id = trusted.run_id.clone();
            let value = self.dispatch(&trusted, &req.method, req.params);
            bound.get_or_insert(trusted);
            // @cpt-begin:cpt-noter-algo-core-mcp-close:p1:inst-close-late
            // A run closed while the read ran gets no late result.
            if self.mcp_live(&run_id) {
                value
            } else {
                Err(FORBIDDEN)
            }
            // @cpt-end:cpt-noter-algo-core-mcp-close:p1:inst-close-late
        });
        respond(req.id, result)
    }

    fn mcp_live(&self, run_id: &str) -> bool {
        lock(&self.mcp.runs)
            .iter()
            .any(|r| r.ctx.llm_run_id == run_id && r.state != State::Closing)
    }

    // @cpt-algo:cpt-noter-algo-core-mcp-authorize:p1
    fn authorize(&self, req: &CoreSocketRequest) -> Result<Trusted, Rpc> {
        let mut runs = lock(&self.mcp.runs);
        // @cpt-begin:cpt-noter-algo-core-mcp-authorize:p1:inst-auth-token
        // Every run is compared, so the time taken says nothing about a token's prefix.
        let mut found = None;
        for (i, run) in runs.iter().enumerate() {
            if same(&run.ctx.token, &req.context.token) {
                found = Some(i);
            }
        }
        let run = found.map(|i| &mut runs[i]).ok_or(FORBIDDEN)?;
        if run.state == State::Closing {
            return Err(FORBIDDEN);
        }
        // @cpt-end:cpt-noter-algo-core-mcp-authorize:p1:inst-auth-token
        // @cpt-begin:cpt-noter-algo-core-mcp-authorize:p1:inst-auth-context
        // The child's `cloud` and `call_id` claims are not read: the registered ones rule.
        if req.context.llm_run_id != run.ctx.llm_run_id {
            return Err(FORBIDDEN);
        }
        // @cpt-end:cpt-noter-algo-core-mcp-authorize:p1:inst-auth-context
        // @cpt-begin:cpt-noter-algo-core-mcp-authorize:p1:inst-auth-tool
        if !run.tools.contains(&req.method) {
            return Err(FORBIDDEN);
        }
        // @cpt-end:cpt-noter-algo-core-mcp-authorize:p1:inst-auth-tool
        // @cpt-begin:cpt-noter-state-core-mcp-session:p1:inst-session-active
        run.state = State::Active;
        // @cpt-end:cpt-noter-state-core-mcp-session:p1:inst-session-active
        // @cpt-begin:cpt-noter-algo-core-mcp-authorize:p1:inst-auth-return
        Ok(Trusted {
            run_id: run.ctx.llm_run_id.clone(),
            cloud: run.ctx.cloud,
            cancel: run.cancel.subscribe(),
        })
        // @cpt-end:cpt-noter-algo-core-mcp-authorize:p1:inst-auth-return
    }

    // @cpt-flow:cpt-noter-flow-core-mcp-read:p1
    fn dispatch(&self, t: &Trusted, method: &str, params: Value) -> Result<Value, Rpc> {
        // The call a run belongs to does not narrow its reads (an Ask or a review looks across
        // the library); what a cloud run cannot read is a sensitive call.
        let value = self.read_tool(t, method, params)?;
        // shortcut: no release gate yet (slice 2), so a cloud run's result is refused, never
        // released unredacted.
        if t.cloud {
            return Err(INTERNAL);
        }
        Ok(value)
    }

    /// The tool's result before the release gate; sensitive calls are already excluded for a
    /// cloud run.
    fn read_tool(&self, t: &Trusted, method: &str, params: Value) -> Result<Value, Rpc> {
        fn typed<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, Rpc> {
            serde_json::from_value(params).map_err(|_| PARAMS)
        }
        let read = |f: &dyn Fn(&Connection) -> noter_db::rusqlite::Result<Result<Value, Rpc>>| {
            self.store.read(f).map_err(|_| INTERNAL)?
        };
        // @cpt-begin:cpt-noter-flow-core-mcp-read:p1:inst-read-entities
        match method {
            "get_transcript_span" => {
                let a: GetTranscriptSpanInput = typed(params)?;
                if a.t1_ms.0 <= a.t0_ms.0 {
                    return Err(PARAMS);
                }
                read(&|c| {
                    if let Err(e) = call_access(c, &a.call_id, t.cloud)? {
                        return Ok(Err(e));
                    }
                    let lines = crate::transcript::segments_of(
                        c,
                        &a.call_id,
                        Some((a.channel, a.t0_ms, a.t1_ms)),
                    )?
                    .into_iter()
                    .map(|s| SpanLine {
                        segment_id: s.id,
                        t0_ms: s.t0_ms,
                        speaker: speaker_name(&s.speaker.label),
                        lang: s.lang,
                        text: s.text,
                    })
                    .collect();
                    Ok(Ok(to_json(&GetTranscriptSpanOutput { lines })))
                })
            }
            "get_screen_context" => {
                let a: GetScreenContextInput = typed(params)?;
                // @cpt-begin:cpt-noter-flow-core-mcp-read:p1:inst-read-screen
                read(&|c| {
                    Ok(call_access(c, &a.call_id, t.cloud)?
                        .map(|()| to_json(&ScreenContextOutput { chips: vec![] })))
                })
                // @cpt-end:cpt-noter-flow-core-mcp-read:p1:inst-read-screen
            }
            "get_open_items" => {
                let a: GetOpenItemsInput = typed(params)?;
                let mut clause = String::from(OPEN);
                let mut args = vec![];
                if let Some(owner) = &a.owner {
                    clause.push_str(" AND i.owner_person_id = ?");
                    args.push(Sql::Text(owner.as_str().into()));
                }
                owners_in(&mut clause, &mut args, &a.people);
                read(&|c| {
                    let items = items_of(c, &clause, args.clone(), t.cloud, |_| true)?;
                    Ok(Ok(to_json(&ItemsOutput { items })))
                })
            }
            "get_decisions" => {
                let a: GetDecisionsInput = typed(params)?;
                let mut clause =
                    String::from("i.kind = 'decision' AND i.review_state != 'rejected'");
                let mut args = vec![];
                if let Some(topic) = &a.topic_id {
                    clause.push_str(" AND i.topic_id = ?");
                    args.push(Sql::Text(topic.as_str().into()));
                }
                if let Some(since) = &a.since {
                    crate::library::day_number(since).ok_or(PARAMS)?;
                    clause.push_str(" AND date(c.started_at / 1000, 'unixepoch') >= ?");
                    args.push(Sql::Text(since.0.clone()));
                }
                owners_in(&mut clause, &mut args, &a.people);
                let query = a.query.as_deref().map(str::to_lowercase);
                read(&|c| {
                    let keep = |i: &McpItem| {
                        query
                            .as_ref()
                            .map_or(true, |q| i.text.to_lowercase().contains(q))
                    };
                    let items = items_of(c, &clause, args.clone(), t.cloud, keep)?;
                    Ok(Ok(to_json(&ItemsOutput { items })))
                })
            }
            "get_person" => {
                let a: GetPersonInput = typed(params)?;
                if a.person_id.is_none() && a.name.as_deref().map_or(true, |n| n.trim().is_empty())
                {
                    return Err(PARAMS);
                }
                read(&|c| person_of(c, &a, t.cloud))
            }
            _ => Err(FORBIDDEN),
        }
        // @cpt-end:cpt-noter-flow-core-mcp-read:p1:inst-read-entities
    }
}

/// An open item: not a decision, not finished, not rejected.
const OPEN: &str =
    "i.kind != 'decision' AND i.status IN ('open', 'carried') AND i.review_state != 'rejected'";

fn respond(id: u64, result: Result<Value, Rpc>) -> CoreSocketResponse {
    let (result, error) = match result {
        Ok(v) => (Some(v), None),
        Err((code, message)) => (
            None,
            Some(CoreSocketError {
                code,
                message: message.into(),
            }),
        ),
    };
    CoreSocketResponse {
        jsonrpc: "2.0".into(),
        id,
        result,
        error,
    }
}

async fn connection(core: Weak<Core>, stream: UnixStream) {
    let (read, mut write) = stream.into_split();
    let mut read = BufReader::new(read);
    let mut bound: Option<Trusted> = None;
    loop {
        let mut line = String::new();
        let mut limited = (&mut read).take(MAX_FRAME + 1);
        let got = limited.read_line(&mut line);
        let ended = async {
            match bound.as_mut() {
                Some(t) => {
                    let _ = t.cancel.wait_for(|c| *c).await;
                }
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            n = got => if !matches!(n, Ok(n) if n > 0 && n as u64 <= MAX_FRAME) { return },
            () = ended => return,
        }
        let Some(core) = core.upgrade() else { return };
        let mut bytes = to_json(&core.answer(&line, &mut bound))
            .to_string()
            .into_bytes();
        bytes.push(b'\n');
        if write.write_all(&bytes).await.is_err() {
            return;
        }
    }
}

/// The call exists, and is not a sensitive one for a cloud run.
fn call_access(
    c: &Connection,
    call: &CallId,
    cloud: bool,
) -> noter_db::rusqlite::Result<Result<(), Rpc>> {
    // @cpt-begin:cpt-noter-algo-core-mcp-authorize:p1:inst-auth-entity
    let class: Option<String> = c
        .query_row(
            "SELECT privacy_class FROM calls WHERE id = ?1",
            [call.as_str()],
            |r| r.get(0),
        )
        .optional()?;
    Ok(match class.as_deref() {
        None => Err(MISSING),
        Some("sensitive") if cloud => Err(FORBIDDEN),
        Some(_) => Ok(()),
    })
    // @cpt-end:cpt-noter-algo-core-mcp-authorize:p1:inst-auth-entity
}

fn speaker_name(label: &SpeakerLabel) -> String {
    match label {
        SpeakerLabel::You => "You".into(),
        SpeakerLabel::Person { person } => person.display_name.clone(),
        SpeakerLabel::Unnamed { n } => format!("Speaker {n}"),
        SpeakerLabel::GuestYourSide => "Guest".into(),
    }
}

fn owners_in(clause: &mut String, args: &mut Vec<Sql>, people: &[PersonId]) {
    if people.is_empty() {
        return;
    }
    let marks = vec!["?"; people.len()].join(", ");
    clause.push_str(&format!(" AND i.owner_person_id IN ({marks})"));
    args.extend(people.iter().map(|p| Sql::Text(p.as_str().into())));
}

fn word_of<T: serde::Serialize>(v: &T) -> String {
    to_json(v).as_str().unwrap_or_default().to_owned()
}

/// The newest [`MAX_ITEMS`] items of `clause` (over `i` and `c`), without a cloud run's
/// sensitive calls, that `keep` accepts, with the segments their spans cover as evidence.
fn items_of(
    c: &Connection,
    clause: &str,
    args: Vec<Sql>,
    cloud: bool,
    keep: impl Fn(&McpItem) -> bool,
) -> noter_db::rusqlite::Result<Vec<McpItem>> {
    let clause = if cloud {
        format!("{clause} AND c.privacy_class = 'normal'")
    } else {
        clause.to_owned()
    };
    let mut items = vec![];
    for v in crate::items::items_where(c, &clause, args)?
        .into_iter()
        .rev()
    {
        let mut evidence = vec![];
        for span in &v.spans {
            let lines = crate::transcript::segments_of(
                c,
                &span.call_id,
                Some((span.channel, span.t0_ms, span.t1_ms)),
            )?;
            for s in lines {
                if !evidence.contains(&s.id) {
                    evidence.push(s.id);
                }
            }
        }
        let item = McpItem {
            item_id: v.id,
            kind: word_of(&v.kind),
            text: v.text,
            owner: v.owner.map(|o| o.display_name),
            due: v.due,
            status: word_of(&v.status),
            call_id: v.call.id,
            call_date: LocalDate(crate::history::date_of(v.call.started_at.0)),
            evidence_segment_ids: evidence,
        };
        if keep(&item) {
            items.push(item);
            if items.len() == MAX_ITEMS {
                break;
            }
        }
    }
    Ok(items)
}

/// `a.person_id`, or the person a speaker named `a.name` stands for. shortcut: no `people`
/// table before 2.23, so a person is the `person_id` of the calls' named speakers and the
/// aliases are the other names those speakers carried; 2.23 resolves names and aliases itself.
fn person_of(
    c: &Connection,
    a: &GetPersonInput,
    cloud: bool,
) -> noter_db::rusqlite::Result<Result<Value, Rpc>> {
    let fold = |s: &str| s.trim().to_lowercase().replace('ё', "е");
    let sensitive = if cloud {
        "AND c.privacy_class = 'normal'"
    } else {
        ""
    };
    let rows: Vec<(String, String, String)> = c
        .prepare(&format!(
            "SELECT s.person_id, COALESCE(s.name, s.label), c.id FROM speakers s
             JOIN calls c ON c.id = s.call_id WHERE s.person_id IS NOT NULL {sensitive}
             ORDER BY c.started_at DESC, s.rowid DESC"
        ))?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    let wanted = match (&a.person_id, &a.name) {
        (Some(id), _) => rows.iter().find(|r| r.0 == id.as_str()),
        (None, Some(name)) => rows.iter().find(|r| fold(&r.1) == fold(name)),
        (None, None) => None,
    };
    let Some((person, display, _)) = wanted else {
        return Ok(Err(MISSING));
    };
    let mut aliases: Vec<String> = vec![];
    let mut calls: Vec<CallId> = vec![];
    for (_, name, call) in rows.iter().filter(|r| r.0 == *person) {
        if name != display && !aliases.contains(name) {
            aliases.push(name.clone());
        }
        let call = CallId::new(call.clone());
        if !calls.contains(&call) && calls.len() < MAX_RECENT_CALLS {
            calls.push(call);
        }
    }
    let items = items_of(
        c,
        &format!("i.owner_person_id = ? AND {OPEN}"),
        vec![Sql::Text(person.clone())],
        cloud,
        |_| true,
    )?;
    Ok(Ok(to_json(&GetPersonOutput {
        person_id: PersonId::new(person.clone()),
        display_name: display.clone(),
        role: None,
        aliases,
        recent_calls: calls,
        open_items: items,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Quiet;

    impl crate::EventEmitter for Quiet {
        fn emit(&self, _: &'static str, _: Value) {}
    }

    /// A cloud run's results are refused until the release gate exists, so the sensitive-call
    /// filter is checked on what `read_tool` assembles before that refusal.
    #[test]
    fn a_cloud_read_leaves_out_sensitive_calls_and_the_people_only_they_name() {
        let dir = tempfile::tempdir().unwrap();
        let clock = Arc::new(crate::SystemClock);
        let core = Core::open(dir.path(), crate::CoreDeps::new(clock, Arc::new(Quiet))).unwrap();
        noter_db::rusqlite::Connection::open(dir.path().join("noter.db"))
            .unwrap()
            .execute_batch(
                "INSERT INTO calls (id, rev, started_at, title, call_type, status, mode_used, privacy_class) VALUES
                   ('c_n', 1, 1, 'N', 'planning', 'ready', 'cloud', 'normal'),
                   ('c_s', 1, 2, 'S', 'planning', 'ready', 'local_only', 'sensitive');
                 INSERT INTO speakers (id, call_id, label, channel, person_id, name, pass) VALUES
                   ('sp_n', 'c_n', 'spk_1', 'sys', 'p_n', 'Nina', 'live'),
                   ('sp_s', 'c_s', 'spk_1', 'sys', 'p_s', 'Sam', 'live'),
                   ('sp_m', 'c_s', 'spk_2', 'sys', 'p_n', 'Nina', 'live');
                 INSERT INTO items (id, rev, call_id, kind, text, lang, status, review_state, created_by, owner_person_id) VALUES
                   ('i_n', 1, 'c_n', 'decision', 'Open one', 'en', 'open', 'accepted', 'llm', 'p_n'),
                   ('i_s', 1, 'c_s', 'decision', 'Secret one', 'en', 'open', 'accepted', 'llm', 'p_n');",
            )
            .unwrap();
        let trusted = |cloud| Trusted {
            run_id: "r".into(),
            cloud,
            cancel: watch::channel(false).1,
        };
        let read = |cloud, method: &str, params: Value| {
            core.read_tool(&trusted(cloud), method, params)
                .unwrap()
                .to_string()
        };
        assert!(read(false, "get_decisions", json!({})).contains("Secret one"));
        assert!(!read(true, "get_decisions", json!({})).contains("Secret one"));
        assert!(read(true, "get_decisions", json!({})).contains("Open one"));
        let nina = read(true, "get_person", json!({ "person_id": "p_n" }));
        assert!(nina.contains("c_n") && !nina.contains("c_s") && !nina.contains("Secret one"));
        assert_eq!(
            core.read_tool(&trusted(true), "get_person", json!({ "name": "Sam" }))
                .unwrap_err(),
            MISSING
        );
        assert!(read(false, "get_person", json!({ "name": "Sam" })).contains("p_s"));
    }
}
