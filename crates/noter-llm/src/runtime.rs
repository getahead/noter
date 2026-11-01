// @cpt-component:cpt-noter-component-core-llm-router:p1
// @cpt-interface:cpt-noter-interface-llm-runtime:p1
//! The `LlmRuntime` interface: one entry point for every model call (post-call, handoff, Ask,
//! live ticks). A request is routed, recorded in `llm_runs`, released through the egress gate,
//! run with its task timeout and cancellation, validated against the app-owned schema with one
//! repair retry and a simpler fallback, and finished with its usage in `llm_runs`.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard};

use noter_db::{ChangeMeta, Mutation, Store};
use noter_protocol::error::RuntimeUnavailableReason;
use noter_protocol::model::settings::AuditWhat;
use noter_protocol::model::Actor;
use noter_protocol::skills::{
    AskAnswerOutput, CouncilTickOutput, HandoffPromptOutput, PostCallOutput,
    ReconcileJudgementOutput, RoleReviewOutput,
};
use noter_protocol::{
    AgentId, AuditId, CallId, CoreError, Effort, ErrorCode, LlmRunId, PrivacyMode, RuntimeChoice,
    TimestampMs,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::watch;
use tokio::time::Instant;

use crate::adapters::Reply;
use crate::gate::{Adapters, Gate, Release};
use crate::route::{self, Choice, Route};
use crate::secrets::{key_account, MemorySecrets, Secret, SecretStore};
use crate::validate;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Turns of a warm session before it is reset (live ticks).
const SESSION_TICKS: u32 = 15;

/// The skills whose output contracts `noter_protocol::skills` owns (`contracts/skills/`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Skill {
    PostCall,
    CouncilTick,
    RoleReview,
    Handoff,
    AskAnswer,
    Reconcile,
}

impl Skill {
    pub const ALL: [Skill; 6] = [
        Skill::PostCall,
        Skill::CouncilTick,
        Skill::RoleReview,
        Skill::Handoff,
        Skill::AskAnswer,
        Skill::Reconcile,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Skill::PostCall => "post-call",
            Skill::CouncilTick => "council-tick",
            Skill::RoleReview => "role-review",
            Skill::Handoff => "handoff",
            Skill::AskAnswer => "ask-answer",
            Skill::Reconcile => "reconcile",
        }
    }

    pub fn from_id(id: &str) -> Option<Skill> {
        Skill::ALL.into_iter().find(|s| s.id() == id)
    }

    /// The output schema every adapter is given (Claude `--json-schema`, Codex
    /// `--output-schema`, Ollama `format`), as `just contract-regen` exports it.
    pub fn schema(self) -> Value {
        let json = match self {
            Skill::PostCall => include_str!("../../../contracts/skills/post-call.schema.json"),
            Skill::CouncilTick => {
                include_str!("../../../contracts/skills/council-tick.schema.json")
            }
            Skill::RoleReview => include_str!("../../../contracts/skills/role-review.schema.json"),
            Skill::Handoff => include_str!("../../../contracts/skills/handoff.schema.json"),
            Skill::AskAnswer => include_str!("../../../contracts/skills/ask-answer.schema.json"),
            Skill::Reconcile => include_str!("../../../contracts/skills/reconcile.schema.json"),
        };
        serde_json::from_str(json).expect("contracts/skills holds generated JSON")
    }

    /// Whether `output` has the shape of this skill's contract type (the schema above is
    /// exported from the same types).
    pub(crate) fn conforms(self, output: &Value) -> Result<(), serde_json::Error> {
        fn shape<T: serde::de::DeserializeOwned>(v: &Value) -> Result<(), serde_json::Error> {
            T::deserialize(v).map(drop)
        }
        match self {
            Skill::PostCall => shape::<PostCallOutput>(output),
            Skill::CouncilTick => shape::<CouncilTickOutput>(output),
            Skill::RoleReview => shape::<RoleReviewOutput>(output),
            Skill::Handoff => shape::<HandoffPromptOutput>(output),
            Skill::AskAnswer => shape::<AskAnswerOutput>(output),
            Skill::Reconcile => shape::<ReconcileJudgementOutput>(output),
        }
    }
}

/// Who calls, which sets the order and the timeout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskKind {
    PostCall,
    /// Prefers the target tool's runtime, then local.
    Handoff {
        target: RuntimeChoice,
    },
    Ask,
    Live,
}

/// The per-task runtime settings.
#[derive(Debug, Clone, PartialEq)]
pub struct TaskSettings {
    /// The runtime chosen for the task in Settings, if any.
    pub configured: Option<RuntimeChoice>,
    pub model: Option<String>,
    pub effort: Effort,
    /// Tools the run may use (M2: none; noter-mcp tools arrive in M3).
    pub tools: Vec<String>,
    /// Stable person pseudonyms in cloud packets, mapped back on return.
    pub pseudonyms: bool,
}

impl Default for TaskSettings {
    fn default() -> Self {
        Self {
            configured: None,
            model: None,
            effort: Effort::Medium,
            tools: Vec::new(),
            pseudonyms: false,
        }
    }
}

/// The privacy that applies to a request; read again by the gate at release time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Privacy {
    pub mode: PrivacyMode,
    pub sensitive: bool,
    pub offline: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Budget {
    /// Cost cap for API-key runs; own accounts and local runs have no cost.
    pub max_cost_usd: Option<f64>,
}

/// The privacy class of one packet item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceClass {
    Normal,
    /// Never admitted to a cloud packet.
    Sensitive,
    /// Never leaves the Mac.
    Audio,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PacketItem {
    /// The segment or chunk id outputs cite.
    pub id: String,
    pub source: SourceClass,
    pub text: String,
}

