//! Change log, undo and redo, proposals, Activity.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::{EvidenceView, JobRunRow};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Actor {
    You,
    Job {
        job_id: JobId,
        name: String,
    },
    Model {
        llm_run_id: LlmRunId,
        runtime: RuntimeChoice,
        model: String,
    },
}

/// The change machine: `proposed → applied | rejected`, `applied → undone` (undo) and
/// `undone → applied` (redo, which writes new change rows).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ChangeStatus {
    Applied,
    Proposed,
    Rejected,
    Undone,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EntityKind {
    Call,
    Segment,
    Speaker,
    Person,
    Item,
    Summary,
    Topic,
    Agent,
    Source,
    Glossary,
    Setting,
    Handoff,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct EntityRef {
    pub kind: EntityKind,
    pub id: String,
    pub label: String,
}

/// One row of a History timeline or the Activity day log. A batch is one row
/// with `batch_size` > 1 that expands on Enter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ChangeRow {
    pub id: ChangeId,
    pub batch_id: Option<BatchId>,
    pub batch_size: u32,
    pub at: TimestampMs,
    pub actor: Actor,
    pub entity: EntityRef,
    pub field: Option<String>,
    /// Text before and after, for the inline diff; `null` for non-text fields.
    pub before: Option<String>,
    pub after: Option<String>,
    /// Plain words: "Accepted 3 action items".
    pub summary: String,
    pub reason: Option<String>,
    pub evidence: Vec<EvidenceView>,
    pub confidence: Option<ConfidenceLevel>,
    pub status: ChangeStatus,
    pub undoable: bool,
    /// Undone and not edited later since, so **Redo** is offered (any time, `change_redo`).
    pub redoable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HistoryTarget {
    All,
    Call { call_id: CallId },
    Item { item_id: ItemId },
    Person { person_id: PersonId },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ActorFilter {
    All,
    You,
    Jobs,
    Models,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HistoryListArgs {
    pub target: HistoryTarget,
    pub actor: ActorFilter,
    #[serde(default)]
    pub job_id: Option<JobId>,
    #[serde(default)]
    pub from: Option<TimestampMs>,
    #[serde(default)]
    pub to: Option<TimestampMs>,
    pub page: PageRequest,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UndoTarget {
    Change {
        change_id: ChangeId,
    },
    /// Undoing a propagation undoes the whole batch.
    Batch {
        batch_id: BatchId,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct UndoArgs {
    pub target: UndoTarget,
}

/// Result of `change_undo` and `change_redo`: "Undone 37 changes · Redo". A partial undo or
/// redo is a success: rows edited later are kept and counted in `skipped_edited_later`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct UndoResult {
    /// Rows undone (`change_undo`) or applied again (`change_redo`).
    pub undone: u32,
    /// Changes edited later and therefore kept ("Some changes edited later").
    pub skipped_edited_later: u32,
}

/// `change_redo`: redo an undone change or batch, at any time while its rows were not
/// edited later. Writes new change rows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct RedoArgs {
    pub target: UndoTarget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ProposalKind {
    CloseItem,
    ApplyTerm,
    RelinkReference,
    NameSpeaker,
    MergeTopics,
    MergePeople,
}

/// A proposal is a change with status `proposed` (PRD › Data model, `changes`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ProposalRow {
    pub id: ChangeId,
    /// Sent back with `proposal_decide`; a stale `rev` is a `conflict`.
    pub rev: Rev,
    pub batch_id: Option<BatchId>,
    pub kind: ProposalKind,
    pub title: String,
    pub reason: String,
    pub target: EntityRef,
    pub confidence: ConfidenceLevel,
    /// Records the proposal would change.
    pub count: u32,
    pub evidence: Vec<EvidenceView>,
    pub created_at: TimestampMs,
    /// The term this proposal is about, for **Always for this term**.
    pub term: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ProposalsListArgs {
    pub kinds: Vec<ProposalKind>,
    pub page: PageRequest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ProposalDecision {
    Accept,
    Reject,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ProposalDecideArgs {
    pub proposal_id: ChangeId,
    /// The proposal's `rev` as shown; `conflict` if its target changed since.
    pub rev: Rev,
    pub decision: ProposalDecision,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ProposalOutcome {
    pub proposal: ProposalRow,
    pub status: ChangeStatus,
    pub applied: u32,
    pub batch_id: Option<BatchId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AlwaysForTermArgs {
    pub proposal_id: ChangeId,
    /// Apply future matches of the term without asking (opens the glossary rule inline).
    pub always: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum LogFormat {
    Markdown,
    Json,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LogScope {
    Call { call_id: CallId },
    Today,
    Last7Days,
    Last30Days,
    Period { from: LocalDate, to: LocalDate },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HistoryExportArgs {
    pub scope: LogScope,
    pub format: LogFormat,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ActivityArgs {
    /// `null` = today.
    #[serde(default)]
    pub day: Option<LocalDate>,
    pub actor: ActorFilter,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ActivityGroup {
    /// `null` for the user's own changes.
    pub run: Option<JobRunRow>,
    pub changes: Vec<ChangeRow>,
    pub total: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ActivityView {
    pub day: LocalDate,
    pub needs_attention: Vec<JobRunRow>,
    pub proposals: Vec<ProposalRow>,
    pub groups: Vec<ActivityGroup>,
}

/// Sidebar counts (event `proposals:counts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ProposalCounts {
    pub version: StateVersion,
    pub waiting: u32,
    pub needs_attention: u32,
}
