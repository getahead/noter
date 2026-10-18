//! The scripted engine's self-test as the M0 stories need it: paced on tokio time, with line
//! events, a scripted stream (`inject`), and system audio following a permission state.

use std::time::Duration;

use noter_engine_client::scripted::{Behaviour, ScriptedEngine};
use noter_engine_client::{Config, EngineClient};
use noter_protocol::engine::{EngineCommand, EngineErrorCode, EngineEvent};
use noter_protocol::{AudioChannel, PermissionState};
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
        .filter(|e| !matches!(e, EngineEvent::Ack { .. }))
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
            Some(EngineErrorCode::Internal),
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
