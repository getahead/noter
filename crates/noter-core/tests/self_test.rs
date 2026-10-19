//! FEATURE cpt-noter-feature-core-first-run (part 3): self_test_run through the engine
//! supervisor (S12) with a scripted engine (D3), streamed over the hub.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{
    BoxFuture, BundleFile, BundleSpec, ChunkSink, Clock, Core, CoreDeps, EnvironmentReading,
    EventEmitter, FetchError, ModelSource, NativeServices,
};
use noter_db::rusqlite::Connection;
use noter_engine_client::scripted::{Behaviour, ScriptedEngine};
use noter_engine_client::EngineLauncher;
use noter_protocol::engine::{EngineCommand, EngineErrorCode};
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi, Sink};
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

type Listener = Box<dyn Fn(EnvironmentReading) + Send + Sync>;

#[derive(Default)]
struct Mac {
    states: Mutex<HashMap<PermissionKind, PermissionState>>,
    /// The core's change listener, to send it a notice as macOS would.
    changed: Mutex<Option<Listener>>,
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
        // Room for the models, so models_download can start.
        EnvironmentReading {
            disk_free_mb: 10_000,
            ..EnvironmentReading::default()
        }
    }
    fn on_change(&self, on_change: Listener) {
        *self.changed.lock().unwrap() = Some(on_change);
    }
    fn set_login_item(&self, _: bool) -> Result<(), CoreError> {
        Ok(())
    }
}

#[derive(Default)]
struct Events(Mutex<Vec<&'static str>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, _: Value) {
        self.0.lock().unwrap().push(event);
    }
}

/// The live model's bundle: ready once its file is in `models/`, never downloaded here.
struct Whisper;

/// The live model, already downloaded.
fn live_model(dir: &Path) -> Arc<dyn ModelSource> {
    std::fs::create_dir_all(dir.join("models")).unwrap();
    std::fs::write(dir.join("models/whisper-turbo"), b"model").unwrap();
    Arc::new(Whisper)
}

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
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(NoEvents))
        .with_native(Arc::new(mac))
        .with_engine(launcher)
        .with_models(models.unwrap_or_else(|| live_model(dir)));
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
        .with_models(live_model(dir.path()))
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
        Some(Arc::new(Whisper)),
    );
    let (sink, got) = collecting();
    let err = r
        .core
        .self_test_run(&first_run(), SelfTestArgs { play_clip: false }, sink)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ModelMissing);
    assert!(got.lock().unwrap().is_empty());

    // No manifest at all names no live model: still missing.
    let dir = tempfile::tempdir().unwrap();
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(NoEvents));
    let core = Arc::new(Core::open(dir.path(), deps).unwrap());
    core.start_first_run();
    let err = core
        .self_test_run(
            &first_run(),
            SelfTestArgs { play_clip: false },
            collecting().0,
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ModelMissing);
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

/// A core whose events and Mac the test can see, with the microphone granted.
struct Probing {
    run: Run,
    events: Arc<Events>,
    mac: Arc<Mac>,
}

fn open_probing(dir: &Path, engine: ScriptedEngine) -> Probing {
    let mac = Arc::new(Mac::default());
    mac.states
        .lock()
        .unwrap()
        .insert(PermissionKind::Microphone, PermissionState::Granted);
    let events = Arc::new(Events::default());
    let launcher: Arc<dyn EngineLauncher> = Arc::new(engine.clone());
    let deps = CoreDeps::new(Arc::new(FixedClock), events.clone())
        .with_native(mac.clone())
        .with_engine(launcher)
        .with_models(live_model(dir));
    let core = Arc::new(Core::open(dir, deps).expect("core opens"));
    core.start_first_run();
    Probing {
        run: Run { core, engine },
        events,
        mac,
    }
}

fn system_audio_row(s: &SetupStatus) -> PermissionState {
    s.permissions
        .iter()
        .find(|p| p.kind == PermissionKind::SystemAudio)
        .unwrap()
        .state
}

/// The re-check probes (D-19): the clip on, ended within about 3 s.
fn probes(engine: &ScriptedEngine) -> usize {
    engine
        .commands()
        .iter()
        .filter(|c| {
            matches!(
                c,
                EngineCommand::SelfTest {
                    play_clip: true,
                    timeout_ms: 3_000
                }
            )
        })
        .count()
}

/// A self-test that heard only zeros: the system-audio row reads denied.
async fn denied_by_a_self_test(p: &Probing) {
    p.run.engine.set_system_audio(PermissionState::Denied);
    let (_, events) = run_to_end(&p.run, false).await;
    assert_eq!(failed(&events), Some(SelfTestFailure::ZeroBuffers));
    assert_eq!(
        system_audio_row(&status(&p.run).await),
        PermissionState::Denied
    );
}

