//! The job scheduler (`cpt-noter-component-core-jobs`): durable runs of pipeline jobs, trigger
//! dispatch, the battery and live-call guards, bounded logged batches and `jobs:progress`.
//!
//! Workers are cooperative: a handler reaches a safe boundary through `RunCtx::checkpoint` or
//! `RunCtx::commit_batch`, where it pauses, resumes or stops. Handlers never hold the SQLite
//! writer: each batch is one short writer job.

mod rows;

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use noter_db::{Mutation, Store};
use noter_protocol::model::{CountEntry, JobKind, JobRunRow, JobRunStatus};
use noter_protocol::{CallId, CoreError, ErrorCode, JobRunId, TimestampMs};
use serde_json::json;
use tokio::sync::watch;

pub use rows::Trigger;
use rows::{Def, Stored};

/// The most target rows one logged batch changes.
pub const BATCH_MAX: usize = 200;

/// How often the loop reads power and fires hourly and nightly work.
const TICK: Duration = Duration::from_secs(60);
const HOUR_MS: i64 = 3_600_000;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Time as the scheduler sees it (the core's clock in the app, a fixed one in tests).
pub trait Clock: Send + Sync {
    fn now(&self) -> TimestampMs;
}

/// Whether the Mac runs on battery (the environment reading in the app).
pub trait PowerSource: Send + Sync {
    fn on_battery(&self) -> bool;
}

/// Where `jobs:progress` goes: only complete, committed run rows.
pub trait ProgressSink: Send + Sync {
    fn publish(&self, run: &JobRunRow);
}

/// What the session manager publishes about capture (TL-23); the scheduler never reads the
/// session machine itself.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CaptureGuardState {
    pub live: bool,
    /// The call a live capture continues (Continue Recording), if it is one.
    pub resumed_call: Option<CallId>,
}

/// Why a handler stopped.
#[derive(Debug)]
pub enum Stop {
    Cancelled,
    Failed(CoreError),
}

impl From<CoreError> for Stop {
    fn from(e: CoreError) -> Self {
        Stop::Failed(e)
    }
}

/// The work of one job kind. It runs once per run, reports progress through `ctx` and returns
/// at the end; `ctx` tells it to stop (`Stop::Cancelled`) and holds it while a guard blocks it.
pub trait JobHandler: Send + Sync {
    fn run<'a>(&'a self, ctx: &'a mut RunCtx) -> BoxFuture<'a, Result<(), Stop>>;
}

/// A request to queue work.
#[derive(Debug, Clone)]
pub struct Request {
    pub kind: JobKind,
    pub trigger: Trigger,
    /// What the work is for (a call id, a model id); the same subject pending is the same work.
    pub subject: Option<String>,
}

impl Request {
    pub fn new(kind: JobKind, trigger: Trigger) -> Self {
        Self {
            kind,
            trigger,
            subject: None,
        }
    }

    pub fn for_call(kind: JobKind, trigger: Trigger, call: &CallId) -> Self {
        Self {
            kind,
            trigger,
            subject: Some(call.0.clone()),
        }
    }
}

pub struct Deps {
    pub store: Arc<Store>,
    pub clock: Arc<dyn Clock>,
    pub power: Arc<dyn PowerSource>,
    pub sink: Arc<dyn ProgressSink>,
    pub guard: watch::Receiver<CaptureGuardState>,
}

struct Entry {
    row: JobRunRow,
    subject: Option<String>,
    cancel: bool,
}

struct Inner {
    deps: Deps,
    handlers: Mutex<HashMap<JobKind, Arc<dyn JobHandler>>>,
    /// Queued, running and paused runs.
    open: Mutex<HashMap<JobRunId, Entry>>,
    /// Bumped whenever a guard, power or a cancellation may have changed what workers may do.
    epoch: watch::Sender<u64>,
}

#[derive(Clone)]
pub struct Scheduler(Arc<Inner>);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Pipeline work of one call: Continue Recording cancels it.
fn is_pipeline(kind: JobKind) -> bool {
    matches!(
        kind,
        JobKind::PostCall | JobKind::ArchivePass | JobKind::Regeneration
    )
}

