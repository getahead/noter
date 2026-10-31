//! The scripted runtime (TL-13): answers from a JSON Lines script, like the engine script.
//! A line is `{"on": "<skill id>", "output": {...}}` or `{"on": ..., "fail": "<code>"}`, with
//! optional `after_ms` (answer delay) and `cost_usd`; each line answers once, in order. A skill
//! with no line left answers a built-in output that passes schema and citation validation.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_protocol::skills::{
    AnswerCitation, AskAnswerOutput, CouncilTickOutput, ExtractedItem, HandoffPromptOutput,
    Judgement, PostCallOutput, ReconcileJudgementOutput, RoleReviewOutput,
};
use noter_protocol::{Effort, Lang, RuntimeChoice, SegmentId};
use serde::Deserialize;
use serde_json::Value;

use super::{Invocation, Reply, RuntimeAdapter};
use crate::runtime::{lock, Availability, BoxFuture, Skill};

const RUNTIMES: [RuntimeChoice; 5] = [
    RuntimeChoice::ClaudeApiKey,
    RuntimeChoice::ClaudeAccount,
    RuntimeChoice::CodexApiKey,
    RuntimeChoice::ChatgptAccount,
    RuntimeChoice::Local,
];

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Line {
    on: String,
    output: Option<Value>,
    fail: Option<String>,
    after_ms: Option<u64>,
    cost_usd: Option<f64>,
}

/// One packet the scripted runtime received, as the gate released it.
#[derive(Debug, Clone, PartialEq)]
pub struct Received {
    pub runtime: RuntimeChoice,
    pub skill: String,
    pub bytes: Vec<u8>,
    pub session: Option<String>,
    /// The app-owned output schema, model, effort and tools the call was started with.
    pub schema: Value,
    pub model: String,
    pub effort: Effort,
    pub tools: Vec<String>,
}

#[derive(Default)]
struct State {
    lines: Vec<Option<Line>>,
    received: Vec<Received>,
    opened: u32,
    closed: Vec<String>,
}

/// Every runtime choice, available, answered from the script. Cloning shares it.
#[derive(Clone, Default)]
pub struct Scripted(Arc<Mutex<State>>);

impl Scripted {
    /// No script: every skill answers its built-in output.
    pub fn new() -> Self {
        Self::default()
    }

    pub fn parse(script: &str) -> Result<Self, String> {
        let mut lines = Vec::new();
        for (n, text) in script.lines().enumerate() {
            if text.trim().is_empty() {
                continue;
            }
            let line: Line =
                serde_json::from_str(text).map_err(|e| format!("line {}: {e}", n + 1))?;
            if Skill::from_id(&line.on).is_none() {
                return Err(format!("line {}: unknown skill {:?}", n + 1, line.on));
            }
            if line.output.is_some() && line.fail.is_some() {
                return Err(format!("line {}: both output and fail", n + 1));
            }
            lines.push(Some(line));
        }
        let state = State {
            lines,
            ..State::default()
        };
        Ok(Self(Arc::new(Mutex::new(state))))
    }

    /// Every packet received so far.
    pub fn received(&self) -> Vec<Received> {
        lock(&self.0).received.clone()
    }

    /// Every session closed so far, in order.
    pub fn closed_sessions(&self) -> Vec<String> {
        lock(&self.0).closed.clone()
    }

    pub(crate) fn availability_all(&self) -> Vec<Availability> {
        RUNTIMES.iter().map(|r| self.availability(*r)).collect()
    }
}

