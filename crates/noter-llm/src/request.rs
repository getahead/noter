use std::sync::Arc;

use noter_protocol::error::RuntimeUnavailableReason;
use noter_protocol::model::settings::AuditWhat;
use noter_protocol::skills::{
    AskAnswerOutput, CouncilTickOutput, HandoffPromptOutput, PostCallOutput,
    ReconcileJudgementOutput, RoleReviewOutput,
};
use noter_protocol::{
    AgentId, AuditId, CallId, CoreError, Effort, LlmRunId, PrivacyMode, RuntimeChoice, TimestampMs,
};
use serde_json::Value;
use tokio::sync::watch;

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
    /// Tool names the router has admitted for this request.
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

impl Privacy {
    /// Whether D1 lets a run under this privacy query the user's live MCP sources: Cloud
    /// allowed, with no sensitive context, and online.
    pub fn allows_live(&self) -> bool {
        self.mode == PrivacyMode::CloudAllowed && !self.sensitive && !self.offline
    }
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

    pub(crate) async fn cancelled(&self) {
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

/// A warm session opened with [`Llm::open_session`].
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SessionId(pub(crate) String);

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

    #[cfg(test)]
    pub(crate) fn name(self) -> &'static str {
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

pub(crate) type Now = Arc<dyn Fn() -> TimestampMs + Send + Sync>;
