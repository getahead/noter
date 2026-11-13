// @cpt-component:cpt-noter-component-core-privacy:p1
// @cpt-dod:cpt-noter-dod-core-llm-gate-policy:p1
//! The egress gate (`cpt-noter-algo-core-llm-gate-egress`). It holds the adapter registry: the
//! only way to an adapter is [`Gate::send`], and it only takes a packet [`Gate::release`]
//! approved, which for the cloud means after the `audit_log` row committed.

use std::sync::{Arc, OnceLock};

use noter_db::{ChangeMeta, Mutation, Store};
use noter_protocol::egress::PROVIDER_HOSTS;
use noter_protocol::model::settings::AuditWhat;
use noter_protocol::{
    AuditId, CallId, CoreError, LlmRunId, PrivacyMode, RuntimeChoice, TimestampMs,
};
use regex::Regex;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::adapters::claude_code::ClaudeCode;
use crate::adapters::cli::CliConfig;
use crate::adapters::codex::Codex;
use crate::adapters::ollama::{Ollama, OllamaConfig};
use crate::adapters::scripted::Scripted;
use crate::adapters::{Invocation, Reply, RuntimeAdapter};
use crate::route::{forced_local, is_cloud, unavailable, Choice};
use crate::runtime::{
    hex, model_meta, runtime_name, Availability, BoxFuture, Failure, Now, Packet, Privacy, Skill,
    SourceClass,
};
use crate::secrets::Secret;
use crate::tools::McpLaunch;

/// A request to one of the user's own MCP servers (`user_configured` hosts): its `lookup` audit
/// row commits before the request may leave, and `Err` means it must not. The row holds the
/// request's size and hash, never its bytes.
// shortcut: `what` is `live_mcp_query`, the frozen contract's only MCP-server value, for indexed
// sync requests too; a value of their own is a contract change.
pub fn audit_lookup(
    store: &Store,
    meta: ChangeMeta,
    at: TimestampMs,
    destination: &str,
    request: &[u8],
    run: Option<(&LlmRunId, Option<&CallId>)>,
) -> Result<AuditId, CoreError> {
    let id = AuditId::new(format!("aud_{}", ulid::Ulid::generate()));
    let row = Mutation {
        entity_type: "audit",
        table: "audit_log",
        id: id.as_str().into(),
        base_rev: None,
        bump_rev: false,
        values: vec![
            ("ts", json!(at.0)),
            ("kind", json!("lookup")),
            ("what", json!("live_mcp_query")),
            ("destination", json!(destination)),
            ("bytes_out", json!(request.len())),
            ("payload_hash", json!(hex(&Sha256::digest(request)))),
        ]
        .into_iter()
        .chain(run.into_iter().flat_map(|(run, call)| {
            [
                ("llm_run_id", json!(run.as_str())),
                ("call_id", json!(call.map(CallId::as_str))),
            ]
        }))
        .collect(),
    };
    store.write(row, meta)?;
    Ok(id)
}

/// The adapters, one per runtime choice. Only the gate can reach them.
#[derive(Clone)]
pub struct Adapters {
    registry: Vec<(RuntimeChoice, Arc<dyn RuntimeAdapter>)>,
}

impl Adapters {
    /// Every runtime choice answered by the scripted runtime (tests, noter-core-harness).
    pub fn scripted(scripted: &Scripted) -> Self {
        let adapter: Arc<dyn RuntimeAdapter> = Arc::new(scripted.clone());
        let registry = scripted
            .availability_all()
            .into_iter()
            .map(|a| (a.runtime, adapter.clone()))
            .collect();
        Self { registry }
    }

    /// No runtime at all: every choice is unavailable (a core whose host set none).
    pub fn none() -> Self {
        Self {
            registry: Vec::new(),
        }
    }

