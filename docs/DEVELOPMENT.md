# Developing Noter

One page for a developer or an agent starting work in this repository. Why the gates exist and how each is
measured: [HARNESS.md](HARNESS.md) and [ADR-0003](ADR/0003-harness-and-quality-gates.md).

## Prerequisites

| Tool | Version | Used by | Install (macOS) |
| --- | --- | --- | --- |
| Rust via rustup | 1.97.0 with rustfmt, clippy, llvm-tools (pinned in `rust-toolchain.toml`) | everything Rust | <https://rustup.rs>; rustup installs the pinned toolchain itself |
| cargo-llvm-cov | 0.9+ | `just cov-unit` | `brew install cargo-llvm-cov` |
| `just` | 1.40+ | every gate | `brew install just` |
| Python | 3.11+ (tomllib), first `python3` on PATH | gate scripts, hooks, `cfs validate` | `brew install python@3.12` |
| Node | 22+ | UI, tests | `brew install node` |
| pnpm | 10.28.0 (`packageManager` in `package.json`) | UI, tests | `brew install pnpm` |
| Playwright WebKit | from `@playwright/test` 1.63.0 | `just e2e` (UI flows) | `just setup` |
| Docker | any, daemon running | `just visual`, `just visual-update` (pinned Playwright container, linux/amd64) | Docker Desktop or `colima` |
| Xcode | full Xcode, not only the Command Line Tools | `just native` (XCUITest), from M1 | App Store, then `sudo xcode-select -s /Applications/Xcode.app` |
| valgrind | Linux only | `just perf` instruction counts (CI) | none on macOS: `just perf` reports wall time there |
| actionlint, shellcheck | optional | checking `.github/` and shell scripts before a push | `brew install actionlint shellcheck` |

The owner's MacBook (macOS 26.6, Apple Silicon) was set up on 18 Oct 2026 with Rust 1.97.0, cargo-llvm-cov 0.9.1,
just 1.59.0, Python 3.14.5, Node 26.0.0, pnpm 10.28.0, WebKit 26.6 (Playwright 1.63.0), Docker 29.5.2,
Swift 6.3.1 and the Command Line Tools only (no Xcode yet).

## Setup

```sh
just setup     # idempotent: installs what is missing, then verifies and prints every version
just doctor    # the same checks, installing nothing
```

`just setup` (`scripts/dev/setup.sh`) sets `core.hooksPath=.githooks` (shared by every worktree of the
repository), installs the pinned Rust toolchain and components, cargo-llvm-cov, the pnpm dependencies
(`--frozen-lockfile`), Playwright WebKit and the Constructor Studio core, and reports Docker, Xcode, Swift,
valgrind and the linters. It fails while anything `just gate` needs is missing; optional tools are notes.

## Daily loop

| Command | When |
| --- | --- |
| `just gate-fast` | Continuously while working (lint, contract, architecture, trace, unit tests; about a minute). In Claude Code the Stop hook runs it and will not let an agent finish while it is red |
| `just gate` | Before opening a PR, and what CI runs: adds unit coverage, native UI tests, E2E and E2E coverage, screenshots, `cfs validate` and the gate-config guard |
| `just <gate>` | One gate: `lint`, `contract`, `arch`, `trace`, `test-unit`, `cov-unit`, `native`, `e2e`, `visual`, `docs`, `config-guard` |
| `just fmt` | Format Rust (the pre-commit hook refuses unformatted staged Rust) |

Several worktrees on one machine share port 5173: export `NOTER_E2E_LOCK=<path to a lock file>` (one file for the
machine) and `just e2e`, `just visual` and `just visual-update` wait for each other; every other recipe runs unlocked.

What runs where on a Mac: `just native` passes with a notice until `apps/desktop/tests/native` exists, then needs
Xcode. `just visual` needs a running Docker daemon (without one it says screenshots are checked in CI only).
`just perf` is not part of `just gate` or CI (owner, 24 Oct 2026); run it by hand when you want the numbers.
Gates that compare with the base branch use `origin/main` (`NOTER_BASE_REF` overrides it): `git fetch origin`
first, so the comparison is with the current `main`.

## Branches, lanes and pull requests

* `main` is protected: changes land only through pull requests whose required checks pass (`gate`, which
  fails if any CI job failed or was skipped). Nobody pushes to `main`, admins included.
* Branch names: `<type>/<topic>` for owner work (`feat/`, `fix/`, `docs/`, `chore/`, `ci/`, `test/`), or
  `lane/<lane>/<topic>` for an agent confined to a lane (`contract`, `ui`, `core`, `engine`, `skills`; see
  HARNESS.md › Lanes). `NOTER_LANE=<lane>` sets a lane without the branch name. One git worktree per agent
  (`git worktree add ../noter-wt/<name> -b <branch>`) lets several work at once.
* The lane guard runs as the Claude Code PreToolUse hook (`.claude/settings.json`), as the git pre-commit hook and
  in CI. It blocks hand edits to generated files and baselines everywhere, and anything outside the lane, the
  harness included, inside a lane.
