// @cpt-component:cpt-noter-component-core-privacy:p1
// @cpt-dod:cpt-noter-dod-core-llm-gate-policy:p1
//! The egress gate (`cpt-noter-algo-core-llm-gate-egress`). It holds the adapter registry: the
//! only way to an adapter is [`Gate::send`], and it only takes a packet [`Gate::release`]
//! approved, which for the cloud means after the `audit_log` row committed.

use std::sync::{Arc, OnceLock};

use noter_db::{Mutation, Store};
use noter_protocol::egress::PROVIDER_HOSTS;
use noter_protocol::{AuditId, CallId, LlmRunId, PrivacyMode, RuntimeChoice};
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

/// The adapters, one per runtime choice. Only the gate can reach them.
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

/// A packet the gate let through: the exact bytes, and for the cloud its audit row.
#[derive(Debug)]
pub(crate) struct Approved {
    runtime: RuntimeChoice,
    bytes: Vec<u8>,
    permitted: Vec<String>,
    /// Pseudonym → original name, run-local.
    names: Vec<(String, String)>,
    audit_id: Option<AuditId>,
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
        match output {
            Value::String(s) => {
                for (pseudonym, name) in &self.names {
                    *s = s.replace(pseudonym.as_str(), name);
                }
            }
            Value::Array(items) => items.iter_mut().for_each(|v| self.map_back(v)),
            Value::Object(map) => map.values_mut().for_each(|v| self.map_back(v)),
            _ => {}
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
                bytes: payload(r, &items),
                permitted: items.iter().map(|(id, _)| (*id).to_owned()).collect(),
                names: Vec::new(),
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
        // @cpt-end:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-redact
        // @cpt-begin:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-pseudonyms
        let mut names = Vec::new();
        if r.pseudonyms {
            let people = packet.people.iter().filter(|n| !n.trim().is_empty());
            for (n, name) in people.enumerate() {
                let pseudonym = format!("Person {}", n + 1);
                let whole = Regex::new(&format!(r"\b{}\b", regex::escape(name)))
                    .expect("an escaped name is a valid pattern");
                for (_, text) in items.iter_mut() {
                    *text = whole.replace_all(text, pseudonym.as_str()).into_owned();
                }
                names.push((pseudonym, name.clone()));
            }
            // "Person 10" before "Person 1" when mapping back.
            names.sort_by_key(|(p, _)| std::cmp::Reverse(p.len()));
        }
        // @cpt-end:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-pseudonyms
        let bytes = payload(r, &items);
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
        // M3's noter-mcp tool results (`tool_result`) and lookups (`lookup`) take this same path.
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
            audit_id: Some(audit_id),
        })
        // @cpt-end:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-return
    }

    /// Hands an approved packet, byte for byte, to its runtime's adapter.
    pub(crate) fn send(
        &self,
        approved: &Approved,
        choice: &Choice,
        skill: Skill,
        session: Option<&str>,
        budget_usd: Option<f64>,
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
            budget_usd,
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
fn payload(r: &Release, items: &[(&str, String)]) -> Vec<u8> {
    let items: Vec<Value> = items
        .iter()
        .map(|(id, text)| json!({"id": id, "text": text}))
        .collect();
    let mut packet = json!({"skill": r.skill.id(), "items": items});
    if let Some(repair) = r.repair {
        packet["repair"] = json!(repair);
    }
    serde_json::to_vec(&packet).expect("a JSON value serializes")
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
#[derive(Default)]
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
