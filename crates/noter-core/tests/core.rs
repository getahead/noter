//! FEATURE cpt-noter-feature-core-ipc-host: the composition root, app snapshot, banners,
//! whole-state versions and UI logs without content.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::{Arc, Mutex};

use noter_core::{Clock, Core, CoreDeps, EventEmitter};
use noter_protocol::ipc::{dispatch_json, event_names, Caller, CommandCtx, CoreApi, NativeSurface};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

impl Events {
    fn take(&self) -> Vec<(&'static str, Value)> {
        std::mem::take(&mut self.0.lock().unwrap())
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(1_790_000_000_000)
    }
}

fn open(dir: &Path) -> (Core, Arc<Events>) {
    let events = Arc::new(Events::default());
    let deps = CoreDeps::new(Arc::new(FixedClock), events.clone());
    (Core::open(dir, deps).expect("core opens"), events)
}

fn from(label: WindowLabel) -> CommandCtx {
    CommandCtx {
        caller: Caller::Window { label },
    }
}

fn update_ready() -> AppBanner {
    AppBanner::UpdateReady {
        version: "0.3.0".into(),
    }
}

fn interrupted() -> AppBanner {
    AppBanner::RecordingInterruptedByQuit {
        call: CallRef {
            id: CallId::new("call_1"),
            title: "Planning".into(),
            started_at: TimestampMs(1),
            call_type: CallTypeId("planning".into()),
        },
    }
}

#[tokio::test]
async fn the_snapshot_answers_for_the_calling_window_with_every_slice_at_version_1() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    assert!(dir.path().join("noter.db").is_file());
    let snap = core
        .app_snapshot(&from(WindowLabel::Settings), NoArgs {})
        .await
        .unwrap();
    assert_eq!(snap.window, WindowLabel::Settings);
    assert_eq!(snap.contract_version, CONTRACT_VERSION);
    assert_eq!(snap.app_version, "dev", "the host sets the app's version");
    let versions = [
        snap.setup.version,
        snap.capture.version,
        snap.detection.version,
        snap.privacy.version,
        snap.presenting.version,
        snap.degraded.version,
        snap.accounts.version,
        snap.proposals.version,
        snap.banners.version,
        snap.environment.version,
    ];
    assert!(versions.iter().all(|v| *v == StateVersion(1)));
    assert_eq!(snap.capture.phase, CapturePhase::Idle);
    assert!(!snap.setup.complete);
    assert!(snap.banners.banners.is_empty() && snap.degraded.states.is_empty());
    assert_eq!(snap.copilot, None);
    let native = CommandCtx {
        caller: Caller::Native {
            surface: NativeSurface::MenuBar,
        },
    };
    assert_eq!(
        core.app_snapshot(&native, NoArgs {}).await.unwrap().window,
        WindowLabel::Main
    );
}

#[tokio::test]
async fn banners_are_whole_state_with_growing_versions() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    let set = core.set_banners(vec![update_ready(), interrupted()]);
    assert_eq!(set.version, StateVersion(2));
    assert_eq!(
        events.take(),
        [(
            event_names::BANNERS_CHANGED,
            serde_json::to_value(&set).unwrap()
        )]
    );

    let main = from(WindowLabel::Main);
    let args = BannerDismissArgs {
        banner: BannerKind::RecordingInterruptedByQuit,
    };
    let after = core.banner_dismiss(&main, args.clone()).await.unwrap();
    assert_eq!(after.version, StateVersion(3));
    assert_eq!(after.banners, [update_ready()]);
    assert_eq!(
        events.take(),
        [(
            event_names::BANNERS_CHANGED,
            serde_json::to_value(&after).unwrap()
        )]
    );
    assert_eq!(
        core.app_snapshot(&main, NoArgs {}).await.unwrap().banners,
        after
    );

    // Already gone: the current set, unchanged, and no event.
    assert_eq!(core.banner_dismiss(&main, args).await.unwrap(), after);
    assert!(events.take().is_empty());
}

#[tokio::test]
async fn the_scope_check_runs_before_the_core() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    core.set_banners(vec![update_ready()]);
    events.take();
    let args = json!({ "banner": "update_ready" });
    let err = dispatch_json(
        &core,
        &from(WindowLabel::CallScreen),
        "banner_dismiss",
        args.clone(),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::WindowNotAllowed);
    let ok = dispatch_json(
        &core,
        &from(WindowLabel::Main),
        "banner_dismiss",
        args,
        None,
    )
    .await
    .unwrap();
    assert_eq!(ok["banners"], json!([]));
    let later = dispatch_json(
        &core,
        &from(WindowLabel::Main),
        "settings_get",
        json!({}),
        None,
    )
    .await;
    assert_eq!(later.unwrap_err().code, ErrorCode::NotImplemented);
}

#[tokio::test]
async fn degraded_and_entity_events_go_out_whole() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    let states = vec![DegradedState::CalendarAccessDenied];
    let set = core.set_degraded(states.clone());
    assert_eq!((set.version, set.states), (StateVersion(2), states));
    assert_eq!(core.set_degraded(vec![]).version, StateVersion(3));
    let sent = events.take();
    assert_eq!(sent.len(), 2);
    assert_eq!(
        sent[1],
        (
            event_names::DEGRADED_CHANGED,
            json!({ "version": 3, "states": [] })
        )
    );
    let snap = core
        .app_snapshot(&from(WindowLabel::Main), NoArgs {})
        .await
        .unwrap();
    assert_eq!(snap.degraded.version, StateVersion(3));

    let removed = EntityChanged::Removed {
        kind: EntityKind::Call,
        id: "call_9".into(),
    };
    core.emit_entity_changed(&removed);
    assert_eq!(
        events.take(),
        [(
            event_names::ENTITY_CHANGED,
            serde_json::to_value(&removed).unwrap()
        )]
    );
}

