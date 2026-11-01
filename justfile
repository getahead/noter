# Noter harness — one command for "is it done?" (docs/HARNESS.md, docs/ADR/0003).
#
#   just gate-fast   every agent turn (Claude Code Stop hook): lint, contract, architecture, trace coverage, unit tests
#   just gate        exit criteria of every FEATURE and what CI runs on every PR
#                    (on macOS it also runs `just native`, the XCUITest suite; on Linux that step says it is skipped)
#
# CI runs the same recipes job by job (.github/workflows/ci.yml), only the jobs a PR's changes
# can affect (harness.toml [ci]; `just ci-plan` shows them for this branch).

set shell := ["bash", "-euo", "pipefail", "-c"]

base := env_var_or_default("NOTER_BASE_REF", "origin/main")
playwright_image := "mcr.microsoft.com/playwright:v1.63.0-noble"
# Port 5173 is shared between worktrees on one machine: when NOTER_E2E_LOCK names a lock file, the
# Playwright recipes (e2e, visual, visual-update) run one at a time under it; nothing else takes it
e2e_lock := env_var_or_default("NOTER_E2E_LOCK", "")
cfs := ".cf-studio/.core/skills/studio/scripts/studio.py"

# List recipes
default:
    @just --list

# Set up this machine, idempotently: git hooks, Rust toolchain and components, cargo-llvm-cov,
# pnpm dependencies, Playwright WebKit, the Constructor Studio core; then verify and print versions
setup:
    scripts/dev/setup.sh

# Verify the toolchain and print versions without installing anything
doctor:
    scripts/dev/setup.sh --check

# Format Rust code
fmt:
    cargo fmt --all

# Formatting, lints and type checks (no warnings allowed)
lint: lint-rust lint-ui

# Rust formatting and clippy
lint-rust:
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets --locked -- -D warnings

# TypeScript type check
lint-ui:
    pnpm --dir apps/desktop typecheck

# The contract: generated files up to date, contract tests, fake-core smoke
contract:
    cargo run --quiet --locked -p noter-protocol --bin noter-contract-export -- --check
    cargo test --quiet --locked -p noter-protocol
    pnpm --dir apps/desktop smoke

# Regenerate bindings, manifest, schemas and fixtures after changing noter-protocol
contract-regen:
    cargo run --quiet -p noter-protocol --bin noter-contract-export

# Architecture checks and the harness's own tests
arch:
    python3 scripts/harness/arch_check.py
    python3 -m unittest discover -s scripts/harness/tests -q

# Trace coverage: design elements (FULL-traceability artifacts) with an @cpt marker in code; never lower than on the base
trace:
    python3 scripts/harness/trace_gate.py --base {{base}}

# Unit tests, Rust and UI
test-unit:
    cargo test --quiet --workspace --locked
    pnpm --dir apps/desktop test:unit

# Unit tests with coverage, judged by the unit-coverage gate (80% per side and on changed lines)
cov-unit: cov-unit-rust cov-unit-ui

# Rust side of cov-unit (CI job unit-rust)
cov-unit-rust:
    rm -rf coverage/unit && mkdir -p coverage/unit
    cargo llvm-cov clean --workspace
    cargo llvm-cov --no-report --quiet run --locked -p noter-protocol --bin noter-contract-export -- --check
    cargo llvm-cov --no-report --quiet --workspace --locked
    cargo llvm-cov report --lcov --output-path coverage/unit/rust.lcov
    python3 scripts/harness/coverage_gate.py --rust coverage/unit/rust.lcov --base {{base}}

# UI side of cov-unit (CI job unit-ui)
cov-unit-ui:
    rm -rf apps/desktop/coverage/unit
    pnpm --dir apps/desktop test:unit:coverage
    python3 scripts/harness/coverage_gate.py --ui apps/desktop/coverage/unit/lcov.info --base {{base}}

# End-to-end: conformance suite (+ UI flows), then the E2E coverage gate (60% of what is delivered)
e2e: (_locked "_e2e")

_e2e: _e2e-tests e2e-coverage

