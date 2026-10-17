//! Capture control: the call lifecycle as the UI sees it (DESIGN-core 3.1 › Call lifecycle).

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::OutputRoute;

/// The single capture state machine. Sent whole on every change (`capture:state`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CaptureState {
    pub phase: CapturePhase,
    pub call_id: Option<CallId>,
    pub title: Option<String>,
    pub started_at: Option<TimestampMs>,
    /// Audio time recorded so far (pauses excluded).
    pub recorded_ms: DurationMs,
    pub sensitive: bool,
    pub pause: Option<PauseInfo>,
    /// The notice the call surfaces must show, if any (call end, new meeting, nothing heard).
    pub notice: Option<CaptureNotice>,
    /// After any stop, **Continue Recording** is offered until this time (PM-43).
    pub continue_until: Option<TimestampMs>,
    pub output_route: OutputRoute,
    /// Replay of a line is possible right now: headphones and own sounds excluded.
    pub replay_available: bool,
    /// Audio is not stored for this call ("Never store audio").
    pub audio_not_stored: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CapturePhase {
    Idle,
    /// Engine starting, aggregate device being built.
    Starting,
    Recording,
    Paused,
    /// Flushing audio and writing per-call files; the call window shows its closing state.
    Stopping,
    /// Stopped; `continue_until` may still allow Continue Recording.
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PauseInfo {
    pub since: TimestampMs,
    /// The menu bar's "Paused for 5 minutes" reminder fires at this time.
    pub remind_at: Option<TimestampMs>,
}

/// Notices shown in the call window's notice slot or, when it is hidden, in the record prompt (PM-39).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CaptureNotice {
    /// Meeting app released audio and mic for 20 s; stops at `stops_at` unless kept.
    CallEnded { stops_at: TimestampMs },
    /// While hidden for presenting: no countdown; stops after 10 minutes.
    CallSeemsEnded { stops_at: TimestampMs },
    /// The next calendar event started, or the meeting app's meeting changed.
    NewMeeting { event: Option<CalendarEventRef>, app_name: Option<String> },
    /// Nothing heard for 5 minutes after the start.
    NothingHeard { since: TimestampMs },
    /// Stopped automatically; offered until `continue_until`.
    StoppedAutomatically { call_id: CallId },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct CalendarEventRef {
    pub id: CalendarEventId,
    pub title: String,
    pub starts_at: TimestampMs,
    pub ends_at: TimestampMs,
}

/// A detected call the record prompt offers to record (event `capture:detected`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallDetection {
    pub id: DetectionId,
    pub app_name: String,
    pub bundle_id: String,
    pub matched_event: Option<CalendarEventRef>,
    pub detected_at: TimestampMs,
    /// The prompt closes at this time (15 s); afterwards the menu bar offers
    /// **Call Detected · Start Recording** while the call runs.
    pub prompt_until: TimestampMs,
    /// Start is refused below 500 MB (the prompt shows the reason instead of **Record**).
    pub blocked: Option<StartBlocked>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum StartBlocked {
    DiskFull,
    SystemAudioOff,
    SetupIncomplete,
}

/// Where a start came from, for metrics and the change log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum StartSource {
    RecordPrompt,
    Hotkey,
    MenuBar,
    Today,
    CallWindow,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CaptureStartArgs {
    pub source: StartSource,
    /// **Record as Sensitive** (PM-41): local-only processing for this call.
    pub sensitive: bool,
    pub detection_id: Option<DetectionId>,
    pub calendar_event_id: Option<CalendarEventId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallIdArgs {
    pub call_id: CallId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CapturePauseArgs {
    pub call_id: CallId,
    /// Wanted state, never a toggle.
    pub paused: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct MarkMomentArgs {
    pub call_id: CallId,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct MarkView {
    pub id: MarkId,
    pub call_id: CallId,
    pub at_ms: OffsetMs,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CallEndChoice {
    KeepRecording,
    StopNow,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallEndAnswerArgs {
    pub call_id: CallId,
    pub choice: CallEndChoice,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum NewMeetingChoice {
    /// The default: stop this call and start a new one with the new event.
    StartNewCall,
    KeepInThisCall,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct NewMeetingAnswerArgs {
    pub call_id: CallId,
    pub choice: NewMeetingChoice,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SensitiveArgs {
    pub call_id: CallId,
    /// Only `true` is accepted during capture (**Make This Call Sensitive**); `false`
    /// is accepted after the call from Call info.
    pub sensitive: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ExcludeSourceArgs {
    pub call_id: CallId,
    pub bundle_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DismissReason {
    NotNow,
    NotACall,
    /// The 15 s elapsed with no answer.
    TimedOut,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct DismissDetectionArgs {
    pub detection_id: DetectionId,
    pub reason: DismissReason,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct IgnoreAppArgs {
    pub bundle_id: String,
    pub app_name: String,
}

/// Event `capture:detected`: the record prompt's current detection (`null` = none).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct DetectionChanged {
    pub detection: Option<CallDetection>,
}
