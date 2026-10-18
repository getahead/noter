//! FEATURE cpt-noter-feature-core-first-run (part 1): setup status and choices, permissions
//! through NativeServices, the environment, the login item, the detection rule and
//! update_install. Models and the self-test come in the next parts.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use noter_core::{
    detection, BoxFuture, Clock, Core, CoreDeps, EnvironmentReading, EventEmitter, NativeServices,
    Updater,
};
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::Value;

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

impl Events {
    fn names(&self) -> Vec<&'static str> {
        std::mem::take(&mut *self.0.lock().unwrap())
            .into_iter()
            .map(|(n, _)| n)
            .collect()
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(1_790_000_000_000)
    }
}

/// A scripted Mac: permission states, what a prompt answers, the environment, the login item.
#[derive(Default)]
struct FakeNative {
    states: Mutex<HashMap<PermissionKind, PermissionState>>,
    answers: Mutex<HashMap<PermissionKind, PermissionState>>,
    asked: Mutex<Vec<PermissionKind>>,
    login: Mutex<Vec<bool>>,
}

fn display(id: &str, main: bool) -> DisplayInfo {
    DisplayInfo {
        id: DisplayId::new(id),
        name: id.into(),
        is_main: main,
        holds_call_app: false,
        width_pt: 1512,
        height_pt: 982,
    }
}

fn reading() -> EnvironmentReading {
    EnvironmentReading {
        displays: vec![display("dsp_main", true), display("dsp_side", false)],
        output_device: None,
        output_route: OutputRoute::Speakers,
        notifications: NotificationAuth::NotDetermined,
        online: true,
        disk_free_mb: 90_000,
    }
}

impl NativeServices for FakeNative {
    fn permission(&self, kind: PermissionKind) -> PermissionState {
        *self
            .states
            .lock()
            .unwrap()
            .get(&kind)
            .unwrap_or(&PermissionState::NotAsked)
    }
    fn request_permission(&self, kind: PermissionKind) -> BoxFuture<'_, PermissionState> {
        self.asked.lock().unwrap().push(kind);
        let answer = *self
            .answers
            .lock()
            .unwrap()
            .get(&kind)
            .unwrap_or(&PermissionState::Granted);
        self.states.lock().unwrap().insert(kind, answer);
        Box::pin(async move { answer })
    }
    fn environment(&self) -> EnvironmentReading {
        reading()
    }
    fn set_login_item(&self, on: bool) -> Result<(), CoreError> {
        self.login.lock().unwrap().push(on);
        Ok(())
    }
}

#[derive(Default)]
struct FakeUpdater {
    ready: Mutex<Option<UpdateInfo>>,
    installs: Mutex<u32>,
    fail: Mutex<bool>,
    relaunched: Mutex<bool>,
}

impl Updater for FakeUpdater {
    fn ready(&self) -> Option<UpdateInfo> {
        self.ready.lock().unwrap().clone()
    }
    fn install(&self) -> BoxFuture<'_, Result<(), CoreError>> {
        *self.installs.lock().unwrap() += 1;
        let fail = *self.fail.lock().unwrap();
        Box::pin(async move {
            if fail {
                Err(CoreError::new(ErrorCode::Internal, "bad signature"))
            } else {
                Ok(())
            }
        })
    }
    fn relaunch(&self) {
        *self.relaunched.lock().unwrap() = true;
    }
}

struct Setup {
    core: Arc<Core>,
    events: Arc<Events>,
    native: Arc<FakeNative>,
    updater: Arc<FakeUpdater>,
}

fn open(dir: &Path) -> Setup {
    let events = Arc::new(Events::default());
    let native = Arc::new(FakeNative::default());
    let updater = Arc::new(FakeUpdater::default());
    let deps = CoreDeps::new(Arc::new(FixedClock), events.clone())
        .with_native(native.clone())
        .with_updater(updater.clone());
    let core = Arc::new(Core::open(dir, deps).expect("core opens"));
    core.start_first_run();
    Setup {
        core,
        events,
        native,
        updater,
    }
}

fn first_run() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::FirstRun,
        },
    }
}

fn step_state(s: &SetupStatus, step: SetupStep) -> StepState {
    s.steps.iter().find(|r| r.step == step).unwrap().state
}

#[tokio::test]
async fn setup_status_starts_incomplete_with_detection_off() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path());
    let status = s.core.setup_status(&first_run(), NoArgs {}).await.unwrap();
    assert!(!status.complete);
    assert!(!status.detection_enabled);
    assert_eq!(status.self_test, SelfTestState::NotRun);
    assert!(status.steps.iter().all(|r| r.state == StepState::Todo));
    assert!(status
        .permissions
        .iter()
        .all(|p| p.state == PermissionState::NotAsked));
}

