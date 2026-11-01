// @cpt-interface:cpt-noter-interface-engine-stdio:p1
//! Core ↔ engine protocol (`cpt-noter-interface-engine-stdio`).
//!
//! JSON Lines over the engine's stdin/stdout, one message per line, UTF-8.
//! The JSON Schema exported from these types (`contracts/engine.schema.json`)
//! generates the Swift `Codable` types of the engine (quicktype or
//! swift-json-schema), so the Rust types here are the source of truth.
//!
//! Rules (PRD › Audio capture › Buffers, REVIEW › A6):
//! * stdout carries protocol messages only; logs go to stderr.
//! * Every event has a `seq` that increases by 1; a gap means the engine's
//!   bounded queue dropped something (only `levels` and stale `hypothesis`
//!   segments may be dropped; anything else is a bug the core logs).
//! * Bulky payloads (word arrays, offline results, embedding batches) go to
//!   files referenced by path inside the session or scratch directory.
//! * Every command has an `id`; the engine answers with `ack` or `error`
//!   carrying the same id, then emits events.
//! * Every path in this protocol is relative to the App Group container
//!   `<TEAMID>.ai.noter` that the app and the sandboxed engine share
//!   (`audio/`, `models/`, `engine-io/` and the capture ring).
//! * The engine keeps the capture ring in a memory-mapped file in that container.
//!   After an engine crash the supervisor restarts it in capture-first mode (taps
//!   before models load) and sends `start_session` with `resume_from_ms`; the
//!   expected gap is at most 2 s and counts as a dropout.
//! * The engine also plays replay audio (D6): it owns the files and is excluded
//!   from the tap; the tap also excludes the app's own process.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::common::{AudioChannel, CallId, Lang, OffsetMs, TimestampMs};

/// Engine protocol version; `ready` reports it and the core refuses a mismatch of the major.
pub const ENGINE_PROTOCOL_VERSION: &str = "2.0";

/// A line from the core to the engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct EngineCommandLine {
    /// Correlation id, unique per engine process.
    pub id: u64,
    pub cmd: EngineCommand,
}

