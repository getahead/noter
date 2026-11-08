//! FEATURE cpt-noter-feature-core-mcp (slice 1): the core's side of noter-mcp. `McpRuns` holds
//! the runs the router registered (token → trusted context + allowed tools), `serve_socket`
//! answers `CoreSocketRequest`s on `<data>/run/core.sock` and the entity read tools run over the
//! existing read services.
//!
//! Socket framing: newline-delimited JSON, one JSON-RPC 2.0 message per line (at most
//! [`MAX_FRAME`] bytes), a response per request on the same connection. A connection binds to
//! the first run it authenticates; another run's token on it is refused.
//!
//! Served: `get_transcript_span`, `get_person`, `get_decisions`, `get_open_items`,
//! `get_screen_context` and the staging tools `pin_item` and `propose_correction`; other tools
//! are dropped from a run's allow-list. Every result passes `release` (the egress gate for a
//! cloud run: its own redaction map and an audit row before the body leaves); a cloud run
//! the router did not start through [`ToolHost`] has no map, so it gets no result at all.

use std::collections::HashMap;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use noter_db::rusqlite::types::Value as Sql;
use noter_db::rusqlite::{Connection, OptionalExtension};
use noter_db::{ChangeMeta, Logged};
use noter_llm::{Failure, ToolHost, ToolLaunch, ToolStart};
use noter_protocol::mcp::*;
use noter_protocol::model::*;
use noter_protocol::model::{Actor, ItemKind};
use noter_protocol::{
    CallId, CoreError, ErrorCode, EvidenceId, LlmRunId, LocalDate, PersonId, RuntimeChoice,
    SegmentId,
};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::watch;

use crate::{internal, lock, to_json, Core};

/// The tools the core answers; a registration keeps only these.
const SERVED: &[&str] = &[
    "search_calls",
    "search_documents",
    "pin_item",
    "propose_correction",
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
/// Longest text a staged pin, correction or reason may hold, and most segments it may cite.
const MAX_TEXT: usize = 2000;
const MAX_EVIDENCE: usize = 20;
/// Hits a search returns unless the run asks for another number, and the most it may ask for.
const DEFAULT_HITS: u32 = 8;
const MAX_HITS: u32 = 30;

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
    /// D1 lets the run query live MCP sources (`ToolStart::live_ok`): the core adds their
    /// relayed tools to the allow-list.
    pub live: bool,
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
    live: bool,
    state: State,
    /// `true` ends the run's connections and in-flight work.
    cancel: watch::Sender<bool>,
    config: PathBuf,
    /// Live sources' sign-in tokens by server: in memory for the run, gone when it closes.
    tokens: HashMap<String, String>,
}

pub(crate) struct McpRuns {
    runs: Mutex<Vec<Run>>,
    serving: Mutex<Option<PathBuf>>,
    /// `true` when the core shuts down.
    stop: watch::Sender<bool>,
    /// The core, for the host the router starts runs through (set when the socket serves).
    core: Arc<OnceLock<Weak<Core>>>,
}

impl Default for McpRuns {
    fn default() -> Self {
        McpRuns {
            runs: Mutex::default(),
            serving: Mutex::default(),
            stop: watch::channel(false).0,
            core: Arc::default(),
        }
    }
}

/// The router's door to the core: `Llm` registers a run that may use tools here before its CLI
/// starts and revokes it when the attempt ends.
pub(crate) struct CoreTools(Arc<OnceLock<Weak<Core>>>);

impl McpRuns {
    pub(crate) fn host(&self) -> CoreTools {
        CoreTools(self.core.clone())
    }
}

impl ToolHost for CoreTools {
    fn start(&self, run: ToolStart) -> Result<ToolLaunch, String> {
        let core = self.0.get().and_then(Weak::upgrade).ok_or("no_socket")?;
        let (token, config) = core
            .register_mcp_run(McpRegistration {
                llm_run_id: run.llm_run_id.as_str().to_owned(),
                call_id: run.call_id,
                cloud: run.cloud,
                tools: run.tools,
                live: run.live_ok,
            })
            .map_err(|e| e.message)?;
        Ok(ToolLaunch { token, config })
    }

    fn stop(&self, run: &LlmRunId) {
        if let Some(core) = self.0.get().and_then(Weak::upgrade) {
            core.close_mcp_run(run.as_str());
        }
    }
}

