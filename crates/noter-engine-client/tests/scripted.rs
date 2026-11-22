//! The scripted engine's self-test as the M0 stories need it: paced on tokio time, with line
//! events, a scripted stream (`inject`), and system audio following a permission state.

use std::time::Duration;

use noter_engine_client::scripted::{Behaviour, Script, ScriptedEngine};
use noter_engine_client::{Config, EngineClient};
use noter_protocol::engine::{
    AsrBackend, EngineCommand, EngineErrorCode, EngineEvent, StartSession,
};
use noter_protocol::{AudioChannel, CallId, PermissionState};
use tokio::time::Instant;

fn client(engine: &ScriptedEngine) -> EngineClient<ScriptedEngine> {
    EngineClient::new(engine.clone(), Config::default())
}

const SELF_TEST: EngineCommand = EngineCommand::SelfTest {
    play_clip: false,
    timeout_ms: 10_000,
};

async fn until_result(
    events: &mut tokio::sync::broadcast::Receiver<noter_protocol::engine::EngineEventLine>,
) -> Vec<EngineEvent> {
    let mut got = vec![];
    loop {
        let event = events.recv().await.unwrap().event;
        let done = matches!(event, EngineEvent::SelfTestResult { .. });
        got.push(event);
        if done {
            return got;
        }
    }
}

#[tokio::test(start_paused = true)]
async fn a_paced_self_test_takes_its_time_and_says_a_line_per_stream() {
    let engine = ScriptedEngine::new().with_default(Behaviour {
        self_test_pace_ms: 400,
        self_test_line: Some("hello".into()),
        ..Behaviour::default()
    });
    let c = client(&engine);
    let mut events = c.events();
    c.ensure_ready().await.unwrap();
    let start = Instant::now();
    c.command(SELF_TEST).await.unwrap();
    let got: Vec<_> = until_result(&mut events)
        .await
        .into_iter()
        .filter(|e| !matches!(e, EngineEvent::Ack { .. } | EngineEvent::Levels { .. }))
        .collect();
    assert_eq!(start.elapsed(), Duration::from_millis(5 * 400));
    let line = |channel| EngineEvent::SelfTestLine {
        channel,
        text: "hello".into(),
    };
    let stream = |channel| EngineEvent::SelfTestStream { channel };
    assert_eq!(
        got[..4].to_vec(),
        vec![
            stream(AudioChannel::Mic),
            line(AudioChannel::Mic),
            stream(AudioChannel::Sys),
            line(AudioChannel::Sys),
        ]
    );
    assert!(matches!(
        got[4],
        EngineEvent::SelfTestResult { passed: true, .. }
    ));
}

#[tokio::test(start_paused = true)]
async fn inject_sends_an_event_on_the_running_engine_only() {
    let engine = ScriptedEngine::new();
    let event = EngineEvent::Levels {
        call_id: None,
        mic_db: -30.0,
        sys_db: -40.0,
    };
    assert!(!engine.inject(event.clone()), "no engine runs yet");
    let c = client(&engine);
    let mut events = c.events();
    c.ensure_ready().await.unwrap();
    assert!(engine.inject(event.clone()));
    loop {
        if events.recv().await.unwrap().event == event {
            break;
        }
    }
}

#[tokio::test(start_paused = true)]
async fn an_injected_event_lands_between_the_events_of_a_paced_self_test() {
    let engine = ScriptedEngine::new().with_default(Behaviour {
        self_test_pace_ms: 400,
        ..Behaviour::default()
    });
    let c = client(&engine);
    let mut events = c.events();
    c.ensure_ready().await.unwrap();
    c.command(SELF_TEST).await.unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    let levels = EngineEvent::Levels {
        call_id: None,
        mic_db: -30.0,
        sys_db: -40.0,
    };
    assert!(engine.inject(levels.clone()));
    let got = until_result(&mut events).await;
    let pong = got.iter().position(|e| *e == levels).unwrap();
    let result = got.len() - 1;
    assert!(pong < result, "the self-test was still running: {got:?}");
}

