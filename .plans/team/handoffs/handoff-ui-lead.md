# UI Teamlead handoff — UI M1 round 13 (1 Nov 2026)

Role: UI Teamlead, dispatch ctx_494f4b18951e (task task_17ea74392384), terminal term_aecaf10d-9bee-4c67-b939-c8e515f153ca; timeline ui/PLAN.md "Status 1 Nov (r13)". Earlier rounds in git history of this file.

## Merged this round (main after #278)
#203 XCUITest suite (26/26 on CI; Opus fixer ctx_b2dc8c351c81 owned it from 22:5xZ, lead reran one E2E flake) · #278 docs(ui) tick 2.8 2.12 2.14 2.15 + two DoD markers (lead; self-review APPROVE, auto-merge).

## State of the boxes (DECOMPOSITION on main)
- [x] 2.8 dialogs-host, 2.11 live-transcript, 2.12 menu-bar, 2.13 library-calls, 2.14 call-page-frame, 2.15 notifications.
- [ ] 2.9 record-prompt: only "Clicking **Record** leaves keyboard focus in the call app (XCUITest)" + `dod-ui-record-prompt-panel` ("never take keyboard focus").
- [ ] 2.10 call-window: only "No click on the call window moves focus from the call app (XCUITest)".
Everything else of those two is ticked; their DECOMPOSITION/DESIGN boxes follow once the rows are proven (components screen/ui-record-prompt, shell-call-window, screen-call-screen, screen-floating-panel, ui-capture-notice, ui-recording-indicator, ui-call-status-strip, ui-collapsed-call-strip, ui-person-chip; principles never-steal-focus, quiet-surface; constraints non-activating-panels, one-call-window, share-exclusion-limits, copilot-flag; plus the 2.27 mirrors of quiet-surface/copilot-flag).

## Owner / host item (the only hold on UI M1)
No native test clicks the prompt or the call window; all use hotkeys. A Record-click test (`clickKeepingFocus(recordPrompt.buttons["Record"])`, #278 commit 02d3420b, removed) failed on CI run 41303320219: `other.state` was `runningBackground` after the click, i.e. Noter took the foreground although `src-tauri/surfaces.rs` gives the prompt the `nonactivating_panel` style. Either the webview click activates the app (host/core lane fix) or XCUITest's synthesized click is not a user click (test-method fix). Once a click test passes: tick the two rows, the `-panel` DoD (marker `// @cpt-dod:cpt-noter-dod-ui-record-prompt-panel:p2` in RecordPromptTests.swift), then 2.9/2.10 with the boxes above; `cfs validate` enforces ref ⇔ definition symmetry (see PLAN r13).

## Other owner items still open (unchanged)
Stale `notifications-off.png` baseline (r8); selected-medium Calls baseline 1 px hairline; 72 pt prompt-offset DESIGN discrepancy (HoD told in r11).

## How to resume
Read CHARTER.md, DECISIONS.md tail, ROSTER.md. `for f in record-prompt call-window; do grep -n '\[ \]' docs/features/ui/$f.md; done`. The tick pattern is #278 (docs + markers; run `cfs validate` locally, it is the docs CI job).
