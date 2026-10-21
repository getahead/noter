//! FEATURE cpt-noter-feature-core-capture-session (part 1): the capture machine, its start
//! guard and the session commands, against a scripted engine on paused tokio time (TL-4).

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{
    BoxFuture, BundleFile, BundleSpec, CaptureEvent, ChunkSink, Clock, Core, CoreDeps,
    EnvironmentReading, EventEmitter, FetchError, ModelSource, NativeServices, Surfaces,
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

/// What the core asked the native layer to show.
#[derive(Default)]
struct Shown(Mutex<Vec<&'static str>>);

impl Surfaces for Shown {
    fn show_record_prompt(&self) {
        self.0.lock().unwrap().push("show_record_prompt");
    }
    fn close_record_prompt(&self) {
        self.0.lock().unwrap().push("close_record_prompt");
    }
    fn open_call_window_inactive(&self) {
        self.0.lock().unwrap().push("open_call_window_inactive");
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
}

impl Default for Setup {
    fn default() -> Self {
        Self {
            disk_free_mb: 10_000,
            model: true,
            engine: Behaviour::default(),
        }
    }
}

fn rig_with(setup: Setup) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    if setup.model {
        std::fs::create_dir_all(dir.path().join("models")).unwrap();
        std::fs::write(dir.path().join("models/whisper-turbo"), b"model").unwrap();
    }
    let engine = ScriptedEngine::new().with_default(setup.engine);
    let launcher: Arc<dyn EngineLauncher> = Arc::new(engine.clone());
    let clock = Arc::new(TestClock(AtomicI64::new(T0)));
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
    assert_eq!(*r.shown.0.lock().unwrap(), ["open_call_window_inactive"]);

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
    assert_eq!(r.query::<String>("SELECT status FROM calls"), "processing");
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
    assert_eq!(row, ("processing".into(), T0 + 140_000));
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
    // Every change row of the call names the menu bar: start, pause and stop.
    assert_eq!(
        r.query::<i64>(
            "SELECT count(*) FROM changes WHERE entity_type = 'call' AND surface IS NOT 'menu_bar'"
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
