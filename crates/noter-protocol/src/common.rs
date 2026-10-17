//! Shared value types: identifiers, time, language, spans, paging and the
//! small enums every part of the contract uses.
//!
//! Wire conventions (DESIGN-core 3.3):
//! * JSON field and enum names are `snake_case`.
//! * Tagged unions use `"type"` as the tag (`{"type": "past_call", ...}`).
//! * Times are raw numbers; the UI formats them (12/24 h comes in `UiPrefs`).
//! * Optional fields are present as `null` or absent; never empty strings.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

macro_rules! id_type {
    ($(#[$m:meta])* $name:ident, $prefix:literal) => {
        $(#[$m])*
        /// Opaque identifier: a core-generated ULID with a type prefix (see `PREFIX`); the UI never parses it.
        #[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Type, JsonSchema)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            /// The prefix every value of this identifier starts with.
            pub const PREFIX: &'static str = $prefix;
            pub fn new(v: impl Into<String>) -> Self { Self(v.into()) }
            pub fn as_str(&self) -> &str { &self.0 }
        }
        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(&self.0) }
        }
    };
}

id_type!(CallId, "call");
id_type!(SegmentId, "seg");
id_type!(SpeakerId, "spk");
id_type!(PersonId, "per");
id_type!(ItemId, "itm");
id_type!(CardId, "card");
id_type!(AgentId, "agt");
id_type!(SummaryId, "sum");
id_type!(VersionId, "ver");
id_type!(TopicId, "top");
id_type!(SourceId, "src");
id_type!(DocumentId, "doc");
id_type!(ChunkId, "chk");
id_type!(ChangeId, "chg");
id_type!(BatchId, "bat");
id_type!(JobId, "job");
id_type!(JobRunId, "run");
id_type!(LlmRunId, "llm");
id_type!(AuditId, "aud");
id_type!(EvidenceId, "evd");
id_type!(RepoMappingId, "rep");
id_type!(MarkId, "mrk");
id_type!(SubscriptionId, "sub");
id_type!(AskThreadId, "ask");
id_type!(AskTurnId, "turn");
id_type!(DetectionId, "det");
id_type!(SignInSessionId, "sis");
id_type!(ContextItemId, "ctx");
id_type!(GlossaryTermId, "gls");
id_type!(TickId, "tick");
id_type!(RedoToken, "redo");
id_type!(
    /// macOS display identity (CGDirectDisplay UUID), stable across reconnects.
    DisplayId,
    "dsp"
);
id_type!(
    /// Calendar event identifier as EventKit reports it, prefixed by the core.
    CalendarEventId,
    "evt"
);

/// A call type, such as `one_on_one`, `planning` or a user-added type.
/// Call types are data, not code: each one is a skill directory
/// (`skills/<type>/`) and the list comes from `settings_call_types`.
#[derive(
    Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Type, JsonSchema,
)]
#[serde(transparent)]
pub struct CallTypeId(pub String);

/// Milliseconds since the Unix epoch (UTC). Exported to TypeScript as `number`
/// (exact up to the year 285 616).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    Type,
    JsonSchema,
)]
#[serde(transparent)]
pub struct TimestampMs(#[specta(type = specta_typescript::Number)] pub i64);

/// Milliseconds from the start of a call (session-relative audio time).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    Type,
    JsonSchema,
)]
#[serde(transparent)]
pub struct OffsetMs(pub u32);

/// A duration in milliseconds.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    Type,
    JsonSchema,
)]
#[serde(transparent)]
pub struct DurationMs(pub u32);

/// A calendar date without time zone, `YYYY-MM-DD`, in the user's local calendar.
#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Type, JsonSchema,
)]
#[serde(transparent)]
pub struct LocalDate(pub String);

/// Per-stream sequence number. Starts at 1, increases by exactly 1 per
/// message of one subscription, so the UI can detect a gap (and resubscribe).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    Type,
    JsonSchema,
)]
#[serde(transparent)]
pub struct Seq(#[specta(type = specta_typescript::Number)] pub u64);

/// Row version for optimistic concurrency. Every editable record carries it;
/// every edit command sends the `rev` it was based on and gets
/// `ErrorCode::Conflict` when the record changed since (UI: "Item changed since").
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    Type,
    JsonSchema,
)]
#[serde(transparent)]
pub struct Rev(pub u32);

/// Opaque paging cursor returned by the core.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Type, JsonSchema)]
#[serde(transparent)]
pub struct Cursor(pub String);

/// Content language. Detection is restricted to these three (PRD › Transcription pipeline).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Lang {
    En,
    Ru,
    De,
}

