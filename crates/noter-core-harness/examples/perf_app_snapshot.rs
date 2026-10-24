//! Perf scenario `core_app_snapshot` (harness/perf.toml).
//!
//! `app_snapshot` on the fixture world: the harness boots the real core and seeds the world
//! through the core's own commands (`--fixture world --clock fixed`), then every window asks
//! for its snapshot ROUNDS times, as on open, reload and crash recovery, and each answer is
//! serialized as the IPC host does. Measured by the perf gate in instruction counts
//! (cachegrind) on Linux and in wall time on the Mac runner, so it runs on one thread with the
//! fixture's fixed clock. The boot is counted too; ROUNDS keeps it small next to the snapshots.

use noter_core_harness::boot::{Harness, Options};
use noter_core_harness::{Controls, Output};
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi};
use noter_protocol::model::WindowLabel;
use noter_protocol::NoArgs;

const ROUNDS: usize = 200;
const WINDOWS: [WindowLabel; 5] = [
    WindowLabel::Main,
    WindowLabel::CallScreen,
    WindowLabel::RecordPrompt,
    WindowLabel::Settings,
    WindowLabel::FirstRun,
];

/// Runs `rounds` snapshots of every window; returns the serialized bytes as a checksum.
fn snapshots(rounds: usize) -> usize {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .expect("runtime");
    runtime.block_on(async {
        let out = Output::new(tokio::io::sink());
        let options = Options {
            fixture: true,
            fixed_clock: true,
            ..Options::default()
        };
        let harness = Harness::start(options, out.lines())
            .await
            .expect("the harness boots on the fixture world");
        let core = harness.core();
        let mut bytes = 0;
        for _ in 0..rounds {
            for label in WINDOWS {
                let ctx = CommandCtx {
                    caller: Caller::Window { label },
                };
                let snapshot = core
                    .app_snapshot(&ctx, NoArgs {})
                    .await
                    .expect("app_snapshot");
                bytes += serde_json::to_string(&snapshot)
                    .expect("snapshot serializes")
                    .len();
                std::hint::black_box(snapshot);
            }
        }
        harness.shutdown().await;
        bytes
    })
}

// @cpt-dod:cpt-noter-dod-core-ipc-host-snapshot:p1
fn main() {
    println!("{}", snapshots(ROUNDS));
}

#[cfg(test)]
mod tests {
    #[test]
    fn one_round_answers_every_window() {
        assert!(super::snapshots(1) > 0);
    }
}
