---
title: "Feature — Dialogs, sheets and alerts"
description: "How Noter asks before what cannot be undone: native alerts with the safe button as default, window-modal sheets, anchored popovers and the call window's inline confirmation, with the M1 delete and quit alerts."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-dialogs-host
milestone: M1
---

# Feature: Dialogs, sheets and alerts


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Delete a call for good](#delete-a-call-for-good)
  - [Quit while recording](#quit-while-recording)
  - [Confirm a discard in the call window](#confirm-a-discard-in-the-call-window)
  - [Open a sheet or a popover](#open-a-sheet-or-a-popover)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Build a delete alert](#build-a-delete-alert)
- [4. States (CDSL)](#4-states-cdsl)
  - [Alert](#alert)
  - [Sheet](#sheet)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Alert, sheet and popover hosts](#alert-sheet-and-popover-hosts)
  - [Delete and quit alerts](#delete-and-quit-alerts)
  - [Inline confirmation in the call window](#inline-confirmation-in-the-call-window)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p2` - **ID**: `cpt-noter-featstatus-ui-dialogs-host`

## 1. Feature Context

- [ ] `p2` - `cpt-noter-feature-ui-dialogs-host`

### 1.1 Overview

Noter asks first only before irreversible actions (`cpt-noter-principle-undo-over-confirm`). This feature provides the three hosts every other feature uses — the native alert request (drawn by macOS through the dialog plugin), the sheet host attached under a window's toolbar, and the popover host anchored to its control — plus the call window's two-step inline confirmation, which replaces alerts there. It also delivers the M1 dialogs: **Delete Call…**, **Delete…** for several calls, **Quit Noter** while recording, the inline **Discard Recording** confirmation and the **Delete Old Audio…** sheet frame.

### 1.2 Purpose

It implements `cpt-noter-component-screen-dialogs` as the catalogue and host; each later feature adds its own sheets and alerts to it.

**Requirements**: PRD › Security, privacy and permissions › Deletion (deletes are final in v1, PM-22); D37, D38. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-undo-over-confirm`, `cpt-noter-principle-never-steal-focus`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Confirms or cancels an irreversible action, fills a sheet, uses a popover |
| macOS (system) | Draws native alerts and the open and save panels |
| Noter core (system) | Carries out the confirmed action (delete, quit, discard) |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Security, privacy and permissions › Deletion
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Screen — Dialogs, sheets and popovers (Regions AL, SH, PO, inline confirm; Elements; States)
- **Design elements**: `cpt-noter-component-screen-dialogs`
- **Stories**: `cpt-noter-seq-dialogs-delete-call` (M1); it serves `cpt-noter-seq-menu-bar-control-recording` (Error — Quit while recording) and `cpt-noter-seq-call-screen-recover-capture` (Empty — Nothing heard yet; Error — Disk nearly full)
- **Frozen commands it calls**: `calls_delete`; `capture_discard` (through the call window); `audio_delete_older` (M2)
- **Prototype modules**: `src/js/05-shell.js` (`S.windowOverlays`, `S.floatingLayer`), `src/js/30-c-dialogs.js` (`dlg.deleteCall`, `alertOf`, the `al-*` gallery, `dlg-delete-old-audio`), `src/js/40-d-3-library.js` (`lib.deleteAsk`, `lib.delete`), `src/js/10-a-surfaces.js` (quit alert), `src/js/20-b-components.js` (`C.captureNotice` inline confirm), `src/css/00-base.css`, `src/css/01-macos27.css` (`.np-sheet`, `.np-alert`, `.np-pop`), `src/css/30-c.css` (`.dlg-*`)
- **Dependencies**: `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-primitives`

## 2. Actor Flows (CDSL)

### Delete a call for good

- [x] `p1` - **ID**: `cpt-noter-flow-ui-dialogs-host-delete-call`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-dialogs-delete-call`: **Delete Call…** (⌘⌫) in the Call page's ⋯ menu, the alert **Delete “Planning: VHI 8.0 drawer redesign”?** with **This removes its audio, transcript, summary, items and cards. You can't undo this.**, **Cancel** as the default on the right; **Delete** removes the call and the Library's **Calls** list shows
- Other — Several calls selected: ⌘⌫ on three selected rows shows **Delete 3 calls?** with **This removes their audio, transcripts, summaries, items and cards. You can't undo this.** and **Delete 3 Calls**

**Error Scenarios**:
- Error — Return pressed by habit: Return chooses **Cancel**; nothing is deleted
- The delete fails (`not_found`, `internal`): the page shows its section error; the call stays listed until the core reports it gone

**Steps**:
1. [x] - `p1` - User chooses **Delete Call…** on a call's page, or **Delete…** or ⌘⌫ with rows selected in Calls - `inst-user-delete`
2. [x] - `p1` - Algorithm: build the alert with `cpt-noter-algo-ui-dialogs-host-delete-alert` - `inst-build-alert`
3. [x] - `p1` - UI: request the native alert from the core's dialog plugin, attached to the main window as a sheet where the plugin allows; **Cancel** is the default (Return and Esc) - `inst-request-alert`
4. [x] - `p1` - **IF** the user chooses **Cancel** or presses Return or Esc - `inst-if-cancel`
   1. [x] - `p1` - **RETURN** nothing deleted; focus returns to the control that asked - `inst-return-cancel`
5. [x] - `p1` - API: `calls_delete` (the call ids) - `inst-api-delete`
6. [x] - `p1` - **IF** the result is an error - `inst-if-delete-error`
   1. [x] - `p1` - **RETURN** the calling page's section error, with **Try Again** when retryable - `inst-return-delete-error`
7. [x] - `p1` - UI: from a call's page, navigate to Library › **Calls**; in Calls, the rows leave the list as `entity:changed` reports them gone - `inst-after-delete`
8. [x] - `p1` - **RETURN** the calls deleted for good - `inst-return-deleted`

### Quit while recording

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-dialogs-host-quit`

**Actor**: Primary user

**Success Scenarios**:
- **Quit Noter** (menu bar or ⌘Q) while recording shows **Noter is recording “Planning: VHI 8.0 drawer redesign”** · **Quitting stops the recording. The transcript so far is kept.** · **Cancel** (default) · **Stop and Quit**; **Stop and Quit** saves and quits

**Error Scenarios**:
- Return chooses **Cancel**; the recording goes on

**Steps**:
1. [ ] - `p1` - User chooses **Quit Noter** or presses ⌘Q - `inst-user-quit`
2. [ ] - `p1` - **IF** nothing is recording - `inst-if-idle`
   1. [ ] - `p1` - **RETURN** Noter quits at once (the core) - `inst-return-quit`
3. [x] - `p1` - Core: shows the native alert with **Cancel** as the default; the UI supplies its strings from the catalogue - `inst-quit-alert`
4. [ ] - `p1` - **IF** the user chooses **Stop and Quit** - `inst-if-stop-quit`
   1. [ ] - `p1` - Core: stops and saves the recording, then quits - `inst-stop-quit`
5. [ ] - `p1` - **RETURN** the recording kept, or stopped and saved before Noter quits - `inst-return-quit-done`

### Confirm a discard in the call window

- [x] `p1` - **ID**: `cpt-noter-flow-ui-dialogs-host-inline-confirm`

**Actor**: Primary user

**Success Scenarios**:
- In the nothing-heard notice, **Discard Recording** turns into **Discard this recording? This can't be undone.** · **Discard** · **Back**; **Discard** deletes the recording and closes the window

**Error Scenarios**:
- **Back** returns to the notice's actions; nothing is deleted

**Steps**:
1. [x] - `p1` - User clicks **Discard Recording** in the capture notice - `inst-user-discard`
2. [x] - `p1` - UI: replace the notice's actions with the inline confirmation; focus moves to **Back**; no default button - `inst-inline`
3. [x] - `p1` - **IF** the user clicks **Discard** - `inst-if-discard`
   1. [x] - `p1` - API: `capture_discard` (through `cpt-noter-feature-ui-call-window`); the window closes and nothing is kept - `inst-api-discard`
4. [x] - `p1` - **ELSE** the actions come back - `inst-else-back`
5. [x] - `p1` - **RETURN** the decision - `inst-return-inline`

### Open a sheet or a popover

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-dialogs-host-sheet`

**Actor**: Primary user

**Success Scenarios**:
- A sheet slides from the toolbar edge (in place under Reduce motion), keeps focus inside, runs its primary button on Return and cancels on Esc
- A popover opens at its anchor, closes on Esc or a click outside, and returns focus to the anchor; inside the call window it stays within the panel

**Error Scenarios**:
- The sheet's command fails: the primary button leaves its busy state and the error shows under the first invalid field or as a sheet banner

**Steps**:
1. [x] - `p1` - User triggers an action whose label ends in an ellipsis, or a control that opens a popover - `inst-user-trigger`
2. [x] - `p1` - UI: the owning feature opens its registered sheet (480 to 640 pt) or popover (280 to 360 pt) in the host - `inst-open-host`
3. [ ] - `p1` - User fills it and presses the primary button - `inst-user-submit`
4. [x] - `p1` - UI: the primary button shows a spinner and keeps its label (**Sheet busy**); fields stay readable - `inst-busy`
5. [ ] - `p1` - **IF** the command fails with invalid input - `inst-if-invalid`
   1. [ ] - `p1` - UI: focus moves to the first invalid field with its message under it - `inst-invalid`
6. [ ] - `p1` - **RETURN** the sheet closed and the result shown where it applies - `inst-return-sheet`

## 3. Processes / Business Logic (CDSL)

### Build a delete alert

- [x] `p1` - **ID**: `cpt-noter-algo-ui-dialogs-host-delete-alert`

**Input**: the selected call ids and the first call's title

**Output**: the alert's title, message and buttons

**Steps**:
1. [x] - `p1` - **IF** one call - `inst-if-one`
   1. [x] - `p1` - Title **Delete “<title>”?**; message **This removes its audio, transcript, summary, items and cards. You can't undo this.**; buttons **Cancel** (default) and **Delete** (destructive) - `inst-one`
2. [x] - `p1` - **ELSE** - `inst-else-many`
   1. [x] - `p1` - Title **Delete N calls?** and button **Delete N Calls** through the plural rules; message **This removes their audio, transcripts, summaries, items and cards. You can't undo this.** - `inst-many`
3. [x] - `p1` - The title keeps the call's own script inside “…” - `inst-script`
4. [x] - `p1` - **RETURN** the alert - `inst-return-alert`

## 4. States (CDSL)

### Alert

- [x] `p1` - **ID**: `cpt-noter-state-ui-dialogs-host-alert`

**States**: CLOSED, ASKED, CONFIRMED, CANCELLED

**Initial State**: CLOSED

**Transitions**:
1. [x] - `p1` - **FROM** CLOSED **TO** ASKED **WHEN** an irreversible action is chosen (Delete asked, Several calls selected, Quit while recording) - `inst-closed-asked`
2. [x] - `p1` - **FROM** ASKED **TO** CANCELLED **WHEN** the user chooses **Cancel**, presses Return (Return pressed by habit) or Esc - `inst-asked-cancelled`
3. [x] - `p1` - **FROM** ASKED **TO** CONFIRMED **WHEN** the user chooses the destructive button (Call deleted) - `inst-asked-confirmed`
4. [x] - `p1` - **FROM** CONFIRMED **TO** CLOSED **WHEN** the core reports the result - `inst-confirmed-closed`
5. [x] - `p1` - **FROM** CANCELLED **TO** CLOSED **WHEN** focus returns to the opener - `inst-cancelled-closed`

### Sheet

- [ ] `p1` - **ID**: `cpt-noter-state-ui-dialogs-host-sheet`

**States**: OPEN, BUSY, INVALID, CLOSED

**Initial State**: CLOSED

**Transitions**:
1. [x] - `p1` - **FROM** CLOSED **TO** OPEN **WHEN** a feature opens a registered sheet - `inst-closed-open`
2. [ ] - `p1` - **FROM** OPEN **TO** BUSY **WHEN** the primary button runs its command - `inst-open-busy`
3. [ ] - `p1` - **FROM** BUSY **TO** INVALID **WHEN** the command fails with invalid input - `inst-busy-invalid`
4. [ ] - `p1` - **FROM** INVALID **TO** BUSY **WHEN** the user submits again - `inst-invalid-busy`
5. [ ] - `p1` - **FROM** BUSY **TO** CLOSED **WHEN** the command succeeds - `inst-busy-closed`
6. [x] - `p1` - **FROM** OPEN **TO** CLOSED **WHEN** the user cancels - `inst-open-closed`

## 5. Definitions of Done

### Alert, sheet and popover hosts

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-dialogs-host-hosts`

The system **MUST** provide the sheet host and the popover host with the prototype's markup (`np-sheet` with `data-primitive="sheet"`, `np-pop` with `data-primitive="popover"`), focus trapping and return, Reduce-motion behaviour, and a request path for native alerts through the core's dialog plugin that keeps the safe button as the default unless the alert's entry says otherwise.

**Implements**:
- `cpt-noter-flow-ui-dialogs-host-sheet`
- `cpt-noter-state-ui-dialogs-host-sheet`

**Constraints**: `cpt-noter-constraint-tauri-webview`, `cpt-noter-constraint-non-activating-panels`

**Touches**:
- Code: `apps/desktop/src/ui/dialogs/*`
- Tests: unit tests for focus trap and return; screenshot specs of a sheet and a popover in light, dark and Increase Contrast

### Delete and quit alerts

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-dialogs-host-delete`

The system **MUST** ask before deleting one or several calls with the prototype's titles, messages and buttons, delete through `calls_delete` only after the destructive button, return to Library › **Calls** after deleting from a call's page, and supply the quit-while-recording alert's strings.

**Implements**:
- `cpt-noter-flow-ui-dialogs-host-delete-call`
- `cpt-noter-flow-ui-dialogs-host-quit`
- `cpt-noter-algo-ui-dialogs-host-delete-alert`
- `cpt-noter-state-ui-dialogs-host-alert`

**Constraints**: `cpt-noter-constraint-no-dialog-after-setup`

**Touches**:
- Commands: `calls_delete`
- Tests: E2E `cpt-noter-seq-dialogs-delete-call` (Happy path, Error — Return pressed by habit, Other — Several calls selected) against `noter-core-harness`; XCUITest `test_cpt_noter_seq_menu_bar_control_recording__quit_while_recording` for the native quit alert

### Inline confirmation in the call window

- [x] `p2` - **ID**: `cpt-noter-dod-ui-dialogs-host-inline`

The system **MUST** confirm discarding a recording inline in the capture notice, never with an alert or sheet in the call window, with focus on **Back** and no default button.

**Implements**:
- `cpt-noter-flow-ui-dialogs-host-inline-confirm`

**Constraints**: `cpt-noter-constraint-non-activating-panels`

**Touches**:
- Commands: `capture_discard`
- Tests: E2E `cpt-noter-seq-call-screen-recover-capture` (Empty — Nothing heard yet)

## 6. Acceptance Criteria

- [ ] Every irreversible action in M1 asks first, and Return never confirms a delete
- [x] No alert or sheet ever appears in the call window
- [x] Deleting from a call's page lands on Library › **Calls** without the call
- [x] Sheets keep focus inside until they close and return it to the opener
- [x] Plural titles and buttons follow the plural rules (**Delete 3 calls?**, **Delete 3 Calls**)

## 7. Additional Context

**Prototype reuse.** Rewritten in React with the same structure and data attributes: `S.windowOverlays` (the sheet layer with `data-primitive="sheet"` and its `data-state` `open` or `busy`, the alert layer with `data-component="cpt-noter-component-screen-dialogs"` and `data-variant="alert"`) and `S.floatingLayer` (popovers and menus anchored by position) from `src/js/05-shell.js`; the delete flows `dlg.deleteCall` (`src/js/30-c-dialogs.js`) and `lib.deleteAsk` (`src/js/40-d-3-library.js`); the inline confirm inside `C.captureNotice` (`src/js/20-b-components.js`). Styles `.np-sheet`, `.np-pop`, `.dlg-*` are ported as-is. Source of truth only: the HTML-drawn alert (`.np-alert`), because the product's alerts are native; its left-aligned layout and button order are what macOS 27 draws. Not reusable: `NP.galleries.dialogs` and **Dialogs ▾** (prototype gallery).

**States coverage (M1 rows of DESIGN's Dialogs States table).** Delete asked → `al-del-call`; Return pressed by habit → the same alert with **Cancel** as primary; Several calls selected → `al-del-3` and Library › State ▾ › Several calls selected; Quit while recording → `al-quit`; Sheet busy → `data-state="busy"`; Inline discard asked → Call window › State ▾ › Nothing heard yet, then **Discard Recording**; Old audio deleted → `sh-old-audio` (its deletion is M2); Call deleted → `dlg.deleteCallGo` (back to Calls). The other rows belong to the features that own those sheets.

**DESIGN versus prototype.** DESIGN's Library entry words the delete alert differently (**Their audio, transcripts, summaries and items are deleted from this Mac. This can't be undone.** with **Delete** and **Cancel**); this feature uses the prototype's wording, which matches DESIGN's Dialogs entry (listed in `docs/DECOMPOSITION.md`).

**Milestone notes.** The happy path of `cpt-noter-seq-dialogs-delete-call` starts on a call's page, which `cpt-noter-feature-ui-call-page-frame` ships in M1 (discrepancy 1). The **Delete Old Audio…** sheet opens in M1; `audio_delete_older` is M2 (discrepancy 5).

**Not applicable.** Undo for deletes: deletes are final in v1 (PM-22). Data: the UI deletes nothing itself.
