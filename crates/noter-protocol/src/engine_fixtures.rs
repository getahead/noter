/// One example line per engine command and event. The contract exporter writes them to
/// `engine-lines.json` in the fixtures folder and the engine's Swift tests decode them, so a
/// change to an engine type fails `just contract` until the file is regenerated.
use crate::common::{AudioChannel, CallId, Lang, OffsetMs, TimestampMs};
use crate::engine::*;

fn call() -> CallId {
    CallId::new("call_1")
}

fn glossary() -> GlossaryEntry {
    GlossaryEntry {
        term: "Noter".into(),
        variants_latin: vec!["Notter".into()],
        variants_cyrillic: vec!["Ноутер".into()],
        spoken_forms: vec!["no-ter".into()],
    }
}

/// In declaration order of `EngineCommand`.
pub fn commands() -> Vec<EngineCommandLine> {
    let cmds = vec![
        EngineCommand::Ping,
        EngineCommand::StartSession(StartSession {
            call_id: call(),
            session_dir: "audio/call_1".into(),
            store_audio: true,
            mic_device_uid: Some("BuiltInMicrophoneDevice".into()),
            exclude_bundle_ids: vec!["com.apple.Music".into()],
            languages: vec![Lang::En, Lang::Other { code: "fr".into() }],
            backend: AsrBackend::ParakeetTdtV3,
            glossary: vec![glossary()],
            speaker_priors: vec![SpeakerPrior {
                label: "spk_1".into(),
                en: 0.5,
                ru: 0.25,
                de: 0.25,
            }],
            enrolled_embeddings_path: Some("engine-io/enrolled.f32".into()),
            resume_from_ms: Some(OffsetMs(9_000)),
        }),
        EngineCommand::Pause { call_id: call() },
        EngineCommand::Resume { call_id: call() },
        EngineCommand::Stop { call_id: call() },
        EngineCommand::SetGlossary {
            entries: vec![glossary()],
        },
        EngineCommand::SetLanguages {
            languages: vec![Lang::Ru, Lang::De],
        },
        EngineCommand::ExcludeProcess {
            call_id: call(),
            bundle_id: "us.zoom.xos".into(),
        },
        EngineCommand::OfflinePass {
            call_id: call(),
            session_dir: "audio/call_1".into(),
            result_path: "audio/call_1/offline.json".into(),
            constraints_path: None,
            backend: AsrBackend::WhisperLargeV3,
        },
        EngineCommand::SpeakerEmbedding {
            request_id: "req_1".into(),
            call_id: call(),
            channel: AudioChannel::Sys,
            spans: vec![EngineSpan {
                t0_ms: OffsetMs(1_000),
                t1_ms: OffsetMs(2_500),
            }],
            out_path: "engine-io/emb.f32".into(),
        },
        EngineCommand::EmbedTexts {
            request_id: "req_2".into(),
            texts: vec!["hello".into()],
            out_path: None,
        },
        EngineCommand::SetDetection {
            enabled: true,
            known_bundle_ids: vec!["us.zoom.xos".into()],
        },
        EngineCommand::SelfTest {
            play_clip: false,
            timeout_ms: 10_000,
        },
        EngineCommand::Play {
            call_id: call(),
            from_ms: OffsetMs(0),
            to_ms: Some(OffsetMs(5_000)),
            channel: Some(AudioChannel::Mic),
        },
        EngineCommand::StopPlayback,
        EngineCommand::Shutdown,
    ];
    cmds.into_iter()
        .zip(1..)
        .map(|(cmd, id)| EngineCommandLine { id, cmd })
        .collect()
}