#[tokio::test(start_paused = true)]
async fn a_held_self_test_waits_for_injection_and_only_holds_one_run() {
    let engine = ScriptedEngine::new().with_default(Behaviour {
        self_test_pace_ms: 400,
        ..Behaviour::default()
    });
    let c = client(&engine);
    let mut events = c.events();
    c.command(SELF_TEST).await.unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    engine.hold_next_self_test();
    assert!(
        !engine.inject(EngineEvent::SelfTestStream {
            channel: AudioChannel::Mic,
        }),
        "injection waits until the held self-test command reaches the engine"
    );
    c.command(SELF_TEST).await.unwrap();
    while events.try_recv().is_ok() {}

    tokio::time::advance(Duration::from_secs(3)).await;
    c.ping().await.unwrap();
    while let Ok(line) = events.try_recv() {
        assert!(
            !matches!(
                line.event,
                EngineEvent::SelfTestStream { .. }
                    | EngineEvent::SelfTestLine { .. }
                    | EngineEvent::SelfTestResult { .. }
                    | EngineEvent::Levels { .. }
            ),
            "the held run must not emit automatic events: {:?}",
            line.event
        );
    }
    let result = EngineEvent::SelfTestResult {
        passed: false,
        failure: Some(EngineErrorCode::ZeroBuffers),
        own_sounds_leak: false,
    };
    let stream = EngineEvent::SelfTestStream {
        channel: AudioChannel::Mic,
    };
    assert!(engine.inject(stream.clone()));
    assert!(engine.inject(result.clone()));
    let got = until_result(&mut events).await;
    assert!(got.contains(&stream));
    assert_eq!(got.last(), Some(&result));

    c.command(SELF_TEST).await.unwrap();
    assert!(matches!(
        until_result(&mut events).await.last(),
        Some(EngineEvent::SelfTestResult { passed: true, .. })
    ));
}

#[tokio::test(start_paused = true)]
async fn system_audio_follows_the_permission_state_the_world_gives() {
    let engine = ScriptedEngine::new();
    let c = client(&engine);
    let mut events = c.events();
    for (state, failure, streams) in [
        (PermissionState::Granted, None, 2),
        (
            PermissionState::Denied,
            Some(EngineErrorCode::ZeroBuffers),
            1,
        ),
        (
            PermissionState::NotAsked,
            Some(EngineErrorCode::DeviceUnavailable),
            1,
        ),
    ] {
        engine.set_system_audio(state);
        c.command(SELF_TEST).await.unwrap();
        let got = until_result(&mut events).await;
        let arrived = got
            .iter()
            .filter(|e| matches!(e, EngineEvent::SelfTestStream { .. }))
            .count();
        assert_eq!(arrived, streams, "{state:?}");
        assert_eq!(
            got.last(),
            Some(&EngineEvent::SelfTestResult {
                passed: failure.is_none(),
                failure,
                own_sounds_leak: false
            }),
            "{state:?}"
        );
    }
}

// cpt-noter-algo-core-harness-scripted-engine: default capture answers own their recording files.
#[tokio::test]
async fn default_capture_answers_start_and_stop_the_session() {
    let dir = tempfile::tempdir().unwrap();
    let engine = ScriptedEngine::new()
        .with_default(Behaviour {
            answer_capture_sessions: true,
            ..Behaviour::default()
        })
        .with_container(dir.path());
    let c = client(&engine);
    let mut events = c.events();
    for (name, store_audio) in [("call-recorded", true), ("call-private", false)] {
        let call_id = CallId::new(name);
        let session_dir = format!("audio/{name}");
        c.command(EngineCommand::StartSession(StartSession {
            call_id: call_id.clone(),
            session_dir: session_dir.clone(),
            store_audio,
            mic_device_uid: None,
            exclude_bundle_ids: vec![],
            languages: vec![],
            backend: AsrBackend::ParakeetTdtV3,
            glossary: vec![],
            speaker_priors: vec![],
            enrolled_embeddings_path: None,
            resume_from_ms: None,
        }))
        .await
        .unwrap();
        let started = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if let EngineEvent::SessionStarted {
                    call_id: started_call,
                    ..
                } = events.recv().await.unwrap().event
                {
                    break started_call;
                }
            }
        })
        .await
        .expect("start emits session_started");
        assert_eq!(started, call_id);

        c.command(EngineCommand::Stop {
            call_id: call_id.clone(),
        })
        .await
        .unwrap();
        let stopped = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let event = events.recv().await.unwrap().event;
                if let EngineEvent::SessionStopped {
                    call_id: stopped_call,
                    ..
                } = event
                {
                    break stopped_call;
                }
            }
        })
        .await
        .expect("stop emits session_stopped");
        assert_eq!(stopped, call_id);

        let recording = dir.path().join(session_dir);
        assert_eq!(recording.join("mic.m4a").is_file(), store_audio);
        assert_eq!(recording.join("sys.m4a").is_file(), store_audio);
        assert!(recording.join("timeline.json").is_file());
    }
}

