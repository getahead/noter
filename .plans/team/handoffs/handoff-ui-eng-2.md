# Handoff — ui-eng-2 (25 Oct, r8: 2.8 dialogs-host remaining rows)

- PR #213 `feat(ui): dialogs host tick pass` @83f0b91, branch lane/ui/tick-dialogs-host (rebased onto main 634c1a9). CI green, self-review APPROVE published, auto-merge on. Sent `ready #213 @83f0b91` (QA: new code).
- Checks: `cfs validate`, `just docs`, `just gate-fast`, `just gate` (NOTER_CORE_CMD set), `just trace`, E2E dialogs-host + call-page specs fake 20/20 and stdio 20/20.
- 23 of 45 rows ticked: the 20 from WIP cca4b4c, plus `inst-after-delete`, the "lands on Library › Calls" acceptance row, and the delete-call flow ID.
- New code: `deleteFromPage` (ui/dialogs/delete-calls.ts). The main window registers call-page `slots.deleteCall` with it: native alert, `calls_delete`, then a history `replace` to Library root. NavTarget has no Library target, so the move happens inside the shell.
- For ui-eng-1 (told via status): 2.14 `inst-ready-deleted` can mark that code. A failed delete on the call page is silent for now: the slot's promise resolves with `{outcome: "failed"}`, and the page's section error is 2.14's.
- Still open (owner items):
  - Quit flow, 6 steps + ID: core/src-tauri. Nothing handles Quit while recording, and "Quit Noter" has no action.
  - Sheet `inst-user-submit`, `inst-if-invalid`/`inst-invalid`, `inst-return-sheet` and states `open-busy`, `busy-invalid`, `invalid-busy`, `busy-closed`: no M1 sheet has a primary button that runs a command (Done only) or any field. The first such sheet is Delete Old Audio, `audio_delete_older` (M2).
  - Acceptance "Return never confirms a delete": XCUITest only (#203).
  - These keep `dod-hosts`, `dod-delete`, the sheet flow/state IDs, the quit ID, featstatus, the feature line and DECOMPOSITION 2.8 `[ ]`.
