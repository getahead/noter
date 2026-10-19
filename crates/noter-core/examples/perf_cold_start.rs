//! Perf scenario `core_cold_start` (harness/perf.toml).
//!
//! Starts the core on a fresh data folder, as on a new Mac: create `noter.db`, run every
//! migration, answer `app_snapshot` for the main window, shut down. Repeated ROUNDS times
//! so the start outweighs process start-up. Measured by the perf gate in instruction counts
//! (cachegrind) on Linux and in wall time on the Mac runner, so it runs on one thread with a
//! fixed clock: nothing in it may depend on scheduling or the time of day.

use std::sync::Arc;

use noter_core::{Clock, Core, CoreDeps, EventEmitter};
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi};
use noter_protocol::model::WindowLabel;
use noter_protocol::{NoArgs, TimestampMs};
use serde_json::Value;

const ROUNDS: usize = 20;

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(1_790_000_000_000)
    }
}

struct NoEvents;

impl EventEmitter for NoEvents {
    fn emit(&self, _event: &'static str, _payload: Value) {}
}

/// Runs `rounds` cold starts; returns the bytes of every serialized snapshot as a checksum.
fn cold_start(rounds: usize) -> usize {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .expect("runtime");
    let ctx = CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    };
    let mut bytes = 0;
    for _ in 0..rounds {
        let dir = tempfile::tempdir().expect("temp data folder");
        let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(NoEvents));
        let core = Core::open(dir.path(), deps).expect("core opens");
        let snapshot = runtime
            .block_on(core.app_snapshot(&ctx, NoArgs {}))
            .expect("app_snapshot");
        bytes += serde_json::to_string(&snapshot)
            .expect("snapshot serializes")
            .len();
        runtime.block_on(core.shutdown());
        std::hint::black_box(snapshot);
    }
    bytes
}

// @cpt-dod:cpt-noter-dod-core-storage-cold-start:p2
fn main() {
    println!("{}", cold_start(ROUNDS));
}

#[cfg(test)]
mod tests {
    #[test]
    fn one_round_opens_answers_and_shuts_down() {
        assert!(super::cold_start(1) > 0);
    }
}
