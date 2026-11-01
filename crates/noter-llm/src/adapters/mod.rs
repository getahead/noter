//! Runtime adapters. They are reachable only through the egress gate (`gate.rs` holds the
//! registry); none of them can be called with a packet that did not cross it. The scripted
//! adapter serves tests and noter-core-harness (TL-13); Claude Code and Codex run locked down
//! (`cli.rs`), Ollama on localhost.

pub(crate) mod claude_code;
pub(crate) mod cli;
pub(crate) mod codex;
pub(crate) mod ollama;
pub(crate) mod scripted;

use noter_protocol::{Effort, RuntimeChoice};
use serde_json::Value;

use crate::runtime::{Availability, BoxFuture, Skill};

/// One adapter call: the packet exactly as the gate released (and audited) it.
pub(crate) struct Invocation {
    pub runtime: RuntimeChoice,
    pub skill: Skill,
    /// The app-owned output schema, the same for every adapter.
    pub schema: Value,
    pub model: String,
    pub effort: Effort,
    pub tools: Vec<String>,
    pub packet: Vec<u8>,
    pub session: Option<String>,
    /// What an API-key run may still spend.
    pub budget_usd: Option<f64>,
}

/// What a runtime answered, before validation.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Reply {
    pub output: Value,
    pub tokens_in: u64,
    pub tokens_out: u64,
    pub cost_usd: Option<f64>,
    pub first_token_ms: Option<u64>,
    pub session_id: Option<String>,
}

pub(crate) trait RuntimeAdapter: Send + Sync {
    fn name(&self) -> &'static str;
    fn availability(&self, runtime: RuntimeChoice) -> Availability;
    /// Reads the CLI version again (on open and resume).
    fn refresh(&self) {}
    /// Runs one call; dropping the future stops it (child process, temporary config).
    /// An error is the runtime's code (`rate_limited`, `signed_out`, …).
    fn invoke(&self, call: Invocation) -> BoxFuture<'static, Result<Reply, String>>;
    /// Opens a warm session, or resumes a recorded one.
    fn open_session(&self, runtime: RuntimeChoice, resume: Option<&str>) -> Result<String, String>;
    fn close_session(&self, runtime: RuntimeChoice, session: &str);
}

/// The instructions every runtime gets with the packet. shortcut: one fixed text per skill; the
/// user-editable `skills/<type>/SKILL.md` files replace it when post-call (2.17) brings them.
pub(crate) fn instructions(skill: Skill) -> String {
    format!(
        "You run Noter's {} skill. The user message is a JSON packet whose `items` are the \
         evidence, each with an `id`. Answer only with JSON that matches the output schema, and \
         cite only ids from `items`. A `repair` field says why the previous answer failed.",
        skill.id()
    )
}