fn log_text(dir: &Path) -> String {
    std::fs::read_to_string(dir.join("logs").join("noter.log")).unwrap()
}

#[tokio::test]
async fn ui_logs_reach_the_private_log_without_any_free_text() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let message = "render failed: Anna said the Q3 budget is 2.4 million";
    let args = UiLogArgs {
        level: UiLogLevel::Error,
        screen: "call-page".into(),
        code: Some(ErrorCode::Conflict),
        message: message.into(),
    };
    let ack = core.log_ui(&from(WindowLabel::Main), args).await.unwrap();
    assert_eq!(ack, Ack {});
    let path = dir.path().join("logs").join("noter.log");
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let text = log_text(dir.path());
    for fragment in ["Anna said", "render failed", "budget", "2.4 million"] {
        assert!(!text.contains(fragment), "{fragment} reached the log");
    }
    let line: Value = serde_json::from_str(text.lines().next().unwrap()).unwrap();
    assert_eq!(line["level"], "error");
    assert_eq!(line["module"], "ui");
    assert_eq!(line["window"], "main");
    assert_eq!(line["screen"], "call-page");
    assert_eq!(line["code"], "conflict");
    assert_eq!(line["message_len"], json!(message.chars().count()));
    assert_eq!(line["ts"], 1_790_000_000_000_i64);
    assert!(line.get("message").is_none());

    // A screen that is not an identifier is free text too.
    let args = UiLogArgs {
        level: UiLogLevel::Warn,
        screen: "Anna said hi".into(),
        code: None,
        message: String::new(),
    };
    core.log_ui(&from(WindowLabel::Main), args).await.unwrap();
    let text = log_text(dir.path());
    let line: Value = serde_json::from_str(text.lines().nth(1).unwrap()).unwrap();
    assert!(line.get("screen").is_none());
    assert!(!text.contains("Anna said"));
}

#[tokio::test]
async fn core_log_records_keep_only_the_allow_list() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let secret = "the customer asked us to drop the Berlin office";
    let record = json!({
        "level": "warn",
        "module": "transcript",
        "command": "transcript_subscribe",
        "id": "call_1",
        "duration_ms": 12,
        "count": 3,
        "text": secret,
        "transcript": secret,
        "prompt": secret,
        "summary": secret,
        "nested": { "content": secret },
        "message": secret,
        "module_note": secret,
    });
    core.log(record.as_object().unwrap().clone());
    let text = log_text(dir.path());
    assert!(!text.contains(secret));
    let line: Value = serde_json::from_str(text.lines().next().unwrap()).unwrap();
    assert_eq!(line["command"], "transcript_subscribe");
    assert_eq!(
        (line["count"].clone(), line["duration_ms"].clone()),
        (json!(3), json!(12))
    );
    assert_eq!(line.as_object().unwrap().len(), 7);
}

#[tokio::test]
async fn a_broken_database_is_a_boot_error() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("noter.db"), vec![0x5a; 8192]).unwrap();
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(Events::default()));
    let err = Core::open(dir.path(), deps).err().expect("boot fails");
    assert!(err.to_string().contains("database"), "{err}");
    // The log names the kind of failure, never the error's text.
    let line: Value = serde_json::from_str(log_text(dir.path()).lines().next().unwrap()).unwrap();
    assert_eq!(
        (line["module"].clone(), line["code"].clone()),
        (json!("storage"), json!("corrupt"))
    );
    assert!(line.get("message").is_none());
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(Events::default()));
    let file = dir.path().join("plain-file");
    std::fs::write(&file, b"x").unwrap();
    let err = Core::open(&file, deps).err().expect("not a folder");
    assert!(!err.to_string().is_empty());
}

#[tokio::test]
async fn shutdown_closes_the_store_and_a_new_core_opens_the_same_folder() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    core.shutdown().await;
    core.shutdown().await;
    drop(core);
    let (again, _) = open(dir.path());
    assert!(again
        .app_snapshot(&from(WindowLabel::Main), NoArgs {})
        .await
        .is_ok());
}

#[test]
fn the_system_clock_is_epoch_milliseconds() {
    let now = noter_core::SystemClock.now();
    assert!(now.0 > 1_700_000_000_000);
}

#[tokio::test]
async fn the_snapshot_carries_the_app_version_the_host_gives() {
    let dir = tempfile::tempdir().unwrap();
    let deps =
        CoreDeps::new(Arc::new(FixedClock), Arc::new(Events::default())).with_app_version("0.2.0");
    let core = Core::open(dir.path(), deps).unwrap();
    let snap = core
        .app_snapshot(&from(WindowLabel::Main), NoArgs {})
        .await
        .unwrap();
    assert_eq!(snap.app_version, "0.2.0");
}

#[test]
fn the_app_keeps_its_data_under_application_support() {
    let dir = noter_core::default_data_dir().expect("HOME is set");
    assert!(
        dir.ends_with("Library/Application Support/Noter"),
        "{}",
        dir.display()
    );
}
