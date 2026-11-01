# be-mid-1 (Sonnet 5.5) — PR #230 conflicts with main: rebase and renumber the jobs migration

Worktree `~/orca/workspaces/noter/be-mid-1`, branch `lane/core/jobs-scheduler` (your PR #230, auto-merge on, GitHub reports CONFLICTING). Shell start: `export PATH=/opt/homebrew/bin:/usr/bin:$PATH NOTER_E2E_LOCK=$HOME/projects/noter-wt/.e2e.lock`. No reading list beyond this file, `PLAN-be-m2.md` TL-22 and the repo's `CLAUDE.md` PR rules.

**Why:** #229 merged first and added noter-db migration **version 2** (`0002_llm_runs_audit_log.sql`) to `crates/noter-db/src/migrate.rs::MIGRATIONS`. Your PR adds `0002_jobs.sql` as version 2 of the same owner in the same list: a git conflict in `migrate.rs` and a version collision. TL-22 says renumber on rebase.

**Change:**
1. `git fetch origin && git checkout lane/core/jobs-scheduler && git rebase origin/main` (a rebase is allowed because GitHub reports a conflict). Resolve `migrate.rs`: keep #229's version 2 entry, add yours after it as `version: 3, name: "jobs"`; `git mv crates/noter-db/migrations/0002_jobs.sql crates/noter-db/migrations/0003_jobs.sql` and point `include_str!` at it. Keep the `@cpt-dbtable:cpt-noter-dbtable-jobs:p1` marker on your entry. Also check `apps/desktop/src-tauri/Cargo.lock` still merges cleanly (both PRs touched it; keep both closures).
2. Any test or doc that names `0002_jobs` or version 2 for jobs follows. `cargo test -p noter-db -p noter-jobs -p noter-core` green; `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` green; plain `just gate` exit 0 (the rebase changed the base, run the full gate once).
3. `git push --force-with-lease`. The diff changed, so review again: `/cf-sdlc-pr-review 230` (with `/ponytail-review` merged in), then `just review-publish 230`. Loop on REQUEST CHANGES.
4. `worker_done` with one line (rebased on which main SHA, migration now version 3, review verdict); stop. Do not add anything else to the PR.

**Acceptance:** #230 mergeable, jobs migration = noter-db version 3 / `0003_jobs.sql`, gate green, review republished, auto-merge still on.
