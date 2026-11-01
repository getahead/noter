# Handoff: ui-e2e (18 Oct 2026)

Role: ui-e2e in the UI team (Teamlead dispatch `ctx_6049ca66ecf8`, team Run `run_73fa9420226e`). Read `_team/CHARTER.md`, `_team/ui/TEAM.md`, and in the repo `CLAUDE.md`, `docs/DEVELOPMENT.md`, `docs/HARNESS.md`, `docs/TEST-PLAN.md`.
Shell: `export PATH=/Applications/Orca.app/Contents/Resources/bin:/opt/homebrew/bin:/usr/bin:$PATH`. Every e2e, visual or gate run goes through `lockf ~/projects/noter-wt/.e2e.lock …`. The queue is often 30–60 min, so run those in the background.

## 1. PR #66: D-4/D-5 follow-ups (test(ui): judge not_implemented by milestone…)

- Worktree `~/projects/noter-wt/ui-e2e-followups`, branch `lane/ui/e2e-followups`, head `2dc0364` (rebased on main after #73).
- State: `just gate` passed locally (on the previous head, same diff); ui-reviewer found nothing BLOCKING; self-review APPROVE published at `2dc0364` (`.prs/66/review.md` in that worktree). **Auto-merge is on**: it merges once CI gate, hygiene, CodeQL and review pass. If main moves and GitHub needs "Update branch", the diff stays the same and the review still holds. If anything in the diff changes, run `/cf-sdlc-pr-review 66` and `just review-publish 66` again.
- Contents:
  - `pending(res, current)` and `ahead(res)` fail on `not_implemented` once the command's milestone is current or past. The command is read from the refusal's `message`, which is the command name in the core's default `CoreApi` refusal.
  - `changeAhead(scenario, milestone, …)` takes an explicit milestone (32 call sites).
  - New `tests/support/milestones.ts` (with `isLaterMilestone`) and `tests/support/results.test.ts`.
  - The M4 `copilot:status` wait is guarded; `window_not_allowed` is checked before the M1 guards.
- **Follow-up 1 (ui-reviewer, nonblocking MAJOR, noted in the PR body):** a `not_implemented` refusal whose message isn't a placed command name stays pending at every milestone, e.g. the fake's `fake: forced not_implemented` and `fake core has no handler for <cmd>`. Fix: carry the command identity into `ahead`/`pending` (call sites, or metadata on the typed client's results), reject missing implementations on the fake, and add a regression test.
- **Follow-up 2 (backend, lane guard):** `milestones.ts` was copied, not moved. The contract lane must switch `tests/conformance/not-implemented.test.ts` and the local `changeAhead` in `m0-m1-rules.test.ts` to `../support/milestones` and delete `tests/conformance/milestones.ts`. The Teamlead was told.

## 2. D-5 finding: no main.tsx change

#36 already connects the page to the real core: `apps/desktop/tests/e2e/support/app.ts` injects a `__TAURI_INTERNALS__` stand-in that forwards `invoke`, Channels and `listen` to a `noter-core-harness` child process (`StdioCore`), so `main.tsx`'s Tauri branch runs in WebKit. Proven against PR #26's harness (read-only worktree `~/projects/noter-wt/pr26-harness`, binary `target/debug/noter-core-harness --fixture world`): `m0-core-bridge-window.spec.ts` 10/10 and `m0-settings-hotkeys.spec.ts` 5/5 with `NOTER_CORE=stdio`. `playwright.config.ts` stays as it is.

## 3. M0 coverage work: `lane/ui/e2e-m0`

- Worktree `/Users/mpetrov/orca/workspaces/noter/ui-e2e`, branch `lane/ui/e2e-m0`, pushed (`358b61c`, **no PR, by design**). Report: `_team/ui/e2e/M0-coverage.md`, which has the numbers, the per-test real-core results, the backend gaps and the per-feature table.
- Numbers:
  - Main as CI runs it (current = pre-M0): 0/0, trivially passing.
  - Main if current were M0: 0/22 commands, 0/3 stories (no real-core run on main).
  - Against #26's harness: 19/22 (86.4 %) and 2/3 (66.7 %), above the bar; `first-run-download-models` 0/5 because `harness.world_set` doesn't own `app.setup.models`/`self_test` and there is no scripted self-test stream.
- Specs, written tests first; each travels inside its feature's PR, never alone on main:
  - `m0-first-run-ui.spec.ts` (11 tests) → first-run feature (2.6)
  - `m0-settings-hotkeys-ui.spec.ts` (6 tests incl. keyboard-only) → settings (2.7). #73 merged only the settings logic modules (`src/features/settings/*`), no window yet, so the locators are still unproven.
  - `m0-main-window-shell.spec.ts` (3 tests) → main-window-shell (2.5)
  - `support/app.ts`: `openWindow(page, label, { world })` + returned `steer` (`change`/`failNext`/`push`) for fake and stdio, shipped with the first of those PRs.
  - Primitives (2.3) and accessibility-l10n (2.4) bring no E2E.
- Fake-core run: 27/27 existing M0 tests pass with the new `support/app.ts`; the 20 new tests fail only because the screens don't exist. The world seed and `steer` are unproven on a real screen.

## 4. Next steps

1. Watch #66 until it merges; fix CI or a CodeQL thread if one appears (re-review after any diff change).
2. After #66 merges: rebase `lane/ui/e2e-m0` on main. In `m0-settings-hotkeys-ui.spec.ts`, replace the Card key path's local `not_implemented` catch with the milestone rule (`isLaterMilestone("M4")`).
3. When D-2's PR picks the search word, set `NO_MATCH` in `m0-settings-hotkeys-ui.spec.ts` to it (placeholder `"xylophone"`).
4. As first-run, settings and main-window-shell engineers open their PRs: hand them their spec file (and `support/app.ts`), review the E2E story coverage of each PR (TEAM.md step 4), and adjust locators to the implementation without weakening copy, commands or arguments.
5. Follow-up 1 above (command identity in `ahead`/`pending`) as its own small UI-lane PR.
6. When #26 lands, re-measure with `NOTER_CORE=stdio` and update `M0-coverage.md`; push the backend asks in its §1 through the Teamlead.
