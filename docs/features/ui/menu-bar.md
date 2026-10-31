---
title: "Feature — Menu bar extra"
description: "Noter's native status item and menu: four monochrome glyphs with a hidden form, info lines in words, capture and surface actions with their hotkeys that take effect within a second and open no dialog after setup."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-menu-bar
milestone: M1
---

# Feature: Menu bar extra


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Pause, mark and stop from the menu](#pause-mark-and-stop-from-the-menu)
  - [Check what Noter is doing](#check-what-noter-is-doing)
  - [Start a call from the menu](#start-a-call-from-the-menu)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Choose the glyph and title](#choose-the-glyph-and-title)
  - [Build the menu](#build-the-menu)
- [4. States (CDSL)](#4-states-cdsl)
  - [Status item](#status-item)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Menu content model and glyphs](#menu-content-model-and-glyphs)
  - [Native tests of every item](#native-tests-of-every-item)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [x] `p2` - **ID**: `cpt-noter-featstatus-ui-menu-bar`

## 1. Feature Context

- [x] `p2` - `cpt-noter-feature-ui-menu-bar`

### 1.1 Overview

The menu bar extra is a native status item and menu that macOS draws; the core builds it from the capture, setup, detection, presenting and degraded state and updates it while it is open. This feature defines its content per state — glyph, optional title, info lines MB-R2, the capture, copilot, surface, next-call and app groups MB-R3 to MB-R7 — the template glyph images, and the native tests. It is the one place to check whether Noter records when no other surface is visible, and while Noter is hidden for presenting it is the only visible trace.

**Native parts.** The status item, menu, glyph images and the quit alert are built in the Tauri host (`apps/desktop/src-tauri`, core lane) through the tray, menu and dialog plugins. The UI lane owns this content model, the glyph assets and the XCUITest suite in `apps/desktop/tests/native`. No WebView is involved.

### 1.2 Purpose

It implements `cpt-noter-component-screen-menu-bar` and `cpt-noter-component-ui-status-item`.

**Requirements**: PRD › Live copilot › Surfaces › Menu bar (every quick action takes effect within a second and never opens a dialog after setup). The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-privacy-visible`, `cpt-noter-principle-keyboard-first`, `cpt-noter-principle-never-steal-focus`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Opens the menu with a click, ⌃F8 or VO-M M; starts, pauses, marks, stops, continues, hides and opens windows |
| Noter core (system) | Builds and updates the menu, runs each item as `Caller::Native` through the same commands as the hotkeys, shows the quit alert |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Live copilot › Surfaces › Menu bar
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Screen — Menu bar extra; Component — Status item; 1.2 NFR Allocation (menu bar row)
- **Design elements**: `cpt-noter-component-screen-menu-bar`, `cpt-noter-component-ui-status-item`; its info line uses the text form of `cpt-noter-component-ui-mode-indicator`
- **Stories**: `cpt-noter-seq-menu-bar-control-recording`, `cpt-noter-seq-menu-bar-check-state` (M1); the menu bar steps of `cpt-noter-seq-record-prompt-record-after-missed-prompt`, `cpt-noter-seq-call-screen-stop-at-call-end` (Error — Hidden for presenting) and `cpt-noter-seq-call-screen-hide-for-presenting`
- **Commands the core runs for its items** (`Caller::Native`): `capture_start`, `capture_stop`, `capture_set_paused`, `capture_mark_moment`, `capture_continue`, `capture_answer_call_end`, `capture_answer_new_meeting`, `window_show_call`, `window_set_call_layout`, `app_set_hidden_for_presenting`, `window_navigate`
- **Prototype modules**: `src/js/10-a-surfaces.js` (`surface('menubar')`, `mbMenu`, `MB_STATES`, `mb.*` actions), `src/js/10-a-components.js` (`C.statusItem`, `C.statusGlyph`, `GLYPH`, `EYE`) — source of truth only
- **Dependencies**: `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-dialogs-host`

## 2. Actor Flows (CDSL)

### Pause, mark and stop from the menu

- [x] `p1` - **ID**: `cpt-noter-flow-ui-menu-bar-control-recording`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-menu-bar-control-recording`: **Recording · Planning: VHI 8.0 drawer redesign · 23:14**; **Mark Moment** closes the menu; **Pause** changes the glyph to its paused form; **Resume**; **Stop Recording**; for 5 minutes the menu shows **Saved · 48 min · Summary in about 2 minutes** with **Continue Recording**

**Error Scenarios**:
- Error — Paused for 5 minutes: **Paused for 5 min** at the top; **Resume** continues with a gap
- Error — Quit while recording: the quit alert with **Cancel** as the default and **Stop and Quit**

**Steps**:
1. [x] - `p1` - User clicks the status item, or presses ⌃F8 and moves to it - `inst-user-open`
2. [x] - `p1` - Core: builds the menu with `cpt-noter-algo-ui-menu-bar-build-menu` and updates its info lines while it is open - `inst-build`
3. [x] - `p1` - User chooses **Mark Moment**, **Pause**, **Resume**, **Stop Recording**, **Continue Recording** or **Quit Noter** - `inst-user-item`
4. [x] - `p1` - **MATCH** the item - `inst-match-item`
   - [x] - `p1` - **CASE** **Mark Moment**: `capture_mark_moment`; nothing opens - `inst-case-mark`
   - [x] - `p1` - **CASE** **Pause** or **Resume**: `capture_set_paused` (wanted state); the glyph changes - `inst-case-pause`
   - [x] - `p1` - **CASE** **Stop Recording**: `capture_stop`; the closing line and **Continue Recording** show for 5 minutes - `inst-case-stop`
   - [x] - `p1` - **CASE** **Continue Recording**: `capture_continue` within `continue_until` - `inst-case-continue`
   - [x] - `p1` - **CASE** **Quit Noter** while recording: the quit alert of `cpt-noter-feature-ui-dialogs-host` - `inst-case-quit`
5. [x] - `p1` - **RETURN** the action applied within a second, with no dialog except the quit alert - `inst-return-control`

### Check what Noter is doing

- [x] `p1` - **ID**: `cpt-noter-flow-ui-menu-bar-check-state`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-menu-bar-check-state`: the recording glyph; **Recording · Planning: VHI 8.0 drawer redesign · 23:14** and **4 speakers · EN / RU · Cloud, redacted**; each action with its hotkey
- Empty — Not recording: the idle glyph, **Noter — Not recording**, **Start Recording** ⌃⌥⌘R and **Next: Stand-up 11:00**
- Other — New meeting while hidden: **A new meeting may have started: 1:1 with Anna K.** with **Start as New Call** and **Keep in This Call**; 60 s without an answer applies **Start as New Call**

**Error Scenarios**:
- Error — Switched to local: **Switched to local** under the call's lines
- Error — Setup incomplete: **Setup incomplete · call detection off** with the **Finish Setup…** link above **Start Recording**, which works as always

**Steps**:
1. [x] - `p1` - User looks at the glyph and opens the menu - `inst-user-check`
2. [x] - `p1` - Core: shows the glyph and title by `cpt-noter-algo-ui-menu-bar-glyph` and the info lines by `cpt-noter-algo-ui-menu-bar-build-menu` - `inst-core-show`
3. [x] - `p1` - **IF** the user chooses **Finish Setup…** - `inst-if-finish`
   1. [x] - `p1` - Core: `window_navigate` to the first-run window at the step where setup stopped - `inst-finish-setup`
4. [x] - `p1` - **IF** the user answers the new-meeting lines - `inst-if-new-meeting`
   1. [x] - `p1` - Core: `capture_answer_new_meeting` - `inst-new-meeting`
5. [x] - `p1` - **RETURN** the state in words, in one click - `inst-return-check`

### Start a call from the menu

- [x] `p1` - **ID**: `cpt-noter-flow-ui-menu-bar-start`

**Actor**: Primary user

**Success Scenarios**:
- **Start Recording** or **Call Detected · Start Recording** starts capture whatever the setup state and opens the call window (unless hidden for presenting, where nothing is drawn)
- **Open Call Screen** (⌃⌥⌘N) shows the call window without making it key; **Use Floating Panel** switches the layout; **Open Last Summary — Design review · 09:30** and **Open Noter** open the main window; **Settings…** opens Settings; **Hide for Presenting** and **Show Noter** toggle hidden mode

**Error Scenarios**:
- Below 500 MB free or while the speech model downloads: **Start Recording** is dimmed
- Not recording · engine stopped: **Try Again** in MB-R3 starts capture again in the same call

**Steps**:
1. [x] - `p1` - User chooses a start or surface item - `inst-user-start`
2. [x] - `p1` - **MATCH** the item - `inst-match-start`
   - [x] - `p1` - **CASE** **Start Recording**, **Call Detected · Start Recording**: `capture_start` - `inst-case-start`
   - [x] - `p1` - **CASE** **Try Again**: `capture_resume_interrupted` (the same call, a gap row `engine_restart`) - `inst-case-try-again`
   - [x] - `p1` - **CASE** **Open Call Screen**: `window_show_call` (not key); ends hidden mode - `inst-case-open-call`
   - [x] - `p1` - **CASE** **Use Floating Panel**: `window_set_call_layout` - `inst-case-floating`
   - [x] - `p1` - **CASE** **Hide for Presenting** or **Show Noter**: `app_set_hidden_for_presenting` - `inst-case-hide`
   - [x] - `p1` - **CASE** **Open Last Summary**, **Open Noter**, **Settings…**: `window_navigate` - `inst-case-navigate`
3. [x] - `p1` - **RETURN** the action applied within a second - `inst-return-start`

## 3. Processes / Business Logic (CDSL)

### Choose the glyph and title

- [x] `p1` - **ID**: `cpt-noter-algo-ui-menu-bar-glyph`

**Input**: capture phase, copilot mute (M4), presenting state, **Menu bar title** setting, elapsed time

**Output**: the template glyph, its hidden form and the title

**Steps**:
1. [x] - `p1` - **MATCH** the state - `inst-match-glyph`
   - [x] - `p1` - **CASE** copilot muted while recording (M4): the muted glyph (the page with a slash) - `inst-case-muted`
   - [x] - `p1` - **CASE** paused: the paused glyph (the page with two bars) - `inst-case-paused`
   - [x] - `p1` - **CASE** recording: the recording glyph (the filled page with a hollow dot) - `inst-case-recording`
   - [x] - `p1` - **DEFAULT**: the idle glyph (the outlined page with three lines), also for **Not recording · engine stopped** - `inst-case-idle`
2. [x] - `p1` - **IF** hidden for presenting: add the eye-slash badge and clear the title - `inst-hidden-badge`
3. [x] - `p1` - **ELSE** show the title the setting asks for, which is no title by default, the running clock for **Elapsed Time**, or from M4 the newest card's type and first words for **Newest Card**, at most 24 characters; it never animates - `inst-title`
4. [x] - `p1` - VoiceOver label: "Noter, recording, 23 minutes", adding "hidden for presenting" when hidden - `inst-vo-label`
5. [x] - `p1` - **RETURN** glyph and title; colour is never used - `inst-return-glyph`

### Build the menu

- [x] `p1` - **ID**: `cpt-noter-algo-ui-menu-bar-build-menu`

**Input**: capture state with notice and `continue_until`, detection, setup status, presenting state, degraded set, privacy mode, call people and languages, last summary, next calendar event, hotkey registrations

**Output**: the ordered menu items MB-R2 to MB-R7

**Steps**:
1. [x] - `p1` - MB-R2 first line by state: **Noter — Not recording**; **Recording · <title> · 23:14** then **4 speakers · EN / RU · Cloud, redacted**; **Paused for 5 min** after five minutes paused; **Call seems to have ended · stopping in 8 s** (no countdown while hidden); **A new meeting may have started: <title>** while hidden; the closing line for 5 minutes after any stop - `inst-mbr2-first`
2. [x] - `p1` - Add one degraded line when it applies: **Switched to local**, **System audio silent**, **Microphone off** (announced assertively when no surface is visible), **Not recording · engine stopped**; while hidden and recording, **Hidden for presenting** - `inst-mbr2-degraded`
3. [x] - `p1` - **IF** setup is incomplete: **Setup incomplete · call detection off** and the **Finish Setup…** link; never in place of **Start Recording** - `inst-mbr2-setup`
4. [x] - `p1` - **IF** a call is detected and not recorded (visible or hidden for presenting): **Call Detected · Start Recording** as the one enabled item in MB-R2; never while a capture runs (HoD decision D-1, see 7) - `inst-mbr2-detected`
5. [x] - `p1` - MB-R3: **Keep Recording** and **Stop Now** while the call-ended notice is open; **Start as New Call** and **Keep in This Call** for a new meeting while hidden; **Start Recording** or **Stop Recording** ⌃⌥⌘R (dimmed only below 500 MB or without the speech model); **Try Again** while capture failed; **Pause** or **Resume** ⌃⌥⌘P; **Continue Recording** for 5 minutes after any stop - `inst-mbr3`
6. [x] - `p1` - MB-R4 while recording: **Mark Moment** ⌃⌥⌘M; with the copilot on (M4) also **Catch Me Up**, **Ask About This Call…**, **Unmute** while muted and **Mute Copilot ▸** - `inst-mbr4`
7. [x] - `p1` - MB-R5: **Open Call Screen** ⌃⌥⌘N, **Use Floating Panel** (checkmark), **Open Last Summary — <title> · <time>**, **Hide for Presenting** or **Show Noter** ⌃⌥⌘0 - `inst-mbr5`
8. [x] - `p1` - MB-R7: **Open Noter**, **Settings…** ⌘,, **Quit Noter** ⌘Q - `inst-mbr6-7`
MB-R6, the disabled **Next: <event> <time>** line, needs the upcoming calendar call that `cpt-noter-feature-ui-today` reads (M2): `cpt-noter-flow-ui-today-review` step `inst-menu-next` (owner decision A, 28 Oct 2026). No M1 surface reads the calendar for display.
9. [x] - `p1` - An item whose hotkey did not register shows no key - `inst-no-key`
10. [x] - `p1` - **RETURN** the items, in title case, with plural rules for counts - `inst-return-menu`

## 4. States (CDSL)

### Status item

- [x] `p1` - **ID**: `cpt-noter-state-ui-menu-bar-status-item`

**States**: IDLE, CALL_DETECTED, RECORDING, PAUSED, CALL_ENDED_NOTICE, CLOSING, ENGINE_STOPPED, HIDDEN

**Initial State**: IDLE

**Transitions**:
1. [x] - `p1` - **FROM** IDLE **TO** CALL_DETECTED **WHEN** a call is detected and not recorded (prompt missed, closed or suppressed) - `inst-idle-detected`
2. [x] - `p1` - **FROM** CALL_DETECTED **TO** RECORDING **WHEN** the user chooses **Call Detected · Start Recording** - `inst-detected-recording`
3. [x] - `p1` - **FROM** IDLE **TO** RECORDING **WHEN** capture starts from any surface - `inst-idle-recording`
4. [x] - `p1` - **FROM** RECORDING **TO** PAUSED **WHEN** the user pauses - `inst-recording-paused`
5. [x] - `p1` - **FROM** PAUSED **TO** RECORDING **WHEN** the user resumes - `inst-paused-recording`
6. [x] - `p1` - **FROM** RECORDING **TO** CALL_ENDED_NOTICE **WHEN** the call seems to have ended - `inst-recording-ended`
7. [x] - `p1` - **FROM** CALL_ENDED_NOTICE **TO** RECORDING **WHEN** the user keeps recording - `inst-ended-recording`
8. [x] - `p1` - **FROM** CALL_ENDED_NOTICE **TO** CLOSING **WHEN** the user stops or the countdown ends - `inst-ended-closing`
9. [x] - `p1` - **FROM** RECORDING **TO** CLOSING **WHEN** the user stops - `inst-recording-closing`
10. [x] - `p1` - **FROM** CLOSING **TO** RECORDING **WHEN** the user continues within 5 minutes - `inst-closing-recording`
11. [x] - `p1` - **FROM** CLOSING **TO** IDLE **WHEN** 5 minutes pass - `inst-closing-idle`
12. [x] - `p1` - **FROM** RECORDING **TO** ENGINE_STOPPED **WHEN** the engine stops and cannot restart - `inst-recording-engine`
13. [x] - `p1` - **FROM** ENGINE_STOPPED **TO** RECORDING **WHEN** **Try Again** succeeds - `inst-engine-recording`
14. [x] - `p1` - **FROM** RECORDING **TO** HIDDEN **WHEN** Noter hides for presenting (the glyph gains the eye-slash; recording goes on) - `inst-recording-hidden`
15. [x] - `p1` - **FROM** HIDDEN **TO** RECORDING **WHEN** the user chooses **Show Noter** or presses ⌃⌥⌘0 - `inst-hidden-recording`

## 5. Definitions of Done

### Menu content model and glyphs

- [x] `p2` - **ID**: `cpt-noter-dod-ui-menu-bar-content`

The system **MUST** provide the menu bar's content per state as listed in this feature (info lines, groups, item labels in title case, hotkeys), the four template glyphs with their hidden forms as monochrome template images, and the strings for the quit alert, for the core to build the native status item and menu.

**Implements**:
- `cpt-noter-algo-ui-menu-bar-glyph`
- `cpt-noter-algo-ui-menu-bar-build-menu`
- `cpt-noter-state-ui-menu-bar-status-item`

**Constraints**: `cpt-noter-constraint-menu-bar-template-icons`, `cpt-noter-constraint-no-dialog-after-setup`

**Touches**:
- Code: glyph assets under `apps/desktop/src-tauri/icons/tray/` (from `GLYPH` and `EYE` in `src/js/10-a-components.js`); the menu model in the Tauri host (core lane)
- Tests: XCUITest per state in `apps/desktop/tests/native`

### Native tests of every item

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-menu-bar-native-tests`

The system **MUST** have XCUITest cases for every menu item and every glyph, named after the stories they prove (`test_cpt_noter_seq_menu_bar_control_recording__pause_and_resume`, `test_cpt_noter_seq_menu_bar_check_state__setup_incomplete`), that check each action takes effect within a second and opens no window except **Open Noter**, **Open Call Screen**, **Open Last Summary**, **Finish Setup…** and **Settings…**.

**Implements**:
- `cpt-noter-flow-ui-menu-bar-control-recording`
- `cpt-noter-flow-ui-menu-bar-check-state`
- `cpt-noter-flow-ui-menu-bar-start`

**Constraints**: `cpt-noter-constraint-no-dialog-after-setup`

**Touches**:
- Tests: `apps/desktop/tests/native/NoterNativeUITests/MenuBarTests.swift`; the app's command log counts toward the E2E bar (`just native`)

## 6. Acceptance Criteria

- [ ] Every `MB_STATES` entry of the prototype has a matching native menu, checked by XCUITest
- [ ] No menu item opens a dialog after setup except the quit alert while recording
- [x] **Start Recording** never reads **Finish Setup…** and works in every setup state
- [x] The glyphs are template images and change shape, never colour

## 7. Additional Context

**Prototype reuse.** Source of truth only: macOS draws the real status item and menu, so `surface('menubar')`, `mbMenu` and `MB_STATES` (`src/js/10-a-surfaces.js`) and `C.statusItem` (`src/js/10-a-components.js`) define the content and states but are not ported. The SVG paths of `C.statusGlyph` (`GLYPH`, `EYE`) are reused as the source of the template images. The `.mb-*` styles are not ported.

**States coverage.**

| DESIGN state | Prototype `MB_STATES` |
| --- | --- |
| Idle | `idle` |
| Recording | `recording` |
| Paused for 5 minutes | `paused-5` |
| Quit while recording | **Quit Noter** while recording (alert) |
| Switched to local | `switched-local` |
| Setup incomplete | `setup-incomplete` |
| Audio access not granted yet | `audio-not-granted` |
| Copilot muted, Card keys released while muted | `muted` (M4, `cpt-noter-feature-ui-copilot`) |
| Call detected, not recorded | `call-detected` |
| Call seems to have ended | `call-ended` |
| Hidden for presenting | `hidden`, without its **Call Detected · Start Recording** item (D-1) |
| Call ended while hidden | `hidden-ended` |
| New meeting while hidden | `hidden-new-meeting` |
| Capture problem, no surface visible | `capture-problem` |
| Not recording · engine stopped | `engine-stopped` |
| Hotkey not registered | `no-hotkey` |
| — | `closing` (After a stop, **Continue Recording**) |

**DESIGN versus prototype.** (1) The prototype's `closing` state (the 5 minutes after any stop) has no row in DESIGN's menu-bar States table; this feature includes it. (2) While hidden for presenting and recording, the prototype also lists **Call Detected · Start Recording**, which DESIGN offers only while not recording; HoD decision D-1 (18 Oct 2026) follows DESIGN, because the core rejects a second capture (`already_recording`): hidden and recording, MB-R2 shows **Hidden for presenting** and the capture group offers Stop and Pause as when visible. (3) DESIGN's line **Stopped at 11:12 · the call had ended** after 10 minutes hidden is not drawn by the prototype; this feature keeps **Call seems to have ended** until the core reports the stop. All three are listed in `docs/DECOMPOSITION.md`.

**Milestone notes.** Owner decision A (28 Oct 2026): the MB-R6 **Next:** line of `inst-mbr6-7` moved to `cpt-noter-feature-ui-today` (M2, `inst-menu-next`), which brings the upcoming calendar call; the step keeps MB-R7. **Open Last Summary** (M2) and the copilot items and muted glyph (M4) stay in their rows as D-39 says: absent or behind the flag in M1. The XCUITest rows (`cpt-noter-dod-ui-menu-bar-native-tests`, the two native acceptance criteria) are proven by the native suite.

**Not applicable.** WebView rendering, screenshots: none (native). Data: the core builds the menu from its own state.
