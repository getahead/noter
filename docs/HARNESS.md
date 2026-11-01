# Noter harness — how agents build Noter without losing reliability

Decision and rationale: [ADR-0003](ADR/0003-harness-and-quality-gates.md). This page is the working guide for the owner and for every agent (Claude Code, Codex) that writes code here. Setting up a machine, the daily loop, branches, labels and where tests live: [DEVELOPMENT.md](DEVELOPMENT.md).

## Done means `just gate`

A FEATURE, a task or a pull request is done when `just gate` passes. CI runs the same checks job by job and reports them as one required status check, `gate`, which protects `main`. There is no other definition of done, and no agent may report work as finished while it fails.

| Command | When | What it runs |
| --- | --- | --- |
| `just gate-fast` | Continuously while working; the Claude Code Stop hook runs it before an agent may finish | Formatting, clippy, `tsc`, contract export check and contract tests, fake-core smoke, architecture checks, trace coverage, unit tests |
| `just gate` | Before opening a PR; CI on every PR and on `main` | Everything in `gate-fast`, plus unit coverage, native UI tests (XCUITest, macOS only; skipped with a notice on Linux), E2E and E2E coverage, screenshots, `cfs validate`, the gate-config guard |
| `just setup` | Once per machine (idempotent; `just doctor` only checks) | Git hooks, Rust toolchain and components (pinned in `rust-toolchain.toml`), `cargo-llvm-cov`, `pnpm install`, Playwright WebKit, the Constructor Studio core; then verifies and prints every version |

