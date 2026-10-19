# UI plan and status (Teamlead keeps this)

Order follows docs/DECOMPOSITION.md §3. Status: todo · assigned · draft PR · review · merged · ticked.

| # | Feature | M | Owner | Branch / PR | Status |
|---|---|---|---|---|---|
| 2.1 | core-bridge | M0 | — | #36 | merged (box not ticked) |
| 2.2 | tokens-theming | M0 | — | #30 | merged (box not ticked) |
| 2.3 | primitives | M0 | ui-eng-1 | #64 | draft PR, in QA/review/design; harness fixture follow-up → DevOps |
| 2.4 | accessibility-l10n | M0 | ui-eng-2 | #63 | draft PR, in QA/review/design |
| 2.5 | main-window-shell | M0 | — | | todo (after primitives + a11y) |
| 2.6 | first-run | M0 | ui-mid-1 (logic slice) | lane/ui/first-run-logic | logic slice assigned; screens after a11y |
| 2.7 | settings | M0 | ui-mid-2 (logic slice) | lane/ui/settings-logic | logic slice assigned; screens after first-run |
| 2.8–2.15 | M1 | M1 | — | | todo |
| 2.16–2.21 + accounts key | M2 | M2 | — | | todo |
| 2.22–2.26 | M3 | M3 | — | | todo |
| 2.27–2.28 | M4 | M4 | — | | todo |
| 2.29–2.30 | M5 | M5 | — | | todo |