    /// The real runtimes: Claude Code and Codex locked down, Ollama on this Mac.
    pub fn real(claude: CliConfig, codex: CliConfig, ollama: OllamaConfig) -> Self {
        let claude: Arc<dyn RuntimeAdapter> = Arc::new(ClaudeCode::new(claude));
        let codex: Arc<dyn RuntimeAdapter> = Arc::new(Codex::new(codex));
        let registry = vec![
            (RuntimeChoice::ClaudeApiKey, claude.clone()),
            (RuntimeChoice::ClaudeAccount, claude),
            (RuntimeChoice::CodexApiKey, codex.clone()),
            (RuntimeChoice::ChatgptAccount, codex),
            (RuntimeChoice::Local, Arc::new(Ollama::new(ollama)) as _),
        ];
        Self { registry }
    }
}

pub(crate) struct Gate {
    adapters: Adapters,
    store: Arc<Store>,
    now: Now,
}

/// The run a packet is released for.
pub(crate) struct Release<'a> {
    pub llm_run_id: &'a LlmRunId,
    pub call_id: Option<&'a CallId>,
    /// Names the run's placeholders in the audit row; the map itself never leaves the run.
    pub map_id: &'a str,
    pub pseudonyms: bool,
    pub skill: Skill,
    /// The validation failure a repair attempt explains to the model.
    pub repair: Option<&'a str>,
}

/// What a call carries besides its packet: the spend left, the API key, the tool server.
pub(crate) struct SendExtras {
    pub budget_usd: Option<f64>,
    pub key: Option<Secret>,
    pub mcp: Option<McpLaunch>,
}

/// The run a tool result is released for.
pub(crate) struct ToolRelease<'a> {
    pub llm_run_id: &'a LlmRunId,
    pub call_id: Option<&'a CallId>,
    pub runtime: RuntimeChoice,
}

/// A packet the gate let through: the exact bytes, and for the cloud its audit row.
#[derive(Debug)]
pub(crate) struct Approved {
    runtime: RuntimeChoice,
    bytes: Vec<u8>,
    permitted: Vec<String>,
    /// Pseudonym → original name, run-local.
    names: Vec<(String, String)>,
    placeholders: Placeholders,
    audit_id: Option<AuditId>,
}

/// A run's redaction state after its initial packet: the placeholders and pseudonyms every
/// tool result of the run reuses, so a name or an address never changes identity mid-run.
#[derive(Debug, Clone)]
pub(crate) struct RunMap {
    pub(crate) map_id: String,
    pseudonyms: bool,
    /// Pseudonym → original name, longest pseudonym first (for mapping back).
    names: Vec<(String, String)>,
    placeholders: Placeholders,
}

impl RunMap {
    /// Restores pseudonymized names in text that is already inside the core.
    pub(crate) fn map_back(&self, output: &mut Value) {
        map_names(&self.names, output);
    }

    /// The pseudonym of `name`, a new one when the run has not met it.
    fn pseudonym(&mut self, name: &str) -> String {
        if let Some((p, _)) = self.names.iter().find(|(_, n)| n == name) {
            return p.clone();
        }
        let pseudonym = format!("Person {}", self.names.len() + 1);
        self.names.push((pseudonym.clone(), name.to_owned()));
        pseudonym
    }
}

