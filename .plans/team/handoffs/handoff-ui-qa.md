# ui-qa hand-off (18 Oct 2026, ~12:20)

Role: ui-qa of the Noter UI team (Teamlead dispatch `ctx_6049ca66ecf8`, team Run `run_73fa9420226e`). Task file: `_team/ui/tasks/ui-qa.md`. Rules: `_team/CHARTER.md`, `_team/ui/TEAM.md`. Hand-off was asked by the coordinator (model switch).

## State

- Worktree `~/orca/workspaces/noter/ui-qa`, branch `pr/ui-qa` = `origin/main` @ 5a9f2b4, clean (no product code touched, nothing to push). `just setup` done (exit 0). Mine alone: per PR, `git fetch origin pull/<N>/head:pr-<N> && git switch -f pr-<N>`.
- No process of mine is running or queued on `~/projects/noter-wt/.e2e.lock`; port 5173 is not mine.

## First task — progress

| Deliverable | Status |
| --- | --- |
| `_team/ui/qa/M0-charters.md` | **done**: §0 per-PR procedure (gate, driver, prototype comparison, verdict, PR comment), §1 regression of core-bridge + tokens-theming, §2 cross-cutting checks C-1…C-14, §3–§7 happy/negative/exploratory charters with steps for primitives, accessibility-l10n, main-window-shell, first-run, settings, §8 known fake-core gaps |
| `_team/ui/qa/main-bugs.md` | **written, partly run**: unit 122/122, conformance 577/577, typecheck, static greps, probe P1–P3 done; bugs MB-1 (document not styled by tokens: Times 16 px, 8 px margin, black text), MB-2 (section-level error is a placeholder, not the inline banner; from code review); observations O-1…O-4 |
| `_team/ui/qa/tools/probe-main.cjs` | QA driver for main (Playwright WebKit). P1–P3 ran; P4–P10 not run yet (my run was cancelled while waiting for the lock) |
| `_team/ui/qa/evidence/main/` | `probe-p1-p3.log`, `p1-main-ready.png` |
| worker_done for the first task | sent by me with this hand-off |

## Next steps for the new ui-qa

1. Finish the main QA: run probe P4–P10 and update `main-bugs.md` (confirm or drop MB-2; add anything new):
   ```sh
   export PATH=/opt/homebrew/bin:/usr/bin:$PATH
   cd ~/orca/workspaces/noter/ui-qa/apps/desktop
   lockf -t 1800 ~/projects/noter-wt/.e2e.lock bash -c '
     VITE_FAKE_CORE=1 node node_modules/vite/bin/vite.js --port 5173 --strictPort > /tmp/vite-qa.log 2>&1 & V=$!
     for i in $(seq 1 60); do curl -sf http://127.0.0.1:5173/ >/dev/null && break; sleep 0.5; done
     SKIP13=1 node ~/projects/noter-wt/_team/ui/qa/tools/probe-main.cjs $PWD ~/projects/noter-wt/_team/ui/qa/evidence/main; rc=$?
     kill $V; wait $V; exit $rc'
   ```
   Gotchas: start Vite with `node node_modules/vite/bin/vite.js`, not `pnpm exec vite` (killing pnpm leaves Vite running and holds the lock); macOS has no `timeout`; in `page.evaluate`, React and React DOM come from Vite's pre-bundled deps (the probe reads their URLs from `/src/main.tsx` and takes `createRoot`/`createElement` from `.default`). The probe's mount helper was fixed for that but has not run since. The lock queue was ~3 gate runs deep (≈ 30 min).
2. Optionally run `lockf ~/projects/noter-wt/.e2e.lock just gate` on main once as the baseline (not run by me).
3. Send MB-1 and MB-2 to the Teamlead to route (owner: tokens-theming follow-up or the primitives/main-window-shell PR).
4. Per-PR work (later tasks): follow `M0-charters.md` §0; report in `_team/ui/qa/<N>.md`; post the short `QA: PASS|FAIL` PR comment. PLAN.md: primitives (ui-eng-1, `lane/ui/primitives`) and accessibility-l10n (ui-eng-2) come first.