/// What the caller hands the model; callers build it, the gate decides what of it leaves.
#[derive(Debug, Clone, PartialEq)]
pub struct Packet {
    /// What leaves, as the Privacy pane names it.
    pub what: AuditWhat,
    pub items: Vec<PacketItem>,
    /// Names to pseudonymize when the task asks for it.
    pub people: Vec<String>,
    /// What the call is, beside its lines; empty for skills that need none.
    pub context: PacketContext,
}

/// The call's context a skill reads with the lines: its type, the language outputs are written
/// in and the glossary's terms. Leaves with the items, redacted and pseudonymized like them.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PacketContext {
    pub call_type: Option<String>,
    pub language: Option<noter_protocol::Lang>,
    pub glossary: Vec<String>,
}

impl PacketContext {
    pub(crate) fn is_empty(&self) -> bool {
        self.call_type.is_none() && self.language.is_none() && self.glossary.is_empty()
    }
}

/// The caller's cancellation handle; cloning shares it.
#[derive(Debug, Clone)]
pub struct Cancel(Arc<watch::Sender<bool>>);

impl Default for Cancel {
    fn default() -> Self {
        Self(Arc::new(watch::channel(false).0))
    }
}

impl Cancel {
    pub fn cancel(&self) {
        self.0.send_replace(true);
    }

    pub fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }

    async fn cancelled(&self) {
        let mut rx = self.0.subscribe();
        let _ = rx.wait_for(|c| *c).await;
    }
}

/// One model call.
#[derive(Debug, Clone)]
pub struct RunRequest {
    pub skill: Skill,
    pub skill_version: String,
    /// The simpler skill/schema used after a failed repair, if the caller has one.
    pub fallback: Option<Skill>,
    pub packet: Packet,
    pub task: TaskKind,
    pub settings: TaskSettings,
    pub budget: Budget,
    pub privacy: watch::Receiver<Privacy>,
    pub cancel: Cancel,
    pub call_id: Option<CallId>,
    pub agent_id: Option<AgentId>,
}

impl RunRequest {
    pub fn new(
        skill: Skill,
        skill_version: &str,
        packet: Packet,
        task: TaskKind,
        privacy: watch::Receiver<Privacy>,
    ) -> Self {
        Self {
            skill,
            skill_version: skill_version.into(),
            fallback: None,
            packet,
            task,
            settings: TaskSettings::default(),
            budget: Budget::default(),
            privacy,
            cancel: Cancel::default(),
            call_id: None,
            agent_id: None,
        }
    }
}

/// One runtime choice as its adapter sees it now.
#[derive(Debug, Clone, PartialEq)]
pub struct Availability {
    pub runtime: RuntimeChoice,
    /// `None` when the runtime can run.
    pub unavailable: Option<RuntimeUnavailableReason>,
    /// The installed CLI's version (CLI runtimes).
    pub version: Option<String>,
    /// Where the runtime was found: the CLI that answered `--version`, or the Ollama URL that
    /// answered `/api/tags`; `None` when it was not found.
    pub path: Option<String>,
    /// The CLI versions the adapter was tested with; any other is refused.
    pub tested: Option<Tested>,
    pub models: Vec<String>,
}

/// A tested CLI version range: from `min` up to, not including, `below`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tested {
    pub min: [u64; 3],
    pub below: [u64; 3],
}

impl Tested {
    /// `major.minor.patch`, ignoring a pre-release or build suffix.
    pub(crate) fn parse(version: &str) -> Option<[u64; 3]> {
        let core = version.split(['-', '+']).next()?;
        let mut parts = core.split('.').map(|p| p.parse::<u64>().ok());
        let v = [parts.next()??, parts.next()??, parts.next()??];
        parts.next().is_none().then_some(v)
    }

    pub fn admits(&self, version: &str) -> bool {
        Self::parse(version).is_some_and(|v| self.min <= v && v < self.below)
    }
}

impl std::fmt::Display for Tested {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let [a, b, c] = self.min;
        let [x, y, z] = self.below;
        write!(f, ">={a}.{b}.{c}, <{x}.{y}.{z}")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Usage {
    pub tokens_in: u64,
    pub tokens_out: u64,
    /// API-key runs only.
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Provenance {
    pub llm_run_id: LlmRunId,
    pub runtime: RuntimeChoice,
    pub adapter: &'static str,
    pub model: String,
    pub skill: Skill,
    pub skill_version: String,
    pub retried: bool,
    pub fallback: bool,
    pub usage: Usage,
    pub duration_ms: u64,
    pub first_token_ms: Option<u64>,
    pub session_id: Option<String>,
    /// One `audit_log` row per cloud release of this run.
    pub audit_ids: Vec<AuditId>,
}

/// Output that passed schema and evidence checks, with its provenance.
#[derive(Debug, Clone, PartialEq)]
pub struct Validated {
    pub output: Value,
    pub provenance: Provenance,
}

/// Why a request ended without output; the caller keeps whatever it already had.
#[derive(Debug, Clone, PartialEq)]
pub enum Failure {
    /// `runtime_unavailable` or `cli_version_unsupported`, with `ErrorDetail`.
    Unavailable(CoreError),
    /// `llm_runs` or `audit_log` could not be written; nothing was released.
    Storage(CoreError),
    /// The runtime answered with an error code.
    Runtime {
        code: String,
    },
    /// Still invalid after the repair retry and the fallback (`schema`, `html`, `citations`).
    Invalid {
        reason: &'static str,
    },
    Budget,
    Timeout,
    Cancelled,
}

pub type RunOutcome = Result<Validated, Failure>;

/// A warm session opened with [`LlmRuntime::open_session`].
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SessionId(String);

/// The internal runtime interface (DESIGN-core 3.3): post-call (2.17) and handoff (2.19) call it.
pub trait LlmRuntime: Send + Sync {
    fn availability(&self) -> Vec<Availability>;
    fn run_once(&self, req: RunRequest) -> BoxFuture<'_, RunOutcome>;
    fn open_session<'a>(&'a self, req: &'a RunRequest)
        -> BoxFuture<'a, Result<SessionId, Failure>>;
    fn send_turn<'a>(
        &'a self,
        session: &'a SessionId,
        req: RunRequest,
    ) -> BoxFuture<'a, RunOutcome>;
    fn close_session(&self, session: &SessionId);
    /// A follow-up in a recorded CLI session (post-call questions).
    fn resume<'a>(&'a self, cli_session: &'a str, req: RunRequest) -> BoxFuture<'a, RunOutcome>;
}

/// Request lifecycle (`cpt-noter-state-core-llm-gate-request`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RequestState {
    Preparing,
    Gated,
    Running,
    Validating,
    Succeeded,
    Failed,
    Cancelled,
}

