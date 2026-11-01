//! FEATURE cpt-noter-feature-core-capture-session (part 1): the capture machine, its start
//! guard and the session commands, against a scripted engine on paused tokio time (TL-4).

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{
    BoxFuture, BundleFile, BundleSpec, CaptureEvent, ChunkSink, Clock, Core, CoreDeps,
    EnvironmentReading, EventEmitter, FetchError, ModelSource, NativeServices, Notification,
    NotificationKind, Surfaces,
};
use noter_engine_client::scripted::{Behaviour, ScriptedEngine};
use noter_engine_client::EngineLauncher;
use noter_protocol::engine::{EngineCommand, EngineEvent, StartSession};
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi, NativeSurface};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::Value;

const T0: i64 = 1_790_000_000_000;

/// The wall clock, moved by the tests.
struct TestClock(AtomicI64);

impl Clock for TestClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(self.0.load(Ordering::SeqCst))
    }
}

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

/// A Mac with this much room on the disk.
struct Mac {
    disk_free_mb: u32,
}

impl NativeServices for Mac {
    fn permission(&self, _: PermissionKind) -> PermissionState {
        PermissionState::NotAsked
    }
    fn request_permission(&self, _: PermissionKind) -> BoxFuture<'_, PermissionState> {
        Box::pin(async { PermissionState::NotAsked })
    }
    fn environment(&self) -> EnvironmentReading {
        EnvironmentReading {
            disk_free_mb: self.disk_free_mb,
            ..EnvironmentReading::default()
        }
    }
    fn set_login_item(&self, _: bool) -> Result<(), CoreError> {
        Ok(())
    }
}

/// The live model; ready once its file is in `models/`.
struct Whisper;

impl ModelSource for Whisper {
    fn manifest(&self) -> Vec<BundleSpec> {
        vec![BundleSpec {
            name: "whisper-turbo".into(),
            files: vec![BundleFile {
                path: "model.bin".into(),
                url: "https://huggingface.co/x".into(),
                size_bytes: 10,
                sha256: "0".repeat(64),
            }],
            required_for_capture: true,
        }]
    }
    fn fetch<'a>(
        &'a self,
        _: &'a BundleFile,
        _: u64,
        _: ChunkSink<'a>,
    ) -> BoxFuture<'a, Result<(), FetchError>> {
        Box::pin(async { Err(FetchError::Offline) })
    }
}

/// What the core asked the native layer to show, the notifications it posted, and whether a
/// call surface is visible.
#[derive(Default)]
struct Shown(
    Mutex<Vec<&'static str>>,
    Mutex<Vec<Notification>>,
    std::sync::atomic::AtomicBool,
);

impl Surfaces for Shown {
    fn show_record_prompt(&self) {
        self.0.lock().unwrap().push("show_record_prompt");
    }
    fn close_record_prompt(&self) {
        self.0.lock().unwrap().push("close_record_prompt");
    }
    fn show_call_window(&self, _: &noter_core::Placement) {
        self.0.lock().unwrap().push("show_call_window");
    }
    fn make_call_window_key(&self) {}
    fn place_call_window(&self, _: &noter_core::Placement, _: bool) {}
    fn hide_call_window(&self) {}
    fn hide_all(&self) {}
    fn restore_all(&self) {}
    fn set_tray(&self, _: &noter_core::TrayModel) {}
    fn announce(&self, _: &str, _: noter_protocol::model::Politeness) {}
    fn open_external(&self, _: &noter_protocol::model::ExternalTarget) {}
    fn show_window(&self, _: noter_protocol::model::WindowLabel) {}
    fn call_surface_visible(&self) -> bool {
        self.2.load(Ordering::SeqCst)
    }
    fn post_notification(&self, notification: &Notification) {
        self.1.lock().unwrap().push(notification.clone());
    }
}

struct Rig {
    core: Arc<Core>,
    engine: ScriptedEngine,
    clock: Arc<TestClock>,
    events: Arc<Events>,
    shown: Arc<Shown>,
    captured: Arc<Mutex<Vec<CaptureEvent>>>,
    _dir: tempfile::TempDir,
}

struct Setup {
    disk_free_mb: u32,
    model: bool,
    engine: Behaviour,
    /// The first engine launch fails; later ones work.
    first_launch_fails: bool,
    /// Behaviours of the next launches (after a failing first one), then the default one.
    then: Vec<Behaviour>,
    /// The self-test passed before this launch (setup done: detection is on from the start).
    self_test_passed: bool,
}

impl Default for Setup {
    fn default() -> Self {
        Self {
            disk_free_mb: 10_000,
            model: true,
            engine: Behaviour::default(),
            first_launch_fails: false,
            then: Vec::new(),
            self_test_passed: false,
        }
    }
}

fn rig_with(setup: Setup) -> Rig {
    let clock = Arc::new(TestClock(AtomicI64::new(T0)));
    rig_in(tempfile::tempdir().unwrap(), clock, setup)
}

/// A core on `dir` (a new one, or the data folder of a core that quit).
fn rig_in(dir: tempfile::TempDir, clock: Arc<TestClock>, setup: Setup) -> Rig {
    if setup.model {
        std::fs::create_dir_all(dir.path().join("models")).unwrap();
        std::fs::write(dir.path().join("models/whisper-turbo"), b"model").unwrap();
    }
    let mut engine = ScriptedEngine::new();
    if setup.first_launch_fails {
        engine = engine.then(Behaviour {
            launch_fails: true,
            ..Behaviour::default()
        });
    }
    for behaviour in setup.then {
        engine = engine.then(behaviour);
    }
    let engine = engine.with_default(setup.engine);
    let launcher: Arc<dyn EngineLauncher> = Arc::new(engine.clone());
    let events = Arc::new(Events::default());
    let shown = Arc::new(Shown::default());
    let deps = CoreDeps::new(clock.clone(), events.clone())
        .with_native(Arc::new(Mac {
            disk_free_mb: setup.disk_free_mb,
        }))
        .with_engine(launcher)
        .with_models(Arc::new(Whisper))
        .with_surfaces(shown.clone());
    let core = Arc::new(Core::open(dir.path(), deps).expect("core opens"));
    if setup.self_test_passed {
        noter_core::testing::seed_self_test(
            &core,
            SelfTestState::Passed {
                at: TimestampMs(T0),
            },
        );
    }
    core.start_first_run();
    let captured = Arc::new(Mutex::new(Vec::new()));
    let c = captured.clone();
    core.on_capture_event(move |e| c.lock().unwrap().push(e.clone()));
    Rig {
        core,
        engine,
        clock,
        events,
        shown,
        captured,
        _dir: dir,
    }
}

fn rig() -> Rig {
    rig_with(Setup::default())
}

fn main_window() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

fn menu_bar() -> CommandCtx {
    CommandCtx {
        caller: Caller::Native {
            surface: NativeSurface::MenuBar,
        },
    }
}

fn start_args() -> CaptureStartArgs {
    CaptureStartArgs {
        source: StartSource::Today,
        sensitive: false,
        detection_id: None,
        calendar_event_id: None,
    }
}

fn code<T: std::fmt::Debug>(r: Result<T, CoreError>) -> ErrorCode {
    r.unwrap_err().code
}

impl Rig {
    fn advance(&self, ms: i64) {
        self.clock.0.fetch_add(ms, Ordering::SeqCst);
    }

    fn now(&self) -> i64 {
        self.clock.0.load(Ordering::SeqCst)
    }

    async fn state(&self) -> CaptureState {
        self.core
            .app_snapshot(&main_window(), NoArgs {})
            .await
            .unwrap()
            .capture
    }

    fn sessions(&self) -> Vec<StartSession> {
        self.engine
            .commands()
            .into_iter()
            .filter_map(|c| match c {
                EngineCommand::StartSession(s) => Some(s),
                _ => None,
            })
            .collect()
    }

    /// Waits until the engine has received `n` commands that match; returns the last.
    async fn sent_n(&self, n: usize, wanted: impl Fn(&EngineCommand) -> bool) -> EngineCommand {
        for _ in 0..500 {
            let got: Vec<_> = self.engine.commands().into_iter().filter(&wanted).collect();
            if got.len() >= n {
                return got[n - 1].clone();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!(
            "the engine never got the command; got {:?}",
            self.engine.commands()
        );
    }

    async fn sent(&self, wanted: impl Fn(&EngineCommand) -> bool) -> EngineCommand {
        self.sent_n(1, wanted).await
    }

    async fn phase_becomes(&self, phase: CapturePhase) -> CaptureState {
        for _ in 0..500 {
            let s = self.state().await;
            if s.phase == phase {
                return s;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("phase never became {phase:?}: {:?}", self.state().await);
    }

    fn session_started(&self, call_id: &CallId) {
        assert!(self.engine.inject(EngineEvent::SessionStarted {
            call_id: call_id.clone(),
            mic_device: "MacBook Pro Microphone".into(),
            output_device: "MacBook Pro Speakers".into(),
        }));
    }

    fn session_stopped(&self, call_id: &CallId) {
        assert!(self.engine.inject(EngineEvent::SessionStopped {
            call_id: call_id.clone(),
            timeline_path: format!("audio/{call_id}/timeline.json"),
            mic_path: Some(format!("audio/{call_id}/mic.m4a")),
            sys_path: Some(format!("audio/{call_id}/sys.m4a")),
        }));
    }

    /// A recording call, started from `ctx`.
    async fn recording_from(&self, ctx: &CommandCtx) -> CallId {
        let starts = self.sessions().len();
        let started = self.core.capture_start(ctx, start_args()).await.unwrap();
        let call_id = started.call_id.clone().unwrap();
        self.sent_n(starts + 1, |c| matches!(c, EngineCommand::StartSession(_)))
            .await;
        self.session_started(&call_id);
        self.phase_becomes(CapturePhase::Recording).await;
        call_id
    }

    async fn recording(&self) -> CallId {
        self.recording_from(&main_window()).await
    }

    async fn stop(&self, ctx: &CommandCtx, call_id: &CallId) -> CaptureState {
        let stops = self
            .engine
            .commands()
            .iter()
            .filter(|c| matches!(c, EngineCommand::Stop { .. }))
            .count();
        let stop = {
            let core = self.core.clone();
            let ctx = ctx.clone();
            let call_id = call_id.clone();
            tokio::spawn(async move { core.capture_stop(&ctx, CallIdArgs { call_id }).await })
        };
        self.sent_n(stops + 1, |c| matches!(c, EngineCommand::Stop { .. }))
            .await;
        self.session_stopped(call_id);
        stop.await.unwrap().unwrap();
        self.phase_becomes(CapturePhase::Stopped).await
    }

    fn query<T: noter_db::rusqlite::types::FromSql + Send + 'static>(&self, sql: &str) -> T {
        let sql = sql.to_string();
        self.core
            .store()
            .read(move |c| c.query_row(&sql, [], |r| r.get(0)))
            .unwrap()
    }

    fn capture_events(&self) -> Vec<CaptureState> {
        self.events
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|(name, _)| *name == event_names::CAPTURE_STATE)
            .map(|(_, v)| serde_json::from_value(v.clone()).unwrap())
            .collect()
    }
}

// --- Start guard ---------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_start_is_refused_only_for_recording_disk_and_model() {
    // Nothing is set up: no permissions, no self-test. Only the disk and the model count.
    let low_disk = rig_with(Setup {
        disk_free_mb: 499,
        ..Setup::default()
    });
    let e = low_disk
        .core
        .capture_start(&main_window(), start_args())
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::DiskFull);
    assert_eq!(
        e.detail,
        Some(ErrorDetail::DiskSpace {
            free_mb: 499,
            needed_mb: 500
        })
    );

