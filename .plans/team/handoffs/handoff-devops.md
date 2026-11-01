# DevOps handoff (Claude → Codex), 2026-10-18 ~12:15 local

Spec: `spec-devops.md`. Branches are `ci/<topic>` from fresh `origin/main` (owner rules, no lane). Every shell starts with `export PATH=/opt/homebrew/bin:/usr/bin:$PATH`.

## Worktrees

| Worktree | Branch | Head | State |
|---|---|---|---|
| `~/orca/workspaces/noter/devops` (main one) | `ci/rust-cache-per-job` | f60babf | PR **#62** open, self-review APPROVE published, auto-merge on; **waits for `harness-change-approved`** |
| `~/projects/noter-wt/devops-2` | `ci/e2e-parallel-macos` | 733ff13 | pushed, **no PR yet**; needs `just gate`, PR, review |
| `~/projects/noter-wt/devops-3` | `ci/perf-ui-stream-flush` | 76de371 | pushed, **no PR**: superseded, see D-6 below |
| `~/projects/noter-wt/devops-4` | `ci/trace-count-css` | c9ed5cc | pushed, **no PR yet** (D-7); needs `just gate`, PR, review; no label needed (Studio config) |

All four have `just setup` done. Gate status: #62's `just gate` passed every recipe except `config-guard`, which correctly waits for the owner's label. Gates for devops-2/3/4 were queued and then stopped, so none has run yet.

**Incident to know about:** at about 12:11 I ran `pkill -f "lockf …/.e2e.lock just gate"`. The pattern also matched other agents' lockf-wrapped `just gate`/`gate-fast`, so it killed ui-perf's gate run (I then stopped its orphan). I told ui-perf, both teamleads and the babysitter to re-run. Lesson: never pkill by pattern on shared machines; stop your own background tasks by task id or pid.

## PRs and what each does

- **#62 `ci: give each CI job its own Rust build cache`**: `.github/actions/setup` used one rust-cache `shared-key` for every job. It hit exactly on every later main run, so it was never re-saved and every job rebuilt what the first saver had not built (lint compiled 45 crates incl. aws-lc-sys every PR). The fix removes `shared-key`, so the job id goes into the key; `arch` uses `cache: "false"`. After numbers only exist once it is on main: measure the first PR runs after the merge (lint, contract, unit, perf wall p50) and post them on #62 and in CI-METRICS.md.
- **`ci/e2e-parallel-macos` (open the PR)**: `e2e` waited for `macos` only to read XCUITest results for the coverage gate. The new layout is: `e2e` (needs only detect) runs `just e2e-run` and uploads `coverage-e2e`; the new `e2e-coverage` job needs [detect, e2e, macos], downloads `coverage-e2e` (+ `coverage-native` when native tests exist) and runs `just e2e-coverage`; `gate` needs `e2e-coverage`. justfile: `e2e: e2e-run e2e-coverage`, so the local `just e2e` is unchanged. HARNESS.md CI section updated. Expected gain: ~1 min off the critical path (run 39116610276: e2e started at +97 s after macos, ran 83 s; total 186 s), much more once XCUITest makes macos long. Harness PR → label. Before numbers: CI PR p50 5.4m / p95 9.1m; e2e started at +97 s.
- **D-7 `ci/trace-count-css` (open the PR)**: `.cf-studio/config/artifacts.toml` Desktop UI extensions += ".css". `just trace` and `cfs validate` pass locally; coverage stays 44/835 = 5.27% (tokens.css has no markers yet). Title is `chore(studio): …`; reply to HoD (ctx_7b6a1ef73770) with the PR number.
- **D-6 `ci/perf-ui-stream-flush`: do not open as is.** It adds the #36 snippet, gives the perf job Node, and makes `perf_gate.make_base_worktree` run `pnpm install --frozen-lockfile --prefer-offline` in the base checkout (+ a unit test). Reason: without base deps, once the entry is on main every PR fails with `ui_stream_flush: exists on base but could not be measured there`. I reproduced that locally with `perf_gate.py ab --base <commit with the entry> --mode wall --report-only`, and the fix made it pass. **But** the UI Teamlead then asked (message from term_a8fd1899…, plan in `_team/ui/perf/plan.md` §4) for a different form: the TOML from §4 (output under `apps/desktop/node_modules/.perf`, `node --predictable`, `pnpm install --frozen-lockfile` inside the scenario's `build`, so no perf_gate change), plus `ui-window-open`, landing only **after** ui-perf's `perf(ui): ui_window_open` PR (lane/ui/perf-m0) merges. Follow §4: rebuild the branch from §4, keep the Node step in the perf job, and drop my perf_gate change unless §4 leaves the base without deps. Ask ui-perf ctx_572d162ba0a3 if unsure. Harness PR → label.