fn map_names(names: &[(String, String)], output: &mut Value) {
    match output {
        Value::String(s) => {
            // "Person 10" before "Person 1".
            let mut ordered: Vec<&(String, String)> = names.iter().collect();
            ordered.sort_by_key(|(p, _)| std::cmp::Reverse(p.len()));
            for (pseudonym, name) in ordered {
                *s = s.replace(pseudonym.as_str(), name);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|v| map_names(names, v)),
        Value::Object(map) => map.values_mut().for_each(|v| map_names(names, v)),
        _ => {}
    }
}

/// Applies `f` to every string value (never a key) of `value`.
fn each_string(value: &mut Value, f: &mut impl FnMut(&mut String)) {
    match value {
        Value::String(s) => f(s),
        Value::Array(items) => items.iter_mut().for_each(|v| each_string(v, f)),
        Value::Object(map) => map.values_mut().for_each(|v| each_string(v, f)),
        _ => {}
    }
}

impl Approved {
    pub(crate) fn audit_id(&self) -> Option<&AuditId> {
        self.audit_id.as_ref()
    }

    /// The ids the released packet holds: what outputs may cite.
    pub(crate) fn permitted(&self) -> &[String] {
        &self.permitted
    }

    #[cfg(test)]
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Restores pseudonymized names in an output that is already inside the core.
    pub(crate) fn map_back(&self, output: &mut Value) {
        map_names(&self.names, output);
    }

    /// The run's redaction state, for the results of the tools the run may use.
    pub(crate) fn run_map(&self, map_id: &str, pseudonyms: bool) -> RunMap {
        RunMap {
            map_id: map_id.to_owned(),
            pseudonyms,
            names: self.names.clone(),
            placeholders: self.placeholders.clone(),
        }
    }
}

impl Gate {
    pub(crate) fn new(adapters: Adapters, store: Arc<Store>, now: Now) -> Self {
        Self {
            adapters,
            store,
            now,
        }
    }

    fn adapter(&self, runtime: RuntimeChoice) -> Option<&dyn RuntimeAdapter> {
        let found = self.adapters.registry.iter().find(|(r, _)| *r == runtime);
        found.map(|(_, a)| a.as_ref())
    }

    pub(crate) fn availability(&self) -> Vec<Availability> {
        let registry = &self.adapters.registry;
        registry.iter().map(|(r, a)| a.availability(*r)).collect()
    }

    /// Each adapter once (one serves several runtime choices).
    pub(crate) fn adapters(&self) -> Vec<Arc<dyn RuntimeAdapter>> {
        let mut all: Vec<Arc<dyn RuntimeAdapter>> = Vec::new();
        for (_, a) in &self.adapters.registry {
            if !all.iter().any(|b| Arc::ptr_eq(a, b)) {
                all.push(a.clone());
            }
        }
        all
    }

    pub(crate) fn adapter_name(&self, runtime: RuntimeChoice) -> &'static str {
        self.adapter(runtime).map_or("none", |a| a.name())
    }

    // @cpt-algo:cpt-noter-algo-core-llm-gate-egress:p1
    pub(crate) fn release(
        &self,
        r: &Release,
        packet: &Packet,
        runtime: RuntimeChoice,
        privacy: Privacy,
    ) -> Result<Approved, Failure> {
        // @cpt-begin:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-recheck
        if let Some(reason) = forced_local(privacy).filter(|_| is_cloud(runtime)) {
            return Err(Failure::Unavailable(unavailable(runtime, reason)));
        }
        // @cpt-end:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-recheck
        // @cpt-begin:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-local
        if !is_cloud(runtime) {
            let items: Vec<(&str, String)> = packet
                .items
                .iter()
                .map(|i| (i.id.as_str(), i.text.clone()))
                .collect();
            return Ok(Approved {
                runtime,
                bytes: payload(r, &items, context(packet, &packet.context.glossary)),
                permitted: items.iter().map(|(id, _)| (*id).to_owned()).collect(),
                names: Vec::new(),
                placeholders: Placeholders::default(),
                audit_id: None,
            });
        }
        // @cpt-end:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-local
        // @cpt-begin:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-redact
        let redact = privacy.mode == PrivacyMode::CloudRedacted;
        let mut placeholders = Placeholders::default();
        let mut items: Vec<(&str, String)> = packet
            .items
            .iter()
            .filter(|i| i.source == SourceClass::Normal)
            .map(|i| {
                let text = if redact {
                    placeholders.redact(&i.text)
                } else {
                    i.text.clone()
                };
                (i.id.as_str(), text)
            })
            .collect();
        let mut glossary: Vec<String> = packet
            .context
            .glossary
            .iter()
            .map(|t| {
                if redact {
                    placeholders.redact(t)
                } else {
                    t.clone()
                }
            })
            .collect();
        // @cpt-end:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-redact
        // @cpt-begin:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-pseudonyms
        let mut names = Vec::new();
        if r.pseudonyms {
            let mut people: Vec<_> = packet
                .people
                .iter()
                .filter(|n| !n.trim().is_empty())
                .enumerate()
                .collect();
            // Replace full names before their prefixes, keeping the original numbering.
            people.sort_by_key(|(_, name)| std::cmp::Reverse(name.len()));
            for (n, name) in people {
                let pseudonym = format!("Person {}", n + 1);
                let whole = name_pattern(name);
                let texts = items.iter_mut().map(|(_, t)| t).chain(glossary.iter_mut());
                for text in texts {
                    *text = whole.replace_all(text, pseudonym.as_str()).into_owned();
                }
                names.push((pseudonym, name.clone()));
            }
            // "Person 10" before "Person 1" when mapping back.
            names.sort_by_key(|(p, _)| std::cmp::Reverse(p.len()));
        }
        // @cpt-end:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-pseudonyms
        let bytes = payload(r, &items, context(packet, &glossary));
        let redaction_map_id = (redact || !names.is_empty()).then_some(r.map_id);
        // @cpt-begin:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-audit
        let audit_id = AuditId::new(format!("aud_{}", ulid::Ulid::generate()));
        let destination = PROVIDER_HOSTS
            .iter()
            .find(|(name, _)| *name == runtime_name(runtime))
            .and_then(|(_, hosts)| hosts.first())
            .copied()
            .unwrap_or_default();
        let what = serde_json::to_value(packet.what).unwrap_or_default();
        // @cpt-begin:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-future-tools
        // noter-mcp's tool results take `release_result` and its lookups the same audit path.
        let kind = "run";
        // @cpt-end:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-future-tools
        let row = Mutation {
            entity_type: "audit",
            table: "audit_log",
            id: audit_id.as_str().into(),
            base_rev: None,
            bump_rev: false,
            values: vec![
                ("ts", json!((self.now)().0)),
                ("kind", json!(kind)),
                ("what", what),
                ("destination", json!(destination)),
                ("runtime_choice", json!(runtime_name(runtime))),
                ("call_id", json!(r.call_id.map(CallId::as_str))),
                ("llm_run_id", json!(r.llm_run_id.as_str())),
                ("bytes_out", json!(bytes.len())),
                ("payload_hash", json!(hex(&Sha256::digest(&bytes)))),
                ("redaction_map_id", json!(redaction_map_id)),
            ],
        };
        let summary = format!("Packet released to {destination}");
        let committed = self
            .store
            .write(row, model_meta(r.llm_run_id, runtime, "", &summary));
        // @cpt-end:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-audit
        // @cpt-begin:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-no-audit
        if let Err(e) = committed {
            return Err(Failure::Storage(e));
        }
        // @cpt-end:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-no-audit
        // @cpt-begin:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-return
        Ok(Approved {
            runtime,
            permitted: items.iter().map(|(id, _)| (*id).to_owned()).collect(),
            bytes,
            names,
            placeholders,
            audit_id: Some(audit_id),
        })
        // @cpt-end:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-return
    }

    /// One noter-mcp tool result of a run (`cpt-noter-algo-core-mcp-release-result`): a local run's
    /// result passes; a cloud run's is redacted with the run's own map (the pseudonyms of the
    /// initial packet, `people` added as new ones) and its `tool_result` audit row commits
    /// before the body is returned. Any failure returns no body.
    // @cpt-algo:cpt-noter-algo-core-mcp-release-result:p1
    pub(crate) fn release_result(
        &self,
        run: &ToolRelease,
        map: &mut RunMap,
        privacy: Privacy,
        people: &[String],
        mut result: Value,
    ) -> Result<Value, Failure> {
        // @cpt-begin:cpt-noter-algo-core-mcp-release-result:p1:inst-release-recheck
        if !is_cloud(run.runtime) {
            return Ok(result);
        }
        if let Some(reason) = forced_local(privacy) {
            return Err(Failure::Unavailable(unavailable(run.runtime, reason)));
        }
        // @cpt-end:cpt-noter-algo-core-mcp-release-result:p1:inst-release-recheck
        // @cpt-begin:cpt-noter-algo-core-mcp-release-result:p1:inst-release-redact
        let redact = privacy.mode == PrivacyMode::CloudRedacted;
        if redact {
            each_string(&mut result, &mut |t| *t = map.placeholders.redact(t));
        }
        if map.pseudonyms {
            // Longest name first, so "Ann Lee" goes before "Ann".
            let mut named: Vec<(String, &String)> = people
                .iter()
                .filter(|n| !n.trim().is_empty())
                .map(|n| (map.pseudonym(n), n))
                .collect();
            named.sort_by_key(|(_, n)| std::cmp::Reverse(n.len()));
            for (pseudonym, name) in named {
                let whole = name_pattern(name);
                each_string(&mut result, &mut |t| {
                    *t = whole.replace_all(t, pseudonym.as_str()).into_owned();
                });
            }
        }
        // @cpt-end:cpt-noter-algo-core-mcp-release-result:p1:inst-release-redact
        // @cpt-begin:cpt-noter-algo-core-mcp-release-result:p1:inst-release-audit
        let bytes = serde_json::to_vec(&result).expect("a JSON value serializes");
        let destination = PROVIDER_HOSTS
            .iter()
            .find(|(name, _)| *name == runtime_name(run.runtime))
            .and_then(|(_, hosts)| hosts.first())
            .copied()
            .unwrap_or_default();
        let audit_id = AuditId::new(format!("aud_{}", ulid::Ulid::generate()));
        let in_map = redact || !map.names.is_empty();
        let row = Mutation {
            entity_type: "audit",
            table: "audit_log",
            id: audit_id.as_str().into(),
            base_rev: None,
            bump_rev: false,
            values: vec![
                ("ts", json!((self.now)().0)),
                ("kind", json!("tool_result")),
                ("what", json!(AuditWhat::EvidenceLookup)),
                ("destination", json!(destination)),
                ("runtime_choice", json!(runtime_name(run.runtime))),
                ("call_id", json!(run.call_id.map(CallId::as_str))),
                ("llm_run_id", json!(run.llm_run_id.as_str())),
                ("bytes_out", json!(bytes.len())),
                ("payload_hash", json!(hex(&Sha256::digest(&bytes)))),
                (
                    "redaction_map_id",
                    json!(in_map.then_some(map.map_id.as_str())),
                ),
            ],
        };
        let summary = format!("Tool result released to {destination}");
        // @cpt-end:cpt-noter-algo-core-mcp-release-result:p1:inst-release-audit
        // @cpt-begin:cpt-noter-algo-core-mcp-release-result:p1:inst-release-failed
        self.store
            .write(row, model_meta(run.llm_run_id, run.runtime, "", &summary))
            .map_err(Failure::Storage)?;
        // @cpt-end:cpt-noter-algo-core-mcp-release-result:p1:inst-release-failed
        Ok(result)
    }

    /// Hands an approved packet, byte for byte, to its runtime's adapter.
    pub(crate) fn send(
        &self,
        approved: &Approved,
        choice: &Choice,
        skill: Skill,
        session: Option<&str>,
        extras: SendExtras,
    ) -> BoxFuture<'static, Result<Reply, String>> {
        // @cpt-begin:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-release
        let Some(adapter) = self.adapter(approved.runtime) else {
            return Box::pin(async { Err("adapter_missing".to_owned()) });
        };
        adapter.invoke(Invocation {
            runtime: approved.runtime,
            skill,
            schema: skill.schema(),
            model: choice.model.clone(),
            effort: choice.effort,
            tools: choice.tools.clone(),
            packet: approved.bytes.clone(),
            session: session.map(String::from),
            budget_usd: extras.budget_usd,
            key: extras.key,
            mcp: extras.mcp,
        })
        // @cpt-end:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-release
    }

    /// Opens (or resumes) a session's isolated environment; no packet crosses here.
    pub(crate) fn open_session(
        &self,
        runtime: RuntimeChoice,
        resume: Option<&str>,
    ) -> Result<String, String> {
        let adapter = self.adapter(runtime).ok_or("adapter_missing")?;
        adapter.open_session(runtime, resume)
    }

    /// Reads the runtime's CLI version again.
    pub(crate) fn refresh(&self, runtime: RuntimeChoice) {
        if let Some(adapter) = self.adapter(runtime) {
            adapter.refresh();
        }
    }

    pub(crate) fn close_session(&self, runtime: RuntimeChoice, session: &str) {
        if let Some(adapter) = self.adapter(runtime) {
            adapter.close_session(runtime, session);
        }
    }
}