/// The two capture channels, kept separate end to end.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AudioChannel {
    /// The user's microphone ("you").
    Mic,
    /// System audio: everyone else.
    Sys,
}

/// Evidence as a time span, resolved to segments at read time, so it survives
/// the archive pass replacing live segments (REVIEW › B5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct TimeSpan {
    pub call_id: CallId,
    /// `null` means both channels.
    pub channel: Option<AudioChannel>,
    pub t0_ms: OffsetMs,
    pub t1_ms: OffsetMs,
}

/// A character range inside a string (UTF-16 code units, as JavaScript counts).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct TextRange {
    pub start: u32,
    pub end: u32,
}

/// Paging request for list commands.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PageRequest {
    #[serde(default)]
    pub cursor: Option<Cursor>,
    /// Default 100, maximum 500.
    #[serde(default)]
    pub limit: Option<u32>,
}

/// One page of a view-ready list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct Page<T> {
    pub rows: Vec<T>,
    pub next_cursor: Option<Cursor>,
    /// Total when the core can count it cheaply; `null` otherwise.
    pub total: Option<u32>,
}

/// Arguments of a command that needs none.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct NoArgs {}

/// Result of a command that returns nothing but success.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Ack {}

/// Privacy class of a call or a knowledge source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyClass {
    Normal,
    Sensitive,
}

/// The global privacy mode the user chose (Settings › Privacy).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyMode {
    CloudAllowed,
    CloudRedacted,
    LocalOnly,
}

/// What actually applies right now, for the mode indicator
/// (DESIGN › Mode indicator: Cloud, Cloud redacted, Local only, Sensitive · local, Switched to local).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EffectiveMode {
    Cloud,
    CloudRedacted,
    LocalOnly,
    SensitiveLocal,
    SwitchedToLocal,
}

/// The five runtime choices an agent or a task can use (PRD › Feature specification › 8, PM-58).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeChoice {
    ClaudeApiKey,
    ClaudeAccount,
    CodexApiKey,
    ChatgptAccount,
    Local,
}

/// Effort level, mapped by each runtime adapter to its own control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Effort {
    Low,
    Medium,
    High,
    Max,
}

/// Coarse confidence for proposals and evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ConfidenceLevel {
    High,
    Medium,
    Low,
}

/// Strength of a search hit or a citation (D97, D98). The core decides; the UI never guesses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MatchStrength {
    Strong,
    Weak,
}

/// A person as a compact chip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PersonChip {
    pub id: PersonId,
    pub display_name: String,
    /// "Anna K."
    pub short_name: String,
    pub initials: String,
    /// True for the user themselves.
    pub is_you: bool,
}

/// Reference to an existing person, or a person to create on the fly
/// (the New person form in the person picker).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PersonRef {
    Existing {
        person_id: PersonId,
    },
    New {
        display_name: String,
        email: Option<String>,
    },
}

/// A call as a compact reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct CallRef {
    pub id: CallId,
    pub title: String,
    pub started_at: TimestampMs,
    pub call_type: CallTypeId,
}

/// A topic as a compact chip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct TopicChip {
    pub id: TopicId,
    pub name: String,
}

/// An agent as a compact reference, for badges.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AgentRef {
    pub id: AgentId,
    pub name: String,
    /// Monochrome badge glyph name from the UI icon set (one per role).
    pub badge: String,
}

/// Where a card, an answer or an item comes from (DESIGN 3.1 › Provenance).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Provenance {
    ThisCall {
        span: TimeSpan,
    },
    PastCall {
        call: CallRef,
        span: TimeSpan,
    },
    Jira {
        key: String,
        url: Option<String>,
        looked_up_at: TimestampMs,
    },
    Document {
        source_id: SourceId,
        document_id: DocumentId,
        chunk_id: ChunkId,
        title: String,
        section: Option<String>,
        source_name: String,
    },
    LiveLookup {
        server: String,
        summary: String,
        at: TimestampMs,
    },
    /// v1.x: "from your screen: Jira VSTOR-1234 at 14:32".
    Screen {
        context_item_id: ContextItemId,
        label: String,
        at: TimestampMs,
    },
    /// "Model guess · unverified"; ranked last.
    ModelGuess,
}

/// Status of one macOS permission.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PermissionState {
    NotAsked,
    Granted,
    Denied,
    /// Granted in System Settings but macOS needs Noter to quit and reopen.
    NeedsRelaunch,
}

/// The macOS permissions Noter asks for (PRD › Security › permissions, in order).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PermissionKind {
    Microphone,
    SystemAudio,
    Calendar,
    Notifications,
    ScreenRecording,
    AutomationTerminal,
    AutomationBrowser,
}