    let no_model = rig_with(Setup {
        model: false,
        ..Setup::default()
    });
    assert_eq!(
        code(
            no_model
                .core
                .capture_start(&main_window(), start_args())
                .await
        ),
        ErrorCode::ModelMissing
    );

    let r = rig();
    r.recording().await;
    assert_eq!(
        code(r.core.capture_start(&main_window(), start_args()).await),
        ErrorCode::AlreadyRecording
    );
    for refused in [&low_disk, &no_model] {
        assert_eq!(refused.query::<i64>("SELECT count(*) FROM calls"), 0);
        assert_eq!(refused.state().await.phase, CapturePhase::Idle);
    }
}

// --- Start ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_start_creates_the_call_and_records_once_the_engine_session_started() {
    let r = rig();
    let started = r
        .core
        .capture_start(
            &main_window(),
            CaptureStartArgs {
                sensitive: true,
                ..start_args()
            },
        )
        .await
        .unwrap();
    assert_eq!(started.phase, CapturePhase::Starting);
    let call_id = started.call_id.clone().unwrap();
    assert!(call_id.as_str().starts_with("call_"));
    assert_eq!(started.started_at, Some(TimestampMs(T0)));
    assert!(started.sensitive);

    let EngineCommand::StartSession(session) = r
        .sent(|c| matches!(c, EngineCommand::StartSession(_)))
        .await
    else {
        unreachable!()
    };
    assert_eq!(session.call_id, call_id);
    assert_eq!(session.session_dir, format!("audio/{call_id}/"));
    assert!(session.store_audio);
    assert_eq!(session.resume_from_ms, None);

    r.session_started(&call_id);
    let recording = r.phase_becomes(CapturePhase::Recording).await;
    assert_eq!(recording.call_id, Some(call_id.clone()));
    assert!(recording.audio_writing);
    assert_eq!(*r.shown.0.lock().unwrap(), ["show_call_window"]);

    let row: (String, String, i64) = r
        .core
        .store()
        .read(move |c| {
            c.query_row(
                "SELECT status, privacy_class, started_at FROM calls WHERE id = ?1",
                [call_id.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
        })
        .unwrap();
    assert_eq!(row, ("recording".into(), "sensitive".into(), T0));
    assert_eq!(
        r.query::<i64>("SELECT count(*) FROM changes WHERE entity_type = 'call'"),
        1,
        "the call row is written through the change log"
    );
    // Every change is a whole state with a higher version.
    let versions: Vec<u64> = r.capture_events().iter().map(|s| s.version.0).collect();
    assert!(
        versions.len() >= 2 && versions.windows(2).all(|w| w[0] < w[1]),
        "{versions:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn a_call_that_stores_no_audio_tells_the_engine_so() {
    let r = rig();
    let settings = r
        .core
        .settings_get(&main_window(), NoArgs {})
        .await
        .unwrap();
    let mut audio = settings.audio.clone();
    audio.retention = AudioRetention::NeverStore;
    r.core
        .settings_update(
            &main_window(),
            SettingsUpdateArgs {
                rev: settings.rev,
                section: SettingsSection::Audio(audio),
            },
        )
        .await
        .unwrap();
    let started = r
        .core
        .capture_start(&main_window(), start_args())
        .await
        .unwrap();
    assert!(started.audio_not_stored);
    let EngineCommand::StartSession(session) = r
        .sent(|c| matches!(c, EngineCommand::StartSession(_)))
        .await
    else {
        unreachable!()
    };
    assert!(!session.store_audio);
    assert_eq!(r.query::<i64>("SELECT audio_not_stored FROM calls"), 1);
}

#[tokio::test(start_paused = true)]
async fn an_engine_that_cannot_start_leaves_the_call_failed_not_refused() {
    let r = rig_with(Setup {
        engine: Behaviour {
            launch_fails: true,
            ..Behaviour::default()
        },
        ..Setup::default()
    });
    let state = r
        .core
        .capture_start(&main_window(), start_args())
        .await
        .unwrap();
    let failed = if state.phase == CapturePhase::Failed {
        state
    } else {
        r.phase_becomes(CapturePhase::Failed).await
    };
    assert!(failed.call_id.is_some());
    assert_eq!(r.query::<i64>("SELECT count(*) FROM calls"), 1);
    // A failed call can still be stopped; it ends at the last audio.
    let stopped = r
        .core
        .capture_stop(
            &main_window(),
            CallIdArgs {
                call_id: failed.call_id.unwrap(),
            },
        )
        .await
        .unwrap();
    assert_eq!(stopped.phase, CapturePhase::Stopped);
    // The post-call job writes the call's outputs (empty: nothing was heard): processing
    // becomes ready.
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(r.query::<String>("SELECT status FROM calls"), "ready");
}

// --- Pause, resume, mark -------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn pause_and_resume_record_a_paused_gap_and_wanted_state_is_idempotent() {
    let r = rig();
    let call_id = r.recording().await;
    r.advance(60_000);
    let pause = |paused| CapturePauseArgs {
        call_id: call_id.clone(),
        paused,
    };
    let paused = r
        .core
        .capture_set_paused(&main_window(), pause(true))
        .await
        .unwrap();
    assert_eq!(paused.phase, CapturePhase::Paused);
    assert_eq!(
        paused.pause.as_ref().map(|p| p.since),
        Some(TimestampMs(T0 + 60_000))
    );
    assert_eq!(paused.recorded_ms, DurationMs(60_000));
    assert_eq!(r.query::<String>("SELECT status FROM calls"), "paused");
    r.sent(|c| matches!(c, EngineCommand::Pause { .. })).await;

    let events_before = r.capture_events().len();
    let again = r
        .core
        .capture_set_paused(&main_window(), pause(true))
        .await
        .unwrap();
    assert_eq!(again, paused, "the wanted state is already there");
    assert_eq!(r.capture_events().len(), events_before);

    r.advance(30_000);
    let resumed = r
        .core
        .capture_set_paused(&main_window(), pause(false))
        .await
        .unwrap();
    assert_eq!(resumed.phase, CapturePhase::Recording);
    assert_eq!(resumed.pause, None);
    assert_eq!(r.query::<String>("SELECT status FROM calls"), "recording");
    r.sent(|c| matches!(c, EngineCommand::Resume { .. })).await;
    let gap: (i64, i64, String) = r
        .core
        .store()
        .read(|c| {
            c.query_row("SELECT t0_ms, t1_ms, reason FROM gaps", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
        })
        .unwrap();
    assert_eq!(gap, (60_000, 90_000, "paused".into()));
    assert!(r.captured.lock().unwrap().iter().any(|e| matches!(
        e,
        CaptureEvent::Gap(g) if g.reason == GapReason::Paused && g.t1_ms == OffsetMs(90_000)
    )));

    // Another call id, or no live call, is not recording.
    let other = CapturePauseArgs {
        call_id: CallId::new("call_other"),
        paused: true,
    };
    assert_eq!(
        code(r.core.capture_set_paused(&main_window(), other).await),
        ErrorCode::NotRecording
    );
    r.stop(&main_window(), &call_id).await;
    assert_eq!(
        code(
            r.core
                .capture_set_paused(&main_window(), pause(false))
                .await
        ),
        ErrorCode::NotRecording
    );
}

#[tokio::test(start_paused = true)]
async fn a_mark_is_stored_at_the_call_offset_and_handed_to_the_transcript() {
    let r = rig();
    let none = MarkMomentArgs {
        call_id: CallId::new("call_none"),
        note: None,
    };
    assert_eq!(
        code(r.core.capture_mark_moment(&main_window(), none).await),
        ErrorCode::NotRecording
    );
    let call_id = r.recording().await;
    r.advance(1_260_000);
    let mark = r
        .core
        .capture_mark_moment(
            &main_window(),
            MarkMomentArgs {
                call_id: call_id.clone(),
                note: Some("decision".into()),
            },
        )
        .await
        .unwrap();
    assert!(mark.id.as_str().starts_with("mrk_"));
    assert_eq!(mark.call_id, call_id);
    assert_eq!(mark.at_ms, OffsetMs(1_260_000));
    assert_eq!(mark.note.as_deref(), Some("decision"));
    let stored: (i64, String) = r
        .core
        .store()
        .read(|c| {
            c.query_row("SELECT at_ms, note FROM marks", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
        })
        .unwrap();
    assert_eq!(stored, (1_260_000, "decision".into()));
    assert_eq!(
        r.query::<i64>("SELECT count(*) FROM changes WHERE entity_type = 'mark'"),
        0,
        "capture data has no change row (TL-1)"
    );
    assert!(r
        .captured
        .lock()
        .unwrap()
        .contains(&CaptureEvent::Mark(mark)));
}

// --- Stop, continue, discard ---------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn stop_ends_the_call_and_offers_continue_for_five_minutes() {
    let r = rig();
    let call_id = r.recording().await;
    r.advance(120_000);
    r.core
        .capture_set_paused(
            &main_window(),
            CapturePauseArgs {
                call_id: call_id.clone(),
                paused: true,
            },
        )
        .await
        .unwrap();
    r.advance(20_000);
    let stopped = r.stop(&main_window(), &call_id).await;
    assert_eq!(stopped.continue_until, Some(TimestampMs(r.now() + 300_000)));
    assert_eq!(stopped.recorded_ms, DurationMs(120_000), "pauses excluded");
    assert_eq!(stopped.pause, None);
    let row: (String, i64) = r
        .core
        .store()
        .read(|c| {
            c.query_row("SELECT status, ended_at FROM calls", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
        })
        .unwrap();
    assert_eq!(row, ("ready".into(), T0 + 140_000));
    // Stopping while paused closes the paused gap at the stop.
    assert_eq!(
        r.query::<i64>("SELECT t1_ms FROM gaps WHERE reason = 'paused'"),
        140_000
    );
    assert!(r.captured.lock().unwrap().contains(&CaptureEvent::Stopped {
        call_id: call_id.clone(),
        reason: StreamEndReason::CallStopped,
    }));
    // A second stop of the stopped call answers the state.
    let again = r
        .core
        .capture_stop(&main_window(), CallIdArgs { call_id })
        .await
        .unwrap();
    assert_eq!(again.phase, CapturePhase::Stopped);
}

#[tokio::test(start_paused = true)]
async fn continue_appends_to_the_same_call_within_the_window() {
    let r = rig();
    let call_id = r.recording().await;
    r.advance(100_000);
    r.stop(&main_window(), &call_id).await;
    r.advance(60_000);
    let continued = r
        .core
        .capture_continue(
            &main_window(),
            CallIdArgs {
                call_id: call_id.clone(),
            },
        )
        .await
        .unwrap();
    assert_eq!(continued.phase, CapturePhase::Recording);
    assert_eq!(continued.call_id, Some(call_id.clone()));
    assert_eq!(continued.continue_until, None);
    let EngineCommand::StartSession(second) = r
        .sent_n(2, |c| matches!(c, EngineCommand::StartSession(_)))
        .await
    else {
        unreachable!()
    };
    assert_eq!(second.call_id, call_id);
    assert_eq!(second.resume_from_ms, Some(OffsetMs(160_000)));
    assert_eq!(
        r.query::<String>("SELECT t0_ms || '-' || t1_ms FROM gaps WHERE reason = 'continued'"),
        "100000-160000"
    );
    assert_eq!(r.query::<String>("SELECT status FROM calls"), "recording");
    assert_eq!(r.query::<i64>("SELECT count(*) FROM calls"), 1);

    // After the window closed, Continue is refused.
    r.session_started(&call_id);
    r.stop(&main_window(), &call_id).await;
    r.advance(300_001);
    assert_eq!(
        code(
            r.core
                .capture_continue(&main_window(), CallIdArgs { call_id })
                .await
        ),
        ErrorCode::ContinueWindowClosed
    );
}

#[tokio::test(start_paused = true)]
async fn a_start_while_stopped_closes_the_continue_window_and_starts_a_new_call() {
    let r = rig();
    let first = r.recording().await;
    r.stop(&main_window(), &first).await;
    let second = r.recording().await;
    assert_ne!(first, second);
    assert_eq!(r.query::<i64>("SELECT count(*) FROM calls"), 2);
    r.stop(&main_window(), &second).await;
    assert_eq!(
        code(
            r.core
                .capture_continue(&main_window(), CallIdArgs { call_id: first })
                .await
        ),
        ErrorCode::ContinueWindowClosed
    );
}

#[tokio::test(start_paused = true)]
async fn discard_needs_the_nothing_heard_notice() {
    let r = rig();
    let call_id = r.recording().await;
    assert_eq!(
        code(
            r.core
                .capture_discard(&main_window(), CallIdArgs { call_id })
                .await
        ),
        ErrorCode::NoticeExpired
    );
    assert_eq!(r.state().await.phase, CapturePhase::Recording);
}

// --- Sensitive -----------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_live_call_can_be_made_sensitive_but_not_turned_back() {
    let r = rig();
    let call_id = r.recording().await;
    let args = |sensitive| SensitiveArgs {
        call_id: call_id.clone(),
        sensitive,
    };
    let state = r
        .core
        .capture_set_sensitive(&main_window(), args(true))
        .await
        .unwrap();
    assert!(state.sensitive);
    assert_eq!(
        r.query::<String>("SELECT privacy_class FROM calls"),
        "sensitive"
    );
    // Windows that show the call replace it from entity:changed.
    let changed: Vec<Value> = r
        .events
        .0
        .lock()
        .unwrap()
        .iter()
        .filter(|(name, _)| *name == event_names::ENTITY_CHANGED)
        .map(|(_, v)| v.clone())
        .collect();
    let call = changed.last().expect("entity:changed for the call");
    assert_eq!(call["type"], "call");
    assert_eq!(call["call"]["id"], call_id.as_str());
    assert_eq!(call["call"]["privacy"], "sensitive");
    assert_eq!(
        code(
            r.core
                .capture_set_sensitive(&main_window(), args(false))
                .await
        ),
        ErrorCode::InvalidInput
    );
    r.stop(&main_window(), &call_id).await;
    r.core
        .capture_set_sensitive(&main_window(), args(false))
        .await
        .unwrap();
    assert_eq!(
        r.query::<String>("SELECT privacy_class FROM calls"),
        "normal"
    );
    let unknown = SensitiveArgs {
        call_id: CallId::new("call_none"),
        sensitive: true,
    };
    assert_eq!(
        code(r.core.capture_set_sensitive(&main_window(), unknown).await),
        ErrorCode::NotFound
    );
}

// --- Same function from every surface ------------------------------------------------

#[tokio::test(start_paused = true)]
async fn start_pause_mark_and_stop_work_from_the_menu_bar() {
    let r = rig();
    let call_id = r.recording_from(&menu_bar()).await;
    r.core
        .capture_set_paused(
            &menu_bar(),
            CapturePauseArgs {
                call_id: call_id.clone(),
                paused: true,
            },
        )
        .await
        .unwrap();
    r.core
        .capture_mark_moment(
            &menu_bar(),
            MarkMomentArgs {
                call_id: call_id.clone(),
                note: None,
            },
        )
        .await
        .unwrap();
    r.stop(&menu_bar(), &call_id).await;
    assert_eq!(r.query::<i64>("SELECT count(*) FROM marks"), 1);
    // Every change row of the call names the menu bar: start, pause and stop. The ready row
    // follows the transcript file, not the command, so it names no surface.
    assert_eq!(
        r.query::<i64>(
            "SELECT count(*) FROM changes WHERE entity_type = 'call' AND surface IS NOT 'menu_bar' AND summary != 'Call ready'"
        ),
        0
    );
    assert!(r.query::<i64>("SELECT count(*) FROM changes WHERE surface = 'menu_bar'") >= 3);
}

// --- Live glossary -------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_glossary_edit_reaches_the_live_call_only() {
    let r = rig();
    let upsert = |term: &str| GlossaryUpsertArgs {
        id: None,
        rev: None,
        term: term.into(),
        variants_latin: vec![],
        variants_cyrillic: vec![],
        spoken_forms: vec![],
        lang: None,
        always_apply: false,
    };
    let call_id = r.recording().await;
    r.core
        .glossary_upsert(&main_window(), upsert("Kubernetes"))
        .await
        .unwrap();
    let EngineCommand::SetGlossary { entries } = r
        .sent(|c| matches!(c, EngineCommand::SetGlossary { .. }))
        .await
    else {
        unreachable!()
    };
    assert_eq!(entries[0].term, "Kubernetes");
    r.stop(&main_window(), &call_id).await;
    r.core
        .glossary_upsert(&main_window(), upsert("Terraform"))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let sent = r
        .engine
        .commands()
        .into_iter()
        .filter(|c| matches!(c, EngineCommand::SetGlossary { .. }))
        .count();
    assert_eq!(sent, 1, "no glossary for a stopped call");
}

// --- The phase machine, transition by transition -------------------------------------

#[tokio::test(start_paused = true)]
async fn every_transition_of_part_one_lands_in_its_phase() {
    use CapturePhase::*;
    let r = rig();
    let mut seen = vec![r.state().await.phase];
    let call_id = r.recording().await;
    seen.push(r.state().await.phase);
    let pause = |paused| CapturePauseArgs {
        call_id: call_id.clone(),
        paused,
    };
    let ctx = main_window();
    seen.push(
        r.core
            .capture_set_paused(&ctx, pause(true))
            .await
            .unwrap()
            .phase,
    );
    seen.push(
        r.core
            .capture_set_paused(&ctx, pause(false))
            .await
            .unwrap()
            .phase,
    );
    seen.push(r.stop(&ctx, &call_id).await.phase);
    let again = CallIdArgs {
        call_id: call_id.clone(),
    };
    seen.push(r.core.capture_continue(&ctx, again).await.unwrap().phase);
    r.session_started(&call_id);
    seen.push(r.stop(&ctx, &call_id).await.phase);
    assert_eq!(
        seen,
        [Idle, Recording, Paused, Recording, Stopped, Recording, Stopped]
    );
    let phases: Vec<CapturePhase> = r.capture_events().iter().map(|s| s.phase).collect();
    for wanted in [Starting, Recording, Paused, Stopping, Stopped] {
        assert!(phases.contains(&wanted), "{wanted:?} in {phases:?}");
    }
}

// === Part 2: detection, notices and timers ===========================================

const ZOOM: &str = "us.zoom.xos";
const TEAMS: &str = "com.microsoft.teams2";

impl Rig {
    /// Moves the wall clock and tokio time together, a second at a time so the engine keeps
    /// answering its liveness pings, and lets due timers run.
    async fn pass(&self, ms: i64) {
        let mut left = ms;
        while left > 0 {
            let step = left.min(1_000);
            self.advance(step);
            tokio::time::advance(Duration::from_millis(step as u64)).await;
            for _ in 0..10 {
                tokio::task::yield_now().await;
            }
            left -= step;
        }
    }

    async fn offer_to_record(&self, on: bool) {
        let settings = self
            .core
            .settings_get(&main_window(), NoArgs {})
            .await
            .unwrap();
        let mut general = settings.general.clone();
        general.offer_to_record = on;
        self.core
            .settings_update(
                &main_window(),
                SettingsUpdateArgs {
                    rev: settings.rev,
                    section: SettingsSection::General(general),
                },
            )
            .await
            .unwrap();
    }

    /// Detection runs: the self-test passed (Offer to Record is on by default).
    async fn detection_on(&self) {
        noter_core::testing::seed_self_test(
            &self.core,
            SelfTestState::Passed {
                at: TimestampMs(T0),
            },
        );
        // The engine must be up to hear facts.
        let _ = self.core.app_snapshot(&main_window(), NoArgs {}).await;
        self.sent(|c| matches!(c, EngineCommand::SetDetection { enabled: true, .. }))
            .await;
    }

    fn fact(&self, event: EngineEvent) {
        assert!(self.engine.inject(event));
    }

    fn call_detected(&self, bundle_id: &str, app_name: &str) {
        self.fact(EngineEvent::CallDetected {
            bundle_id: bundle_id.into(),
            app_name: app_name.into(),
            pid: 4242,
        });
    }

    async fn detection(&self) -> Option<CallDetection> {
        self.core
            .app_snapshot(&main_window(), NoArgs {})
            .await
            .unwrap()
            .detection
            .detection
    }

    async fn detection_becomes(
        &self,
        wanted: impl Fn(&Option<CallDetection>) -> bool,
    ) -> Option<CallDetection> {
        for _ in 0..200 {
            let d = self.detection().await;
            if wanted(&d) {
                return d;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        panic!("detection never matched: {:?}", self.detection().await);
    }

    async fn notice_becomes(
        &self,
        wanted: impl Fn(&Option<CaptureNotice>) -> bool,
    ) -> CaptureState {
        for _ in 0..200 {
            let s = self.state().await;
            if wanted(&s.notice) {
                return s;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        panic!("notice never matched: {:?}", self.state().await);
    }

    async fn degraded(&self) -> Vec<DegradedState> {
        self.core
            .app_snapshot(&main_window(), NoArgs {})
            .await
            .unwrap()
            .degraded
            .states
    }

    /// A recording call started from the record prompt of a detected `app`.
    async fn recording_detected(&self, bundle_id: &str, app_name: &str) -> CallId {
        self.call_detected(bundle_id, app_name);
        let detection = self.detection_becomes(|d| d.is_some()).await.unwrap();
        let starts = self.sessions().len();
        let started = self
            .core
            .capture_start(
                &main_window(),
                CaptureStartArgs {
                    source: StartSource::RecordPrompt,
                    detection_id: Some(detection.id),
                    ..start_args()
                },
            )
            .await
            .unwrap();
        let call_id = started.call_id.unwrap();
        self.sent_n(starts + 1, |c| matches!(c, EngineCommand::StartSession(_)))
            .await;
        self.session_started(&call_id);
        self.phase_becomes(CapturePhase::Recording).await;
        call_id
    }

    /// Answers the engine's next `stop` with `session_stopped`.
    async fn answer_stop(&self, call_id: &CallId, stops_before: usize) {
        self.sent_n(stops_before + 1, |c| {
            matches!(c, EngineCommand::Stop { .. })
        })
        .await;
        self.session_stopped(call_id);
    }

    fn stops(&self) -> usize {
        self.engine
            .commands()
            .iter()
            .filter(|c| matches!(c, EngineCommand::Stop { .. }))
            .count()
    }
}

// --- Detection -----------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn the_engine_hears_the_meeting_apps_and_browsers_minus_the_ignored_ones() {
    let r = rig();
    r.detection_on().await;
    let EngineCommand::SetDetection {
        known_bundle_ids, ..
    } = r
        .sent(|c| matches!(c, EngineCommand::SetDetection { enabled: true, .. }))
        .await
    else {
        unreachable!()
    };
    // D-24: both lists by bundle id, Teams under its old and new ids.
    for app in [
        ZOOM,
        TEAMS,
        "com.microsoft.teams",
        "com.hnc.Discord",
        "com.apple.FaceTime",
        "com.google.Chrome",
        "org.chromium.Chromium",
        "com.brave.Browser",
        "com.vivaldi.Vivaldi",
    ] {
        assert!(
            known_bundle_ids.iter().any(|b| b == app),
            "{app} in {known_bundle_ids:?}"
        );
    }
    r.core
        .capture_ignore_app(
            &menu_bar(),
            IgnoreAppArgs {
                bundle_id: ZOOM.into(),
                app_name: "Zoom".into(),
            },
        )
        .await
        .unwrap();
    r.core
        .capture_ignore_app(
            &menu_bar(),
            IgnoreAppArgs {
                bundle_id: "com.brave.Browser".into(),
                app_name: "Brave Browser".into(),
            },
        )
        .await
        .unwrap();
    let EngineCommand::SetDetection {
        known_bundle_ids, ..
    } = r
        .sent_n(3, |c| {
            matches!(c, EngineCommand::SetDetection { enabled: true, .. })
        })
        .await
    else {
        unreachable!()
    };
    assert!(!known_bundle_ids
        .iter()
        .any(|b| b == ZOOM || b == "com.brave.Browser"));
    assert!(known_bundle_ids.iter().any(|b| b == "com.apple.Safari"));
}

#[tokio::test(start_paused = true)]
async fn a_call_detected_while_hidden_for_presenting_draws_no_prompt() {
    let r = rig();
    r.detection_on().await;
    r.offer_to_record(true).await;
    noter_core::testing::seed_presenting(&r.core, true);
    r.call_detected(ZOOM, "Zoom");
    // The menu still offers it (Call Detected · Start Recording); nothing is drawn.
    let d = r.detection_becomes(|d| d.is_some()).await;
    assert!(d.is_some());
    assert!(!r.shown.0.lock().unwrap().contains(&"show_record_prompt"));
}

#[tokio::test(start_paused = true)]
async fn a_detected_call_shows_the_prompt_for_fifteen_seconds_only_when_detection_is_on() {
    let r = rig();
    r.detection_on().await;
    r.offer_to_record(false).await;
    r.call_detected(ZOOM, "Zoom");
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(r.detection().await, None, "Offer to Record is off");

    r.offer_to_record(true).await;
    r.call_detected(ZOOM, "Zoom");
    let d = r.detection_becomes(|d| d.is_some()).await.unwrap();
    assert!(d.id.as_str().starts_with("det_"));
    assert_eq!((d.app_name.as_str(), d.bundle_id.as_str()), ("Zoom", ZOOM));
    assert_eq!(d.detected_at, TimestampMs(r.now()));
    assert_eq!(d.prompt_until, TimestampMs(r.now() + 15_000));
    assert_eq!(d.blocked, None);
    assert_eq!(d.matched_event, None, "no calendar until native surfaces");
    assert!(r.shown.0.lock().unwrap().contains(&"show_record_prompt"));
    assert!(r
        .events
        .0
        .lock()
        .unwrap()
        .iter()
        .any(|(name, _)| *name == event_names::CAPTURE_DETECTED));

    // The meeting app lets go of the audio before anyone recorded: the detection goes.
    r.fact(EngineEvent::CallAudioReleased {
        bundle_id: ZOOM.into(),
    });
    r.detection_becomes(|d| d.is_none()).await;

    // Not while a capture runs.
    r.recording().await;
    r.call_detected(TEAMS, "Microsoft Teams");
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(r.detection().await, None);
}

#[tokio::test(start_paused = true)]
async fn the_prompt_names_why_record_would_be_refused() {
    let r = rig_with(Setup {
        disk_free_mb: 300,
        ..Setup::default()
    });
    r.detection_on().await;
    r.call_detected(ZOOM, "Zoom");
    let d = r.detection_becomes(|d| d.is_some()).await.unwrap();
    assert_eq!(d.blocked, Some(StartBlocked::DiskFull));
}

#[tokio::test(start_paused = true)]
async fn record_on_the_prompt_starts_the_call_named_after_the_app() {
    let r = rig();
    r.detection_on().await;
    let call_id = r.recording_detected(ZOOM, "Zoom").await;
    let state = r.state().await;
    assert_eq!(state.title.as_deref(), Some("Zoom"));
    let id = call_id.clone();
    let (title, platform): (String, String) = r
        .core
        .store()
        .read(move |c| {
            c.query_row(
                "SELECT title, platform FROM calls WHERE id = ?1",
                [id.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
        })
        .unwrap();
    assert_eq!((title.as_str(), platform.as_str()), ("Zoom", "Zoom"));
    assert_eq!(r.detection().await, None, "the detection was used");
    assert!(r.shown.0.lock().unwrap().contains(&"close_record_prompt"));
}

#[tokio::test(start_paused = true)]
async fn a_missed_prompt_keeps_the_detection_for_the_menu_bar_and_the_hotkey() {
    let r = rig();
    r.detection_on().await;
    r.call_detected(ZOOM, "Zoom");
    let d = r.detection_becomes(|d| d.is_some()).await.unwrap();
    r.pass(16_000).await;
    let from_prompt = CaptureStartArgs {
        source: StartSource::RecordPrompt,
        detection_id: Some(d.id.clone()),
        ..start_args()
    };
    assert_eq!(
        code(r.core.capture_start(&main_window(), from_prompt).await),
        ErrorCode::DetectionExpired
    );
    // The prompt says it timed out: it closes, the detection stays, no second prompt.
    r.core
        .capture_dismiss_detection(
            &main_window(),
            DismissDetectionArgs {
                detection_id: d.id.clone(),
                reason: DismissReason::TimedOut,
            },
        )
        .await
        .unwrap();
    let kept = r.detection().await.unwrap();
    assert_eq!(kept.id, d.id);
    assert_eq!(kept.prompt_until, TimestampMs(r.now()));
    r.call_detected(ZOOM, "Zoom");
    tokio::time::sleep(Duration::from_millis(50)).await;
    let prompts = r
        .shown
        .0
        .lock()
        .unwrap()
        .iter()
        .filter(|s| **s == "show_record_prompt")
        .count();
    assert_eq!(prompts, 1, "never prompted twice for this call");

    // The start hotkey still starts it, named after the app.
    let started = r
        .core
        .capture_start(
            &CommandCtx {
                caller: Caller::Native {
                    surface: NativeSurface::Hotkey,
                },
            },
            CaptureStartArgs {
                source: StartSource::Hotkey,
                detection_id: Some(d.id),
                ..start_args()
            },
        )
        .await
        .unwrap();
    assert_eq!(started.title.as_deref(), Some("Zoom"));
}

#[tokio::test(start_paused = true)]
async fn dont_ask_for_an_app_ignores_it_from_then_on() {
    let r = rig();
    r.detection_on().await;
    r.call_detected(ZOOM, "Zoom");
    r.detection_becomes(|d| d.is_some()).await;
    r.core
        .capture_ignore_app(
            &main_window(),
            IgnoreAppArgs {
                bundle_id: ZOOM.into(),
                app_name: "Zoom".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(r.detection().await, None);
    let settings = r
        .core
        .settings_get(&main_window(), NoArgs {})
        .await
        .unwrap();
    assert!(settings
        .general
        .ignored_apps
        .iter()
        .any(|a| a.bundle_id == ZOOM));
    r.call_detected(ZOOM, "Zoom");
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(r.detection().await, None);
    // An unknown detection is gone already.
    assert_eq!(
        code(
            r.core
                .capture_dismiss_detection(
                    &main_window(),
                    DismissDetectionArgs {
                        detection_id: DetectionId::new("det_gone"),
                        reason: DismissReason::NotNow,
                    },
                )
                .await
        ),
        ErrorCode::DetectionExpired
    );
}

// --- Call end ------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn the_call_ended_notice_counts_down_holds_and_stops_by_itself() {
    let r = rig();
    r.detection_on().await;
    let call_id = r.recording_detected(ZOOM, "Zoom").await;
    let answer = |choice| CallEndAnswerArgs {
        call_id: call_id.clone(),
        choice,
    };
    assert_eq!(
        code(
            r.core
                .capture_answer_call_end(&main_window(), answer(CallEndChoice::KeepRecording))
                .await
        ),
        ErrorCode::NoticeExpired
    );
    r.fact(EngineEvent::CallAudioReleased {
        bundle_id: ZOOM.into(),
    });
    tokio::time::sleep(Duration::from_millis(5)).await;
    r.pass(19_000).await;
    assert_eq!(r.state().await.notice, None, "20 s first");
    r.pass(1_000).await;
    let s = r.notice_becomes(|n| n.is_some()).await;
    assert_eq!(
        s.notice,
        Some(CaptureNotice::CallEnded {
            stops_at: Some(TimestampMs(r.now() + 10_000))
        })
    );
    // Keep Recording clears it.
    r.core
        .capture_answer_call_end(&main_window(), answer(CallEndChoice::KeepRecording))
        .await
        .unwrap();
    assert_eq!(r.state().await.notice, None);

    // Released again: held while the pointer is on it, then 10 s again from the release.
    r.fact(EngineEvent::CallAudioReleased {
        bundle_id: ZOOM.into(),
    });
    tokio::time::sleep(Duration::from_millis(5)).await;
    r.pass(20_000).await;
    r.notice_becomes(|n| n.is_some()).await;
    let hold = |held| NoticeHoldArgs {
        call_id: call_id.clone(),
        held,
    };
    let held = r
        .core
        .capture_hold_notice(&main_window(), hold(true))
        .await
        .unwrap();
    assert_eq!(
        held.notice,
        Some(CaptureNotice::CallEnded { stops_at: None })
    );
    r.pass(30_000).await;
    assert_eq!(
        r.state().await.phase,
        CapturePhase::Recording,
        "held, no stop"
    );
    let released = r
        .core
        .capture_hold_notice(&main_window(), hold(false))
        .await
        .unwrap();
    assert_eq!(
        released.notice,
        Some(CaptureNotice::CallEnded {
            stops_at: Some(TimestampMs(r.now() + 10_000))
        })
    );
    let stops = r.stops();
    r.pass(10_000).await;
    r.answer_stop(&call_id, stops).await;
    let stopped = r.phase_becomes(CapturePhase::Stopped).await;
    assert_eq!(
        stopped.notice,
        Some(CaptureNotice::StoppedAutomatically {
            call_id: call_id.clone()
        })
    );
    // Continue is still offered after an automatic stop.
    assert!(stopped.continue_until.is_some());
}

#[tokio::test(start_paused = true)]
async fn stop_now_on_the_notice_stops_at_once() {
    let r = rig();
    r.detection_on().await;
    let call_id = r.recording_detected(ZOOM, "Zoom").await;
    r.fact(EngineEvent::CallAudioReleased {
        bundle_id: ZOOM.into(),
    });
    tokio::time::sleep(Duration::from_millis(5)).await;
    r.pass(20_000).await;
    r.notice_becomes(|n| n.is_some()).await;
    let stops = r.stops();
    let answer = {
        let core = r.core.clone();
        let call_id = call_id.clone();
        tokio::spawn(async move {
            core.capture_answer_call_end(
                &main_window(),
                CallEndAnswerArgs {
                    call_id,
                    choice: CallEndChoice::StopNow,
                },
            )
            .await
        })
    };
    r.answer_stop(&call_id, stops).await;
    assert_eq!(answer.await.unwrap().unwrap().phase, CapturePhase::Stopped);
}

#[tokio::test(start_paused = true)]
async fn while_hidden_for_presenting_the_call_seems_ended_for_ten_minutes() {
    let r = rig();
    r.detection_on().await;
    r.recording_detected(ZOOM, "Zoom").await;
    noter_core::testing::seed_presenting(&r.core, true);
    r.fact(EngineEvent::CallAudioReleased {
        bundle_id: ZOOM.into(),
    });
    tokio::time::sleep(Duration::from_millis(5)).await;
    r.pass(20_000).await;
    let s = r.notice_becomes(|n| n.is_some()).await;
    assert_eq!(
        s.notice,
        Some(CaptureNotice::CallSeemsEnded {
            stops_at: TimestampMs(r.now() + 600_000)
        })
    );
}

// --- Nothing heard, discard ----------------------------------------------------------

fn segment(call_id: &CallId) -> EngineEvent {
    EngineEvent::Segment {
        segment: noter_protocol::engine::EngineSegment {
            id: "e1".into(),
            call_id: call_id.clone(),
            channel: AudioChannel::Sys,
            t0_ms: OffsetMs(0),
            t1_ms: OffsetMs(900),
            state: noter_protocol::engine::EngineSegmentState::Confirmed,
            lang: Lang::En,
            lang_p: 0.9,
            speaker_label: "spk_1".into(),
            text: "Hello".into(),
            words_path: None,
            avg_logprob: -0.2,
            no_speech_p: 0.01,
            corrections: vec![],
            crosstalk_labels: vec![],
        },
    }
}

#[tokio::test(start_paused = true)]
async fn nothing_heard_for_five_minutes_offers_keep_or_discard() {
    let r = rig();
    let call_id = r.recording().await;
    let started = r.now();
    r.pass(299_000).await;
    assert_eq!(r.state().await.notice, None);
    r.pass(1_000).await;
    let s = r.notice_becomes(|n| n.is_some()).await;
    assert_eq!(
        s.notice,
        Some(CaptureNotice::NothingHeard {
            since: TimestampMs(started)
        })
    );
    // Keep Recording: the 5 minutes start again.
    r.core
        .capture_keep_recording(
            &main_window(),
            CallIdArgs {
                call_id: call_id.clone(),
            },
        )
        .await
        .unwrap();
    assert_eq!(r.state().await.notice, None);
    r.pass(300_000).await;
    r.notice_becomes(|n| matches!(n, Some(CaptureNotice::NothingHeard { .. })))
        .await;

    // Discard: nothing is kept.
    let stops = r.stops();
    let discard = {
        let core = r.core.clone();
        let call_id = call_id.clone();
        tokio::spawn(async move {
            core.capture_discard(&main_window(), CallIdArgs { call_id })
                .await
        })
    };
    r.answer_stop(&call_id, stops).await;
    let idle = discard.await.unwrap().unwrap();
    assert_eq!(idle.phase, CapturePhase::Idle);
    assert_eq!(idle.call_id, None);
    assert_eq!(r.query::<i64>("SELECT count(*) FROM calls"), 0);
    assert_eq!(
        r.query::<i64>("SELECT count(*) FROM changes WHERE entity_type = 'call' AND undoable = 0 AND field IS NULL AND delta IS NULL AND reason = 'capture_discard'"),
        1
    );
    assert!(r.captured.lock().unwrap().contains(&CaptureEvent::Stopped {
        call_id,
        reason: StreamEndReason::Discarded,
    }));
}

#[tokio::test(start_paused = true)]
async fn a_heard_segment_means_no_nothing_heard_notice() {
    let r = rig();
    let call_id = r.recording().await;
    r.pass(60_000).await;
    r.fact(segment(&call_id));
    tokio::time::sleep(Duration::from_millis(5)).await;
    r.pass(250_000).await;
    assert_eq!(r.state().await.notice, None);
    r.pass(50_000).await;
    r.notice_becomes(|n| matches!(n, Some(CaptureNotice::NothingHeard { .. })))
        .await;
    assert_eq!(
        code(
            r.core
                .capture_keep_recording(
                    &main_window(),
                    CallIdArgs {
                        call_id: CallId::new("call_x")
                    }
                )
                .await
        ),
        ErrorCode::NoticeExpired
    );
}

// --- New meeting ---------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_new_meeting_splits_the_call_unless_kept() {
    let r = rig();
    r.detection_on().await;
    let first = r.recording_detected(ZOOM, "Zoom").await;
    r.pass(30_000).await;
    r.call_detected(TEAMS, "Microsoft Teams");
    let s = r.notice_becomes(|n| n.is_some()).await;
    let detected_at = r.now();
    assert_eq!(
        s.notice,
        Some(CaptureNotice::NewMeeting {
            event: None,
            app_name: Some("Microsoft Teams".into()),
            detected_at: TimestampMs(detected_at),
            expires_at: TimestampMs(detected_at + 60_000),
            default_choice: NewMeetingChoice::StartAsNewCall,
        })
    );
    // Keep in This Call.
    let answer = |call_id: &CallId, choice| NewMeetingAnswerArgs {
        call_id: call_id.clone(),
        choice,
    };
    r.core
        .capture_answer_new_meeting(
            &main_window(),
            answer(&first, NewMeetingChoice::KeepInThisCall),
        )
        .await
        .unwrap();
    assert_eq!(r.state().await.notice, None);
    assert_eq!(
        code(
            r.core
                .capture_answer_new_meeting(
                    &main_window(),
                    answer(&first, NewMeetingChoice::KeepInThisCall)
                )
                .await
        ),
        ErrorCode::NoticeExpired
    );

    // Unanswered for 60 s: Start as New Call, split at detected_at.
    r.call_detected(TEAMS, "Microsoft Teams");
    r.notice_becomes(|n| n.is_some()).await;
    let detected_at = r.now();
    let stops = r.stops();
    let starts = r.sessions().len();
    r.pass(60_000).await;
    r.answer_stop(&first, stops).await;
    let EngineCommand::StartSession(next) = r
        .sent_n(starts + 1, |c| matches!(c, EngineCommand::StartSession(_)))
        .await
    else {
        unreachable!()
    };
    assert_ne!(next.call_id, first);
    r.session_started(&next.call_id);
    let s = r.phase_becomes(CapturePhase::Recording).await;
    assert_eq!(s.call_id, Some(next.call_id.clone()));
    assert_eq!(s.title.as_deref(), Some("Microsoft Teams"));
    assert_eq!(s.started_at, Some(TimestampMs(detected_at)));
    let id = first.clone();
    let ended: i64 = r
        .core
        .store()
        .read(move |c| {
            c.query_row(
                "SELECT ended_at FROM calls WHERE id = ?1",
                [id.as_str()],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(
        ended, detected_at,
        "the first call ends where the new meeting began"
    );
    // D-33: the saved call is closed for good; only the live call can be continued.
    assert_eq!(
        code(
            r.core
                .capture_continue(&main_window(), CallIdArgs { call_id: first })
                .await
        ),
        ErrorCode::ContinueWindowClosed
    );
}

// --- Second audio source -------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_second_audio_source_is_kept_or_excluded() {
    let r = rig();
    let call_id = r.recording().await;
    let added = |bundle: &str, name: &str| EngineEvent::AudioSourceAdded {
        call_id: call_id.clone(),
        bundle_id: bundle.into(),
        app_name: name.into(),
    };
    let second = |states: &[DegradedState]| {
        states
            .iter()
            .filter_map(|s| match s {
                DegradedState::SecondAudioSource { bundle_id, .. } => Some(bundle_id.clone()),
                _ => None,
            })
            .collect::<Vec<_>>()
    };
    r.fact(added("com.spotify.client", "Spotify"));
    tokio::time::sleep(Duration::from_millis(5)).await;
    assert_eq!(second(&r.degraded().await), ["com.spotify.client"]);
    r.core
        .capture_keep_source(
            &main_window(),
            KeepSourceArgs {
                call_id: call_id.clone(),
                bundle_id: "com.spotify.client".into(),
            },
        )
        .await
        .unwrap();
    assert!(second(&r.degraded().await).is_empty());
    // Kept: not raised again for this app in this call.
    r.fact(added("com.spotify.client", "Spotify"));
    tokio::time::sleep(Duration::from_millis(5)).await;
    assert!(second(&r.degraded().await).is_empty());

    r.fact(added("com.apple.Music", "Music"));
    tokio::time::sleep(Duration::from_millis(5)).await;
    r.core
        .capture_exclude_source(
            &main_window(),
            ExcludeSourceArgs {
                call_id: call_id.clone(),
                bundle_id: "com.apple.Music".into(),
            },
        )
        .await
        .unwrap();
    assert!(second(&r.degraded().await).is_empty());
    let EngineCommand::ExcludeProcess { bundle_id, .. } = r
        .sent(|c| matches!(c, EngineCommand::ExcludeProcess { .. }))
        .await
    else {
        unreachable!()
    };
    assert_eq!(bundle_id, "com.apple.Music");
    assert_eq!(
        code(
            r.core
                .capture_keep_source(
                    &main_window(),
                    KeepSourceArgs {
                        call_id,
                        bundle_id: "com.none".into(),
                    },
                )
                .await
        ),
        ErrorCode::NoticeExpired
    );
}

// --- Continue window -----------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn the_continue_window_closes_after_five_minutes() {
    let r = rig();
    let call_id = r.recording().await;
    r.stop(&main_window(), &call_id).await;
    r.pass(299_000).await;
    assert_eq!(r.state().await.phase, CapturePhase::Stopped);
    r.pass(1_000).await;
    let idle = r.phase_becomes(CapturePhase::Idle).await;
    assert_eq!(idle.continue_until, None);
}

// === Part 3: recovery and disk ======================================================

impl Rig {
    /// Noter quits without stopping (a crash): the next core opens the same data folder.
    async fn crash_and_reopen(self) -> Rig {
        let Rig {
            core, clock, _dir, ..
        } = self;
        drop(core);
        tokio::task::yield_now().await;
        rig_in(_dir, clock, Setup::default())
    }

    async fn banners(&self) -> Vec<AppBanner> {
        self.core
            .app_snapshot(&main_window(), NoArgs {})
            .await
            .unwrap()
            .banners
            .banners
    }

    fn call_row(&self, call_id: &CallId) -> (String, Option<i64>) {
        let id = call_id.clone();
        self.core
            .store()
            .read(move |c| {
                c.query_row(
                    "SELECT status, ended_at FROM calls WHERE id = ?1",
                    [id.as_str()],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
            })
            .unwrap()
    }

    /// A call recorded until a mark at 60 s, then cut by a crash at 600 s.
    async fn interrupted() -> (Rig, CallId) {
        let r = rig();
        let call_id = r.recording().await;
        r.advance(60_000);
        r.core
            .capture_mark_moment(
                &main_window(),
                MarkMomentArgs {
                    call_id: call_id.clone(),
                    note: None,
                },
            )
            .await
            .unwrap();
        r.advance(540_000);
        (r.crash_and_reopen().await, call_id)
    }
}

#[tokio::test(start_paused = true)]
async fn a_call_cut_by_a_quit_is_offered_resume_with_an_interrupted_gap() {
    let (r, call_id) = Rig::interrupted().await;
    assert_eq!(
        r.banners().await,
        [AppBanner::RecordingInterruptedByQuit {
            call: CallRef {
                id: call_id.clone(),
                title: "Untitled call".into(),
                started_at: TimestampMs(T0),
                call_type: CallTypeId("unclassified".into()),
            }
        }]
    );
    assert_eq!(r.state().await.phase, CapturePhase::Idle);
    r.advance(30_000);
    let resumed = r
        .core
        .capture_resume_interrupted(
            &main_window(),
            CallIdArgs {
                call_id: call_id.clone(),
            },
        )
        .await
        .unwrap();
    assert_eq!(resumed.phase, CapturePhase::Recording);
    assert_eq!(resumed.call_id, Some(call_id.clone()));
    assert_eq!(resumed.started_at, Some(TimestampMs(T0)));
    let EngineCommand::StartSession(session) = r
        .sent(|c| matches!(c, EngineCommand::StartSession(_)))
        .await
    else {
        unreachable!()
    };
    assert_eq!(session.call_id, call_id);
    assert_eq!(session.resume_from_ms, Some(OffsetMs(630_000)));
    assert_eq!(
        r.query::<String>("SELECT t0_ms || '-' || t1_ms FROM gaps WHERE reason = 'interrupted'"),
        "60000-630000"
    );
    assert!(r.banners().await.is_empty());
    assert_eq!(r.call_row(&call_id).0, "recording");
    // Resumed once: the banner is gone.
    assert_eq!(
        code(
            r.core
                .capture_resume_interrupted(&main_window(), CallIdArgs { call_id })
                .await
        ),
        ErrorCode::NoticeExpired
    );
}

#[tokio::test(start_paused = true)]
async fn a_dismissed_banner_ends_the_interrupted_call_at_its_last_audio() {
    let (r, call_id) = Rig::interrupted().await;
    r.core
        .banner_dismiss(
            &main_window(),
            BannerDismissArgs {
                banner: BannerKind::RecordingInterruptedByQuit,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        code(
            r.core
                .capture_resume_interrupted(
                    &main_window(),
                    CallIdArgs {
                        call_id: call_id.clone()
                    }
                )
                .await
        ),
        ErrorCode::NoticeExpired
    );
    assert_eq!(
        r.call_row(&call_id),
        ("processing".into(), Some(T0 + 60_000))
    );
    let r = r.crash_and_reopen().await;
    assert!(r.banners().await.is_empty(), "never offered again");
}

#[tokio::test(start_paused = true)]
async fn another_capture_ends_the_interrupted_call() {
    let (r, call_id) = Rig::interrupted().await;
    let next = r.recording().await;
    assert_ne!(next, call_id);
    assert!(r.banners().await.is_empty());
    assert_eq!(r.call_row(&call_id).0, "processing");
}

#[tokio::test(start_paused = true)]
async fn try_again_restarts_the_engine_on_the_same_call() {
    let r = rig_with(Setup {
        first_launch_fails: true,
        ..Setup::default()
    });
    let failed = r
        .core
        .capture_start(&main_window(), start_args())
        .await
        .unwrap();
    assert_eq!(failed.phase, CapturePhase::Failed);
    let call_id = failed.call_id.unwrap();
    r.advance(5_000);
    let again = r
        .core
        .capture_resume_interrupted(
            &main_window(),
            CallIdArgs {
                call_id: call_id.clone(),
            },
        )
        .await
        .unwrap();
    assert_eq!(again.phase, CapturePhase::Recording);
    let EngineCommand::StartSession(session) = r
        .sent(|c| matches!(c, EngineCommand::StartSession(_)))
        .await
    else {
        unreachable!()
    };
    assert_eq!(session.resume_from_ms, Some(OffsetMs(5_000)));
    assert_eq!(
        r.query::<String>("SELECT t0_ms || '-' || t1_ms FROM gaps WHERE reason = 'engine_restart'"),
        "0-5000"
    );
}

#[tokio::test(start_paused = true)]
async fn low_and_full_disks_are_degraded_states_and_a_full_one_stops_audio_only() {
    let r = rig();
    let disk = |free: u32| EnvironmentReading {
        disk_free_mb: free,
        ..EnvironmentReading::default()
    };
    let disk_states = |states: Vec<DegradedState>| {
        states
            .into_iter()
            .filter(|s| {
                matches!(
                    s,
                    DegradedState::DiskLow { .. } | DegradedState::DiskFull { .. }
                )
            })
            .collect::<Vec<_>>()
    };
    r.core.environment_changed(disk(1_500));
    assert_eq!(
        disk_states(r.degraded().await),
        [DegradedState::DiskLow { free_mb: 1_500 }],
        "a warning, also with no call"
    );
    r.core.environment_changed(disk(10_000));
    let call_id = r.recording().await;
    r.core.environment_changed(disk(400));
    assert_eq!(
        disk_states(r.degraded().await),
        [DegradedState::DiskFull { free_mb: 400 }]
    );
    let s = r.state().await;
    assert_eq!((s.phase, s.audio_writing), (CapturePhase::Recording, false));
    assert_eq!(s.call_id, Some(call_id));
    r.core.environment_changed(disk(5_000));
    assert!(disk_states(r.degraded().await).is_empty());
    assert!(r.state().await.audio_writing);
}

// --- Engine gaps, degraded states, notifications ------------------------------------------

impl Rig {
    fn inject(&self, event: EngineEvent) {
        assert!(self.engine.inject(event));
    }

    /// Polls until `check` holds on the degraded set.
    async fn degraded_until(&self, check: impl Fn(&[DegradedState]) -> bool) -> Vec<DegradedState> {
        for _ in 0..500 {
            let states = self.degraded().await;
            if check(&states) {
                return states;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("degraded set never matched: {:?}", self.degraded().await);
    }

    fn posted(&self) -> Vec<Notification> {
        self.shown.1.lock().unwrap().clone()
    }
}

fn is_engine_state(s: &DegradedState) -> bool {
    matches!(
        s,
        DegradedState::MicrophoneOff { .. }
            | DegradedState::SystemAudioSilent { .. }
            | DegradedState::TranscriptionStalled { .. }
            | DegradedState::DeviceChanged { .. }
            | DegradedState::CaptureFailed { .. }
    )
}

#[tokio::test(start_paused = true)]
async fn engine_gaps_and_degraded_states_reach_the_rows_the_set_and_nt3() {
    let r = rig();
    let call_id = r.recording().await;
    r.inject(EngineEvent::DeviceChanged {
        call_id: call_id.clone(),
        device_name: "AirPods Pro".into(),
        gap_from_ms: OffsetMs(1_000),
        gap_to_ms: OffsetMs(1_500),
    });
    let states = r
        .degraded_until(|s| {
            s.iter()
                .any(|d| matches!(d, DegradedState::DeviceChanged { .. }))
        })
        .await;
    assert!(states.contains(&DegradedState::DeviceChanged {
        call_id: call_id.clone(),
        device_name: "AirPods Pro".into(),
        gap_ms: DurationMs(500),
    }));
    assert_eq!(
        r.query::<String>("SELECT t0_ms || '-' || t1_ms FROM gaps WHERE reason = 'device_changed'"),
        "1000-1500"
    );
    assert!(r
        .captured
        .lock()
        .unwrap()
        .iter()
        .any(|e| matches!(e, CaptureEvent::Gap(g) if g.reason == GapReason::DeviceChanged)));
    assert!(r.posted().is_empty(), "a device change is not NT-3");

    // NT-3 with no call surface visible and not hidden for presenting: sent at once, once.
    r.inject(EngineEvent::SystemAudioSilent {
        call_id: call_id.clone(),
        since_ms: OffsetMs(2_000),
        confidence: 0.8,
    });
    let silent = DegradedState::SystemAudioSilent {
        call_id: call_id.clone(),
        since: TimestampMs(T0 + 2_000),
        confidence: 0.8,
    };
    r.degraded_until(|s| s.contains(&silent)).await;
    assert_eq!(
        r.posted(),
        [Notification {
            call_id: call_id.clone(),
            kind: NotificationKind::CaptureProblem(silent.clone()),
        }]
    );
    r.inject(EngineEvent::Levels {
        call_id: Some(call_id.clone()),
        mic_db: -30.0,
        sys_db: -30.0,
    });
    r.degraded_until(|s| !s.contains(&silent)).await;

    // A visible call surface shows NT-3 itself: no notification.
    r.shown.2.store(true, Ordering::SeqCst);
    r.inject(EngineEvent::Levels {
        call_id: Some(call_id.clone()),
        mic_db: -120.0,
        sys_db: -30.0,
    });
    r.degraded_until(|s| {
        s.iter()
            .any(|d| matches!(d, DegradedState::MicrophoneOff { .. }))
    })
    .await;
    assert_eq!(r.posted().len(), 1);

    // The call ends: no engine state of it stays.
    r.stop(&main_window(), &call_id).await;
    assert!(!r.degraded().await.iter().any(is_engine_state));
}

#[tokio::test(start_paused = true)]
async fn notifications_wait_for_the_call_to_end_and_skip_the_call_the_main_window_shows() {
    let r = rig();
    let first = r.recording().await;
    let ready = |call_id: &CallId| Notification {
        call_id: call_id.clone(),
        kind: NotificationKind::SummaryReady,
    };
    // Held while a capture runs, released one per call when it ends.
    r.core.notify(ready(&first));
    r.core.notify(ready(&first));
    assert!(r.posted().is_empty());
    r.stop(&main_window(), &first).await;
    assert_eq!(r.posted(), [ready(&first)]);

    // Nothing for the call the frontmost main window shows.
    r.core.report_view(Some(first.clone()));
    r.core.notify(ready(&first));
    assert_eq!(r.posted().len(), 1);
    r.core.report_view(None);
    r.core.notify(ready(&first));
    assert_eq!(r.posted().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn notifications_held_while_hidden_for_presenting_go_out_when_it_ends() {
    let r = rig();
    let call = CallId::new("call_1".to_string());
    let ready = Notification {
        call_id: call.clone(),
        kind: NotificationKind::SummaryReady,
    };
    r.core
        .app_set_hidden_for_presenting(&main_window(), HiddenArgs { hidden: true })
        .await
        .unwrap();
    r.core.notify(ready.clone());
    r.core.notify(ready.clone());
    assert!(r.posted().is_empty(), "held while hidden for presenting");
    r.core
        .app_set_hidden_for_presenting(&main_window(), HiddenArgs { hidden: false })
        .await
        .unwrap();
    assert_eq!(r.posted(), [ready], "one per call, once showing again");
}

#[tokio::test(start_paused = true)]
async fn an_engine_that_cannot_be_restarted_fails_the_call_and_try_again_resumes_it() {
    let r = rig_with(Setup {
        // The call's engine, then two restarts that fail: three failures in 30 s.
        then: vec![
            Behaviour::default(),
            Behaviour {
                launch_fails: true,
                ..Behaviour::default()
            },
            Behaviour {
                launch_fails: true,
                ..Behaviour::default()
            },
        ],
        ..Setup::default()
    });
    let call_id = r.recording().await;
    r.engine.kill_current();
    let failed = r.phase_becomes(CapturePhase::Failed).await;
    assert_eq!(failed.call_id.as_ref(), Some(&call_id));
    r.degraded_until(|s| {
        s.iter()
            .any(|d| matches!(d, DegradedState::CaptureFailed { .. }))
    })
    .await;
    assert!(r.posted().iter().any(|n| matches!(
        &n.kind,
        NotificationKind::CaptureProblem(DegradedState::CaptureFailed { .. })
    )));

    let starts = r.sessions().len();
    let again = {
        let core = r.core.clone();
        let call_id = call_id.clone();
        tokio::spawn(async move {
            core.capture_resume_interrupted(&main_window(), CallIdArgs { call_id })
                .await
        })
    };
    r.sent_n(starts + 1, |c| matches!(c, EngineCommand::StartSession(_)))
        .await;
    r.session_started(&call_id);
    assert_eq!(again.await.unwrap().unwrap().phase, CapturePhase::Recording);
    r.degraded_until(|s| {
        !s.iter()
            .any(|d| matches!(d, DegradedState::CaptureFailed { .. }))
    })
    .await;
    for _ in 0..500 {
        if r.query::<i64>("SELECT count(*) FROM gaps WHERE reason = 'engine_restart'") > 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(
        r.query::<i64>("SELECT count(*) FROM gaps WHERE reason = 'engine_restart'"),
        1,
        "one gap, the engine's"
    );
}

#[tokio::test(start_paused = true)]
async fn a_call_paused_when_the_engine_failed_comes_back_paused() {
    let r = rig_with(Setup {
        then: vec![
            Behaviour::default(),
            Behaviour {
                launch_fails: true,
                ..Behaviour::default()
            },
            Behaviour {
                launch_fails: true,
                ..Behaviour::default()
            },
        ],
        ..Setup::default()
    });
    let call_id = r.recording().await;
    r.core
        .capture_set_paused(
            &main_window(),
            CapturePauseArgs {
                call_id: call_id.clone(),
                paused: true,
            },
        )
        .await
        .unwrap();
    r.advance(1_000);
    r.engine.kill_current();
    r.phase_becomes(CapturePhase::Failed).await;
    r.advance(4_000);
    let starts = r.sessions().len();
    let again = {
        let core = r.core.clone();
        let call_id = call_id.clone();
        tokio::spawn(async move {
            core.capture_resume_interrupted(&main_window(), CallIdArgs { call_id })
                .await
        })
    };
    r.sent_n(starts + 1, |c| matches!(c, EngineCommand::StartSession(_)))
        .await;
    r.session_started(&call_id);
    let back = again.await.unwrap().unwrap();
    assert_eq!(back.phase, CapturePhase::Paused);
    assert!(back.pause.is_some());
    // Recorded time stops at the pause, not at the failure.
    assert_eq!(back.recorded_ms, DurationMs(0));
}

#[tokio::test(start_paused = true)]
async fn a_core_that_starts_with_detection_on_tells_the_engine() {
    let r = rig_with(Setup {
        self_test_passed: true,
        ..Setup::default()
    });
    let EngineCommand::SetDetection {
        known_bundle_ids, ..
    } = r
        .sent(|c| matches!(c, EngineCommand::SetDetection { enabled: true, .. }))
        .await
    else {
        unreachable!()
    };
    assert!(known_bundle_ids.iter().any(|b| b == TEAMS));
}

// === The machine, table-driven (cpt-noter-dod-core-capture-session-machine) =============

/// Where a transition starts; each row reaches it on a fresh core.
#[derive(Debug, Clone, Copy)]
enum From {
    Idle,
    Recording,
    Paused,
    Stopped,
    NothingHeard,
    NewMeeting,
    Interrupted,
    Failed,
    /// Recording on an engine whose next two launches fail (three failures in 30 s).
    Fragile,
}

#[derive(Debug, Clone, Copy)]
enum Act {
    Start,
    Pause,
    Resume,
    Stop,
    Discard,
    Continue,
    WindowPasses,
    ResumeInterrupted,
    EngineCrash,
    EngineGivesUp,
    TryAgain,
    StartAsNewCall,
    KeepInThisCall,
}

use CapturePhase as P;

struct Row {
    /// The spec §4 transition (or DESIGN-core 3.1 row) the line proves.
    proves: &'static str,
    from: From,
    act: Act,
    to: CapturePhase,
    /// Phases `capture:state` passes through on the way.
    via: &'static [CapturePhase],
    gap: Option<&'static str>,
    same_call: bool,
}

const MACHINE: &[Row] = &[
    Row {
        proves: "inst-st-start, inst-st-recording",
        from: From::Idle,
        act: Act::Start,
        to: P::Recording,
        via: &[P::Starting],
        gap: None,
        same_call: false,
    },
    Row {
        proves: "inst-st-start-from-stopped",
        from: From::Stopped,
        act: Act::Start,
        to: P::Recording,
        via: &[P::Starting],
        gap: None,
        same_call: false,
    },
    Row {
        proves: "inst-st-pause",
        from: From::Recording,
        act: Act::Pause,
        to: P::Paused,
        via: &[],
        gap: None,
        same_call: true,
    },
    Row {
        proves: "inst-st-resume",
        from: From::Paused,
        act: Act::Resume,
        to: P::Recording,
        via: &[],
        gap: Some("paused"),
        same_call: true,
    },
    Row {
        proves: "inst-st-stopping, inst-st-stopped",
        from: From::Recording,
        act: Act::Stop,
        to: P::Stopped,
        via: &[P::Stopping],
        gap: None,
        same_call: true,
    },
    Row {
        proves: "inst-st-stopping (from paused)",
        from: From::Paused,
        act: Act::Stop,
        to: P::Stopped,
        via: &[P::Stopping],
        gap: Some("paused"),
        same_call: true,
    },
    Row {
        proves: "inst-st-discard",
        from: From::NothingHeard,
        act: Act::Discard,
        to: P::Idle,
        via: &[P::Stopping],
        gap: None,
        same_call: false,
    },
    Row {
        proves: "inst-st-continue",
        from: From::Stopped,
        act: Act::Continue,
        to: P::Recording,
        via: &[],
        gap: Some("continued"),
        same_call: true,
    },
    Row {
        proves: "inst-st-idle",
        from: From::Stopped,
        act: Act::WindowPasses,
        to: P::Idle,
        via: &[],
        gap: None,
        same_call: false,
    },
    Row {
        proves: "inst-st-resume-interrupted",
        from: From::Interrupted,
        act: Act::ResumeInterrupted,
        to: P::Recording,
        via: &[],
        gap: Some("interrupted"),
        same_call: true,
    },
    Row {
        proves: "DESIGN-core 3.1 engine crash",
        from: From::Recording,
        act: Act::EngineCrash,
        to: P::Recording,
        via: &[],
        gap: Some("engine_restart"),
        same_call: true,
    },
    Row {
        proves: "inst-st-failed",
        from: From::Fragile,
        act: Act::EngineGivesUp,
        to: P::Failed,
        via: &[],
        gap: None,
        same_call: true,
    },
    Row {
        proves: "inst-st-try-again",
        from: From::Failed,
        act: Act::TryAgain,
        to: P::Recording,
        via: &[],
        gap: Some("engine_restart"),
        same_call: true,
    },
    Row {
        proves: "inst-st-failed-stop",
        from: From::Failed,
        act: Act::Stop,
        to: P::Stopped,
        via: &[],
        gap: None,
        same_call: true,
    },
    Row {
        proves: "inst-st-split (Start as New Call)",
        from: From::NewMeeting,
        act: Act::StartAsNewCall,
        to: P::Recording,
        via: &[P::Stopping, P::Stopped, P::Starting],
        gap: None,
        same_call: false,
    },
    Row {
        proves: "inst-st-split (Keep in This Call)",
        from: From::NewMeeting,
        act: Act::KeepInThisCall,
        to: P::Recording,
        via: &[],
        gap: None,
        same_call: true,
    },
];

/// Moves that are not transitions: refused with these codes, the phase unchanged.
const REFUSED: &[(From, Act, ErrorCode)] = &[
    (From::Idle, Act::Pause, ErrorCode::NotRecording),
    (From::Idle, Act::Stop, ErrorCode::NotRecording),
    (From::Idle, Act::Continue, ErrorCode::ContinueWindowClosed),
    (From::Idle, Act::ResumeInterrupted, ErrorCode::NoticeExpired),
    (From::Recording, Act::Start, ErrorCode::AlreadyRecording),
    (From::Recording, Act::Discard, ErrorCode::NoticeExpired),
    (
        From::Recording,
        Act::Continue,
        ErrorCode::ContinueWindowClosed,
    ),
    (
        From::Recording,
        Act::ResumeInterrupted,
        ErrorCode::NoticeExpired,
    ),
    (
        From::Recording,
        Act::KeepInThisCall,
        ErrorCode::NoticeExpired,
    ),
    (From::Paused, Act::Start, ErrorCode::AlreadyRecording),
    (From::Stopped, Act::Pause, ErrorCode::NotRecording),
    (From::Stopped, Act::Discard, ErrorCode::NoticeExpired),
    (From::Failed, Act::Start, ErrorCode::AlreadyRecording),
    (From::Failed, Act::Pause, ErrorCode::NotRecording),
];

fn fragile() -> Setup {
    let fails = || Behaviour {
        launch_fails: true,
        ..Behaviour::default()
    };
    Setup {
        then: vec![Behaviour::default(), fails(), fails()],
        ..Setup::default()
    }
}

impl Rig {
    async fn reach(from: From) -> (Rig, Option<CallId>) {
        match from {
            From::Idle => (rig(), None),
            From::Recording | From::Paused | From::Stopped | From::NothingHeard => {
                let r = rig();
                let call_id = r.recording().await;
                match from {
                    From::Paused => {
                        let args = CapturePauseArgs {
                            call_id: call_id.clone(),
                            paused: true,
                        };
                        r.core
                            .capture_set_paused(&main_window(), args)
                            .await
                            .unwrap();
                        r.advance(10_000);
                    }
                    From::Stopped => {
                        r.stop(&main_window(), &call_id).await;
                        r.advance(60_000);
                    }
                    From::NothingHeard => {
                        r.pass(300_000).await;
                        r.notice_becomes(|n| matches!(n, Some(CaptureNotice::NothingHeard { .. })))
                            .await;
                    }
                    _ => {}
                }
                (r, Some(call_id))
            }
            From::NewMeeting => {
                let r = rig();
                r.detection_on().await;
                let call_id = r.recording_detected(ZOOM, "Zoom").await;
                r.pass(30_000).await;
                r.call_detected(TEAMS, "Microsoft Teams");
                r.notice_becomes(|n| matches!(n, Some(CaptureNotice::NewMeeting { .. })))
                    .await;
                (r, Some(call_id))
            }
            From::Interrupted => {
                let (r, call_id) = Rig::interrupted().await;
                (r, Some(call_id))
            }
            From::Fragile | From::Failed => {
                let r = rig_with(fragile());
                let call_id = r.recording().await;
                if matches!(from, From::Failed) {
                    r.engine.kill_current();
                    r.phase_becomes(P::Failed).await;
                    r.advance(5_000);
                }
                (r, Some(call_id))
            }
        }
    }

    /// Applies `act` the way a surface does, answering for the engine where a step needs it.
    async fn act(&self, act: Act, call: &CallId) -> Result<CaptureState, CoreError> {
        let ctx = main_window();
        let id = || CallIdArgs {
            call_id: call.clone(),
        };
        let paused = |paused| CapturePauseArgs {
            call_id: call.clone(),
            paused,
        };
        let meeting = |choice| NewMeetingAnswerArgs {
            call_id: call.clone(),
            choice,
        };
        let phase = self.state().await.phase;
        match act {
            Act::Start => {
                let starts = self.sessions().len();
                let started = self.core.capture_start(&ctx, start_args()).await?;
                let new = started.call_id.unwrap();
                self.sent_n(starts + 1, |c| matches!(c, EngineCommand::StartSession(_)))
                    .await;
                self.session_started(&new);
                Ok(self.phase_becomes(P::Recording).await)
            }
            Act::Pause => self.core.capture_set_paused(&ctx, paused(true)).await,
            Act::Resume => self.core.capture_set_paused(&ctx, paused(false)).await,
            Act::Stop if matches!(phase, P::Recording | P::Paused) => {
                Ok(self.stop(&ctx, call).await)
            }
            Act::Stop => self.core.capture_stop(&ctx, id()).await,
            Act::Discard
                if matches!(
                    self.state().await.notice,
                    Some(CaptureNotice::NothingHeard { .. })
                ) =>
            {
                let stops = self.stops();
                let discard = {
                    let core = self.core.clone();
                    let args = id();
                    tokio::spawn(async move { core.capture_discard(&main_window(), args).await })
                };
                self.answer_stop(call, stops).await;
                discard.await.unwrap()
            }
            Act::Discard => self.core.capture_discard(&ctx, id()).await,
            Act::Continue => self.core.capture_continue(&ctx, id()).await,
            Act::WindowPasses => {
                self.pass(300_001).await;
                Ok(self.phase_becomes(P::Idle).await)
            }
            Act::ResumeInterrupted => self.core.capture_resume_interrupted(&ctx, id()).await,
            Act::EngineCrash => {
                let starts = self.sessions().len();
                self.engine.kill_current();
                self.sent_n(starts + 1, |c| matches!(c, EngineCommand::StartSession(_)))
                    .await;
                self.session_started(call);
                Ok(self.state().await)
            }
            Act::EngineGivesUp => {
                self.engine.kill_current();
                Ok(self.phase_becomes(P::Failed).await)
            }
            Act::TryAgain => {
                let starts = self.sessions().len();
                let again = {
                    let core = self.core.clone();
                    let args = id();
                    tokio::spawn(async move {
                        core.capture_resume_interrupted(&main_window(), args).await
                    })
                };
                self.sent_n(starts + 1, |c| matches!(c, EngineCommand::StartSession(_)))
                    .await;
                self.session_started(call);
                again.await.unwrap()
            }
            Act::StartAsNewCall => {
                let (stops, starts) = (self.stops(), self.sessions().len());
                let split = {
                    let core = self.core.clone();
                    let args = meeting(NewMeetingChoice::StartAsNewCall);
                    tokio::spawn(async move {
                        core.capture_answer_new_meeting(&main_window(), args).await
                    })
                };
                self.answer_stop(call, stops).await;
                let EngineCommand::StartSession(next) = self
                    .sent_n(starts + 1, |c| matches!(c, EngineCommand::StartSession(_)))
                    .await
                else {
                    unreachable!()
                };
                self.session_started(&next.call_id);
                split.await.unwrap()?;
                Ok(self.phase_becomes(P::Recording).await)
            }
            Act::KeepInThisCall => {
                let args = meeting(NewMeetingChoice::KeepInThisCall);
                self.core.capture_answer_new_meeting(&ctx, args).await
            }
        }
    }

    async fn gap_written(&self, reason: &str) -> bool {
        let sql = format!("SELECT count(*) FROM gaps WHERE reason = '{reason}'");
        for _ in 0..200 {
            if self.query::<i64>(&sql) > 0 {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        false
    }
}

#[tokio::test(start_paused = true)]
async fn every_capture_transition_of_the_machine() {
    for row in MACHINE {
        let (r, call) = Rig::reach(row.from).await;
        let none = CallId::new("call_none".to_string());
        let call = call.unwrap_or(none);
        let seen = r.capture_events().len();
        let at = r.act(row.act, &call).await;
        let state = at.unwrap_or_else(|e| panic!("{}: {e:?}", row.proves));
        let state = if state.phase == row.to {
            state
        } else {
            r.phase_becomes(row.to).await
        };
        let phases: Vec<_> = r.capture_events()[seen..].iter().map(|c| c.phase).collect();
        for via in row.via {
            assert!(
                phases.contains(via),
                "{}: {via:?} in {phases:?}",
                row.proves
            );
        }
        if row.to != P::Idle {
            assert_eq!(
                state.call_id.as_ref() == Some(&call),
                row.same_call,
                "{}",
                row.proves
            );
        }
        if let Some(reason) = row.gap {
            assert!(
                r.gap_written(reason).await,
                "{}: a {reason} gap",
                row.proves
            );
        }
    }
}

#[tokio::test(start_paused = true)]
async fn moves_that_are_not_transitions_are_refused() {
    for (from, act, want) in REFUSED {
        let (r, call) = Rig::reach(*from).await;
        let call = call.unwrap_or_else(|| CallId::new("call_none".to_string()));
        let before = r.state().await.phase;
        let got = r.act(*act, &call).await;
        assert_eq!(
            got.map(|s| s.phase).map_err(|e| e.code),
            Err(*want),
            "{from:?} {act:?}"
        );
        assert_eq!(
            r.state().await.phase,
            before,
            "{from:?} {act:?} leaves the phase"
        );
    }
}

// --- Pipeline triggers and the capture guard (FEATURE core-jobs-scheduler) -----------------

/// A pipeline worker that works in 100 ms steps, each at a safe boundary, for `steps` steps.
struct Steady {
    steps: u32,
}

impl noter_jobs::JobHandler for Steady {
    fn run<'a>(
        &'a self,
        ctx: &'a mut noter_jobs::RunCtx,
    ) -> noter_jobs::BoxFuture<'a, Result<(), noter_jobs::Stop>> {
        Box::pin(async move {
            for _ in 0..self.steps {
                ctx.checkpoint().await?;
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Ok(())
        })
    }
}

fn runs_of(r: &Rig, kind: JobKind) -> Vec<JobRunRow> {
    r.core
        .scheduler()
        .runs()
        .unwrap()
        .into_iter()
        .filter(|run| run.kind == kind)
        .collect()
}

// @cpt-dod:cpt-noter-dod-core-jobs-scheduler-scheduling:p1
#[tokio::test(start_paused = true)]
async fn stop_queues_post_call_then_archive_and_the_guard_follows_the_call() {
    let r = rig();
    assert!(!r.core.capture_guard().borrow().live);
    let call_id = r.recording().await;
    assert!(r.core.capture_guard().borrow().live, "live from the start");
    r.stop(&main_window(), &call_id).await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        !r.core.capture_guard().borrow().live,
        "not live once stopped"
    );
    let post = runs_of(&r, JobKind::PostCall);
    let archive = runs_of(&r, JobKind::ArchivePass);
    assert_eq!((post.len(), archive.len()), (1, 1));
    assert_eq!(post[0].status, JobRunStatus::Succeeded);
    assert_eq!(archive[0].status, JobRunStatus::Succeeded);
    assert!(
        post[0].started_at <= archive[0].started_at,
        "post-call first"
    );
}

#[tokio::test(start_paused = true)]
async fn a_second_call_leaves_the_previous_post_call_running_and_pauses_its_archive() {
    let r = rig();
    r.core
        .scheduler()
        .register(JobKind::PostCall, Arc::new(Steady { steps: 100 }));
    r.core
        .scheduler()
        .register(JobKind::ArchivePass, Arc::new(Steady { steps: 100 }));
    let first = r.recording().await;
    r.stop(&main_window(), &first).await;
    tokio::time::sleep(Duration::from_millis(250)).await;
    let second = r.recording().await;
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(
        runs_of(&r, JobKind::PostCall)[0].status,
        JobRunStatus::Running,
        "the previous call's post-call goes on during a live call"
    );
    assert_eq!(
        runs_of(&r, JobKind::ArchivePass)[0].status,
        JobRunStatus::Paused
    );
    r.stop(&main_window(), &second).await;
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(
        runs_of(&r, JobKind::ArchivePass)[0].status,
        JobRunStatus::Running,
        "the archive goes on from its checkpoint once no call is live"
    );
}

#[tokio::test(start_paused = true)]
async fn continue_recording_cancels_the_calls_pipeline_and_the_next_stop_queues_a_fresh_one() {
    let r = rig();
    r.core
        .scheduler()
        .register(JobKind::PostCall, Arc::new(Steady { steps: 100 }));
    r.core
        .scheduler()
        .register(JobKind::ArchivePass, Arc::new(Steady { steps: 100 }));
    let call_id = r.recording().await;
    r.stop(&main_window(), &call_id).await;
    tokio::time::sleep(Duration::from_millis(250)).await;
    let first = runs_of(&r, JobKind::PostCall)[0].clone();
    assert_eq!(first.status, JobRunStatus::Running);
    r.core
        .capture_continue(
            &main_window(),
            CallIdArgs {
                call_id: call_id.clone(),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        r.core.capture_guard().borrow().resumed_call,
        Some(call_id.clone())
    );
    tokio::time::sleep(Duration::from_millis(250)).await;
    let runs = runs_of(&r, JobKind::PostCall);
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].status, JobRunStatus::Cancelled);
    assert_eq!(
        runs_of(&r, JobKind::ArchivePass)[0].status,
        JobRunStatus::Cancelled,
        "no archive result lands for the resumed call"
    );
    r.session_started(&call_id);
    r.stop(&main_window(), &call_id).await;
    tokio::time::sleep(Duration::from_millis(250)).await;
    let runs = runs_of(&r, JobKind::PostCall);
    assert_eq!(runs.len(), 2, "a fresh generation");
    assert_ne!(runs[0].id, runs[1].id);
    assert_eq!(runs[1].status, JobRunStatus::Running);
    assert_eq!(r.core.capture_guard().borrow().resumed_call, None);
}
