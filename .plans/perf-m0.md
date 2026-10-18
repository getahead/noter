# Perf plan: M0 scenarios `core_app_snapshot` and `core_cold_start`

Owner: be-perf (core lane, `perf(core): …` on `lane/core/perf-…`). Date: 2026-10-18.
Registry entries: `core-app-snapshot`, `core-cold-start` (`harness/perf.toml`, milestone M0).
Specs: `docs/features/core/core-ipc-host.md` (DoD `cpt-noter-dod-core-ipc-host-snapshot`),
`docs/features/core/core-storage.md` (DoD `cpt-noter-dod-core-storage-cold-start`).

## 1. Baseline: `just perf` on origin/main (d3a414c), this Mac

`just setup` passed (valgrind reported "Linux only", as expected on macOS).

```
### Performance scenario coverage
Milestone **pre-M0**: 1 of 1 due registry entries have a scenario (100.0%, gate ≥ 60% ✅).

### Performance (wall, report only)
| Scenario                    | Base      | Head      | Change | Gate        |
| protocol_fixtures_roundtrip | 0.0256711 | 0.0239844 | -6.57% | ≤ +10% ✅   |
```

Base and head were the same commit, so −6.57% is pure wall-time noise. That is why the
Mac result is report-only and the hard gate is cachegrind instruction counts on Linux CI.
The run took 2 min 17 s, mostly building both checkouts in release mode.

## 2. What the gate will require

- `perf_gate.py coverage` counts every registry entry of every milestone up to
  `[milestone].current`. When the owner moves `current` to `M0`, 3 entries are due:
  `protocol-fixtures-roundtrip`, `core-app-snapshot` and `core-cold-start`. With only the
  existing scenario that is 1/3 = 33% < 60%, and **the gate fails**. At least one M0
  scenario must be in `perf.toml` before the milestone moves (2/3 = 67%), and both are
  needed for the two features' DoDs.
- **Order of landing matters.** If a `[scenarios.*]` block is in `perf.toml` before its
  example builds, `measure()` marks the head scenario "unavailable" and `compare()` fails
  every PR with "head scenario did not run". So:
  1. the lane PR adds the example(s) (no harness change; `cargo test` builds examples, so
     they stay compiling);
  2. the owner then adds the TOML blocks of §6, in that PR (with `harness-change-approved`)
     or in a follow-up PR. Base has no such scenario, so the first run shows "new scenario"
     and does not fail.
- After that, every PR is held to ≤ 10% more instructions than base per scenario.

## 3. Where the scenarios live

Both are crate examples, like the existing `noter-protocol` example
`perf_fixtures_roundtrip`. No new crate, no change to the workspace members beyond the ones
the core crates add themselves.

| Scenario | File | Built with |
| --- | --- | --- |
| `core_cold_start` | `crates/noter-core/examples/perf_cold_start.rs` | `cargo build --release -p noter-core --example perf_cold_start` |
| `core_app_snapshot` | `crates/noter-core-harness/examples/perf_app_snapshot.rs` | `cargo build --release -p noter-core-harness --example perf_app_snapshot` |

