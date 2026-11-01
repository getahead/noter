//! FEATURE cpt-noter-feature-core-native-services (core side): `share_test_run` hands the
//! native layer the request, whether a call is live, the menu bar title's state and the time,
//! and answers its result; the rows and the probe states are the native layer's (noter-native).

use std::sync::{Arc, Mutex};

use noter_core::{BoxFuture, Clock, Core, CoreDeps, EventEmitter, NativeOps, SaveKind};
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi};
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
        TimestampMs(1_792_137_600_000)
    }
}

/// The asks the core made, and the answer it gets.
#[derive(Default)]
struct Ops {
    asked: Mutex<Vec<(bool, bool, bool, TimestampMs)>>,
    fails: Mutex<Option<ErrorCode>>,
}

impl NativeOps for Ops {
    fn save_panel<'a>(
        &'a self,
        _: &'a str,
        _: SaveKind,
    ) -> BoxFuture<'a, Option<std::path::PathBuf>> {
        Box::pin(async { None })
    }

    fn share_test<'a>(
        &'a self,
        args: &'a ShareTestArgs,
        call_live: bool,
        menu_bar_title_shown: bool,
        now: TimestampMs,
    ) -> BoxFuture<'a, Result<ShareTestResult, ErrorCode>> {
        self.asked.lock().unwrap().push((
            args.run_capture_test,
            call_live,
            menu_bar_title_shown,
            now,
        ));
        let failed = *self.fails.lock().unwrap();
        Box::pin(async move {
            if let Some(code) = failed {
                return Err(code);
            }
            Ok(ShareTestResult {
                rows: vec![],
                capture_test: CaptureTestOutcome::NotRun,
            })
        })
    }
}

fn open(dir: &std::path::Path, ops: Arc<Ops>) -> Core {
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(NoEvents)).with_native_ops(ops);
    Core::open(dir, deps).expect("core opens")
}

fn settings() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Settings,
        },
    }
}

async fn run(core: &Core, capture: bool) -> Result<ShareTestResult, CoreError> {
    core.share_test_run(
        &settings(),
        ShareTestArgs {
            run_capture_test: capture,
        },
    )
    .await
}

#[tokio::test]
async fn the_share_test_asks_the_native_layer_with_the_call_and_menu_bar_state() {
    let dir = tempfile::tempdir().unwrap();
    let ops = Arc::new(Ops::default());
    let core = open(dir.path(), ops.clone());
    let now = FixedClock.now();

    run(&core, false).await.unwrap();
    // Idle, with the default menu bar title (none).
    assert_eq!(
        ops.asked.lock().unwrap().pop(),
        Some((false, false, false, now))
    );

    let rev = core.settings_get(&settings(), NoArgs {}).await.unwrap().rev;
    core.settings_update(
        &settings(),
        SettingsUpdateArgs {
            rev,
            section: SettingsSection::MenuBar(MenuBarSettings {
                title: MenuBarTitle::ElapsedTime,
                hidden_actions: vec![],
            }),
        },
    )
    .await
    .unwrap();
    let mut live = core
        .app_snapshot(&settings(), NoArgs {})
        .await
        .unwrap()
        .capture;
    live.phase = CapturePhase::Recording;
    live.call_id = Some(CallId::new("call_x"));
    noter_core::testing::seed_capture(&core, live.clone())
        .await
        .unwrap();
    run(&core, true).await.unwrap();
    // A recording call shows its elapsed time beside the glyph.
    assert_eq!(
        ops.asked.lock().unwrap().pop(),
        Some((true, true, true, now))
    );

    live.phase = CapturePhase::Paused;
    noter_core::testing::seed_capture(&core, live)
        .await
        .unwrap();
    run(&core, true).await.unwrap();
    assert!(
        ops.asked.lock().unwrap().pop().unwrap().1,
        "a paused call is live"
    );

    core.app_set_hidden_for_presenting(&settings(), HiddenArgs { hidden: true })
        .await
        .unwrap();
    run(&core, true).await.unwrap();
    // Hidden for presenting: the title is off the menu bar.
    assert!(!ops.asked.lock().unwrap().pop().unwrap().2);
}

#[tokio::test]
async fn a_native_failure_is_the_commands_typed_error() {
    let dir = tempfile::tempdir().unwrap();
    let ops = Arc::new(Ops::default());
    *ops.fails.lock().unwrap() = Some(ErrorCode::Internal);
    let core = open(dir.path(), ops);
    assert_eq!(
        run(&core, false).await.unwrap_err().code,
        ErrorCode::Internal
    );
}

#[tokio::test]
async fn without_a_mac_the_share_test_fails_rather_than_report_a_false_pass() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(
        dir.path(),
        CoreDeps::new(Arc::new(FixedClock), Arc::new(NoEvents)),
    )
    .unwrap();
    assert_eq!(
        run(&core, true).await.unwrap_err().code,
        ErrorCode::Internal
    );
}
