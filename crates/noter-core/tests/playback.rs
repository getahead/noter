//! FEATURE cpt-noter-feature-core-live-transcript (replay): `audio_play` and `audio_stop`, the
//! replay route rule during capture, `playback:state` whole with a version, and the stop reasons.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{
    BoxFuture, Clock, Core, CoreDeps, EnvironmentReading, EventEmitter, NativeServices,
};
use noter_db::Mutation;
use noter_engine_client::scripted::ScriptedEngine;
use noter_engine_client::EngineLauncher;
use noter_protocol::engine::{EngineCommand, EngineEvent};
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(1_790_000_000_000)
    }
}

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

impl Events {
    fn playback(&self) -> Vec<PlaybackState> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|(e, _)| *e == "playback:state")
            .map(|(_, p)| serde_json::from_value(p.clone()).unwrap())
            .collect()
    }
}

type Listener = Box<dyn Fn(EnvironmentReading) + Send + Sync>;

/// The Mac: a settable reading, and the core's change listener to tell it about a change.
#[derive(Default)]
struct Mac {
    reading: Mutex<EnvironmentReading>,
    changed: Mutex<Option<Listener>>,
}

impl Mac {
    fn route(&self, route: OutputRoute) {
        self.reading.lock().unwrap().output_route = route;
        let reading = self.reading.lock().unwrap().clone();
        if let Some(listener) = &*self.changed.lock().unwrap() {
            listener(reading);
        }
    }
}

/// The core owns its `NativeServices`; the test keeps a handle on the same Mac.
struct SharedMac(Arc<Mac>);

impl NativeServices for SharedMac {
    fn permission(&self, _: PermissionKind) -> PermissionState {
        PermissionState::Granted
    }
    fn request_permission(&self, _: PermissionKind) -> BoxFuture<'_, PermissionState> {
        Box::pin(async { PermissionState::Granted })
    }
    fn environment(&self) -> EnvironmentReading {
        self.0.reading.lock().unwrap().clone()
    }
    fn on_change(&self, on_change: Listener) {
        *self.0.changed.lock().unwrap() = Some(on_change);
    }
    fn set_login_item(&self, _: bool) -> Result<(), CoreError> {
        Ok(())
    }
}

struct Run {
    core: Arc<Core>,
    engine: ScriptedEngine,
    mac: Arc<Mac>,
    events: Arc<Events>,
}

fn open(dir: &Path, route: OutputRoute) -> Run {
    let engine = ScriptedEngine::new();
    let mac = Arc::new(Mac::default());
    mac.reading.lock().unwrap().output_route = route;
    let events = Arc::new(Events::default());
    let launcher: Arc<dyn EngineLauncher> = Arc::new(engine.clone());
    let deps = CoreDeps::new(Arc::new(FixedClock), events.clone())
        .with_native(Arc::new(SharedMac(mac.clone())))
        .with_engine(launcher);
    let core = Arc::new(Core::open(dir, deps).expect("core opens"));
    core.start_first_run();
    Run {
        core,
        engine,
        mac,
        events,
    }
}

fn window() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::CallScreen,
        },
    }
}

fn call(core: &Core, id: &str, status: &str, audio_deleted: i64) {
    core.store()
        .write(
            Mutation {
                entity_type: "call",
                table: "calls",
                id: id.into(),
                base_rev: None,
                bump_rev: true,
                values: vec![
                    ("started_at", json!(1_792_137_600_000_i64)),
                    ("title", json!("Planning")),
                    ("call_type", json!("planning")),
                    ("status", json!(status)),
                    ("mode_used", json!("cloud_redacted")),
                    ("audio_deleted", json!(audio_deleted)),
                ],
            },
            noter_db::ChangeMeta {
                actor: Actor::You,
                summary: "call".into(),
                reason: "test".into(),
                evidence_ids: vec![],
                batch_id: None,
                undoable: true,
                surface: None,
            },
        )
        .unwrap();
}

fn play(call_id: &str) -> PlayAudioArgs {
    PlayAudioArgs {
        call_id: CallId::new(call_id),
        from_ms: OffsetMs(1_000),
        to_ms: Some(OffsetMs(5_000)),
        channel: None,
    }
}

async fn refused(r: &Run, call_id: &str) -> ErrorCode {
    r.core
        .audio_play(&window(), play(call_id))
        .await
        .unwrap_err()
        .code
}

async fn settle() {
    tokio::time::sleep(Duration::from_millis(50)).await;
}

#[tokio::test(start_paused = true)]
async fn after_a_call_any_output_plays_and_the_engine_is_asked() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path(), OutputRoute::Speakers);
    call(&r.core, "call_old", "ready", 0);
    let state = r
        .core
        .audio_play(&window(), play("call_old"))
        .await
        .unwrap();
    assert!(state.playing && state.stopped_reason.is_none());
    assert_eq!(state.route, OutputRoute::Speakers);
    assert_eq!(state.position_ms, OffsetMs(1_000));
    assert_eq!(state.to_ms, Some(OffsetMs(5_000)));
    assert!(r.engine.commands().iter().any(|c| matches!(
        c,
        EngineCommand::Play { from_ms, .. } if *from_ms == OffsetMs(1_000)
    )));
    assert_eq!(r.events.playback(), vec![state]);
}

#[tokio::test(start_paused = true)]
async fn an_unknown_or_deleted_call_refuses() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path(), OutputRoute::Headphones);
    call(&r.core, "call_gone", "ready", 1);
    assert_eq!(refused(&r, "call_none").await, ErrorCode::NotFound);
    assert_eq!(refused(&r, "call_gone").await, ErrorCode::AudioDeleted);
}

