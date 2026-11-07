// @cpt-flow:cpt-noter-flow-core-mcp-start:p1
//! noter-mcp under a run (`cpt-noter-feature-core-mcp`): the host that starts and revokes a
//! run's tool server, the launch the CLI adapters put in their lockdown config, and the
//! run's redaction state that every tool result passes through before it is released.

use std::path::PathBuf;

use noter_protocol::{CallId, LlmRunId};

use crate::secrets::Secret;

/// A run that may use noter-mcp tools, as the router tells the host before the CLI starts.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolStart {
    pub llm_run_id: LlmRunId,
    pub call_id: Option<CallId>,
    /// The run is on a cloud runtime: its tool results are gated, redacted and audited.
    pub cloud: bool,
    pub tools: Vec<String>,
}

/// What the host made for the run: the per-run token and the 0600 config noter-mcp reads.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolLaunch {
    pub token: String,
    pub config: PathBuf,
}

/// The core's side of a run's tool server: registers the run (token, socket, config) and
/// revokes it. The router calls `stop` on every outcome (done, failed, cancelled, timed out).
pub trait ToolHost: Send + Sync {
    fn start(&self, run: ToolStart) -> Result<ToolLaunch, String>;
    fn stop(&self, run: &LlmRunId);
}

/// What a CLI adapter needs to start `noter-mcp` as the run's only MCP server.
#[derive(Debug, Clone, PartialEq)]
pub struct McpLaunch {
    pub binary: PathBuf,
    pub config: PathBuf,
    /// Passed as `NOTER_MCP_TOKEN`; never printed.
    pub token: Secret,
    pub tools: Vec<String>,
}
