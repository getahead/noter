//! The supervisor's capture session (engine-capture §4), the capture-first restart
//! (`cpt-noter-flow-core-engine-capture-recover`, the Q7 kill drill) and the translation of
//! engine facts into degraded states (`cpt-noter-algo-core-engine-capture-degraded`), on the
//! scripted engine with paused tokio time.

use std::time::Duration;

use noter_engine_client::scripted::{Behaviour, Script, ScriptedEngine};
use noter_engine_client::{CaptureFact, Config, Degraded, EngineClient, EngineSession};
use noter_protocol::engine::{
    AsrBackend, EngineCommand, EngineErrorCode, EngineEvent, EngineSegment, EngineSegmentState,
    GlossaryEntry, SpeakerPrior, StartSession,
};
use noter_protocol::model::{GapReason, GapView};
use noter_protocol::{AudioChannel, CallId, Lang, OffsetMs};
use tokio::sync::broadcast::Receiver;

/// The engine opens its taps this long after `start_session` (each start, restarts too).
const TAPS_OPEN_MS: u64 = 300;

fn call() -> CallId {
    CallId::new("call_1")
}

fn script() -> Script {
    Script::parse(&format!(
        r#"{{"on": "start_session", "after_ms": {TAPS_OPEN_MS}, "event": {{"type": "session_started", "call_id": "call_1", "mic_device": "mic", "output_device": "out"}}}}
{{"on": "stop", "after_ms": 100, "event": {{"type": "session_stopped", "call_id": "call_1", "timeline_path": "audio/call_1/timeline.json", "mic_path": null, "sys_path": null}}}}"#
    ))
    .unwrap()
}

fn start() -> StartSession {
    StartSession {
        call_id: call(),
        session_dir: "audio/call_1".into(),
        store_audio: true,
        mic_device_uid: None,
        exclude_bundle_ids: vec![],
        languages: vec![],
        backend: AsrBackend::WhisperTurbo,
        glossary: vec![],
        speaker_priors: vec![],
        enrolled_embeddings_path: None,
        resume_from_ms: None,
    }
}

fn client(engine: &ScriptedEngine) -> EngineClient<ScriptedEngine> {
    EngineClient::new(engine.clone(), Config::default())
}

async fn ms(n: u64) {
    tokio::time::sleep(Duration::from_millis(n)).await;
}

/// Starts a session and waits until it captures: returns 1 ms into the call.
async fn capturing(c: &EngineClient<ScriptedEngine>) {
    c.start_session(start()).await.unwrap();
    assert_eq!(c.session(), EngineSession::Starting);
    ms(TAPS_OPEN_MS + 1).await;
    assert_eq!(c.session(), EngineSession::Capturing);
}

/// Kills the engine 1 ms after its last levels, as a real engine dies between two of them.
async fn kill(engine: &ScriptedEngine) {
    assert!(engine.inject(levels(-30.0, -30.0)));
    ms(1).await;
    engine.kill_current();
}

fn levels(mic_db: f32, sys_db: f32) -> EngineEvent {
    EngineEvent::Levels {
        call_id: Some(call()),
        mic_db,
        sys_db,
    }
}

fn starts(engine: &ScriptedEngine) -> Vec<StartSession> {
    engine
        .commands()
        .into_iter()
        .filter_map(|c| match c {
            EngineCommand::StartSession(s) => Some(s),
            _ => None,
        })
        .collect()
}

fn gap(t0: u32, t1: u32, reason: GapReason) -> CaptureFact {
    CaptureFact::Gap(GapView {
        call_id: call(),
        t0_ms: OffsetMs(t0),
        t1_ms: OffsetMs(t1),
        reason,
    })
}

fn raised(state: Degraded, since: u32) -> CaptureFact {
    CaptureFact::Degraded {
        call_id: call(),
        state,
        since_ms: OffsetMs(since),
    }
}

fn cleared(state: Degraded) -> CaptureFact {
    CaptureFact::Cleared {
        call_id: call(),
        state,
    }
}

fn drain(facts: &mut Receiver<CaptureFact>) -> Vec<CaptureFact> {
    std::iter::from_fn(|| facts.try_recv().ok()).collect()
}