#[tokio::test]
async fn steps_are_marked_and_setup_completes_when_every_step_is_done_or_skipped() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path());
    let rev = s
        .core
        .settings_get(&first_run(), NoArgs {})
        .await
        .unwrap()
        .rev;
    s.events.names();
    let after = s
        .core
        .setup_set_step(
            &first_run(),
            StepArgs {
                step: SetupStep::Welcome,
                state: StepState::Done,
            },
        )
        .await
        .unwrap();
    assert_eq!(step_state(&after, SetupStep::Welcome), StepState::Done);
    assert_eq!(s.events.names(), vec![event_names::SETUP_CHANGED]);
    // Setup state lives under `setup` and never bumps the settings revision (D2).
    assert_eq!(
        s.core
            .settings_get(&first_run(), NoArgs {})
            .await
            .unwrap()
            .rev,
        rev
    );

    let mut last = after;
    for step in [
        SetupStep::Models,
        SetupStep::Permissions,
        SetupStep::CallDisplay,
        SetupStep::AudioStorage,
    ] {
        last = s
            .core
            .setup_set_step(
                &first_run(),
                StepArgs {
                    step,
                    state: StepState::Done,
                },
            )
            .await
            .unwrap();
    }
    assert!(!last.complete);
    let done = s
        .core
        .setup_set_step(
            &first_run(),
            // Decision D10: connecting an assistant is M3, but marking the step is M0.
            StepArgs {
                step: SetupStep::Assistants,
                state: StepState::Done,
            },
        )
        .await
        .unwrap();
    assert!(done.complete);
    assert!(done.version.0 > last.version.0);

    // Stored: a reopened core has the same steps.
    drop(s);
    let again = open(dir.path());
    let status = again
        .core
        .setup_status(&first_run(), NoArgs {})
        .await
        .unwrap();
    assert!(status.complete);
}

#[tokio::test]
async fn the_call_display_must_be_a_current_display_and_is_a_settings_change() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path());
    let rev = s
        .core
        .settings_get(&first_run(), NoArgs {})
        .await
        .unwrap()
        .rev;
    let gone = s
        .core
        .setup_set_call_display(
            &first_run(),
            CallDisplayArgs {
                display_id: Some(DisplayId::new("dsp_gone")),
            },
        )
        .await
        .unwrap_err();
    assert_eq!(gone.code, ErrorCode::InvalidInput);
    s.events.names();
    let status = s
        .core
        .setup_set_call_display(
            &first_run(),
            CallDisplayArgs {
                display_id: Some(DisplayId::new("dsp_side")),
            },
        )
        .await
        .unwrap();
    assert_eq!(status.call_display, Some(DisplayId::new("dsp_side")));
    let settings = s.core.settings_get(&first_run(), NoArgs {}).await.unwrap();
    assert_eq!(
        settings.call_screen.display_id,
        Some(DisplayId::new("dsp_side"))
    );
    assert_eq!(settings.rev.0, rev.0 + 1);
    let names = s.events.names();
    assert!(
        names.contains(&event_names::SETTINGS_CHANGED)
            && names.contains(&event_names::SETUP_CHANGED)
    );
}

