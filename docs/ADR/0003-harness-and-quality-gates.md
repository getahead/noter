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

* The owner asked for fixed bars: unit coverage 90%, end-to-end coverage 80%, screenshot match 99% for untouched screens, performance coverage 80% with less than 5% degradation, all tests green on every pull request.
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

The bars are defined in `harness/harness.toml` and measured as follows. Where the owner's wording could not be measured reliably as stated, the measure below is the realistic equivalent; `docs/HARNESS.md` explains each.

| Bar | Measure | Where it is a hard gate |
| --- | --- | --- |
| Unit tests, 90% | Line coverage of the Rust and UI unit suites, per side, and of the lines a PR changes; generated code, fixtures and thin platform glue are excluded with a written reason | Every PR (Linux) |
| End-to-end tests, 80% | Share of the frozen IPC commands and of the DESIGN.md stories delivered by the current milestone that the end-to-end suites exercise against the real core | Every PR (Linux); the real-app flows on the Mac runner |
| Screenshots, 99% | Per-pixel comparison of each screen against its baseline in a pinned Linux WebKit container; at most 1% of pixels may differ. A changed baseline needs the owner's label | Every PR |
| Performance, 80% / 5% | 80% of the performance registry entries due by the milestone have a scenario; each scenario is at most 5% worse than the base branch, measured in instruction counts in the same job | Every PR (instruction counts); wall-clock and latency on a dedicated Apple Silicon runner |
| All tests pass | Formatting, lints, type checks, contract export, contract and conformance tests, architecture checks, `cfs validate` | Every PR |

The same command (`just gate`) is the default exit criteria of every FEATURE, a single required status check (`gate`) protects `main`, a Claude Code Stop hook keeps an agent working while `just gate-fast` is red, and a lane guard stops agents from editing generated files, baselines, the harness itself or files outside their lane.

### Consequences

* Good, because "done" is a command, not an opinion: a feature is done when `just gate` passes, and the PR shows the same report.
* Good, because the bars cannot be loosened silently: CI fails a PR that lowers a bar, adds an exclusion or moves work to a later milestone unless the owner labels it.
* Good, because the fake core becomes an executable specification: the conformance suite the fake passes today is the one the real core must pass from M0.
* Good, because instruction counts make a 5% performance limit enforceable on shared runners without flakes.
* Bad, because the end-to-end and performance bars are relative to the milestone; until M0 delivers code they are trivially met, which is honest but easy to misread.
* Bad, because wall-clock, latency and Neural Engine measurements need a self-hosted Apple Silicon runner; until it exists they are reported, not enforced.
* Bad, because screenshots taken in a Linux WebKit container do not show native macOS materials (vibrancy behind Liquid Glass), native panels, the menu bar or the tray; those stay on the macOS checklist.
* Neutral, because coverage thresholds are on lines; branch coverage is reported but not gated.

### Confirmation

The `gate` job in `.github/workflows/ci.yml` is the required status check on `main` (`scripts/ci/protect-main.sh`); `scripts/harness/tests` cover the gate scripts themselves; `config_guard.py` fails a PR that loosens `harness/*.toml` without the `harness-change-approved` label; the lane guard runs as a Claude Code PreToolUse hook and as the git pre-commit hook.

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

`docs/HARNESS.md` is the working guide: commands, lanes, how each bar is measured, how baselines are refreshed, and the wire format of `noter-core-harness`, the stdio entry point the core exposes in M0 so the conformance and end-to-end suites run against the real core without Tauri. On macOS, `tauri-driver` does not support WKWebView; real-app flows use the WebdriverIO embedded-driver plugin on the Mac runner.

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