Individual gates: `just lint` (`lint-rust`, `lint-ui`), `just contract`, `just arch`, `just trace`, `just test-unit`, `just cov-unit`, `just native`, `just e2e` (`e2e-tests`, then `e2e-coverage`), `just visual`, `just docs`, `just config-guard`. Requirements on the Mac, with versions: [DEVELOPMENT.md › Prerequisites](DEVELOPMENT.md#prerequisites). In short: Rust via rustup, Node 22+ with pnpm, Python 3.11+, `just`, and Xcode for `just native`. Docker is optional (screenshots outside CI, rendered in the pinned container as linux/amd64); `just perf` (not part of the gate) runs the performance scenarios by hand.

## The quality bars

All numbers live in `harness/harness.toml`. On 17 Oct 2026 the owner set them to realistic goals: unit coverage 80% (was 90%), E2E 60% (was 80%), screenshots 98% (was 99%), and added the trace-coverage ratchet. A pull request that loosens any of them (a lower minimum, a higher maximum, fewer timed runs, a new coverage exclusion, the milestone moved back, work moved to a later milestone, a frozen command turned back to draft) or changes the harness itself (gate scripts, CI, hooks, `justfile`, test configs) fails the config guard unless the owner adds the `harness-change-approved` label. Coverage pragmas (`v8 ignore`, `istanbul ignore`, `coverage(off)`) and skipped, focused or todo tests are rejected by the architecture checks.

| Bar (owner's wording) | How it is measured | Hard gate |
| --- | --- | --- |
| Unit tests, 80% coverage | Line coverage of the Rust unit and integration tests (`cargo llvm-cov`) and of the UI unit tests (Vitest, V8), each side ≥ 80%. In addition, the lines a PR adds or changes must be ≥ 80% covered, so a large covered codebase cannot hide an untested change | Every PR |
| E2E tests, 60% coverage | Of the **frozen** IPC commands and the DESIGN.md stories that milestones up to the current one deliver (`harness/milestones.toml`), ≥ 60% must be exercised end to end **against the real core**. A command counts when an E2E run called it and it succeeded; a story counts when an E2E test whose title names its ID (`cpt-noter-seq-…`) passed. XCUITest runs against the built app count the same way (see *Native UI tests*) | Every PR |
| Native UI tests (added 17 Oct 2026) | XCUITest drives the built app on the macOS runner: the menu bar extra and its menu, the tray glyphs, the non-activating panels (call window, floating panel, record prompt), notifications, global hotkeys and card keys. All tests pass; what they prove counts toward the E2E bar | Every PR once the Tauri app exists (Mac runner) |
| Screenshots, 98% match for untouched functionality | Per-pixel comparison with Playwright in the pinned container `mcr.microsoft.com/playwright:v1.63.0-noble` (WebKit, Linux): each screenshot may differ from its baseline in at most 2% of pixels, a pixel counting as different above a 0.02 colour distance. Untouched screens must therefore match; a screen a PR changes on purpose gets new baselines through the `update-screenshots` workflow, and the PR needs `visual-change-approved` | Every PR |
| Performance, 60% coverage, ≤ 10% degradation | Coverage: ≥ 60% of the entries in `harness/perf.toml` that are due by the current milestone have a scenario. Degradation: every scenario is measured on the base branch and on the PR **in the same job**, in instructions executed (valgrind cachegrind), and may be at most 10% worse (plus an owner-approved, labelled `growth_allowance_pct` on one scenario whose work grew by design, removed once that growth is on main). Wall-clock time is measured nightly on the self-hosted Mac | Every PR (instruction counts); nightly (wall clock) |
| Trace coverage, never lower (added 17 Oct 2026) | Of the design elements defined in the artifacts with FULL traceability, the share that an `@cpt-*` marker implements in the code; it may not fall below the base branch's. See *Trace coverage* below | Every PR |
| All tests pass | Every test suite above, plus lints with warnings as errors, the contract export check, architecture checks and `cfs validate` | Every PR |

### Where the owner's wording had to become something measurable

* **E2E coverage is not counted in source lines.** End-to-end runs through the macOS WebView cannot be instrumented reliably, and line coverage of E2E runs mostly repeats unit coverage. The same 60% therefore applies to delivered behaviour: commands and stories. Runs against the fake core do not count.
* **Screenshots cannot cover native macOS surfaces.** The container renders the WebView content, not the vibrancy behind Liquid Glass materials, native open and save panels, the menu bar, the tray or notifications. Screenshots of native surfaces are not part of the 98% gate: their behaviour is tested by XCUITest on the macOS runner (*Native UI tests* below), and only their look stays on the macOS checklist. Baselines are only valid from the pinned container; screenshots from a Mac never match them.
* **The 10% limit is enforced on instruction counts, not wall time.** On shared CI machines the same code varies by 5–20% in wall time from run to run (measured while building this harness: −19.7% between two runs of identical code). Instruction counts vary by well under 1%, so a 10% gate on them never flakes. Wall time, live-transcript latency and anything that runs on the Neural Engine need real Apple Silicon: `just perf-wall` runs nightly on a self-hosted Mac (label `noter`, repository variable `NOTER_MAC_RUNNER=true`) and fails above 10% only when the difference is also larger than twice the run-to-run spread. Since 18 Oct 2026 that Mac is the development MacBook Pro (runner `macbook-pro-m5` in `~/actions-runner-noter`, labels `self-hosted, macOS, ARM64, noter`, registered 18 Oct 2026; docs/DEVELOPMENT.md › The Mac runner). It is the owner's working laptop, not a dedicated machine, so the spread rule matters; while it sleeps or is offline the nightly job waits for it. Only the nightly workflow on `main` targets it; no pull request runs there.
* **Before M0 most bars hold trivially.** Nothing is delivered yet, so the E2E and performance coverage gates count 0 of 0; the UI has no product code yet, so UI unit coverage is 0 of 0 lines. The bars start to bite as each milestone moves `harness.toml [milestone].current` forward.

### What counts toward unit coverage

Everything except the paths listed under `[[coverage.exclude]]` in `harness/harness.toml`, each with its reason: generated code (`bindings.ts`), typed fixtures, the fake core (a test double, checked by the conformance suite), the only file that touches Tauri IPC, the bootstrap entry, objc2 bindings and the thin Tauri host (both covered by the Mac E2E run and the handler-parity test). Adding to this list is loosening the gate.

### Trace coverage

Every Constructor Studio artifact (`docs/DESIGN.md`, `docs/DESIGN-core.md`, the ADRs) is registered with `traceability = "FULL"` in `.cf-studio/config/artifacts.toml`. `cfs validate` (`just docs`) therefore checks every `@cpt-*` marker in the registered code (`crates/**/*.rs`, `apps/desktop/src/**/*.ts(x)`) against the IDs the artifacts define: a marker that names an unknown ID fails. DESIGN and ADR IDs have `to_code = false`, so no marker is required yet; FEATURE IDs (flow, algo, state, dod) will require them.

Code that implements a design element says so on the line before the module, type or function, in the spec's format (`.cf-studio/.core/architecture/specs/traceability.md`, Part II):

```rust
// @cpt-interface:cpt-noter-interface-core-ipc:p1
commands! {
```

The kind slug matches the ID's kind (`component`, `interface`, `seq`, `dbtable`, …); use only IDs that a DESIGN defines (`**ID**:` lines), never invent one. Generated files get their markers from the generator (`bin/export.rs` writes them into `bindings.ts`).

`just trace` (`scripts/harness/trace_gate.py`) measures how many design elements have a marker. Traceable: the IDs of the kinds in `harness.toml [gates.trace].kinds` (component, interface, seq, dbtable, and flow, algo, state, dod for FEATURE artifacts) defined in the FULL artifacts. Covered: a scope marker (`@cpt-{kind}:{id}:p1`) or block marker (`@cpt-begin:{id}:p1:inst-…`) names the ID in the registered code. It reports total, covered and the percentage, and with `ratchet = true` compares with the base branch (read with `git show`, nothing is checked out). It fails when an element that had a marker on the base loses it, or when the coverage of the base's elements is lower than on the base. Elements a PR adds to the design never fail it: design-first work defines them before the code exists. Without the base ref (a fresh clone with no `origin/main`), it only reports. Removing the gate, turning the ratchet off or dropping a kind is loosening for the config guard.

## Test layers

| Layer | Where | Runs against |
| --- | --- | --- |
| Rust unit and integration | `crates/*/src`, `crates/*/tests` | The crate, with scripted fakes at its seams |
| UI unit | `apps/desktop/src/**/*.test.ts(x)` | Components and stores with the fake core |
| Contract | `crates/noter-protocol/tests`, `contract.smoke.ts` | The contract itself and the fake core |
| Conformance | `apps/desktop/tests/conformance` | The fake core today; the real core through `noter-core-harness` from M0 (`NOTER_CORE=stdio`) |
| UI end to end | `apps/desktop/tests/e2e` (Playwright, WebKit) | The UI served by Vite, with the real core behind the harness bridge; flows name their story IDs |
| Real app | Mac runner, WebdriverIO with its embedded driver (`tauri-driver` does not support WKWebView) | The signed app, from M1 |
| Native UI | `apps/desktop/tests/native` (XCUITest, `just native`) | The built app on the Mac runner, from M1: menu bar extra, tray, panels, notifications, hotkeys, card keys |
| Screenshots | `apps/desktop/tests/visual` | Each DESIGN.md screen and state, rendered with the fake core in the pinned container |
| Performance | `harness/perf.toml` scenarios | Instruction counts per PR; wall time and latency nightly on the Mac |
| Architecture | `scripts/harness/arch_check.py` | Crate dependencies, UI imports, engine entitlements |
| Skills | `evals/` (from M2) | Golden calls; schema validity, citations, rubric |

### Native UI tests (XCUITest)

Added 17 Oct 2026 by the owner, as the design documents first planned: native macOS surfaces are tested automatically, not only by hand.

* **What they cover.** The menu bar extra and every item of its menu, the four tray glyphs (idle, recording, paused, copilot muted), the non-activating NSPanel windows (call window, floating panel, record prompt: they take clicks without stealing focus from the call app), notifications posted through `UNUserNotificationCenter` and their actions, global hotkeys and card keys. They are functional tests, not timing, so the hosted `macos-15` runner is enough. What automation cannot judge stays on the macOS checklist: the look of Liquid Glass, system permission dialogs and TCC prompts, real call apps.
* **Where.** `apps/desktop/tests/native/`: the Xcode project `NoterNativeTests.xcodeproj` with the macOS UI-testing target and scheme `NoterNativeUITests`, sources in `apps/desktop/tests/native/NoterNativeUITests/`. It belongs to the `ui` lane. The tests launch the app at `NOTER_APP_PATH` (`XCUIApplication(url:)`), pass `NOTER_E2E_LOG_DIR` into its launch environment, and use the scripted engine and the fixture world, as the other E2E suites do. `XCTSkip` is rejected by the architecture checks like any other skipped test.
* **`just native`.** On Linux it says it is skipped. On a Mac without `NoterNativeTests.xcodeproj` it says there are no native tests yet and passes. Otherwise it builds the app (`pnpm --dir apps/desktop tauri build --debug --bundles app`, or takes `NOTER_APP_PATH`), runs `xcodebuild test -scheme NoterNativeUITests -destination 'platform=macOS'` with the result bundle in `coverage/native/NoterNativeUITests.xcresult`, and exports it with `xcrun xcresulttool get test-results tests` to `coverage/native/xcuitest-results.json`. It fails when a test fails, or when the suite exists but there is no app to drive. `just gate` runs it before `just e2e`. The first run on a new Mac asks once for UI-automation access; `sudo automationmodetool enable-automationmode-without-authentication` removes the prompt.
* **How it counts toward the E2E bar.** A story counts when a test case that passed names its ID. Swift names cannot hold hyphens, so the ID is spelled with underscores and may be followed by a double underscore and a description: `test_cpt_noter_seq_menu_bar_control_recording__pause_and_resume()` proves `cpt-noter-seq-menu-bar-control-recording`. Commands count from the app under test: a debug build launched with `NOTER_E2E_LOG_DIR` writes `commands-native-app-<pid>.json` there on quit, in the same format as the other suites (`{"suite": "native", "target": "app", "commands": [...], "stories": []}`, command names only, no content), listing the commands its core ran successfully, from windows and from native callers (`Caller::Native`). `scripts/harness/e2e_coverage.py` reads `coverage/native/commands-*.json` and `coverage/native/xcuitest-*.json` beside `coverage/e2e/commands-*.json`. The bar itself is unchanged.

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
| `contract` | `crates/noter-protocol` and the output `just contract-regen` writes (`contracts/`, `bindings.ts`), the fake core, the conformance suite, ADRs, DESIGN-core | One core review; a UI review too when the wire changes (a generated file or `CONTRACT_VERSION`) |
| `ui` | `apps/desktop` except `src-tauri`, the fake and the conformance suite | Builds against the fake core |
| `core` | `crates/*` except the protocol, native and engine-client crates; `src-tauri`; `perf/` | |
| `engine` | `engine/`, `noter-engine-client`, `noter-native`, the root `Cargo.toml` and `Cargo.lock` | Mac only |
| `skills` | `skills/`, `evals/` (not `evals/golden`) | |

Every lane may also touch `.plans/`, `.prs/` (PR reviews), `docs/features/` and `docs/DECOMPOSITION.md`. With no lane set, the owner rules apply.

The lane guard (`scripts/harness/lane_guard.py`) runs as a Claude Code PreToolUse hook on every edit (and on shell commands that write to a guarded path), as the git pre-commit hook for every tool, and in CI over the files of a `lane/<lane>/…` branch. It blocks:

1. hand edits to generated files (`contracts/**`, `bindings.ts`): change the Rust types and run `just contract-regen`;
2. changes to baselines (`**/__screenshots__/**`, `evals/golden/**`) except through their workflows (in CI's lane check a screenshot passes on to the baseline check in `hygiene`, which requires `visual-change-approved`; golden data stays blocked);
3. inside a lane, any change to the harness itself (`harness/`, `scripts/harness/`, `.github/`, hooks, `justfile`, test configs), so an agent cannot move the goalposts;
4. inside a lane, any file outside the lane.

Codex has no hooks; it gets the same rules from `AGENTS.md`, the pre-commit hook and CI.

## The agent loop

1. Work comes from a FEATURE (cf-studio `cf-sdlc-implement`) or a written task, never from a free-form request.
2. Tests come first: write the failing unit, conformance or E2E test for the behaviour, naming the story ID in E2E tests.
3. Implement until `just gate-fast` is green. In Claude Code the Stop hook enforces it (it blocks finishing up to three times, then lets the agent stop to report the failure).
4. Run `just gate` before opening the PR. cf-studio's deterministic gate for code is this command plus `cfs validate`.
5. Push, open the PR and review it yourself with Constructor Studio: `/cf-sdlc-pr-review <N>` writes `.prs/<N>/review.md` from the PR's diff, the codebase checklist and any reviewer comments. Publish the verdict with `just review-publish <N>`: it refuses a review of an older diff, posts the review as one PR comment marked with the head commit, and on a passing verdict turns on auto-merge.
6. Loop until the review passes. `REQUEST CHANGES` means at least one Minimum (blocking) finding: fix it, push, review again, publish again. `.github/workflows/review.yml` turns the comment into the commit status `review` (success only for `APPROVE` or `COMMENT` on the PR head, or on an earlier head with exactly the same diff, so a branch updated from `main` keeps its review), and the `Default ruleset` requires it, so any change to the PR's own changes needs a new review and nothing merges on a stale or failed one. In Claude Code the Stop hook keeps the agent in this loop while the branch's open PR has no passing review (up to five rounds, then it stops to report); Codex follows the same rule from `AGENTS.md`. Dependabot and release-please PRs (recognised by their bot author, never by branch name) have no delivering agent and pass `review` by themselves; gate, hygiene and CodeQL still apply.
7. GitHub merges (squash) once `gate`, `hygiene`, CodeQL and `review` pass. The owner reviews intent, contract changes, migrations, the egress gate and anything that loosens a gate; a harness change still waits for `harness-change-approved`. CodeQL posts its alerts as review threads and the ruleset requires every thread resolved: an agent fixes the code; only the owner dismisses an alert, with a reason.

## CI on GitHub

`.github/workflows/ci.yml` runs on every pull request to `main` (opened, pushed to, reopened; never for a label or a title edit), on every push to `main` and on demand: `lint-rust`, `lint-ui`, `contract`, `arch` (with trace coverage), `unit-rust`, `unit-ui`, `e2e-core`, `e2e-ui`, `e2e-coverage`, `visual` (in the pinned Playwright container), `docs` and, once `engine/` or `src-tauri` exist, `macos`. The `macos` job runs the engine tests, the Tauri host tests and, once `src-tauri` exists, the step "Native UI tests (XCUITest)" (`just native`), and uploads `coverage/native` as the artifact `coverage-native`. The unit tests run per side: `unit-rust` (`just cov-unit-rust`, cargo llvm-cov) and `unit-ui` (`just cov-unit-ui`, Vitest), each judging its own side at 80% and on its own changed lines. The E2E suites run per core. `e2e-core` builds `noter-core-harness` and runs the conformance suite and the Playwright UI flows against the real core (`just e2e-core`), and uploads their logs as `e2e-logs`. `e2e-ui` runs the same suites against the fake world (`just e2e-ui`), which the coverage gate never counts. When `e2e-core` does not run, `e2e-ui` also runs the real-core UI flows (`NOTER_E2E_REAL=1`) and uploads them as `e2e-logs-ui`. `e2e-coverage` waits for both E2E jobs and `macos`, downloads the logs (and `coverage-native` when the native suite exists) and judges E2E coverage over all of them (see *UI flows a pull request re-runs* below). The `gate` job is the harness's one required check. The `Default ruleset` on `main` also requires `hygiene` (PR title, the owner's approval labels, dependency review, cargo-deny, workflow lint) and CodeQL, which are about the change as a delivery unit rather than the quality bars; builds, releases and the rest of the delivery pipeline are in [DELIVERY.md](DELIVERY.md). `nightly.yml` runs the full gate on `main` every night.

### What a pull request runs

On a pull request each job runs only if the change can affect what it checks (owner decision, 18 Oct 2026: PRs spent hours re-running checks that had nothing to check). The first job, `changes` (`scripts/harness/ci_changes.py`), diffs the PR's merge commit against `main` and matches the files against the areas in `harness.toml [ci]`:

| A PR that changes only | runs |
| --- | --- |
| UI code (`apps/desktop/**` outside `src-tauri` and `tests/native`) | `lint-ui`, `arch`, `unit-ui`, `e2e-ui`, `e2e-coverage`, `visual`, `docs`; a change to the suites that also run against the real core (`tests/conformance`, `tests/e2e`, `tests/support`, their configs) adds `e2e-core` |
| Rust crates, `Cargo.*` | `lint-rust`, `arch`, `unit-rust`, `e2e-core`, `e2e-coverage`, `docs`, `macos` |
| the contract (`noter-protocol`, `contracts/`, `apps/desktop/src/core/`) | both sides (`unit-rust`, `unit-ui`, `e2e-core`, `e2e-ui`, `e2e-coverage`), plus `contract`; `visual` only for `contracts/` and the UI files |
| the Tauri host or the engine | `arch`, `docs`, `macos` |
| documentation (`docs/`, `.cf-studio/`, Markdown) | `arch` (trace coverage) and `docs` (`cfs validate`); `docs/DESIGN.md` also `e2e-coverage`, since its stories set the E2E bar (judged on `main`'s real-core logs) |
| another workflow file, `deny.toml`, Dependabot config, plans | nothing in `ci.yml` (`hygiene` checks them) |
| CI itself, `justfile`, `harness/`, the gate scripts, the toolchain, or a file no rule knows | everything |

CodeQL follows the same rules per language, and carries `main`'s result forward for a language the PR does not touch (DELIVERY.md). Once the XCUITest suite exists, any E2E job brings `e2e-coverage` and `macos` with it, because the E2E bar is judged over both platforms and the XCUITests drive the built app.

Why a skipped side still counts (owner decision, 1 Nov 2026: split by backend and frontend to cut CI time). The bars are judged over the whole picture: a side the change does not touch is either unchanged from `main`, where every push runs every job, or its result is `main`'s:

* **Unit, one side skipped.** Its code and tests are `main`'s, so its total coverage is `main`'s and it has no changed lines. Changed-line coverage is now judged per side, which is never lower than the old judgement over both sides together.
* **`e2e-ui` skipped** (Rust only). The fake world is TypeScript; Rust reaches it only through `contracts/**`, which runs both sides. Fake runs never count toward the E2E bar.
* **`e2e-core` skipped** (UI only, or `docs/DESIGN.md`). The core, the contract and the conformance suite are `main`'s, so `e2e-coverage` takes the conformance results from `main`'s logs. The real-core UI flows of the touched features still run, in `e2e-ui`.

#### UI flows a pull request re-runs (owner decision, 1 Nov 2026)

Both sides keep the real-core UI flows (Playwright, `apps/desktop/tests/e2e`), but a pull request re-runs only the specs of the features it touches. `harness.toml [ci.features]` gives each feature its code (`apps/desktop/src/features/<x>/**` and the `noter-core` modules named after it) and its specs.

* **Which specs.** A changed spec runs itself. A changed file in no feature runs every spec: shared UI code, `src/core`, the shell, other core modules and crates, the contract, the test support code. The conformance suite and screenshot specs choose no flows. `changes` passes the selection as `e2e_specs` (`just ci-plan` prints it) and the E2E jobs as `NOTER_E2E_SPECS`.
* **Full runs.** Pushes to `main`, the nightly and dispatched runs of `main` run every spec. So does a pull request when `main` has no successful CI run to take logs from.
* **Coverage.** `e2e-coverage` keeps the fresh logs of everything the run re-ran. It adds the logs of `main`'s latest successful run (`e2e_baseline`, linked in the summary) for every spec and suite it did not re-run, and judges the full set. The UI flow logs carry their results per spec (`by_spec`), which makes this split possible.
* **Trade-off.** A change in one feature that breaks another feature's flow is caught by the next full run on `main`.

#### The E2E bar per side (owner decision, 1 Nov 2026)

The 60% of delivered frozen commands and stories is also measured for each side, over the same delivered set:

* **backend**: the conformance suite against the real core;
* **frontend**: the UI flows against the real core and the XCUITest runs of the built app.

Both DECOMPOSITION documents list every command and story, so the split follows the suites rather than the documents. `e2e-coverage` reports both numbers in its summary and in one comment on the pull request, which every run updates. A side's bar is enforced where `harness.toml [gates.e2e]` sets `<side>_commands_min` / `<side>_stories_min`. On 1 Nov 2026 three of the four are set. `backend_stories_min` is not set yet: no conformance test proves an M0 story yet (0 of 3), and the owner decides when to set it.
* **`visual` skipped** (Rust, `noter-protocol` included). Screenshots render the UI over the fake world; `noter-protocol` reaches the pixels only through the regenerated `contracts/**` and `bindings.ts`, which `contract` requires in the same change and which run `visual`. A skipped job passes; `gate` fails if `changes` failed, if a job it switched on did not succeed, or if `changes` and `gate` disagree on the list of jobs. The run summary of `changes` lists which files switched on which jobs; `just ci-plan` shows the same for the current branch before it is pushed. Pushes to `main`, the nightly and dispatched runs of `main` run every job, so `main` itself is always checked in full; a run on `main` is queued, never cancelled, by the next merge. Narrowing the rules is a harness change (the config guard needs `harness-change-approved`). Locally, `just gate` still runs everything.

First-time setup, from the owner's Mac:

1. Push the branch and open the PR; CI runs.
2. Run `scripts/ci/github-setup.sh` once (and again whenever `.github/rulesets/` changes). It creates the labels, applies the rulesets that require `gate` (and the delivery checks) on `main` for everyone, admins included, and sets merging, security and Actions settings; see [DELIVERY.md](DELIVERY.md).
3. Add the label `update-screenshots` to the PR once: the bot renders the first baselines (the harness self-test screens) in the container and commits them to the branch. Review the images, then add `visual-change-approved`. On this first PR the bot cannot re-run CI by itself (a dispatch needs `ci.yml` on `main`), so pull the branch and push any commit, for example `git commit --allow-empty -m "ci: re-run" && git push`. Later PRs re-run automatically.
4. If the Constructor Studio repository is private, add a `CF_STUDIO_TOKEN` secret with read access so the `docs` job can fetch the pinned core.

Labels: `harness-change-approved` (owner accepts a loosened gate), `visual-change-approved` (owner reviewed changed baselines), `update-screenshots` (bot re-renders baselines for the PR). The two approval labels are read by `hygiene` › `approvals` (the config guard with the lane check, and the baseline check), so adding one re-runs only `hygiene`, which takes about a minute, never the whole CI.

## Registries the owner keeps current

* `harness/milestones.toml` places every IPC command and every DESIGN.md story in the milestone that delivers it. The harness self-tests fail if a command or story is missing or listed twice, so a new command or story must be placed in the same PR.
* `harness/perf.toml` lists what must be performance-tested, by milestone, and how each scenario is built and run (`{target}` is the cargo target directory of the checkout being measured).
* `harness.toml [milestone].current` moves forward when a milestone gate passes; that is when the E2E coverage gate starts counting the new milestone.

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

Run by hand before each milestone gate and each release, on the development MacBook Pro. Since 17 Oct 2026 it keeps only what automation cannot judge; the behaviour of the menu bar, tray, panels, notifications, hotkeys and card keys is tested by XCUITest (*Native UI tests* above). The checklist: system permission dialogs and TCC prompts attributed to Noter (microphone, system audio, Apple Events, notifications); capture with real call apps and across AirPods switch, dock and undock, pause and a 90-minute call; the look of Liquid Glass materials (translucency over real content, menu bar and panels included) and Increase Contrast; the signed and notarized build launching from the DMG.

## What comes next in the harness

| When | Piece |
| --- | --- |
| M0 | `noter-core-harness`; conformance against the real core in CI; handler-parity test in `src-tauri`; first core perf scenarios (`core_app_snapshot`, `core_cold_start`); scripted engine (self-test only; golden replay stays M1); change-log and log-scrubbing tests in `noter-core` |
| M1 | Fixture-parity test; scripted engine and golden-set replay through file mode; latency and footprint scenarios on the Mac runner; real-app E2E with WebdriverIO; the XCUITest suite in `apps/desktop/tests/native` and the app's E2E command log (`NOTER_E2E_LOG_DIR`) |
| M2 | Skill evals in `evals/` with schema, citation and rubric scores, run on every skill change |
| M3–M5 | Retrieval, copilot and maintenance scenarios as listed in `harness/perf.toml`; corruption and disk-full drills nightly |
