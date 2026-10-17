# Noter harness — how agents build Noter without losing reliability

Decision and rationale: [ADR-0003](ADR/0003-harness-and-quality-gates.md). This page is the working guide for the owner and for every agent (Claude Code, Codex) that writes code here.

## Done means `just gate`

A FEATURE, a task or a pull request is done when `just gate` passes. CI runs the same checks job by job and reports them as one required status check, `gate`, which protects `main`. There is no other definition of done, and no agent may report work as finished while it fails.

| Command | When | What it runs |
| --- | --- | --- |
| `just gate-fast` | Continuously while working; the Claude Code Stop hook runs it before an agent may finish | Formatting, clippy, `tsc`, contract export check and contract tests, fake-core smoke, architecture checks, unit tests |
| `just gate` | Before opening a PR; CI on every PR and on `main` | Everything in `gate-fast`, plus unit coverage, E2E and E2E coverage, screenshots, performance, `cfs validate`, the gate-config guard |
| `just setup` | Once per machine | Git hooks, Rust toolchain (pinned in `rust-toolchain.toml`), `cargo-llvm-cov`, `pnpm install` |

Individual gates: `just lint`, `just contract`, `just arch`, `just test-unit`, `just cov-unit`, `just e2e`, `just visual`, `just perf`, `just docs`, `just config-guard`. Requirements on the Mac: Rust via rustup, Node 22 with pnpm, Python 3.11+, `just` (`brew install just python@3.12`). Docker is optional (screenshots outside CI); valgrind exists only on Linux, so `just perf` on the Mac reports wall time without gating.

## The quality bars

All numbers live in `harness/harness.toml`. A pull request that loosens any of them (a lower minimum, a higher maximum, fewer timed runs, a new coverage exclusion, the milestone moved back, work moved to a later milestone, a frozen command turned back to draft) or changes the harness itself (gate scripts, CI, hooks, `justfile`, test configs) fails the config guard unless the owner adds the `harness-change-approved` label. Coverage pragmas (`v8 ignore`, `istanbul ignore`, `coverage(off)`) and skipped, focused or todo tests are rejected by the architecture checks.