/// The released bytes: the skill, the items and, on a repair, the failure explained.
/// The packet's context as it leaves, with the glossary as the gate rewrote it; `None` when empty.
fn context(packet: &Packet, glossary: &[String]) -> Option<Value> {
    (!packet.context.is_empty()).then(|| {
        json!({
            "call_type": packet.context.call_type,
            "language": packet.context.language,
            "glossary": glossary,
        })
    })
}

fn payload(r: &Release, items: &[(&str, String)], context: Option<Value>) -> Vec<u8> {
    let items: Vec<Value> = items
        .iter()
        .map(|(id, text)| json!({"id": id, "text": text}))
        .collect();
    let mut packet = json!({"skill": r.skill.id(), "items": items});
    if let Some(context) = context {
        packet["context"] = context;
    }
    if let Some(repair) = r.repair {
        packet["repair"] = json!(repair);
    }
    serde_json::to_vec(&packet).expect("a JSON value serializes")
}

/// Punctuation at a name's edge has no word boundary against surrounding whitespace.
fn name_pattern(name: &str) -> Regex {
    static EDGES: OnceLock<(Regex, Regex)> = OnceLock::new();
    let (start, end) = EDGES.get_or_init(|| {
        (
            Regex::new(r"^\w").expect("a valid pattern"),
            Regex::new(r"\w$").expect("a valid pattern"),
        )
    });
    Regex::new(&format!(
        "{}{}{}",
        if start.is_match(name) { r"\b" } else { "" },
        regex::escape(name),
        if end.is_match(name) { r"\b" } else { "" },
    ))
    .expect("an escaped name is a valid pattern")
}

