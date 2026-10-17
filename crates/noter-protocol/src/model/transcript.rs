//! Transcript, speakers, levels and playback.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::{MarkView, OutputRoute};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SegmentState {
    /// Grey text; replaced in place until confirmed.
    Hypothesis,
    /// Full colour; never moves or changes once shown, except by a correction or the archive pass.
    Confirmed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptPass {
    Live,
    /// Offline Large v3 pass; replaces the live transcript as the archive copy.
    Archive,
}

/// How a speaker is labelled on screen (DESIGN 3.1 › Speaker label).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SpeakerLabel {
    You,
    Person {
        person: PersonChip,
    },
    /// "Speaker 2".
    Unnamed {
        n: u16,
    },
    /// Another voice on the user's microphone.
    GuestYourSide,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SpeakerRef {
    pub speaker_id: SpeakerId,
    pub label: SpeakerLabel,
}

/// A term the hallucination/term filter corrected; the original shows in the help tag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct TermCorrection {
    pub range: TextRange,
    pub original: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SegmentView {
    pub id: SegmentId,
    pub call_id: CallId,
    pub channel: AudioChannel,
    pub speaker: SpeakerRef,
    /// Both candidate speakers on a crosstalk row; empty otherwise.
    pub crosstalk_with: Vec<SpeakerRef>,
    pub t0_ms: OffsetMs,
    pub t1_ms: OffsetMs,
    pub text: String,
    pub lang: Lang,
    /// Language-ID probability; below 0.7 the speaker prior decided.
    pub lang_p: f32,
    /// 0..1, from the average log-probability; under 0.7 the row reads low confidence.
    pub confidence: f32,
    pub state: SegmentState,
    pub pass: TranscriptPass,
    pub corrections: Vec<TermCorrection>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SpeakerView {
    pub id: SpeakerId,
    pub call_id: CallId,
    pub label: SpeakerLabel,
    pub channel: AudioChannel,
    pub segment_count: u32,
    /// Present only when behaviour metrics are on (D47).
    pub talk_ms: Option<DurationMs>,
    /// A short span to replay when naming the speaker.
    pub sample: Option<TimeSpan>,
    /// The core's suggestion from an opted-in voice profile or the calendar.
    pub suggestion: Option<PersonChip>,
    pub named_by: Option<NamedBy>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum NamedBy {
    You,
    VoiceProfile,
    Calendar,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum GapReason {
    Paused,
    DeviceChanged,
    SystemAudioLost,
    EngineRestarted,
    /// Continue Recording appended to the same call after a stop.
    Continued,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct GapView {
    pub call_id: CallId,
    pub t0_ms: OffsetMs,
    pub t1_ms: OffsetMs,
    pub reason: GapReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveStatus {
    /// Live call, or nothing scheduled yet.
    NotStarted,
    Pending,
    Running,
    Done,
    /// "Archive transcript pending": retried in the nightly window.
    Failed,
}

/// `transcript_subscribe` result: everything up to `last_seq`. The Channel then
/// delivers strictly after `last_seq` (snapshot, then stream; DESIGN 3.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TranscriptSnapshot {
    /// `null` when the call is not live (nothing will stream).
    pub subscription_id: Option<SubscriptionId>,
    pub call_id: CallId,
    pub live: bool,
    pub pass: TranscriptPass,
    pub archive: ArchiveStatus,
    pub segments: Vec<SegmentView>,
    /// Current hypothesis per channel (at most two).
    pub hypotheses: Vec<SegmentView>,
    pub marks: Vec<MarkView>,
    pub gaps: Vec<GapView>,
    pub speakers: Vec<SpeakerView>,
    pub last_seq: Seq,
    pub audio_available: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TranscriptSubscribeArgs {
    pub call_id: CallId,
}

/// One Channel message of the transcript stream.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TranscriptMsg {
    pub seq: Seq,
    pub event: TranscriptEvent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TranscriptEvent {
    /// Replace the current hypothesis of `segment.channel`.
    Hypothesis {
        segment: SegmentView,
    },
    /// Append; removes the hypothesis it confirms.
    Confirmed {
        segment: SegmentView,
    },
    /// A correction changed confirmed rows (term fix, rename): replace by id.
    SegmentsUpdated {
        segments: Vec<SegmentView>,
    },
    /// Speaker labels changed (rename, offline relabel: "speakers updated").
    SpeakersUpdated {
        speakers: Vec<SpeakerView>,
        relabelled_by_archive: bool,
    },
    Gap {
        gap: GapView,
    },
    Mark {
        mark: MarkView,
    },
    /// The stream ended; the snapshot stays valid.
    Ended {
        reason: StreamEndReason,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum StreamEndReason {
    /// Capture stopped normally.
    CallStopped,
    Discarded,
    /// The UI called `stream_unsubscribe`.
    Unsubscribed,
    /// The core dropped the subscriber because it fell too far behind; resubscribe.
    Lagged,
    /// The core is shutting down.
    Shutdown,
}

/// Levels Channel: at most one message per 100 ms.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
pub struct LevelsMsg {
    pub seq: Seq,
    pub at_ms: OffsetMs,
    /// dBFS, -90..0.
    pub mic_db: f32,
    pub sys_db: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SubscribeLevelsArgs {
    /// `null` for the self-test or the Today self-test sheet (no call yet).
    pub call_id: Option<CallId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SubscriptionHandle {
    pub subscription_id: SubscriptionId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct UnsubscribeArgs {
    pub subscription_id: SubscriptionId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RenameScope {
    WholeCall,
    OneSegment { segment_id: SegmentId },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct RenameSpeakerArgs {
    pub call_id: CallId,
    pub speaker_id: SpeakerId,
    pub person: PersonRef,
    pub scope: RenameScope,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SpeakerMutation {
    pub speakers: Vec<SpeakerView>,
    pub change_id: ChangeId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct FixTermArgs {
    pub call_id: CallId,
    pub segment_id: SegmentId,
    pub range: TextRange,
    pub replacement: String,
    /// Add to the glossary so future decoding is biased (default on).
    pub add_to_glossary: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct FixTermResult {
    pub segment: SegmentView,
    pub change_id: ChangeId,
    pub glossary_term_id: Option<GlossaryTermId>,
    /// The reconciliation job will propose applying the term to earlier calls.
    pub proposal_queued: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SpeakerAssignment {
    pub speaker_id: SpeakerId,
    /// `null` = skip this speaker for now.
    pub person: Option<PersonRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct NameSpeakersArgs {
    pub call_id: CallId,
    pub assignments: Vec<SpeakerAssignment>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SpanArgs {
    pub span: TimeSpan,
}

/// Segments of a span for the evidence popover and the span preview.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SpanPreview {
    pub span: TimeSpan,
    pub call: CallRef,
    pub segments: Vec<SegmentView>,
    pub audio_available: bool,
    /// The archive pass changed the words at this span since the evidence was taken.
    pub upgraded_by_archive: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PlayAudioArgs {
    pub call_id: CallId,
    pub from_ms: OffsetMs,
    /// `null` plays to the end of the segment that contains `from_ms`.
    pub to_ms: Option<OffsetMs>,
    pub channel: Option<AudioChannel>,
}

/// Audio plays natively in the core (no media in the WebView); event `playback:state`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PlaybackState {
    pub playing: bool,
    pub call_id: Option<CallId>,
    pub position_ms: OffsetMs,
    pub to_ms: Option<OffsetMs>,
    pub route: OutputRoute,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct DeleteAudioArgs {
    pub call_ids: Vec<CallId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct DeleteOldAudioArgs {
    pub older_than_days: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct DeleteAudioResult {
    pub calls: u32,
    pub freed_mb: u32,
}