# The end-to-end suites only, writing their logs to coverage/e2e (CI judges coverage in its own job)
e2e-tests: (_locked "_e2e-tests")

_e2e-tests:
    rm -rf coverage/e2e
    pnpm --dir apps/desktop test:conformance
    just _flows
    if [ -n "${NOTER_CORE_CMD:-}" ]; then just _e2e-core; fi

# CI job e2e-ui carries the real-core UI flows when e2e-core does not run; fake runs are not counted
# The suites against the fake world, plus the UI flows against the real core with NOTER_E2E_REAL=1
e2e-ui: (_locked "_e2e-ui")

_e2e-ui:
    pnpm --dir apps/desktop test:conformance
    just _flows
    if [ "${NOTER_E2E_REAL:-}" = 1 ]; then NOTER_CORE=stdio just _flows; fi

# The same suites against the real core over stdio (CI job e2e-core; needs NOTER_CORE_CMD, docs/HARNESS.md)
e2e-core: (_locked "_e2e-core")

_e2e-core:
    NOTER_CORE=stdio pnpm --dir apps/desktop test:conformance
    NOTER_CORE=stdio just _flows

# The UI flows: every spec, or NOTER_E2E_SPECS (specs relative to apps/desktop, "" for none; CI sets
# it to the specs of the features a pull request touches, harness.toml [ci.features])
_flows:
    if [ "${NOTER_E2E_SPECS-all}" = all ]; then pnpm --dir apps/desktop test:e2e; \
    elif [ -n "$NOTER_E2E_SPECS" ]; then pnpm --dir apps/desktop test:e2e $NOTER_E2E_SPECS; \
    else echo "e2e: no UI flow covers what this change touches"; fi

# The E2E coverage gate over coverage/e2e and coverage/native (60% of what is delivered)
e2e-coverage:
    python3 scripts/harness/e2e_coverage.py

# Native macOS UI tests (XCUITest): the menu bar extra and its menu, tray glyphs, the non-activating
# panels (call window, floating panel, record prompt), notifications, global hotkeys and card keys,
# driven in the built app. macOS only; passes with a notice until apps/desktop/tests/native exists.
# Results go to coverage/native/ and count toward the E2E bar (`just e2e`), so run this first.
native:
    #!/usr/bin/env bash
    set -euo pipefail
    rm -rf coverage/native
    project=apps/desktop/tests/native/NoterNativeTests.xcodeproj
    if [ "$(uname -s)" != "Darwin" ]; then echo "native: skipped, XCUITest needs macOS (CI runs it in the macos job)"; exit 0; fi
    if [ ! -d "$project" ]; then echo "native: no native UI tests yet ($project does not exist); nothing to run"; exit 0; fi
    if [ ! -f apps/desktop/src-tauri/Cargo.toml ]; then echo "GATE FAILED: native: $project exists but there is no app (apps/desktop/src-tauri) to drive" >&2; exit 1; fi
    if ! xcodebuild -version >/dev/null 2>&1; then echo "GATE FAILED: native: xcodebuild needs Xcode, not only the Command Line Tools (install Xcode, then: sudo xcode-select -s /Applications/Xcode.app)" >&2; exit 1; fi
    # `exec`: pnpm 10.28 reads `pnpm --dir <d> tauri` as the command "<d>"; src-tauri is its own cargo package, so its bundle lands under its own target/
    if [ -z "${NOTER_APP_PATH:-}" ]; then pnpm --dir apps/desktop exec tauri build --debug --bundles app; fi
    app="${NOTER_APP_PATH:-$PWD/apps/desktop/src-tauri/target/debug/bundle/macos/Noter.app}"
    [ -d "$app" ] || { echo "GATE FAILED: native: no app bundle at $app (set NOTER_APP_PATH)" >&2; exit 1; }
    mkdir -p coverage/native
    status=0
    TEST_RUNNER_NOTER_APP_PATH="$app" TEST_RUNNER_NOTER_E2E_LOG_DIR="$PWD/coverage/native" \
      xcodebuild test -project "$project" -scheme NoterNativeUITests -destination 'platform=macOS' \
      -resultBundlePath coverage/native/NoterNativeUITests.xcresult -quiet || status=$?
    xcrun xcresulttool get test-results tests --path coverage/native/NoterNativeUITests.xcresult > coverage/native/xcuitest-results.json \
      || { echo "GATE FAILED: native: could not export the XCUITest results" >&2; status=1; }
    exit $status