impl RuntimeAdapter for Scripted {
    fn name(&self) -> &'static str {
        "scripted"
    }

    fn availability(&self, runtime: RuntimeChoice) -> Availability {
        let cli = runtime != RuntimeChoice::Local;
        Availability {
            runtime,
            unavailable: None,
            version: cli.then(|| "1.0.0".to_owned()),
            tested_majors: vec![1],
            models: vec!["scripted".into()],
        }
    }

    fn invoke(&self, call: Invocation) -> BoxFuture<'static, Result<Reply, String>> {
        let line = {
            let mut state = lock(&self.0);
            state.received.push(Received {
                runtime: call.runtime,
                skill: call.skill.id().into(),
                bytes: call.packet.clone(),
                session: call.session.clone(),
                schema: call.schema.clone(),
                model: call.model.clone(),
                effort: call.effort,
                tools: call.tools.clone(),
            });
            let next = state
                .lines
                .iter_mut()
                .find(|l| l.as_ref().is_some_and(|l| l.on == call.skill.id()));
            next.and_then(Option::take)
        };
        Box::pin(async move {
            let after_ms = line.as_ref().and_then(|l| l.after_ms);
            if let Some(ms) = after_ms {
                tokio::time::sleep(Duration::from_millis(ms)).await;
            }
            if let Some(code) = line.as_ref().and_then(|l| l.fail.clone()) {
                return Err(code);
            }
            let output = match line.as_ref().and_then(|l| l.output.clone()) {
                Some(output) => output,
                None => built_in(call.skill, &packet_ids(&call.packet)),
            };
            let tokens_out = output.to_string().len() as u64 / 4 + 1;
            Ok(Reply {
                output,
                tokens_in: call.packet.len() as u64 / 4 + 1,
                tokens_out,
                cost_usd: Some(line.and_then(|l| l.cost_usd).unwrap_or(0.001)),
                first_token_ms: Some(after_ms.unwrap_or(0)),
                session_id: call.session,
            })
        })
    }

    fn open_session(&self, _: RuntimeChoice, resume: Option<&str>) -> Result<String, String> {
        let mut state = lock(&self.0);
        state.opened += 1;
        Ok(resume.map_or_else(
            || format!("scripted-session-{}", state.opened),
            String::from,
        ))
    }

    fn close_session(&self, _: RuntimeChoice, session: &str) {
        lock(&self.0).closed.push(session.into());
    }
}

/// The evidence ids of a released packet (`{"items": [{"id": …}]}`).
fn packet_ids(packet: &[u8]) -> Vec<String> {
    let packet: Value = serde_json::from_slice(packet).unwrap_or_default();
    let items = packet["items"].as_array().cloned().unwrap_or_default();
    items
        .iter()
        .filter_map(|i| i["id"].as_str().map(String::from))
        .collect()
}

/// A valid output for `skill` that cites the first of `ids`.
pub(crate) fn built_in(skill: Skill, ids: &[String]) -> Value {
    let cited: Vec<SegmentId> = ids.iter().take(1).cloned().map(SegmentId::new).collect();
    let item = |text: &str| ExtractedItem {
        text: text.into(),
        owner_hint: None,
        due: None,
        quote: "scripted quote".into(),
        evidence_segment_ids: cited.clone(),
        is_engineering: false,
        linked_issue: None,
        topic_hint: None,
        lang: Lang::En,
    };
    let found = !cited.is_empty();
    let output = match skill {
        Skill::PostCall => serde_json::to_value(PostCallOutput {
            lang: Lang::En,
            summary_md: "Scripted summary.".into(),
            decisions: vec![item("Scripted decision")],
            action_items: vec![item("Scripted action item")],
            open_questions: Vec::new(),
            risks: Vec::new(),
            per_participant: Vec::new(),
            extras_md: None,
        }),
        Skill::CouncilTick => serde_json::to_value(CouncilTickOutput { cards: Vec::new() }),
        Skill::RoleReview => serde_json::to_value(RoleReviewOutput {
            agent: "scripted".into(),
            review_md: "Scripted review.".into(),
            evidence_segment_ids: cited.clone(),
        }),
        Skill::Handoff => serde_json::to_value(HandoffPromptOutput {
            goal: "Scripted goal".into(),
            context: "Scripted context".into(),
            constraints: Vec::new(),
            acceptance: Vec::new(),
            links: Vec::new(),
            repo: None,
            guardrails: "Scripted guardrails".into(),
        }),
        Skill::AskAnswer => serde_json::to_value(AskAnswerOutput {
            answer_md: if found {
                "Scripted answer [1].".into()
            } else {
                "Nothing in the calls answers that.".into()
            },
            citations: found
                .then(|| AnswerCitation {
                    n: 1,
                    segment_ids: cited.clone(),
                    chunk_ids: Vec::new(),
                    quote: "scripted quote".into(),
                })
                .into_iter()
                .collect(),
            found,
        }),
        Skill::Reconcile => serde_json::to_value(ReconcileJudgementOutput {
            judgement: Judgement::Unsure,
            confidence: 0.5,
            reason: "scripted".into(),
            evidence_segment_ids: cited,
        }),
    };
    output.expect("contract types serialize")
}
