//! The job scheduler on paused tokio time, a scripted power source and a controllable worker.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_db::{Migration, Mutation, Store};
use noter_jobs::{
    BoxFuture, CaptureGuardState, Clock, Deps, JobHandler, PowerSource, ProgressSink, Request,
    RunCtx, Scheduler, Stop, Trigger, BATCH_MAX,
};
use noter_protocol::model::{CountEntry, JobKind, JobRunRow, JobRunStatus};
use noter_protocol::{CallId, CoreError, ErrorCode, JobRunId, TimestampMs};
use serde_json::json;
use tokio::sync::{mpsc, watch};

const TARGETS: &[Migration] = &[Migration {
    owner: "test",
    version: 1,
    name: "targets",
    sql: "CREATE TABLE targets (id TEXT PRIMARY KEY, v TEXT NOT NULL)",
}];

struct FixedClock(AtomicI64);
impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(self.0.load(Ordering::SeqCst))
    }
}

struct Power(AtomicBool);
impl PowerSource for Power {
    fn on_battery(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

#[derive(Default)]
struct Events(Mutex<Vec<JobRunRow>>);
impl ProgressSink for Events {
    fn publish(&self, run: &JobRunRow) {
        self.0.lock().unwrap().push(run.clone());
    }
}

/// What a test tells the worker to do next.
enum Step {
    Batch(Vec<(&'static str, &'static str)>),
    Checkpoint,
    Fail(ErrorCode),
    Panic,
    Done,
}

/// One handler for a kind: reports each run it starts, then follows the test's steps.
struct Worker {
    started: mpsc::UnboundedSender<(JobKind, Option<String>)>,
    kind: JobKind,
    steps: tokio::sync::Mutex<mpsc::UnboundedReceiver<Step>>,
}

impl JobHandler for Worker {
    fn run<'a>(&'a self, ctx: &'a mut RunCtx) -> BoxFuture<'a, Result<(), Stop>> {
        Box::pin(async move {
            let _ = self
                .started
                .send((self.kind, ctx.subject().map(String::from)));
            let mut steps = self.steps.lock().await;
            let mut n = 0;
            while let Some(step) = steps.recv().await {
                match step {
                    Step::Batch(rows) => {
                        n += rows.len() as u32;
                        let targets = rows.into_iter().map(|(id, v)| target(id, v)).collect();
                        let counts = vec![CountEntry {
                            label: "rows".into(),
                            n,
                        }];
                        ctx.commit_batch(targets, counts, Some(0.5)).await?;
                    }
                    Step::Checkpoint => ctx.checkpoint().await?,
                    Step::Fail(code) => return Err(CoreError::new(code, "scripted").into()),
                    Step::Panic => panic!("worker died"),
                    Step::Done => return Ok(()),
                }
            }
            Ok(())
        })
    }
}

fn target(id: &str, v: &str) -> Mutation {
    Mutation {
        entity_type: "target",
        table: "targets",
        id: id.into(),
        base_rev: None,
        bump_rev: false,
        values: vec![("v", json!(v))],
    }
}

struct Rig {
    sched: Scheduler,
    store: Arc<Store>,
    clock: Arc<FixedClock>,
    power: Arc<Power>,
    events: Arc<Events>,
    guard: watch::Sender<CaptureGuardState>,
    started: mpsc::UnboundedReceiver<(JobKind, Option<String>)>,
    steps: Vec<(JobKind, mpsc::UnboundedSender<Step>)>,
    dir: tempfile::TempDir,
}

const KINDS: [JobKind; 4] = [
    JobKind::PostCall,
    JobKind::ArchivePass,
    JobKind::Regeneration,
    JobKind::ModelDownload,
];

fn open_store(dir: &tempfile::TempDir) -> Arc<Store> {
    Arc::new(
        Store::open(
            &dir.path().join("noter.db"),
            &[noter_db::MIGRATIONS, TARGETS],
        )
        .unwrap(),
    )
}

/// A scheduler on `store` with a worker for every kind; not started.
fn rig_on(dir: tempfile::TempDir, store: Arc<Store>, clock_ms: i64) -> Rig {
    let clock = Arc::new(FixedClock(AtomicI64::new(clock_ms)));
    let power = Arc::new(Power(AtomicBool::new(false)));
    let events = Arc::new(Events::default());
    let (guard, guard_rx) = watch::channel(CaptureGuardState::default());
    let sched = Scheduler::new(Deps {
        store: store.clone(),
        clock: clock.clone(),
        power: power.clone(),
        sink: events.clone(),
        guard: guard_rx,
    });
    let (started_tx, started) = mpsc::unbounded_channel();
    let mut steps = vec![];
    for kind in KINDS {
        let (tx, rx) = mpsc::unbounded_channel();
        sched.register(
            kind,
            Arc::new(Worker {
                started: started_tx.clone(),
                kind,
                steps: tokio::sync::Mutex::new(rx),
            }),
        );
        steps.push((kind, tx));
    }
    Rig {
        sched,
        store,
        clock,
        power,
        events,
        guard,
        started,
        steps,
        dir,
    }
}

async fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let store = open_store(&dir);
    let r = rig_on(dir, store, 1_000);
    for kind in KINDS {
        r.sched.define(kind).unwrap();
    }
    r.sched.start().await.unwrap();
    r
}

impl Rig {
    fn step(&self, kind: JobKind, step: Step) {
        self.steps
            .iter()
            .find(|(k, _)| *k == kind)
            .unwrap()
            .1
            .send(step)
            .unwrap();
    }
    fn post_call(&self, call: &str) -> Request {
        Request::for_call(JobKind::PostCall, Trigger::AfterCall, &CallId::new(call))
    }
    fn archive(&self, call: &str) -> Request {
        Request::for_call(JobKind::ArchivePass, Trigger::AfterCall, &CallId::new(call))
    }
    fn go(&self, req: Request) -> JobRunId {
        self.sched.trigger(req).unwrap().expect("a run")
    }
    fn live(&self, live: bool, resumed: Option<&str>) {
        self.guard
            .send(CaptureGuardState {
                live,
                resumed_call: resumed.map(CallId::new),
            })
            .unwrap();
    }
    fn status(&self, id: &JobRunId) -> JobRunStatus {
        self.run(id).status
    }
    fn run(&self, id: &JobRunId) -> JobRunRow {
        self.sched
            .runs()
            .unwrap()
            .into_iter()
            .find(|r| &r.id == id)
            .expect("run row")
    }
    fn statuses_of(&self, id: &JobRunId) -> Vec<JobRunStatus> {
        let mut out: Vec<JobRunStatus> = vec![];
        for e in self.events.0.lock().unwrap().iter().filter(|e| &e.id == id) {
            if out.last() != Some(&e.status) {
                out.push(e.status);
            }
        }
        out
    }
    fn target_rows(&self) -> i64 {
        self.store
            .read(|c| c.query_row("SELECT COUNT(*) FROM targets", [], |r| r.get(0)))
            .unwrap()
    }
    fn set_job(&self, kind: &str, column: &'static str, value: serde_json::Value) {
        let id = format!("job_{kind}");
        self.store
            .write(
                Mutation {
                    entity_type: "job",
                    table: "jobs",
                    id,
                    base_rev: None,
                    bump_rev: false,
                    values: vec![(column, value)],
                },
                noter_db::ChangeMeta {
                    actor: noter_protocol::model::Actor::You,
                    summary: "test".into(),
                    reason: "test".into(),
                    evidence_ids: vec![],
                    batch_id: None,
                    undoable: false,
                    surface: None,
                },
            )
            .unwrap();
    }
}

async fn settle() {
    tokio::time::sleep(Duration::from_millis(5)).await;
}

#[tokio::test(start_paused = true)]
async fn a_trigger_queues_a_run_that_runs_and_succeeds() {
    let mut r = rig().await;
    let id = r.go(r.post_call("call_1"));
    settle().await;
    assert_eq!(
        r.started.recv().await.unwrap(),
        (JobKind::PostCall, Some("call_1".into()))
    );
    assert_eq!(r.status(&id), JobRunStatus::Running);
    r.step(JobKind::PostCall, Step::Done);
    settle().await;
    let row = r.run(&id);
    assert_eq!(row.status, JobRunStatus::Succeeded);
    assert_eq!(row.progress, Some(1.0));
    assert!(row.finished_at.is_some() && row.error.is_none());
    assert_eq!(row.name, "Post-call analysis");
    assert_eq!(
        r.statuses_of(&id),
        [
            JobRunStatus::Queued,
            JobRunStatus::Running,
            JobRunStatus::Succeeded
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_pending_trigger_for_the_same_work_returns_the_same_run() {
    let r = rig().await;
    let a = r.go(r.post_call("call_1"));
    let b = r.go(r.post_call("call_1"));
    let c = r.go(r.post_call("call_2"));
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert_eq!(r.sched.runs().unwrap().len(), 2);
    // Once it is over, the next stop queues fresh work.
    settle().await;
    r.step(JobKind::PostCall, Step::Done);
    settle().await;
    assert_ne!(r.go(r.post_call("call_1")), a);
}

#[tokio::test(start_paused = true)]
async fn disabled_definitions_and_triggers_outside_the_schedule_are_ignored() {
    let r = rig().await;
    r.set_job("post_call", "enabled", json!(0));
    assert_eq!(r.sched.trigger(r.post_call("call_1")).unwrap(), None);
    assert!(r.sched.runs().unwrap().is_empty());
    // A job that runs on another trigger ignores this one.
    assert_eq!(
        r.sched
            .trigger(Request::for_call(
                JobKind::ArchivePass,
                Trigger::Hourly,
                &CallId::new("c")
            ))
            .unwrap(),
        None
    );
    // A nightly window: 02:00-05:00 UTC.
    r.set_job("regeneration", "trigger", json!("nightly_window"));
    r.set_job("regeneration", "schedule", json!("2-5"));
    let nightly = Request::new(JobKind::Regeneration, Trigger::NightlyWindow);
    r.clock.0.store(12 * 3_600_000, Ordering::SeqCst);
    assert_eq!(r.sched.trigger(nightly.clone()).unwrap(), None);
    r.clock.0.store(3 * 3_600_000, Ordering::SeqCst);
    assert!(r.sched.trigger(nightly).unwrap().is_some());
}

#[tokio::test(start_paused = true)]
async fn on_battery_a_job_that_needs_power_waits_and_one_that_allows_battery_runs() {
    let mut r = rig().await;
    r.power.0.store(true, Ordering::SeqCst);
    let archive = r.go(r.archive("call_1"));
    r.set_job("post_call", "allow_on_battery", json!(1));
    let post = r.go(r.post_call("call_1"));
    settle().await;
    assert_eq!(r.status(&archive), JobRunStatus::Queued);
    assert_eq!(r.status(&post), JobRunStatus::Running);
    assert_eq!(r.started.recv().await.unwrap().0, JobKind::PostCall);
    // Power returns: the next tick lets the queued run go.
    r.power.0.store(false, Ordering::SeqCst);
    r.sched.tick();
    settle().await;
    assert_eq!(r.status(&archive), JobRunStatus::Running);
}

#[tokio::test(start_paused = true)]
async fn a_running_job_pauses_on_battery_at_its_checkpoint_and_resumes_on_power() {
    let r = rig().await;
    let id = r.go(r.archive("call_1"));
    settle().await;
    r.power.0.store(true, Ordering::SeqCst);
    r.step(JobKind::ArchivePass, Step::Checkpoint);
    settle().await;
    assert_eq!(r.status(&id), JobRunStatus::Paused);
    r.power.0.store(false, Ordering::SeqCst);
    r.sched.tick();
    settle().await;
    assert_eq!(r.status(&id), JobRunStatus::Running);
    r.step(JobKind::ArchivePass, Step::Done);
    settle().await;
    assert_eq!(
        r.statuses_of(&id),
        [
            JobRunStatus::Queued,
            JobRunStatus::Running,
            JobRunStatus::Paused,
            JobRunStatus::Running,
            JobRunStatus::Succeeded
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn during_a_live_call_only_the_previous_calls_post_call_runs() {
    let mut r = rig().await;
    r.live(true, None);
    settle().await;
    let archive = r.go(r.archive("call_1"));
    let regen = r.go(Request::for_call(
        JobKind::Regeneration,
        Trigger::OnDemand,
        &CallId::new("call_1"),
    ));
    let post = r.go(r.post_call("call_1"));
    settle().await;
    assert_eq!(r.status(&archive), JobRunStatus::Queued);
    assert_eq!(r.status(&regen), JobRunStatus::Queued);
    assert_eq!(r.status(&post), JobRunStatus::Running);
    assert_eq!(r.started.recv().await.unwrap().0, JobKind::PostCall);
    // The call ends: the waiting work goes, archive before regeneration.
    r.live(false, None);
    settle().await;
    assert_eq!(r.status(&archive), JobRunStatus::Running);
    assert_eq!(r.status(&regen), JobRunStatus::Running);
    assert_eq!(r.started.recv().await.unwrap().0, JobKind::ArchivePass);
}

#[tokio::test(start_paused = true)]
async fn a_new_capture_pauses_a_running_archive_and_it_resumes_from_its_checkpoint() {
    let r = rig().await;
    let id = r.go(r.archive("call_1"));
    settle().await;
    r.step(
        JobKind::ArchivePass,
        Step::Batch(vec![("a", "1"), ("b", "1")]),
    );
    settle().await;
    r.live(true, None);
    settle().await;
    r.step(JobKind::ArchivePass, Step::Batch(vec![("c", "1")]));
    settle().await;
    assert_eq!(r.status(&id), JobRunStatus::Paused);
    assert_eq!(
        r.target_rows(),
        2,
        "the next batch waits for the call to end"
    );
    r.live(false, None);
    settle().await;
    assert_eq!(r.status(&id), JobRunStatus::Running);
    assert_eq!(r.target_rows(), 3);
    assert_eq!(
        r.run(&id).counts,
        vec![CountEntry {
            label: "rows".into(),
            n: 3
        }]
    );
}

#[tokio::test(start_paused = true)]
async fn continue_recording_cancels_the_same_calls_pipeline_and_rejects_late_results() {
    let mut r = rig().await;
    r.live(true, None);
    settle().await;
    let running = r.go(r.post_call("call_1"));
    let waiting = r.go(r.archive("call_1"));
    let other = r.go(r.post_call("call_2"));
    settle().await;
    assert_eq!(r.started.recv().await.unwrap().0, JobKind::PostCall);
    assert_eq!(r.status(&waiting), JobRunStatus::Queued);
    // The user resumes call_1: its queued and running generations are cancelled; call_2's goes on.
    r.live(true, Some("call_1"));
    settle().await;
    assert_eq!(r.status(&waiting), JobRunStatus::Cancelled);
    r.step(JobKind::PostCall, Step::Batch(vec![("late", "1")]));
    settle().await;
    assert_eq!(r.status(&running), JobRunStatus::Cancelled);
    assert_eq!(r.target_rows(), 0, "a stale completion writes nothing");
    assert_ne!(r.status(&other), JobRunStatus::Cancelled);
    // A later stop queues fresh work for the call.
    r.live(false, None);
    let fresh = r.go(r.post_call("call_1"));
    assert_ne!(fresh, running);
}

#[tokio::test(start_paused = true)]
async fn a_post_call_triggered_for_the_resumed_call_is_cancelled_instead_of_admitted() {
    let r = rig().await;
    r.live(true, Some("call_1"));
    settle().await;
    let id = r.go(r.post_call("call_1"));
    settle().await;
    assert_eq!(r.status(&id), JobRunStatus::Cancelled);
}

#[tokio::test(start_paused = true)]
async fn runs_start_in_priority_order() {
    let mut r = rig().await;
    r.live(true, None);
    settle().await;
    r.power.0.store(true, Ordering::SeqCst);
    r.set_job("post_call", "allow_on_battery", json!(0));
    for req in [
        r.archive("call_1"),
        Request::for_call(
            JobKind::Regeneration,
            Trigger::OnDemand,
            &CallId::new("call_1"),
        ),
        Request::new(JobKind::ModelDownload, Trigger::OnDemand),
        r.post_call("call_1"),
    ] {
        r.go(req);
    }
    r.live(false, None);
    r.power.0.store(false, Ordering::SeqCst);
    r.sched.tick();
    settle().await;
    let mut order = vec![];
    while let Ok((kind, _)) = r.started.try_recv() {
        order.push(kind);
    }
    assert_eq!(
        order,
        [
            JobKind::PostCall,
            JobKind::ModelDownload,
            JobKind::ArchivePass,
            JobKind::Regeneration
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_run_cancels_from_queued_running_and_paused() {
    let r = rig().await;
    r.live(true, None);
    settle().await;
    let queued = r.go(r.archive("call_1"));
    let running = r.go(r.post_call("call_1"));
    settle().await;
    r.step(JobKind::PostCall, Step::Batch(vec![("a", "1")]));
    settle().await;
    r.sched.cancel(&queued).unwrap();
    assert_eq!(r.status(&queued), JobRunStatus::Cancelled);
    r.sched.cancel(&running).unwrap();
    r.step(JobKind::PostCall, Step::Checkpoint);
    settle().await;
    let row = r.run(&running);
    assert_eq!(row.status, JobRunStatus::Cancelled);
    assert_eq!(row.counts[0].n, 1, "cancelled with its final counts");
    assert!(row.finished_at.is_some());
    // Paused: an archive that was running when the call began.
    r.live(false, None);
    settle().await;
    let archive = r.go(r.archive("call_2"));
    settle().await;
    r.live(true, None);
    r.step(JobKind::ArchivePass, Step::Checkpoint);
    settle().await;
    assert_eq!(r.status(&archive), JobRunStatus::Paused);
    r.sched.cancel(&archive).unwrap();
    settle().await;
    assert_eq!(r.status(&archive), JobRunStatus::Cancelled);
    // A finished run cannot be cancelled again.
    assert!(r.sched.cancel(&archive).is_err());
}

#[tokio::test(start_paused = true)]
async fn a_failure_records_its_typed_error_and_keeps_earlier_batches() {
    let r = rig().await;
    let id = r.go(r.post_call("call_1"));
    settle().await;
    r.step(JobKind::PostCall, Step::Batch(vec![("a", "1")]));
    r.step(JobKind::PostCall, Step::Fail(ErrorCode::DiskFull));
    settle().await;
    let row = r.run(&id);
    assert_eq!(row.status, JobRunStatus::Failed);
    assert_eq!(row.error, Some(ErrorCode::DiskFull));
    assert_eq!(row.counts[0].n, 1);
    assert_eq!(r.target_rows(), 1);
    let last = r.events.0.lock().unwrap().last().cloned().unwrap();
    assert_eq!(last, row);
}

#[tokio::test(start_paused = true)]
async fn a_worker_that_dies_fails_the_run() {
    let r = rig().await;
    let id = r.go(r.post_call("call_1"));
    settle().await;
    r.step(JobKind::PostCall, Step::Panic);
    settle().await;
    let row = r.run(&id);
    assert_eq!(
        (row.status, row.error),
        (JobRunStatus::Failed, Some(ErrorCode::Internal))
    );
}

#[tokio::test(start_paused = true)]
async fn a_batch_commits_at_most_200_rows_under_one_batch_id_and_the_run_actor() {
    let r = rig().await;
    let id = r.go(r.post_call("call_1"));
    settle().await;
    assert_eq!(BATCH_MAX, 200);
    let rows: Vec<(&'static str, &'static str)> = (0..BATCH_MAX)
        .map(|i| (&*Box::leak(format!("t{i}").into_boxed_str()), "v"))
        .collect();
    r.step(JobKind::PostCall, Step::Batch(rows));
    settle().await;
    assert_eq!(r.target_rows(), 200);
    let (batches, actors): (i64, i64) = r
        .store
        .read(|c| {
            c.query_row(
                "SELECT COUNT(DISTINCT batch_id), COUNT(DISTINCT actor) FROM changes WHERE entity_type = 'target'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
        })
        .unwrap();
    assert_eq!((batches, actors), (1, 1));
    let actor: String = r
        .store
        .read(|c| {
            c.query_row(
                "SELECT actor FROM changes WHERE entity_type = 'target' LIMIT 1",
                [],
                |row| row.get(0),
            )
        })
        .unwrap();
    assert!(actor.starts_with("job:"), "{actor}");
    assert!(r.run(&id).progress.is_some());
    // 201 is refused whole.
    let rows: Vec<(&'static str, &'static str)> = (0..=BATCH_MAX)
        .map(|i| (&*Box::leak(format!("u{i}").into_boxed_str()), "v"))
        .collect();
    r.step(JobKind::PostCall, Step::Batch(rows));
    settle().await;
    assert_eq!(r.target_rows(), 200);
    let row = r.run(&id);
    assert_eq!(
        (row.status, row.error),
        (JobRunStatus::Failed, Some(ErrorCode::InvalidInput))
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_batch_rolls_back_and_progress_stays_truthful() {
    let r = rig().await;
    let id = r.go(r.post_call("call_1"));
    settle().await;
    r.step(JobKind::PostCall, Step::Batch(vec![("a", "1")]));
    settle().await;
    let published = r.events.0.lock().unwrap().len();
    // A trigger on the table refuses the id `c`, so the second batch fails as a whole.
    r.store.write_with(
        noter_db::ChangeMeta {
            actor: noter_protocol::model::Actor::You,
            summary: "t".into(),
            reason: "t".into(),
            evidence_ids: vec![],
            batch_id: None,
            undoable: false,
            surface: None,
        },
        |tx| {
            tx.execute_batch("CREATE TRIGGER no_c BEFORE INSERT ON targets WHEN NEW.id = 'c' BEGIN SELECT RAISE(ABORT, 'no'); END;").unwrap();
            Ok(((), vec![noter_db::Logged { entity_type: "test", entity_id: "t".into(), field: None, before: None, after: None, delta: None }]))
        },
    ).unwrap();
    r.step(JobKind::PostCall, Step::Batch(vec![("b", "1"), ("c", "1")]));
    settle().await;
    let row = r.run(&id);
    assert_eq!(row.status, JobRunStatus::Failed);
    assert_eq!(r.target_rows(), 1, "the failed batch left no row");
    assert_eq!(row.counts[0].n, 1, "progress is the last committed batch");
    assert_eq!(
        r.events
            .0
            .lock()
            .unwrap()
            .iter()
            .skip(published)
            .map(|e| e.status)
            .collect::<Vec<_>>(),
        [JobRunStatus::Failed]
    );
}

#[tokio::test(start_paused = true)]
async fn restart_fails_unfinished_runs_and_queues_a_retry() {
    let dir = tempfile::tempdir().unwrap();
    let store = open_store(&dir);
    let mut r = rig_on(dir, store.clone(), 1_000);
    r.sched.start().await.unwrap();
    let running = r.go(r.post_call("call_1"));
    settle().await;
    r.live(true, None);
    let paused = r.go(r.archive("call_1"));
    settle().await;
    let _ = r.started.recv().await;
    let queued = r.go(Request::for_call(
        JobKind::Regeneration,
        Trigger::OnDemand,
        &CallId::new("call_1"),
    ));
    settle().await;
    assert_eq!(r.status(&queued), JobRunStatus::Queued);
    let _ = paused;
    // The process ends: a new scheduler opens the same database.
    let dir = r.dir;
    drop(r.sched);
    let r2 = rig_on(dir, store, 9_000);
    r2.sched.start().await.unwrap();
    settle().await;
    let runs = r2.sched.runs().unwrap();
    let old = runs.iter().find(|x| x.id == running).unwrap();
    assert_eq!(
        (old.status, old.error),
        (JobRunStatus::Failed, Some(ErrorCode::Internal))
    );
    // The unfinished post-call was retried as a new run, which started.
    let retry: Vec<_> = runs
        .iter()
        .filter(|x| x.kind == JobKind::PostCall && x.id != running)
        .collect();
    assert_eq!(retry.len(), 1);
    assert_eq!(retry[0].status, JobRunStatus::Running);
    // The queued run was never started: it is still queued and now runs.
    assert_eq!(
        runs.iter().find(|x| x.id == queued).unwrap().status,
        JobRunStatus::Running
    );
}

#[tokio::test(start_paused = true)]
async fn hourly_work_runs_when_due_and_not_twice() {
    let r = rig().await;
    r.set_job("regeneration", "trigger", json!("hourly"));
    r.sched.tick();
    settle().await;
    let first = r.sched.runs().unwrap();
    assert_eq!(
        first
            .iter()
            .filter(|x| x.kind == JobKind::Regeneration)
            .count(),
        1
    );
    r.step(JobKind::Regeneration, Step::Done);
    settle().await;
    r.clock.0.fetch_add(30 * 60_000, Ordering::SeqCst);
    r.sched.tick();
    settle().await;
    assert_eq!(
        r.sched
            .runs()
            .unwrap()
            .iter()
            .filter(|x| x.kind == JobKind::Regeneration)
            .count(),
        1
    );
    r.clock.0.fetch_add(31 * 60_000, Ordering::SeqCst);
    r.sched.tick();
    settle().await;
    assert_eq!(
        r.sched
            .runs()
            .unwrap()
            .iter()
            .filter(|x| x.kind == JobKind::Regeneration)
            .count(),
        2
    );
}

#[tokio::test(start_paused = true)]
async fn the_background_loop_applies_guard_changes_and_polls_power() {
    let r = rig().await;
    r.live(true, None);
    settle().await;
    let archive = r.go(r.archive("call_1"));
    r.live(false, None);
    settle().await;
    assert_eq!(r.status(&archive), JobRunStatus::Running);
    // Power is read on the loop's own interval.
    r.step(JobKind::ArchivePass, Step::Done);
    settle().await;
    r.power.0.store(true, Ordering::SeqCst);
    let again = r.go(r.archive("call_2"));
    settle().await;
    assert_eq!(r.status(&again), JobRunStatus::Queued);
    r.power.0.store(false, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_secs(61)).await;
    assert_eq!(r.status(&again), JobRunStatus::Running);
}