/// Whether `def`'s work for `subject` may not run now (`cpt-noter-algo-core-jobs-scheduler-admit`).
fn held(def: &Def, subject: &Option<String>, battery: bool, guard: &CaptureGuardState) -> bool {
    // @cpt-begin:cpt-noter-algo-core-jobs-scheduler-admit:p1:inst-admit-enabled
    if !def.enabled {
        return true;
    }
    // @cpt-end:cpt-noter-algo-core-jobs-scheduler-admit:p1:inst-admit-enabled
    // @cpt-begin:cpt-noter-algo-core-jobs-scheduler-admit:p1:inst-admit-battery
    if battery && !def.allow_on_battery {
        return true;
    }
    // @cpt-end:cpt-noter-algo-core-jobs-scheduler-admit:p1:inst-admit-battery
    // @cpt-begin:cpt-noter-algo-core-jobs-scheduler-admit:p1:inst-admit-call
    // A post-call run of the call being resumed is obsolete and is cancelled, never admitted.
    let resumed =
        guard.resumed_call.as_ref().map(|c| &c.0) == subject.as_ref() && subject.is_some();
    guard.live && (def.kind != JobKind::PostCall || resumed)
    // @cpt-end:cpt-noter-algo-core-jobs-scheduler-admit:p1:inst-admit-call
}

/// Whether `ms` falls in the "HH-HH" hour window (UTC; a window may wrap midnight).
// shortcut: UTC hours, not the user's time zone; upgrade with the maintenance jobs (M5).
fn in_window(schedule: &Option<String>, ms: i64) -> bool {
    let hour = (ms / HOUR_MS).rem_euclid(24);
    let Some((a, b)) = schedule.as_deref().and_then(|s| s.split_once('-')) else {
        return true;
    };
    match (a.parse::<i64>(), b.parse::<i64>()) {
        (Ok(a), Ok(b)) if a <= b => (a..b).contains(&hour),
        (Ok(a), Ok(b)) => hour >= a || hour < b,
        _ => true,
    }
}

impl Scheduler {
    pub fn new(deps: Deps) -> Self {
        Self(Arc::new(Inner {
            deps,
            handlers: Mutex::new(HashMap::new()),
            open: Mutex::new(HashMap::new()),
            epoch: watch::channel(0).0,
        }))
    }

    /// The handler for a kind; its job definition is created with its defaults on the first
    /// `define` or `trigger` (nothing is written to the change log before work is asked for).
    pub fn register(&self, kind: JobKind, handler: Arc<dyn JobHandler>) {
        lock(&self.0.handlers).insert(kind, handler);
    }

    /// Reconciles runs a previous process left unfinished, fires the
    /// startup trigger and starts the loop (guard changes, power and scheduled triggers).
    pub async fn start(&self) -> Result<(), CoreError> {
        self.0.reconcile()?;
        self.0.fire(|d| d.trigger == Trigger::Startup)?;
        let weak = Arc::downgrade(&self.0);
        let mut guard = self.0.deps.guard.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(TICK);
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tokio::select! {
                    changed = guard.changed() => if changed.is_err() { break },
                    _ = tick.tick() => {}
                }
                let Some(inner) = weak.upgrade() else { break };
                inner.tick();
            }
        });
        self.0.apply();
        Ok(())
    }

    // @cpt-flow:cpt-noter-flow-core-jobs-scheduler-run:p1
    /// Queues the work a trigger asks for and returns its run (the existing run for the same
    /// pending work). `None`: the definition is disabled or the trigger is not its own.
    pub fn trigger(&self, req: Request) -> Result<Option<JobRunId>, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-jobs-scheduler-run:p1:inst-run-trigger
        let now = self.0.deps.clock.now().0;
        let def = self.0.define(req.kind)?;
        let own = req.trigger == Trigger::OnDemand || def.trigger == req.trigger;
        let on_time = req.trigger != Trigger::NightlyWindow || in_window(&def.schedule, now);
        if !def.enabled || !own || !on_time {
            return Ok(None);
        }
        // @cpt-end:cpt-noter-flow-core-jobs-scheduler-run:p1:inst-run-trigger
        let id = self.0.enqueue(&def, req.subject)?;
        self.0.apply();
        // @cpt-begin:cpt-noter-flow-core-jobs-scheduler-run:p1:inst-run-return
        Ok(Some(id))
        // @cpt-end:cpt-noter-flow-core-jobs-scheduler-run:p1:inst-run-return
    }

    /// Creates a job's settings row with its defaults if it has none.
    pub fn define(&self, kind: JobKind) -> Result<(), CoreError> {
        self.0.define(kind).map(|_| ())
    }

    /// Cancels a queued, running or paused run; a running one stops at its next boundary.
    // @cpt-flow:cpt-noter-flow-core-jobs-scheduler-interrupt:p1
    pub fn cancel(&self, id: &JobRunId) -> Result<(), CoreError> {
        if !lock(&self.0.open).contains_key(id) {
            return Err(CoreError::new(ErrorCode::NotFound, "this run is not open"));
        }
        self.0.cancel(id);
        Ok(())
    }

    /// One pass of the loop: scheduled triggers, power, guards.
    pub fn tick(&self) {
        self.0.tick();
    }

    /// Every run, oldest first.
    pub fn runs(&self) -> Result<Vec<JobRunRow>, CoreError> {
        Ok(rows::runs(&self.0.deps.store)?
            .into_iter()
            .map(|s| s.row)
            .collect())
    }
}