async fn until_probes(p: &Probing, n: usize) {
    for _ in 0..500 {
        if probes(&p.run.engine) >= n && !noter_core::testing::system_audio_probing(&p.run.core) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("no probe");
}

/// D-19: back from System Settings, the core re-checks a denied system-audio row by playing
/// the test clip; the row becomes granted, and a later self-test that hears only zeros wins.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn back_from_system_settings_the_core_rechecks_system_audio_with_the_clip() {
    let dir = tempfile::tempdir().unwrap();
    let p = open_probing(dir.path(), ScriptedEngine::new());
    denied_by_a_self_test(&p).await;

    p.run.engine.set_system_audio(PermissionState::Granted);
    p.events.0.lock().unwrap().clear();
    p.run.core.app_activated();
    until_probes(&p, 1).await;
    assert_eq!(
        system_audio_row(&status(&p.run).await),
        PermissionState::Granted
    );
    assert!(p
        .events
        .0
        .lock()
        .unwrap()
        .contains(&event_names::SETUP_CHANGED));

    p.run.engine.set_system_audio(PermissionState::Denied);
    run_to_end(&p.run, false).await;
    assert_eq!(
        system_audio_row(&status(&p.run).await),
        PermissionState::Denied
    );
}

/// Still off: the row stays denied, and `setup:changed` still ends the check (the UI leaves
/// Checking…); a second activation right after does not probe again.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_recheck_that_still_hears_nothing_keeps_the_row_denied_and_says_so() {
    let dir = tempfile::tempdir().unwrap();
    let p = open_probing(dir.path(), ScriptedEngine::new());
    denied_by_a_self_test(&p).await;

    p.events.0.lock().unwrap().clear();
    p.run.core.app_activated();
    until_probes(&p, 1).await;
    p.run.core.app_activated();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(probes(&p.run.engine), 1, "once per activation");
    assert_eq!(
        system_audio_row(&status(&p.run).await),
        PermissionState::Denied
    );
    assert!(p
        .events
        .0
        .lock()
        .unwrap()
        .contains(&event_names::SETUP_CHANGED));
}

/// The native permission-change notice re-checks too.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_native_change_notice_rechecks_a_denied_system_audio_row() {
    let dir = tempfile::tempdir().unwrap();
    let p = open_probing(dir.path(), ScriptedEngine::new());
    denied_by_a_self_test(&p).await;
    p.run.engine.set_system_audio(PermissionState::Granted);
    (p.mac.changed.lock().unwrap().as_ref().unwrap())(EnvironmentReading::default());
    until_probes(&p, 1).await;
    assert_eq!(
        system_audio_row(&status(&p.run).await),
        PermissionState::Granted
    );
}

/// No probe unless the row reads denied during first run: not before it was ever checked,
/// and not once setup is complete (Settings leaves it to Run Test).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_recheck_unless_first_run_shows_system_audio_denied() {
    let dir = tempfile::tempdir().unwrap();
    let p = open_probing(dir.path(), ScriptedEngine::new());
    p.run.core.app_activated();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(probes(&p.run.engine), 0, "not asked yet");

    denied_by_a_self_test(&p).await;
    for step in [
        SetupStep::Welcome,
        SetupStep::Models,
        SetupStep::Permissions,
        SetupStep::CallDisplay,
        SetupStep::AudioStorage,
        SetupStep::Assistants,
    ] {
        p.run
            .core
            .setup_set_step(
                &first_run(),
                StepArgs {
                    step,
                    state: StepState::Skipped,
                },
            )
            .await
            .unwrap();
    }
    assert!(status(&p.run).await.complete);
    p.run.core.app_activated();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(probes(&p.run.engine), 0, "setup complete");
}

/// reason, entity_type, field, before, after, delta and batch_id of every change row, in order.
type ChangeRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<Vec<u8>>,
    Option<String>,
);

fn change_rows(dir: &Path) -> Vec<ChangeRow> {
    let c = Connection::open(dir.join("noter.db")).unwrap();
    let mut s = c
        .prepare(
            "SELECT reason, entity_type, field, before, after, delta, batch_id \
             FROM changes ORDER BY rowid",
        )
        .unwrap();
    let rows = s
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })
        .unwrap();
    rows.map(Result::unwrap).collect()
}

