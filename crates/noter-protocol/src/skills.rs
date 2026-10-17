// @cpt-interface:cpt-noter-interface-skill-outputs:p1
//! LLM skill output contracts (`cpt-noter-interface-skill-outputs`).
//!
//! "The app owns the contracts, not the prompts" (PRD › Product principles › 5).
//! Each skill directory carries `output.schema.json` exported from these types;
//! every adapter (Claude Code `--json-schema`, Codex `--output-schema`, Ollama
//! `format`) is given the same schema. Outputs cite segment ids from the
//! context packet; an output that cites nothing or unknown ids fails
//! validation, is retried once with the failure explained, then falls back to
//! a simpler schema (PRD › LLM orchestration › Context packet).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::common::{ChunkId, Lang, LocalDate, SegmentId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CandidateKind {
    Ask,
    Answer,
    Context,
    Pin,
    CatchUp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SourceKindHint {
    ThisCall,
    PastCall,
    Jira,
    Document,
    ModelGuess,
}

/// One card a council agent proposes in a tick. The core validates, merges,
/// ranks and drops; nothing here is shown as is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct CardCandidate {
    /// Agent id from the packet (fused mode returns cards tagged by agent).
    pub agent: String,
    pub kind: CandidateKind,
    /// One line, at most 120 characters; never a script to read aloud.
    pub title: String,
    /// At most two sentences.
    pub body: Option<String>,
    pub source: SourceKindHint,
    pub evidence_segment_ids: Vec<SegmentId>,
    pub evidence_chunk_ids: Vec<ChunkId>,
    pub jira_key: Option<String>,
    /// 0..1; the ranker drops anything below 0.6.
    pub confidence: f32,
    /// Why now, in one line (logged, not shown).
    pub reason: String,
    pub lang: Lang,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct CouncilTickOutput {
    pub cards: Vec<CardCandidate>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ExtractedItem {
    pub text: String,
    /// A name as spoken; the core resolves it to a person.
    pub owner_hint: Option<String>,
    pub due: Option<LocalDate>,
    pub quote: String,
    pub evidence_segment_ids: Vec<SegmentId>,
    pub is_engineering: bool,
    pub linked_issue: Option<String>,
    pub topic_hint: Option<String>,
    pub lang: Lang,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ParticipantNotes {
    pub speaker_label: String,
    pub said: Vec<String>,
    pub committed_to: Vec<String>,
    pub asked_for: Vec<String>,
    pub pushed_back_on: Vec<String>,
    pub evidence_segment_ids: Vec<SegmentId>,
}

/// Post-call analysis for one call type skill.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct PostCallOutput {
    pub lang: Lang,
    /// 5–10 sentences for someone who was not there.
    pub summary_md: String,
    pub decisions: Vec<ExtractedItem>,
    pub action_items: Vec<ExtractedItem>,
    pub open_questions: Vec<ExtractedItem>,
    pub risks: Vec<ExtractedItem>,
    pub per_participant: Vec<ParticipantNotes>,
    /// Standup blockers, planning Jira-ready items, interview scorecard, incident timeline.
    pub extras_md: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct RoleReviewOutput {
    pub agent: String,
    /// Five sentences from the role's angle.
    pub review_md: String,
    pub evidence_segment_ids: Vec<SegmentId>,
}

/// The handoff skill's fixed schema; the core renders it to Markdown.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct HandoffPromptOutput {
    pub goal: String,
    pub context: String,
    pub constraints: Vec<String>,
    pub acceptance: Vec<String>,
    pub links: Vec<String>,
    pub repo: Option<String>,
    pub guardrails: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct AnswerCitation {
    pub n: u16,
    pub segment_ids: Vec<SegmentId>,
    pub chunk_ids: Vec<ChunkId>,
    pub quote: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct AskAnswerOutput {
    /// Uses [n] markers that match `citations`.
    pub answer_md: String,
    pub citations: Vec<AnswerCitation>,
    /// `false` when nothing in the calls answers the question.
    pub found: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Judgement {
    Yes,
    No,
    Unsure,
}

/// Low-confidence reconciliation and speech-evidence judgements (local model).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ReconcileJudgementOutput {
    pub judgement: Judgement,
    pub confidence: f32,
    pub reason: String,
    pub evidence_segment_ids: Vec<SegmentId>,
}