# Screenshot tests (98% per-pixel match). Baselines are Linux/WebKit, so outside CI this runs in Docker
visual: (_locked "_visual")

_visual:
    if [ "${NOTER_IN_PW_CONTAINER:-}" = "1" ]; then pnpm --dir apps/desktop test:visual; \
    elif command -v docker >/dev/null && docker info >/dev/null 2>&1; then just _in-playwright "pnpm --dir apps/desktop test:visual"; \
    else echo "visual: no running Docker; screenshots are checked in CI only"; fi

# Refresh screenshot baselines in the pinned container (review the diff before committing)
visual-update: (_locked "_visual-update")

_visual-update:
    just _in-playwright "pnpm --dir apps/desktop test:visual:update"
    @echo "Baselines updated. Commit them with NOTER_ALLOW_BASELINE=1 git commit … after reviewing every image."

# Runs a recipe under the shared Playwright lock (see e2e_lock); waits up to an hour for it
_locked recipe:
    lock="{{e2e_lock}}"; if [ -z "$lock" ]; then just {{recipe}}; \
    elif command -v lockf >/dev/null; then lockf -t 3600 "$lock" just {{recipe}}; \
    else flock -w 3600 "$lock" just {{recipe}}; fi

# The pinned container as CI runs it: linux/amd64 (emulated on Apple Silicon, so local renders match
# the baselines), with its own node_modules and pnpm store so the host's macOS install stays intact
_in-playwright cmd:
    docker run --rm --platform linux/amd64 --ipc=host -e NOTER_IN_PW_CONTAINER=1 -e CI \
      -v "$PWD":/work -v /work/node_modules -v /work/apps/desktop/node_modules -w /work {{playwright_image}} \
      bash -c 'npm install -g --silent pnpm@10.28.0 && { out=$(pnpm install --frozen-lockfile --store-dir /root/.pnpm-store 2>&1) || { echo "$out"; exit 1; }; } && {{cmd}}'

# Performance (NOT in `gate` or CI since 24 Oct 2026, owner): run by hand. Scenario coverage (60%) and head vs base (<= 10% worse). Instruction counts on Linux, wall time (report only) elsewhere
perf:
    python3 scripts/harness/perf_gate.py coverage
    if command -v valgrind >/dev/null; then python3 scripts/harness/perf_gate.py ab --base {{base}} --mode ir; \
    else python3 scripts/harness/perf_gate.py ab --base {{base}} --mode wall --report-only; fi

# Wall-clock performance gate, for the dedicated Apple Silicon runner
perf-wall:
    python3 scripts/harness/perf_gate.py ab --base {{base}} --mode wall

# Constructor Studio: artifacts and code traceability
docs:
    python3 {{cfs}} validate --local-only

# Which CI jobs this branch's pull request will run, and why (harness.toml [ci])
ci-plan:
    python3 scripts/harness/ci_changes.py --workflow ci --files $(git diff --name-only --no-renames $(git merge-base {{base}} HEAD))

# Fails if this branch loosens a gate without the owner's label
config-guard:
    python3 scripts/harness/config_guard.py --base {{base}} --lane-check

# Publish your Constructor Studio self-review (/cf-sdlc-pr-review N wrote .prs/N/review.md) for this branch's PR.
# CI turns it into the required `review` status; a passing verdict also turns on auto-merge.
review-publish pr="":
    python3 scripts/harness/review.py publish {{pr}}

# Fast gate: what an agent must keep green while it works
gate-fast: lint contract arch trace test-unit

# Full gate: the exit criteria of every FEATURE and of every pull request
gate: lint contract arch trace cov-unit native e2e visual docs config-guard
    @echo "All gates passed."

# Alias used by FEATURE definitions of done
feature-done: gate
