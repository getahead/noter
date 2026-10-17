//! Items: decisions, action items, open questions and risks; their review and evidence.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::{ChangeRow, HandoffTarget};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ItemKind {
    Decision,
    ActionItem,
    OpenQuestion,
    Risk,
}

/// The item machine: `open → done | handed_off | carried | answered_in_call | closed_by_evidence`;
/// `handed_off → done` (landed, or evidence) and `handed_off → open` (keep open);
/// `carried → open` after the call; reopen returns any closed status to `open`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ItemStatus {
    Open,
    Done,
    /// Offered in a call with the same people that is running now; back to `open` after it.
    Carried,
    HandedOff,
    /// Closed by evidence (a linked key moved to Done, a merged PR). Accepted items only;
    /// a suggested item gets at most a proposal.
    ClosedByEvidence,
    /// An open question answered in a call; logged, with **Reopen**.
    AnsweredInCall,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ReviewState {
    Suggested,
    Accepted,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CreatedBy {
    Llm,
    User,
    /// Pinned from a copilot card during the call (arrives accepted).
    Pin,
}

/// Who owes whom, for ranking and the Today grouping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Owed {
    ByYou,
    ToYou,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceSource {
    Jira,
    Bitbucket,
    Github,
    Call,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct EvidenceView {
    pub id: EvidenceId,
    pub source: EvidenceSource,
    /// Issue key, PR URL or a span.
    pub reference: String,
    pub url: Option<String>,
    pub span: Option<TimeSpan>,
    /// "PR #448 merged on 14 Oct".
    pub summary: String,
    pub confidence: ConfidenceLevel,
    pub dated_at: TimestampMs,
    pub collected_at: TimestampMs,
    /// Closed the item automatically (only a linked key with Done or a merged PR).
    pub closed_item: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HandoffSummary {
    pub target: HandoffTarget,
    pub at: TimestampMs,
    pub cwd: String,
    /// The handoff waits for evidence or for the owner's answer.
    pub awaiting: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ItemView {
    pub id: ItemId,
    pub rev: Rev,
    pub call: CallRef,
    pub kind: ItemKind,
    pub text: String,
    pub lang: Lang,
    pub owner: Option<PersonChip>,
    pub due: Option<LocalDate>,
    pub status: ItemStatus,
    pub review: ReviewState,
    pub created_by: CreatedBy,
    pub topic: Option<TopicChip>,
    pub is_engineering: bool,
    pub linked_issue: Option<String>,
    /// Evidence spans in the source call; resolved to segments at read time.
    pub spans: Vec<TimeSpan>,
    pub handoff: Option<HandoffSummary>,
    pub closed_by: Option<EvidenceView>,
    pub done_at: Option<TimestampMs>,
    pub owed: Owed,
    /// "From 1:1 on 9 Oct" for carried items.
    pub carried_from: Option<CallRef>,
    /// The user edited the text after it was generated.
    pub edited: bool,
}

/// Item inspector content.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ItemDetail {
    pub item: ItemView,
    pub evidence: Vec<EvidenceView>,
    pub history: Vec<ChangeRow>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
pub struct ItemFilter {
    #[serde(default)]
    pub call_id: Option<CallId>,
    #[serde(default)]
    pub person_id: Option<PersonId>,
    #[serde(default)]
    pub topic_id: Option<TopicId>,
    #[serde(default)]
    pub kinds: Vec<ItemKind>,
    #[serde(default)]
    pub statuses: Vec<ItemStatus>,
    #[serde(default)]
    pub reviews: Vec<ReviewState>,
    #[serde(default)]
    pub due_before: Option<LocalDate>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ItemsListArgs {
    pub filter: ItemFilter,
    pub page: PageRequest,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ItemIdArgs {
    pub item_id: ItemId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ItemDoneArgs {
    pub item_id: ItemId,
    pub rev: Rev,
    /// Wanted state. Ticking a suggested item accepts it and marks it done.
    pub done: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ReviewDecision {
    Accept,
    Reject,
    /// Back to suggested (undo of a rejection from the row).
    Restore,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ItemReviewArgs {
    pub item_id: ItemId,
    pub rev: Rev,
    pub decision: ReviewDecision,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ReviewAllArgs {
    pub call_id: CallId,
    /// Empty = every kind.
    pub kinds: Vec<ItemKind>,
}

/// Fields an edit may change; `null` leaves a field as it is.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
pub struct ItemPatch {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub kind: Option<ItemKind>,
    #[serde(default)]
    pub owner: Option<OptionalPerson>,
    #[serde(default)]
    pub due: Option<OptionalDate>,
    #[serde(default)]
    pub linked_issue: Option<OptionalText>,
    #[serde(default)]
    pub is_engineering: Option<bool>,
    #[serde(default)]
    pub topic_id: Option<TopicId>,
}

/// Explicit set-or-clear for nullable fields in patches.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OptionalPerson {
    Set { person: PersonRef },
    Clear,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OptionalDate {
    Set { date: LocalDate },
    Clear,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OptionalText {
    Set { text: String },
    Clear,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ItemEditArgs {
    pub item_id: ItemId,
    pub rev: Rev,
    pub patch: ItemPatch,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ItemReopenArgs {
    pub item_id: ItemId,
    pub rev: Rev,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ItemCreateArgs {
    pub call_id: CallId,
    pub kind: ItemKind,
    pub text: String,
    #[serde(default)]
    pub owner: Option<PersonRef>,
    #[serde(default)]
    pub due: Option<LocalDate>,
    #[serde(default)]
    pub span: Option<TimeSpan>,
}

/// The answer to the carry-forward "Did the handoff land?".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum HandoffLandedAnswer {
    /// **Yes, Landed**: `handed_off → done`.
    Landed,
    /// **Done Another Way**: `handed_off → done`, noted as done another way.
    DoneAnotherWay,
    /// **Keep Open** (or Esc): stays handed off; asked again at the next call with the same people.
    KeepOpen,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HandoffLandedArgs {
    pub item_id: ItemId,
    pub rev: Rev,
    pub answer: HandoffLandedAnswer,
}

/// Result of every single-item mutation: the changed record and the change to undo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ItemMutation {
    pub item: ItemView,
    pub change_id: ChangeId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ItemsBatchResult {
    pub items: Vec<ItemView>,
    pub batch_id: Option<BatchId>,
    pub skipped: u32,
}