#[tokio::test(start_paused = true)]
async fn the_session_moves_through_its_states_with_the_engine() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    assert_eq!(c.session(), EngineSession::Idle);
    capturing(&c).await;
    c.pause_session().await.unwrap();
    assert_eq!(c.session(), EngineSession::Paused);
    c.resume_session().await.unwrap();
    assert_eq!(c.session(), EngineSession::Capturing);
    c.stop_session().await.unwrap();
    assert_eq!(c.session(), EngineSession::Stopping);
    ms(101).await;
    assert_eq!(c.session(), EngineSession::Stopped);
    let sent: Vec<_> = engine
        .commands()
        .into_iter()
        .filter(|c| !matches!(c, EngineCommand::SetDetection { .. }))
        .collect();
    assert_eq!(
        sent,
        vec![
            EngineCommand::StartSession(start()),
            EngineCommand::Pause { call_id: call() },
            EngineCommand::Resume { call_id: call() },
            EngineCommand::Stop { call_id: call() },
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn start_session_sends_the_engine_everything_the_session_manager_gave() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    let full = StartSession {
        store_audio: false,
        mic_device_uid: Some("BuiltInMicrophoneDevice".into()),
        exclude_bundle_ids: vec!["com.apple.Music".into()],
        languages: vec![Lang::En, Lang::Ru, Lang::De],
        glossary: vec![GlossaryEntry {
            term: "Noter".into(),
            variants_latin: vec!["Notter".into()],
            variants_cyrillic: vec!["Ноутер".into()],
            spoken_forms: vec!["no-ter".into()],
        }],
        speaker_priors: vec![SpeakerPrior {
            label: "spk_1".into(),
            en: 0.5,
            ru: 0.25,
            de: 0.25,
        }],
        ..start()
    };
    c.start_session(full.clone()).await.unwrap();
    assert_eq!(starts(&engine), vec![full]);
    assert_eq!(c.session(), EngineSession::Starting);
}

#[tokio::test(start_paused = true)]
async fn session_commands_without_a_session_are_unavailable() {
    let c = client(&ScriptedEngine::new().with_script(script()));
    assert!(c.pause_session().await.is_err());
    assert!(c.stop_session().await.is_err());
    assert!(c.try_again().await.is_err());
}

// The Q7 drill on the scripted engine: a kill during capture costs one gap of at most 2 s.
#[tokio::test(start_paused = true)]
async fn q7_drill_a_killed_engine_resumes_the_same_call_with_one_short_gap() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    let mut facts = c.capture_facts();
    capturing(&c).await;
    ms(9000).await;
    kill(&engine).await;
    ms(1).await;
    assert_eq!(c.session(), EngineSession::Restarting);
    ms(2000).await;
    assert_eq!(c.session(), EngineSession::Capturing);
    assert_eq!(engine.launches(), 2);
    let resumed = &starts(&engine)[1];
    assert_eq!(resumed.call_id, call());
    assert_eq!(resumed.resume_from_ms, Some(OffsetMs(9001)));
    let facts = drain(&mut facts);
    assert_eq!(facts.len(), 1, "{facts:?}");
    let CaptureFact::Gap(g) = &facts[0] else {
        panic!("{facts:?}")
    };
    assert_eq!(
        (g.reason, g.t0_ms),
        (GapReason::EngineRestart, OffsetMs(9001))
    );
    assert!(g.t1_ms.0 - g.t0_ms.0 <= 2000, "{g:?}");
}

#[tokio::test(start_paused = true)]
async fn a_paused_session_is_paused_again_after_the_restart() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    capturing(&c).await;
    c.pause_session().await.unwrap();
    engine.kill_current();
    ms(2000).await;
    assert_eq!(c.session(), EngineSession::Paused);
    assert_eq!(
        engine.commands().last(),
        Some(&EngineCommand::Pause { call_id: call() })
    );
}

#[tokio::test(start_paused = true)]
async fn a_crash_before_the_taps_open_starts_the_session_again_without_a_gap() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    let mut facts = c.capture_facts();
    c.start_session(start()).await.unwrap();
    engine.kill_current();
    ms(2000).await;
    assert_eq!(c.session(), EngineSession::Capturing);
    assert_eq!(starts(&engine)[1], start());
    assert_eq!(drain(&mut facts), vec![]);
}

