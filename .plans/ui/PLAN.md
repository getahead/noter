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
UI run run_eab700ab5c38; workers started 20 Oct

## Status 20 Oct (resume)
Team Run run_eab700ab5c38. Working: ui-mid-1 (tick docs + tokens literal-colour fix), ui-eng-1 (shell), ui-eng-2 (first-run + D-21), ui-mid-2 (settings, waits for first-run shared components). Designer + ui-reviewer on Codex ready; ui-qa asleep until first PR. No UI PR open yet. Blockers: none owner-side. Unblocker taking FakeCore.corruptNextDownload.
- 21 Oct: #118 lang criterion: Teamlead decision lang=und for blocks without core-carried language (honest BCP47), tick a11y-l10n. first-run/settings boxes blocked by shared constraints -> owner item A/B/C escalated.

## Settled 21 Oct (UI Teamlead, dispatch ctx_33d16924e3bf)
Merged: #113 tokens CSS, #114 shell, #115 first-run (+D-21), #117 settings, #118 ticks. Ticked on main: core-bridge, tokens-theming, primitives, accessibility-l10n, main-window-shell. NOT ticked: first-run, settings (code merged; cfs validate parent-checked-nested-unchecked on shared constraints no-dialog-after-setup / behaviour-metrics-off). OWNER ITEM pending (ask msg_210222f6008b): A docs-only move of the two constraint rows out of first-run/settings coverage, B validator relax, C leave IN_PROGRESS. If A: ui-mid-1 does a docs(ui) PR (first-run.md 298/313, settings.md 257/290, DECOMPOSITION 429/499, DESIGN defs stay), then ticks both boxes.