impl RequestState {
    // @cpt-state:cpt-noter-state-core-llm-gate-request:p1
    pub(crate) fn can(self, next: RequestState) -> bool {
        use RequestState::*;
        match (self, next) {
            // @cpt-begin:cpt-noter-state-core-llm-gate-request:p1:inst-st-gated
            (Preparing, Gated) => true,
            // @cpt-end:cpt-noter-state-core-llm-gate-request:p1:inst-st-gated
            // @cpt-begin:cpt-noter-state-core-llm-gate-request:p1:inst-st-running
            (Gated, Running) => true,
            // @cpt-end:cpt-noter-state-core-llm-gate-request:p1:inst-st-running
            // @cpt-begin:cpt-noter-state-core-llm-gate-request:p1:inst-st-validating
            (Running, Validating) => true,
            // @cpt-end:cpt-noter-state-core-llm-gate-request:p1:inst-st-validating
            // @cpt-begin:cpt-noter-state-core-llm-gate-request:p1:inst-st-retry
            (Validating, Preparing) => true,
            // @cpt-end:cpt-noter-state-core-llm-gate-request:p1:inst-st-retry
            // @cpt-begin:cpt-noter-state-core-llm-gate-request:p1:inst-st-success
            (Validating, Succeeded) => true,
            // @cpt-end:cpt-noter-state-core-llm-gate-request:p1:inst-st-success
            // @cpt-begin:cpt-noter-state-core-llm-gate-request:p1:inst-st-failure
            (Preparing | Running | Validating, Failed) => true,
            // @cpt-end:cpt-noter-state-core-llm-gate-request:p1:inst-st-failure
            // @cpt-begin:cpt-noter-state-core-llm-gate-request:p1:inst-st-cancel
            (Preparing | Running | Validating, Cancelled) => true,
            // @cpt-end:cpt-noter-state-core-llm-gate-request:p1:inst-st-cancel
            _ => false,
        }
    }

    fn name(self) -> &'static str {
        match self {
            RequestState::Preparing => "preparing",
            RequestState::Gated => "gated",
            RequestState::Running => "running",
            RequestState::Validating => "validating",
            RequestState::Succeeded => "succeeded",
            RequestState::Failed => "failed",
            RequestState::Cancelled => "cancelled",
        }
    }
}

type Log = Box<dyn Fn(&Value) + Send + Sync>;
type OnSwitch = Box<dyn Fn(&CallId) + Send + Sync>;
type OnKeyRejected = Box<dyn Fn(RuntimeChoice, &LlmRunId) + Send + Sync>;
/// A verification's runtime and the candidate key it runs with.
type Candidate = Option<(RuntimeChoice, Secret)>;
pub(crate) type Now = Arc<dyn Fn() -> TimestampMs + Send + Sync>;

struct Session {
    runtime: RuntimeChoice,
    cli_session: String,
    ticks: u32,
}

struct Inner {
    gate: Gate,
    store: Arc<Store>,
    log: Option<Log>,
    on_switch: Option<OnSwitch>,
    /// The API keys of the API-key runtimes (the Keychain in the app).
    secrets: Arc<dyn SecretStore>,
    on_key_rejected: Option<OnKeyRejected>,
    /// Consecutive runtime failures per call, and the calls switched to local.
    failures: Mutex<HashMap<CallId, u32>>,
    switched: Mutex<HashSet<CallId>>,
    sessions: Mutex<HashMap<SessionId, Session>>,
}

/// The runtime router: the one `LlmRuntime` implementation. Cloning shares it.
#[derive(Clone)]
pub struct Llm(Arc<Inner>);

impl Llm {
    pub fn new(
        store: Arc<Store>,
        adapters: Adapters,
        now: impl Fn() -> TimestampMs + Send + Sync + 'static,
    ) -> Self {
        Self(Arc::new(Inner {
            gate: Gate::new(adapters, store.clone(), Arc::new(now)),
            store,
            log: None,
            on_switch: None,
            secrets: Arc::new(MemorySecrets::default()),
            on_key_rejected: None,
            failures: Mutex::default(),
            switched: Mutex::default(),
            sessions: Mutex::default(),
        }))
    }

    /// Operational log lines (ids, states, codes, timings; never packet, model text or keys).
    pub fn on_log(self, f: impl Fn(&Value) + Send + Sync + 'static) -> Self {
        self.configure(|i| i.log = Some(Box::new(f)))
    }