| Bar (owner's wording) | How it is measured | Hard gate |
| --- | --- | --- |
| Unit tests, 90% coverage | Line coverage of the Rust unit and integration tests (`cargo llvm-cov`) and of the UI unit tests (Vitest, V8), each side ≥ 90%. In addition, the lines a PR adds or changes must be ≥ 90% covered, so a large covered codebase cannot hide an untested change | Every PR |
| E2E tests, 80% coverage | Of the **frozen** IPC commands and the DESIGN.md stories that milestones up to the current one deliver (`harness/milestones.toml`), ≥ 80% must be exercised end to end **against the real core**. A command counts when an E2E run called it and it succeeded; a story counts when an E2E test whose title names its ID (`cpt-noter-seq-…`) passed | Every PR |
| Screenshots, 99% match for untouched functionality | Per-pixel comparison with Playwright in the pinned container `mcr.microsoft.com/playwright:v1.63.0-noble` (WebKit, Linux): each screenshot may differ from its baseline in at most 1% of pixels, a pixel counting as different above a 0.02 colour distance. Untouched screens must therefore match; a screen a PR changes on purpose gets new baselines through the `update-screenshots` workflow, and the PR needs `visual-change-approved` | Every PR |
| Performance, 80% coverage, < 5% degradation | Coverage: ≥ 80% of the entries in `harness/perf.toml` that are due by the current milestone have a scenario. Degradation: every scenario is measured on the base branch and on the PR **in the same job**, in instructions executed (valgrind cachegrind), and may be at most 5% worse | Every PR (instruction counts) |
| All tests pass | Every test suite above, plus lints with warnings as errors, the contract export check, architecture checks and `cfs validate` | Every PR |

### Where the owner's wording had to become something measurable

* **E2E coverage is not counted in source lines.** End-to-end runs through the macOS WebView cannot be instrumented reliably, and line coverage of E2E runs mostly repeats unit coverage. The same 80% therefore applies to delivered behaviour: commands and stories. Runs against the fake core do not count.
* **Screenshots cannot cover native macOS surfaces.** The container renders the WebView content, not the vibrancy behind Liquid Glass materials, native open and save panels, the menu bar, the tray or notifications. Those stay on the macOS checklist below. Baselines are only valid from the pinned container; screenshots from a Mac never match them.
* **The 5% limit is enforced on instruction counts, not wall time.** On shared CI machines the same code varies by 5–20% in wall time from run to run (measured while building this harness: −19.7% between two runs of identical code). Instruction counts vary by well under 1%, so a 5% gate on them never flakes. Wall time, live-transcript latency and anything that runs on the Neural Engine need real Apple Silicon: `just perf-wall` runs nightly on a dedicated self-hosted Mac (label `noter`, repository variable `NOTER_MAC_RUNNER=true`) and fails above 5% only when the difference is also larger than twice the run-to-run spread. Until that runner exists, wall time is reported, not gated.
* **Before M0 most bars hold trivially.** Nothing is delivered yet, so the E2E and performance coverage gates count 0 of 0; the UI has no product code yet, so UI unit coverage is 0 of 0 lines. The bars start to bite as each milestone moves `harness.toml [milestone].current` forward.

### What counts toward unit coverage

Everything except the paths listed under `[[coverage.exclude]]` in `harness/harness.toml`, each with its reason: generated code (`bindings.ts`), typed fixtures, the fake core (a test double, checked by the conformance suite), the only file that touches Tauri IPC, the bootstrap entry, objc2 bindings and the thin Tauri host (both covered by the Mac E2E run and the handler-parity test). Adding to this list is loosening the gate.

## Test layers

| Layer | Where | Runs against |
| --- | --- | --- |
| Rust unit and integration | `crates/*/src`, `crates/*/tests` | The crate, with scripted fakes at its seams |
| UI unit | `apps/desktop/src/**/*.test.ts(x)` | Components and stores with the fake core |
| Contract | `crates/noter-protocol/tests`, `contract.smoke.ts` | The contract itself and the fake core |
| Conformance | `apps/desktop/tests/conformance` | The fake core today; the real core through `noter-core-harness` from M0 (`NOTER_CORE=stdio`) |
| UI end to end | `apps/desktop/tests/e2e` (Playwright, WebKit) | The UI served by Vite, with the real core behind the harness bridge; flows name their story IDs |
| Real app | Mac runner, WebdriverIO with its embedded driver (`tauri-driver` does not support WKWebView) | The signed app, from M1 |
| Screenshots | `apps/desktop/tests/visual` | Each DESIGN.md screen and state, rendered with the fake core in the pinned container |
| Performance | `harness/perf.toml` scenarios | Instruction counts per PR; wall time and latency nightly on the Mac |
| Architecture | `scripts/harness/arch_check.py` | Crate dependencies, UI imports, engine entitlements |
| Skills | `evals/` (from M2) | Golden calls; schema validity, citations, rubric |

The conformance suite is the bridge between the UI-first plan and the core: the fake passes it today, and from M0 the same suite must pass against the real core. A difference is a contract bug, fixed in `noter-protocol` first (DESIGN-core 4.1).

### Architecture checks

`scripts/harness/arch_check.py` turns DESIGN-core principles into failing tests:

* only `noter-db` depends on SQLite crates (single writer);
* only `noter-llm` depends on network crates (egress gate, decision C12);
* only the Tauri host (`noter-desktop` in `apps/desktop/src-tauri`) depends on Tauri (decision C11);
* `noter-protocol` depends only on serde, serde_json, specta and schemars (ADR-0001);
* only `src/core/tauri-transport.ts` imports `@tauri-apps/*`; the fake core is imported only by `src/core`, `main.tsx`, tests and stories;
* no engine entitlements file grants network access.

Runtime principles (every write has a change-log row, no transcript text in logs, a late result is dropped) are tests in `noter-core` from M0.

## Lanes and guards

Agents work in lanes. Choose one with `NOTER_LANE=<lane>` or a branch named `lane/<lane>/<topic>` (one git worktree per lane is the easy way to run several agents at once).

| Lane | May change | Notes |
| --- | --- | --- |
| `contract` | `crates/noter-protocol`, the fake core, the conformance suite, ADRs, DESIGN-core | Every PR needs one core and one UI review |
| `ui` | `apps/desktop` except `src-tauri`, the fake and the conformance suite | Builds against the fake core |
| `core` | `crates/*` except the protocol, native and engine-client crates; `src-tauri`; `perf/` | |
| `engine` | `engine/`, `noter-engine-client`, `noter-native` | Mac only |
| `skills` | `skills/`, `evals/` (not `evals/golden`) | |

Every lane may also touch `.plans/`, `docs/features/` and `docs/DECOMPOSITION.md`. With no lane set, the owner rules apply.

The lane guard (`scripts/harness/lane_guard.py`) runs as a Claude Code PreToolUse hook on every edit (and on shell commands that write to a guarded path), as the git pre-commit hook for every tool, and in CI over the files of a `lane/<lane>/…` branch. It blocks:

1. hand edits to generated files (`contracts/**`, `bindings.ts`): change the Rust types and run `just contract-regen`;
2. changes to baselines (`**/__screenshots__/**`, `evals/golden/**`) except through their workflows;
3. inside a lane, any change to the harness itself (`harness/`, `scripts/harness/`, `.github/`, hooks, `justfile`, test configs), so an agent cannot move the goalposts;
4. inside a lane, any file outside the lane.

Codex has no hooks; it gets the same rules from `AGENTS.md`, the pre-commit hook and CI.

## The agent loop

1. Work comes from a FEATURE (cf-studio `cf-sdlc-implement`) or a written task, never from a free-form request.
2. Tests come first: write the failing unit, conformance or E2E test for the behaviour, naming the story ID in E2E tests.
3. Implement until `just gate-fast` is green. In Claude Code the Stop hook enforces it (it blocks finishing up to three times, then lets the agent stop to report the failure).
4. Run `just gate` before opening the PR. cf-studio's deterministic gate for code is this command plus `cfs validate`.
5. Review: a different model reviews the PR (`cf-pr-review`; Claude Code writes and Codex reviews, or the other way round). The owner reviews intent, contract changes, migrations, the egress gate and anything that loosens a gate.

## CI on GitHub

`.github/workflows/ci.yml` runs on every pull request to `main`, on every push to `main` and on demand: `lint`, `contract`, `arch` (with the gate-config guard), `unit`, `e2e`, `visual` (in the pinned Playwright container), `perf`, `docs` and, once `engine/` or `src-tauri` exist, `macos`. The `gate` job fails if any of them failed or was skipped, and it is the only check branch protection needs. `nightly.yml` runs the full gate on `main` every night, plus the wall-clock performance job on the Mac runner when it exists.

First-time setup, from the owner's Mac:

1. Push the branch and open the PR; CI runs.
2. Run `scripts/ci/protect-main.sh` once. It creates the three labels and requires `gate` on `main` for everyone, admins included. Branch protection on a private repository needs a paid GitHub plan.
3. Add the label `update-screenshots` to the PR once: the bot renders the first baselines (the harness self-test screens) in the container and commits them to the branch. Review the images, then add `visual-change-approved`. On this first PR the bot cannot re-run CI by itself (a dispatch needs `ci.yml` on `main`), so pull the branch and push any commit, for example `git commit --allow-empty -m "ci: re-run" && git push`. Later PRs re-run automatically.
4. If the Constructor Studio repository is private, add a `CF_STUDIO_TOKEN` secret with read access so the `docs` job can fetch the pinned core.

Labels: `harness-change-approved` (owner accepts a loosened gate), `visual-change-approved` (owner reviewed changed baselines), `update-screenshots` (bot re-renders baselines for the PR).

## Registries the owner keeps current

* `harness/milestones.toml` places every IPC command and every DESIGN.md story in the milestone that delivers it. The harness self-tests fail if a command or story is missing or listed twice, so a new command or story must be placed in the same PR.
* `harness/perf.toml` lists what must be performance-tested, by milestone, and how each scenario is built and run (`{target}` is the cargo target directory of the checkout being measured).
* `harness.toml [milestone].current` moves forward when a milestone gate passes; that is when the E2E and performance coverage gates start counting the new milestone.

## noter-core-harness wire format (built in M0)

`noter-core-harness` is a small binary in `crates/noter-core-harness` that runs the real `CoreApi` (`noter-core`) without Tauri, with a fixture database, a scripted engine (file mode) and a scripted runtime, and speaks JSON Lines on stdin and stdout. The conformance suite and the UI E2E flows use it through `apps/desktop/tests/support/stdio-transport.ts`; CI builds it and sets `NOTER_CORE_CMD` automatically once the crate exists.

| Direction | Line |
| --- | --- |
| request | `{"id": 7, "window": "main", "cmd": "item_set_done", "args": {…}, "channel": false}` |
| result | `{"id": 7, "ok": <command result>}` |
| error | `{"id": 7, "error": <CoreError>}` |
| channel message | `{"id": 7, "message": <Channel message>}` — after the result of a subscribing command |
| event | `{"event": "entity:changed", "payload": <whole state>}` |

Rules: `window` is applied exactly as the IPC host applies the calling window's label (window scope); `--fixture world` loads `contracts/fixtures/world.json` into a fresh database (fixture parity with the fake); end of stdin shuts the core down; nothing but protocol lines goes to stdout (logs to stderr).

## Not automated: the macOS checklist

Run by hand before each milestone gate and each release, on the development MacBook Pro: permission prompts attributed to Noter (microphone, system audio, Apple Events); capture across AirPods switch, dock and undock, pause and a 90-minute call; Liquid Glass materials and Increase Contrast; native panels, menu bar, tray and notifications; the signed and notarized build launching from the DMG.

## What comes next in the harness

| When | Piece |
| --- | --- |
| M0 | `noter-core-harness`; conformance against the real core in CI; handler-parity test in `src-tauri`; first core perf scenarios (`core_app_snapshot`, `core_cold_start`); change-log and log-scrubbing tests in `noter-core` |
| M1 | Fixture-parity test; scripted engine and golden-set replay through file mode; latency and footprint scenarios on the Mac runner; real-app E2E with WebdriverIO |
| M2 | Skill evals in `evals/` with schema, citation and rubric scores, run on every skill change |
| M3–M5 | Retrieval, copilot and maintenance scenarios as listed in `harness/perf.toml`; corruption and disk-full drills nightly |
