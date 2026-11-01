//! Library: calls, tags, search, Ask and topics.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::{
    ArchiveStatus, CalendarEventRef, GapView, ItemView, MarkView, OutputsStatus, SpeakerView,
    StreamEndReason,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CallStatus {
    Recording,
    Paused,
    /// Stopped; outputs being written.
    Processing,
    Ready,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallRow {
    pub id: CallId,
    pub rev: Rev,
    pub title: String,
    pub call_type: CallTypeId,
    pub started_at: TimestampMs,
    pub duration_ms: DurationMs,
    pub platform: Option<String>,
    pub participants: Vec<PersonChip>,
    pub unnamed_speakers: u32,
    pub languages: Vec<Lang>,
    pub tags: Vec<String>,
    pub privacy: PrivacyClass,
    pub status: CallStatus,
    pub outputs: OutputsStatus,
    pub archive: ArchiveStatus,
    pub audio_kept_until: Option<TimestampMs>,
    pub audio_deleted: bool,
    /// When the audio was deleted (by hand or by age); `null` while it is kept or never stored.
    /// The call page reads "Audio deleted on <date> (kept N days)" from it (D-36).
    pub audio_deleted_at: Option<TimestampMs>,
    /// Days the audio is kept under the current retention; 0 for forever and never store.
    pub audio_retention_days: u32,
    pub open_items: u32,
    pub review_waiting: u32,
}

/// Call page header and Call info.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallDetail {
    pub call: CallRow,
    pub calendar_event: Option<CalendarEventRef>,
    pub speakers: Vec<SpeakerView>,
    pub marks: Vec<MarkView>,
    pub gaps: Vec<GapView>,
    /// What the call was processed with.
    pub mode_used: EffectiveMode,
    pub audio_not_stored: bool,
    /// First recorded call: offer **Notify Me When Summaries Are Ready** (D68).
    pub first_recorded_call: bool,
    /// The call's folder on disk (its audio and transcript files), absolute, for **Show in Finder**
    /// (`open_external { reveal_in_finder }`); it may be gone once the audio was deleted.
    pub folder: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
pub struct CallFilter {
    #[serde(default)]
    pub people: Vec<PersonId>,
    #[serde(default)]
    pub call_types: Vec<CallTypeId>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub languages: Vec<Lang>,
    #[serde(default)]
    pub from: Option<LocalDate>,
    #[serde(default)]
    pub to: Option<LocalDate>,
    #[serde(default)]
    pub has_open_items: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CallSort {
    Newest,
    Oldest,
    Longest,
    Title,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallsListArgs {
    pub filter: CallFilter,
    pub sort: CallSort,
    pub page: PageRequest,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallUpdateArgs {
    pub call_id: CallId,
    pub rev: Rev,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub call_type: Option<CallTypeId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallMutation {
    pub call: CallRow,
    pub change_id: ChangeId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TagsSetArgs {
    pub call_ids: Vec<CallId>,
    /// 1–32 characters, unique ignoring case (D90).
    pub add: Vec<String>,
    pub remove: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TagsSetResult {
    pub calls: Vec<CallRow>,
    pub change_id: ChangeId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TagCount {
    pub tag: String,
    pub calls: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TagList {
    pub tags: Vec<TagCount>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallsDeleteArgs {
    pub call_ids: Vec<CallId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct DeleteResult {
    pub deleted: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallTypeInfo {
    pub id: CallTypeId,
    pub label: String,
    /// Built-in call types ship with Noter; the others are skill folders the user added
    /// (owner decision 17 Oct). Built-in ones can be edited, not removed.
    pub builtin: bool,
    /// The call type's skill directory (`skills/<type>/`, or the user's copy under Application Support).
    pub skill_path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallTypeList {
    pub call_types: Vec<CallTypeInfo>,
}

// ── search ────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SearchArgs {
    pub query: String,
    pub filter: CallFilter,
    /// Per section; default 20.
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SearchMode {
    Hybrid,
    /// Index rebuild running: keyword-only with progress.
    KeywordOnly {
        rebuild_progress: f32,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HitTarget {
    Segment {
        span: TimeSpan,
    },
    Item {
        item_id: ItemId,
    },
    Summary {
        call_id: CallId,
        summary_id: SummaryId,
    },
    Document {
        document_id: DocumentId,
        chunk_id: ChunkId,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SearchHit {
    pub target: HitTarget,
    pub title: String,
    pub snippet: String,
    pub highlights: Vec<TextRange>,
    pub lang: Option<Lang>,
    pub strength: MatchStrength,
    pub call: Option<CallRef>,
    pub provenance: Provenance,
    /// The query matched across languages ("Cross-language match").
    pub cross_language: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SearchExplain {
    pub keyword_hits: u32,
    pub semantic_hits: u32,
    pub normalized_query: String,
    pub filters_applied: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SearchResults {
    pub query: String,
    pub mode: SearchMode,
    pub calls: Vec<SearchHit>,
    pub items: Vec<SearchHit>,
    pub documents: Vec<SearchHit>,
    pub topics: Vec<TopicRow>,
    pub only_weak: bool,
    pub explain: SearchExplain,
}

// ── ask ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
pub struct AskScope {
    #[serde(default)]
    pub preset: Option<String>,
    #[serde(default)]
    pub people: Vec<PersonId>,
    #[serde(default)]
    pub call_types: Vec<CallTypeId>,
    #[serde(default)]
    pub from: Option<LocalDate>,
    #[serde(default)]
    pub to: Option<LocalDate>,
    #[serde(default)]
    pub topic_id: Option<TopicId>,
    #[serde(default)]
    pub call_id: Option<CallId>,
    /// Knowledge sources included; `false` = calls only.
    #[serde(default)]
    pub include_documents: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ScopePreset {
    pub id: String,
    pub label: String,
    pub scope: AskScope,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ScopePresetList {
    pub presets: Vec<ScopePreset>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AskStartArgs {
    /// Follow-up in an existing thread, or a new thread.
    #[serde(default)]
    pub thread_id: Option<AskThreadId>,
    pub question: String,
    pub scope: AskScope,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AskHandle {
    pub thread_id: AskThreadId,
    pub turn_id: AskTurnId,
    pub subscription_id: SubscriptionId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct Citation {
    /// [1], [2] … in the answer text.
    pub n: u16,
    pub provenance: Provenance,
    pub quote: String,
    pub speaker: Option<PersonChip>,
    pub strength: MatchStrength,
    /// The cited call or document was deleted since.
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AskAnswer {
    pub turn_id: AskTurnId,
    pub question: String,
    pub answer_md: String,
    pub citations: Vec<Citation>,
    /// `false` = "I could not find this in your calls"; never a guess.
    pub found: bool,
    pub runtime: RuntimeChoice,
    pub answered_locally: bool,
    pub sensitive_sources_skipped: u32,
    pub keyword_only: bool,
    pub only_weak_evidence: bool,
    pub asked_at: TimestampMs,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AskMsg {
    pub seq: Seq,
    pub event: AskEvent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AskEvent {
    Started {
        runtime: RuntimeChoice,
        mode: EffectiveMode,
    },
    /// Append to the answer text.
    Delta {
        text: String,
    },
    Citation {
        citation: Citation,
    },
    Done {
        answer: AskAnswer,
    },
    Failed {
        error: crate::error::CoreError,
    },
    Ended {
        reason: StreamEndReason,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AskTurnArgs {
    pub turn_id: AskTurnId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AskThreadArgs {
    pub thread_id: AskThreadId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AskThreadRow {
    pub id: AskThreadId,
    pub title: String,
    pub turns: u32,
    pub updated_at: TimestampMs,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AskThreadList {
    pub threads: Vec<AskThreadRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AskThread {
    pub id: AskThreadId,
    pub title: String,
    pub scope: AskScope,
    pub turns: Vec<AskAnswer>,
}

// ── topics ────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TopicRow {
    pub id: TopicId,
    pub rev: Rev,
    pub name: String,
    pub aliases: Vec<String>,
    pub calls: u32,
    pub decisions: u32,
    pub open_items: u32,
    pub last_seen: TimestampMs,
    pub merge_suggestion: Option<TopicChip>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TopicList {
    pub topics: Vec<TopicRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TopicIdArgs {
    pub topic_id: TopicId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TopicThreadGroup {
    pub call: CallRef,
    pub items: Vec<ItemView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TopicThread {
    pub topic: TopicRow,
    /// Newest call first.
    pub groups: Vec<TopicThreadGroup>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TopicRenameArgs {
    pub topic_id: TopicId,
    pub rev: Rev,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TopicMergeArgs {
    /// Merged into the target; its name becomes one of the target's aliases.
    pub source: TopicId,
    pub target: TopicId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TopicPairArgs {
    pub a: TopicId,
    pub b: TopicId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TopicMutation {
    pub topic: TopicRow,
    pub change_id: ChangeId,
}