## Open items carried from HANDOVER-ui.md
- HoD/owner before M2: Verify/Save in the Add API Key sheet (`api_key_set` verifies and stores in one call).
- Owner: U0/U1 follow-ups (ahead() failing once a milestone is current; copilot:status guard; window_not_allowed assertion order).
- Owner (config): page E2E under NOTER_CORE=stdio picks the Tauri transport.
- DevOps: perf.toml entry `ui-stream-flush` (snippet in #36 body) — ui-perf to confirm.
- DevOps: add `.css` to the Desktop UI codebase in .cf-studio/config/artifacts.toml.
- Visual: baselines render at 1x though the config asks for 2x — not investigated.
- Settings feature: take `rev` from the latest settings:changed after Restore Defaults/display pick; Hotkeys pane renders card keys from settings.copilot.card_keys.

## Side PRs (HoD decisions)
| Item | Owner | PR | Status |
|---|---|---|---|
| D-1..D-3 docs (menu-bar, settings search word, API key sheet) | ui-perf | | assigned 11:58 |
| D-4 + D-5 test support (ahead fail-when-current, milestones.ts move, stdio bridge transport in main.tsx) | ui-e2e | | assigned 11:58; backend told (conformance lane) |

## Bugs on main (from ui-qa, _team/ui/qa/main-bugs.md)
- MB-1 (minor): document not styled by tokens → ui-mid-1 PR fix(ui): style the document with the tokens.
- MB-2 (minor): window section-level error is a bare placeholder, not the inline banner → fix with primitives (InlineBanner) / shell.
- DevOps is now ctx_0f81e84c9b80 (codex). D-11: lock only around Playwright once its PR merges; until then keep lockf for gate.
- Backend adding harness control (corrupt-fetch) for first-run checksum_failed/downloading/error on real core → ui-e2e adopts.
| MB-1 fix | ui-mid-1 | #68 | in QA/review/design |
- Baseline bot fix: PR #71 (Babysitter), needs owner harness-change-approved; then re-add update-screenshots on #63/#64/#68.
- #64 head d6e8bdd: gate part 1 green (94.6% changed lines); e2e running; visual waits on #71.
| settings logic slice | ui-mid-2 | #73 | in QA/review; auto-merge disabled by lead (published early) |
| shell logic slice | ui-mid-2 | lane/ui/shell-logic | assigned |
| UI review contract #74 | ui-reviewer | #74 | assigned |
- #63 832e4c5: gate green except 10 missing l10n-pseudo baselines (waits #71).

## Lead checkpoint (usage limit hit; resume here)
- Last processed delivery: delivery_97016dc3ad17 (not acked). Resume: scratchpad loop.sh pattern = check --wait, ack, heartbeat.
- ui-mid-2 (ctx_58f13fc0ede6) hit its usage limit: #73 rebased, auto-merge OFF, waiting "go #73"; lane/ui/shell-logic committed locally (28 tests), NOT pushed, no PR.
- Pending verdicts: QA/ui-reviewer/designer for #63, #64, #66, #68, #73; ui-reviewer UI review of contract #74.
- Pending handoffs (Sonnet switch): ui-e2e, ui-perf (ui-perf must first push docs/ui-d1-d3 95c1ef8 and open the PR; HoD waits for the number).
- Blocked on owner: harness-change-approved on #71 (screenshot bot) and #72 (lock scope).

## Status 16:55 (after usage-limit pause)
- Merged: #68 (MB-1), #73 (settings logic — merged before the go, with BLOCKING nested-draft defect → ui-mid-2 follow-up fix PR).
- #63: ui-reviewer BLOCKING x2 (+MAJOR) sent to ui-eng-2; QA verdict coming (FAIL on an e2e regression).
- #64: ui-reviewer BLOCKING x4 sent to ui-eng-1; #63 lands first, then #64 drops sheet Tab handling. Designer reviewing design fit.
- #66: no BLOCKING → go given; ui-e2e then hands off (Sonnet).
- #76 (docs D-1..D-3): reviewer APPROVE → go given to ui-perf; then perf PR + handoff (Sonnet).
- #77 (shell logic, ui-mid-2): reviewer + QA queued.
- first-run logic (ui-mid-1): gate running in ~/projects/noter-wt/ui-mid-1-b; PR pending. Its dispatch settled (failed); redispatch ctx_4858e3adbd51 failed at readiness (agent busy).
- #74 UI review APPROVE sent to backend + PR comment.
- #71/#72 labelled by owner, branches updated; auto-merge pending. After #71 merges: re-add update-screenshots on #63/#64.
- /usr/local/bin/orca broken for some agents → PATH=/Applications/Orca.app/Contents/Resources/bin first (TEAM.md).
- 17:05 designer #64 CHANGES (disabled hover, reduced-motion spinner) → ui-eng-1; H1/H2 resolved (prototype wins; DECOMPOSITION §1 item 8). go #77. ui-e2e settled: M0-coverage.md; specs on lane/ui/e2e-m0 for engineers (first-run 11, settings 6, shell 3).
| first-run logic slice | ui-mid-1 | #78 | in QA/review |
- D-13 (HoD): keep DESIGN motion (popover 200 ms fade, ease-in exits, inspector 250 ms slide); purely visual, never delays focus/Escape/commands/keyboard, none under Reduce Motion. Spinner + level meters keep moving under Reduce Motion (tokens-theming inst-no-motion) — H1 withdrawn.
- #78 (first-run logic): auto-merge off (held for review/QA).

## Status 17:55 — FREEZE on; open UI PRs 8
| PR | What | Owner | State |
|---|---|---|---|
| #63 | accessibility-l10n | ui-eng-2 | d7b9e6d: reviewer blockers cleared; QA re-test queued; baselines wait #71 → Unblocker re-labels; designer reviews; then go. Merges before #64 |
| #64 | primitives | ui-eng-1 | reviewer cleared; QA FAIL 3 majors + spinner revert sent; Tab trap after #63; baselines wait #71 |
| #66 | D-4/D-5 test support | ui-e2e | published, auto-merge on, CI |
| #76 | docs D-1..D-3 | ui-perf | published, auto-merge on |
| #77 | shell logic | ui-mid-2 | QA PASS, review COMMENT → go given |
| #78 | first-run logic | ui-mid-1 | reviewer BLOCKING + QA M-1 (zero_buffers/timed_out → HoD asked) → fixing; auto-merge off |
| #81 | fix #73 nested draft + chord | ui-mid-2 | reviewer COMMENT; QA queued first; then go |
| #82 | perf ui_window_open | ui-perf | published, auto-merge on; reviewer nonblocking |
Dispatches: ui-qa ctx_8c6943bba089 (queue #81,#63,#64,#78), designer ctx_7f9f284d567c (D-13 notes, #64 spinner correction, baselines), ui-mid-1 ctx_2b20227cb4df (#78), ui-perf ctx_7498c4323678 (Sonnet; #82/#76 + DevOps perf PR), ui-e2e ctx_0ed67dcb6c47 (real-core alignment).
QA worktree has untracked unapproved primitives screenshots the lane guard won't let me remove → QA tests in temp worktrees; owner may delete ~/orca/workspaces/noter/ui-qa/apps/desktop/tests/visual/__screenshots__/primitives.spec.ts/.
- D-14 (HoD): zero_buffers=permission_missing (system audio), timed_out=FAILED w/ copy; in #78. DESIGN.md row after freeze (next docs(ui) PR).
- ui-e2e settled (real-core alignment done, released); next: after #66 merges re-rebase lane/ui/e2e-m0/m1. Backend asks (world_set, fake call_details, steer on stdio) and 4 HoD spec conflicts (M1) routed.
- D-15..D-18 (HoD, M1): D-15 Try Again after engine stop = capture_resume_interrupted (call-window.md inst-case-retry ~l.116 + error line); D-16 copy "Get a notification when a summary is ready." (DESIGN.md 2196, 2261; call-page-frame.md:135; prototype x2); D-17 NavTarget::DeleteOldAudio (backend contract PR, UI reviews wire change); D-18 new command window_share_warning_seen (backend, with D-17), call-window.md inst-share-warning names it. → AFTER FREEZE: one docs(ui) PR with D-14 DESIGN row, D-15, D-16, D-18 doc lines. ui-e2e specs on lane/ui/e2e-m1 to follow D-15/D-16.
- Backend plan for E2E asks: M0 world_set fields → #26; FakeCore.corruptNextDownload → first contract PR after freeze; M1 asks at M1 start.
- #63 9d03343: local just gate exit 0 (visual caveat: stale untracked local PNGs); waits bot baselines + QA re-test + designer.
- 18:10 holding updates of #66/#76/#77/#82 (BEHIND) until #71 merges, so #71 isn't pushed behind again.
- #81 QA PASS → go (publish, no update until #71 merges).
- 19:00 ui-perf released (task blocked on #71 only). After #71 merges: lead runs update-branch on #76/#82 (+#66/#77/#81), then DevOps §4 harness PR. #63/#64 perf SUCCESS.
- 18:45 #71 MERGED. Relabeled #63/#64 (bot queued). Updated #66/#76/#77/#81/#82. #63 QA PASS @9d03343.
- #78 fd5dfe2: fixes pushed; D-14 spec lines pending; re-review + re-QA routed. #82 reviewer APPROVE.
- ui-mid-2 released (task 2 done; #77/#81 auto-merge). Re-dispatch if they go red.
- #64 QA PASS @4137c7c. Order: #63 merges first, then #64 rebases (catalogue strings + Tab trap removal) → re-review → go.
- 19:00 baselines landed #63 3cb2342 (10), #64 411fe81 (7); designer reviewing. #63: QA PASS, review cleared → after designer OK: label + go.

## M0 to 100% (owner directive, 18 Oct 22:40) — max 10 open PRs across both teams, M0 only
Merged meanwhile: #63 a11y-l10n, #64 primitives, #66, #76, #77 shell logic, #78 first-run logic, #81, #82, #88.
| Feature | Owner | Branch / PR | Status |
|---|---|---|---|
| ticks: core-bridge, tokens-theming, primitives, accessibility-l10n | ui-mid-1 (ctx_8104c6899f67) | docs/ui-m0-ticks | verify gate on main, tick what's complete, report gaps |
| main-window-shell (+ core-bridge leftovers inst-skeleton/inst-user-acts, MB-2) | ui-eng-1 (ctx_321439cb624c) | lane/ui/main-window-shell | assigned |
| first-run (+ D-21 wait/re-run, D-14 DESIGN row, shared permission row / self-test panel / display picker) | ui-eng-2 (ctx_064d2a206aeb) | lane/ui/first-run | assigned; D-21 status asked of Unblocker |
| settings (reuses first-run components) | ui-mid-2 (ctx_7a50a33ca892, Sonnet) | lane/ui/settings | assigned |
QA / reviewer / designer re-dispatched when the first PRs open. E2E specs from lane/ui/e2e-m0 go into the feature PRs.
- 22:50 OWNER PAUSE relayed; all engineers told to WIP-commit + handoff + stop. Lead handoff: _team/handoff-ui-lead.md.