impl Inner {
    /// The job's settings row, created with its defaults if it is missing.
    fn define(&self, kind: JobKind) -> Result<Def, CoreError> {
        if let Some(def) = rows::defs(&self.deps.store)?
            .into_iter()
            .find(|d| d.kind == kind)
        {
            return Ok(def);
        }
        if !lock(&self.handlers).contains_key(&kind) {
            return Err(CoreError::new(ErrorCode::NotFound, "no job of this kind"));
        }
        let (trigger, battery) = rows::default_def(kind);
        let id = rows::job_id(kind);
        let row = JobRunRow {
            id: JobRunId::new(""),
            job_id: id.clone(),
            kind,
            name: rows::name_of(kind),
            started_at: self.deps.clock.now(),
            finished_at: None,
            status: JobRunStatus::Queued,
            counts: vec![],
            error: None,
            progress: None,
        };
        self.deps.store.write(
            Mutation {
                entity_type: "job",
                table: "jobs",
                id: id.0.clone(),
                base_rev: None,
                bump_rev: false,
                values: vec![
                    ("kind", json!(rows::kind_str(kind))),
                    ("trigger", json!(trigger.as_str())),
                    ("enabled", json!(1)),
                    ("allow_on_battery", json!(battery)),
                ],
            },
            rows::meta(&row, "defined"),
        )?;
        Ok(Def {
            id,
            kind,
            trigger,
            schedule: None,
            enabled: true,
            allow_on_battery: battery,
            last_run_at: None,
        })
    }

    // @cpt-state:cpt-noter-state-core-jobs-scheduler-run:p1
    /// Runs a previous process left running or paused did not finish: they fail with a typed
    /// error and each is retried as a new run; queued ones go on as they are.
    fn reconcile(&self) -> Result<(), CoreError> {
        let now = self.deps.clock.now();
        let defs = rows::defs(&self.deps.store)?;
        let mut retries = vec![];
        for Stored { mut row, subject } in rows::runs(&self.deps.store)? {
            match row.status {
                JobRunStatus::Queued => {
                    lock(&self.open).insert(
                        row.id.clone(),
                        Entry {
                            row,
                            subject,
                            cancel: false,
                        },
                    );
                }
                JobRunStatus::Running | JobRunStatus::Paused => {
                    // @cpt-begin:cpt-noter-state-core-jobs-scheduler-run:p1:inst-st-failed
                    row.status = JobRunStatus::Failed;
                    row.finished_at = Some(now);
                    row.error = Some(ErrorCode::Internal);
                    rows::save(&self.deps.store, &row, &subject)?;
                    self.deps.sink.publish(&row);
                    retries.push((row.kind, subject));
                    // @cpt-end:cpt-noter-state-core-jobs-scheduler-run:p1:inst-st-failed
                }
                _ => {}
            }
        }
        for (kind, subject) in retries {
            if let Some(def) = defs.iter().find(|d| d.kind == kind && d.enabled) {
                self.enqueue(def, subject)?;
            }
        }
        Ok(())
    }

