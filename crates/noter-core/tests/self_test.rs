//! FEATURE cpt-noter-feature-core-first-run (part 3): self_test_run through the engine
//! supervisor (S12) with a scripted engine (D3), streamed over the hub.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{
    BoxFuture, BundleSpec, ChunkSink, Clock, Core, CoreDeps, EnvironmentReading, EventEmitter,
    FetchError, ModelSource, NativeServices,
};
use noter_engine_client::scripted::{Behaviour, ScriptedEngine};
use noter_engine_client::EngineLauncher;
use noter_protocol::engine::{EngineCommand, EngineErrorCode};
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi, Sink};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::Value;

struct NoEvents;

impl EventEmitter for NoEvents {
    fn emit(&self, _: &'static str, _: Value) {}
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(1_790_000_000_000)
    }
}

#[derive(Default)]
struct Mac {
    states: Mutex<HashMap<PermissionKind, PermissionState>>,
}

impl NativeServices for Mac {
    fn permission(&self, kind: PermissionKind) -> PermissionState {
        *self
            .states
            .lock()
            .unwrap()
            .get(&kind)
            .unwrap_or(&PermissionState::NotAsked)
    }
    fn request_permission(&self, kind: PermissionKind) -> BoxFuture<'_, PermissionState> {
        let s = self.permission(kind);
        Box::pin(async move { s })
    }
    fn environment(&self) -> EnvironmentReading {
        EnvironmentReading::default()
    }
    fn set_login_item(&self, _: bool) -> Result<(), CoreError> {
        Ok(())
    }
}

/// One required bundle that is never downloaded.
struct MissingModel;

impl ModelSource for MissingModel {
    fn manifest(&self) -> Vec<BundleSpec> {
        vec![BundleSpec {
            name: "whisper-turbo".into(),
            url: "https://huggingface.co/x".into(),
            size_bytes: 10,
            sha256: "0".repeat(64),
            required_for_capture: true,
        }]
    }
    fn fetch<'a>(
        &'a self,
        _: &'a BundleSpec,
        _: u64,
        _: ChunkSink<'a>,
    ) -> BoxFuture<'a, Result<(), FetchError>> {
        Box::pin(async { Err(FetchError::Offline) })
    }
}

struct Run {
    core: Arc<Core>,
    engine: ScriptedEngine,
}

fn open(
    dir: &Path,
    engine: ScriptedEngine,
    mic: PermissionState,
    models: Option<Arc<dyn ModelSource>>,
) -> Run {
    let mac = Mac::default();
    mac.states
        .lock()
        .unwrap()
        .insert(PermissionKind::Microphone, mic);
    let launcher: Arc<dyn EngineLauncher> = Arc::new(engine.clone());
    let mut deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(NoEvents))
        .with_native(Arc::new(mac))
        .with_engine(launcher);
    if let Some(m) = models {
        deps = deps.with_models(m);
    }
    let core = Arc::new(Core::open(dir, deps).expect("core opens"));
    core.start_first_run();
    Run { core, engine }
}

fn first_run() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::FirstRun,
        },
    }
}

fn collecting() -> (Sink<SelfTestMsg>, Arc<Mutex<Vec<SelfTestMsg>>>) {
    let got = Arc::new(Mutex::new(Vec::new()));
    let g = got.clone();
    (
        Sink::new(move |m| {
            g.lock().unwrap().push(m);
            true
        }),
        got,
    )
}