// cpt-noter-algo-core-harness-scripted-engine: a command's scripted side events keep their timing.
#[tokio::test]
async fn default_session_answer_runs_alongside_scripted_side_events() {
    let script = Script::parse(
        r#"{"on":"start_session","after_ms":10000,"event":{"type":"levels","call_id":"call-scripted","mic_db":-30.0,"sys_db":-30.0}}"#,
    )
    .unwrap();
    let engine = ScriptedEngine::new()
        .with_default(Behaviour {
            answer_capture_sessions: true,
            ..Behaviour::default()
        })
        .with_script(script);
    let c = client(&engine);
    let mut events = c.events();
    let call_id = CallId::new("call-scripted");
    c.command(EngineCommand::StartSession(StartSession {
        call_id: call_id.clone(),
        session_dir: "audio/call-scripted".into(),
        store_audio: false,
        mic_device_uid: None,
        exclude_bundle_ids: vec![],
        languages: vec![],
        backend: AsrBackend::ParakeetTdtV3,
        glossary: vec![],
        speaker_priors: vec![],
        enrolled_embeddings_path: None,
        resume_from_ms: None,
    }))
    .await
    .unwrap();
    let started = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if let EngineEvent::SessionStarted {
                call_id: started_call,
                ..
            } = events.recv().await.unwrap().event
            {
                break started_call;
            }
        }
    })
    .await
    .expect("the engine answers the session while its script is active");
    assert_eq!(started, call_id);
}

// cpt-noter-algo-core-harness-scripted-engine: scripted session events bind to the live command id.
#[tokio::test]
async fn scripted_start_answer_uses_the_command_call_id() {
    let script = Script::parse(
        r#"{"on":"start_session","after_ms":0,"event":{"type":"session_started","call_id":"placeholder","mic_device":"Fixture Mic","output_device":"Fixture Speakers"}}"#,
    )
    .unwrap();
    let engine = ScriptedEngine::new()
        .with_default(Behaviour {
            answer_capture_sessions: true,
            ..Behaviour::default()
        })
        .with_script(script);
    let c = client(&engine);
    let mut events = c.events();
    let call_id = CallId::new("actual-call");
    c.command(EngineCommand::StartSession(StartSession {
        call_id: call_id.clone(),
        session_dir: "audio/actual-call".into(),
        store_audio: false,
        mic_device_uid: None,
        exclude_bundle_ids: vec![],
        languages: vec![],
        backend: AsrBackend::ParakeetTdtV3,
        glossary: vec![],
        speaker_priors: vec![],
        enrolled_embeddings_path: None,
        resume_from_ms: None,
    }))
    .await
    .unwrap();
    let (started, mic, output) = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if let EngineEvent::SessionStarted {
                call_id,
                mic_device,
                output_device,
            } = events.recv().await.unwrap().event
            {
                break (call_id, mic_device, output_device);
            }
        }
    })
    .await
    .expect("scripted answer is emitted");
    assert_eq!(started, call_id);
    assert_eq!(mic, "Fixture Mic");
    assert_eq!(output, "Fixture Speakers");
}

// cpt-noter-algo-core-harness-scripted-engine: an explicit stop answer keeps its paths and binds its id.
#[tokio::test]
async fn scripted_stop_answer_uses_the_command_call_id() {
    let script = Script::parse(
        r#"{"on":"stop","after_ms":0,"event":{"type":"session_stopped","call_id":"placeholder","timeline_path":"fixture/timeline.json","mic_path":"fixture/mic.m4a","sys_path":"fixture/sys.m4a"}}"#,
    )
    .unwrap();
    let engine = ScriptedEngine::new()
        .with_default(Behaviour {
            answer_capture_sessions: true,
            ..Behaviour::default()
        })
        .with_script(script);
    let c = client(&engine);
    let mut events = c.events();
    let call_id = CallId::new("actual-call");
    c.command(EngineCommand::Stop {
        call_id: call_id.clone(),
    })
    .await
    .unwrap();
    let stopped = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if let EngineEvent::SessionStopped {
                call_id,
                timeline_path,
                mic_path,
                sys_path,
            } = events.recv().await.unwrap().event
            {
                break (call_id, timeline_path, mic_path, sys_path);
            }
        }
    })
    .await
    .expect("scripted stop answer is emitted");
    assert_eq!(stopped.0, call_id);
    assert_eq!(stopped.1, "fixture/timeline.json");
    assert_eq!(stopped.2.as_deref(), Some("fixture/mic.m4a"));
    assert_eq!(stopped.3.as_deref(), Some("fixture/sys.m4a"));
}

