# Noter harness — one command for "is it done?" (docs/HARNESS.md, docs/ADR/0003).
#
#   just gate-fast   every agent turn (Claude Code Stop hook): lint, contract, architecture, trace coverage, unit tests
#   just gate        exit criteria of every FEATURE and what CI runs on every PR
#
# CI runs the same recipes job by job (.github/workflows/ci.yml).

set shell := ["bash", "-euo", "pipefail", "-c"]

base := env_var_or_default("NOTER_BASE_REF", "origin/main")
playwright_image := "mcr.microsoft.com/playwright:v1.63.0-noble"
cfs := ".cf-studio/.core/skills/studio/scripts/studio.py"

# List recipes
default:
    @just --list

# One-time setup on a new machine: git hooks, toolchains, dependencies
setup:
    git config core.hooksPath .githooks
    python3 -c 'import sys; assert sys.version_info >= (3, 11), "the harness needs Python 3.11+ (brew install python@3.12)"'
    rustup show active-toolchain
    command -v cargo-llvm-cov >/dev/null || cargo install cargo-llvm-cov --locked
    pnpm install --frozen-lockfile
    @echo "Done. Optional: Docker (for 'just visual' outside CI), valgrind on Linux (for 'just perf')."

# Format Rust code
fmt:
    cargo fmt --all

# Formatting, lints and type checks (no warnings allowed)
lint:
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets --locked -- -D warnings
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
cov-unit:
    rm -rf coverage/unit apps/desktop/coverage/unit && mkdir -p coverage/unit
    cargo llvm-cov clean --workspace
    cargo llvm-cov --no-report --quiet run --locked -p noter-protocol --bin noter-contract-export -- --check
    cargo llvm-cov --no-report --quiet --workspace --locked
    cargo llvm-cov report --lcov --output-path coverage/unit/rust.lcov
    pnpm --dir apps/desktop test:unit:coverage
    python3 scripts/harness/coverage_gate.py --rust coverage/unit/rust.lcov --ui apps/desktop/coverage/unit/lcov.info --base {{base}}

# End-to-end: conformance suite (+ UI flows), then the E2E coverage gate (60% of what is delivered)
e2e:
    rm -rf coverage/e2e
    pnpm --dir apps/desktop test:conformance
    if [ -n "${NOTER_CORE_CMD:-}" ]; then NOTER_CORE=stdio pnpm --dir apps/desktop test:conformance; fi
    pnpm --dir apps/desktop test:e2e
    python3 scripts/harness/e2e_coverage.py

# Screenshot tests (98% per-pixel match). Baselines are Linux/WebKit, so outside CI this runs in Docker
visual:
    if [ "${NOTER_IN_PW_CONTAINER:-}" = "1" ]; then pnpm --dir apps/desktop test:visual; \
    elif command -v docker >/dev/null && docker info >/dev/null 2>&1; then just _in-playwright "pnpm --dir apps/desktop test:visual"; \
    else echo "visual: no running Docker; screenshots are checked in CI only"; fi

# Refresh screenshot baselines in the pinned container (review the diff before committing)
visual-update:
    just _in-playwright "pnpm --dir apps/desktop test:visual:update"
    @echo "Baselines updated. Commit them with NOTER_ALLOW_BASELINE=1 git commit … after reviewing every image."

_in-playwright cmd:
    docker run --rm --ipc=host -e NOTER_IN_PW_CONTAINER=1 -e CI -v "$PWD":/work -w /work {{playwright_image}} \
      bash -c 'npm install -g --silent pnpm@10.28.0 && pnpm install --frozen-lockfile >/dev/null && {{cmd}}'

# Performance: scenario coverage (60%) and head vs base (<= 10% worse). Instruction counts on Linux, wall time (report only) elsewhere
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

# Fails if this branch loosens a gate without the owner's label
config-guard:
    python3 scripts/harness/config_guard.py --base {{base}} --lane-check

# Fast gate: what an agent must keep green while it works
gate-fast: lint contract arch trace test-unit

# Full gate: the exit criteria of every FEATURE and of every pull request
gate: lint contract arch trace cov-unit e2e visual perf docs config-guard
    @echo "All gates passed."

# Alias used by FEATURE definitions of done
feature-done: gate
