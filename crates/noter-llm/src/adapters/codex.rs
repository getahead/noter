// @cpt-dod:cpt-noter-dod-core-llm-gate-adapters:p1
//! Codex (`codex exec`), locked down (PRD › LLM orchestration): an isolated Noter-owned
//! `CODEX_HOME` and home, `--ignore-user-config` and `--ignore-rules` on top, no `AGENTS.md`
//! (`project_doc_max_bytes=0`), a read-only sandbox in the empty working directory, the prompt on
//! stdin and the app schema through `--output-schema`. API-key runs get `CODEX_API_KEY`;
//! own-account runs reach the sign-in Codex keeps through a link to its `auth.json`, which Noter
//! never opens.

use noter_protocol::{Effort, RuntimeChoice};
use serde_json::Value;
use tokio::process::Command;

use super::cli::{self, Cli, CliConfig, RunDir};
use super::{Invocation, Reply, RuntimeAdapter};
use crate::runtime::{Availability, BoxFuture, Tested};

/// Tested with 0.163.0; a 0.x minor may change flags. Widen only after the network-monitor
/// runbook (`.plans/backend/m2-network-monitor-runbook.md`) passes on the new version.
const TESTED: Tested = Tested {
    min: [0, 163, 0],
    below: [0, 164, 0],
};

pub(crate) struct Codex(Cli);

impl Codex {
    pub fn new(config: CliConfig) -> Self {
        Self(Cli::new(config, TESTED))
    }

    fn prepare(&self, call: &Invocation) -> Result<(Command, RunDir), String> {
        let api_key = call.runtime == RuntimeChoice::CodexApiKey;
        let resume = self.0.resume(call.session.as_deref())?;
        let run = RunDir::create(&self.0)?;
        let schema = run.write("schema.json", call.schema.to_string().as_bytes())?;
        let work = self.0.dir("work")?;
        let codex_home = self.0.dir(if api_key {
            "codex-api"
        } else {
            "codex-account"
        })?;
        let mut command = cli::command(&self.0, &work, &run);
        command
            .env("HOME", self.0.dir("home")?)
            .env("CODEX_HOME", &codex_home);
        if api_key {
            let key = self.0.config.api_key.as_deref().ok_or("no_key")?;
            command.env("CODEX_API_KEY", key);
        } else {
            // shortcut: the sign-in at `~/.codex`; a user who moved CODEX_HOME signs in again.
            let link = codex_home.join("auth.json");
            if link.symlink_metadata().is_err() {
                let auth = self.0.config.home.join(".codex/auth.json");
                std::os::unix::fs::symlink(auth, link).map_err(|_| "run_dir".to_owned())?;
            }
        }
        let effort = match call.effort {
            Effort::Max => "xhigh",
            other => cli::effort(other),
        };
        command
            .args(["exec", "--json", "--skip-git-repo-check"])
            .args(["--ignore-user-config", "--ignore-rules"])
            .args(["--sandbox", "read-only"])
            .arg("--output-schema")
            .arg(&schema)
            .arg("-C")
            .arg(&work)
            .args(["-c", "project_doc_max_bytes=0"])
            .args(["-c", &format!("model_reasoning_effort=\"{effort}\"")]);
        if !call.model.is_empty() {
            command.args(["-m", &call.model]);
        }
        if let Some(thread) = resume {
            command.args(["resume", &thread]);
        }
        command.arg("-");
        Ok((command, run))
    }
}

/// The `--json` event stream: the thread id, the final agent message (the schema's JSON) and
/// the turn's usage.
fn parse(stdout: &[u8]) -> Result<Reply, String> {
    let mut reply = Reply {
        output: Value::Null,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: None,
        first_token_ms: None,
        session_id: None,
    };
    for line in stdout.split(|b| *b == b'\n') {
        let Ok(event) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        match event["type"].as_str() {
            Some("thread.started") => {
                reply.session_id = event["thread_id"].as_str().map(String::from);
            }
            Some("item.completed") if event["item"]["type"] == "agent_message" => {
                let text = event["item"]["text"].as_str().unwrap_or_default();
                reply.output = serde_json::from_str(text).unwrap_or(Value::Null);
            }
            Some("turn.completed") => {
                reply.tokens_in += event["usage"]["input_tokens"].as_u64().unwrap_or(0);
                reply.tokens_out += event["usage"]["output_tokens"].as_u64().unwrap_or(0);
            }
            Some("turn.failed" | "error") => return Err("cli_failed".into()),
            _ => {}
        }
    }
    Ok(reply)
}

impl RuntimeAdapter for Codex {
    fn name(&self) -> &'static str {
        "codex"
    }

    fn availability(&self, runtime: RuntimeChoice) -> Availability {
        self.0
            .availability(runtime, runtime == RuntimeChoice::CodexApiKey)
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
