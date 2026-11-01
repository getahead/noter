---
title: "Feature — Record prompt"
description: "The small non-activating Record this call? panel: one click or ⌃⌥⌘R starts capture while the call app keeps focus, with Record as Sensitive, Don't Ask for an app, the disk and model reasons, and the call-ended and new-meeting notices while the call window is hidden."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-record-prompt
milestone: M1
---

# Feature: Record prompt


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Start recording a detected call](#start-recording-a-detected-call)
  - [Let the prompt go and record later](#let-the-prompt-go-and-record-later)
  - [Answer a notice while the call window is hidden](#answer-a-notice-while-the-call-window-is-hidden)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Choose the prompt variant](#choose-the-prompt-variant)
- [4. States (CDSL)](#4-states-cdsl)
  - [Record prompt panel](#record-prompt-panel)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Record prompt panel and variants](#record-prompt-panel-and-variants)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [x] `p2` - **ID**: `cpt-noter-featstatus-ui-record-prompt`

## 1. Feature Context

- [x] `p2` - `cpt-noter-feature-ui-record-prompt`

### 1.1 Overview

When the core detects a call (an app opens the microphone, or a calendar event matches), it shows the record prompt at the top right of the main display without making Noter active. **Record** or ⌃⌥⌘R starts capture at once and opens the call window; **Record as Sensitive** starts it with nothing leaving the Mac; **Not Now**, × or 15 s without an answer close it, and the menu bar keeps **Call Detected · Start Recording** for the rest of the call. The same panel carries the call-ended and new-meeting notices while the call window is hidden.

### 1.2 Purpose

It implements `cpt-noter-component-screen-record-prompt` and `cpt-noter-component-ui-record-prompt`.

**Requirements**: PRD › Feature specification › 1. Capture; PRD › Live copilot › Surfaces; PRD › Live copilot loop › Degraded states. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-never-steal-focus`, `cpt-noter-principle-privacy-visible`

Success criteria: a detected call is recorded with one click or one key while the call app keeps keyboard focus; **Record** is refused only below 500 MB free or while the speech model downloads (PM-60).

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Records, records as sensitive, lets the prompt go, or stops being asked for an app |
| Noter core (system) | Detects calls, places and shows the panel, registers ⌃⌥⌘R, starts capture, decides call end and new meetings, posts native announcements |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 1. Capture
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Screen — Record prompt; Component — Record prompt; 3.8 Deployment Topology (record prompt row)
- **Design elements**: `cpt-noter-component-screen-record-prompt`, `cpt-noter-component-ui-record-prompt`
- **Stories**: `cpt-noter-seq-record-prompt-start-recording`, `cpt-noter-seq-record-prompt-record-after-missed-prompt` (M1); it also shows the variants of `cpt-noter-seq-call-screen-stop-at-call-end` (Error — Call window hidden; Error — Next meeting starts straight away), owned by `cpt-noter-feature-ui-call-window`
- **Frozen commands it calls**: `capture_start` (with `sensitive`), `capture_dismiss_detection`, `capture_ignore_app`, `capture_answer_call_end`, `capture_hold_notice`, `capture_answer_new_meeting`, `window_announce`, `window_fit`, `window_navigate` (the **Delete Old Audio…** sheet in the main window), `open_external` (**Open System Settings…**)
- **Events**: `capture:detected`, `capture:state`, `env:changed` (disk), `setup:changed` (speech model)
- **Prototype modules**: `src/js/10-a-components.js` (`C.recordPrompt`), `src/js/10-a-surfaces.js` (`surface('record')`, `RP_STATES`, the `rp.*` actions), `src/css/10-a.css` (`.rp-*`), `src/css/01-macos27.css` (panel material)
- **Dependencies**: `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-primitives`, `cpt-noter-feature-ui-call-window`

## 2. Actor Flows (CDSL)

### Start recording a detected call

- [x] `p1` - **ID**: `cpt-noter-flow-ui-record-prompt-start-recording`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-record-prompt-start-recording`: **Record this call?** with **Microsoft Teams is using the microphone** (or the event's title and platform), **Record** or ⌃⌥⌘R, the call screen opens with **Recording · 00:12** while Teams keeps focus
- Other — Vendor call recorded as sensitive: **Record as Sensitive**, the call window shows **Sensitive · local**
- Other — Not a call: **Not Now ▾** › **Don't Ask for Safari…**, the inline line **Calls in Safari, such as Google Meet, won't be offered for recording either.** with **Back** and **Don't Ask**; for a meeting app **Microsoft Teams won't be offered for recording again.**

**Error Scenarios**:
- Error — Not enough disk space: **Not enough disk space to record (420 MB free)**, **Record** dimmed, **Delete Old Audio…** opens the sheet in the main window
- Error — System audio access is off: the warning **System audio access is off · only your side will be recorded** above **Not Now**, **Open System Settings…** and **Record**, which still starts capture
- Speech model not downloaded: **The speech model is still downloading (62 %)**, **Record** dimmed (prototype state; see 7)

**Steps**:
1. [x] - `p1` - Core: detects a call and shows the panel at its position (top right; 72 pt lower under the meeting toolbar; the display without the call app when there are two), with `capture:detected` and `app_snapshot.detection` - `inst-core-detect`
   The 72 pt offset under a meeting toolbar is not part of the core placement algorithm (`cpt-noter-algo-core-native-surfaces-placement`); recorded as a DESIGN discrepancy for the HoD (28 Oct), not held here.
2. [x] - `p1` - Algorithm: choose the variant with `cpt-noter-algo-ui-record-prompt-variant` - `inst-choose-variant`
3. [x] - `p1` - UI: render RP-R1 (app icon, **Record this call?**, the source line, ×) and RP-R3 for the variant; the panel never takes focus - `inst-render`
   1. [x] - `p1` - API: `window_fit` with the panel's size in whole points each time it changes: the core fits the panel window to it (360 to 440 pt wide), so every button lies inside the panel - `inst-api-fit`
4. [x] - `p1` - API: `window_announce` "Noter: Record this call? Press Control-Option-Command-R to record." (polite) - `inst-api-announce`
5. [x] - `p1` - User clicks **Record** or **Record as Sensitive**, or presses ⌃⌥⌘R (the core receives the hotkey) - `inst-user-record`
6. [x] - `p1` - API: `capture_start` (detection, `sensitive` true for **Record as Sensitive**); the button shows loading - `inst-api-start`
7. [x] - `p1` - **IF** the result is `disk_full` or `model_missing` - `inst-if-refused`
   1. [x] - `p1` - UI: switch to the Disk full or Speech model variant with its reason - `inst-refused`
8. [x] - `p1` - **IF** the result is `already_recording` - `inst-if-already`
   1. [x] - `p1` - UI: close the prompt; the core shows the running call - `inst-already`
9. [x] - `p1` - UI: the panel fades out over 200 ms (in place under Reduce motion); the core opens the call window in the dedicated layout with a second display or the floating layout otherwise; API: `window_announce` "Recording started" - `inst-close-open`
10. [x] - `p1` - **IF** the user opens **Not Now ▾** and chooses **Don't Ask for <app>…** - `inst-if-dont-ask`
    1. [x] - `p1` - UI: replace RP-R3 with the inline confirmation for the app, or the browser line for a browser; **Back** returns - `inst-inline-confirm`
    2. [x] - `p1` - User clicks **Don't Ask**; API: `capture_ignore_app` (bundle id); the app is listed in Settings › General › **Apps Noter doesn't ask about** - `inst-api-ignore`
11. [x] - `p1` - **IF** the user clicks **Delete Old Audio…** - `inst-if-delete-old`
    1. [x] - `p1` - API: `window_navigate` to the main window with the **Delete Old Audio…** sheet (`cpt-noter-feature-ui-dialogs-host`); after the sheet, the menu bar's **Call Detected · Start Recording** starts the call - `inst-delete-old`
12. [x] - `p1` - **IF** the user clicks **Open System Settings…** - `inst-if-open-settings`
    1. [x] - `p1` - API: `open_external` (the System Audio Recording pane); macOS may then ask to quit and reopen Noter (**Later**, **Quit & Reopen**), a prompt that is macOS's own - `inst-open-settings`
13. [x] - `p1` - **RETURN** capture running with the call window open, or the prompt in its refusal or confirmation state - `inst-return-start`

### Let the prompt go and record later

- [x] `p1` - **ID**: `cpt-noter-flow-ui-record-prompt-missed-prompt`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-record-prompt-record-after-missed-prompt`: **Not Now**, then ⌃⌥⌘R minutes later opens the call screen
- Empty — Prompt closed unanswered: after 15 s the prompt fades; the menu bar offers **Call Detected · Start Recording** for as long as the call runs; no second prompt for this call

**Error Scenarios**:
- Error — Setup incomplete, Error — Audio access not granted yet, Empty — Hidden for presenting: no prompt appears; the menu bar paths (`cpt-noter-feature-ui-menu-bar`) start capture

**Steps**:
1. [x] - `p1` - User clicks **Not Now** or ×, or leaves the prompt for 15 s - `inst-user-dismiss`
2. [x] - `p1` - **WHILE** the pointer or keyboard focus is on the panel - `inst-while-hover`
   1. [x] - `p1` - UI: the 15-second timer pauses (no visible countdown) - `inst-pause-timer`
3. [x] - `p1` - API: `capture_dismiss_detection` (reason: not now, close or timeout); the core closes the prompt but keeps the detection, so the menu bar keeps **Call Detected · Start Recording** while the call runs - `inst-api-dismiss`
4. [x] - `p1` - UI: the panel fades out in 200 ms - `inst-fade`
5. [x] - `p1` - **RETURN** no prompt for this call; the menu bar and ⌃⌥⌘R still start capture - `inst-return-dismiss`

### Answer a notice while the call window is hidden

- [x] `p1` - **ID**: `cpt-noter-flow-ui-record-prompt-notice`

**Actor**: Primary user

**Success Scenarios**:
- Call-ended variant: **The call seems to have ended** · **Microsoft Teams stopped using audio and the microphone 20 s ago. Stopping in 10 s.** with a draining bar; **Stop Now** stops; **Keep Recording** (default) keeps recording
- New-meeting variant: **A new meeting may have started: 1:1 with Anna K.** · **Planning: VHI 8.0 drawer redesign is still recording.**; **Start as New Call** (default) or **Keep in This Call**

**Error Scenarios**:
- Hover or focus pauses the countdown with **Paused while you're here**
- No answer: the core stops at the end of the countdown, or applies **Start as New Call** after 60 s; the notice expires (`notice_expired` closes the panel)

**Steps**:
1. [x] - `p1` - Core: sends `capture:state` with `notice` `call_seems_ended` or `new_meeting` while the call window is hidden and Noter is not hidden for presenting - `inst-core-notice`
2. [x] - `p1` - UI: render the matching variant; API: `window_announce` with the assertive text from the announcement table - `inst-render-notice`
3. [x] - `p1` - **WHILE** the pointer or focus is on the panel - `inst-while-notice-hover`
   1. [x] - `p1` - API: `capture_hold_notice` (held true); the body reads **Paused while you're here**; on release `capture_hold_notice` (false) - `inst-api-hold`
4. [x] - `p1` - User chooses an action, or presses ⌃⌥⌘R (stop now) or ⌃⌥⌘N (shows the call window with the notice; a second press makes it key) - `inst-user-notice`
5. [x] - `p1` - **MATCH** the action - `inst-match-notice`
   - [x] - `p1` - **CASE** **Keep Recording** or **Stop Now**: `capture_answer_call_end` (keep or stop) - `inst-case-call-end`
   - [x] - `p1` - **CASE** **Start as New Call** or **Keep in This Call**: `capture_answer_new_meeting` - `inst-case-new-meeting`
6. [x] - `p1` - **RETURN** the panel closed; after **Stop Now** the menu bar offers **Continue Recording** for 5 minutes and the main window loads the Call page without taking focus - `inst-return-notice`

## 3. Processes / Business Logic (CDSL)

### Choose the prompt variant

- [x] `p1` - **ID**: `cpt-noter-algo-ui-record-prompt-variant`

**Input**: detection (app, bundle id, matched event), capture state with its notice, environment (free disk), setup status (speech model), the inline-confirmation flag

**Output**: the variant and its actions

**Steps**:
1. [x] - `p1` - **IF** the capture notice is `call_seems_ended` or `call_ended`: **RETURN** Call ended (**Stop Now**, **Keep Recording** default, countdown bar) - `inst-call-ended`
2. [x] - `p1` - **IF** the notice is `new_meeting`: **RETURN** New meeting (**Keep in This Call**, **Start as New Call** default, no visible countdown) - `inst-new-meeting`
3. [x] - `p1` - **IF** the user chose **Don't Ask for <app>…**: **RETURN** Not a call (inline line, **Back**, **Don't Ask** primary) - `inst-not-a-call`
4. [x] - `p1` - **IF** free disk is below 500 MB: **RETURN** Disk full (reason with the free space in locale format, **Not Now ▾**, **Delete Old Audio…**, **Record** disabled; no **Record as Sensitive**) - `inst-disk-full`
5. [x] - `p1` - **IF** the live speech model is still downloading: **RETURN** Speech model not downloaded (reason with the percentage, **Not Now ▾**, **Record** disabled; no **Record as Sensitive**) - `inst-model-missing`
6. [x] - `p1` - **IF** system audio access is known to be off: **RETURN** System audio off (warning line, **Not Now ▾**, **Open System Settings…**, **Record** primary and enabled) - `inst-sys-off`
7. [x] - `p1` - **RETURN** Default (**Not Now ▾**, **Record as Sensitive**, **Record** with the key cap ⌃⌥⌘R); the source line is the event's title and platform when an event matched - `inst-default`

## 4. States (CDSL)

### Record prompt panel

- [x] `p1` - **ID**: `cpt-noter-state-ui-record-prompt-panel`

**States**: HIDDEN, CALL_DETECTED, NOT_A_CALL, REFUSED, CALL_ENDED_COUNTDOWN, COUNTDOWN_PAUSED, NEW_MEETING, CLOSING

**Initial State**: HIDDEN

**Transitions**:
1. [x] - `p1` - **FROM** HIDDEN **TO** CALL_DETECTED **WHEN** the core shows the prompt for a detected call or matched event (never while setup is incomplete, while recording or while hidden for presenting) - `inst-hidden-detected`
2. [x] - `p1` - **FROM** HIDDEN **TO** REFUSED **WHEN** the detected call cannot start (disk below 500 MB, speech model downloading) - `inst-hidden-refused`
3. [x] - `p1` - **FROM** CALL_DETECTED **TO** NOT_A_CALL **WHEN** the user chooses **Don't Ask for <app>…** - `inst-detected-notacall`
4. [x] - `p1` - **FROM** NOT_A_CALL **TO** CALL_DETECTED **WHEN** the user clicks **Back** - `inst-notacall-detected`
5. [x] - `p1` - **FROM** NOT_A_CALL **TO** CLOSING **WHEN** the user clicks **Don't Ask** - `inst-notacall-closing`
6. [x] - `p1` - **FROM** CALL_DETECTED **TO** CLOSING **WHEN** capture starts, or the user clicks **Not Now** or ×, or 15 s pass without hover or focus - `inst-detected-closing`
7. [x] - `p1` - **FROM** REFUSED **TO** CALL_DETECTED **WHEN** the reason clears (old audio deleted, model in) - `inst-refused-detected`
8. [x] - `p1` - **FROM** HIDDEN **TO** CALL_ENDED_COUNTDOWN **WHEN** the call-ended notice arrives while the call window is hidden - `inst-hidden-ended`
9. [x] - `p1` - **FROM** CALL_ENDED_COUNTDOWN **TO** COUNTDOWN_PAUSED **WHEN** the pointer or focus is on the panel - `inst-ended-paused`
10. [x] - `p1` - **FROM** COUNTDOWN_PAUSED **TO** CALL_ENDED_COUNTDOWN **WHEN** pointer and focus leave - `inst-paused-ended`
11. [x] - `p1` - **FROM** CALL_ENDED_COUNTDOWN **TO** CLOSING **WHEN** the user answers or the core stops at the end of the countdown - `inst-ended-closing`
12. [x] - `p1` - **FROM** HIDDEN **TO** NEW_MEETING **WHEN** the new-meeting notice arrives while the call window is hidden - `inst-hidden-newmeeting`
13. [x] - `p1` - **FROM** NEW_MEETING **TO** CLOSING **WHEN** the user answers or 60 s pass (**Start as New Call** applies) - `inst-newmeeting-closing`
14. [x] - `p1` - **FROM** CLOSING **TO** HIDDEN **WHEN** the 200 ms fade ends - `inst-closing-hidden`

## 5. Definitions of Done

### Record prompt panel and variants

- [x] `p2` - **ID**: `cpt-noter-dod-ui-record-prompt-panel`

The system **MUST** render the record prompt in its seven variants with the prototype's markup (`data-component="cpt-noter-component-ui-record-prompt"`, `data-variant`, `data-state` `default`, `disabled`, `not-a-call`, `countdown-running`, `countdown-paused`; regions RP-R1 and RP-R3), never take keyboard focus, pause the 15-second timer and the countdown on hover and focus, and post its native announcements.

**Implements**:
- `cpt-noter-flow-ui-record-prompt-start-recording`
- `cpt-noter-flow-ui-record-prompt-missed-prompt`
- `cpt-noter-flow-ui-record-prompt-notice`
- `cpt-noter-algo-ui-record-prompt-variant`
- `cpt-noter-state-ui-record-prompt-panel`

**Constraints**: `cpt-noter-constraint-non-activating-panels`, `cpt-noter-constraint-no-dialog-after-setup`

**Touches**:
- Commands: `capture_start`, `capture_dismiss_detection`, `capture_ignore_app`, `capture_answer_call_end`, `capture_hold_notice`, `capture_answer_new_meeting`, `window_announce`, `window_fit`, `window_navigate`, `open_external`
- Tests: E2E `cpt-noter-seq-record-prompt-start-recording` and `cpt-noter-seq-record-prompt-record-after-missed-prompt` (every path) against `noter-core-harness`; XCUITest `test_cpt_noter_seq_record_prompt_start_recording__hotkey_keeps_focus` (the panel takes clicks and ⌃⌥⌘R without stealing focus); screenshot specs for each `RP_STATES` entry

## 6. Acceptance Criteria

- [x] Every record-prompt state renders as its `RP_STATES` entry in the prototype
- [x] Clicking **Record** leaves keyboard focus in the call app (XCUITest)
- [x] **Record** is disabled only in the Disk full and Speech model variants; with system audio off it starts capture
- [x] **Don't Ask** confirms inline for every app and adds the app to Settings › General
- [x] The countdown bar is absent under Reduce motion while the seconds still update; seconds are never announced

## 7. Additional Context

**Prototype reuse.** Rewritten in React with the same structure, classes, tokens and data attributes: `C.recordPrompt` in `src/js/10-a-components.js` (RP-R1 with `.rp-r1`, `.rp-title`, `.rp-sub`; RP-R3 with `.rp-btnrow`, `.rp-reason`, `.rp-inline`, `.rp-countdown`) and the panel surface `surface('record')` in `src/js/10-a-surfaces.js`. Styles `.rp-*` (`src/css/10-a.css`) and the panel material (`src/css/01-macos27.css`) are ported as-is. Not reusable: the `rp.*` actions and `NP.local('rp')` (prototype plumbing), the simulated countdown timer; production takes the countdown from the notice's `stops_at`.

**States coverage.**

| DESIGN state | Prototype `RP_STATES` |
| --- | --- |
| Call detected | `default` |
| Matched calendar event | `event` |
| Recorded as sensitive | `default` › **Record as Sensitive**, then the call window's **Sensitive · local** |
| Not a call | `not-a-call` |
| Disk below 500 MB | `disk-full` |
| System audio access off | `system-audio-off` |
| Closed unanswered | `closed` |
| Setup incomplete | `setup-incomplete` (no prompt; menu bar line) |
| Hidden for presenting | `hidden` (no prompt) |
| Call ended, call window hidden | `call-ended` |
| New meeting, call window hidden | `new-meeting` |
| Stopped from the call-ended variant | `call-ended` › **Stop Now**, then the menu bar's closing state |
| Automatic recording (v1.x) | Not shown in v1 |
| — | `model-missing` (Speech model not downloaded yet) |

**DESIGN versus prototype.** The prototype has a state that DESIGN's screen States table lacks: **Speech model not downloaded yet** (`model-missing`), which DESIGN describes only as a component variant. This feature includes it (listed in `docs/DECOMPOSITION.md`).

**Milestone notes.** The **Delete Old Audio…** sheet opens in M1; deleting old audio (`audio_delete_older`) is M2 (discrepancy 5).

**Not applicable.** Placement and detection: the core. Data: the prompt reads the detection and stores nothing.