    /// Queues the due work of the definitions `due` selects.
    fn fire(&self, due: impl Fn(&Def) -> bool) -> Result<(), CoreError> {
        let now = self.deps.clock.now().0;
        for def in rows::defs(&self.deps.store)?
            .into_iter()
            .filter(|d| d.enabled && due(d))
        {
            let gap = match def.trigger {
                Trigger::Hourly => HOUR_MS,
                // At most once a night: the window is a few hours wide.
                Trigger::NightlyWindow if in_window(&def.schedule, now) => 20 * HOUR_MS,
                Trigger::NightlyWindow => continue,
                _ => 0,
            };
            if def.last_run_at.map_or(true, |last| now - last >= gap) {
                self.enqueue(&def, None)?;
            }
        }
        Ok(())
    }

    fn tick(self: &Arc<Self>) {
        let _ = self.fire(|d| matches!(d.trigger, Trigger::Hourly | Trigger::NightlyWindow));
        self.apply();
    }

    // @cpt-begin:cpt-noter-flow-core-jobs-scheduler-run:p1:inst-run-enqueue
    fn enqueue(&self, def: &Def, subject: Option<String>) -> Result<JobRunId, CoreError> {
        let now = self.deps.clock.now();
        let row = {
            let mut open = lock(&self.open);
            let same = open
                .values()
                .find(|e| e.row.kind == def.kind && e.subject == subject);
            if let Some(e) = same {
                return Ok(e.row.id.clone());
            }
            let row = JobRunRow {
                id: JobRunId::new(format!("run_{}", ulid::Ulid::generate())),
                job_id: def.id.clone(),
                kind: def.kind,
                name: rows::name_of(def.kind),
                started_at: now,
                finished_at: None,
                status: JobRunStatus::Queued,
                counts: vec![],
                error: None,
                progress: None,
            };
            open.insert(
                row.id.clone(),
                Entry {
                    row: row.clone(),
                    subject: subject.clone(),
                    cancel: false,
                },
            );
            row
        };
        if let Err(e) = rows::save(&self.deps.store, &row, &subject) {
            lock(&self.open).remove(&row.id);
            return Err(e);
        }
        self.deps.sink.publish(&row);
        self.deps.store.write(
            Mutation {
                entity_type: "job",
                table: "jobs",
                id: def.id.0.clone(),
                base_rev: None,
                bump_rev: false,
                values: vec![("last_run_at", json!(now.0))],
            },
            rows::meta(&row, "queued"),
        )?;
        Ok(row.id)
    }
    // @cpt-end:cpt-noter-flow-core-jobs-scheduler-run:p1:inst-run-enqueue

    /// Applies the guards: cancels the resumed call's pipeline, then admits what may run.
    fn apply(self: &Arc<Self>) {
        self.cancel_resumed();
        self.dispatch();
        self.epoch.send_modify(|n| *n += 1);
    }

    // @cpt-begin:cpt-noter-flow-core-jobs-scheduler-interrupt:p1:inst-interrupt-change
    // @cpt-begin:cpt-noter-flow-core-jobs-scheduler-interrupt:p1:inst-interrupt-continue
    // @cpt-begin:cpt-noter-algo-core-jobs-scheduler-admit:p1:inst-admit-same-call
    fn cancel_resumed(&self) {
        let guard = self.deps.guard.borrow().clone();
        let Some(call) = guard.resumed_call else {
            return;
        };
        let ids: Vec<JobRunId> = lock(&self.open)
            .values()
            .filter(|e| is_pipeline(e.row.kind) && e.subject.as_deref() == Some(call.0.as_str()))
            .map(|e| e.row.id.clone())
            .collect();
        for id in ids {
            self.cancel(&id);
        }
    }
    // @cpt-end:cpt-noter-algo-core-jobs-scheduler-admit:p1:inst-admit-same-call
    // @cpt-end:cpt-noter-flow-core-jobs-scheduler-interrupt:p1:inst-interrupt-continue
    // @cpt-end:cpt-noter-flow-core-jobs-scheduler-interrupt:p1:inst-interrupt-change