/// The checked context of one request.
struct Trusted {
    run_id: String,
    call: Option<CallId>,
    live: bool,
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
        if reg.live {
            tools.extend(
                self.live_tool_names(ctx.call_id.as_ref())
                    .map_err(internal)?,
            );
        }
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
                live: reg.live,
                state: State::Registered,
                cancel: watch::channel(false).0,
                config: config.clone(),
                tokens: HashMap::new(),
            });
        }
        // @cpt-end:cpt-noter-flow-core-mcp-start:p1:inst-start-config
        Ok((token, config))
    }

    /// Every live run's id, token and config: for the harness and tests that speak the socket as
    /// the child would.
    #[doc(hidden)]
    pub fn mcp_launches(&self) -> Vec<(String, String, PathBuf)> {
        let runs = lock(&self.mcp.runs);
        let launch = |r: &Run| {
            (
                r.ctx.llm_run_id.clone(),
                r.ctx.token.clone(),
                r.config.clone(),
            )
        };
        runs.iter().map(launch).collect()
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
        let _ = self.mcp.core.set(Arc::downgrade(self));
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
    async fn answer(&self, line: &str, bound: &mut Option<Trusted>) -> CoreSocketResponse {
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
        let result = match authorized {
            Err(e) => Err(e),
            Ok(trusted) if bound.as_ref().is_some_and(|b| b.run_id != trusted.run_id) => {
                Err(FORBIDDEN)
            }
            Ok(trusted) => {
                let run_id = trusted.run_id.clone();
                let value = if req.method.starts_with("live_") {
                    self.relay(&trusted, &req.method, req.params).await
                } else {
                    self.dispatch(&trusted, &req.method, req.params).await
                };
                bound.get_or_insert(trusted);
                // @cpt-begin:cpt-noter-algo-core-mcp-close:p1:inst-close-late
                // A run closed while the read ran gets no late result.
                if self.mcp_live(&run_id) {
                    value
                } else {
                    Err(FORBIDDEN)
                }
                // @cpt-end:cpt-noter-algo-core-mcp-close:p1:inst-close-late
            }
        };
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
            call: run.ctx.call_id.clone(),
            live: run.live,
            cloud: run.ctx.cloud,
            cancel: run.cancel.subscribe(),
        })
        // @cpt-end:cpt-noter-algo-core-mcp-authorize:p1:inst-auth-return
    }

    // @cpt-dod:cpt-noter-dod-core-mcp-results:p1
    // @cpt-flow:cpt-noter-flow-core-mcp-read:p1
    async fn dispatch(&self, t: &Trusted, method: &str, mut params: Value) -> Result<Value, Rpc> {
        // The call a run belongs to does not narrow its reads (an Ask or a review looks across
        // the library); what a cloud run cannot read is a sensitive call.
        if t.cloud {
            // The model speaks in the pseudonyms its packet gave it: what it asks for and what
            // it stages names the real people.
            self.llm
                .restore_tool_input(&LlmRunId::new(&t.run_id), &mut params);
        }
        let value = match method {
            "pin_item" | "propose_correction" => self.stage_tool(t, method, params)?,
            "search_calls" | "search_documents" => self.search_tool(t, method, params).await?,
            _ => self.read_tool(t, method, params)?,
        };
        // @cpt-begin:cpt-noter-flow-core-mcp-read:p1:inst-read-gate
        self.release(t, value)
        // @cpt-end:cpt-noter-flow-core-mcp-read:p1:inst-read-gate
    }

    // @cpt-algo:cpt-noter-algo-core-mcp-release-result:p1
    fn release(&self, t: &Trusted, value: Value) -> Result<Value, Rpc> {
        // @cpt-begin:cpt-noter-algo-core-mcp-release-result:p1:inst-release-secrets
        // No tool assembles these, and none may: a field that names one is a bug, not a result.
        if holds_secret(&value) {
            return Err(INTERNAL);
        }
        // @cpt-end:cpt-noter-algo-core-mcp-release-result:p1:inst-release-secrets
        // @cpt-begin:cpt-noter-algo-core-mcp-release-result:p1:inst-release-return
        if !t.cloud {
            return Ok(value);
        }
        // @cpt-end:cpt-noter-algo-core-mcp-release-result:p1:inst-release-return
        // @cpt-begin:cpt-noter-algo-core-mcp-release-result:p1:inst-release-cloud
        // A call marked sensitive after the read (or one the read let through) goes no further.
        if !self.mcp_live(&t.run_id) || self.names_sensitive_call(&value) {
            return Err(FORBIDDEN);
        }
        let released =
            self.llm
                .release_tool_result(&LlmRunId::new(&t.run_id), &people_in(&value), value);
        released.map_err(|failure| match failure {
            // Privacy no longer allows the run: forbidden. No result gate for the run (not
            // started through the router) or no audit row: nothing is released.
            Failure::Unavailable(e) if e.code == ErrorCode::RuntimeUnavailable => FORBIDDEN,
            _ => INTERNAL,
        })
        // @cpt-end:cpt-noter-algo-core-mcp-release-result:p1:inst-release-cloud
    }

    /// Whether the result names a call that is now sensitive.
    fn names_sensitive_call(&self, value: &Value) -> bool {
        let mut calls = vec![];
        call_ids(value, &mut calls);
        if calls.is_empty() {
            return false;
        }
        let marks = vec!["?"; calls.len()].join(", ");
        let sql = format!(
            "SELECT count(*) FROM calls WHERE id IN ({marks}) AND privacy_class != 'normal'"
        );
        let found = self.store.read(move |c| {
            c.query_row(
                &sql,
                noter_db::rusqlite::params_from_iter(calls.iter()),
                |r| r.get::<_, i64>(0),
            )
        });
        // A read that fails is not an all-clear.
        found.map_or(true, |n| n > 0)
    }

    /// `pin_item` and `propose_correction` (`cpt-noter-flow-core-mcp-stage`): validate against
    /// rows this run may see, then stage through the owning change-log writer. Nothing a user
    /// decided on changes; the answer is the staged record's reference.
    // @cpt-dod:cpt-noter-dod-core-mcp-staging:p1
    // @cpt-flow:cpt-noter-flow-core-mcp-stage:p1
    fn stage_tool(&self, t: &Trusted, method: &str, params: Value) -> Result<Value, Rpc> {
        // @cpt-begin:cpt-noter-flow-core-mcp-stage:p1:inst-stage-request
        // The token and the tool were checked by `authorize`; the referenced rows below.
        // @cpt-end:cpt-noter-flow-core-mcp-stage:p1:inst-stage-request
        // @cpt-begin:cpt-noter-flow-core-mcp-stage:p1:inst-stage-store
        let reference = match method {
            "pin_item" => self.stage_pin(t, typed(params)?)?,
            _ => self.stage_correction(t, typed(params)?)?,
        };
        // @cpt-end:cpt-noter-flow-core-mcp-stage:p1:inst-stage-store
        // @cpt-begin:cpt-noter-flow-core-mcp-stage:p1:inst-stage-review
        // Applying and undoing stay with the owning feature: nothing above approves a proposal.
        // @cpt-end:cpt-noter-flow-core-mcp-stage:p1:inst-stage-review
        // @cpt-begin:cpt-noter-flow-core-mcp-stage:p1:inst-stage-return
        Ok(to_json(&StagedOutput {
            staged: true,
            reference,
        }))
        // @cpt-end:cpt-noter-flow-core-mcp-stage:p1:inst-stage-return
    }

    /// Who the staged record names as its author: the run, never the user.
    fn staged_by(
        &self,
        t: &Trusted,
        summary: String,
        reason: &str,
        evidence: &[String],
    ) -> ChangeMeta {
        ChangeMeta {
            actor: Actor::Model {
                llm_run_id: LlmRunId::new(&t.run_id),
                runtime: if t.cloud {
                    RuntimeChoice::ClaudeAccount
                } else {
                    RuntimeChoice::Local
                },
                model: String::new(),
            },
            summary,
            reason: reason.to_owned(),
            evidence_ids: evidence.iter().map(EvidenceId::new).collect(),
            batch_id: None,
            undoable: false,
            surface: None,
        }
    }

    // @cpt-algo:cpt-noter-algo-core-mcp-stage-write:p1
    fn stage_pin(&self, t: &Trusted, a: PinItemInput) -> Result<String, Rpc> {
        // @cpt-begin:cpt-noter-flow-core-mcp-stage:p1:inst-stage-validate
        let kind: ItemKind =
            serde_json::from_value(Value::from(a.kind.as_str())).map_err(|_| PARAMS)?;
        let text = a.text.trim().to_owned();
        if text.is_empty() || text.len() > MAX_TEXT {
            return Err(PARAMS);
        }
        let due = match &a.due {
            Some(d) => Some(
                crate::library::day_number(d)
                    .map(|_| d.0.clone())
                    .ok_or(PARAMS)?,
            ),
            None => None,
        };
        let call = a.call_id.clone();
        let ids = a.evidence_segment_ids.clone();
        let owner_name = a.owner_name.clone();
        let (owner, segments) = self.read_as(|c| {
            if let Err(e) = call_access(c, &call, t.cloud)? {
                return Ok(Err(e));
            }
            let segments = match evidence_in(c, &ids, Some(&call), t.cloud)? {
                Ok(s) => s,
                Err(e) => return Ok(Err(e)),
            };
            let owner = match owner_name.as_deref().filter(|n| !n.trim().is_empty()) {
                None => None,
                Some(name) => match person_by_name(c, name)? {
                    Some(id) => Some(id),
                    None => return Ok(Err(PARAMS)),
                },
            };
            Ok(Ok((owner, segments)))
        })?;
        // @cpt-end:cpt-noter-flow-core-mcp-stage:p1:inst-stage-validate
        let t0 = segments.iter().map(|s| s.t0).min().unwrap_or(0);
        let t1 = segments.iter().map(|s| s.t1).max().unwrap_or(0);
        let lang = segments
            .first()
            .and_then(|s| s.lang.clone())
            .unwrap_or_else(|| "en".into());
        let evidence: Vec<String> = segments.iter().map(|s| s.id.clone()).collect();
        let meta = self.staged_by(
            t,
            "Pinned an item".into(),
            "pinned by an agent run",
            &evidence,
        );
        let id = format!("itm_{}", ulid::Ulid::generate());
        let row = (
            id.clone(),
            call.as_str().to_owned(),
            word_of(&kind),
            text,
            lang,
            owner,
            due,
        );
        // @cpt-begin:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-recheck
        // @cpt-begin:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-write
        // @cpt-begin:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-commit
        let written = self.store.write_with(meta, move |tx| {
            let (id, call, kind, text, lang, owner, due) = row;
            let known: i64 = tx
                .query_row("SELECT count(*) FROM calls WHERE id = ?1", [&call], |r| {
                    r.get(0)
                })
                .map_err(internal)?;
            if known == 0 {
                return Err(CoreError::new(ErrorCode::NotFound, "call"));
            }
            tx.execute(
                "INSERT INTO items (id, rev, call_id, kind, text, lang, owner_person_id, due_date,
                                    status, review_state, created_by, is_engineering)
                 VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, 'open', 'suggested', 'llm', 0)",
                noter_db::rusqlite::params![id, call, kind, text, lang, owner, due],
            )
            .map_err(internal)?;
            tx.execute(
                "INSERT INTO item_spans (item_id, call_id, channel, t0_ms, t1_ms)
                 VALUES (?1, ?2, NULL, ?3, ?4)",
                noter_db::rusqlite::params![id, call, t0, t1],
            )
            .map_err(internal)?;
            let delta = json!({ "call_id": [Value::Null, call], "kind": [Value::Null, kind],
                "text": [Value::Null, text], "review_state": [Value::Null, "suggested"],
                "created_by": [Value::Null, "llm"] });
            Ok((
                (),
                vec![Logged {
                    entity_type: "item",
                    entity_id: id,
                    field: None,
                    before: None,
                    after: None,
                    delta: Some(delta),
                }],
            ))
        });
        // @cpt-end:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-commit
        // @cpt-end:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-write
        // @cpt-end:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-recheck
        written.map_err(staging_error)?;
        // @cpt-begin:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-publish
        if let Ok(Some(item)) = self.item_view(&id) {
            self.items_published(std::slice::from_ref(&item));
        }
        // @cpt-end:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-publish
        // @cpt-begin:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-return
        Ok(id)
        // @cpt-end:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-return
    }

    fn stage_correction(&self, t: &Trusted, a: ProposeCorrectionInput) -> Result<String, Rpc> {
        // @cpt-begin:cpt-noter-flow-core-mcp-stage:p1:inst-stage-validate
        let (table, column, entity) = match (a.entity.as_str(), a.field.as_str()) {
            ("segment", "text") => ("segments", "text", "segment"),
            ("speaker", "name") => ("speakers", "name", "speaker"),
            ("item", "text") => ("items", "text", "item"),
            _ => return Err(PARAMS),
        };
        let (after, reason) = (a.after.trim().to_owned(), a.reason.trim().to_owned());
        let bad = |s: &str| s.is_empty() || s.len() > MAX_TEXT;
        if bad(&after) || bad(&reason) || after == a.before {
            return Err(PARAMS);
        }
        let (entity_id, ids, before) = (
            a.entity_id.clone(),
            a.evidence_segment_ids.clone(),
            a.before.clone(),
        );
        let segments = self.read_as(|c| {
            let current: Option<(String, Option<String>)> = c
                .query_row(
                    &format!("SELECT call_id, {column} FROM {table} WHERE id = ?1"),
                    [&entity_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let Some((call, current)) = current else {
                return Ok(Err(MISSING));
            };
            if let Err(e) = call_access(c, &CallId::new(call), t.cloud)? {
                return Ok(Err(e));
            }
            if current.as_deref() != Some(before.as_str()) {
                return Ok(Err(PARAMS));
            }
            evidence_in(c, &ids, None, t.cloud)
        })?;
        // @cpt-end:cpt-noter-flow-core-mcp-stage:p1:inst-stage-validate
        let evidence: Vec<String> = segments.iter().map(|s| s.id.clone()).collect();
        let meta = self.staged_by(
            t,
            format!("Proposed a correction to a {entity} {column}"),
            &reason,
            &evidence,
        );
        let (entity_id, before) = (a.entity_id.clone(), a.before.clone());
        let logged = Logged {
            entity_type: entity,
            entity_id: entity_id.clone(),
            field: Some(column.to_owned()),
            before: Some(before.clone()),
            after: Some(after),
            delta: None,
        };
        // @cpt-begin:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-recheck
        // @cpt-begin:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-write
        // @cpt-begin:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-commit
        let written = self.store.write_proposed(meta, "correction", move |tx| {
            // The target is read again inside the writer: it may have changed since validation.
            let current: Option<Option<String>> = tx
                .query_row(
                    &format!("SELECT {column} FROM {table} WHERE id = ?1"),
                    [&entity_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(internal)?;
            match current {
                None => Err(CoreError::new(ErrorCode::NotFound, entity)),
                Some(now) if now.as_deref() != Some(before.as_str()) => {
                    Err(CoreError::new(ErrorCode::Conflict, "changed since"))
                }
                Some(_) => Ok(((), vec![logged])),
            }
        });
        // @cpt-end:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-commit
        // @cpt-end:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-write
        // @cpt-end:cpt-noter-algo-core-mcp-stage-write:p1:inst-staging-recheck
        // No owning notification exists for a proposed correction until the proposal inbox (M5):
        // nothing is published, and nothing is applied.
        let written = written.map_err(staging_error)?;
        written
            .change_ids
            .first()
            .map(|id| id.as_str().to_owned())
            .ok_or(INTERNAL)
    }

    /// `search_calls` and `search_documents` over the same retrieval as Ask, under the run's
    /// filters and privacy: a cloud run gets no sensitive call or source, and every hit keeps
    /// the segment or chunk ids it was stored under.
    // @cpt-begin:cpt-noter-flow-core-mcp-read:p1:inst-read-search
    // The query is embedded locally exactly as `search` does: keyword-only (`keyword_only: true`)
    // while the indexes rebuild or when this embedding failed.
    async fn search_tool(&self, t: &Trusted, method: &str, params: Value) -> Result<Value, Rpc> {
        let documents = method == "search_documents";
        let (text, filter, k) = if documents {
            let a: SearchDocumentsInput = typed(params)?;
            (a.query, noter_protocol::model::CallFilter::default(), a.k)
        } else {
            let a: SearchCallsInput = typed(params)?;
            let f = a.filter;
            let filter = noter_protocol::model::CallFilter {
                people: f.people,
                call_types: f.call_types,
                languages: f.languages,
                from: f.from,
                to: f.to,
                ..Default::default()
            };
            (a.query, filter, a.k)
        };
        if text.trim().is_empty() {
            return Err(PARAMS);
        }
        let wanted = k.unwrap_or(DEFAULT_HITS).clamp(1, MAX_HITS) as usize;
        let (vector, mode) = self.query_vector(&text).await;
        let query = noter_retrieval::Query {
            text,
            filter,
            scope: noter_retrieval::Scope {
                include_documents: documents,
                ..Default::default()
            },
            privacy: if t.cloud {
                noter_retrieval::Privacy::Cloud
            } else {
                noter_retrieval::Privacy::Local
            },
            wanted,
            vector,
        };
        let prepared = noter_retrieval::prepare(query).map_err(|_| PARAMS)?;
        let found = self
            .store
            .read(|c| {
                let r = noter_retrieval::retrieve(c, &prepared, &crate::retrieval::Documents)?;
                if documents {
                    return Ok(to_json(&SearchDocumentsOutput {
                        hits: r
                            .documents
                            .iter()
                            .take(wanted)
                            .filter_map(document_hit)
                            .collect(),
                        sensitive_skipped: r.sensitive_skipped,
                    }));
                }
                let mut hits = vec![];
                for hit in r.calls.iter().take(wanted) {
                    hits.extend(call_hit(c, hit)?);
                }
                Ok(to_json(&SearchCallsOutput {
                    hits,
                    keyword_only: mode != SearchMode::Hybrid,
                }))
            })
            .map_err(|_| INTERNAL)?;
        Ok(found)
    }
    // @cpt-end:cpt-noter-flow-core-mcp-read:p1:inst-read-search

    /// The live sources this run may query now, with the relayed tool each name stands for.
    fn live_tools(&self, call: Option<&CallId>) -> Result<Vec<LiveTool>, CoreError> {
        let scope = AskScope {
            call_id: call.cloned(),
            ..AskScope::default()
        };
        let sources = self
            .store
            .read(|c| noter_knowledge::live_sources(c, &scope))?;
        let mut taken: Vec<String> = vec![];
        let mut tools = vec![];
        for source in sources {
            let mut slug = slug_of(&source.name);
            while taken.contains(&slug) {
                slug.push('_');
            }
            taken.push(slug.clone());
            for action in [Live::Search, Live::Read] {
                tools.push(LiveTool {
                    name: format!("live_{slug}_{}", action.word()),
                    source: source.clone(),
                    action,
                });
            }
        }
        Ok(tools)
    }

    /// The relayed tool names a run registered under D1 gets.
    // @cpt-begin:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-name
    fn live_tool_names(&self, call: Option<&CallId>) -> Result<Vec<String>, CoreError> {
        Ok(self.live_tools(call)?.into_iter().map(|t| t.name).collect())
    }
    // @cpt-end:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-name

    /// The relayed tool a call names, if this run may use it right now: it was registered for
    /// live lookups, its privacy is still Cloud allowed without sensitive context, and the
    /// source row is still live and in scope.
    // @cpt-begin:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-policy
    fn live_target(&self, t: &Trusted, method: &str) -> Result<LiveTool, Rpc> {
        let allowed = self
            .llm
            .tool_privacy(&LlmRunId::new(&t.run_id))
            .is_some_and(|p| p.allows_live());
        if !t.live || !allowed || !self.mcp_live(&t.run_id) {
            return Err(FORBIDDEN);
        }
        let tools = self.live_tools(t.call.as_ref()).map_err(|_| INTERNAL)?;
        tools
            .into_iter()
            .find(|tool| tool.name == method)
            .ok_or(FORBIDDEN)
    }
    // @cpt-end:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-policy

    /// `live_<source>_<tool>` (`cpt-noter-flow-core-mcp-live-relay`): the lookup's `audit_log`
    /// row commits before the request is sent; the answer keeps where and when it came from and
    /// takes the same result gate as every tool.
    // @cpt-dod:cpt-noter-dod-core-mcp-relay:p1
    // @cpt-flow:cpt-noter-flow-core-mcp-live-relay:p1
    async fn relay(&self, t: &Trusted, method: &str, mut params: Value) -> Result<Value, Rpc> {
        let tool = self.live_target(t, method)?;
        if t.cloud {
            self.llm
                .restore_tool_input(&LlmRunId::new(&t.run_id), &mut params);
        }
        let request = match tool.action {
            Live::Search => json!({ "query": typed::<LiveSearch>(params)?.query }),
            Live::Read => json!({ "uri": typed::<LiveRead>(params)?.uri }),
        };
        let server = tool.source.server.clone();
        // @cpt-begin:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-audit
        // The source commits this row for every request it sends (`Remote::audit`), before the
        // request leaves; a row that does not commit means nothing is sent.
        let meta = self.staged_by(t, "Looked up a live source".into(), "live lookup", &[]);
        let run = LlmRunId::new(&t.run_id);
        let audit = |destination: &str, bytes: &[u8]| {
            noter_llm::audit_lookup(
                &self.store,
                meta.clone(),
                self.deps.clock.now(),
                destination,
                bytes,
                Some((&run, t.call.as_ref())),
            )
            .is_ok()
        };
        // @cpt-end:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-audit
        // @cpt-begin:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-forward
        let mut cancel = t.cancel.clone();
        let answer = tokio::select! {
            a = self.forward_live(&t.run_id, &server, tool.action, &request, &audit) => a,
            _ = cancel.wait_for(|c| *c) => Err(FORBIDDEN),
        }?;
        // @cpt-end:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-forward
        // @cpt-begin:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-return
        // The run was cancelled or its privacy changed while the server answered: nothing of it
        // goes on.
        self.live_target(t, method)?;
        // @cpt-end:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-return
        // @cpt-begin:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-result
        let mut value = json!({
            "source": tool.source.name,
            "looked_up_at": self.deps.clock.now().0,
        });
        value
            .as_object_mut()
            .expect("an object")
            .extend(answer.as_object().cloned().unwrap_or_default());
        self.release(t, value)
        // @cpt-end:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-result
    }

    /// The source's own transport and sign-in: the run signs in once and keeps the token in
    /// memory (a renewed one replaces it); a rejected token is signed in again once.
    // @cpt-begin:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-forward
    async fn forward_live(
        &self,
        run_id: &str,
        server: &str,
        action: Live,
        request: &Value,
        audit: noter_knowledge::Audit<'_>,
    ) -> Result<Value, Rpc> {
        let mcp = &self.deps.mcp_source;
        let keep = |token: &str| {
            let mut runs = lock(&self.mcp.runs);
            if let Some(run) = runs.iter_mut().find(|r| r.ctx.llm_run_id == run_id) {
                run.tokens.insert(server.to_owned(), token.to_owned());
            }
        };
        let remote = noter_knowledge::Remote {
            audit,
            renewed: &|token| keep(&token),
        };
        let cached = lock(&self.mcp.runs)
            .iter()
            .find(|r| r.ctx.llm_run_id == run_id)
            .and_then(|r| r.tokens.get(server).cloned());
        let mut token = match cached {
            Some(token) => token,
            None => {
                let token = mcp.oauth(server, audit).await.map_err(|_| INTERNAL)?;
                keep(&token);
                token
            }
        };
        let mut signed_in_again = false;
        let answer = loop {
            match self
                .live_call(server, action, request, &token, &remote)
                .await
            {
                Err(noter_knowledge::McpError::Rejected) if !signed_in_again => {
                    signed_in_again = true;
                    token = mcp.oauth(server, audit).await.map_err(|_| INTERNAL)?;
                    keep(&token);
                }
                answer => break answer,
            }
        };
        answer.map_err(|e| match (action, e) {
            (Live::Read, noter_knowledge::McpError::Invalid) => MISSING,
            _ => INTERNAL,
        })
    }

    async fn live_call(
        &self,
        server: &str,
        action: Live,
        request: &Value,
        token: &str,
        remote: &noter_knowledge::Remote<'_>,
    ) -> Result<Value, noter_knowledge::McpError> {
        let mcp = &self.deps.mcp_source;
        Ok(match action {
            Live::Search => {
                let query = request["query"].as_str().unwrap_or_default();
                let found = mcp.seed_query(server, token, query, remote).await?;
                let results: Vec<Value> = found
                    .items
                    .into_iter()
                    .take(MAX_ITEMS)
                    .map(|d| json!({ "uri": d.uri, "title": d.title }))
                    .collect();
                json!({ "results": results })
            }
            Live::Read => {
                let uri = request["uri"].as_str().unwrap_or_default();
                let page = mcp.read_resource(server, token, uri, remote).await?;
                json!({ "uri": uri, "title": page.title, "text": page.text })
            }
        })
    }
    // @cpt-end:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-forward

    fn read_as<T>(
        &self,
        f: impl Fn(&Connection) -> noter_db::rusqlite::Result<Result<T, Rpc>>,
    ) -> Result<T, Rpc> {
        self.store.read(f).map_err(|_| INTERNAL)?
    }

    /// The tool's result before the release gate; sensitive calls are already excluded for a
    /// cloud run.
    fn read_tool(&self, t: &Trusted, method: &str, params: Value) -> Result<Value, Rpc> {
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

fn typed<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, Rpc> {
    serde_json::from_value(params).map_err(|_| PARAMS)
}

/// A retrieval hit on a call as the tool returns it: the call, the span and the segment ids a
/// citation may name (the hit's own segment, or those a chunk covers).
fn call_hit(
    c: &Connection,
    hit: &noter_retrieval::Hit,
) -> noter_db::rusqlite::Result<Option<CallHit>> {
    let (Some(call), HitTarget::Segment { span }) = (&hit.call, &hit.target) else {
        return Ok(None);
    };
    let segment_ids = match &hit.evidence {
        noter_retrieval::Evidence::Segment(id) => vec![id.clone()],
        _ => {
            let mut st = c.prepare(
                "SELECT id FROM segments WHERE call_id = ?1 AND t0_ms >= ?2 AND t1_ms <= ?3
                 ORDER BY t0_ms, rowid",
            )?;
            let rows = st.query_map(
                noter_db::rusqlite::params![call.id.as_str(), span.t0_ms.0, span.t1_ms.0],
                |r| r.get::<_, String>(0),
            )?;
            rows.map(|id| id.map(SegmentId::new))
                .collect::<Result<_, _>>()?
        }
    };
    Ok(Some(CallHit {
        call_id: call.id.clone(),
        call_title: call.title.clone(),
        call_date: LocalDate(crate::history::date_of(call.started_at.0)),
        t0_ms: span.t0_ms,
        t1_ms: span.t1_ms,
        segment_ids,
        text: hit.text.clone(),
        strong: hit.keyword,
    }))
}

fn document_hit(hit: &noter_retrieval::Hit) -> Option<DocumentHit> {
    let noter_protocol::Provenance::Document {
        document_id,
        chunk_id,
        section,
        source_name,
        ..
    } = &hit.provenance
    else {
        return None;
    };
    Some(DocumentHit {
        document_id: document_id.clone(),
        chunk_id: chunk_id.clone(),
        title: hit.title.clone(),
        heading_path: section
            .iter()
            .flat_map(|s| s.split(" › ").map(str::to_owned))
            .collect(),
        source_name: source_name.clone(),
        text: hit.text.clone(),
    })
}

/// One relayed tool of a live source.
struct LiveTool {
    name: String,
    source: noter_knowledge::LiveSource,
    action: Live,
}

#[derive(Clone, Copy)]
enum Live {
    Search,
    Read,
}

impl Live {
    fn word(self) -> &'static str {
        match self {
            Live::Search => "search",
            Live::Read => "read",
        }
    }
}

#[derive(serde::Deserialize)]
struct LiveSearch {
    query: String,
}

#[derive(serde::Deserialize)]
struct LiveRead {
    uri: String,
}

/// A source's name as a tool-name part: lowercase letters, digits and single underscores.
fn slug_of(name: &str) -> String {
    let words: Vec<String> = name
        .to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect();
    if words.is_empty() {
        "source".into()
    } else {
        words.join("_")
    }
}

/// A staging write that did not commit: what the child asked for was stale or gone.
fn staging_error(e: CoreError) -> Rpc {
    match e.code {
        ErrorCode::NotFound => MISSING,
        ErrorCode::Conflict | ErrorCode::InvalidInput => PARAMS,
        _ => INTERNAL,
    }
}

/// A segment a run cites, read from the rows it may see.
struct Cited {
    id: String,
    t0: i64,
    t1: i64,
    lang: Option<String>,
}

/// The segments `ids` name (at most [`MAX_EVIDENCE`], none invented). `only` pins them to one
/// call; a cloud run cannot cite a sensitive call's segment.
fn evidence_in(
    c: &Connection,
    ids: &[SegmentId],
    only: Option<&CallId>,
    cloud: bool,
) -> noter_db::rusqlite::Result<Result<Vec<Cited>, Rpc>> {
    if ids.is_empty() || ids.len() > MAX_EVIDENCE {
        return Ok(Err(PARAMS));
    }
    let mut cited: Vec<Cited> = vec![];
    for id in ids {
        if cited.iter().any(|s| s.id == id.as_str()) {
            continue;
        }
        let row: Option<(String, i64, i64, Option<String>, String)> = c
            .query_row(
                "SELECT s.call_id, s.t0_ms, s.t1_ms, s.lang, c.privacy_class
                 FROM segments s JOIN calls c ON c.id = s.call_id WHERE s.id = ?1",
                [id.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?;
        let Some((call, t0, t1, lang, class)) = row else {
            return Ok(Err(PARAMS));
        };
        if only.is_some_and(|o| o.as_str() != call) {
            return Ok(Err(PARAMS));
        }
        if cloud && class == "sensitive" {
            return Ok(Err(FORBIDDEN));
        }
        cited.push(Cited {
            id: id.as_str().to_owned(),
            t0,
            t1,
            lang,
        });
    }
    Ok(Ok(cited))
}

/// The person whose display name or alias is `name` (case, spacing and ё folded).
fn person_by_name(c: &Connection, name: &str) -> noter_db::rusqlite::Result<Option<String>> {
    let wanted = crate::people::norm(name);
    let by_alias: Option<String> = c
        .query_row(
            "SELECT person_id FROM person_aliases WHERE alias_norm = ?1",
            [&wanted],
            |r| r.get(0),
        )
        .optional()?;
    if by_alias.is_some() {
        return Ok(by_alias);
    }
    let people: Vec<(String, String)> = c
        .prepare("SELECT id, display_name FROM people ORDER BY rowid")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    Ok(people
        .into_iter()
        .find(|(_, n)| crate::people::norm(n) == wanted)
        .map(|(id, _)| id))
}

/// Whether a key names what no response may carry: audio, voice profiles, credentials, raw
/// redaction maps.
fn holds_secret(value: &Value) -> bool {
    const BANNED: [&str; 6] = [
        "audio",
        "voice",
        "credential",
        "redaction_map",
        "api_key",
        "token",
    ];
    match value {
        Value::Object(map) => map
            .iter()
            .any(|(k, v)| BANNED.iter().any(|b| k.to_lowercase().contains(b)) || holds_secret(v)),
        Value::Array(items) => items.iter().any(holds_secret),
        _ => false,
    }
}

/// The call ids a result names (`call_id` fields and a person's `recent_calls`).
fn call_ids(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                match (k.as_str(), v) {
                    ("call_id", Value::String(id)) => out.push(id.clone()),
                    ("recent_calls", Value::Array(ids)) => {
                        out.extend(ids.iter().filter_map(|i| i.as_str().map(str::to_owned)));
                    }
                    _ => call_ids(v, out),
                }
            }
        }
        Value::Array(items) => items.iter().for_each(|v| call_ids(v, out)),
        _ => {}
    }
}

/// The people's names a result holds (`display_name`, `owner`, `speaker`), for the gate to give
/// the run's pseudonyms; "You", "Guest" and numbered speakers are not names.
fn people_in(value: &Value) -> Vec<String> {
    fn walk(value: &Value, out: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                for (k, v) in map {
                    match (k.as_str(), v) {
                        ("display_name" | "owner" | "speaker", Value::String(n)) => {
                            let numbered = n
                                .strip_prefix("Speaker ")
                                .is_some_and(|d| d.parse::<u32>().is_ok());
                            if !numbered
                                && !["You", "Guest"].contains(&n.as_str())
                                && !out.contains(n)
                            {
                                out.push(n.clone());
                            }
                        }
                        _ => walk(v, out),
                    }
                }
            }
            Value::Array(items) => items.iter().for_each(|v| walk(v, out)),
            _ => {}
        }
    }
    let mut out = vec![];
    walk(value, &mut out);
    out
}

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
        // `select!` may take the request when both are ready: a run closed before the request was
        // read still gets no answer, never a refusal that races the connection's end.
        if bound.as_ref().is_some_and(|t| *t.cancel.borrow()) {
            return;
        }
        let Some(core) = core.upgrade() else { return };
        let mut bytes = to_json(&core.answer(&line, &mut bound).await)
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

/// `a.person_id`, or the person whose display name or alias is `a.name` (case, spacing and ё
/// folded). A cloud run only finds people who took part in a call it may read, and sees only
/// those calls.
fn person_of(
    c: &Connection,
    a: &GetPersonInput,
    cloud: bool,
) -> noter_db::rusqlite::Result<Result<Value, Rpc>> {
    let person: Option<(String, String, Option<String>)> = match (&a.person_id, &a.name) {
        (Some(id), _) => c
            .query_row(
                "SELECT id, display_name, role FROM people WHERE id = ?1",
                [id.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?,
        (None, Some(name)) => {
            let wanted = crate::people::norm(name);
            let people: Vec<(String, String, Option<String>)> = c
                .prepare("SELECT id, display_name, role FROM people ORDER BY rowid")?
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .collect::<Result<_, _>>()?;
            let by_alias: Option<String> = c
                .query_row(
                    "SELECT person_id FROM person_aliases WHERE alias_norm = ?1",
                    [&wanted],
                    |r| r.get(0),
                )
                .optional()?;
            people.into_iter().find(|p| {
                by_alias.as_deref() == Some(p.0.as_str()) || crate::people::norm(&p.1) == wanted
            })
        }
        (None, None) => None,
    };
    let Some((id, display_name, role)) = person else {
        return Ok(Err(MISSING));
    };
    let sensitive = if cloud {
        "AND c.privacy_class = 'normal'"
    } else {
        ""
    };
    let recent_calls: Vec<CallId> = c
        .prepare(&format!(
            "SELECT c.id FROM calls c WHERE c.id IN
               (SELECT call_id FROM call_participants WHERE person_id = ?1
                UNION SELECT call_id FROM speakers WHERE person_id = ?1) {sensitive}
             ORDER BY c.started_at DESC LIMIT {MAX_RECENT_CALLS}"
        ))?
        .query_map([&id], |r| Ok(CallId::new(r.get::<_, String>(0)?)))?
        .collect::<Result<_, _>>()?;
    if cloud && recent_calls.is_empty() {
        return Ok(Err(MISSING));
    }
    // A cloud run is told who the person is by their pseudonym only: an alias is another name
    // for the same person and would reach the model under no pseudonym at all.
    let aliases = if cloud {
        vec![]
    } else {
        c.prepare("SELECT alias FROM person_aliases WHERE person_id = ?1 ORDER BY rowid")?
            .query_map([&id], |r| r.get(0))?
            .collect::<Result<_, _>>()?
    };
    let open_items = items_of(
        c,
        &format!("i.owner_person_id = ? AND {OPEN}"),
        vec![Sql::Text(id.clone())],
        cloud,
        |_| true,
    )?;
    Ok(Ok(to_json(&GetPersonOutput {
        person_id: PersonId::new(id),
        display_name,
        role,
        aliases,
        recent_calls,
        open_items,
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
                "INSERT INTO people (id, rev, display_name, short_name) VALUES
                   ('p_n', 1, 'Nina', 'Nina'), ('p_s', 1, 'Sam', 'Sam');
                 INSERT INTO calls (id, rev, started_at, title, call_type, status, mode_used, privacy_class) VALUES
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
            call: None,
            live: false,
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

    /// The release step rechecks what the read assembled: a call marked sensitive in between,
    /// and any field that names audio, voice profiles, credentials or a redaction map.
    #[test]
    fn release_refuses_a_result_that_names_a_sensitive_call_or_a_secret_field() {
        let dir = tempfile::tempdir().unwrap();
        let clock = Arc::new(crate::SystemClock);
        let core = Core::open(dir.path(), crate::CoreDeps::new(clock, Arc::new(Quiet))).unwrap();
        noter_db::rusqlite::Connection::open(dir.path().join("noter.db"))
            .unwrap()
            .execute_batch(
                "INSERT INTO calls (id, rev, started_at, title, call_type, status, mode_used, privacy_class) VALUES
                   ('c_n', 1, 1, 'N', 'planning', 'ready', 'cloud', 'normal'),
                   ('c_s', 1, 2, 'S', 'planning', 'ready', 'local_only', 'sensitive');",
            )
            .unwrap();
        let trusted = |cloud| Trusted {
            run_id: "r".into(),
            call: None,
            live: false,
            cloud,
            cancel: watch::channel(false).1,
        };
        // The run is not registered, so a cloud release is refused at the liveness check first:
        // register it, then the sensitive call is what stops the result.
        core.register_mcp_run(McpRegistration {
            llm_run_id: "r".into(),
            call_id: None,
            cloud: true,
            tools: vec![],
            live: false,
        })
        .unwrap();
        let named = |call: &str| json!({ "items": [{ "call_id": call }], "recent_calls": [call] });
        assert_eq!(core.release(&trusted(true), named("c_s")), Err(FORBIDDEN));
        assert!(core.names_sensitive_call(&named("c_s")));
        assert!(!core.names_sensitive_call(&named("c_n")));
        // A local run may read a sensitive call; no run may carry a secret field.
        assert!(core.release(&trusted(false), named("c_s")).is_ok());
        for key in [
            "audio_path",
            "voice_profile",
            "api_key",
            "redaction_map",
            "credential",
        ] {
            let leaky = json!({ "lines": [{ key: "x" }] });
            assert_eq!(core.release(&trusted(false), leaky), Err(INTERNAL), "{key}");
        }
    }
}