    /// Called when two consecutive runtime failures switch a call to local: the core publishes
    /// `privacy:changed` with `EffectiveMode::SwitchedToLocal`.
    pub fn on_switch_to_local(self, f: impl Fn(&CallId) + Send + Sync + 'static) -> Self {
        self.configure(|i| i.on_switch = Some(Box::new(f)))
    }

    /// Where the API keys are; without one, no API-key runtime has a key.
    pub fn with_secrets(self, secrets: Arc<dyn SecretStore>) -> Self {
        self.configure(|i| i.secrets = secrets)
    }

    /// Called when the provider rejects a stored API key during a run (`key_rejected`): the
    /// core marks the key rejected (`inst-key-state-revoked`).
    pub fn on_key_rejected(
        self,
        f: impl Fn(RuntimeChoice, &LlmRunId) + Send + Sync + 'static,
    ) -> Self {
        self.configure(|i| i.on_key_rejected = Some(Box::new(f)))
    }

    // @cpt-begin:cpt-noter-flow-core-credentials-privacy-keys:p1:inst-key-verify
    /// Verifies a candidate API key with one minimal run on its own runtime, never another,
    /// through the gate (an `llm_runs` row and, for the cloud, its audit row): an empty packet,
    /// so nothing of the user's leaves. Any answer means the provider took the key; the
    /// candidate is not stored here.
    pub async fn verify_key(
        &self,
        runtime: RuntimeChoice,
        candidate: Secret,
        privacy: Privacy,
    ) -> Result<(), Failure> {
        let packet = Packet {
            // shortcut: the closest category for a call that carries no user text; a `key_check`
            // value needs a contract change (M3 audit pane).
            what: AuditWhat::Outputs,
            items: Vec::new(),
            people: Vec::new(),
            context: PacketContext::default(),
        };
        let (_privacy, rx) = watch::channel(privacy);
        let mut req = RunRequest::new(Skill::AskAnswer, "key-check", packet, TaskKind::Ask, rx);
        req.settings.configured = Some(runtime);
        req.settings.effort = Effort::Low;
        match self.0.run(req, None, Some((runtime, candidate))).await {
            Ok(_) | Err(Failure::Invalid { .. }) => Ok(()),
            Err(failure) => Err(failure),
        }
    }
    // @cpt-end:cpt-noter-flow-core-credentials-privacy-keys:p1:inst-key-verify

    /// Asks every runtime again what it has (CLI versions, Ollama's pulled models) and answers
    /// the availability that follows. The CLI probes block, so they run off the async workers.
    pub async fn refresh(&self) -> Vec<Availability> {
        let adapters = self.0.gate.adapters();
        for adapter in &adapters {
            adapter.probe().await;
        }
        let llm = self.clone();
        let refreshed = tokio::task::spawn_blocking(move || {
            adapters.iter().for_each(|a| a.refresh());
            llm.0.availability(None)
        });
        refreshed
            .await
            .unwrap_or_else(|_| self.0.availability(None))
    }

    fn configure(self, f: impl FnOnce(&mut Inner)) -> Self {
        let mut inner = Arc::try_unwrap(self.0)
            .unwrap_or_else(|_| panic!("configure the router before sharing it"));
        f(&mut inner);
        Self(Arc::new(inner))
    }
}

/// What one request accumulates across its attempts, for `llm_runs` and the provenance.
struct Tally {
    run_id: LlmRunId,
    started: Instant,
    choice: Choice,
    skill: Skill,
    retried: bool,
    fallback: bool,
    schema_ok: bool,
    usage: Usage,
    spent_usd: f64,
    first_token_ms: Option<u64>,
    session_id: Option<String>,
    audit_ids: Vec<AuditId>,
}

impl Inner {
    fn log(&self, line: Value) {
        if let Some(log) = &self.log {
            log(&line);
        }
    }

    fn enter(&self, state: &mut RequestState, next: RequestState, run: Option<&LlmRunId>) {
        debug_assert!(state.can(next), "request {state:?} cannot become {next:?}");
        *state = next;
        self.log_state(next, run);
    }

    fn log_state(&self, state: RequestState, run: Option<&LlmRunId>) {
        let run = run.map(LlmRunId::as_str);
        self.log(
            json!({"module": "llm", "event": "state", "llm_run_id": run, "state": state.name()}),
        );
    }

    /// The adapters' availability, with an API-key runtime unavailable while its key cannot be
    /// read. A verification sees only its own runtime, with the candidate standing for the key.
    fn availability(&self, verifying: Option<RuntimeChoice>) -> Vec<Availability> {
        let mut all = self.gate.availability();
        for a in all.iter_mut().filter(|a| a.unavailable.is_none()) {
            let Some(account) = key_account(a.runtime) else {
                continue;
            };
            if verifying != Some(a.runtime) && !matches!(self.secrets.get(account), Ok(Some(_))) {
                a.unavailable = Some(RuntimeUnavailableReason::NoKey);
            }
        }
        if let Some(runtime) = verifying {
            all.retain(|a| a.runtime == runtime);
        }
        all
    }

    /// The key an attempt on `runtime` runs with: the candidate, or the stored one.
    fn key(&self, runtime: RuntimeChoice, candidate: &Candidate) -> Option<Secret> {
        if let Some((_, key)) = candidate {
            return Some(key.clone());
        }
        let account = key_account(runtime)?;
        self.secrets.get(account).ok().flatten()
    }

    fn route(
        &self,
        req: &RunRequest,
        spent_usd: f64,
        prefer_local: bool,
        verifying: Option<RuntimeChoice>,
    ) -> Result<Choice, Failure> {
        let available = self.availability(verifying);
        let switched = req
            .call_id
            .as_ref()
            .is_some_and(|c| lock(&self.switched).contains(c));
        route::route(&Route {
            task: &req.task,
            settings: &req.settings,
            available: &available,
            privacy: *req.privacy.borrow(),
            switched_to_local: switched,
            budget: &req.budget,
            spent_usd,
            prefer_local,
        })
    }

