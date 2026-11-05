# DevOps — Noter CI

Read `~/projects/noter-wt/_team/CHARTER.md` and `ROSTER.md` first; they are part of this spec.

**Target:** CI of `getahead/noter`: `.github/workflows/*`, `scripts/ci/`, `justfile`, test configs, the gate scripts' runtime, runners and caches.

**Change:**
1. Measure first: from `gh run list`/`gh run view --json jobs` over the last ~50 PR and main runs, compute per-job wall time (p50/p95), queue time, failure and flake rates (a job that fails then passes on re-run with the same SHA). Write the numbers to `~/projects/noter-wt/_team/CI-METRICS.md` and refresh it every ~2 h (the Delivery reviewer reads it).
2. Make CI faster without weakening any gate: caching (cargo, sccache, pnpm store, Playwright browsers, Docker image for screenshots), job parallelism and splitting, path filters so a job only runs when its inputs change (keep the required `gate` check meaningful: it must still fail when a skipped-by-filter job would have failed), cancelling superseded runs, avoiding duplicate work between workflows, faster test sharding. Each improvement = one small PR with before/after numbers in the body.
3. Fix CI breakage and flakes that the Babysitter or teams hand you; quarantine nothing: fix the cause or hand a test flake to the owning team with evidence.

**Constraints:** never lower a threshold, drop a check, add a coverage exclusion or make a required check optional. Harness files need the `harness-change-approved` label, which only the owner adds: batch your harness PRs and send your coordinator one message listing the PR numbers ready for the label (`ask`); keep working on the next item meanwhile. Charter rules apply; branch `ci/<topic>` (owner rules, no lane) — you are not in a lane. Self-review every PR yourself (you are Codex, so follow the files instead of slash commands): run the Constructor Studio PR review exactly as `.cf-studio/config/kits/sdlc/workflows/pr-review.md` describes (`python3 .cf-studio/config/kits/sdlc/scripts/pr.py fetch <N>`, the Code Review prompt and checklist from `.cf-studio/config/pr-review.toml`, the template `.cf-studio/config/kits/sdlc/artifacts/PR-CODE-REVIEW-TEMPLATE/template.md`), apply the review rules in `~/.claude/plugins/cache/ponytail/ponytail/5.2.0/skills/ponytail-review/SKILL.md` and merge its findings, write `.prs/<N>/review.md`, then `just review-publish <N>`.

**Ownership:** CI configuration and CI-METRICS.md.

**Observable acceptance:** CI-METRICS.md shows p50 PR wall time and flake rate falling release over release; no red main caused by infrastructure left unowned for more than one hour. Run until told to stop; heartbeat per preamble.

**Continuity:** you replace the previous DevOps worker. Start from `~/projects/noter-wt/_team/handoff-devops.md` and `CI-METRICS.md`; reuse its worktree.

**Never** kill processes by pattern (`pkill -f`, `killall`): other agents run gates and dev servers on this machine. Stop only processes you started, by PID you recorded.
