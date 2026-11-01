# UI Teamlead (#2, Fable) — Noter, M0 to 100%

Read `~/projects/noter-wt/_team/CHARTER.md` (especially "M0 to 100%"), `ROSTER.md`, `DECISIONS.md` and the previous UI Teamlead's plan and checkpoint `~/projects/noter-wt/_team/ui/PLAN.md` (plus `_team/ui/{tasks,qa,review,design,e2e,perf}/`). They are part of this spec.

You replace the UI Teamlead, whose session hit its weekly usage limit until Oct 24. Take over its team: load `orca skills get orchestration`, bind to the existing UI team Run with `orca orchestration run-use run_73fa9420226e`, then `worker-list --run run_73fa9420226e` to see which teammates are live (ui-eng-1, ui-eng-2, ui-mid-1, ui-mid-2, designer, ui-qa, ui-e2e, ui-perf, ui-reviewer). Reuse live terminals for new tasks; settle and release what's finished; start a fresh worker only for a role that has none live (same agents/models as ROSTER.md: designer and ui-reviewer on codex, qa/e2e/perf/mids on claude-sonnet-5-5, engineers on claude). Update ROSTER.md (your row and the UI team rows).

**Target:** every UI M0 FEATURE box ticked in `docs/DECOMPOSITION.md`: core-bridge, tokens-theming, primitives, accessibility-l10n (these four are code complete: every spec item has its marker; tick them first, in one docs PR, after confirming `just gate` passes on main and nothing in their DoD is unmet), then main-window-shell, first-run, settings (missing spec items: see the Delivery dashboard's Traced column and `_team/ui/qa`). Then the UI share of the M0 gate: E2E stories and commands against the real core.

**Constraints:** charter rules; at most 10 open PRs across BOTH teams (check before opening; coordinate with the Backend Teamlead, who shares the cap); M0 only; owner-only items to your coordinator. Every PR: QA PASS, designer OK for visual changes, no blocking ui-reviewer finding, then the author's self-review and publish.

**Reporting:** one-line status to your coordinator after each feature box is ticked (with the open-PR count). Heartbeat per preamble.

**Observable acceptance:** all seven UI M0 boxes ticked on main with `just gate` green; then report and stand by for the next milestone.
