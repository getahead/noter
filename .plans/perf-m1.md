# Perf plan: M1 scenario `core_stream_fanout`

Owner: be-perf (core lane). Date: 2026-10-18. M0 scenarios: `.plans/perf-m0.md` (#45).
Registry entry: `stream-hub-fanout` (`harness/perf.toml`, M1): "Transcript messages fanned
out to three windows at 10 msg/s with persistence".

## 1. The scenario

`crates/noter-core/examples/perf_stream_fanout.rs`, built on the stream hub (#32):

- one core on a temp data folder, one `StreamHub` from `Core::stream_hub`;
- three windows (Main, CallScreen, a second Main call page) subscribe to one call's stream
  through `Core::subscribe`;
- 3 000 messages (five minutes at 10 msg/s), each a confirmed fixture `SegmentView`; every
  Channel message is serialized to JSON in its sink, as the IPC host does;
- every 10 messages (once a second at 10 msg/s) each window acknowledges through the
  `stream_ack` command, so no subscription comes near `LAG_LIMIT`;
- `shutdown` ends every stream (`ended { shutdown }`).

Deterministic for the ir gate: current-thread runtime, fixed clock, no coalescing, fixed
sizes. It prints `delivered_messages bytes` (9000 4068195) as the checksum.
`[[example]] test = true`: `cargo test` runs a 25-message round and checks that every window
got every message once.

Wall time on the development MacBook (2 warm-ups, median of 10, like `perf_gate.py`):
16.3 ms median, MAD 0.4 ms, for 9 000 delivered messages (about 1.8 µs each).

## 2. Not in it yet: persistence

The registry says "with persistence". Segments are written by the live transcript service
(core-live-transcript, M1), which does not exist yet, so the scenario measures the hub,
serialization and acks only.

When that service lands, persistence should go in as its **own** scenario (for example
`core_transcript_persist`), not into this example: the A/B gate builds each checkout's own
example, so adding a database write per message to `perf_stream_fanout` would show as a
large regression against the base's lighter version and fail the 10% limit on that PR.
The owner then points the registry entry at the new scenario, or adds an entry for it.

## 3. TOML block for the owner (`harness/perf.toml`)

Add it only once the example is on `main` (or in the same PR): before that, every PR fails
with "head scenario did not run".

```toml
[scenarios.core_stream_fanout]
build = ["cargo", "build", "--release", "--quiet", "-p", "noter-core", "--example", "perf_stream_fanout"]
run = ["{target}/release/examples/perf_stream_fanout"]
modes = ["ir", "wall"]
```

## 4. Coverage when the milestone moves to M1

Due by M1: 7 entries (1 pre-M0, 2 M0, 4 M1). With `protocol_fixtures_roundtrip`, the two M0
scenarios and this one, 4 of 7 are covered: 57%, below the 60% gate. `live-hypothesis-lag`
and `live-confirmed-lag` share `engine_replay_lag`, so that one engine replay scenario makes
it 6 of 7 (86%); it has to exist before the owner moves `[milestone].current` to M1.