    /// Counts consecutive runtime failures per call; the second switches the call to local.
    fn note_outcome(&self, call: Option<&CallId>, runtime_failed: bool) {
        let Some(call) = call else { return };
        let mut failures = lock(&self.failures);
        if !runtime_failed {
            failures.remove(call);
            return;
        }
        let count = failures.entry(call.clone()).or_default();
        *count += 1;
        // @cpt-begin:cpt-noter-algo-core-llm-gate-route:p1:inst-route-failover
        if *count >= 2 && lock(&self.switched).insert(call.clone()) {
            self.log(
                json!({"module": "llm", "event": "switched_to_local", "call_id": call.as_str()}),
            );
            if let Some(on_switch) = &self.on_switch {
                on_switch(call);
            }
        }
        // @cpt-end:cpt-noter-algo-core-llm-gate-route:p1:inst-route-failover
    }

    // @cpt-flow:cpt-noter-flow-core-llm-gate-run:p1
    async fn run(
        &self,
        req: RunRequest,
        session: Option<(RuntimeChoice, String)>,
        candidate: Candidate,
    ) -> RunOutcome {
        // @cpt-begin:cpt-noter-flow-core-llm-gate-run:p1:inst-run-input
        let started = Instant::now();
        let mut state = RequestState::Preparing;
        self.log_state(state, None);
        // @cpt-end:cpt-noter-flow-core-llm-gate-run:p1:inst-run-input
        if req.cancel.is_cancelled() {
            self.enter(&mut state, RequestState::Cancelled, None);
            return Err(Failure::Cancelled);
        }
        // @cpt-begin:cpt-noter-flow-core-llm-gate-run:p1:inst-run-route
        let verifying = candidate.as_ref().map(|(runtime, _)| *runtime);
        let routed = self
            .route(&req, 0.0, false, verifying)
            .and_then(|choice| match &session {
                // A session never carries a turn to another runtime (privacy changed, say).
                Some((runtime, _)) if *runtime != choice.runtime => Err(Failure::Unavailable(
                    route::unavailable(*runtime, RuntimeUnavailableReason::SensitiveCallNeedsLocal),
                )),
                _ => Ok(choice),
            });
        // @cpt-end:cpt-noter-flow-core-llm-gate-run:p1:inst-run-route
        let choice = match routed {
            Ok(choice) => choice,
            Err(failure) => {
                self.enter(&mut state, RequestState::Failed, None);
                return Err(failure);
            }
        };
        // @cpt-begin:cpt-noter-flow-core-llm-gate-run:p1:inst-run-record
        let run_id = LlmRunId::new(format!("llm_{}", ulid::Ulid::generate()));
        if let Err(e) = self.record_start(&run_id, &req, &choice) {
            self.enter(&mut state, RequestState::Failed, None);
            return Err(Failure::Storage(e));
        }
        // @cpt-end:cpt-noter-flow-core-llm-gate-run:p1:inst-run-record
        let mut tally = Tally {
            run_id,
            started,
            choice,
            skill: req.skill,
            retried: false,
            fallback: false,
            schema_ok: false,
            usage: Usage::default(),
            spent_usd: 0.0,
            first_token_ms: None,
            session_id: session.as_ref().map(|(_, s)| s.clone()),
            audit_ids: Vec::new(),
        };
        let cli_session = session.as_ref().map(|(_, s)| s.as_str());
        let outcome = self
            .attempts(&req, cli_session, &candidate, &mut tally, &mut state)
            .await;
        // @cpt-begin:cpt-noter-flow-core-llm-gate-run:p1:inst-run-usage
        let ended = self.record_end(&tally);
        // @cpt-end:cpt-noter-flow-core-llm-gate-run:p1:inst-run-usage
        let runtime_failed = matches!(outcome, Err(Failure::Runtime { .. } | Failure::Timeout));
        self.note_outcome(req.call_id.as_ref(), runtime_failed);
        // @cpt-begin:cpt-noter-state-core-credentials-privacy-key:p1:inst-key-state-revoked
        let rejected = matches!(&outcome, Err(Failure::Runtime { code }) if code == "key_rejected");
        if rejected && candidate.is_none() && route::is_api_key(tally.choice.runtime) {
            if let Some(on_key_rejected) = &self.on_key_rejected {
                on_key_rejected(tally.choice.runtime, &tally.run_id);
            }
        }
        // @cpt-end:cpt-noter-state-core-credentials-privacy-key:p1:inst-key-state-revoked
        let code = outcome.as_ref().map_or_else(failure_code, |_| "succeeded");
        self.log(
            json!({"module": "llm", "event": "run_end", "llm_run_id": tally.run_id.as_str(),
            "runtime": runtime_name(tally.choice.runtime), "outcome": code,
            "duration_ms": elapsed_ms(tally.started), "retried": tally.retried}),
        );
        // @cpt-begin:cpt-noter-flow-core-llm-gate-run:p1:inst-run-return
        let adapter = self.gate.adapter_name(tally.choice.runtime);
        match (outcome, ended) {
            (Ok(output), Ok(())) => Ok(Validated {
                output,
                provenance: provenance(&req, &tally, adapter),
            }),
            (Ok(_), Err(e)) => Err(Failure::Storage(e)),
            (Err(failure), _) => Err(failure),
        }
        // @cpt-end:cpt-noter-flow-core-llm-gate-run:p1:inst-run-return
    }