    // @cpt-begin:cpt-noter-flow-core-jobs-scheduler-interrupt:p1:inst-interrupt-cancel
    fn cancel(&self, id: &JobRunId) {
        let done = {
            let mut open = lock(&self.open);
            let Some(entry) = open.get_mut(id) else {
                return;
            };
            entry.cancel = true;
            if entry.row.status != JobRunStatus::Queued {
                None
            } else {
                // @cpt-begin:cpt-noter-state-core-jobs-scheduler-run:p1:inst-st-cancel
                entry.row.status = JobRunStatus::Cancelled;
                entry.row.finished_at = Some(self.deps.clock.now());
                // @cpt-end:cpt-noter-state-core-jobs-scheduler-run:p1:inst-st-cancel
                open.remove(id).map(|e| (e.row, e.subject))
            }
        };
        match done {
            Some((row, subject)) => self.record(&row, &subject),
            None => {
                self.epoch.send_modify(|n| *n += 1);
            }
        }
    }
    // @cpt-end:cpt-noter-flow-core-jobs-scheduler-interrupt:p1:inst-interrupt-cancel

    /// Persists a run's new state, then publishes it: only committed progress is published.
    // @cpt-begin:cpt-noter-flow-core-jobs-scheduler-run:p1:inst-run-progress
    fn record(&self, row: &JobRunRow, subject: &Option<String>) {
        if rows::save(&self.deps.store, row, subject).is_ok() {
            self.deps.sink.publish(row);
        }
    }
    // @cpt-end:cpt-noter-flow-core-jobs-scheduler-run:p1:inst-run-progress

    // @cpt-algo:cpt-noter-algo-core-jobs-scheduler-admit:p1
    /// Starts the queued runs that may run, in priority order.
    fn dispatch(self: &Arc<Self>) {
        // @cpt-begin:cpt-noter-flow-core-jobs-scheduler-run:p1:inst-run-admit
        let Ok(defs) = rows::defs(&self.deps.store) else {
            return;
        };
        let battery = self.deps.power.on_battery();
        let guard = self.deps.guard.borrow().clone();
        let now = self.deps.clock.now();
        let started: Vec<(JobRunRow, Option<String>)> = {
            let mut open = lock(&self.open);
            // @cpt-begin:cpt-noter-algo-core-jobs-scheduler-admit:p1:inst-admit-priority
            let mut ready: Vec<&mut Entry> = open
                .values_mut()
                .filter(|e| e.row.status == JobRunStatus::Queued && !e.cancel)
                .filter(|e| {
                    defs.iter()
                        .find(|d| d.kind == e.row.kind)
                        .is_some_and(|d| !held(d, &e.subject, battery, &guard))
                })
                .collect();
            ready.sort_by_key(|e| {
                (
                    rows::priority(e.row.kind),
                    e.row.started_at.0,
                    e.row.id.clone(),
                )
            });
            // @cpt-end:cpt-noter-algo-core-jobs-scheduler-admit:p1:inst-admit-priority
            ready
                .into_iter()
                .map(|e| {
                    // @cpt-begin:cpt-noter-state-core-jobs-scheduler-run:p1:inst-st-start
                    e.row.status = JobRunStatus::Running;
                    e.row.started_at = now;
                    // @cpt-end:cpt-noter-state-core-jobs-scheduler-run:p1:inst-st-start
                    (e.row.clone(), e.subject.clone())
                })
                .collect()
        };
        // @cpt-end:cpt-noter-flow-core-jobs-scheduler-run:p1:inst-run-admit
        // @cpt-begin:cpt-noter-flow-core-jobs-scheduler-run:p1:inst-run-start
        for (row, subject) in started {
            self.record(&row, &subject);
            let handler = lock(&self.handlers).get(&row.kind).cloned();
            // @cpt-begin:cpt-noter-algo-core-jobs-scheduler-admit:p1:inst-admit-return
            // The handler runs on its own task, with no writer held.
            match handler {
                Some(handler) => self.spawn(row, subject, handler),
                None => self.finish(
                    &row.id,
                    Err(Stop::Failed(CoreError::new(
                        ErrorCode::NotImplemented,
                        "no handler for this job",
                    ))),
                ),
            }
            // @cpt-end:cpt-noter-algo-core-jobs-scheduler-admit:p1:inst-admit-return
        }
        // @cpt-end:cpt-noter-flow-core-jobs-scheduler-run:p1:inst-run-start
    }

