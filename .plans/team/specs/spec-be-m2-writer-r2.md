# be-writer (Sonnet 5.5, technical writer) — backend M2 docs round 2: tick 2.15, then 2.20 when its last PR lands; BE-STATUS

Worktree `~/orca/workspaces/noter/be-mid-3` (start from fresh `origin/main`). Read `spec-be-m2-common.md`, `PLAN-be-m2.md` › Status log (from "1 Nov 08:5xZ" on), your own `spec-be-m2-writer.md` and #244 as the tick template, `docs/features/core/core-llm-gate.md`, `core-credentials-privacy.md` (the M2-delivered steps), `core-history-undo.md`, `docs/DECOMPOSITION-core.md`.

**Target:** two docs PRs, ≤ 2 open, one tick each:
1. `docs(core): tick 2.15 llm-gate` on `docs/core-2-15-tick`: `cpt-noter-featstatus-core-llm-gate` and the 2.15 box `[x]` (PRs #229 #234 #241 #246); the two owner-gated parts stay `[ ]` with one-line notes (the network-monitor release test on the owner's Mac, runbook `.plans/backend/m2-network-monitor-runbook.md`; the "output and handoff E2E" AC until 2.17/2.19 land). Verify with `cfs validate` and `just trace` that every ticked item has its marker on main. If the validator refuses the box because a `p1` step is `[ ]`, stop and tell the Teamlead which.
2. `docs(core): tick 2.20 history-undo` on `docs/core-2-20-tick`, opened only after both of be-mid-2's slice-2 PRs (#238 `lane/core/history-export`, merged, and the `lane/contract/history-e2e` PR) have merged: featstatus + box, PRs #232 #238 + the E2E PR. Poll with `gh pr list --state all --search "history"` between steps; if the E2E PR is not merged within your task, publish PR 1, update BE-STATUS.md and report in `worker_done` that 2.20 waits.

Also refresh `_team/BE-STATUS.md` (direct edit, no PR): boxes 2/9 after PR 1 merges (2.16, 2.15), the per-feature table with the PR numbers from the Status log (#243 2.21 part A, #245 2.18 s1, #247 2.17 s1, 2.19 in flight), the owner-gated list (D-32 clustering, golden set, network-monitor, `claude://`/`codex://` URL parameters).

**Constraints:** docs and `_team/` only; never tick around an unticked item; never edit code or markers.

**Acceptance:** PR 1 published with the self-review and auto-merge; PR 2 published if its inputs merged, else reported; BE-STATUS.md current; `worker_done` lists PRs and any blocked tick.
