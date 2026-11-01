//! FEATURE cpt-noter-feature-core-jobs-scheduler in the composition root: the scheduler starts
//! with the core, its runs go out as `jobs:progress` with complete rows, and the capture guard is
//! the session manager's one input.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{Clock, Core, CoreDeps, EventEmitter};
use noter_jobs::{CaptureGuardState, Request, Trigger};
use noter_protocol::model::{JobKind, JobProgress, JobRunStatus};
use noter_protocol::{CallId, TimestampMs};
use serde_json::Value;

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
    fn progress(&self) -> Vec<JobProgress> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|(e, _)| *e == "jobs:progress")
            .map(|(_, p)| serde_json::from_value(p.clone()).unwrap())
            .collect()
    }
}

#[tokio::test(start_paused = true)]
async fn the_core_starts_the_scheduler_and_publishes_complete_progress_rows() {
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Events::default());
    let core = Arc::new(
        Core::open(
            dir.path(),
            CoreDeps::new(Arc::new(FixedClock), events.clone()),
        )
        .unwrap(),
    );
    core.start_first_run();
    tokio::time::sleep(Duration::from_millis(10)).await;
    // The pipeline kinds have no-op handlers until post-call and archive land: they succeed.
    let req = Request::for_call(
        JobKind::PostCall,
        Trigger::AfterCall,
        &CallId::new("call_1"),
    );
    let id = core.scheduler().trigger(req).unwrap().expect("queued");
    tokio::time::sleep(Duration::from_millis(10)).await;
    let rows: Vec<_> = events
        .progress()
        .into_iter()
        .map(|p| p.run)
        .filter(|r| r.id == id)
        .collect();
    let statuses: Vec<_> = rows.iter().map(|r| r.status).collect();
    assert_eq!(
        statuses,
        [
            JobRunStatus::Queued,
            JobRunStatus::Running,
            JobRunStatus::Succeeded
        ]
    );
    assert_eq!(rows[2].name, "Post-call analysis");
    assert_eq!(rows[2].progress, Some(1.0));
}

#[tokio::test(start_paused = true)]
async fn the_capture_guard_holds_archive_work_the_core_queued() {
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Events::default());
    let core = Arc::new(
        Core::open(
            dir.path(),
            CoreDeps::new(Arc::new(FixedClock), events.clone()),
        )
        .unwrap(),
    );
    core.start_first_run();
    tokio::time::sleep(Duration::from_millis(10)).await;
    core.capture_guard()
        .send(CaptureGuardState {
            live: true,
            resumed_call: None,
        })
        .unwrap();
    tokio::time::sleep(Duration::from_millis(10)).await;
    let req = Request::for_call(
        JobKind::ArchivePass,
        Trigger::AfterCall,
        &CallId::new("call_1"),
    );
    let id = core.scheduler().trigger(req).unwrap().expect("queued");
    tokio::time::sleep(Duration::from_millis(10)).await;
    let last = events
        .progress()
        .into_iter()
        .map(|p| p.run)
        .rfind(|r| r.id == id)
        .unwrap();
    assert_eq!(last.status, JobRunStatus::Queued);
    core.capture_guard()
        .send(CaptureGuardState::default())
        .unwrap();
    tokio::time::sleep(Duration::from_millis(10)).await;
    let last = events
        .progress()
        .into_iter()
        .map(|p| p.run)
        .rfind(|r| r.id == id)
        .unwrap();
    assert_eq!(last.status, JobRunStatus::Succeeded);
}

struct Battery(std::sync::atomic::AtomicBool);

impl noter_jobs::PowerSource for Battery {
    fn on_battery(&self) -> bool {
        self.0.load(std::sync::atomic::Ordering::SeqCst)
    }
}

// @cpt-dod:cpt-noter-dod-core-jobs-scheduler-scheduling:p1
#[tokio::test(start_paused = true)]
async fn the_cores_power_source_holds_archive_work_on_battery_until_mains_returns() {
    use std::sync::atomic::Ordering;
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Events::default());
    let power = Arc::new(Battery(std::sync::atomic::AtomicBool::new(true)));
    let core = Arc::new(
        Core::open(
            dir.path(),
            CoreDeps::new(Arc::new(FixedClock), events.clone()).with_power(power.clone()),
        )
        .unwrap(),
    );
    core.start_first_run();
    tokio::time::sleep(Duration::from_millis(10)).await;
    let req = Request::for_call(
        JobKind::ArchivePass,
        Trigger::AfterCall,
        &CallId::new("call_1"),
    );
    let id = core.scheduler().trigger(req).unwrap().expect("queued");
    tokio::time::sleep(Duration::from_millis(10)).await;
    let status = |events: &Events| {
        events
            .progress()
            .into_iter()
            .map(|p| p.run)
            .rfind(|r| r.id == id)
            .unwrap()
            .status
    };
    assert_eq!(status(&events), JobRunStatus::Queued);
    power.0.store(false, Ordering::SeqCst);
    core.scheduler().tick();
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert_eq!(status(&events), JobRunStatus::Succeeded);
}