* Commit messages follow Conventional Commits (`feat(ui): …`, `fix(core): …`, `docs(prd): …`).
* Open the PR with the template filled in. Labels the gates read, all added by the owner:

| Label | Effect |
| --- | --- |
| `harness-change-approved` | The config guard accepts a change to the harness (`harness/`, `scripts/harness/`, `scripts/ci/`, `.github/`, `.githooks/`, `justfile`, test configs) or a loosened bar |
| `update-screenshots` | The bot re-renders the screenshot baselines in the pinned container and commits them to the PR branch |
| `visual-change-approved` | The visual gate accepts changed baselines, after the owner reviewed every image |

## Screenshots

Baselines (`apps/desktop/tests/visual/__screenshots__/`) are valid only when rendered in the pinned container
`mcr.microsoft.com/playwright:v1.63.0-noble` on linux/amd64; a Mac's own WebKit never matches them, and the lane
guard refuses hand edits. To change them on purpose:

1. Make the UI change and push the branch.
2. Add the label `update-screenshots` to the PR: CI renders new baselines and commits them to the branch.
   Locally, `just visual-update` does the same in Docker (commit with `NOTER_ALLOW_BASELINE=1 git commit …`).
3. Review every changed image in the PR, then the owner adds `visual-change-approved`.

## Contract changes

`crates/noter-protocol` is the single source of the UI ↔ core contract (ADR-0001). Never edit `contracts/**` or
`apps/desktop/src/core/bindings.ts`. To change the contract: edit the Rust types and the registry in
`crates/noter-protocol/src/ipc/mod.rs`, run `just contract-regen`, update the fake core's handlers
(`apps/desktop/src/core/fake/handlers.ts`), bump `CONTRACT_VERSION`, place any new command or story in
`harness/milestones.toml`, and get one core and one UI review. `just contract` fails while the generated files
are stale.

## Where tests live

| Layer | Where | Command |
| --- | --- | --- |
| Rust unit and integration | `crates/*/src`, `crates/*/tests` | `just test-unit`, `just cov-unit` |
| UI unit | `apps/desktop/src/**/*.test.ts(x)` (Vitest) | `just test-unit`, `just cov-unit` |
| Contract | `crates/noter-protocol/tests`, `apps/desktop/src/core/contract.smoke.ts` | `just contract` |
| Conformance (fake core, real core from M0) | `apps/desktop/tests/conformance` | `just e2e` |
| UI end to end (Playwright, WebKit) | `apps/desktop/tests/e2e` (titles name `cpt-noter-seq-…` story IDs) | `just e2e` |
| Native UI (XCUITest) | `apps/desktop/tests/native` (`test_cpt_noter_seq_…`) | `just native` |
| Screenshots | `apps/desktop/tests/visual` | `just visual` |
| Performance | scenarios in `harness/perf.toml` | `just perf` |
| Architecture and the harness's own tests | `scripts/harness/arch_check.py`, `scripts/harness/tests` | `just arch` |

The test plan per milestone is [TEST-PLAN.md](TEST-PLAN.md) when present.

## The Mac runner

The nightly wall-clock performance job (`nightly.yml` › `mac-perf`, `just perf-wall`) runs on a self-hosted GitHub Actions runner on the development MacBook Pro (runner `macbook-pro-m5` in `~/actions-runner-noter`, labels `self-hosted, macOS, ARM64, noter`, registered 18 Oct 2026; docs/DEVELOPMENT.md › The Mac runner). No pull request runs on it, and because the repository is public, every workflow from someone outside the repository waits for the owner's approval (`scripts/ci/github-setup.sh`). The job runs only while the repository variable `NOTER_MAC_RUNNER` is `true`.

The runner was downloaded (checksum checked against the release notes) and registered on 18 Oct 2026. It runs as the owner's login service, which the owner starts once:

```sh
cd ~/actions-runner-noter
# python3 must be 3.11+ for the harness; the Command Line Tools python3 is 3.9
mkdir -p bin && ln -sf /opt/homebrew/bin/python3.14 bin/python3
printf '%s' "$HOME/actions-runner-noter/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" > .path
./svc.sh install && ./svc.sh start      # status: ./svc.sh status; stop: ./svc.sh stop
```

It shows as `macbook-pro-m5` (Idle) under Settings › Actions › Runners. To take it away: `./svc.sh uninstall`, then `./config.sh remove --token "$(gh api -X POST repos/getahead/noter/actions/runners/remove-token -q .token)"`, and set `NOTER_MAC_RUNNER` to `false`. A dedicated Mac (a Mac mini) would give steadier numbers; the steps are the same.

## Documents

`docs/PRD.md` is synced from its living copy, never edited by hand: [scripts/prd-sync.md](../scripts/prd-sync.md).
Design documents and ADRs are Constructor Studio artifacts; `just docs` validates them and the `@cpt-*` markers
in code.