async fn run_to_end(r: &Run, play_clip: bool) -> (SubscriptionHandle, Vec<SelfTestEvent>) {
    let (sink, got) = collecting();
    let handle = r
        .core
        .self_test_run(&first_run(), SelfTestArgs { play_clip }, sink)
        .await
        .unwrap();
    for _ in 0..3000 {
        if got
            .lock()
            .unwrap()
            .iter()
            .any(|m| matches!(m.event, SelfTestEvent::Ended { .. }))
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let msgs = got.lock().unwrap().clone();
    // The Channel is gapless from 1.
    for (i, m) in msgs.iter().enumerate() {
        assert_eq!(m.seq, Seq(i as u64 + 1));
    }
    (handle, msgs.into_iter().map(|m| m.event).collect())
}

async fn status(r: &Run) -> SetupStatus {
    r.core.setup_status(&first_run(), NoArgs {}).await.unwrap()
}

fn failed(events: &[SelfTestEvent]) -> Option<SelfTestFailure> {
    events.iter().find_map(|e| match e {
        SelfTestEvent::Failed { reason } => Some(reason.clone()),
        _ => None,
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn both_streams_pass_store_the_result_and_turn_detection_on() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(
        dir.path(),
        ScriptedEngine::new(),
        PermissionState::Granted,
        None,
    );
    let (handle, events) = run_to_end(&r, true).await;
    assert_eq!(
        events,
        vec![
            SelfTestEvent::StreamArrived {
                channel: AudioChannel::Mic
            },
            SelfTestEvent::StreamArrived {
                channel: AudioChannel::Sys
            },
            SelfTestEvent::Passed,
            SelfTestEvent::Ended {
                reason: StreamEndReason::CallStopped
            },
        ]
    );
    let s = status(&r).await;
    assert!(matches!(s.self_test, SelfTestState::Passed { .. }));
    assert!(s.detection_enabled);
    let snap = r.core.app_snapshot(&first_run(), NoArgs {}).await.unwrap();
    assert!(!snap
        .degraded
        .states
        .contains(&DegradedState::SetupIncomplete));
    assert!(r
        .engine
        .commands()
        .iter()
        .any(|c| matches!(c, EngineCommand::SetDetection { enabled: true, .. })));
    // The Channel is a real hub subscription: ack and unsubscribe answer.
    r.core
        .stream_ack(
            &first_run(),
            StreamAckArgs {
                subscription_id: handle.subscription_id.clone(),
                seq: Seq(4),
            },
        )
        .await
        .unwrap();
    r.core
        .stream_unsubscribe(
            &first_run(),
            UnsubscribeArgs {
                subscription_id: handle.subscription_id,
            },
        )
        .await
        .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_missing_microphone_permission_fails_before_the_engine_runs() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(
        dir.path(),
        ScriptedEngine::new(),
        PermissionState::Denied,
        None,
    );
    let (_, events) = run_to_end(&r, false).await;
    assert_eq!(
        failed(&events),
        Some(SelfTestFailure::PermissionMissing {
            kind: PermissionKind::Microphone
        })
    );
    assert!(!r
        .engine
        .commands()
        .iter()
        .any(|c| matches!(c, EngineCommand::SelfTest { .. })));
    let s = status(&r).await;
    assert!(matches!(s.self_test, SelfTestState::Failed { .. }));
    assert!(!s.detection_enabled);
    let snap = r.core.app_snapshot(&first_run(), NoArgs {}).await.unwrap();
    assert!(snap
        .degraded
        .states
        .contains(&DegradedState::SetupIncomplete));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn only_zeros_and_one_silent_stream_fail_with_their_reasons() {
    let dir = tempfile::tempdir().unwrap();
    let zeros = ScriptedEngine::new().with_default(Behaviour {
        self_test_failure: Some(EngineErrorCode::ZeroBuffers),
        ..Behaviour::default()
    });
    let r = open(dir.path(), zeros, PermissionState::Granted, None);
    assert_eq!(
        failed(&run_to_end(&r, false).await.1),
        Some(SelfTestFailure::ZeroBuffers)
    );

    let dir = tempfile::tempdir().unwrap();
    let silent = ScriptedEngine::new().with_default(Behaviour {
        self_test_failure: Some(EngineErrorCode::DeviceUnavailable),
        ..Behaviour::default()
    });
    let r = open(dir.path(), silent, PermissionState::Granted, None);
    // The engine reports no channel: the core rebuilds it from the streams that arrived.
    assert_eq!(
        failed(&run_to_end(&r, false).await.1),
        Some(SelfTestFailure::OneStreamSilent {
            channel: AudioChannel::Sys
        })
    );
    assert!(!status(&r).await.detection_enabled);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_engine_that_never_answers_times_out() {
    let dir = tempfile::tempdir().unwrap();
    let engine = ScriptedEngine::new().with_default(Behaviour {
        hang: true,
        ..Behaviour::default()
    });
    let mac = Mac::default();
    mac.states
        .lock()
        .unwrap()
        .insert(PermissionKind::Microphone, PermissionState::Granted);
    let launcher: Arc<dyn EngineLauncher> = Arc::new(engine.clone());
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(NoEvents))
        .with_native(Arc::new(mac))
        .with_engine(launcher)
        .with_engine_config(noter_engine_client::Config {
            command_timeout: Duration::from_millis(200),
            ping_timeout: Duration::from_millis(100),
            ..noter_engine_client::Config::default()
        });
    let core = Arc::new(Core::open(dir.path(), deps).unwrap());
    core.start_first_run();
    let r = Run { core, engine };
    let (_, events) = run_to_end(&r, false).await;
    assert_eq!(failed(&events), Some(SelfTestFailure::TimedOut));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_missing_live_model_is_refused_before_the_channel_opens() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(
        dir.path(),
        ScriptedEngine::new(),
        PermissionState::Granted,
        Some(Arc::new(MissingModel)),
    );
    let (sink, got) = collecting();
    let err = r
        .core
        .self_test_run(&first_run(), SelfTestArgs { play_clip: false }, sink)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ModelMissing);
    assert!(got.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_system_audio_prompt_comes_from_a_short_engine_self_test() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(
        dir.path(),
        ScriptedEngine::new(),
        PermissionState::Granted,
        None,
    );
    // System audio arrived in the short test: granted, and the row keeps it.
    let row = r
        .core
        .permission_request(
            &first_run(),
            PermissionArgs {
                kind: PermissionKind::SystemAudio,
            },
        )
        .await
        .unwrap();
    assert_eq!(row.state, PermissionState::Granted);
    assert!(r.engine.commands().iter().any(|c| matches!(
        c,
        EngineCommand::SelfTest {
            play_clip: false,
            ..
        }
    )));
    let s = status(&r).await;
    assert!(s
        .permissions
        .iter()
        .any(|p| p.kind == PermissionKind::SystemAudio && p.state == PermissionState::Granted));

    // Only digital zeros: the recording permission is off.
    let dir = tempfile::tempdir().unwrap();
    let zeros = ScriptedEngine::new().with_default(Behaviour {
        self_test_failure: Some(EngineErrorCode::ZeroBuffers),
        ..Behaviour::default()
    });
    let r = open(dir.path(), zeros, PermissionState::Granted, None);
    let err = r
        .core
        .permission_request(
            &first_run(),
            PermissionArgs {
                kind: PermissionKind::SystemAudio,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::PermissionDenied);
}