#[tokio::test(start_paused = true)]
async fn three_kills_within_30_s_fail_the_capture_and_try_again_resumes_it() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    let mut facts = c.capture_facts();
    capturing(&c).await;
    for _ in 0..2 {
        ms(5000).await;
        kill(&engine).await;
        ms(1000).await;
        assert_eq!(c.session(), EngineSession::Capturing);
    }
    let last_resume = starts(&engine).last().unwrap().resume_from_ms.unwrap().0;
    drain(&mut facts);
    ms(5000).await;
    kill(&engine).await;
    ms(1000).await;
    assert_eq!(c.session(), EngineSession::Failed);
    assert_eq!(engine.launches(), 3, "no fourth engine");
    assert_eq!(
        drain(&mut facts),
        vec![raised(Degraded::CaptureFailed, last_resume + 6000)]
    );

    c.try_again().await.unwrap();
    ms(TAPS_OPEN_MS + 1).await;
    assert_eq!(c.session(), EngineSession::Capturing);
    assert_eq!(
        drain(&mut facts),
        vec![
            cleared(Degraded::CaptureFailed),
            gap(
                last_resume + 6000,
                last_resume + 7300,
                GapReason::EngineRestart,
            )
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn kills_further_apart_than_30_s_each_recover() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    capturing(&c).await;
    for _ in 0..4 {
        ms(16_000).await;
        engine.kill_current();
        ms(1000).await;
        assert_eq!(c.session(), EngineSession::Capturing);
    }
}

#[tokio::test(start_paused = true)]
async fn restarts_that_fail_to_launch_count_toward_the_capture_failure() {
    let engine = ScriptedEngine::new()
        .with_script(script())
        .then(Behaviour::default())
        .then(Behaviour {
            launch_fails: true,
            ..Behaviour::default()
        })
        .then(Behaviour {
            launch_fails: true,
            ..Behaviour::default()
        });
    let c = client(&engine);
    capturing(&c).await;
    engine.kill_current();
    ms(1000).await;
    assert_eq!(c.session(), EngineSession::Failed);
    assert_eq!(engine.launches(), 3);
}

#[tokio::test(start_paused = true)]
async fn an_idle_engine_keeps_the_idle_restart_rule() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    c.ensure_ready().await.unwrap();
    engine.kill_current();
    ms(499).await;
    assert_eq!(engine.launches(), 1, "the idle rule waits its back-off");
    ms(2).await;
    assert_eq!(engine.launches(), 2);
    assert_eq!(c.session(), EngineSession::Idle);
}