## Waiting on the owner's `harness-change-approved`

#62 now. Later: e2e-parallel PR, the D-6/§4 perf PR, the D-9 PRs. Send the coordinator **one** `ask` listing the PR numbers when a batch is ready. I have not sent one yet.

## Backlog, priority order

1. Open the PRs for `ci/e2e-parallel-macos` and D-7 (gate → push → `/cf-sdlc-pr-review N` + `/ponytail-review` → `.prs/N/review.md` → `just review-publish N`). `.cf-studio/.gen/AGENTS.md` exists only in the main checkout `~/projects/noter/.cf-studio/.gen/`. The pr.py script is `.cf-studio/config/kits/sdlc/scripts/pr.py fetch N`.
2. D-9 (HoD, DECISIONS.md): three harness PRs, smallest first: (a) `codeql.yml` `paths-ignore: docs/prototype/**`; (b) top-level `permissions` read-only/`{}` in every workflow, writes only at job level, pin the `npm install -g pnpm` commands (ci.yml visual job, update-screenshots.yml:33), list the remaining job-level writes in the PR body; (c) SECURITY.md link `https://github.com/getahead/noter/security/advisories/new`.
3. D-10 (HoD): Apache-2.0 LICENSE ("Copyright 2026 the Noter authors"), `license = "Apache-2.0"` in Cargo.toml `[workspace.package]`, `"license"` in root and apps/desktop package.json, no NOTICE.
4. D-6 per UI plan §4, after ui-perf's PR merges (above).
5. Docs-only path filter for ci.yml (biggest remaining win in runner minutes and queue time; queue p95 is ~4 min per job). The design I worked out: `detect` diffs `origin/main...HEAD` (PR only; push/dispatch/workflow_call run everything) and outputs per-job flags; `gate` accepts `skipped` only when detect said that job's inputs did not change. This is sound because the ruleset has `strict_required_status_checks_policy: true` (the PR is up to date with main, which passed gate). Input traps I found: `docs/DESIGN-core.md` is read by `crates/noter-protocol/tests/contract.rs:477` (contract + unit jobs); `docs/DESIGN.md` + `harness/milestones.toml` feed `e2e_coverage.py`; `.github/**`, `justfile`, `harness/**`, `scripts/**` must run everything. `arch` (trace, config-guard) and `docs` (cfs validate) always run; they are cheap. Note: CodeQL stays ~5.5 min and is required (code_scanning rule), so this cuts runner load and queueing, not docs-PR wall time, unless CodeQL can be skipped safely (unclear whether the code_scanning rule blocks when CodeQL does not run; verify before touching).
6. CodeQL (rust) is the longest required job (p50 4.6m, p95 7.9m): extract 81 s (toolchain install ~10 s, LoadManifest 24 s), finalize 21 s, queries ~95 s on 4 cores. Caching `~/.cargo` for the rust matrix leg might save ~15–20 s. Low value.
7. Skipped as not worth it: caching Playwright browsers (download is 3 s; the ~24 s is apt `--with-deps`).
8. Idea for the owner, not done: local gate throughput. Agents hold `.e2e.lock` for the whole `just gate` (cargo, clippy, coverage), so the lock queue is long. Taking the lock only inside `e2e`/`visual` would cut waits a lot, but it changes the charter rule ("every e2e/visual/gate run goes through lockf"), so it is the owner's/HoD's call.

## Measurements and scripts

- `~/projects/noter-wt/_team/devops/ci_metrics.py [N]` → Markdown with run wall p50/p95, per-job wall/queue p50/p95, fail %, flakes (failed then passed on the same head SHA, cancelled runs excluded) for ci.yml, pr.yml, codeql.yml. `python3 ci_metrics.py 50 > metrics-latest.md`, then rebuild `_team/CI-METRICS.md` from it and **keep the History table at its end** (append one row per refresh). Refresh every ~2 h; the Delivery reviewer reads it.
- `timeline.py <run_id> [min_step_s]` → job/step timeline of one run (critical path).
- `baseline-0948.md` = the first measurement (before any change).
- Numbers today: CI PR p50 5.1–5.4m, p95 9.1m; CodeQL PR p50 5.5m; flake rate 0% in all three workflows; failures are config-guard waiting for labels (arch 17%). Critical path of a typical run: detect → macos (queue ~30 s + 60 s) → e2e (83 s) → gate.
