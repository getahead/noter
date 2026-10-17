//! Post-call outputs, versions, regeneration, sharing and export.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::{ArchiveStatus, ItemView};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SectionKind {
    Summary,
    Decisions,
    ActionItems,
    OpenQuestions,
    PerParticipant,
    RoleReviews,
    Risks,
    /// Standup blockers, planning Jira-ready items, interview scorecard, incident timeline.
    CallTypeExtras,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SectionState {
    Pending,
    Writing,
    Ready,
    Empty,
    Failed { code: crate::error::ErrorCode, local_fallback_available: bool },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct WriterInfo {
    pub runtime: RuntimeChoice,
    pub model: String,
    pub skill: String,
    pub skill_version: String,
    pub generated_at: TimestampMs,
    pub from_pass: crate::model::TranscriptPass,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct RoleReview {
    pub agent: AgentRef,
    pub summary_id: SummaryId,
    pub rev: Rev,
    pub body_md: String,
    pub writer: WriterInfo,
    pub user_edited: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct OutputSection {
    pub kind: SectionKind,
    pub state: SectionState,
    /// Text sections (summary, per participant, extras).
    pub summary_id: Option<SummaryId>,
    pub rev: Option<Rev>,
    /// Markdown without raw HTML; the UI renders it as such (PM-08).
    pub body_md: Option<String>,
    /// Item sections (decisions, action items, open questions, risks).
    pub items: Vec<ItemView>,
    pub reviews: Vec<RoleReview>,
    pub writer: Option<WriterInfo>,
    pub user_edited: bool,
    /// Regenerated while the user's edit was kept: a diff is available.
    pub regenerated_with_edits: bool,
    pub version_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum OutputsStatus {
    NotStarted,
    Writing,
    Ready,
    PartiallyFailed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallOutputs {
    pub call_id: CallId,
    pub status: OutputsStatus,
    pub sections: Vec<OutputSection>,
    pub archive: ArchiveStatus,
    pub review_waiting: u32,
    pub sensitive: bool,
    /// Written by the local model (cloud unavailable or sensitive).
    pub written_locally: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct OutputEditArgs {
    pub call_id: CallId,
    pub summary_id: SummaryId,
    pub rev: Rev,
    pub body_md: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct OutputMutation {
    pub section: OutputSection,
    pub change_id: ChangeId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct RegenerateArgs {
    pub call_id: CallId,
    /// Summary; decisions, action items and open questions; role reviews.
    pub sections: Vec<SectionKind>,
    pub runtime: Option<RuntimeChoice>,
    pub model: Option<String>,
    /// Skill (call type) to use instead of the call's own.
    pub skill: Option<CallTypeId>,
    /// Let the local model rewrite a failed section.
    pub local: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct JobAccepted {
    pub job_run_id: JobRunId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SummaryIdArgs {
    pub summary_id: SummaryId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum VersionKind {
    Generated,
    UserEdit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct VersionMeta {
    pub id: VersionId,
    pub n: u32,
    pub kind: VersionKind,
    pub writer: Option<WriterInfo>,
    pub created_at: TimestampMs,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct VersionList {
    pub versions: Vec<VersionMeta>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct VersionGetArgs {
    pub summary_id: SummaryId,
    pub version_id: VersionId,
}

/// Two bodies; the UI's diff view computes the diff.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct VersionBody {
    pub meta: VersionMeta,
    pub body_md: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ShareFormat {
    Slack,
    Jira,
    Markdown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ShareScope {
    /// Empty = every section.
    pub sections: Vec<SectionKind>,
    /// Empty = every item of the chosen sections.
    pub item_ids: Vec<ItemId>,
    /// Include suggested items that are not reviewed (marked "Not reviewed").
    pub include_unreviewed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ShareCopyArgs {
    pub call_id: CallId,
    pub scope: ShareScope,
    pub format: ShareFormat,
}

/// The core puts the text on the clipboard and returns a copy for the scope line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ShareResult {
    pub text: String,
    pub sections: u32,
    pub items: u32,
    pub unreviewed_in_scope: u32,
    pub sensitive: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ExportInclude {
    pub summary_and_items: bool,
    pub transcript: bool,
    /// Only while audio is kept.
    pub audio: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ExportCallsArgs {
    pub call_ids: Vec<CallId>,
    pub include: ExportInclude,
}

/// The core shows the save panel; `Cancelled` comes back as `ErrorCode::Cancelled`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ExportResult {
    pub path: String,
    pub files: u32,
}

/// Event `outputs:progress`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct OutputsProgress {
    pub call_id: CallId,
    pub status: OutputsStatus,
    pub section: SectionKind,
    pub state: SectionState,
}