Both answer `app_snapshot`, which only the `noter-core` composition root can do. The
snapshot scenario lives in `noter-core-harness` (#57, Teamlead decision on 18 Oct), because
the only fixture seeding is the harness's: `boot::Harness::start(Options { fixture: true,
fixed_clock: true })` seeds the world through the core's own commands.

## 4. What they measure

Cachegrind counts the whole process, setup included, so each example repeats the measured
work enough times that it outweighs setup, and prints a checksum (`black_box` as in
`perf_fixtures_roundtrip`) so the optimizer cannot remove the work.

### `core_cold_start`: open the database, run migrations, answer `app_snapshot`

`ROUNDS` (start at 20) times, each in a **fresh** temporary folder:

1. `Store::open(<tmp>/noter.db)`: create the file (0600), WAL and pragmas, load FTS5 and
   sqlite-vec, `quick_check`, run every migration, start the writer and the read pool
   (`cpt-noter-flow-core-storage-open`).
2. Build the `noter-core` composition root on that store, the way `src-tauri` and
   `noter-core-harness` do.
3. `app_snapshot` once as `Caller::Window { label: Main }`.
4. Shut down (writer drains and checkpoints), remove the folder.

This is "a fresh Mac" (empty DB, every migration). Every new migration shows up here, which
is the point: the 10% limit catches a migration or start step that gets expensive. Process
start and extension registration are counted once per process.

### `core_app_snapshot`: `app_snapshot` on a fixture database

1. Setup (counted, but small next to step 2): open a fresh store, seed it from
   `noter_protocol::fixtures::world()` through the same seeding function
   `noter-core-harness --fixture world` uses (`cpt-noter-algo-core-harness-boot`
   `inst-seed`), build the core.
2. `ROUNDS` (start at 200; tune so step 2 is ≥ 90% of instructions) times: call
   `app_snapshot` once for each `WindowLabel` (Main, CallScreen, RecordPrompt, Settings,
   FirstRun). That is the registry's "every window open, reload and crash recovery": each
   one is exactly one `app_snapshot` per window. Also `serde_json::to_string` each result,
   since the IPC host serializes it for every window.

M0 snapshots carry only the M0 slices (the rest are defaults), so this scenario is cheap
now and grows as later milestones add slices. Each of those PRs is compared against its
own base, so growth is allowed as long as no single step is above 10%.

### Determinism (needed for the ir gate)

- Use a tokio **current-thread** runtime in the examples (`block_on`); a multi-thread
  runtime makes instruction counts depend on scheduling.
- Fixed clock if the core takes one (the harness injects one; same entry point).
- Fixed fixture data, fixed `ROUNDS`, no randomness (ULIDs are fine: same length, same
  cost).
- Before asking for the TOML, run each example twice under cachegrind on Linux (CI or the
  pinned container) and confirm the difference is < 1%.

## 5. Entry points needed from `noter-db` / `noter-core` (for be-eng-1)

Names are proposals; what matters is that each is `pub` and callable from an example
without Tauri. The harness needs all of them too (`core-harness.md` › Boot the core on a
fixture), so nothing here exists only for perf.

| Crate | Entry point | Why |
| --- | --- | --- |
| `noter-db` | `Store::open(path: &Path) -> Result<Store, StoreError>`, separate from resolving the Application Support path (`default_db_path()`) | Both scenarios open a temp DB; must not touch `~/Library` |
| `noter-db` | `Store::shutdown(self)` (or a `Drop` that blocks until the writer drained and checkpointed) | Cold start rounds must not leak writer threads between rounds |
| `noter-core` | Composition root without Tauri: e.g. `Core::new(store, CoreDeps { clock, emitter })` with a no-op / test event emitter | Same root as `src-tauri` and the harness |
| `noter-core` | `impl CoreApi for Core` with `app_snapshot(&CommandCtx, NoArgs) -> Result<AppSnapshot, CoreError>` | The measured call |
| `noter-core-harness` | `boot::Harness::start(Options { fixture, fixed_clock }, lines)` and `core()`: seeds the fixture world through the core's commands (#47) | `core_app_snapshot` setup |

Dependencies the examples use: `noter-protocol` (fixtures, `CommandCtx`), `tokio` (already
in `noter-core`), `tempfile` as a dev-dependency of `noter-core` (or `std::env::temp_dir`
plus a unique name).

Order: `core_cold_start` can be written as soon as `Store::open`, the composition root and
`app_snapshot` exist (the first M0 PRs of core-storage and core-ipc-host).
`core_app_snapshot` also needs the harness boot (#47).

## 6. TOML blocks for the owner (`harness/perf.toml`, append after `protocol_fixtures_roundtrip`)

Add each one only once its example is on `main` or in the same PR (see §2).

```toml
[scenarios.core_cold_start]
build = ["cargo", "build", "--release", "--quiet", "-p", "noter-core", "--example", "perf_cold_start"]
run = ["{target}/release/examples/perf_cold_start"]
modes = ["ir", "wall"]

[scenarios.core_app_snapshot]
build = ["cargo", "build", "--release", "--quiet", "-p", "noter-core-harness", "--example", "perf_app_snapshot"]
run = ["{target}/release/examples/perf_app_snapshot"]
modes = ["ir", "wall"]
```

## 7. Steps

1. Now: this plan; Teamlead passes §5 to be-eng-1.
2. When `noter-db` `Store::open` + migrations and the `noter-core` root with `app_snapshot`
   land: PR `perf(core): core_cold_start scenario` (#45, `lane/core/perf-m0`: example + a
   unit test that it runs one round, no marker), then ask the Teamlead for the
   `[scenarios.core_cold_start]` block. The `cpt-noter-dod-core-storage-cold-start` marker
   comes with ticking that DoD, once the block is on `main` and measured (a scope marker on
   an unticked ID fails `cfs validate`).
3. `core_app_snapshot`: #57 (`lane/core/perf-app-snapshot`, stacked on #47), an example of
   `noter-core-harness`; same steps.
4. Before the owner moves `[milestone].current` to M0: confirm coverage 3/3 with
   `perf_gate.py coverage`.
