# be-mid-1 (Sonnet 5.5) — fix PR #230: Tauri host lock file (CI macOS job red)

Worktree `~/orca/workspaces/noter/be-mid-1`, branch `lane/core/jobs-scheduler` (your PR #230, auto-merge on, CI red). Shell start: `export PATH=/opt/homebrew/bin:/usr/bin:$PATH NOTER_E2E_LOCK=$HOME/projects/noter-wt/.e2e.lock`. No reading list beyond this file and the repo's `CLAUDE.md` PR rules.

**Why red:** CI job "macOS (engine, Tauri host, native UI tests)" step "Tauri host tests" runs `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` and fails with "cannot update the lock file apps/desktop/src-tauri/Cargo.lock because --locked was passed": the Tauri host has its own lock file and your new `noter-jobs` crate (and its deps) is not in it. `apps/desktop/src-tauri/**` is core lane, so the fix belongs in your PR.

**Change:**
1. `git fetch origin && git checkout lane/core/jobs-scheduler && git pull --ff-only`; if GitHub reports a conflict with main, rebase on `origin/main` (otherwise do not).
2. `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` (no `--locked`): it updates `apps/desktop/src-tauri/Cargo.lock` and runs the host tests (handler parity, window capabilities); they must pass. Inspect the lock diff: only your crate and its dependency closure may change (no unrelated version bumps; if cargo bumped others, revert those with `cargo update -p <crate> --precise <old>`).
3. Commit `fix(core): add noter-jobs to the Tauri host lock file`; `just gate-fast` green; push.
4. The diff changed, so review again: `/cf-sdlc-pr-review 230` (with `/ponytail-review` merged in), then `just review-publish 230`. Loop on REQUEST CHANGES.
5. `worker_done` with one line (what changed, review verdict); stop. Do not add anything else to the PR.

**Acceptance:** `apps/desktop/src-tauri/Cargo.lock` updated for `noter-jobs` only; host tests pass locally; review republished; auto-merge still on.
