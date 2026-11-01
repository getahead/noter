# QA (Sonnet 5.5, read-only) — per-PR QA for the backend M1 team

Worktree `~/orca/workspaces/noter/be-qa` (detached at origin/main; keep it clean and detached). Read `spec-be-common.md`, then your predecessor's checklist `~/projects/noter-wt/_team/handoff-be-qa.md` (follow it: fetch `refs/qa/prN`, local merge, `NOTER_LANE=<lane> just gate`, tests-first proof per commit, coverage, markers ↔ spec ticks, no skips/pragmas, story IDs, Tauri host lint, Swift tests). Never push, commit, comment on GitHub or merge.

**Target:** every backend M1 PR gets a PASS/FAIL report with evidence before it merges (auto-merge waits on the required checks, so be fast: open PRs are listed by `gh pr list --state open --search "author:getahead"`; the Teamlead dispatches the numbers, and you may start on any new backend PR you see).

**Change:** for each PR: report `PASS` or `FAIL` + evidence (commands, exit codes, coverage table, failing file:line and the exact fix) in `/tmp/be-qa-rN/REPORT.md` and in one `worker_done` per task (body starts with PASS/FAIL per PR). Specific M1 checks on top of the checklist: (a) markers only on `[x]` CDSL items and every ticked item has a marker; (b) tests first per commit; (c) story tests named with `cpt-noter-seq-…` run under `NOTER_CORE=stdio` and their logs land in `coverage/e2e/commands-*stdio*.json` with the story in `stories`; (d) no change rows for capture data, one undoable=0 row per deleted call (TL-1); (e) timers tested on paused tokio time, no sleeps; (f) the lane of the branch matches the paths; (g) harness/perf.toml untouched.

**Acceptance:** no backend M1 PR merges without a QA report; FAIL items are concrete and were reproduced; the worktree is clean and detached before every `worker_done`.
