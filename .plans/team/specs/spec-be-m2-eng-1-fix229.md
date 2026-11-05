# be-eng-1 (Opus 5.5) — fix PR #229: Tauri host lock file (CI macOS job red); E2E flake re-runs with the push

Worktree `~/orca/workspaces/noter/be-eng-1`, branch `lane/core/llm-gate-runtime` (your PR #229, auto-merge on, CI red). Shell start: `export PATH=/opt/homebrew/bin:/usr/bin:$PATH NOTER_E2E_LOCK=$HOME/projects/noter-wt/.e2e.lock`. No reading list beyond this file and the repo's `CLAUDE.md` PR rules.

**Why red:** (1) CI job "macOS (engine, Tauri host, native UI tests)" step "Tauri host tests" runs `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` and fails with "cannot update the lock file apps/desktop/src-tauri/Cargo.lock because --locked was passed": the Tauri host has its own lock file and the new `noter-llm` dependencies from your PR are not in it. `apps/desktop/src-tauri/**` is core lane, so the fix belongs in your PR. (2) "End-to-end tests" failed one UI spec, `tests/e2e/m1-call-page-frame-ui.spec.ts:121` (call page "call is gone" error path, `toBeVisible` timeout); main passes it and your diff does not touch the UI, so it is a flake: the push re-runs it. If it fails again, say so in `worker_done` and stop (the Teamlead takes it).

**Change:**
1. `git fetch origin && git checkout lane/core/llm-gate-runtime && git pull --ff-only`; if GitHub reports a conflict with main, rebase on `origin/main` (otherwise do not).
2. `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` (no `--locked`): it updates `apps/desktop/src-tauri/Cargo.lock` and runs the host tests (handler parity, window capabilities); they must pass. Inspect the lock diff: only your crate's new dependency closure may change (no unrelated version bumps; revert any with `cargo update -p <crate> --precise <old>`).
3. Commit `fix(core): add the noter-llm runtime deps to the Tauri host lock file`; `just gate-fast` green; push.
4. The diff changed, so review again: `/cf-sdlc-pr-review 229` (with `/ponytail-review` merged in), then `just review-publish 229`. Loop on REQUEST CHANGES.
5. `worker_done` with one line (what changed, review verdict, whether the E2E re-run is green or still red); stop. Do not add anything else to the PR.

**Acceptance:** `apps/desktop/src-tauri/Cargo.lock` updated for the noter-llm deps only; host tests pass locally; review republished; auto-merge still on.
