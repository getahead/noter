---
status: accepted
date: 2026-10-17
description: "How Noter is built by agents without losing reliability: one gate command with fixed quality bars, measured in CI on every pull request and required as the exit criteria of every feature."
decision-makers: Mikhail Petrov (product owner)
---

# Agents build Noter inside a harness: one gate, fixed quality bars, enforced in CI and in the agent loop

**ID**: `cpt-noter-adr-0003-harness-and-quality-gates`

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [One gate command with fixed bars, enforced in CI, in the agent loop and by lane guards](#one-gate-command-with-fixed-bars-enforced-in-ci-in-the-agent-loop-and-by-lane-guards)
  - [CI checks only, with conventions in AGENTS.md](#ci-checks-only-with-conventions-in-agentsmd)
  - [Review-driven quality](#review-driven-quality)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

## Context and Problem Statement

Most of Noter's code will be written by coding agents (Claude Code and Codex) working in parallel lanes against the contract in `noter-protocol`, with one part-time owner reviewing. Agents finish tasks confidently whether or not the result works, edit whatever file makes a check pass, and drift from the design when nothing stops them. How do we make "done" mean the same thing for every feature and every pull request, so that the owner reviews intent rather than re-testing everything by hand?

## Decision Drivers

* The owner asked for fixed bars: unit coverage 90%, end-to-end coverage 80%, screenshot match 99% for untouched screens, performance coverage 80% with less than 5% degradation, all tests green on every pull request (lowered to realistic goals on 17 Oct 2026, see Decision Outcome).
* A bar must be measurable by a machine on every change, or agents will route around it.
* Agents must not be able to move the goalposts: lowering a bar, editing a baseline or a generated file must be visible and need the owner.
* The checks must not flake: a gate that fails at random gets ignored, by people and by agents.
* macOS specifics: the app runs in WKWebView, the engine needs Apple Silicon and the Neural Engine, and shared CI runners are virtual machines.
* Small team: one command to run locally, the same command in CI.

## Considered Options

* One gate command with fixed bars, enforced in CI, in the agent loop and by lane guards
* CI checks only, with conventions in AGENTS.md
* Review-driven quality: agents open PRs, the owner and a reviewer agent judge them

## Decision Outcome

Chosen option: "One gate command with fixed bars, enforced in CI, in the agent loop and by lane guards", because it is the only option where every bar is measured the same way on every change and the agent cannot finish, merge or loosen a bar without the owner seeing it.

**Changed 17 Oct 2026** (owner: only realistic goals, weaker gates): unit coverage 90% → 80% (per side and on changed lines), end-to-end 80% → 60% of delivered frozen commands and stories, screenshots 99% → 98% per-pixel match, performance regression 5% → 10% per scenario in instruction counts and scenario coverage 80% → 60%; wall-clock stays report-only until a dedicated Apple Silicon runner exists. The same day the owner made traceability FULL for every Constructor Studio artifact and added a trace-coverage gate that must never go down. The table below states the bars in force.

**Changed 17 Oct 2026** (owner: native macOS surfaces get automated tests, as the design documents first planned, instead of only a manual checklist): a native UI test layer joins the harness. An XCUITest suite drives the built app on the macOS runner and covers the native surfaces: the menu bar extra and its menu, the tray glyphs, the non-activating panels (call window, floating panel, record prompt), notifications, global hotkeys and card keys. These are functional tests, not timing, so the hosted `macos-15` runner is enough. Their results count toward the end-to-end bar exactly like the real-core runs; no bar changed. The manual macOS checklist keeps only what automation cannot judge: the look of Liquid Glass materials and translucency, system permission dialogs and TCC prompts, and real call apps. Screenshots of native surfaces are not part of the 98% pixel gate.

**Changed 18 Oct 2026** (owner): every pull request is reviewed by the agent that delivers it, with Constructor Studio (`/cf-sdlc-pr-review`) and the ponytail review (`/ponytail-review`), locally in its own session, never in CI and never with an API token. The agent loops (fix, push, review again) until the verdict passes, publishes it with `just review-publish`, and turns on auto-merge. `.github/workflows/review.yml` turns the published verdict into the commit status `review`, which the `Default ruleset` requires next to `gate` and `hygiene`; a review stays valid while the PR's diff is unchanged. The same day the self-hosted Apple Silicon runner for wall-clock performance was registered on the development MacBook Pro.

**Changed 18 Oct 2026** (owner): a pull request runs only the CI jobs its changes can affect, by the path rules in `harness.toml [ci]` (`scripts/harness/ci_changes.py`); a harness file or a file no rule knows runs everything, and `gate` fails if a job that should run did not pass. The `Default ruleset` no longer requires the branch to be up to date with `main` (GitHub asks for an update only on a conflict), and labels re-run only `hygiene`, which now carries the config guard and the baseline approval. `main` still runs every job on every push, so the cost is that a conflict between two PRs that each passed is found on `main` after the merge rather than before it.

The bars are defined in `harness/harness.toml` and measured as follows. Where the owner's wording could not be measured reliably as stated, the measure below is the realistic equivalent; `docs/HARNESS.md` explains each.

| Bar | Measure | Where it is a hard gate |
| --- | --- | --- |
| Unit tests, 80% | Line coverage of the Rust and UI unit suites, per side, and of the lines a PR changes; generated code, fixtures and thin platform glue are excluded with a written reason | Every PR (Linux) |
| End-to-end tests, 60% | Share of the frozen IPC commands and of the DESIGN.md stories delivered by the current milestone that the end-to-end suites exercise against the real core: the conformance suite and the Playwright flows through `noter-core-harness`, and the XCUITest suite against the built app | Every PR (Linux, over the results of both); the real-app flows and the XCUITest suite on the Mac runner |
| Native UI tests (added 17 Oct 2026) | XCUITest drives the built app: every menu bar item, tray glyph, non-activating panel, notification action, global hotkey and card key does what DESIGN.md says. The look of Liquid Glass, system permission dialogs and real call apps stay on the manual macOS checklist | Every PR once the Tauri app exists (Mac runner, hosted `macos-15`) |
| Screenshots, 98% | Per-pixel comparison of each screen against its baseline in a pinned Linux WebKit container; at most 2% of pixels may differ. Screenshots of native macOS surfaces are not part of this bar; their behaviour is covered by the native UI tests. A changed baseline needs the owner's label | Every PR |
| Performance, 60% / 10% | 60% of the performance registry entries due by the milestone have a scenario; each scenario is at most 10% worse than the base branch, measured in instruction counts in the same job | Every PR (instruction counts); wall-clock and latency reported only, gated once a dedicated Apple Silicon runner exists |
| Trace coverage, never lower | Share of the design elements (component, interface, seq and dbtable IDs; flow, algo, state and dod once FEATURE artifacts exist) defined in the FULL-traceability artifacts that an `@cpt-*` marker implements in the registered codebase; it may not fall below the base branch's | Every PR |
| All tests pass | Formatting, lints, type checks, contract export, contract and conformance tests, architecture checks, `cfs validate` | Every PR |

Trace coverage closes the loop between the design and the code. With traceability FULL, `cfs validate` already rejects a `@cpt-*` marker that names an ID the design does not define; `scripts/harness/trace_gate.py` measures the other direction: how many traceable design elements have a marker in the code. It is a ratchet, not a target: a pull request fails when an element that had a marker on the base branch loses it, or when the coverage of the base's elements drops. Elements a pull request adds to the design never fail it, because design-first work defines elements before the code exists.

Native UI tests close the gap the screenshot container leaves. The menu bar extra, the tray, the panels, notifications and hotkeys are drawn or delivered by macOS, not by the WebView, so neither Playwright nor the screenshot container can reach them. The XCUITest suite lives in `apps/desktop/tests/native` (an Xcode project with the UI-testing target `NoterNativeUITests`) and launches the built app; `just native` runs it on macOS and says it is skipped elsewhere, and before the suite exists it reports that there are no native tests yet and passes. Each test names the story it covers in its name, with the story ID spelled with underscores because Swift names cannot hold hyphens (`test_cpt_noter_seq_menu_bar_control_recording()`); the app under test writes the commands its core ran in the same log format as the other suites. `scripts/harness/e2e_coverage.py` reads both, so a story or command proven through a native surface counts toward the end-to-end bar the same way as one proven through the WebView.

The same command (`just gate`) is the default exit criteria of every FEATURE, a single required status check (`gate`) protects `main`, a Claude Code Stop hook keeps an agent working while `just gate-fast` is red, and a lane guard stops agents from editing generated files, baselines, the harness itself or files outside their lane.

### Consequences

* Good, because "done" is a command, not an opinion: a feature is done when `just gate` passes, and the PR shows the same report.
* Good, because the bars cannot be loosened silently: CI fails a PR that lowers a bar, adds an exclusion or moves work to a later milestone unless the owner labels it.
* Good, because the fake core becomes an executable specification: the conformance suite the fake passes today is the one the real core must pass from M0.
* Good, because instruction counts make a hard performance limit (5%, 10% since 17 Oct 2026) enforceable on shared runners without flakes.
* Bad, because the end-to-end and performance bars are relative to the milestone; until M0 delivers code they are trivially met, which is honest but easy to misread.
* Bad, because wall-clock, latency and Neural Engine measurements need a self-hosted Apple Silicon runner; since 18 Oct 2026 it is the owner's development MacBook Pro, not a dedicated machine, so nightly numbers carry the noise of a working laptop and the run waits while it sleeps.
* Good, because native surfaces (menu bar, tray, panels, notifications, hotkeys, card keys) are tested on every PR by XCUITest instead of by hand before a milestone (since 17 Oct 2026).
* Bad, because screenshots taken in a Linux WebKit container do not show native macOS materials (vibrancy behind Liquid Glass), native panels, the menu bar or the tray; their behaviour is covered by XCUITest, their look stays on the macOS checklist.
* Bad, because the XCUITest run needs a macOS runner, which costs more minutes and is slower, and the end-to-end job waits for it so that it can count both.
* Neutral, because coverage thresholds are on lines; branch coverage is reported but not gated.

### Confirmation

The `gate` job in `.github/workflows/ci.yml` is a required status check on `main`, next to `hygiene` and the self-review status `review` (the `Default ruleset` in `.github/rulesets/`, applied by `scripts/ci/github-setup.sh`); `scripts/harness/tests` cover the gate scripts themselves; `config_guard.py` fails a PR that loosens `harness/*.toml` (including removing the trace gate, turning its ratchet off or narrowing its ID kinds) without the `harness-change-approved` label; `trace_gate.py` fails a PR whose trace coverage falls below the base branch's; the `macos` job runs `just native` once the Tauri app exists and hands its results to the `e2e` job, which counts them with the other end-to-end runs; the lane guard runs as a Claude Code PreToolUse hook and as the git pre-commit hook.

## Pros and Cons of the Options

### One gate command with fixed bars, enforced in CI, in the agent loop and by lane guards

* Good, because the agent gets the failing output while it still has the context to fix it (Stop hook), not hours later in CI.
* Good, because the same command runs on the Mac, in a cloud agent and in CI.
* Neutral, because it needs a little Python and `just` beside the three toolchains.
* Bad, because the harness is code that must itself be maintained and tested.

### CI checks only, with conventions in AGENTS.md

* Good, because it is the least machinery.
* Bad, because agents finish and hand over red work, and the owner finds out from CI.
* Bad, because nothing stops an agent from editing a baseline, a generated file or a threshold to get green.

### Review-driven quality

* Good, because a reviewer agent catches design drift that tests miss; Noter keeps it as an addition (`cf-pr-review`).
* Bad, because review is not a measurement: it cannot enforce coverage or performance bars.
* Bad, because it puts the owner back in the loop for every change.

## More Information

`docs/HARNESS.md` is the working guide: commands, lanes, how each bar is measured, how baselines are refreshed, and the wire format of `noter-core-harness`, the stdio entry point the core exposes in M0 so the conformance and end-to-end suites run against the real core without Tauri. On macOS, `tauri-driver` does not support WKWebView; real-app flows use the WebdriverIO embedded-driver plugin on the Mac runner. Native surfaces are driven by XCUITest (`apps/desktop/tests/native`, `just native`); `docs/HARNESS.md` says how its results reach the end-to-end bar.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN-core.md](../DESIGN-core.md), [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-noter-principle-core-fakes` — the conformance suite runs the same assertions against the fake core and the real core
* `cpt-noter-principle-core-contract-first` — generated files are guarded and checked for staleness on every PR
* `cpt-noter-principle-core-single-writer` — enforced by an architecture check on crate dependencies
* `cpt-noter-principle-core-egress-gate` — enforced by an architecture check on network dependencies
* `cpt-noter-constraint-core-engine-offline` — enforced by an entitlement check on the engine
* `cpt-noter-constraint-core-small-team` — one command, one required check, agents in lanes
