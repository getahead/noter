//! The supervisor against a scripted engine (the S12 seam) and against a real process.

use std::time::Duration;

use noter_engine_client::scripted::{Behaviour, ScriptedEngine};
use noter_engine_client::{CommandError, Config, EngineClient, EngineState, ProcessLauncher};
use noter_protocol::engine::{EngineCommand, EngineErrorCode, EngineEvent};
use noter_protocol::{AudioChannel, ErrorCode};

fn client(engine: &ScriptedEngine) -> EngineClient<ScriptedEngine> {
    EngineClient::new(engine.clone(), Config::default())
}

/// Lets spawned tasks (reader, restart) run.
async fn settle() {
    for _ in 0..50 {
        tokio::task::yield_now().await;
    }
}

#[tokio::test(start_paused = true)]
async fn starts_on_first_need_and_sends_the_detection_rule() {
    let engine = ScriptedEngine::new();
    let c = client(&engine);
    assert_eq!(c.state(), EngineState::NotStarted);
    let ready = c.ensure_ready().await.unwrap();
    assert_eq!(
        ready.protocol_version,
        noter_protocol::engine::ENGINE_PROTOCOL_VERSION
    );
    assert!(ready.sandboxed);
    assert_eq!(c.state(), EngineState::Ready);
    settle().await;
    // Detection stays off until the self-test passed.
    assert!(matches!(
        engine.commands().first(),
        Some(EngineCommand::SetDetection { enabled: false, .. })
    ));
    // Already ready: no second launch.
    c.ensure_ready().await.unwrap();
    assert_eq!(engine.launches(), 1);
}

#[tokio::test(start_paused = true)]
async fn refuses_another_protocol_major_with_engine_unavailable() {
    let engine = ScriptedEngine::new().with_default(Behaviour {
        protocol_version: Some("3.0".into()),
        ..Behaviour::default()
    });
    let c = client(&engine);
    let err = c.ensure_ready().await.unwrap_err();
    assert_eq!(err.code, ErrorCode::EngineUnavailable);
    assert_eq!(c.state(), EngineState::Unavailable);
    settle().await;
    assert!(matches!(
        engine.commands().last(),
        Some(EngineCommand::Shutdown)
    ));
}

#[tokio::test(start_paused = true)]
async fn a_minor_difference_is_accepted() {
    let engine = ScriptedEngine::new().with_default(Behaviour {
        protocol_version: Some("2.7".into()),
        ..Behaviour::default()
    });
    assert!(client(&engine).ensure_ready().await.is_ok());
}

#[tokio::test(start_paused = true)]
async fn a_failed_start_is_engine_unavailable_until_the_next_request() {
    // No `ready` in time, then a launch that fails, then a good engine.
    let engine = ScriptedEngine::new()
        .then(Behaviour {
            protocol_version: None,
            ..Behaviour::default()
        })
        .then(Behaviour {
            launch_fails: true,
            ..Behaviour::default()
        });
    let c = client(&engine);
    for _ in 0..2 {
        assert_eq!(
            c.ensure_ready().await.unwrap_err().code,
            ErrorCode::EngineUnavailable
        );
        assert_eq!(c.state(), EngineState::Unavailable);
    }
    c.ensure_ready().await.unwrap();
    assert_eq!(c.state(), EngineState::Ready);
    assert_eq!(engine.launches(), 3);
}

#[tokio::test(start_paused = true)]
async fn failed_restarts_older_than_a_minute_do_not_count() {
    // Restarts 40 s, 80 s and 160 s apart: never three failures within a minute.
    let engine = ScriptedEngine::new()
        .then(Behaviour::default())
        .then(Behaviour {
            launch_fails: true,
            ..Behaviour::default()
        })
        .then(Behaviour {
            launch_fails: true,
            ..Behaviour::default()
        })
        .then(Behaviour {
            launch_fails: true,
            ..Behaviour::default()
        });
    let c = EngineClient::new(
        engine.clone(),
        Config {
            restart_backoff: Duration::from_secs(40),
            ..Config::default()
        },
    );
    c.ensure_ready().await.unwrap();
    engine.kill_current();
    settle().await;
    assert_eq!(c.state(), EngineState::Restarting);
    tokio::time::sleep(Duration::from_secs(1000)).await;
    settle().await;
    assert_eq!(c.state(), EngineState::Ready);
    assert_eq!(engine.launches(), 5);
}