/// In declaration order of `EngineEvent`.
pub fn events() -> Vec<EngineEventLine> {
    let events = vec![
        EngineEvent::Ready {
            protocol_version: ENGINE_PROTOCOL_VERSION.into(),
            engine_version: "0.1.0".into(),
            models: vec!["whisper-turbo".into()],
            sandboxed: true,
        },
        EngineEvent::Ack { cmd_id: 2 },
        EngineEvent::Error {
            cmd_id: None,
            code: EngineErrorCode::DeviceUnavailable,
            message: "mic.wav".into(),
        },
        EngineEvent::CallDetected {
            bundle_id: "us.zoom.xos".into(),
            app_name: "zoom.us".into(),
            pid: 4242,
        },
        EngineEvent::CallAudioReleased {
            bundle_id: "us.zoom.xos".into(),
        },
        EngineEvent::AudioSourceAdded {
            call_id: call(),
            bundle_id: "com.apple.Safari".into(),
            app_name: "Safari".into(),
        },
        EngineEvent::SessionStarted {
            call_id: call(),
            mic_device: "MacBook Microphone".into(),
            output_device: "MacBook Speakers".into(),
        },
        EngineEvent::DeviceChanged {
            call_id: call(),
            device_name: "AirPods".into(),
            gap_from_ms: OffsetMs(100),
            gap_to_ms: OffsetMs(900),
        },
        EngineEvent::SystemAudioSilent {
            call_id: call(),
            since_ms: OffsetMs(3_000),
            confidence: 0.75,
        },
        EngineEvent::Segment {
            segment: EngineSegment {
                id: "eseg_1".into(),
                call_id: call(),
                channel: AudioChannel::Mic,
                t0_ms: OffsetMs(1_000),
                t1_ms: OffsetMs(2_500),
                state: EngineSegmentState::Confirmed,
                lang: Lang::En,
                lang_p: 0.5,
                speaker_label: "you".into(),
                text: "hello".into(),
                words_path: Some("audio/call_1/words/eseg_1.json".into()),
                avg_logprob: -0.25,
                no_speech_p: 0.125,
                corrections: vec![EngineCorrection {
                    from: "notter".into(),
                    to: "Noter".into(),
                }],
                crosstalk_labels: vec!["spk_1".into(), "spk_2".into()],
            },
        },
        EngineEvent::Segment {
            segment: {
                let mut segment = archive_segment("eseg_2", AudioChannel::Sys, 3_000, "spk_1");
                segment.lang = Lang::Other { code: "uk".into() };
                segment
            },
        },
        EngineEvent::SpeakerTurn {
            call_id: call(),
            channel: AudioChannel::Sys,
            speaker_label: "spk_3".into(),
            at_ms: OffsetMs(4_000),
        },
        EngineEvent::Levels {
            call_id: None,
            mic_db: -20.5,
            sys_db: -160.0,
        },
        EngineEvent::NoSegments {
            call_id: call(),
            since_ms: OffsetMs(8_000),
        },
        EngineEvent::Silence {
            call_id: call(),
            since_ms: OffsetMs(12_000),
        },
        EngineEvent::SessionStopped {
            call_id: call(),
            timeline_path: "audio/call_1/timeline.json".into(),
            mic_path: Some("audio/call_1/mic.wav".into()),
            sys_path: None,
        },
        EngineEvent::OfflineProgress {
            call_id: call(),
            progress: 0.5,
        },
        EngineEvent::OfflineDone {
            call_id: call(),
            result_path: "audio/call_1/offline.json".into(),
        },
        EngineEvent::OfflineFailed {
            call_id: call(),
            code: EngineErrorCode::ModelLoadFailed,
        },
        EngineEvent::SpeakerEmbeddingDone {
            request_id: "req_1".into(),
            out_path: "engine-io/emb.f32".into(),
        },
        EngineEvent::Embeddings {
            request_id: "req_2".into(),
            inline: Some(vec![0.5, -0.25]),
            out_path: None,
            count: 1,
        },
        EngineEvent::SelfTestStream {
            channel: AudioChannel::Sys,
        },
        EngineEvent::SelfTestLine {
            channel: AudioChannel::Mic,
            text: "one two three".into(),
        },
        EngineEvent::SelfTestResult {
            passed: false,
            failure: Some(EngineErrorCode::ZeroBuffers),
            own_sounds_leak: false,
        },
        EngineEvent::PlaybackPosition {
            call_id: call(),
            at_ms: OffsetMs(1_500),
            playing: true,
        },
        EngineEvent::Pong,
    ];
    events
        .into_iter()
        .zip(1..)
        .map(|(event, seq)| EngineEventLine {
            seq,
            at: TimestampMs(1_790_000_000_000),
            event,
        })
        .collect()
}

fn archive_segment(id: &str, channel: AudioChannel, t0: u32, label: &str) -> EngineSegment {
    EngineSegment {
        id: id.into(),
        call_id: call(),
        channel,
        t0_ms: OffsetMs(t0),
        t1_ms: OffsetMs(t0 + 1_500),
        state: EngineSegmentState::Confirmed,
        lang: Lang::En,
        lang_p: 0.875,
        speaker_label: label.into(),
        text: "hello".into(),
        words_path: Some(format!("audio/call_1/words/{id}.json")),
        avg_logprob: -0.25,
        no_speech_p: 0.125,
        corrections: Vec::new(),
        crosstalk_labels: Vec::new(),
    }
}

/// Examples of the archive result file `offline_done` names.
pub fn archive_results() -> Vec<ArchiveResult> {
    let mut overlap = archive_segment("aseg_2", AudioChannel::Sys, 2_000, "spk_1");
    overlap.lang = Lang::Other { code: "uk".into() };
    overlap.crosstalk_labels = vec!["spk_1".into(), "spk_2".into()];
    overlap.corrections = vec![EngineCorrection {
        from: "notter".into(),
        to: "Noter".into(),
    }];
    vec![ArchiveResult {
        call_id: call(),
        backend: AsrBackend::WhisperLargeV3,
        segments: vec![
            archive_segment("aseg_1", AudioChannel::Mic, 1_000, "you"),
            overlap,
        ],
    }]
}

/// An example constraints file (`constraints_path`).
pub fn constraints() -> Vec<OfflineConstraints> {
    let span = |t0: u32, t1: u32| EngineSpan {
        t0_ms: OffsetMs(t0),
        t1_ms: OffsetMs(t1),
    };
    vec![OfflineConstraints {
        languages: vec![Lang::En, Lang::Other { code: "fr".into() }],
        glossary: vec![glossary()],
        speaker_priors: vec![SpeakerPrior {
            label: "spk_1".into(),
            en: 0.75,
            ru: 0.25,
            de: 0.0,
        }],
        must_link: vec![SpanLink {
            a: span(1_000, 2_000),
            b: span(5_000, 6_500),
        }],
        cannot_link: vec![SpanLink {
            a: span(1_000, 2_000),
            b: span(9_000, 9_800),
        }],
        speaker_names: [("spk_1".to_string(), "Anna K.".to_string())].into(),
    }]
}

/// An example word-timings file (`words_path`).
pub fn words() -> Vec<EngineWord> {
    vec![EngineWord {
        t0_ms: OffsetMs(1_000),
        t1_ms: OffsetMs(1_400),
        text: "hello".into(),
        p: 0.75,
    }]
}