    fn spawn(
        self: &Arc<Self>,
        row: JobRunRow,
        subject: Option<String>,
        handler: Arc<dyn JobHandler>,
    ) {
        let inner = self.clone();
        let mut ctx = RunCtx {
            inner: self.clone(),
            id: row.id.clone(),
            kind: row.kind,
            subject,
            epoch: self.epoch.subscribe(),
        };
        tokio::spawn(async move {
            let id = ctx.id.clone();
            let result = tokio::spawn(async move { handler.run(&mut ctx).await }).await;
            inner.finish(
                &id,
                result.unwrap_or_else(|_| {
                    Err(Stop::Failed(CoreError::new(
                        ErrorCode::Internal,
                        "the worker died",
                    )))
                }),
            );
        });
    }

    // @cpt-begin:cpt-noter-flow-core-jobs-scheduler-run:p1:inst-run-finish
    fn finish(self: &Arc<Self>, id: &JobRunId, result: Result<(), Stop>) {
        let done = {
            let mut open = lock(&self.open);
            let Some(mut entry) = open.remove(id) else {
                return;
            };
            entry.row.finished_at = Some(self.deps.clock.now());
            match result {
                // @cpt-begin:cpt-noter-state-core-jobs-scheduler-run:p1:inst-st-success
                Ok(()) if !entry.cancel => {
                    entry.row.status = JobRunStatus::Succeeded;
                    entry.row.progress = Some(1.0);
                }
                // @cpt-end:cpt-noter-state-core-jobs-scheduler-run:p1:inst-st-success
                Ok(()) | Err(Stop::Cancelled) => entry.row.status = JobRunStatus::Cancelled,
                Err(Stop::Failed(e)) => {
                    entry.row.status = JobRunStatus::Failed;
                    entry.row.error = Some(e.code);
                }
            }
            (entry.row, entry.subject)
        };
        self.record(&done.0, &done.1);
        self.apply();
    }
    // @cpt-end:cpt-noter-flow-core-jobs-scheduler-run:p1:inst-run-finish
}

/// What a handler holds while it runs.
pub struct RunCtx {
    inner: Arc<Inner>,
    id: JobRunId,
    kind: JobKind,
    subject: Option<String>,
    epoch: watch::Receiver<u64>,
}

impl RunCtx {
    pub fn run_id(&self) -> &JobRunId {
        &self.id
    }

    pub fn subject(&self) -> Option<&str> {
        self.subject.as_deref()
    }

    /// A safe boundary: returns when the run may go on, holding it paused while a guard blocks
    /// it, or `Stop::Cancelled` once it was cancelled.
    pub async fn checkpoint(&mut self) -> Result<(), Stop> {
        loop {
            self.epoch.borrow_and_update();
            if self.inner.settle(&self.id, self.kind, &self.subject)? {
                return Ok(());
            }
            self.epoch.changed().await.map_err(|_| {
                Stop::Failed(CoreError::new(ErrorCode::Internal, "the scheduler stopped"))
            })?;
        }
    }