#[tokio::test(start_paused = true)]
async fn ack_and_error_resolve_the_command_with_the_same_id() {
    let engine = ScriptedEngine::new();
    let c = client(&engine);
    c.command(EngineCommand::SetLanguages { languages: vec![] })
        .await
        .unwrap();

    let rejecting = ScriptedEngine::new().with_default(Behaviour {
        reject: true,
        ..Behaviour::default()
    });
    let c = client(&rejecting);
    let err = c.command(EngineCommand::StopPlayback).await.unwrap_err();
    assert!(
        matches!(
            err,
            CommandError::Engine {
                code: EngineErrorCode::BadCommand,
                ..
            }
        ),
        "{err:?}"
    );
    let core: noter_protocol::CoreError = err.into();
    assert_eq!(core.code, ErrorCode::Internal);
    let core: noter_protocol::CoreError = CommandError::Unavailable.into();
    assert_eq!(core.code, ErrorCode::EngineUnavailable);
}

#[tokio::test(start_paused = true)]
async fn ping_is_answered_by_pong_and_a_missed_ping_restarts_the_engine() {
    let engine = ScriptedEngine::new().then(Behaviour {
        answer_ping: false,
        ..Behaviour::default()
    });
    let c = client(&engine);
    // First process never answers ping: liveness fails, the engine restarts.
    assert!(matches!(c.ping().await, Err(CommandError::Unavailable)));
    tokio::time::sleep(Duration::from_secs(2)).await;
    settle().await;
    assert_eq!(c.state(), EngineState::Ready);
    assert_eq!(engine.launches(), 2);
    c.ping().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn events_reach_subscribers_and_gaps_and_garbage_are_counted() {
    let engine = ScriptedEngine::new().with_default(Behaviour {
        // seq 1 is the ready line; 2 and 3 are skipped; then a line that does not parse.
        raw_after_ready: vec![
            r#"{"seq":4,"at":0,"event":{"type":"levels","call_id":null,"mic_db":-20.0,"sys_db":-30.0}}"#.into(),
            "not json".into(),
        ],
        ..Behaviour::default()
    });
    let c = client(&engine);
    let mut events = c.events();
    c.ensure_ready().await.unwrap();
    c.command(EngineCommand::SelfTest {
        play_clip: false,
        timeout_ms: 10_000,
    })
    .await
    .unwrap();
    let mut got = Vec::new();
    while got.len() < 4 {
        got.push(events.recv().await.unwrap().event);
    }
    assert!(matches!(got[0], EngineEvent::Levels { .. }));
    assert_eq!(
        got[1],
        EngineEvent::SelfTestStream {
            channel: AudioChannel::Mic
        }
    );
    assert_eq!(
        got[2],
        EngineEvent::SelfTestStream {
            channel: AudioChannel::Sys
        }
    );
    assert_eq!(
        got[3],
        EngineEvent::SelfTestResult {
            passed: true,
            failure: None,
            own_sounds_leak: false
        }
    );
    let stats = c.stats();
    assert_eq!((stats.gaps, stats.unparsable), (1, 1));
}

#[tokio::test(start_paused = true)]
async fn a_failing_self_test_reports_its_reason() {
    let engine = ScriptedEngine::new().with_default(Behaviour {
        self_test_failure: Some(EngineErrorCode::ZeroBuffers),
        ..Behaviour::default()
    });
    let c = client(&engine);
    let mut events = c.events();
    c.command(EngineCommand::SelfTest {
        play_clip: true,
        timeout_ms: 10_000,
    })
    .await
    .unwrap();
    loop {
        if let EngineEvent::SelfTestResult {
            passed, failure, ..
        } = events.recv().await.unwrap().event
        {
            assert!(!passed);
            assert_eq!(failure, Some(EngineErrorCode::ZeroBuffers));
            break;
        }
    }
}

#[tokio::test(start_paused = true)]
async fn a_dead_engine_fails_waiting_commands_and_comes_back() {
    let engine = ScriptedEngine::new().then(Behaviour {
        hang: true,
        ..Behaviour::default()
    });
    let c = client(&engine);
    c.ensure_ready().await.unwrap();
    let waiting = {
        let c = c.clone();
        tokio::spawn(async move { c.command(EngineCommand::StopPlayback).await })
    };
    settle().await;
    engine.kill_current();
    assert!(matches!(
        waiting.await.unwrap(),
        Err(CommandError::Unavailable)
    ));
    tokio::time::sleep(Duration::from_secs(2)).await;
    settle().await;
    assert_eq!(c.state(), EngineState::Ready);
    assert_eq!(engine.launches(), 2);
}

#[tokio::test(start_paused = true)]
async fn restarting_gives_up_after_three_failed_starts() {
    let engine = ScriptedEngine::new()
        .then(Behaviour::default())
        .with_default(Behaviour {
            launch_fails: true,
            ..Behaviour::default()
        });
    let c = client(&engine);
    c.ensure_ready().await.unwrap();
    engine.kill_current();
    tokio::time::sleep(Duration::from_secs(30)).await;
    settle().await;
    assert_eq!(c.state(), EngineState::Unavailable);
    assert_eq!(engine.launches(), 4);
    // Until the next request.
    assert_eq!(
        c.ensure_ready().await.unwrap_err().code,
        ErrorCode::EngineUnavailable
    );
    assert_eq!(engine.launches(), 5);
}

#[tokio::test(start_paused = true)]
async fn shutdown_stops_without_a_restart() {
    let engine = ScriptedEngine::new();
    let c = client(&engine);
    c.ensure_ready().await.unwrap();
    c.shutdown().await;
    settle().await;
    assert_eq!(c.state(), EngineState::Stopped);
    tokio::time::sleep(Duration::from_secs(5)).await;
    assert_eq!(engine.launches(), 1);
    assert!(matches!(
        engine.commands().last(),
        Some(EngineCommand::Shutdown)
    ));
    // Shutting down an engine that never started is harmless.
    client(&ScriptedEngine::new()).shutdown().await;
}

#[tokio::test]
async fn the_process_launcher_spawns_a_real_engine_over_stdio() {
    // A stand-in engine: announce ready, then swallow commands until stdin closes.
    let ready = r#"{"seq":1,"at":0,"event":{"type":"ready","protocol_version":"2.0","engine_version":"sh","models":[],"sandboxed":false}}"#;
    let launcher = ProcessLauncher::new("/bin/sh")
        .args(["-c", &format!("echo '{ready}'; cat > /dev/null")])
        .app_group("/tmp/noter-app-group");
    let c = EngineClient::new(
        launcher,
        Config {
            grace: Duration::from_millis(100),
            ..Config::default()
        },
    );
    let info = c.ensure_ready().await.unwrap();
    assert_eq!(info.engine_version, "sh");
    c.shutdown().await;
    assert_eq!(c.state(), EngineState::Stopped);
}

#[tokio::test]
async fn a_missing_engine_binary_is_engine_unavailable() {
    let c = EngineClient::new(
        ProcessLauncher::new("/nonexistent/noter-engine"),
        Config::default(),
    );
    assert_eq!(
        c.ensure_ready().await.unwrap_err().code,
        ErrorCode::EngineUnavailable
    );
}

#[test]
fn the_engine_path_comes_from_noter_engine_path_in_development() {
    let bundled = "/Applications/Noter.app/Contents/MacOS/noter-engine";
    assert_eq!(
        ProcessLauncher::resolve(bundled, Some("/tmp/dev-engine".into())),
        std::path::PathBuf::from("/tmp/dev-engine")
    );
    assert_eq!(
        ProcessLauncher::resolve(bundled, None),
        std::path::PathBuf::from(bundled)
    );
}

#[tokio::test(start_paused = true)]
async fn a_command_to_a_hung_engine_ends_unavailable_and_the_engine_restarts() {
    // No kill: the supervisor itself notices the engine stopped answering.
    let engine = ScriptedEngine::new().then(Behaviour {
        hang: true,
        ..Behaviour::default()
    });
    let c = client(&engine);
    let err = c.command(EngineCommand::StopPlayback).await.unwrap_err();
    assert_eq!(err, CommandError::Unavailable);
    tokio::time::sleep(Duration::from_secs(2)).await;
    settle().await;
    assert_eq!(c.state(), EngineState::Ready);
    assert_eq!(engine.launches(), 2);
    c.command(EngineCommand::StopPlayback).await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn liveness_pings_restart_an_idle_hung_engine() {
    let engine = ScriptedEngine::new().then(Behaviour {
        hang: true,
        ..Behaviour::default()
    });
    let c = client(&engine);
    c.ensure_ready().await.unwrap();
    let cfg = Config::default();
    tokio::time::sleep(cfg.liveness_interval + cfg.ping_timeout + Duration::from_secs(2)).await;
    settle().await;
    assert_eq!(engine.launches(), 2);
    assert_eq!(c.state(), EngineState::Ready);
    assert!(engine
        .commands()
        .iter()
        .any(|cmd| matches!(cmd, EngineCommand::Ping)));
}

#[test]
fn engine_errors_map_to_the_contract_codes_it_has() {
    let core = |code| -> noter_protocol::CoreError {
        CommandError::Engine {
            code,
            message: "x".into(),
        }
        .into()
    };
    assert_eq!(
        core(EngineErrorCode::PermissionMissing).code,
        ErrorCode::PermissionMissing
    );
    assert_eq!(
        core(EngineErrorCode::ModelMissing).code,
        ErrorCode::ModelMissing
    );
    assert_eq!(core(EngineErrorCode::DiskFull).code, ErrorCode::DiskFull);
    assert_eq!(
        core(EngineErrorCode::DeviceUnavailable).code,
        ErrorCode::Internal
    );
}

#[tokio::test]
async fn engine_stderr_is_counted_never_kept() {
    let ready = r#"{"seq":1,"at":0,"event":{"type":"ready","protocol_version":"2.0","engine_version":"sh","models":[],"sandboxed":false}}"#;
    let launcher = ProcessLauncher::new("/bin/sh").args([
        "-c",
        &format!("echo secret words >&2; echo more >&2; echo '{ready}'; cat > /dev/null"),
    ]);
    let c = EngineClient::new(
        launcher.clone(),
        Config {
            grace: Duration::from_millis(100),
            ..Config::default()
        },
    );
    c.ensure_ready().await.unwrap();
    for _ in 0..100 {
        if launcher.stderr_lines() == 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(launcher.stderr_lines(), 2);
    c.shutdown().await;
}

#[tokio::test(start_paused = true)]
async fn the_launcher_is_object_safe_so_the_core_can_hold_any_engine() {
    use noter_engine_client::EngineLauncher;
    use std::sync::Arc;
    let engine = ScriptedEngine::new();
    let launcher: Arc<dyn EngineLauncher> = Arc::new(engine.clone());
    let c = EngineClient::new(launcher, Config::default());
    c.ensure_ready().await.unwrap();
    assert_eq!(engine.launches(), 1);
}

#[tokio::test(start_paused = true)]
async fn liveness_never_relaunches_a_shut_down_engine() {
    let engine = ScriptedEngine::new();
    let c = client(&engine);
    c.ensure_ready().await.unwrap();
    // Shut down just before the liveness tick.
    tokio::time::sleep(Config::default().liveness_interval - Duration::from_millis(1)).await;
    c.shutdown().await;
    tokio::time::sleep(Duration::from_secs(60)).await;
    settle().await;
    assert_eq!(engine.launches(), 1);
    assert_eq!(c.state(), EngineState::Stopped);
}