#[tokio::test(start_paused = true)]
async fn during_capture_the_route_decides() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path(), OutputRoute::Speakers);
    call(&r.core, "call_old", "ready", 0);
    call(&r.core, "call_live", "recording", 0);
    assert_eq!(
        refused(&r, "call_old").await,
        ErrorCode::ReplayNeedsHeadphones
    );
    r.mac.route(OutputRoute::Unknown);
    assert_eq!(refused(&r, "call_old").await, ErrorCode::OutputRouteUnknown);
    r.mac.route(OutputRoute::Headphones);
    assert!(
        r.core
            .audio_play(&window(), play("call_old"))
            .await
            .unwrap()
            .playing
    );
    // Own sounds not excluded from the tap: refused even on headphones.
    let mut audio = noter_core::default_settings().audio;
    audio.exclude_own_sounds = false;
    r.core
        .settings_update(
            &CommandCtx {
                caller: Caller::Window {
                    label: WindowLabel::Settings,
                },
            },
            SettingsUpdateArgs {
                rev: Rev(1),
                section: SettingsSection::Audio(audio),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        refused(&r, "call_old").await,
        ErrorCode::OwnSoundsNotExcluded
    );
}

#[tokio::test(start_paused = true)]
async fn treating_the_output_as_headphones_in_settings_unlocks_replay_at_once() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path(), OutputRoute::Unknown);
    r.mac.reading.lock().unwrap().output_device = Some(OutputDeviceInfo {
        uid: "usb-1".into(),
        name: "Scarlett".into(),
        marked_headphones: false,
    });
    r.mac.route(OutputRoute::Unknown);
    call(&r.core, "call_old", "ready", 0);
    call(&r.core, "call_live", "recording", 0);
    assert_eq!(refused(&r, "call_old").await, ErrorCode::OutputRouteUnknown);
    let mut audio = noter_core::default_settings().audio;
    audio.output.headphones_devices = vec!["usb-1".into()];
    r.core
        .settings_update(
            &CommandCtx {
                caller: Caller::Window {
                    label: WindowLabel::Settings,
                },
            },
            SettingsUpdateArgs {
                rev: Rev(1),
                section: SettingsSection::Audio(audio),
            },
        )
        .await
        .unwrap();
    assert!(
        r.core
            .audio_play(&window(), play("call_old"))
            .await
            .unwrap()
            .playing
    );
}

#[tokio::test(start_paused = true)]
async fn the_engine_reports_the_position_and_the_end() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path(), OutputRoute::Headphones);
    call(&r.core, "call_old", "ready", 0);
    r.core
        .audio_play(&window(), play("call_old"))
        .await
        .unwrap();
    let at = |at_ms, playing| EngineEvent::PlaybackPosition {
        call_id: CallId::new("call_old"),
        at_ms: OffsetMs(at_ms),
        playing,
    };
    assert!(r.engine.inject(at(2_000, true)));
    settle().await;
    assert!(r.engine.inject(at(5_000, false)));
    settle().await;
    let states = r.events.playback();
    let versions: Vec<_> = states.iter().map(|s| s.version.0).collect();
    assert_eq!(versions, vec![1, 2, 3]);
    assert_eq!(states[1].position_ms, OffsetMs(2_000));
    assert!(states[1].playing);
    assert!(!states[2].playing);
    assert_eq!(states[2].stopped_reason, Some(PlaybackStopReason::Ended));
}

#[tokio::test(start_paused = true)]
async fn the_user_stops_it() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path(), OutputRoute::Headphones);
    call(&r.core, "call_old", "ready", 0);
    // Nothing plays: a stop changes nothing.
    let idle = r.core.audio_stop(&window(), NoArgs {}).await.unwrap();
    assert!(!idle.playing && idle.stopped_reason.is_none());
    assert!(r.events.playback().is_empty());
    r.core
        .audio_play(&window(), play("call_old"))
        .await
        .unwrap();
    let state = r.core.audio_stop(&window(), NoArgs {}).await.unwrap();
    assert!(!state.playing);
    assert_eq!(state.stopped_reason, Some(PlaybackStopReason::User));
    assert!(r
        .engine
        .commands()
        .iter()
        .any(|c| matches!(c, EngineCommand::StopPlayback)));
    // Playing again is allowed after a stop.
    assert!(
        r.core
            .audio_play(&window(), play("call_old"))
            .await
            .unwrap()
            .playing
    );
}

#[tokio::test(start_paused = true)]
async fn switching_to_speakers_during_capture_stops_it() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path(), OutputRoute::Headphones);
    call(&r.core, "call_old", "ready", 0);
    call(&r.core, "call_live", "recording", 0);
    r.core
        .audio_play(&window(), play("call_old"))
        .await
        .unwrap();
    r.mac.route(OutputRoute::Speakers);
    settle().await;
    let last = r.events.playback().pop().unwrap();
    assert!(!last.playing);
    assert_eq!(
        last.stopped_reason,
        Some(PlaybackStopReason::OutputSwitchedToSpeakers)
    );
    assert!(r
        .engine
        .commands()
        .iter()
        .any(|c| matches!(c, EngineCommand::StopPlayback)));
}

#[tokio::test(start_paused = true)]
async fn a_capture_starting_stops_it() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path(), OutputRoute::Headphones);
    call(&r.core, "call_old", "ready", 0);
    r.core
        .audio_play(&window(), play("call_old"))
        .await
        .unwrap();
    assert!(r.engine.inject(EngineEvent::SessionStarted {
        call_id: CallId::new("call_new"),
        mic_device: "mic".into(),
        output_device: "out".into(),
    }));
    settle().await;
    let last = r.events.playback().pop().unwrap();
    assert_eq!(
        last.stopped_reason,
        Some(PlaybackStopReason::CaptureStarted)
    );
}
