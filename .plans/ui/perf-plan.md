# UI performance scenarios: plan for M0 and M1 (ui-perf, 18 Oct 2026)

Owner: ui-perf (UI Teamlead dispatch `ctx_6049ca66ecf8`). Registry and scenario blocks in
`harness/perf.toml` are harness files: DevOps lands them (owner label `harness-change-approved`).

## 1. What exists today (origin/main 5a9f2b4)

- `harness/perf.toml` has **no UI entries**. Its registry is backend-only: `protocol-fixtures-roundtrip`
  (pre-M0, the only `[scenarios.*]` block), `core-app-snapshot` and `core-cold-start` (M0; examples in
  open PR #45), four M1 entries (`engine_replay_lag` ×2, `core_stream_fanout` in open PR #55,
  `engine_replay_footprint`).
- `[milestone].current = "pre-M0"`, so only `protocol-fixtures-roundtrip` is due today (1/1).
- One UI scenario file is on main but unregistered: `apps/desktop/tests/perf/stream-flush.ts`
  (`ui_stream_flush`, from core-bridge #36). HoD **D-6** approved its registry entry as written in
  #36's body; §4 below corrects that snippet (it cannot be used for the second scenario, see §3).
- The CI `perf` job installs the harness with `node: "false"`: no Node or pnpm, so no UI scenario can
  build in CI yet.

## 2. Due UI entries, one row each

"Feature first" is the FEATURE whose code the scenario drives; the scenario lands in that feature's PR
or right after it. All scenario code lives in `apps/desktop/tests/perf/<file>.ts` (UI lane), outside
`src/`, so it is not counted for unit coverage.

| # | Registry id (proposed) | M | Scenario | What it measures | Feature first | Code | Status |
|---|---|---|---|---|---|---|---|
| 1 | `ui-stream-flush` | M0 | `ui_stream_flush` | The window store's 100 ms Channel flush (`reduceStream`) over a 60-minute live call: transcript hypotheses, confirmed rows, corrections and marks, two level readings per flush, a card every 30 s; fails on a lost or doubled message | core-bridge 2.1 (merged #36) | `tests/perf/stream-flush.ts` | **On main**; registry + block pending (D-6, DevOps) |
| 2 | `ui-window-open` | M0 | `ui_window_open` | All five windows open through the real bridge (`createBridge` → 20 event subscriptions → `app_snapshot` → READY), take an hour of app events (100 calls, 300 items, 50 people loaded and 600 changes by identity and `rev`; 20 newer and 20 older versions of every whole-state slice; 30 removals), reload three times and close. The UI side of `core_app_snapshot`. In-memory transport, so the fake core is not measured | core-bridge 2.1 (merged #36) | `tests/perf/window-open.ts` | **PR from `lane/ui/perf-m0`** (this task); block pending (DevOps) |
| 3 | `ui-shell-render` | M0 | `ui_shell_render` | Startup render: `react-dom/server` `renderToString` of the main window (sidebar, toolbar, banner slot, Today placeholder) from a READY store filled from the fixture world, repeated; then a ⌘1–⌘8 section switch each round. Component cost only (no layout or paint, which only the Mac can measure) | main-window-shell 2.5 (needs primitives 2.3, a11y 2.4) | `tests/perf/shell-render.tsx` | Blocked on 2.5 |
| 4 | `ui-transcript-replay` | M1 | `ui_transcript_replay` | The spec's own requirement (live-transcript §5: "a performance scenario that replays a 90-minute stream"): a 90-minute recorded transcript stream through the bridge's flush and the virtualised TranscriptView (rows in view rendered, follow-output, Jump to Live state); fails if a confirmed row moves or the DOM row count grows with the call | live-transcript 2.11 | `tests/perf/transcript-replay.tsx` | Blocked on 2.11 |
| 5 | `ui-transcript-scroll` | M1 | `ui_transcript_scroll` | "Scrolling a three-hour transcript stays smooth": a stored three-hour transcript (≈3 600 rows, gaps and marks) scrolled top to bottom in fixed steps; the virtualiser's window computation and the rendered slice per step; fails if more than a screen of rows is rendered | live-transcript 2.11 (stored variant used by call-page-frame 2.14) | `tests/perf/transcript-scroll.tsx` | Blocked on 2.11 |
| 6 | `ui-calls-list` | M1 | `ui_calls_list` | Library › Calls with a year of calls (212 calls, as the spec's subtitle): month grouping, the subtitle counts with plural rules, sort toggles on every column, ⌘A and ⇧-click selection, rows leaving on `entity:changed` removal; rendered table per step | library-calls 2.13 | `tests/perf/calls-list.tsx` | Blocked on 2.13 |

Not in M0/M1: copilot card stack (M4, the DESIGN NFR "at most three live cards"), Today ranking (M2,
next to `items-list`), search results (M3). The PRD footprint bar (`call-memory-footprint`, Activity
Monitor during a 90-minute call) needs the real app on the Mac runner and stays backend/engine's.

## 3. How a UI scenario is written and measured here

- **Write**: a TypeScript file in `apps/desktop/tests/perf/` that drives production modules (store,
  bridge, components) with a fixed workload built from `contracts/fixtures/world.json`. No clock, no
  `Math.random`, no timers left pending. It checks its result and throws (exit ≠ 0) when the work came
  out wrong, so a fast but wrong change cannot pass. Size the workload so the run is about 0.5–2 G
  instructions: Node's own start is ~95 M, which must stay small next to the work.
- **Build**: `vite build --ssr tests/perf/<name>.ts --outDir node_modules/.perf/<name>` inside
  `apps/desktop`. The output must sit under `apps/desktop`: an SSR build keeps dependencies
  (`zustand`, `react`) external, and Node resolves them only from there (#36's `../../target/perf-ui`
  works for `stream-flush` only because it never touches `zustand`). Also, `apps/desktop/package.json`
  has `"type": "module"`, so Node does not parse the bundle twice. `node_modules/` is git-ignored, and
  `apps/desktop/target/` is not, so do not use that.
- **Run**: `node --jitless --predictable <bundle>`. `--jitless` interprets only. `--predictable` makes V8
  single-threaded, so instruction counts repeat almost exactly. Measured with valgrind 3.19 and Node 22 on
  linux/arm64 (Docker on the Mac):

  | Scenario | `--jitless` | `--jitless --predictable` | Valgrind run |
  |---|---|---|---|
  | `ui_stream_flush` | 634.9 M / 637.6 M / 637.7 M (±0.4 %) | 638 618 892 / 638 618 690 | 7 s |
  | `ui_window_open` | — | 1 103 579 262 / 1 103 582 414 | 9 s |
  | empty script (Node start) | 95.6 M | — | — |

  The first version of `ui_window_open` was 18.5 G instructions and took 55 s under valgrind. Each
  `entity:changed` copies its whole entity slice, so the cost grows with records × events. Its size was
  cut to 1.1 G. That growth is real store behaviour; the scenario will show it if a screen starts
  loading records one event at a time.
- **Gate**: `just perf` → `perf_gate.py ab`: base (fresh worktree at the merge base) and head are
  built and run in one job; mode `ir` (cachegrind, Linux CI) fails a scenario more than 10 % worse than
  base; mode `wall` is report-only except on the nightly Mac runner. Coverage: ≥ 60 % of the registry
  entries due by `[milestone].current` must have a `[scenarios.*]` block.

## 4. Harness changes for DevOps (one harness PR, label `harness-change-approved`)

Order matters, as in PR #45's plan. A `[scenarios.*]` block whose file does not build fails every PR
("head scenario did not run"). Land the scenario files first (`stream-flush.ts` is on main;
`window-open.ts` comes with the lane/ui/perf-m0 PR), then this:

1. **`harness/perf.toml`**, replacing #36's snippet (D-6) with:

```toml
[[registry]]
id = "ui-stream-flush"
milestone = "M0"
what = "Window store 100 ms Channel flush over a 60-minute live call (transcript, levels, cards)"
scenario = "ui_stream_flush"

[[registry]]
id = "ui-window-open"
milestone = "M0"
what = "Every window opens through the core bridge, takes an hour of app events, reloads and closes (UI side of core-app-snapshot)"
scenario = "ui_window_open"

# UI scenarios: the base checkout is a fresh worktree without node_modules, hence the install.
[scenarios.ui_stream_flush]
build = ["sh", "-c", "pnpm install --frozen-lockfile --prefer-offline && pnpm --dir apps/desktop exec vite build --ssr tests/perf/stream-flush.ts --outDir node_modules/.perf/stream-flush"]
run = ["node", "--jitless", "--predictable", "apps/desktop/node_modules/.perf/stream-flush/stream-flush.js"]
modes = ["ir", "wall"]

[scenarios.ui_window_open]
build = ["sh", "-c", "pnpm install --frozen-lockfile --prefer-offline && pnpm --dir apps/desktop exec vite build --ssr tests/perf/window-open.ts --outDir node_modules/.perf/window-open"]
run = ["node", "--jitless", "--predictable", "apps/desktop/node_modules/.perf/window-open/window-open.js"]
modes = ["ir", "wall"]
```

2. **`.github/workflows/ci.yml` › `perf`**: `uses: ./.github/actions/setup` with `node: "true"`, so
   Node 22 and pnpm exist and the pnpm store is warm for the base install.
3. Rows 3–6: add each `[[registry]]` entry **only together with its scenario block**, after the
   feature PR has landed the file. A registry entry without a scenario lowers coverage. At M0 the due set
   would be protocol, the two core entries and three UI entries. Without #45 and without
   `ui-shell-render` that is 3 of 6 (50 % < 60 %), and the gate fails when the owner moves to M0.

Blocks for rows 3–6 follow the same pattern: `--ssr tests/perf/<file>` → `node_modules/.perf/<name>`.

## 5. Next steps (ui-perf)

- Now: PR `perf(ui): ui_window_open scenario …` from `lane/ui/perf-m0`, then this §4 to the Teamlead for DevOps.
- With main-window-shell (2.5): `ui_shell_render`. M1: write rows 4–6 with or right after 2.11 and 2.13, and
  review each feature PR for its perf scenario (TEAM.md pipeline step 4).