#[tokio::test]
async fn never_store_audio_wins_and_a_contradiction_is_invalid_input() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path());
    let ctx = first_run();
    s.core
        .setup_set_audio_storage(
            &ctx,
            AudioStorageArgs {
                never_store_audio: true,
                retention: AudioRetention::Days30,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        s.core
            .settings_get(&ctx, NoArgs {})
            .await
            .unwrap()
            .audio
            .retention,
        AudioRetention::NeverStore
    );
    let err = s
        .core
        .setup_set_audio_storage(
            &ctx,
            AudioStorageArgs {
                never_store_audio: false,
                retention: AudioRetention::NeverStore,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
    s.core
        .setup_set_audio_storage(
            &ctx,
            AudioStorageArgs {
                never_store_audio: false,
                retention: AudioRetention::Days7,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        s.core
            .settings_get(&ctx, NoArgs {})
            .await
            .unwrap()
            .audio
            .retention,
        AudioRetention::Days7
    );
}

#[tokio::test]
async fn a_permission_is_asked_only_from_permission_request() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path());
    s.core.setup_status(&first_run(), NoArgs {}).await.unwrap();
    assert!(
        s.native.asked.lock().unwrap().is_empty(),
        "reading never prompts"
    );
    s.events.names();

    for kind in [
        PermissionKind::Microphone,
        PermissionKind::Calendar,
        PermissionKind::Notifications,
    ] {
        let row = s
            .core
            .permission_request(&first_run(), PermissionArgs { kind })
            .await
            .unwrap();
        assert_eq!(
            row,
            PermissionRow {
                kind,
                state: PermissionState::Granted
            }
        );
    }
    assert_eq!(
        *s.native.asked.lock().unwrap(),
        vec![
            PermissionKind::Microphone,
            PermissionKind::Calendar,
            PermissionKind::Notifications
        ]
    );
    let names = s.events.names();
    assert!(
        names.contains(&event_names::ENV_CHANGED) && names.contains(&event_names::SETUP_CHANGED)
    );
    let status = s.core.setup_status(&first_run(), NoArgs {}).await.unwrap();
    assert!(status
        .permissions
        .iter()
        .any(|p| p.kind == PermissionKind::Microphone && p.state == PermissionState::Granted));

    s.native
        .answers
        .lock()
        .unwrap()
        .insert(PermissionKind::Calendar, PermissionState::Denied);
    s.native
        .states
        .lock()
        .unwrap()
        .insert(PermissionKind::Calendar, PermissionState::NotAsked);
    let denied = s
        .core
        .permission_request(
            &first_run(),
            PermissionArgs {
                kind: PermissionKind::Calendar,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(denied.code, ErrorCode::PermissionDenied);
}

#[tokio::test]
async fn system_audio_is_inferred_from_the_self_test_never_asked_natively() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path());
    let row = s
        .core
        .permission_request(
            &first_run(),
            PermissionArgs {
                kind: PermissionKind::SystemAudio,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        row,
        PermissionRow {
            kind: PermissionKind::SystemAudio,
            state: PermissionState::NotAsked
        }
    );
    assert!(s.native.asked.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_environment_comes_from_native_readings_and_changes_are_broadcast() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path());
    let snap = s.core.app_snapshot(&first_run(), NoArgs {}).await.unwrap();
    assert_eq!(snap.environment.displays.len(), 2);
    assert_eq!(snap.environment.output_route, OutputRoute::Speakers);
    s.events.names();
    let mut changed = reading();
    changed.displays.pop();
    s.core.environment_changed(changed.clone());
    assert_eq!(s.events.names(), vec![event_names::ENV_CHANGED]);
    s.core.environment_changed(changed);
    assert!(
        s.events.names().is_empty(),
        "an unchanged reading sends nothing"
    );
    let snap2 = s.core.app_snapshot(&first_run(), NoArgs {}).await.unwrap();
    assert_eq!(snap2.environment.displays.len(), 1);
    assert!(snap2.environment.version.0 > snap.environment.version.0);
}

#[tokio::test]
async fn the_login_item_follows_launch_at_login() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path());
    let start = s.native.login.lock().unwrap().clone();
    assert_eq!(start.len(), 1, "applied once at start");
    let settings = s.core.settings_get(&first_run(), NoArgs {}).await.unwrap();
    let mut general = settings.general.clone();
    general.launch_at_login = !general.launch_at_login;
    let ctx = CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Settings,
        },
    };
    s.core
        .settings_update(
            &ctx,
            SettingsUpdateArgs {
                rev: settings.rev,
                section: SettingsSection::General(general.clone()),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        s.native.login.lock().unwrap().last(),
        Some(&general.launch_at_login)
    );
}

#[test]
fn detection_runs_only_with_offer_to_record_and_a_passed_self_test() {
    let passed = SelfTestState::Passed { at: TimestampMs(1) };
    assert_eq!(detection(true, &passed), (true, false));
    assert_eq!(detection(false, &passed), (false, false));
    assert_eq!(detection(true, &SelfTestState::NotRun), (false, true));
    assert_eq!(detection(true, &SelfTestState::Skipped), (false, true));
    assert_eq!(
        detection(
            true,
            &SelfTestState::Failed {
                reason: SelfTestFailure::ZeroBuffers
            }
        ),
        (false, true)
    );
}

#[tokio::test]
async fn update_install_needs_a_ready_update() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path());
    let ctx = CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Settings,
        },
    };
    assert_eq!(
        s.core
            .update_install(&ctx, NoArgs {})
            .await
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    *s.updater.ready.lock().unwrap() = Some(UpdateInfo {
        version: "1.0.1".into(),
        notes_md: "Fixes.".into(),
        ready: true,
    });
    // A failed install leaves the core running and nothing relaunches.
    *s.updater.fail.lock().unwrap() = true;
    assert_eq!(
        s.core
            .update_install(&ctx, NoArgs {})
            .await
            .unwrap_err()
            .code,
        ErrorCode::Internal
    );
    assert!(!*s.updater.relaunched.lock().unwrap());
    s.core.settings_get(&ctx, NoArgs {}).await.unwrap();
    *s.updater.fail.lock().unwrap() = false;
    s.core.update_install(&ctx, NoArgs {}).await.unwrap();
    assert_eq!(*s.updater.installs.lock().unwrap(), 2);
    assert!(
        *s.updater.relaunched.lock().unwrap(),
        "relaunched after the in-order shutdown"
    );
}