/// D5, `cpt-noter-dod-core-storage-change-log`: every M0 write entry point leaves exactly one
/// change row per record it writes, committed with the record; reads write none. A later
/// feature that adds a write entry point extends this test.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn every_m0_write_leaves_one_change_row_per_record() {
    let dir = tempfile::tempdir().unwrap();
    let p = open_probing(dir.path(), ScriptedEngine::new());
    let core = &p.run.core;
    let fr = first_run();
    let settings = CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Settings,
        },
    };
    let mut want: Vec<&str> = Vec::new();
    let mut wrote = |reason: &'static str, rows: usize| {
        want.extend(std::iter::repeat_n(reason, rows));
        let got: Vec<String> = change_rows(dir.path()).into_iter().map(|r| r.0).collect();
        assert_eq!(got, want, "after {reason}");
    };

    // Model state lives in the files, not in the database.
    core.setup_status(&fr, NoArgs {}).await.unwrap();
    core.models_download(
        &fr,
        ModelsDownloadArgs {
            action: DownloadAction::Start,
        },
    )
    .await
    .unwrap();
    wrote("models_download", 0);

    // Permission and self-test results.
    core.permission_request(
        &fr,
        PermissionArgs {
            kind: PermissionKind::SystemAudio,
        },
    )
    .await
    .unwrap();
    wrote("permission_request", 1);
    denied_by_a_self_test(&p).await;
    wrote("self_test_run", 1);
    p.run.engine.set_system_audio(PermissionState::Granted);
    core.app_activated();
    until_probes(&p, 1).await;
    wrote("system_audio_recheck", 1);

    // Setup steps, and the choices kept in settings sections.
    core.setup_set_step(
        &fr,
        StepArgs {
            step: SetupStep::Permissions,
            state: StepState::Done,
        },
    )
    .await
    .unwrap();
    wrote("setup_set_step", 1);
    core.setup_set_call_display(&fr, CallDisplayArgs { display_id: None })
        .await
        .unwrap();
    wrote("setup_set_call_display", 1);
    core.setup_set_audio_storage(
        &fr,
        AudioStorageArgs {
            never_store_audio: true,
            retention: AudioRetention::NeverStore,
        },
    )
    .await
    .unwrap();
    wrote("setup_set_audio_storage", 1);

    // Settings, hotkeys and the glossary.
    let current = core.settings_get(&settings, NoArgs {}).await.unwrap();
    let mut general = current.general.clone();
    general.ignored_apps = vec![IgnoredApp {
        bundle_id: "us.zoom.xos".into(),
        app_name: "Zoom".into(),
    }];
    core.settings_update(
        &settings,
        SettingsUpdateArgs {
            rev: current.rev,
            section: SettingsSection::General(general),
        },
    )
    .await
    .unwrap();
    wrote("settings_update", 1);
    core.settings_unignore_app(
        &settings,
        AppIdArgs {
            bundle_id: "us.zoom.xos".into(),
        },
    )
    .await
    .unwrap();
    wrote("settings_unignore_app", 1);
    core.hotkey_set(
        &settings,
        HotkeySetArgs {
            action: HotkeyAction::AskAboutCall,
            shortcut: Some("Ctrl+Alt+Super+I".into()),
        },
    )
    .await
    .unwrap();
    wrote("hotkey_set", 1);
    // Two records (the bindings and the card keys): a row each, under one batch id.
    core.hotkeys_reset(&settings, NoArgs {}).await.unwrap();
    wrote("hotkeys_reset", 2);
    let id = core
        .glossary_upsert(
            &settings,
            GlossaryUpsertArgs {
                id: None,
                rev: None,
                term: "VSTOR".into(),
                variants_latin: vec![],
                variants_cyrillic: vec![],
                spoken_forms: vec![],
                lang: None,
                always_apply: false,
            },
        )
        .await
        .unwrap()
        .terms[0]
        .id
        .clone();
    wrote("glossary_upsert", 1);
    core.glossary_remove(&settings, GlossaryIdArgs { id })
        .await
        .unwrap();
    wrote("glossary_remove", 1);

    let rows = change_rows(dir.path());
    let batched: Vec<&ChangeRow> = rows.iter().filter(|r| r.6.is_some()).collect();
    assert_eq!(batched.len(), 2);
    assert!(batched
        .iter()
        .all(|r| r.0 == "hotkeys_reset" && r.6 == batched[0].6));
    // Every row says what the write left.
    assert!(rows.iter().all(|r| r.4.is_some() || r.5.is_some()));
    // Each settings key holds the `after` of its last change row.
    let c = Connection::open(dir.path().join("noter.db")).unwrap();
    let keys: BTreeSet<&str> = rows
        .iter()
        .filter(|r| r.1 == "setting")
        .filter_map(|r| r.2.as_deref())
        .collect();
    for key in keys {
        let last = rows.iter().rev().find(|r| r.2.as_deref() == Some(key));
        let stored: String = c
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(last.unwrap().4.as_deref(), Some(stored.as_str()), "{key}");
    }
}
