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
async fn the_engine_hears_the_known_meeting_apps_minus_the_ignored_ones() {
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
    for app in [ZOOM, TEAMS, "com.apple.FaceTime", "com.google.Chrome"] {
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
    let EngineCommand::SetDetection {
        known_bundle_ids, ..
    } = r
        .sent_n(2, |c| {
            matches!(c, EngineCommand::SetDetection { enabled: true, .. })
        })
        .await
    else {
        unreachable!()
    };
    assert!(!known_bundle_ids.iter().any(|b| b == ZOOM));
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