## UI M1 (owner directive 24 Oct; UI Teamlead ctx_651740189c13, team Run run_61c69336eeac)
Goal: boxes 2.8–2.15 ticked with markers, `just gate` green, M1 UI stories/commands ≥ 60 % against the real core (36 commands, 13 stories; 2 stories need XCUITest). No perf. PR cap ≤ 10 across the unit (UI ≤ 6 while backend holds #179/#180). Backend M1 on main except the NSPanel conversion (NB10 unblocked by #181). Base main af22f26.
Specs: `_team/spec-ui-common.md`, `_team/spec-ui-<name>.md`. E2E tests first: 8 `m1-<feature>-ui.spec.ts` on `origin/lane/ui/e2e-m1` (ui-e2e rebases; engineers cherry-pick their file).
| # | Feature | Owner | Branch / PR | Depends on | Status |
|---|---|---|---|---|---|
| 2.11 | live-transcript | ui-eng-2 (Opus) | lane/ui/live-transcript | — | assigned |
| 2.10 | call-window | ui-eng-1 (Opus) | lane/ui/call-window | 2.11 component, D-18 command (backend) | assigned |
| 2.8 | dialogs-host | ui-mid-1 | lane/ui/dialogs-host | D-17 NavTarget (backend, not blocking) | assigned |
| 2.13 | library-calls | ui-mid-1 | lane/ui/library-calls | 2.8 | queued |
| 2.12 | menu-bar | ui-mid-1 | lane/ui/menu-bar | 2.8; XCUITest (ui-e2e); src-tauri gaps → backend | queued |
| 2.14 | call-page-frame | ui-mid-2 | lane/ui/call-page-frame | 2.11 stored variant, 2.8 alert | assigned |
| 2.9 | record-prompt | ui-mid-2 | lane/ui/record-prompt | 2.10 (loosely), D-17 | queued |
| 2.15 | notifications | ui-mid-2 | lane/ui/notifications | 2.14; XCUITest (ui-e2e) | queued |
| — | XCUITest suite `tests/native` + M1 coverage | ui-e2e | lane/ui/native-tests | built app on main | assigned |
Backend asks sent 24 Oct: D-17 `NavTarget::DeleteOldAudio`, D-18 `window_share_warning_seen` (contract PR, M1 in milestones.toml, UI wire review by me); fake-core gaps as engineers find them. Decisions applied inside feature PRs: D-15/D-18 lines (call-window.md), D-16 copy (call-page-frame.md, DESIGN.md 2196/2261, prototype). D-14 DESIGN row is already on main (1294).
Publish rule unchanged: go only after QA PASS + designer OK (visual PRs) + no blocking finding; ui-reviewer only when needed.

### Status 24 Oct 17:1xZ
| 2.8 | #182 draft (ui-mid-1) | QA FAIL @33b4d78 (cfs tick + 4 minors) → fixing; M-1 dialog plugin = backend (asked) |
| 2.14 | #183 draft (ui-mid-2) | gate red only on 16 E2E via Library>Calls → switching to nav:request; D-16 docs PR docs/ui-m1-d16 separate; fake gap capture_set_sensitive + Finder path → backend |
| 2.11 | lane/ui/live-transcript 0ca4936 (API pushed) | fake 17/17; stdio 0/17: harness world_set refuses transcripts (backend asked) |
| 2.13 | ui-mid-1 started library-calls | stacked on #182 until it merges |
HoD D-36: 'Audio deleted · transcript kept', no date in M1. Designer restarted (ctx_6979e23aa23d). Backend asks outstanding: D-17, D-18, world_set transcripts, fake sensitive, dialog plugin, Finder path.

### Status 24 Oct 18:1xZ
Open UI PRs: #182 dialogs (QA FAIL → fixing), #183 call page (QA queued; 2 fake-gap tests), #184 D-16 docs (go given, publishing), #186 live transcript (QA/design queued; stdio 0/17 harness), #188 call window (stacked on #186; QA/design queued). library-calls near PR (ui-mid-1). record-prompt started (ui-mid-2). ui-e2e on native-tests.
BACKEND LEAD INACTIVE (dispatch_inactive on ctx_afec29c1727b): 9 contract/harness/fake asks in ui/backend-asks-m1.md → Unblocker ctx_46786b35554f + escalation to the coordinator (msg_2b15f376c08e).

### Status 24 Oct 19:0xZ
Merged: #184 (D-16 docs). Open UI PRs: #182 dialogs (gate 0, review COMMENT, design OK, QA re-test pending → then go), #183 call page (designer CHANGES: css import, 2 visual specs, call-type case), #186 live transcript (QA/design queued), #188 call window (QA/design queued), #191 record prompt (draft; stdio needs harness item 10). lane/ui/notifications pushed, no PR (cap). library-calls near PR. Designer now claude sonnet ctx_667e39dce555 (codex failed twice at readiness). Teamlead decision: notification banner = first_recorded_call && permission not_determined (fixture alignment on e2e-m1).

### 24 Oct 20:3xZ — D-37 (HoD)
Unblocker (ctx_46786b35554f) owns backend-asks-m1.md while the Backend Teamlead is down; order 3, 8, 10, 9, 1, 2, 7, 6; items 4–5 (fake handlers) → ui-eng-2 on lane/contract/fake-m1-gaps. CI stdio E2E red on #183 #191 (harness items) → merges wait on the harness PR. QA woke after a terminal nudge (idle-at-prompt problem; QA spec now queue-based). Designer approvals: #182 #186 #188 OK; #183 CHANGES.

### 24 Oct 20:2xZ
#193 (Unblocker: harness asks 3, 8, 9, 10 + D-38) MERGED 19:44Z; engineers rebase once and re-run stdio. #192 (ui-eng-2, fake items 4–5) draft, gate queued. Unblocker on the wire PR (1, 2, 7), then 6 (Rust side; npm half in #182). e2e lock held 2 h by be-mid-3's conformance stdio run (asked). QA still on #182 re-test (lock contention). D-38: dismiss keeps the detection.

### 24 Oct 21:4xZ
#182 QA PASS → go given (2.8 box stays open until item 6 + XCUITest Cancel-default). #197 library-calls draft (ui-mid-1, stacked on #182). Menu-bar audit: 12 host-lane gaps (_team/audit-menu-bar-ui-mid-1.md) → Unblocker/HoD; 2.12 blocked on the host. Item 6 whole → Unblocker. QA order: #192, #186, #188, #197, #191, #183.

### D-39 (HoD, 24 Oct 21:5xZ) — menu bar
No reduced M1 menu: be-eng-1 (ctx_1a6e890e44e4) completes the tray per menu-bar.md after its current task, 2–3 host PRs by menu rows, host code carrying menu-bar.md IDs as markers, my review vs the spec, ui-e2e's XCUITest proves it; 2.12 ticks then. Out of M1 scope: Open Last Summary (M2), Newest Card title + copilot items/muted glyph (M4).

### 24 Oct 23:0xZ
D-40: crosstalk rows are M2; #186 16/17 on stdio accepted (11–12 in the Unblocker's wire PR core/ui-m1-wire with 1, 2, 7). #188 call window 34/34 fake+stdio with #192/#193/#186. #192 b476dad (3 fake fixes). Disk: Data volume 98 % (backend target/ dirs 20–29 GB each) → coordinator escalation; UI workers clear own caches. #182 publish pending (asked ui-mid-1). QA order: #192, #186, #188, #197, #191, #183.

### 24 Oct (coordinator): second QA
ui-qa-2 (ctx_ef688bc7560e, Sonnet) takes the BACK of the QA queue: #183, #191, #197. First QA keeps #192, #186, #188. Reports land in ui/qa/. Disk was 98%, cleaned to 85% (backend target/ dirs); keep clearing worktree caches.

### 25 Oct 00:1xZ
MERGED: #182 dialogs host (2.8 box open until item 6 + XCUITest Cancel-default). #198 (Unblocker: contract 2.1 D-17/D-18/CallDetail.folder + harness 11–12; UI wire review approved) in CI. #192 QA-first (QA queue 2: #192, #197, #188@7a78d15; #183/#191 after ui-mid-2 pushes). #186 + #188 rebase once when #198 merges, then go. QA dispatch now ctx_47c6c18f0a5d.
#200 (Unblocker): tauri-plugin-dialog whole (item 6), gating. #198 CI green, waits on harness-change-approved (coordinator). After #200 merges: tick 2.8 in #197 if every dialogs-host box is [x].

### 25 Oct 00:3xZ — LOW-COST MODE (owner)
Lead stops after this (worker_done); workers finish the task in hand and stop; self-serve publish rule (QA PASS + Design OK + self-review) sent to all. Resume: _team/handoff-ui-lead.md.

### 25 Oct 00:0xZ — round 2 (UI Teamlead ctx_2b305fe43d12; specs spec-ui-r2-common.md + spec-ui-<name>-r2.md)
Main has #182 #192 #193 #198 #200. #186 CI red at 28778bf (E2E :293 replay-line; screenshots were a flake, rerun green) → ui-eng-2 ctx_0dbfde77b372 fixes, then docs PR ticking 2.11. #188 #183 #191 #197 DIRTY after #198 → authors resolve once: ui-eng-1 ctx_8b378f16fdcd (#188 + D-17/D-18 + InlineConfirm), ui-mid-1 ctx_3619f83c64ae (#197 + D-36), ui-mid-2 ctx_083559644126 (#183/#191 conflicts, then #191). #202 notifications draft opened (stacked on #183). QA on demand per "ready #N" (ui-qa queue 1: #186/#188/#197; ui-qa-2 queue 2: #191/#183); designer on demand for #191/#183 baselines. Open PRs 7/10.

### 25 Oct 11:3xZ — round 3 (UI Teamlead ctx_3b56ec9ab260, term_3d0d9d1a-c426-4bef-9355-bceac3f7f06a; specs spec-ui-r3-common.md + spec-ui-<name>-r3.md)
Nothing merged for 14 h: every r2 worker died when the Mac slept (all work pushed, worktrees clean). #186 @5cc805c red only on the m0 self-test flake (a11y:244, also seen on #191) → failed jobs rerun, auto-merge on. #188 @db74e1b CLEAN on #186 (self-review APPROVE) → ui-qa ctx_3ba147273b31 re-tests; publish after #186 merges (base retargets to main on branch delete). Fix lists (Unblocker msg_6efd896c410b) dispatched: #197 ui-mid-1 ctx_e2d4ddbd322a (stdio :110 empty list), #191 ui-mid-2 ctx_f4e5b78e0f34 (visual call-ended/new-meeting, percent, baselines), #183 ui-eng-1 Opus ctx_eb6321c053e5 (css import, 2 visual specs, subtitle decision = participants when the core sends them, banner = exactly one call on stdio). #203 retitled (lower-case subject); its macOS job fails in the harness `native` recipe (`pnpm --dir apps/desktop tauri build` → needs `exec tauri`; justfile = owner) and 14 menu-bar tests need the D-39 host PRs → owner item. #202 waits for #183 (rebase, drop the merge commit).
- 12:0xZ MERGED #186 (b7994d4), #205 docs tick 2.11 (1bbbeaf). #188 rebased onto main by the lead (f5f1d2a, same diff), QA PASS, self-review published, ready + auto-merge; CI red on 6 live-transcript visual specs (5 pixel diffs, 1 toBeInViewport) -> ui-eng-2 r4 (Opus, ctx_283d71b91595) after it fixes the main stdio E2E flake (:328/:417, run 40189932781).
- 12:2xZ #206 flake fix merged (9fc7336). #191 @a789bbb: CI green, design OK (10 baselines; follow-up: the two l10n-pseudo record-prompt images show the window-error banner, not the prompt — shared l10n pass), QA (ui-qa-2) running; publish by the lead after QA PASS (self-review APPROVE unpublished in ui-mid-2/.prs/191).
- 12:5xZ MERGED #197 (3e3de43; QA PASS r3, self-review COMMENT). #191: DIRTY after #197 → lead rebased (caabd05, en.ts keep-both, +/- lines identical), new self-review APPROVE published, ready + auto-merge, CI running (the a789bbb rerun had reused the pre-#206 merge ref and hit :417 again). #188 @cdd850f ui-eng-2 r4 in progress; #183 DIRTY @ee182b2 ui-eng-1 r3 in progress.
- 13:0xZ MERGED #188 (3ff0baa). #191 rebased again after #188 (d48e869), review republished, auto-merge, CI running. Tick audit on main: open CDSL boxes dialogs-host 45, library-calls 28, record-prompt 37 (PR head), call-window 9 (incl. the M4 ELSE step + XCUITest rows) → ticks need per-feature tick passes (spec-ui-tick-pass-r4.md): ui-mid-1 r4 2.13 (ctx_33c5458c33dd), ui-eng-2 r5 2.10 (ctx_bfefa80cb4ca); 2.9/2.15 after #191/#202, 2.8 next, 2.14 after #183. 2.10 box likely blocked by the M4 step → owner item.
- 13:2xZ MERGED #191 (13:05Z). #183: fix list done by ui-eng-1 (5fae598), lead rebased after #191 (48d5b1c, +/- identical), self-review republished; designer (5 baselines) + ui-qa-2 running; then ready + auto-merge. Tick passes running: 2.13 ui-mid-1, 2.10 ui-eng-2, 2.9 ui-mid-2 (lane guard blocked its stray PNG move; answered: git checkout -f).
- 13:3xZ #183 designer CHANGES @5fae598 (PC-R5 header meta/tags missing; two transcript baselines show the placeholder = slots.transcript not wired to StoredTranscript) → ui-eng-1 r4 (ctx_aa032de1c00f). Lead rebased #183 after #191 (48d5b1c), review republished. ui-qa-2 testing. Designer images exported to _team/ui/design/evidence/183/ (lane guard blocks Bash on baseline paths; Read tool works).
- 13:4xZ MERGED #208 2.10 tick pass (cd939a3; 3 of 9 rows). 2.10 box held by M4 heights step + XCUITest focus row + 5-min Continue row → owner decision asked (A move rows / B stay IN_PROGRESS). QA #183 PASS @5fae598 (re-test after the r4 fix). ui-eng-2 r6 on 2.8 tick pass (ctx_25f9bfe8ce40).
- 13:5xZ OWNER FOCUS (no new branches/PRs until open PRs close): ui-eng-2 2.8 tick pass stopped before a PR (local WIP). Open: #183 (ui-eng-1 r4), #207 2.13 tick (auto-merge; stdio :155 inline-banner red at 64dec25 → rerun), #209 2.9 tick (ui-mid-2), #202, #203.
- 13:5xZ MERGED #207 2.13 tick pass (4ba15ca; 2.13 box held by inst-live-status + edit flow). #209 2.9 tick pass: CI green, self-review APPROVE, auto-merge on, two l10n-pseudo baselines → designer (ctx_2da25765d202, images in evidence/209). #203: ui-e2e asked for a go at 2b32655 → declined (owner items). #183 e910568 ui-eng-1 r4 in progress.
- 14:0xZ #209: design OK, label on; BLOCKED only by the bot commit's pull_request runs in action_required → approved them via `gh api -X POST repos/getahead/noter/actions/runs/<id>/approve` (same cause held #191/#188 before their rebases). #183 @cb08d46 MERGEABLE, ui-eng-1 finishing (no rebase: no conflict).
- 14:1xZ #183 @c5b53d5: CHANGES done (PC-R5 header + StoredTranscript mounted), self-review APPROVE, CI green but two stale baselines need the OWNER (bot mode "changed" keeps them, <2% diff) → reported; ui-qa-2 r4 re-test (ctx_8d76398b8511); designer re-review after the owner re-renders. #209: bot re-rendered (a045ac8, identical images), review ok, CI rerun watching.
- 14:2xZ MERGED #209 2.9 tick pass. QA #183 PASS @c5b53d5 (r4). #202 → ui-mid-2 r5 (ctx_9a9a68c4cdea): rebase --onto c5b53d5 d5f4bd3, finish, review. Open UI PRs: #183 (owner baselines), #202, #203 (owner).
- 14:3xZ #202 ready @7cb0e4e (rebased onto #183 c5b53d5, 4 commits, no screenshots, self-review APPROVE) → ui-qa r4 (ctx_86d26d6fec51). After QA PASS: ready + auto-merge once #183 merges (base retargets to main).
- 14:4xZ OWNER labelled #183 visual-change-approved at c5b53d5 (14:27Z) → marked ready, auto-merge on, hygiene rerun, watching. QA #202 PASS @7cb0e4e (2 minors); #202 stays draft until #183 merges and its base retargets to main (auto-merge earlier would merge into the lane branch), then ready + auto-merge + CI.
- 14:5xZ MERGED #183 (14:37Z). #202: lead rebased --onto main c5b53d5 (c9c698f, identical diff), review republished, ready + auto-merge, CI running. Left: #203 (owner).
- 15:0xZ #202 CI: 5 settings.spec.ts screenshots differ 4% (General pane "off" line) → update-screenshots label added by the lead; then designer review + label; approve the bot commit runs if action_required.
- 15:1xZ #202 @391c388: designer CHANGES (notifications-off baseline identical to pane-general: fixture lacks the denied permission) → ui-mid-2 r6; review republished at 391c388 by the lead; bot-commit runs approved.
- 15:2xZ #202 @f2c2b28: designer CHANGES (info icon, not warning triangle) → ui-mid-2 r7; four other images OK.
- 15:5xZ OWNER: restart workers for every non-owner unfinished box item → r8 (spec-ui-r8-finish.md): ui-mid-1 2.13 (ctx_36c0738240c5), ui-eng-2 2.8 (ctx_2605ded9f08d), ui-mid-2 2.9 (ctx_8aee713a3bc9), ui-eng-1 2.14 (ctx_fe552e444afc), ui-e2e #203 (ctx_1f2582b8cfa3), designer #202 @92a9afb (ctx_5b8b3d948158). Owner-only items batched to the coordinator (2.10 A/B, #203 TCC, justfile native recipe, 3 stale baselines, D-39, DESIGN wording, #201). 2.15 after #202 merges.
- 15:5xZ MERGED #202 notifications (92a9afb; designer OK, stale notifications-off.png = owner). UI M1 feature PRs all merged: #182 #186 #188 #197 #191 #183 #202 (+ ticks #205 #207 #208 #209, flake #206). Open: #203 (owner). Queue: 2.15 remaining rows → ui-mid-2 after 2.9.
- 16:0xZ 2.9 r8: no change (inst-core-detect/notice need E2E-file markers; apps/desktop/tests/e2e is not a codebase scan root in artifacts.toml = owner item). ui-mid-2 r9 → 2.15 remaining rows (ctx_c54f019986a7). ui-eng-2 takes slots.deleteCall (2.8 inst-after-delete); relayed to ui-eng-1.
- 16:1xZ DECISION: call page calls ui/dialogs/delete-calls.ts directly (ui-eng-1, slots seam removed); ui-eng-2 marks 2.8 inst-after-delete on delete-calls.ts, no slot. library-calls.md L138-139 (inst-user-edit/api-update) ticked by ui-eng-1. #203 rebased/aligned by ui-e2e (2a10954), not published.
- 16:2xZ OWNER DECISIONS: 2.10 = B (stays IN_PROGRESS, rows kept). #203 Mac items done → ui-e2e r9 Opus runs just native (NOTER_APP_PATH workaround) and fixes failures. REVERSED delete-call decision: #213 (ui-eng-2, 2.8 tick pass) registers slots.deleteCall; ui-eng-1 keeps the seam and marks inst-ready-deleted on it after #213.
- 16:1xZ Finish PRs open: #211 2.15 allow-flow tick (auto-merge), #212 2.13 live status + edit (QA ui-qa-2 ctx_4c378805b0c6), #213 2.8 tick pass (QA ui-qa ctx_5d490e9a5cf6, auto-merge), #214 2.14 finish (ui-eng-1, screenshots pending). ui-e2e r9 native run (ctx_a15a43288ed3).
- 16:2xZ MERGED #213 2.8 tick pass (16:07; 23/45 rows; rest owner). QA #213 FAIL after merge (page shows no error on failed delete; ⌘⌫ inert; no stdio proof) → folded into #214 (ui-eng-1).
- 16:3xZ MERGED #211 2.15 allow-flow tick (16:03). #214 @644c78d ready: QA (ui-qa ctx_084d8d97c145) + designer (ctx_45c80c255feb) on the two re-rendered call-page images = the stale #183 ones (owner item 4 for main resolves with #214). #212 @32cb738 review pending (ui-mid-1).
- 16:3xZ QA #214 FAIL: B1 deletes call-page/slots.ts that #213 (main) imports → would break main; auto-merge DISABLED; ui-eng-1 r9 rebases, restores the seam, folds M1/M2 (failed delete error, ⌘⌫). Designer OK on its two images (= the stale #183 ones, fixed).
- 16:4xZ native run (ui-e2e r9): 3/26 pass @47238e9; 6 tray gaps (D-39 host, frozen) + 17 need core launch hooks → #203 = owner/backend hold. #214 @ef1c51d fixed (seam restored, error row, ⌘⌫) → QA re-test (ui-qa ctx_4c2a72eaf25c), auto-merge off until PASS.
### Status 28 Oct 21:4xZ (r11, owner: complete UI M1; FOCUS lifted for M1 scope, low-cost stays)
Main 3669e91 (0.12.0). Boxes: 2.11 [x]. Holds computed from the specs: 2.8 quit flow (host, no quit handling yet) + sheet submit/invalid rows (M2 `audio_delete_older`) + XCUITest AC; 2.9 two core markers + XCUITest focus AC; 2.10 M4 heights step + 5-min Continue AC + XCUITest focus AC; 2.12 all 29 rows host-side (D-39) + XCUITest; 2.13 four ACs (tests); 2.14 two native ACs (XCUITest); 2.15 core-side receive flow/item state (notify.rs exists; NT-1/NT-2 parts are M2) + XCUITest rows. #203: 3/26 locally, CI native recipe broken (pnpm 10.28), 17 tests need launch hooks (fixture world/scripted engine in the built app), 6 need the D-39 tray. Dispatched (ROSTER r11): ui-eng-2 Opus menu-bar host, ui-e2e Opus hooks + #203, ui-mid-2 Sonnet marker/tick passes. Lead: justfile `native` fix PR (harness label = coordinator).
OWNER DECISION 28 Oct: option A replaces B for 2.10 and every box held the same way: rows the spec places in a later milestone or not delivered in M1 move to their milestone in the spec (docs-only PRs); XCUITest-only rows are proven via #203. Lead does the docs moves for 2.8 (sheet rows → M2) and 2.10 (M4 heights, 5-min Continue); ui-mid-2 applies it inside its passes (2.15 NT-1/NT-2 → M2; 2.13 undelivered ACs → M2). Report the moved rows per box to the coordinator when done.
- 21:5xZ #216 justfile native fix open (self-review APPROVE, auto-merge; blocked on the owner's harness label + one core flake rerun models.rs:195). #217 ui-mid-2 PR 1 (core markers 2.9/2.15) open. #218 docs move (2.8 sheet rows → call-page-outputs inst-sheet-submit/-invalid/-return; 2.10 inst-floating-heights → copilot inst-capacity; Continue AC ticked) open, auto-merge. HoD told of the 72 pt prompt-offset discrepancy (core placement has none).
- 22:2xZ MERGED #218 (owner A moves for 2.8/2.10; moved-rows part 1 sent). #216 green, waits only for the owner's harness label. #217 (ui-mid-2 core markers 2.9/2.15) in CI.
- 22:4xZ MERGED #217: 2.9 core rows + flows + 3 ACs ticked (72 pt note under inst-core-detect); 2.15 receive flow rows except nt3/return, item state, 4 ACs; moved to M2: inst-case-nt1 (→ call-page-outputs inst-nt-click), outputs trigger wording, denied-states AC. Found: host sends NT-3 clicks to the call page, DESIGN 2291 says call window → ui-eng-2 PR 2. Reduce-motion countdown AC test → ui-mid-2 PR 3. Left for #203: dod-permission, dod-record-prompt-panel, XCUITest ACs.
- 23:0xZ MERGED #219 menu-bar host PR 1 (crates/noter-core/src/tray.rs model, glyphs, lines, order, hotkeys; ui-eng-2). #220 launch hooks (NOTER_TEST_FIXTURE etc., ui-e2e) open. #221 release 0.13.0 = owner's.
- 23:1xZ MERGED #220 launch hooks. ui-e2e → #203 (rebase, run just native with the hooks, publish). Still open: #216 (owner label), #203; ui-eng-2 PR 2, ui-mid-2 PR 3 in progress.
- 23:2xZ #222 ui-eng-2 PR 2 open (quit alert ⌘Q + menu item, menu-bar flows, NT-3 click → window_show_call).
- 23:4xZ MERGED #222. #223 (ui-mid-2, 2.13 ACs + Back scroll fix): bot baselines 756db01, runs approved, designer (ctx_5b3a4964372c) CHANGES 9/15: all three widths fall in Medium (content = window − 220), Length not hidden at Medium, no Narrow two-line rows, dividers in selected rows, Export… absent (M2) → fix list sent to ui-mid-2; re-render + designer again after the fix. #224 docs (MB-R6 Next → Today M2, build-menu + dod-content ticked, call-page-frame entry AC ticked) open, auto-merge. Remaining on main after #224: XCUITest rows only (#203) for 2.8/2.9/2.10/2.12/2.14/2.15, plus 2.9 Reduce-motion AC (ui-mid-2) and 2.13 (#223 + DESIGN boxes PR).
- 29 Oct 00:0xZ OWNER FINISH-ONLY (out of tokens): complete #224 #223 #216 #203 only. MERGED #224 (after one E2E flake rerun). #223: ui-mid-2 r12 fixed widths/columns/dividers, designer rounds 2–5 (ctx_508138c1742e, ctx_eaabedfd6699, ctx_c324b5343b77), label at e9aebb6, MERGED 00:4xZ. #216 waits for the coordinator's harness label. #203 parked as draft (owner TCC + #216). Worker asks/worker_done never reached the lead's inbox this round; handoffs on disk were used. COMPLETE sent; handoff-ui-lead.md rewritten.
- 17:1xZ MERGED #214 (16:55). Main CI green at 945df6e. All non-owner UI M1 work merged; COMPLETE sent. Holds: #203 (D-39 host, core launch hooks, justfile native recipe), boxes 2.8/2.9/2.13/2.14/2.15 (core-side CDSL steps, M2 rows, XCUITest proofs, E2E not a cfs scan root), 2.10 = B, 2.12 = D-39, notifications-off.png refresh (owner).
### Status 31 Oct (r12, owner: FINISH-ONLY lifted, complete UI M1; option A stays; low-cost; max 3 workers)
Main 6165b45 (0.13.0): #221 #223 #224 merged. Boxes: 2.11 [x]. Holds computed: 2.8 XCUITest Return-never-confirms (#203); 2.9 Reduce-motion AC (ui-mid-2 r12) + XCUITest rows (#203); 2.10 XCUITest no-focus (#203); 2.12 dod-native-tests (artifacts.toml entry → #225; marker + ticks in #203) + 2 XCUITest ACs; 2.13 nothing → #225 ticks it; 2.14 XCUITest native AC (#203); 2.15 dod-permission (XCUITest allow, #203). No option-A moves left (all merged in #217 #218 #224). #216 (Codex) green but needs harness-change-approved (coordinator); #203 (Codex) draft, TCC on the Mac + #216 + #225.
- #225 docs(ui) tick 2.13 + Native UI tests codebase: self-review APPROVE published, auto-merge, CI running (arch/e2e/e2e-coverage/docs).
- ui-mid-2 r12 (Sonnet, term_f76b0e34): lane/ui/record-prompt-reduce-motion, one E2E test + tick the §6 row.
- MERGED #225 (2.13 ticked; artifacts.toml Native UI tests). #226 ui-mid-2 2.9 Reduce-motion AC: self-review APPROVE, auto-merge, E2E running.
- 22:2xZ MERGED #226 (2.9 Reduce-motion AC, one flake rerun), #216 (Codex, labelled), #227 (Codex). Main e121d99. All non-owner UI M1 work merged; every remaining [ ] row (2.8/2.9/2.10/2.12/2.14/2.15) is an XCUITest proof in #203 (owner TCC + Codex). COMPLETE sent; handoff-ui-lead.md rewritten.
### Status 1 Nov (r13, lead ctx_494f4b18951e; owner: complete UI M1, low-cost, max 3 workers)
- 31 Oct 22:3xZ–1 Nov 04:4xZ #203 (XCUITest suite): run 41247198914 failed 25/26 ("has not loaded accessibility", app.launch timeout on every fixture=world launch); coordinator put an Opus fixer (ctx_b2dc8c351c81, ui-e2e worktree) on it and told the lead not to touch the branch. Fixer rounds: ea7c1f99 22/26 (4 dialog-alert fails: Return/default button), 6e2ff216 same, 39a46ab0 25/26, 832bbdae 26/26 (with core fixes #233 #235 #239 #275 on main). Gate failed on a first-run self-test E2E flake → lead reran the failed jobs → MERGED 11:39Z as 224efa8e.
- Lead prepared the tick branch meanwhile (docs/ui-m1-ticks): cfs validate rules learned: feature [x] ⇒ every nested principle/constraint ref [x] (parent-checked-nested-unchecked); ref [x] ⇔ DESIGN definition [x] in every reference (ref-done-def-not-done / def-done-ref-not-done); DESIGN IDs need no code marker (to_code=false), FEATURE DoD IDs do (code-no-marker).
- #278 docs(ui) tick: first head ticked all six boxes; ponytail self-review found the 2.9 row "Clicking Record leaves keyboard focus" and the 2.10 row "No click on the call window moves focus" have no click test (every native test uses hotkeys). A Record-click test (02d3420b, clickKeepingFocus helper) failed on run 41303320219: the call app was runningBackground after the click. Test removed, 2.9/2.10 left open, finding sent to the coordinator. MERGED 12:28Z with 2.8, 2.12, 2.14, 2.15 ticked (+ DoD markers menu-bar-native-tests, notifications-permission; principle refs undo-over-confirm 2.16, privacy-visible 2.10, no-dialog-after-setup 2.9 mirrored for the validator).
- UI M1 after r13: 2.11 2.13 2.8 2.12 2.14 2.15 [x]; 2.9 and 2.10 [ ] on the click-focus rows only (owner/host item: does a webview click in the non-activating panels activate Noter? src-tauri/surfaces.rs; evidence run 41303320219).