    /// The first attempt, the repair retry and the fallback; each one routed and gated again.
    // @cpt-algo:cpt-noter-algo-core-llm-gate-validate:p1
    async fn attempts(
        &self,
        req: &RunRequest,
        session: Option<&str>,
        candidate: &Candidate,
        tally: &mut Tally,
        state: &mut RequestState,
    ) -> Result<Value, Failure> {
        let verifying = candidate.as_ref().map(|(runtime, _)| *runtime);
        let map_id = format!("rmap_{}", ulid::Ulid::generate());
        let mut repair: Option<String> = None;
        let run_id = tally.run_id.clone();
        let run = Some(&run_id);
        let mut attempt = 0;
        loop {
            if req.cancel.is_cancelled() {
                self.enter(state, RequestState::Cancelled, run);
                return Err(Failure::Cancelled);
            }
            if attempt > 0 {
                let rerouted = (self.route(req, tally.spent_usd, tally.fallback, verifying))
                    .and_then(|choice| match session {
                        Some(_) if choice.runtime != tally.choice.runtime => {
                            Err(Failure::Unavailable(route::unavailable(
                                tally.choice.runtime,
                                RuntimeUnavailableReason::SensitiveCallNeedsLocal,
                            )))
                        }
                        _ => Ok(choice),
                    });
                match rerouted {
                    Ok(choice) => tally.choice = choice,
                    Err(failure) => {
                        self.enter(state, RequestState::Failed, run);
                        return Err(failure);
                    }
                }
            }
            // @cpt-begin:cpt-noter-flow-core-llm-gate-run:p1:inst-run-gate
            let release = Release {
                llm_run_id: &run_id,
                call_id: req.call_id.as_ref(),
                map_id: &map_id,
                pseudonyms: req.settings.pseudonyms,
                skill: tally.skill,
                repair: repair.as_deref(),
            };
            let privacy_now = *req.privacy.borrow();
            let released =
                self.gate
                    .release(&release, &req.packet, tally.choice.runtime, privacy_now);
            let approved = match released {
                Ok(approved) => approved,
                Err(failure) => {
                    self.enter(state, RequestState::Failed, run);
                    return Err(failure);
                }
            };
            tally.audit_ids.extend(approved.audit_id().cloned());
            self.enter(state, RequestState::Gated, run);
            // @cpt-end:cpt-noter-flow-core-llm-gate-run:p1:inst-run-gate
            self.enter(state, RequestState::Running, run);
            // @cpt-begin:cpt-noter-flow-core-llm-gate-run:p1:inst-run-adapter
            let budget_usd = req
                .budget
                .max_cost_usd
                .filter(|_| route::is_api_key(tally.choice.runtime))
                .map(|cap| (cap - tally.spent_usd).max(0.0));
            let key = self.key(tally.choice.runtime, candidate);
            let sent = (self.gate).send(
                &approved,
                &tally.choice,
                tally.skill,
                session,
                budget_usd,
                key,
            );
            // @cpt-end:cpt-noter-flow-core-llm-gate-run:p1:inst-run-adapter
            // @cpt-begin:cpt-noter-flow-core-llm-gate-run:p1:inst-run-cancel
            let reply: Result<Reply, Failure> = tokio::select! {
                r = tokio::time::timeout(tally.choice.timeout, sent) => match r {
                    Ok(Ok(reply)) => Ok(reply),
                    Ok(Err(code)) => Err(Failure::Runtime { code }),
                    Err(_) => Err(Failure::Timeout),
                },
                // Dropping the adapter's future stops its child and removes its run config;
                // its late output can no longer reach the caller.
                () = req.cancel.cancelled() => Err(Failure::Cancelled),
            };
            let reply = match reply {
                Ok(reply) => reply,
                Err(failure) => {
                    let next = if failure == Failure::Cancelled {
                        RequestState::Cancelled
                    } else {
                        RequestState::Failed
                    };
                    self.enter(state, next, run);
                    return Err(failure);
                }
            };
            // @cpt-end:cpt-noter-flow-core-llm-gate-run:p1:inst-run-cancel
            tally.usage.tokens_in += reply.tokens_in;
            tally.usage.tokens_out += reply.tokens_out;
            if route::is_api_key(tally.choice.runtime) {
                let cost = reply.cost_usd.unwrap_or(0.0);
                tally.usage.cost_usd = Some(tally.usage.cost_usd.unwrap_or(0.0) + cost);
                tally.spent_usd += cost;
            }
            tally.first_token_ms = tally.first_token_ms.or(reply.first_token_ms);
            tally.session_id = reply.session_id.or(tally.session_id.take());
            self.enter(state, RequestState::Validating, run);
            // @cpt-begin:cpt-noter-flow-core-llm-gate-run:p1:inst-run-validate
            let checked = validate::validate(tally.skill, &reply.output, approved.permitted());
            // @cpt-end:cpt-noter-flow-core-llm-gate-run:p1:inst-run-validate
            match checked {
                Ok(()) => {
                    // A cancelled result may not reach the caller's records.
                    if req.cancel.is_cancelled() {
                        self.enter(state, RequestState::Cancelled, run);
                        return Err(Failure::Cancelled);
                    }
                    let mut output = reply.output;
                    // @cpt-begin:cpt-noter-flow-core-llm-gate-run:p1:inst-run-validate
                    approved.map_back(&mut output);
                    // @cpt-end:cpt-noter-flow-core-llm-gate-run:p1:inst-run-validate
                    tally.schema_ok = true;
                    self.enter(state, RequestState::Succeeded, run);
                    // @cpt-begin:cpt-noter-algo-core-llm-gate-validate:p1:inst-validate-return
                    return Ok(output);
                    // @cpt-end:cpt-noter-algo-core-llm-gate-validate:p1:inst-validate-return
                }
                // @cpt-begin:cpt-noter-algo-core-llm-gate-validate:p1:inst-validate-retry
                Err(invalid) if attempt == 0 => {
                    repair = Some(invalid.explain);
                    tally.retried = true;
                }
                // @cpt-end:cpt-noter-algo-core-llm-gate-validate:p1:inst-validate-retry
                // @cpt-begin:cpt-noter-algo-core-llm-gate-validate:p1:inst-validate-simple
                Err(_) if attempt == 1 => {
                    repair = None;
                    tally.skill = req.fallback.unwrap_or(req.skill);
                    tally.fallback = true;
                }
                // @cpt-end:cpt-noter-algo-core-llm-gate-validate:p1:inst-validate-simple
                // @cpt-begin:cpt-noter-algo-core-llm-gate-validate:p1:inst-validate-fail
                Err(invalid) => {
                    self.enter(state, RequestState::Failed, run);
                    return Err(Failure::Invalid {
                        reason: invalid.reason,
                    });
                } // @cpt-end:cpt-noter-algo-core-llm-gate-validate:p1:inst-validate-fail
            }
            self.enter(state, RequestState::Preparing, run);
            attempt += 1;
        }
    }