#[tokio::test(start_paused = true)]
async fn a_new_self_test_cancels_what_is_left_of_the_previous_one() {
    let engine = ScriptedEngine::new().with_default(Behaviour {
        self_test_pace_ms: 400,
        ..Behaviour::default()
    });
    let c = client(&engine);
    let mut events = c.events();
    c.command(SELF_TEST).await.unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await; // the first test's mic stream is out
    c.command(SELF_TEST).await.unwrap();
    let got = until_result(&mut events).await;
    let streams = got
        .iter()
        .filter(|e| matches!(e, EngineEvent::SelfTestStream { .. }))
        .count();
    // one stream from the cancelled test, then the whole second test
    assert_eq!(streams, 3, "{got:?}");
    assert_eq!(
        got.iter()
            .filter(|e| matches!(e, EngineEvent::SelfTestResult { .. }))
            .count(),
        1
    );
}

#[tokio::test(start_paused = true)]
async fn a_paced_self_test_sends_levels_at_most_every_100_ms() {
    let engine = ScriptedEngine::new().with_default(Behaviour {
        self_test_pace_ms: 300,
        ..Behaviour::default()
    });
    let c = client(&engine);
    let mut events = c.events();
    c.ensure_ready().await.unwrap();
    c.command(SELF_TEST).await.unwrap();
    let mut at = vec![];
    loop {
        let event = events.recv().await.unwrap().event;
        match event {
            EngineEvent::Levels { .. } => at.push(Instant::now()),
            EngineEvent::SelfTestResult { .. } => break,
            _ => {}
        }
    }
    assert_eq!(
        at.len(),
        8,
        "a level every 100 ms of the 900 ms test, none at its end"
    );
    for pair in at.windows(2) {
        assert!(pair[1] - pair[0] >= Duration::from_millis(100));
    }
}

#[tokio::test(start_paused = true)]
async fn an_unpaced_self_test_sends_no_levels() {
    let engine = ScriptedEngine::new();
    let c = client(&engine);
    let mut events = c.events();
    c.command(SELF_TEST).await.unwrap();
    let got = until_result(&mut events).await;
    assert!(!got.iter().any(|e| matches!(e, EngineEvent::Levels { .. })));
}

/// #1167: the first Record shows macOS's Microphone and System Audio prompts while the engine
/// opens its streams. An engine that waits for the user, but still answers `ping`, must not be
/// restarted, and its session must start: the recording is never lost.
#[tokio::test(start_paused = true)]
async fn a_start_waiting_on_a_permission_prompt_is_not_restarted() {
    let engine = ScriptedEngine::new().with_default(Behaviour {
        answer_capture_sessions: true,
        start_session_delay_ms: 45_000,
        ..Behaviour::default()
    });
    let c = client(&engine);
    let mut events = c.events();
    let call_id = CallId::new("call-prompt");
    let started = c
        .command(EngineCommand::StartSession(StartSession {
            call_id: call_id.clone(),
            session_dir: "audio/call-prompt".into(),
            store_audio: true,
            mic_device_uid: None,
            exclude_bundle_ids: vec![],
            languages: vec![],
            backend: AsrBackend::WhisperTurbo,
            glossary: vec![],
            speaker_priors: vec![],
            enrolled_embeddings_path: None,
            resume_from_ms: None,
        }))
        .await;
    assert_eq!(
        started,
        Ok(()),
        "the start waits for the user, longer than command_timeout"
    );
    assert_eq!(engine.launches(), 1, "the engine was not restarted");
    loop {
        if let EngineEvent::SessionStarted { call_id: got, .. } = events.recv().await.unwrap().event
        {
            assert_eq!(got, call_id);
            break;
        }
    }
}

/// #1167, the other side: a start may wait for the user, but an engine that stops answering
/// `ping` meanwhile is still ended by liveness, long before the permission timeout.
#[tokio::test(start_paused = true)]
async fn a_hung_engine_does_not_hide_behind_a_permission_wait() {
    let engine = ScriptedEngine::new()
        .then(Behaviour {
            hang: true,
            ..Behaviour::default()
        })
        .with_default(Behaviour::default());
    let c = client(&engine);
    let began = Instant::now();
    let started = c
        .command(EngineCommand::StartSession(StartSession {
            call_id: CallId::new("call-hung"),
            session_dir: "audio/call-hung".into(),
            store_audio: true,
            mic_device_uid: None,
            exclude_bundle_ids: vec![],
            languages: vec![],
            backend: AsrBackend::WhisperTurbo,
            glossary: vec![],
            speaker_priors: vec![],
            enrolled_embeddings_path: None,
            resume_from_ms: None,
        }))
        .await;
    assert_eq!(started, Err(noter_engine_client::CommandError::Unavailable));
    assert!(
        began.elapsed() < Duration::from_secs(30),
        "{:?}",
        began.elapsed()
    );
}