#[tokio::test(start_paused = true)]
async fn ten_seconds_without_segments_while_audio_flows_is_a_stall_with_a_gap() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    let mut facts = c.capture_facts();
    capturing(&c).await;
    ms(2000).await;
    engine.inject(EngineEvent::NoSegments {
        call_id: call(),
        since_ms: OffsetMs(1000),
    });
    ms(8000).await;
    engine.inject(levels(-30.0, -30.0)); // 9 s without segments
    ms(1000).await;
    engine.inject(levels(-120.0, -120.0)); // 10 s, but no audio
    ms(1).await;
    assert_eq!(drain(&mut facts), vec![]);
    engine.inject(levels(-30.0, -120.0));
    ms(1).await;
    assert_eq!(
        drain(&mut facts),
        vec![raised(Degraded::TranscriptionStalled, 1000)]
    );
    ms(1998).await;
    engine.inject(EngineEvent::Segment {
        segment: EngineSegment {
            id: "s1".into(),
            call_id: call(),
            channel: AudioChannel::Mic,
            t0_ms: OffsetMs(12_000),
            t1_ms: OffsetMs(12_500),
            state: EngineSegmentState::Confirmed,
            lang: Lang::En,
            lang_p: 0.9,
            speaker_label: "you".into(),
            text: "back".into(),
            words_path: None,
            avg_logprob: -0.2,
            no_speech_p: 0.0,
            corrections: vec![],
            crosstalk_labels: vec![],
        },
    });
    ms(1).await;
    assert_eq!(
        drain(&mut facts),
        vec![
            cleared(Degraded::TranscriptionStalled),
            gap(1000, 12_000, GapReason::Stalled)
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn silent_system_audio_and_a_lost_microphone_come_and_go_with_the_levels() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    let mut facts = c.capture_facts();
    capturing(&c).await;
    let silent = Degraded::SystemAudioSilent { confidence: 0.8 };
    engine.inject(EngineEvent::SystemAudioSilent {
        call_id: call(),
        since_ms: OffsetMs(0),
        confidence: 0.8,
    });
    engine.inject(EngineEvent::Error {
        cmd_id: None,
        code: EngineErrorCode::DeviceUnavailable,
        message: "microphone".into(),
    });
    ms(1).await;
    assert_eq!(
        drain(&mut facts),
        vec![
            raised(silent.clone(), 0),
            raised(Degraded::MicrophoneOff, 1)
        ]
    );
    engine.inject(levels(-120.0, -40.0));
    ms(1).await;
    assert_eq!(
        drain(&mut facts),
        vec![cleared(silent)],
        "the mic is still zeros"
    );
    engine.inject(levels(-40.0, -40.0));
    ms(1000).await;
    assert_eq!(drain(&mut facts), vec![cleared(Degraded::MicrophoneOff)]);
    // A microphone of exact zeros while the other side speaks is off, too.
    engine.inject(levels(-120.0, -30.0));
    ms(1).await;
    assert_eq!(
        drain(&mut facts),
        vec![raised(Degraded::MicrophoneOff, 1003)]
    );
}

#[tokio::test(start_paused = true)]
async fn a_device_change_is_a_state_and_a_gap_and_stopping_clears_every_state() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    let mut facts = c.capture_facts();
    capturing(&c).await;
    ms(5000).await;
    engine.inject(EngineEvent::DeviceChanged {
        call_id: call(),
        device_name: "AirPods".into(),
        gap_from_ms: OffsetMs(4800),
        gap_to_ms: OffsetMs(5000),
    });
    ms(1).await;
    let changed = Degraded::DeviceChanged {
        device_name: "AirPods".into(),
        gap_ms: 200,
    };
    assert_eq!(
        drain(&mut facts),
        vec![
            raised(changed.clone(), 4800),
            gap(4800, 5000, GapReason::DeviceChanged)
        ]
    );
    c.stop_session().await.unwrap();
    ms(101).await;
    assert_eq!(drain(&mut facts), vec![cleared(changed)]);
}

#[tokio::test(start_paused = true)]
async fn supervisor_fact_offsets_include_the_resumed_call_base_and_exclude_pause_time() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    let mut facts = c.capture_facts();
    let mut resumed = start();
    resumed.resume_from_ms = Some(OffsetMs(10_000));
    c.start_session(resumed).await.unwrap();
    ms(TAPS_OPEN_MS + 1).await;
    ms(2000).await;
    c.pause_session().await.unwrap();
    ms(5000).await;
    c.resume_session().await.unwrap();
    ms(1000).await;
    engine.inject(levels(-120.0, -30.0));
    ms(1).await;

    assert_eq!(
        drain(&mut facts),
        vec![raised(Degraded::MicrophoneOff, 13_001)]
    );
}

#[tokio::test(start_paused = true)]
async fn supervisor_facts_stay_call_relative_after_an_engine_restart() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    let mut facts = c.capture_facts();
    capturing(&c).await;
    ms(2000).await;
    engine.kill_current();
    ms(1).await;
    for _ in 0..100 {
        if starts(&engine).len() == 2 {
            break;
        }
        ms(1).await;
    }
    let resumed_from = starts(&engine)[1].resume_from_ms.unwrap().0;
    engine.inject(EngineEvent::SessionStarted {
        call_id: call(),
        mic_device: "mic".into(),
        output_device: "out".into(),
    });
    ms(1).await;
    drain(&mut facts);
    ms(1000).await;
    engine.inject(levels(-120.0, -30.0));
    ms(1).await;

    let observed = drain(&mut facts);
    let [CaptureFact::Degraded {
        since_ms, state, ..
    }] = observed.as_slice()
    else {
        panic!("unexpected facts after restart: {observed:?}");
    };
    assert_eq!(*state, Degraded::MicrophoneOff);
    assert!((resumed_from + 1000..=resumed_from + 1100).contains(&since_ms.0));
}

#[tokio::test(start_paused = true)]
async fn a_session_whose_engine_cannot_launch_is_refused_and_leaves_no_session() {
    let engine = ScriptedEngine::new().with_default(Behaviour {
        launch_fails: true,
        ..Behaviour::default()
    });
    let c = client(&engine);
    assert!(c.start_session(start()).await.is_err());
    assert_eq!(c.session(), EngineSession::Idle);
}