    fn record_start(
        &self,
        id: &LlmRunId,
        req: &RunRequest,
        choice: &Choice,
    ) -> Result<(), CoreError> {
        let mut hash = Sha256::new();
        hash.update(req.skill.id());
        hash.update(&req.skill_version);
        for item in &req.packet.items {
            hash.update(&item.id);
            hash.update(&item.text);
        }
        let values = vec![
            ("adapter", json!(self.gate.adapter_name(choice.runtime))),
            ("runtime_choice", json!(runtime_name(choice.runtime))),
            ("model", json!(choice.model)),
            ("skill", json!(req.skill.id())),
            ("skill_version", json!(req.skill_version)),
            (
                "agent_id",
                json!(req.agent_id.as_ref().map(AgentId::as_str)),
            ),
            ("call_id", json!(req.call_id.as_ref().map(CallId::as_str))),
            ("prompt_hash", json!(hex(&hash.finalize()))),
        ];
        self.write_run(id, choice, values, "Model run started")
    }

    fn record_end(&self, t: &Tally) -> Result<(), CoreError> {
        let values = vec![
            ("adapter", json!(self.gate.adapter_name(t.choice.runtime))),
            ("runtime_choice", json!(runtime_name(t.choice.runtime))),
            ("model", json!(t.choice.model)),
            ("skill", json!(t.skill.id())),
            ("tokens_in", json!(t.usage.tokens_in)),
            ("tokens_out", json!(t.usage.tokens_out)),
            ("cost_usd", json!(t.usage.cost_usd)),
            ("duration_ms", json!(elapsed_ms(t.started))),
            ("first_token_ms", json!(t.first_token_ms)),
            ("schema_ok", json!(t.schema_ok)),
            ("retried", json!(t.retried)),
            ("session_id", json!(t.session_id)),
        ];
        self.write_run(&t.run_id, &t.choice, values, "Model run ended")
    }

    fn write_run(
        &self,
        id: &LlmRunId,
        choice: &Choice,
        values: Vec<(&'static str, Value)>,
        summary: &str,
    ) -> Result<(), CoreError> {
        let mutation = Mutation {
            entity_type: "llm_run",
            table: "llm_runs",
            id: id.as_str().into(),
            base_rev: None,
            bump_rev: false,
            values,
        };
        let meta = model_meta(id, choice.runtime, &choice.model, summary);
        self.store.write(mutation, meta).map(drop)
    }

    /// The runtime a session opens or resumes on, with its CLI version read again: the CLI may
    /// have been updated since startup. The caller then creates the isolated environment.
    fn open_route(&self, req: &RunRequest) -> Result<Choice, Failure> {
        // @cpt-begin:cpt-noter-flow-core-llm-gate-session:p1:inst-session-open
        let first = self.route(req, 0.0, false, None)?;
        self.gate.refresh(first.runtime);
        self.route(req, 0.0, false, None)
        // @cpt-end:cpt-noter-flow-core-llm-gate-session:p1:inst-session-open
    }

    // @cpt-flow:cpt-noter-flow-core-llm-gate-session:p1
    async fn turn(&self, id: &SessionId, req: RunRequest) -> RunOutcome {
        // @cpt-begin:cpt-noter-flow-core-llm-gate-session:p1:inst-session-reset
        let (runtime, cli_session) = {
            let mut sessions = lock(&self.sessions);
            let Some(session) = sessions.get_mut(id) else {
                return Err(Failure::Unavailable(CoreError::new(
                    ErrorCode::NotFound,
                    "the session is closed",
                )));
            };
            session.ticks += 1;
            if session.ticks > SESSION_TICKS {
                self.gate
                    .close_session(session.runtime, &session.cli_session);
                match self.gate.open_session(session.runtime, None) {
                    Ok(fresh) => session.cli_session = fresh,
                    Err(code) => {
                        sessions.remove(id);
                        return Err(Failure::Runtime { code });
                    }
                }
                session.ticks = 1;
            }
            (session.runtime, session.cli_session.clone())
        };
        // @cpt-end:cpt-noter-flow-core-llm-gate-session:p1:inst-session-reset
        // @cpt-begin:cpt-noter-flow-core-llm-gate-session:p1:inst-session-turn
        let outcome = self.run(req, Some((runtime, cli_session)), None).await;
        // @cpt-end:cpt-noter-flow-core-llm-gate-session:p1:inst-session-turn
        // @cpt-begin:cpt-noter-flow-core-llm-gate-session:p1:inst-session-close
        if matches!(
            outcome,
            Err(Failure::Unavailable(_)
                | Failure::Runtime { .. }
                | Failure::Timeout
                | Failure::Cancelled)
        ) {
            self.close(id);
        }
        // @cpt-end:cpt-noter-flow-core-llm-gate-session:p1:inst-session-close
        // @cpt-begin:cpt-noter-flow-core-llm-gate-session:p1:inst-session-return
        outcome
        // @cpt-end:cpt-noter-flow-core-llm-gate-session:p1:inst-session-return
    }

    fn close(&self, id: &SessionId) {
        if let Some(session) = lock(&self.sessions).remove(id) {
            self.gate
                .close_session(session.runtime, &session.cli_session);
        }
    }
}

impl LlmRuntime for Llm {
    fn availability(&self) -> Vec<Availability> {
        self.0.availability(None)
    }