/// A line from the engine to the core.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct EngineEventLine {
    pub seq: u64,
    pub at: TimestampMs,
    pub event: EngineEvent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AsrBackend {
    WhisperTurbo,
    WhisperLargeV3,
    ParakeetTdtV3,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct GlossaryEntry {
    pub term: String,
    pub variants_latin: Vec<String>,
    pub variants_cyrillic: Vec<String>,
    pub spoken_forms: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SpeakerPrior {
    pub label: String,
    /// Share of each language in this speaker's history.
    pub en: f32,
    pub ru: f32,
    pub de: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct StartSession {
    pub call_id: CallId,
    /// `audio/<call_id>/`, relative to the App Group container.
    pub session_dir: String,
    /// `false` = "Never store audio": nothing is written, ASR still runs.
    pub store_audio: bool,
    pub mic_device_uid: Option<String>,
    /// Processes left out of the system tap, besides the engine and the app themselves.
    pub exclude_bundle_ids: Vec<String>,
    pub languages: Vec<Lang>,
    pub backend: AsrBackend,
    pub glossary: Vec<GlossaryEntry>,
    pub speaker_priors: Vec<SpeakerPrior>,
    /// Up to four enrolled attendees switch live diarization to Sortformer.
    pub enrolled_embeddings_path: Option<String>,
    /// Resume from the capture ring's write position after an engine restart in the same call.
    pub resume_from_ms: Option<OffsetMs>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineCommand {
    Ping,
    StartSession(StartSession),
    Pause {
        call_id: CallId,
    },
    Resume {
        call_id: CallId,
    },
    /// Flush, close the files, write `timeline.json`, then `session_stopped`.
    Stop {
        call_id: CallId,
    },
    SetGlossary {
        entries: Vec<GlossaryEntry>,
    },
    SetLanguages {
        languages: Vec<Lang>,
    },
    ExcludeProcess {
        call_id: CallId,
        bundle_id: String,
    },
    /// Offline pass: Large v3 + VBx clustering; constraints from the user's corrections.
    OfflinePass {
        call_id: CallId,
        session_dir: String,
        result_path: String,
        constraints_path: Option<String>,
        backend: AsrBackend,
    },
    /// 256-d WeSpeaker embedding of spans, written to `out_path` (encrypted by the core afterwards).
    SpeakerEmbedding {
        request_id: String,
        call_id: CallId,
        channel: AudioChannel,
        spans: Vec<EngineSpan>,
        out_path: String,
    },
    /// bge-m3 embeddings for chunks; `inline` for one query (search latency), a file otherwise.
    EmbedTexts {
        request_id: String,
        texts: Vec<String>,
        out_path: Option<String>,
    },
    /// Start or stop call detection listeners (off until the self-test passes).
    SetDetection {
        enabled: bool,
        known_bundle_ids: Vec<String>,
    },
    SelfTest {
        play_clip: bool,
        timeout_ms: u32,
    },
    /// Play a span natively (replay); the engine excludes its own process from the tap.
    Play {
        call_id: CallId,
        from_ms: OffsetMs,
        to_ms: Option<OffsetMs>,
        channel: Option<AudioChannel>,
    },
    StopPlayback,
    Shutdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct EngineSpan {
    pub t0_ms: OffsetMs,
    pub t1_ms: OffsetMs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EngineSegmentState {
    Hypothesis,
    Confirmed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct EngineCorrection {
    pub from: String,
    pub to: String,
}

/// The PRD segment schema, as the engine emits it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct EngineSegment {
    /// Engine-local id; the core assigns the `seg_` id when it persists a confirmed segment.
    pub id: String,
    pub call_id: CallId,
    pub channel: AudioChannel,
    pub t0_ms: OffsetMs,
    pub t1_ms: OffsetMs,
    pub state: EngineSegmentState,
    pub lang: Lang,
    pub lang_p: f32,
    /// Provisional live diarization label ("spk_3"); `mic` channel is always "you".
    pub speaker_label: String,
    pub text: String,
    /// Word timings in a file, for confirmed segments.
    pub words_path: Option<String>,
    pub avg_logprob: f32,
    pub no_speech_p: f32,
    pub corrections: Vec<EngineCorrection>,
    /// Overlap detected (offline pass); both candidates.
    pub crosstalk_labels: Vec<String>,
}

/// One word and its time in the call: a word-timings file (`words_path`) holds a list of them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct EngineWord {
    pub t0_ms: OffsetMs,
    pub t1_ms: OffsetMs,
    pub text: String,
    /// Word probability 0..1.
    pub p: f32,
}

/// The archive result file `offline_done` names (`result_path`): the whole call after the
/// offline pass, written completely before the event. Segments are `confirmed`, in call time,
/// on both channels; `speaker_label` is the final cluster label (the `mic` channel keeps the
/// user or guest attribution; empty for a voice with under three seconds of speech in the
/// call, which stays unlabelled), `lang`/`lang_p`/`avg_logprob` are language and confidence,
/// `corrections` the glossary and filter metadata, `crosstalk_labels` both candidates of an
/// overlap, and `words_path` the segment's word timings. The core maps clusters to live labels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ArchiveResult {
    pub call_id: CallId,
    pub backend: AsrBackend,
    pub segments: Vec<EngineSegment>,
}

/// Two spans of call time on the system channel, from one user correction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SpanLink {
    pub a: EngineSpan,
    pub b: EngineSpan,
}

/// The constraints file `offline_pass` names (`constraints_path`), written by the core before
/// the pass: what the user corrected and what the call was configured with. Spans are call ms on
/// the system channel; `must_link` spans are one voice, `cannot_link` spans two different ones;
/// `speaker_names` maps live labels to the names the user gave them (labels sharing a name are
/// one voice). A malformed file refuses the command with a correlated `error`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct OfflineConstraints {
    /// The call's languages: language ID picks among them (empty: any).
    pub languages: Vec<Lang>,
    pub glossary: Vec<GlossaryEntry>,
    pub speaker_priors: Vec<SpeakerPrior>,
    pub must_link: Vec<SpanLink>,
    pub cannot_link: Vec<SpanLink>,
    pub speaker_names: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EngineErrorCode {
    PermissionMissing,
    ZeroBuffers,
    DeviceUnavailable,
    ModelMissing,
    ModelLoadFailed,
    DiskFull,
    BadCommand,
    NoSession,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineEvent {
    Ready {
        protocol_version: String,
        engine_version: String,
        models: Vec<String>,
        sandboxed: bool,
    },
    Ack {
        cmd_id: u64,
    },
    Error {
        cmd_id: Option<u64>,
        code: EngineErrorCode,
        message: String,
    },
    /// A known meeting app or a browser plays audio while holding the microphone.
    CallDetected {
        bundle_id: String,
        app_name: String,
        pid: i32,
    },
    /// The meeting app released audio and the mic (the core applies the 20 s rule).
    CallAudioReleased {
        bundle_id: String,
    },
    /// Another process started playing into the tap.
    AudioSourceAdded {
        call_id: CallId,
        bundle_id: String,
        app_name: String,
    },
    SessionStarted {
        call_id: CallId,
        mic_device: String,
        output_device: String,
    },
    DeviceChanged {
        call_id: CallId,
        device_name: String,
        gap_from_ms: OffsetMs,
        gap_to_ms: OffsetMs,
    },
    /// System audio has been exact digital zeros since `since_ms`. The System Audio Recording
    /// permission cannot be queried, so this is the inference: `confidence` 0..1 that access is off
    /// rather than a silent call.
    SystemAudioSilent {
        call_id: CallId,
        since_ms: OffsetMs,
        confidence: f32,
    },
    Segment {
        segment: EngineSegment,
    },
    SpeakerTurn {
        call_id: CallId,
        channel: AudioChannel,
        speaker_label: String,
        at_ms: OffsetMs,
    },
    /// At most every 100 ms; droppable.
    Levels {
        call_id: Option<CallId>,
        mic_db: f32,
        sys_db: f32,
    },
    /// No segment for N seconds while audio flows (the core decides on "stalled").
    NoSegments {
        call_id: CallId,
        since_ms: OffsetMs,
    },
    /// VAD heard nothing on either channel since this offset.
    Silence {
        call_id: CallId,
        since_ms: OffsetMs,
    },
    SessionStopped {
        call_id: CallId,
        timeline_path: String,
        mic_path: Option<String>,
        sys_path: Option<String>,
    },
    OfflineProgress {
        call_id: CallId,
        progress: f32,
    },
    OfflineDone {
        call_id: CallId,
        result_path: String,
    },
    OfflineFailed {
        call_id: CallId,
        code: EngineErrorCode,
    },
    SpeakerEmbeddingDone {
        request_id: String,
        out_path: String,
    },
    /// One query: inline vector (1024 floats). Batches: `out_path` with float32 little-endian rows.
    Embeddings {
        request_id: String,
        inline: Option<Vec<f32>>,
        out_path: Option<String>,
        count: u32,
    },
    SelfTestStream {
        channel: AudioChannel,
    },
    SelfTestLine {
        channel: AudioChannel,
        text: String,
    },
    /// The self-test passes only with non-zero buffers on both channels.
    SelfTestResult {
        passed: bool,
        failure: Option<EngineErrorCode>,
        own_sounds_leak: bool,
    },
    PlaybackPosition {
        call_id: CallId,
        at_ms: OffsetMs,
        playing: bool,
    },
    Pong,
}