    // @cpt-algo:cpt-noter-algo-core-jobs-scheduler-batch:p1
    /// Commits at most `BATCH_MAX` target rows with the run's checkpoint (`counts`, `progress`)
    /// in one logged transaction, then yields. A refused or failed batch leaves earlier batches
    /// in place and the run's published progress as it was.
    pub async fn commit_batch(
        &mut self,
        targets: Vec<Mutation>,
        counts: Vec<CountEntry>,
        progress: Option<f32>,
    ) -> Result<(), Stop> {
        // @cpt-begin:cpt-noter-algo-core-jobs-scheduler-batch:p1:inst-batch-limit
        if targets.len() > BATCH_MAX {
            return Err(Stop::Failed(CoreError::new(
                ErrorCode::InvalidInput,
                format!("a batch changes at most {BATCH_MAX} rows"),
            )));
        }
        // @cpt-end:cpt-noter-algo-core-jobs-scheduler-batch:p1:inst-batch-limit
        // @cpt-begin:cpt-noter-algo-core-jobs-scheduler-batch:p1:inst-batch-check
        self.checkpoint().await?;
        // @cpt-end:cpt-noter-algo-core-jobs-scheduler-batch:p1:inst-batch-check
        let Some(mut next) = lock(&self.inner.open).get(&self.id).map(|e| e.row.clone()) else {
            return Err(Stop::Cancelled);
        };
        next.counts = counts;
        next.progress = progress;
        let mut mutations = targets;
        mutations.push(rows::run_mutation(&next, &self.subject));
        // @cpt-begin:cpt-noter-algo-core-jobs-scheduler-batch:p1:inst-batch-try
        // @cpt-begin:cpt-noter-algo-core-jobs-scheduler-batch:p1:inst-batch-fail
        // The batch commits whole or not at all; its error fails the run, which keeps the counts
        // of the last committed batch.
        self.inner
            .deps
            .store
            .write_batch(mutations, rows::meta(&next, "batch"))
            .map_err(Stop::Failed)?;
        // @cpt-end:cpt-noter-algo-core-jobs-scheduler-batch:p1:inst-batch-fail
        // @cpt-end:cpt-noter-algo-core-jobs-scheduler-batch:p1:inst-batch-try
        if let Some(entry) = lock(&self.inner.open).get_mut(&self.id) {
            entry.row = next.clone();
        }
        // @cpt-begin:cpt-noter-algo-core-jobs-scheduler-batch:p1:inst-batch-yield
        self.inner.deps.sink.publish(&next);
        tokio::task::yield_now().await;
        // @cpt-end:cpt-noter-algo-core-jobs-scheduler-batch:p1:inst-batch-yield
        // @cpt-begin:cpt-noter-algo-core-jobs-scheduler-batch:p1:inst-batch-return
        Ok(())
        // @cpt-end:cpt-noter-algo-core-jobs-scheduler-batch:p1:inst-batch-return
    }
}

impl Inner {
    /// One look at a running run: `true` when it may go on, `false` when a guard holds it
    /// (it is then paused), an error when it was cancelled. Persists a status change.
    fn settle(&self, id: &JobRunId, kind: JobKind, subject: &Option<String>) -> Result<bool, Stop> {
        let def = rows::defs(&self.deps.store)?
            .into_iter()
            .find(|d| d.kind == kind);
        let guard = self.deps.guard.borrow().clone();
        let hold = def.map_or(true, |d| {
            held(&d, subject, self.deps.power.on_battery(), &guard)
        });
        let changed = {
            let mut open = lock(&self.open);
            let Some(entry) = open.get_mut(id) else {
                return Err(Stop::Cancelled);
            };
            if entry.cancel {
                return Err(Stop::Cancelled);
            }
            // @cpt-begin:cpt-noter-flow-core-jobs-scheduler-interrupt:p1:inst-interrupt-pause
            // @cpt-begin:cpt-noter-flow-core-jobs-scheduler-interrupt:p1:inst-interrupt-postcall
            // @cpt-begin:cpt-noter-state-core-jobs-scheduler-run:p1:inst-st-pause
            if hold && entry.row.status == JobRunStatus::Running {
                entry.row.status = JobRunStatus::Paused;
                Some(entry.row.clone())
            // @cpt-end:cpt-noter-state-core-jobs-scheduler-run:p1:inst-st-pause
            // @cpt-end:cpt-noter-flow-core-jobs-scheduler-interrupt:p1:inst-interrupt-postcall
            // @cpt-end:cpt-noter-flow-core-jobs-scheduler-interrupt:p1:inst-interrupt-pause
            // @cpt-begin:cpt-noter-flow-core-jobs-scheduler-interrupt:p1:inst-interrupt-resume
            // @cpt-begin:cpt-noter-state-core-jobs-scheduler-run:p1:inst-st-resume
            } else if !hold && entry.row.status == JobRunStatus::Paused {
                entry.row.status = JobRunStatus::Running;
                Some(entry.row.clone())
            // @cpt-end:cpt-noter-state-core-jobs-scheduler-run:p1:inst-st-resume
            // @cpt-end:cpt-noter-flow-core-jobs-scheduler-interrupt:p1:inst-interrupt-resume
            } else {
                None
            }
        };
        if let Some(row) = changed {
            // @cpt-begin:cpt-noter-flow-core-jobs-scheduler-interrupt:p1:inst-interrupt-return
            self.record(&row, subject);
            // @cpt-end:cpt-noter-flow-core-jobs-scheduler-interrupt:p1:inst-interrupt-return
        }
        Ok(!hold)
    }
}