    fn run_once(&self, req: RunRequest) -> BoxFuture<'_, RunOutcome> {
        Box::pin(self.0.run(req, None, None))
    }

    fn open_session<'a>(
        &'a self,
        req: &'a RunRequest,
    ) -> BoxFuture<'a, Result<SessionId, Failure>> {
        Box::pin(async move {
            let choice = self.0.open_route(req)?;
            let cli_session = self
                .0
                .gate
                .open_session(choice.runtime, None)
                .map_err(|code| Failure::Runtime { code })?;
            let id = SessionId(format!("ses_{}", ulid::Ulid::generate()));
            let session = Session {
                runtime: choice.runtime,
                cli_session,
                ticks: 0,
            };
            lock(&self.0.sessions).insert(id.clone(), session);
            Ok(id)
        })
    }

    fn send_turn<'a>(
        &'a self,
        session: &'a SessionId,
        req: RunRequest,
    ) -> BoxFuture<'a, RunOutcome> {
        Box::pin(self.0.turn(session, req))
    }

    fn close_session(&self, session: &SessionId) {
        self.0.close(session);
    }

    fn resume<'a>(&'a self, cli_session: &'a str, req: RunRequest) -> BoxFuture<'a, RunOutcome> {
        Box::pin(async move {
            let choice = self.0.open_route(&req)?;
            let resumed = self
                .0
                .gate
                .open_session(choice.runtime, Some(cli_session))
                .map_err(|code| Failure::Runtime { code })?;
            let outcome = self
                .0
                .run(req, Some((choice.runtime, resumed.clone())), None)
                .await;
            self.0.gate.close_session(choice.runtime, &resumed);
            outcome
        })
    }
}

fn provenance(req: &RunRequest, t: &Tally, adapter: &'static str) -> Provenance {
    Provenance {
        llm_run_id: t.run_id.clone(),
        runtime: t.choice.runtime,
        adapter,
        model: t.choice.model.clone(),
        skill: t.skill,
        skill_version: req.skill_version.clone(),
        retried: t.retried,
        fallback: t.fallback,
        usage: t.usage,
        duration_ms: elapsed_ms(t.started),
        first_token_ms: t.first_token_ms,
        session_id: t.session_id.clone(),
        audit_ids: t.audit_ids.clone(),
    }
}

/// Change-row metadata for the router's own rows: a model actor, never undoable.
pub(crate) fn model_meta(
    id: &LlmRunId,
    runtime: RuntimeChoice,
    model: &str,
    summary: &str,
) -> ChangeMeta {
    ChangeMeta {
        actor: Actor::Model {
            llm_run_id: id.clone(),
            runtime,
            model: model.into(),
        },
        summary: summary.into(),
        reason: "llm gate".into(),
        evidence_ids: Vec::new(),
        batch_id: None,
        undoable: false,
        surface: None,
    }
}

pub(crate) fn runtime_name(runtime: RuntimeChoice) -> &'static str {
    match runtime {
        RuntimeChoice::ClaudeApiKey => "claude_api_key",
        RuntimeChoice::ClaudeAccount => "claude_account",
        RuntimeChoice::CodexApiKey => "codex_api_key",
        RuntimeChoice::ChatgptAccount => "chatgpt_account",
        RuntimeChoice::Local => "local",
    }
}

fn failure_code(f: &Failure) -> &'static str {
    match f {
        Failure::Unavailable(_) => "unavailable",
        Failure::Storage(_) => "storage",
        Failure::Runtime { .. } => "runtime",
        Failure::Invalid { .. } => "invalid",
        Failure::Budget => "budget",
        Failure::Timeout => "timeout",
        Failure::Cancelled => "cancelled",
    }
}

fn elapsed_ms(since: Instant) -> u64 {
    since.elapsed().as_millis() as u64
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
pub(crate) mod tests_support {
    use super::*;

    /// An `llm_runs` row for gate tests that release outside a run.
    pub(crate) fn allocate(store: &Store) -> LlmRunId {
        let id = LlmRunId::new(format!("llm_{}", ulid::Ulid::generate()));
        let values = vec![
            ("adapter", json!("scripted")),
            ("runtime_choice", json!("local")),
            ("model", json!("scripted")),
            ("skill", json!("post-call")),
            ("skill_version", json!("1.0.0")),
            ("prompt_hash", json!("h")),
        ];
        let mutation = Mutation {
            entity_type: "llm_run",
            table: "llm_runs",
            id: id.as_str().into(),
            base_rev: None,
            bump_rev: false,
            values,
        };
        let meta = model_meta(&id, RuntimeChoice::Local, "scripted", "test");
        store.write(mutation, meta).unwrap();
        id
    }
}
