// @cpt-dod:cpt-noter-dod-core-llm-gate-adapters:p1
//! Codex (`codex exec`), locked down (PRD › LLM orchestration): an isolated Noter-owned
//! `CODEX_HOME` and home, `--ignore-user-config` and `--ignore-rules` on top, no `AGENTS.md`
//! (`project_doc_max_bytes=0`), a read-only sandbox in the empty working directory, the prompt on
//! stdin and the app schema through `--output-schema`. API-key runs get `CODEX_API_KEY`;
//! own-account runs reach the sign-in Codex keeps through a link to its `auth.json`, which Noter
//! never opens.

use noter_protocol::model::CliTool;
use noter_protocol::{Effort, RuntimeChoice};
use serde_json::{json, Value};
use tokio::process::Command;

use super::cli::{self, Cli, CliConfig, RunDir};
use super::{Invocation, Reply, RuntimeAdapter};
use crate::runtime::{Availability, BoxFuture, Tested};

/// Tested with 0.163.0; a 0.x minor may change flags, so 0.164.0 and later run with a warning and
/// fail closed if a lockdown flag is rejected (#1219). Move the range only after the network-monitor
/// runbook (`.plans/backend/m2-network-monitor-runbook.md`) passes on a new version.
pub(crate) const TESTED: Tested = Tested {
    min: [0, 163, 0],
    below: [0, 164, 0],
    version: "0.163.0",
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
        let schema = run.write("schema.json", strict(&call.schema).to_string().as_bytes())?;
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
            let key = call.key.as_ref().ok_or("no_key")?;
            command.env("CODEX_API_KEY", key.expose());
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
        // noter-mcp is the only server: its token reaches it through the environment (never the
        // command line, which any process of the user's could read).
        if let Some(m) = &call.mcp {
            let quoted = |s: &str| serde_json::Value::from(s).to_string();
            let tools: Vec<String> = m.tools.iter().map(|t| quoted(t)).collect();
            command
                .env("NOTER_MCP_TOKEN", m.token.expose())
                .args([
                    "-c",
                    &format!(
                        "mcp_servers.noter.command={}",
                        quoted(&m.binary.to_string_lossy())
                    ),
                ])
                .args([
                    "-c",
                    &format!(
                        "mcp_servers.noter.args=[{}]",
                        quoted(&m.config.to_string_lossy())
                    ),
                ])
                .args(["-c", "mcp_servers.noter.env_vars=[\"NOTER_MCP_TOKEN\"]"])
                .args([
                    "-c",
                    &format!("mcp_servers.noter.enabled_tools=[{}]", tools.join(",")),
                ]);
        }
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

/// The app schema in OpenAI's strict structured-output form, which Codex sends with
/// `--output-schema` and the API refuses otherwise (#1242): every object closed
/// (`additionalProperties: false`) and every property required, an optional one nullable. `format`
/// goes: strict mode knows only a few named formats, not `uint16` or `float`.
fn strict(schema: &Value) -> Value {
    let mut out = schema.clone();
    close(&mut out);
    out
}

fn close(node: &mut Value) {
    let Value::Object(map) = node else { return };
    map.remove("format");
    for key in ["$defs", "definitions", "properties"] {
        if let Some(Value::Object(children)) = map.get_mut(key) {
            children.values_mut().for_each(close);
        }
    }
    for key in ["items", "anyOf", "oneOf", "allOf"] {
        match map.get_mut(key) {
            Some(Value::Array(list)) => list.iter_mut().for_each(close),
            Some(child) => close(child),
            None => {}
        }
    }
    let required = map.get("required").cloned().unwrap_or(json!([]));
    let Some(Value::Object(props)) = map.get_mut("properties") else {
        return;
    };
    for (name, prop) in props.iter_mut() {
        let optional = !required
            .as_array()
            .is_some_and(|r| r.contains(&json!(name)));
        if optional && !nullable(prop) {
            *prop = json!({ "anyOf": [prop.take(), { "type": "null" }] });
        }
    }
    let all: Vec<Value> = props.keys().map(|k| json!(k)).collect();
    map.insert("required".into(), all.into());
    map.insert("additionalProperties".into(), false.into());
}

fn nullable(schema: &Value) -> bool {
    let null = json!("null");
    schema["type"] == null
        || schema["type"].as_array().is_some_and(|t| t.contains(&null))
        || schema["anyOf"]
            .as_array()
            .is_some_and(|b| b.iter().any(|b| b["type"] == null))
}

/// Back to the app schema's shape: an optional field that takes no `null` there, answered with
/// `null` under the strict schema, is absent again.
fn denull(value: &mut Value, schema: &Value, root: &Value) {
    let schema = match schema["$ref"].as_str().and_then(|r| r.strip_prefix('#')) {
        Some(pointer) => root.pointer(pointer).unwrap_or(&Value::Null),
        None => schema,
    };
    // shortcut: every anyOf branch is applied; fine while no two object branches share a key.
    for branch in schema["anyOf"].as_array().into_iter().flatten() {
        denull(value, branch, root);
    }
    match value {
        Value::Array(list) => list
            .iter_mut()
            .for_each(|v| denull(v, &schema["items"], root)),
        Value::Object(map) => {
            let required = schema["required"].as_array();
            // only the fields `close` made nullable; a null the app schema takes stays
            map.retain(|k, v| {
                let made_nullable = schema["properties"].get(k).is_some_and(|p| !nullable(p))
                    && !required.is_some_and(|r| r.contains(&json!(k)));
                !(made_nullable && v.is_null())
            });
            for (k, v) in map.iter_mut() {
                denull(v, &schema["properties"][k.as_str()], root);
            }
        }
        _ => {}
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
    let mut known = false;
    for line in stdout.split(|b| *b == b'\n') {
        let Ok(event) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        known |= matches!(
            event["type"].as_str(),
            Some("thread.started" | "turn.started" | "item.completed" | "turn.completed")
        );
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
    // None of `--json`'s events: the CLI ignored the flag, so nothing it did can be trusted (#1219).
    if !known {
        return Err("cli_incompatible".into());
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

    fn probe(&self) -> BoxFuture<'_, ()> {
        Box::pin(self.0.observe_sign_in(CliTool::Codex))
    }

    fn invoke(&self, call: Invocation) -> BoxFuture<'static, Result<Reply, String>> {
        let schema = call.schema.clone();
        let run = self.0.run(&call, self.prepare(&call), parse);
        Box::pin(async move {
            let mut reply = run.await?;
            denull(&mut reply.output, &schema, &schema);
            Ok(reply)
        })
    }

    fn open_session(&self, _: RuntimeChoice, resume: Option<&str>) -> Result<String, String> {
        Ok(self.0.open_session(resume))
    }

    fn close_session(&self, _: RuntimeChoice, session: &str) {
        self.0.close_session(session);
    }

    fn last_failure(&self) -> Option<String> {
        self.0.last_failure()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::Skill;

    /// What OpenAI strict mode demands of every schema node; the failures, empty when it passes.
    fn strict_faults(node: &Value, at: &str, faults: &mut Vec<String>) {
        match node {
            Value::Array(list) => list.iter().for_each(|n| strict_faults(n, at, faults)),
            Value::Object(map) => {
                let object = node["type"] == "object" || map.contains_key("properties");
                if object {
                    if node["additionalProperties"] != false {
                        faults.push(format!("{at}: additionalProperties is not false"));
                    }
                    let mut keys: Vec<&String> = map
                        .get("properties")
                        .and_then(Value::as_object)
                        .map(|p| p.keys().collect())
                        .unwrap_or_default();
                    let mut required: Vec<&str> = node["required"]
                        .as_array()
                        .map(|r| r.iter().filter_map(Value::as_str).collect())
                        .unwrap_or_default();
                    keys.sort();
                    required.sort();
                    if keys.iter().map(|k| k.as_str()).ne(required.iter().copied()) {
                        faults.push(format!("{at}: required is not every property"));
                    }
                }
                if map.get("format").is_some_and(Value::is_string) {
                    faults.push(format!("{at}: format"));
                }
                for (k, v) in map {
                    strict_faults(v, &format!("{at}/{k}"), faults);
                }
            }
            _ => {}
        }
    }

    // cpt-noter-seq-settings-sign-in-account: the ChatGPT account check (and every Codex run)
    // sends a schema the API takes.
    #[test]
    fn every_skill_schema_is_sent_in_strict_form() {
        for skill in Skill::ALL {
            let mut faults = Vec::new();
            strict_faults(&skill.schema(), "", &mut faults);
            assert!(
                !faults.is_empty(),
                "{}: the generated schema is already strict",
                skill.id()
            );
            faults.clear();
            strict_faults(&strict(&skill.schema()), "", &mut faults);
            assert!(faults.is_empty(), "{}: {faults:?}", skill.id());
        }
    }

    #[test]
    fn a_strict_answer_with_nulls_validates_against_the_app_schema() {
        let schema = Skill::CouncilTick.schema();
        let card = |lang: Value| {
            json!({
                "agent": "a", "kind": "ask", "title": "t", "source": "this_call",
                "evidence_segment_ids": [], "evidence_chunk_ids": [], "confidence": 0.9,
                "reason": "r", "lang": lang, "body": null, "jira_key": null,
            })
        };
        let mut answer = json!({ "cards": [card(json!("en")), card(json!({ "code": "fr" }))] });
        denull(&mut answer, &schema, &schema);
        // `body` and `jira_key` take null in the app schema too, so they stay as answered
        assert_eq!(answer["cards"][0]["body"], Value::Null);
        assert_eq!(answer["cards"][1]["jira_key"], Value::Null);
        assert_eq!(answer["cards"][1]["lang"], json!({ "code": "fr" }));
        Skill::CouncilTick.conforms(&answer).unwrap();
    }

    #[test]
    fn an_optional_field_that_never_takes_null_becomes_nullable_and_comes_back_absent() {
        let schema = json!({
            "type": "object",
            "properties": {
                "tags": { "type": "array", "items": { "type": "string" } },
                "n": { "type": "integer", "format": "uint16" },
            },
            "required": ["n"],
        });
        let sent = strict(&schema);
        assert_eq!(sent["required"], json!(["n", "tags"]));
        assert_eq!(
            sent["properties"]["tags"]["anyOf"][1],
            json!({ "type": "null" })
        );
        assert!(sent["properties"]["n"].get("format").is_none());
        let mut answer = json!({ "tags": null, "n": 1 });
        denull(&mut answer, &schema, &schema);
        assert_eq!(answer, json!({ "n": 1 }));
    }
}
