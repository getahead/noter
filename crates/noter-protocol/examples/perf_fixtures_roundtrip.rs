//! Perf scenario `protocol_fixtures_roundtrip` (harness/perf.toml).
//!
//! Builds the fixture world, writes it to JSON and reads it back, the work the
//! IPC host does for every large view model. Measured by the perf gate in
//! instruction counts (cachegrind) on Linux and in wall time on the Mac runner.

use noter_protocol::fixtures::{world, FakeWorld};

const ROUNDS: usize = 40;

fn main() {
    let mut bytes = 0usize;
    for _ in 0..ROUNDS {
        let json = serde_json::to_string(&world()).expect("fixtures serialize");
        let back: FakeWorld = serde_json::from_str(&json).expect("fixtures deserialize");
        bytes += json.len();
        std::hint::black_box(back);
    }
    println!("{bytes}");
}
