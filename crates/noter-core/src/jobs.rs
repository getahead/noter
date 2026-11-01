//! The job scheduler in the composition root: `noter-jobs` on the core's store, clock and event
//! emitter, with the capture guard the session manager feeds (TL-23).

use std::sync::Arc;

use noter_jobs::{
    BoxFuture, CaptureGuardState, JobHandler, PowerSource, ProgressSink, RunCtx, Scheduler, Stop,
};
use noter_protocol::ipc::event_names;
use noter_protocol::model::{JobKind, JobProgress, JobRunRow};
use noter_protocol::TimestampMs;
use serde_json::json;
use tokio::sync::watch;

use crate::{object, to_json, Clock, Core, CoreDeps, EventEmitter};

struct CoreClock(Arc<dyn Clock>);

impl noter_jobs::Clock for CoreClock {
    fn now(&self) -> TimestampMs {
        self.0.now()
    }
}

/// `jobs:progress`: one complete run row per committed step.
struct Sink(Arc<dyn EventEmitter>);

impl ProgressSink for Sink {
    fn publish(&self, run: &JobRunRow) {
        let progress = JobProgress { run: run.clone() };
        self.0.emit(event_names::JOBS_PROGRESS, to_json(&progress));
    }
}

/// Mains power until the host reads the battery (native services, M2).
pub struct AcPower;

impl PowerSource for AcPower {
    fn on_battery(&self) -> bool {
        false
    }
}

/// A job kind whose work lands later (2.17 fills post-call and archive, 2.16's second slice
/// the model download): its runs succeed at once.
struct NoOp;

impl JobHandler for NoOp {
    fn run<'a>(&'a self, _ctx: &'a mut RunCtx) -> BoxFuture<'a, Result<(), Stop>> {
        Box::pin(async { Ok(()) })
    }
}

pub(crate) fn build(
    store: Arc<noter_db::Store>,
    deps: &CoreDeps,
) -> (Scheduler, watch::Sender<CaptureGuardState>) {
    let (guard, rx) = watch::channel(CaptureGuardState::default());
    let scheduler = Scheduler::new(noter_jobs::Deps {
        store,
        clock: Arc::new(CoreClock(deps.clock.clone())),
        power: deps.power.clone(),
        sink: Arc::new(Sink(deps.events.clone())),
        guard: rx,
    });
    for kind in [
        JobKind::PostCall,
        JobKind::ArchivePass,
        JobKind::Regeneration,
        JobKind::ModelDownload,
        JobKind::CliInstall,
    ] {
        scheduler.register(kind, Arc::new(NoOp));
    }
    (scheduler, guard)
}

impl Core {
    /// The job scheduler: triggers and cancellation for the features that queue pipeline work.
    pub fn scheduler(&self) -> &Scheduler {
        &self.jobs
    }

    /// The one input the scheduler takes from capture: the session manager publishes whether a
    /// call is live and which call a live capture continues.
    pub fn capture_guard(&self) -> &watch::Sender<CaptureGuardState> {
        &self.capture_guard
    }

    /// Starts the scheduler on the runtime the host started the core on.
    pub(crate) fn start_jobs(self: &Arc<Self>) {
        let Some(runtime) = self.runtime.get() else {
            return;
        };
        let scheduler = self.jobs.clone();
        let weak = Arc::downgrade(self);
        runtime.spawn(async move {
            if let Err(e) = scheduler.start().await {
                if let Some(core) = weak.upgrade() {
                    core.log(object(json!({
                        "level": "error", "module": "jobs", "message": e.message
                    })));
                }
            }
        });
    }
}
