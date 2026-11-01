// @cpt-dod:cpt-noter-dod-core-llm-gate-adapters:p1
//! Claude Code (`claude -p`), locked down (PRD › LLM orchestration): the empty Noter-owned
//! working directory, a strict per-run MCP config with no servers, a tool allow-list without
//! WebFetch, WebSearch or Bash, no setting sources and nonessential traffic off, so no hook,
//! plugin, `CLAUDE.md` or `.mcp.json` of the user's enters a run. API-key runs are `--bare` in a
//! Noter-owned home; own-account runs keep every other flag without `--bare` and run in the
//! user's home, where Claude Code keeps its sign-in. Structured output against the app schema.

use noter_protocol::RuntimeChoice;
use serde_json::Value;
use tokio::process::Command;

use super::cli::{self, Cli, CliConfig, RunDir};
use super::{instructions, Invocation, Reply, RuntimeAdapter};
use crate::runtime::{Availability, BoxFuture, Tested};

/// Tested with 2.1.296. Widen only after the network-monitor runbook
/// (`.plans/backend/m2-network-monitor-runbook.md`) passes on the new version.
const TESTED: Tested = Tested {
    min: [2, 1, 0],
    below: [2, 2, 0],
};
const NEVER: [&str; 3] = ["WebFetch", "WebSearch", "Bash"];

pub(crate) struct ClaudeCode(Cli);

impl ClaudeCode {
    pub fn new(config: CliConfig) -> Self {
        Self(Cli::new(config, TESTED))
    }

    fn prepare(&self, call: &Invocation) -> Result<(Command, RunDir), String> {
        let api_key = call.runtime == RuntimeChoice::ClaudeApiKey;
        let resume = self.0.resume(call.session.as_deref())?;
        let run = RunDir::create(&self.0)?;
        let mcp = run.write("mcp.json", br#"{"mcpServers":{}}"#)?;
        let skill = run.write("skill.md", instructions(call.skill).as_bytes())?;
        // M2 runs have no MCP server, so no `mcp__` tool is available to allow.
        let tools: Vec<&str> = call
            .tools
            .iter()
            .map(String::as_str)
            .filter(|t| !NEVER.contains(t) && !t.starts_with("mcp__"))
            .collect();
        let home = match api_key {
            true => self.0.dir("home")?,
            false => self.0.config.home.clone(),
        };
        let mut command = cli::command(&self.0, &self.0.dir("work")?, &run);
        command
            .env("HOME", home)
            .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1")
            .arg("-p");
        if api_key {
            let key = call.key.as_ref().ok_or("no_key")?;
            command.env("ANTHROPIC_API_KEY", key.expose()).arg("--bare");
        }
        command
            .args(["--output-format", "json"])
            .args(["--json-schema", &call.schema.to_string()])
            .arg("--append-system-prompt-file")
            .arg(&skill)
            .arg("--strict-mcp-config")
            .arg("--mcp-config")
            .arg(&mcp)
            .args(["--tools", &tools.join(",")])
            .args(["--setting-sources", ""])
            .args(["--permission-mode", "dontAsk"])
            .args(["--max-turns", "8"])
            .args(["--effort", cli::effort(call.effort)]);
        // An own account's plan limits apply instead of a per-request cap.
        if let Some(cap) = call.budget_usd.filter(|_| api_key) {
            command.args(["--max-budget-usd", &cap.to_string()]);
        }
        if !call.model.is_empty() {
            command.args(["--model", &call.model]);
        }
        if let Some(session) = resume {
            command.args(["--resume", &session]);
        }
        Ok((command, run))
    }
}

/// The `--output-format json` result.
fn parse(stdout: &[u8]) -> Result<Reply, String> {
    let result: Value = serde_json::from_slice(stdout).map_err(|_| "cli_output".to_owned())?;
    if result["is_error"].as_bool() != Some(false) {
        let subtype = result["subtype"].as_str().unwrap_or("cli_failed");
        return Err(subtype.to_owned());
    }
    Ok(Reply {
        output: result["structured_output"].clone(),
        tokens_in: result["usage"]["input_tokens"].as_u64().unwrap_or(0),
        tokens_out: result["usage"]["output_tokens"].as_u64().unwrap_or(0),
        cost_usd: result["total_cost_usd"].as_f64(),
        first_token_ms: None,
        session_id: result["session_id"].as_str().map(String::from),
    })
}

impl RuntimeAdapter for ClaudeCode {
    fn name(&self) -> &'static str {
        "claude-code"
    }

    fn availability(&self, runtime: RuntimeChoice) -> Availability {
        self.0
            .availability(runtime, runtime == RuntimeChoice::ClaudeApiKey)
    }

    fn refresh(&self) {
        self.0.refresh();
    }

    fn invoke(&self, call: Invocation) -> BoxFuture<'static, Result<Reply, String>> {
        self.0.run(&call, self.prepare(&call), parse)
    }

    fn open_session(&self, _: RuntimeChoice, resume: Option<&str>) -> Result<String, String> {
        Ok(self.0.open_session(resume))
    }

    fn close_session(&self, _: RuntimeChoice, session: &str) {
        self.0.close_session(session);
    }
}