#[tokio::test(start_paused = true)]
async fn pause_and_resume_only_follow_the_state_machine() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    c.start_session(start()).await.unwrap();
    assert!(c.pause_session().await.is_err(), "not capturing yet");
    assert!(c.start_session(start()).await.is_err(), "a session runs");
    ms(TAPS_OPEN_MS + 1).await;
    assert!(c.resume_session().await.is_err(), "not paused");
    engine.kill_current();
    ms(1).await;
    assert_eq!(c.session(), EngineSession::Restarting);
    assert!(
        c.pause_session().await.is_ok(),
        "preserve pause during restart"
    );
    assert!(!engine.commands().iter().any(|c| matches!(
        c,
        EngineCommand::Pause { .. } | EngineCommand::Resume { .. }
    )));
    ms(TAPS_OPEN_MS + 1).await;
    assert_eq!(c.session(), EngineSession::Paused);
    assert!(
        engine
            .commands()
            .iter()
            .any(|c| matches!(c, EngineCommand::Pause { .. })),
        "{:?}",
        engine.commands()
    );
}

#[tokio::test(start_paused = true)]
async fn stop_during_restart_prevents_the_engine_session_from_resuming() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    capturing(&c).await;
    engine.kill_current();
    ms(1).await;
    assert_eq!(c.session(), EngineSession::Restarting);

    assert!(c.stop_session().await.is_ok());
    assert_eq!(c.session(), EngineSession::Stopped);
    ms(TAPS_OPEN_MS + 1).await;
    for _ in 0..100 {
        if engine
            .commands()
            .iter()
            .any(|c| matches!(c, EngineCommand::Stop { .. }))
        {
            break;
        }
        ms(1).await;
    }
    assert_eq!(c.session(), EngineSession::Stopped);
    assert!(
        engine
            .commands()
            .iter()
            .any(|c| matches!(c, EngineCommand::Stop { .. })),
        "a session started during the stop race must be stopped: {:?}",
        engine.commands()
    );
    let commands = engine.commands();
    let stop = commands
        .iter()
        .position(|command| matches!(command, EngineCommand::Stop { .. }))
        .unwrap();
    assert!(
        !commands[stop + 1..]
            .iter()
            .any(|command| matches!(command, EngineCommand::StartSession(_))),
        "a restart must not start a session after Stop: {commands:?}"
    );
    assert_eq!(
        commands
            .iter()
            .filter(|command| matches!(command, EngineCommand::Stop { .. }))
            .count(),
        1,
        "stopping a restart should send one stop command: {commands:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn an_error_reply_to_restart_start_session_counts_toward_capture_failure() {
    let engine = ScriptedEngine::new()
        .with_script(script())
        .then(Behaviour::default())
        .then(Behaviour {
            reject: true,
            ..Behaviour::default()
        });
    let c = client(&engine);
    let mut facts = c.capture_facts();
    capturing(&c).await;
    engine.kill_current();
    ms(1).await;
    assert_eq!(c.session(), EngineSession::Failed);
    assert!(drain(&mut facts).contains(&raised(Degraded::CaptureFailed, 0)));
}

#[tokio::test(start_paused = true)]
async fn a_stopped_session_hears_no_more_facts() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    let mut facts = c.capture_facts();
    capturing(&c).await;
    c.stop_session().await.unwrap();
    ms(101).await;
    engine.inject(levels(-120.0, -30.0));
    ms(1).await;
    assert_eq!(drain(&mut facts), vec![]);
}

#[tokio::test(start_paused = true)]
async fn an_engine_dying_while_stopping_ends_the_session_and_clears_its_states() {
    let engine = ScriptedEngine::new().with_script(script());
    let c = client(&engine);
    let mut facts = c.capture_facts();
    capturing(&c).await;
    engine.inject(levels(-120.0, -30.0));
    ms(1).await;
    drain(&mut facts);
    c.stop_session().await.unwrap();
    engine.kill_current();
    ms(1).await;
    assert_eq!(c.session(), EngineSession::Stopped);
    assert_eq!(drain(&mut facts), vec![cleared(Degraded::MicrophoneOff)]);
}