/// Regex redaction (TL-19): credentials first, then e-mail addresses, then phone numbers.
fn patterns() -> &'static [(Regex, &'static str)] {
    static PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        [
            (
                r"\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})",
                "SECRET",
            ),
            (r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "EMAIL"),
            (
                r"\+\d[\d ().-]{7,}\d|\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b",
                "PHONE",
            ),
        ]
        .into_iter()
        .map(|(p, label)| (Regex::new(p).expect("a valid pattern"), label))
        .collect()
    })
}

/// The run's placeholders: the same original always gets the same placeholder.
#[derive(Debug, Default, Clone)]
struct Placeholders {
    seen: Vec<(String, String)>,
}

impl Placeholders {
    fn redact(&mut self, text: &str) -> String {
        let mut out = text.to_owned();
        for (pattern, label) in patterns() {
            out = pattern
                .replace_all(&out, |m: &regex::Captures| self.placeholder(&m[0], label))
                .into_owned();
        }
        out
    }

    fn placeholder(&mut self, original: &str, label: &str) -> String {
        if let Some((_, p)) = self.seen.iter().find(|(o, _)| o == original) {
            return p.clone();
        }
        let prefix = format!("[{label}_");
        let n = self
            .seen
            .iter()
            .filter(|(_, p)| p.starts_with(&prefix))
            .count();
        let placeholder = format!("{prefix}{}]", n + 1);
        self.seen.push((original.to_owned(), placeholder.clone()));
        placeholder
    }
}
