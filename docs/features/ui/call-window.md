---
title: "Feature — Call window: call screen and floating panel"
description: "One non-activating, content-protected call window with a dedicated layout on a second display and a floating layout beside the call app: recording state, capture notices, degraded banners, capture controls, layout switch, collapse, hide and hide for presenting, in the copilot-off layout of M1."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-call-window
milestone: M1
---

# Feature: Call window: call screen and floating panel


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Keep recording through capture problems](#keep-recording-through-capture-problems)
  - [Stop recording when the call ends](#stop-recording-when-the-call-ends)
  - [Hide Noter while presenting](#hide-noter-while-presenting)
  - [Keep the call when a display is unplugged](#keep-the-call-when-a-display-is-unplugged)
  - [Collapse the panel to one line](#collapse-the-panel-to-one-line)
  - [Hide the panel and bring it back](#hide-the-panel-and-bring-it-back)
  - [Control the recording from the window](#control-the-recording-from-the-window)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Map a degraded state to its banner](#map-a-degraded-state-to-its-banner)
  - [Show the closing state](#show-the-closing-state)
  - [Choose what the layout shows](#choose-what-the-layout-shows)
- [4. States (CDSL)](#4-states-cdsl)
  - [Call window](#call-window)
  - [Layout](#layout)
  - [Capture as the window shows it](#capture-as-the-window-shows-it)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Call window shell and both layouts](#call-window-shell-and-both-layouts)
  - [Capture notices, closing state and controls](#capture-notices-closing-state-and-controls)
  - [Degraded states, presenting and share protection](#degraded-states-presenting-and-share-protection)
  - [Participant chips](#participant-chips)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p2` - **ID**: `cpt-noter-featstatus-ui-call-window`

## 1. Feature Context

- [ ] `p2` - `cpt-noter-feature-ui-call-window`

### 1.1 Overview

During a call Noter shows one window that is an NSPanel: it never makes Noter active, is hidden from window-filtered screen shares, and has two layouts of one React tree and one store. The dedicated layout (call screen) fills a second display; the floating layout (floating panel) sits beside the call app and can collapse to a 56-pt strip. The window shows the recording state and clock, capture decisions in the notice slot (call ended, new meeting, nothing heard, the closing state after any stop), degraded states in banners, the live transcript, and the capture controls with their global hotkeys. In M1 the copilot is off (`cpt-noter-constraint-copilot-flag`), so the window uses its **Copilot flag off** layout; the council column, cards and card keys arrive with `cpt-noter-feature-ui-copilot` in M4.

### 1.2 Purpose

It implements `cpt-noter-component-shell-call-window`, `cpt-noter-component-screen-call-screen`, `cpt-noter-component-screen-floating-panel`, `cpt-noter-component-ui-capture-notice`, `cpt-noter-component-ui-recording-indicator`, `cpt-noter-component-ui-call-status-strip`, `cpt-noter-component-ui-collapsed-call-strip`, `cpt-noter-component-ui-person-chip` and the call-window rows of `cpt-noter-topology-ui-windows`. It embeds the transcript of `cpt-noter-feature-ui-live-transcript` and the mode indicator of `cpt-noter-feature-ui-main-window-shell`.

**Requirements**: PRD › Feature specification › 1. Capture and 2. Live transcript; PRD › Live copilot › Surfaces; PRD › Live copilot loop › Degraded states. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-privacy-visible`, `cpt-noter-principle-never-steal-focus`, `cpt-noter-principle-quiet-surface`, `cpt-noter-principle-degrade-visibly`, `cpt-noter-principle-core-owns-state`

Success criteria: no click or key on the call window ever moves focus from the call app unless the user types in a field or presses ⌃⌥⌘N twice; a display change, a hide or a crash of the window loses nothing.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Watches the call's state, answers capture notices, pauses, marks, stops, continues, hides, presents |
| Noter core (system) | Places the window on displays, switches nothing by itself in the WebView but sends `window:call`; detects call end, new meetings, silence and capture problems; registers hotkeys; posts native announcements; hides surfaces for presenting |
| Call app (external) | Keeps keyboard focus throughout |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Live copilot › Surfaces; Live copilot loop › Degraded states
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Shell — Call window; Screen — Call screen; Screen — Floating panel; Component — Capture notice; Recording indicator; Call status strip; Collapsed call strip; Person chip; 3.8 Deployment Topology
- **Design elements**: `cpt-noter-component-shell-call-window`, `cpt-noter-component-screen-call-screen`, `cpt-noter-component-screen-floating-panel`, `cpt-noter-component-ui-capture-notice`, `cpt-noter-component-ui-recording-indicator`, `cpt-noter-component-ui-call-status-strip`, `cpt-noter-component-ui-collapsed-call-strip`, `cpt-noter-component-ui-person-chip`, `cpt-noter-topology-ui-windows`
- **Stories** (M1): `cpt-noter-seq-call-screen-recover-capture`, `cpt-noter-seq-call-screen-stop-at-call-end`, `cpt-noter-seq-call-screen-hide-for-presenting`, `cpt-noter-seq-floating-panel-display-unplugged`, `cpt-noter-seq-floating-panel-collapse-strip`, `cpt-noter-seq-floating-panel-hide-and-reopen`
- **Frozen commands it calls**: `capture_stop`, `capture_set_paused`, `capture_mark_moment`, `capture_answer_call_end`, `capture_hold_notice`, `capture_answer_new_meeting`, `capture_continue`, `capture_keep_recording`, `capture_discard`, `capture_set_sensitive`, `capture_exclude_source`, `capture_keep_source`, `capture_resume_interrupted`, `window_show_call`, `window_hide_call`, `window_call_state`, `window_set_call_layout`, `window_set_collapsed`, `app_set_hidden_for_presenting`, `window_navigate`, `window_announce`, `open_external`
- **Events**: `capture:state`, `degraded:changed`, `window:call`, `app:presenting`, `privacy:changed`, `env:changed`, `hotkeys:changed`
- **Prototype modules**: `src/js/20-b-surface.js` (`surface('call')`, both layouts, the closing state, the state list), `src/js/20-b-components.js` (`C.captureNotice`, `C.callStatusStrip`, `C.collapsedCallStrip`), `src/js/04-shared.js` (`C.recordingIndicator`, `NP.captureHealth`, `NP.liveStatus`, `C.personChip`, `call.makeSensitive`), `src/css/20-b.css` (`.cw-*`, `.cs-*`, `.fp-*`)
- **Dependencies**: `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-primitives`, `cpt-noter-feature-ui-accessibility-l10n`, `cpt-noter-feature-ui-live-transcript`

## 2. Actor Flows (CDSL)

### Keep recording through capture problems

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-window-recover-capture`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-call-screen-recover-capture`: **Slack is also playing audio** · **Exclude Slack** · **Keep**; **Exclude Slack** closes the banner and the transcript carries on

**Error Scenarios**:
- Error — System audio silent: **System audio silent** · **Open System Settings…**, indicator **Recording · mic only**, gap row **System audio silent 00:30:02–00:30:40**
- Error — Microphone off: **Microphone off** · **Open System Settings…**, indicator **Recording · no mic**
- Error — Engine stopped: **Not recording · engine stopped** · **Try Again**, indicator **Not recording**; **Try Again** continues the same call with a gap row
- Error — Headphones connected: marker row **Microphone changed · 2 s lost**
- Error — Transcription stalled: **Transcription stalled · restarting**, then the missed lines fill in
- Empty — Nothing heard yet: **Waiting for speech…** with **You** and **Others** meters; after 5 minutes the notice **Nothing heard yet** with **Discard Recording** and **Keep Recording**
- Error — Disk nearly full: **2 GB free on this Mac. Recording continues.** · **Delete Old Audio…**

**Steps**:
1. [ ] - `p1` - Core: sends the degraded set (`degraded:changed`) and the capture state with its notice - `inst-core-degraded`
2. [ ] - `p1` - Algorithm: map each degraded state with `cpt-noter-algo-ui-call-window-degraded-banner` - `inst-map-degraded`
3. [ ] - `p1` - UI: show the transcript banner in CS-R3 (dedicated) or FP-R3 (floating, compact); the indicator in CS-R1, CS-R5, FP-R1 and FP-C1 shows the state word - `inst-show-banner`
4. [ ] - `p1` - API: `window_announce` for capture failures, assertive, once (for example "System audio silent. Recording continues with your microphone.") - `inst-announce-failure`
5. [ ] - `p1` - User chooses the banner's action - `inst-user-action`
6. [ ] - `p1` - **MATCH** the action - `inst-match-action`
   - [ ] - `p1` - **CASE** **Exclude Slack**: `capture_exclude_source` (bundle id) - `inst-case-exclude`
   - [ ] - `p1` - **CASE** **Keep**: `capture_keep_source`; the banner is not shown again for that app in this call - `inst-case-keep-source`
   - [ ] - `p1` - **CASE** **Open System Settings…**: `open_external` (the privacy pane) - `inst-case-open`
   - [ ] - `p1` - **CASE** **Try Again** (engine stopped): `capture_continue`; the same call goes on with a gap row - `inst-case-retry`
   - [ ] - `p1` - **CASE** **Delete Old Audio…**: `window_navigate` to the main window's sheet; recording goes on - `inst-case-delete-old`
7. [ ] - `p1` - **IF** the notice is `nothing_heard` - `inst-if-nothing`
   1. [ ] - `p1` - UI: the capture notice (nothing-heard variant) with the two meters in CS-R0 or FP-R0; **Keep Recording** calls `capture_keep_recording` and closes it; **Discard Recording** opens the inline confirmation of `cpt-noter-feature-ui-dialogs-host` and **Discard** calls `capture_discard` - `inst-nothing-heard`
8. [ ] - `p1` - **RETURN** the recording going on, with each problem shown where it happens and lost time as gap rows - `inst-return-recover`

### Stop recording when the call ends

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-window-stop-at-call-end`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-call-screen-stop-at-call-end`: **The call seems to have ended** with the countdown, **Stop Now**, the closing state **Saved · 48 min · Summary in about 2 minutes** with **Continue Recording**, **Open in Noter** (default) and **Close**, and the line **The panel closes in 10 s. Continue Recording works for 5 minutes, also from the menu bar.**; the call's page loads in the main window without focus

**Error Scenarios**:
- Error — Next meeting starts straight away: **A new meeting may have started: 1:1 with Anna K.** · **Start as New Call** · **Keep in This Call**; after **Start as New Call** the header reads **1:1 with Anna K.**, the clock **00:00:12**, the transcript **Waiting for speech…**, the strip **Saved “Planning: VHI 8.0 drawer redesign” · started “1:1 with Anna K.”**
- Error — Stopped by mistake: ⌃⌥⌘R, then **Continue Recording** appends with a gap row
- Empty — No answer to the notice: **Stopped at 11:02 · the call had ended · 48 min saved** with **Continue Recording** and **Open in Noter**
- Error — Call window hidden: the record prompt carries the notice (`cpt-noter-feature-ui-record-prompt`)
- Error — Hidden for presenting: no countdown; the menu bar carries it (`cpt-noter-feature-ui-menu-bar`)

**Steps**:
1. [ ] - `p1` - Core: sends `capture:state` with `notice` `call_seems_ended` (with `stops_at`) or `new_meeting` - `inst-core-notice`
2. [ ] - `p1` - **IF** the window is hidden or Noter is hidden for presenting - `inst-if-hidden`
   1. [ ] - `p1` - **RETURN** nothing in this window (the record prompt or the menu bar shows the notice) - `inst-return-hidden`
3. [ ] - `p1` - UI: the capture notice in CS-R0 or FP-R0, pushing the content down; a collapsed strip expands for it; API: `window_announce` (assertive) - `inst-show-notice`
4. [ ] - `p1` - **WHILE** the pointer or focus is on the notice - `inst-while-hold`
   1. [ ] - `p1` - API: `capture_hold_notice` (true); the body reads **Paused while you're here**; on release (false) - `inst-api-hold`
5. [ ] - `p1` - User answers: **Keep Recording** or **Stop Now** (`capture_answer_call_end`), **Start as New Call** or **Keep in This Call** (`capture_answer_new_meeting`), or ⌃⌥⌘R (stop now, through the core) - `inst-user-answer`
6. [ ] - `p1` - **IF** capture stopped (manually or automatically) - `inst-if-stopped`
   1. [ ] - `p1` - Algorithm: show the closing state with `cpt-noter-algo-ui-call-window-closing-state` - `inst-closing`
7. [ ] - `p1` - **IF** the user started a new call - `inst-if-new-call`
   1. [ ] - `p1` - UI: the window keeps its layout and switches to the new call's title, clock and transcript waiting state; the strip shows the saved-and-started line - `inst-new-call`
8. [ ] - `p1` - **RETURN** the call saved, continued, or split into two calls - `inst-return-stop`

### Hide Noter while presenting

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-window-hide-for-presenting`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-call-screen-hide-for-presenting`: **Hide Noter for Presenting** or ⌃⌥⌘0 hides every Noter surface; ⌃⌥⌘0 or **Show Noter** brings back exactly the windows that were open
- Other — Share warning in the floating panel: the first time the floating layout opens, **Hidden from window shares only. Before sharing your whole screen, press** ⌃⌥⌘0. · **Got It**; the share-protection glyph and its help tag stay

**Error Scenarios**:
- Empty — Call detected while hidden; Error — Notification while hidden: shown by the menu bar and notifications features
- Other — Check the share before presenting: the Screen Share Test sheet in Settings (`cpt-noter-feature-ui-settings`, bound in M2)

**Steps**:
1. [ ] - `p1` - User clicks the eye-slash icon button in CS-R1 or FP-R1, or presses ⌃⌥⌘0 - `inst-user-hide`
2. [ ] - `p1` - API: `app_set_hidden_for_presenting` (true, wanted state) - `inst-api-hide`
3. [ ] - `p1` - Core: hides the call window, record prompt, main window and Settings window, clears the menu bar title, and sends `app:presenting` - `inst-core-hide`
4. [ ] - `p1` - Store: keep the presenting copy; the window keeps its whole state for the return - `inst-store-presenting`
5. [ ] - `p1` - User presses ⌃⌥⌘0 or chooses **Show Noter**; the core shows the windows as they were - `inst-user-show`
6. [ ] - `p1` - **IF** the floating layout opens for the first time and `show_share_warning` is set - `inst-if-warning`
   1. [ ] - `p1` - UI: the info banner in FP-R3 with **Got It**, which `settings_update` records so it does not come back - `inst-share-warning`
7. [ ] - `p1` - **RETURN** Noter shown again with the recording and transcript complete - `inst-return-present`

### Keep the call when a display is unplugged

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-window-display-change`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-floating-panel-display-unplugged`: the call continues in the floating layout at the last floating position, with the transcript tail where it was
- Empty — Display connected again: the dedicated layout returns while **Open the call screen automatically** is on

**Error Scenarios**:
- Error — Panel would land off screen: the core places it inside the remaining display's visible frame; a drag sets a new remembered position
- Error — Chosen display not connected: the call opens floating; Settings shows **LG UltraFine (not connected)**

**Steps**:
1. [ ] - `p1` - Core: a display is added or removed; the core moves the window and sends `window:call` (layout, display, `chosen_display_missing`) - `inst-core-display`
2. [ ] - `p1` - Store: apply the call-window state; the transcript position, view state and (from M4) cards, held cards and pins stay in the same store - `inst-store-window`
3. [ ] - `p1` - UI: render the layout the state names; the React tree is the same, so nothing reloads - `inst-render-layout`
4. [ ] - `p1` - User may switch by hand: ⋯ › **Use Floating Panel**, **Move to Display 2**, ⋯ › **Open Call Screen on Display 2** - `inst-user-switch`
5. [ ] - `p1` - API: `window_set_call_layout` (dedicated or floating, display) - `inst-api-layout`
6. [ ] - `p1` - **RETURN** the same call in the new layout - `inst-return-display`

### Collapse the panel to one line

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-window-collapse`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-floating-panel-collapse-strip`: **Collapse Panel** or a double-click on the header shows one line with the recording dot and **00:21:08** at the same snapped edge; **Expand Panel** brings the panel back
- Error — Capture notice while collapsed: the strip expands for the notice and collapses after the choice

**Error Scenarios**:
- Paused: the strip clock reads **Paused 3 min**
- Copilot flag off (M1): the strip has no card area and no count badge

**Steps**:
1. [ ] - `p1` - User clicks **Collapse Panel**, double-clicks FP-R1, or later **Expand Panel**, Return or Space on the strip, or ⌃⌥⌘N - `inst-user-collapse`
2. [ ] - `p1` - API: `window_set_collapsed` (true or false); the core resizes the panel and keeps the snapped edge - `inst-api-collapse`
3. [ ] - `p1` - UI: render FP-C1 (dot, clock, mode glyph), FP-C2 (the card line from M4; nothing with the copilot off) and FP-C3 (**Expand**) - `inst-render-strip`
4. [ ] - `p1` - **IF** a capture notice arrives while collapsed - `inst-if-notice-collapsed`
   1. [ ] - `p1` - UI: expand for the notice and collapse again after the choice - `inst-expand-notice`
5. [ ] - `p1` - **RETURN** the strip or the expanded panel - `inst-return-collapse`

### Hide the panel and bring it back

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-window-hide-reopen`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-floating-panel-hide-and-reopen`: **Hide** (×, help tag **Hide to the menu bar**) hides the panel while recording goes on; ⌃⌥⌘N or **Open Call Screen** brings it back without taking focus

**Error Scenarios**:
- Error — Capture problem while hidden: NT-3 (`cpt-noter-feature-ui-notifications`); its click shows the window with the banner
- Error — Panel closed by a crash: ⌃⌥⌘N brings the window back with the same transcript, pins and marks (snapshot, then stream)

**Steps**:
1. [ ] - `p1` - User clicks **Hide** - `inst-user-hide-panel`
2. [ ] - `p1` - API: `window_hide_call`; capture continues and the menu bar keeps the recording glyph - `inst-api-hide-call`
3. [ ] - `p1` - User presses ⌃⌥⌘N or chooses **Open Call Screen** - `inst-user-reopen`
4. [ ] - `p1` - Core: shows the window without making it key (`window_show_call` from other windows; the core handles the hotkey); a second ⌃⌥⌘N makes it key with focus on the notice when one shows - `inst-core-show`
5. [ ] - `p1` - **IF** the window's WebView was recreated after a crash - `inst-if-crash`
   1. [ ] - `p1` - UI: open with `cpt-noter-flow-ui-core-bridge-open-window`: `app_snapshot`, `window_call_state`, then the transcript snapshot and stream - `inst-crash-restore`
6. [ ] - `p1` - **RETURN** the panel back where it was, the call app still focused - `inst-return-reopen`

### Control the recording from the window

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-window-controls`

**Actor**: Primary user

**Success Scenarios**:
- **Mark Moment** adds a mark row and the button reads ✓ **Marked 00:21:08** for 2 s
- **Pause** drops audio; **Resume** becomes primary while paused and the transcript gets the gap row **Paused 00:21:08–00:23:40**
- **Stop Recording** (16 pt after **Pause**) ends capture with the closing state
- ⋯ › **Make This Call Sensitive** shows **From now on, nothing from this call leaves this Mac.** and the mode **Sensitive · local**; the item is then disabled
- ⋯ › **Open in Noter** brings the main window forward at the call's page

**Error Scenarios**:
- A command fails: the button leaves its loading state and the strip shows the error notice; `not_recording` after a stop shows the closing state

**Steps**:
1. [ ] - `p1` - User clicks a strip button or a ⋯ item (in the floating layout ⋯ holds **Pause** or **Resume**, **Stop Recording**), or presses its global hotkey (handled by the core) - `inst-user-control`
2. [ ] - `p1` - **MATCH** the control - `inst-match-control`
   - [ ] - `p1` - **CASE** **Mark Moment**: `capture_mark_moment`; inline status on the button - `inst-case-mark`
   - [ ] - `p1` - **CASE** **Pause** or **Resume**: `capture_set_paused` (wanted state) - `inst-case-pause`
   - [ ] - `p1` - **CASE** **Stop Recording**: `capture_stop` - `inst-case-stop`
   - [ ] - `p1` - **CASE** **Make This Call Sensitive**: `capture_set_sensitive` (true) - `inst-case-sensitive`
   - [ ] - `p1` - **CASE** **Open in Noter**: `window_navigate` (call page) - `inst-case-open-noter`
   - [ ] - `p1` - **CASE** **Use Floating Panel**, **Move to Display 2**: `window_set_call_layout` - `inst-case-layout`
3. [ ] - `p1` - Store: the changed capture state arrives as `capture:state`; the strip and indicator render it; API: `window_announce` "Paused", "Resumed", "Recording stopped, saved 48 minutes" - `inst-store-capture`
4. [ ] - `p1` - **RETURN** the call in its new state - `inst-return-control`

## 3. Processes / Business Logic (CDSL)

### Map a degraded state to its banner

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-call-window-degraded-banner`

**Input**: one `DegradedState` for the current call, and the layout

**Output**: the banner (slot, severity, sentence, actions), the indicator word, or a gap row

**Steps**:
1. [ ] - `p1` - **MATCH** the type - `inst-match-type`
   - [ ] - `p1` - **CASE** `system_audio_silent`: error banner **System audio silent** · **Open System Settings…**; indicator **Recording · mic only** - `inst-case-silent`
   - [ ] - `p1` - **CASE** `microphone_off`: error banner **Microphone off** · **Open System Settings…**; indicator **Recording · no mic** - `inst-case-mic-off`
   - [ ] - `p1` - **CASE** `capture_failed`: error banner **Not recording · engine stopped** · **Try Again**; indicator **Not recording**; the strip's **Pause** and **Stop Recording** give way to **Try Again** - `inst-case-failed`
   - [ ] - `p1` - **CASE** `transcription_stalled`: banner **Transcription stalled · restarting** - `inst-case-stalled`
   - [ ] - `p1` - **CASE** `second_audio_source`: banner **<app> is also playing audio** · **Exclude <app>** · **Keep** - `inst-case-second`
   - [ ] - `p1` - **CASE** `disk_low`: warning **2 GB free on this Mac. Recording continues.** · **Delete Old Audio…** - `inst-case-disk`
   - [ ] - `p1` - **CASE** `device_changed`: no banner; the transcript shows the gap row the core sends (**Microphone changed · 2 s lost**) - `inst-case-device`
   - [ ] - `p1` - **CASE** `switched_to_local`, `budget_paused`, `agent_paused`: copilot banners in CS-R4d (M4); none in M1 - `inst-case-copilot`
2. [ ] - `p1` - In the floating layout use the compact banner in FP-R3 with the actions under the sentence - `inst-compact`
3. [ ] - `p1` - **RETURN** the banner, ordered with the others by severity - `inst-return-banner`

### Show the closing state

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-call-window-closing-state`

**Input**: the capture state after a stop (`stopped`, `continue_until`, the notice `stopped_automatically` or none), the call's length and expected summary time

**Output**: the closing state of the window for 10 s

**Steps**:
1. [ ] - `p1` - **IF** the stop was automatic - `inst-if-auto`
   1. [ ] - `p1` - Title **Stopped at 11:02 · the call had ended · 48 min saved**; **Continue Recording**, **Open in Noter** (default) - `inst-auto`
2. [ ] - `p1` - **ELSE** - `inst-else-manual`
   1. [ ] - `p1` - Title **Saved · 48 min · Summary in about 2 minutes**; **Continue Recording**, **Open in Noter** (default), **Close** - `inst-manual`
3. [ ] - `p1` - Under it, **The panel closes in 10 s. Continue Recording works for 5 minutes, also from the menu bar.**; the strip drops its buttons and the indicator reads **Stopped** - `inst-closing-line`
4. [ ] - `p1` - **IF** the user chooses **Continue Recording** before `continue_until` - `inst-if-continue`
   1. [ ] - `p1` - API: `capture_continue`; the same call records again with the gap row **Stopped 11:02–11:04** - `inst-api-continue`
   2. [ ] - `p1` - **IF** the result is `continue_window_closed`: the button disappears; the menu bar no longer offers it - `inst-continue-closed`
5. [ ] - `p1` - **IF** the user chooses **Open in Noter**: `window_navigate` (call page); **Close**: `window_hide_call` - `inst-open-close`
6. [ ] - `p1` - After 10 s without a choice the core closes the window - `inst-auto-close`
7. [ ] - `p1` - **RETURN** the closing state - `inst-return-closing`

### Choose what the layout shows

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-call-window-layout-content`

**Input**: the layout, the panel height (floating), the display width (dedicated), the copilot feature flag and whether **Show Transcript** is on

**Output**: the regions to render

**Steps**:
1. [ ] - `p1` - **IF** the layout is dedicated - `inst-if-dedicated`
   1. [ ] - `p1` - Render CS-R0 (when a notice is open), CS-R1, CS-R3, CS-R2, CS-R2b (while replaying on headphones) and CS-R5 - `inst-dedicated-regions`
   2. [ ] - `p1` - **IF** the copilot flag is off: no CS-R4 column; the transcript fills the width; CS-R5 has no budget, **Pinned** or **Catch Me Up** - `inst-dedicated-copilot-off`
2. [ ] - `p1` - **ELSE** (floating) - `inst-else-floating`
   1. [ ] - `p1` - Render FP-R0 (notice, in place of FP-R2 and FP-R3), FP-R1, FP-R3, FP-R6 - `inst-floating-regions`
   2. [ ] - `p1` - **IF** the copilot flag is off: no FP-R2 mode line or FP-R4 cards; the transcript tail fills the panel with the last 8 lines - `inst-floating-copilot-off`
   3. [ ] - `p1` - **ELSE** (M4): one card below 380 pt, two from 380 to 599, three from 600, and the tail from 680 or with **Show Transcript** - `inst-floating-heights`
3. [ ] - `p1` - **RETURN** the regions - `inst-return-regions`

## 4. States (CDSL)

### Call window

- [ ] `p1` - **ID**: `cpt-noter-state-ui-call-window-window`

**States**: NOT_KEY, KEY, HIDDEN_BY_USER, HIDDEN_FOR_PRESENTING, CLOSING, CLOSED

**Initial State**: NOT_KEY

**Transitions**:
1. [ ] - `p1` - **FROM** NOT_KEY **TO** KEY **WHEN** the user types in a field of the window or presses ⌃⌥⌘N a second time while it is visible - `inst-notkey-key`
2. [ ] - `p1` - **FROM** KEY **TO** NOT_KEY **WHEN** the user presses Esc with no popover open, or clicks the call app - `inst-key-notkey`
3. [ ] - `p1` - **FROM** NOT_KEY **TO** HIDDEN_BY_USER **WHEN** the user clicks **Hide** - `inst-notkey-hidden`
4. [ ] - `p1` - **FROM** HIDDEN_BY_USER **TO** NOT_KEY **WHEN** ⌃⌥⌘N or **Open Call Screen** shows it without making it key - `inst-hidden-notkey`
5. [ ] - `p1` - **FROM** NOT_KEY **TO** HIDDEN_FOR_PRESENTING **WHEN** the user hides Noter for presenting - `inst-notkey-presenting`
6. [ ] - `p1` - **FROM** HIDDEN_FOR_PRESENTING **TO** NOT_KEY **WHEN** the user shows Noter again - `inst-presenting-notkey`
7. [ ] - `p1` - **FROM** NOT_KEY **TO** CLOSING **WHEN** capture stops (manual or automatic) - `inst-notkey-closing`
8. [ ] - `p1` - **FROM** CLOSING **TO** NOT_KEY **WHEN** the user chooses **Continue Recording** - `inst-closing-notkey`
9. [ ] - `p1` - **FROM** CLOSING **TO** CLOSED **WHEN** 10 s pass, or the user chooses **Close** or **Open in Noter**, or the user discards the recording - `inst-closing-closed`

### Layout

- [ ] `p1` - **ID**: `cpt-noter-state-ui-call-window-layout`

**States**: DEDICATED, FLOATING, COLLAPSED

**Initial State**: FLOATING

**Transitions**:
1. [ ] - `p1` - **FROM** FLOATING **TO** DEDICATED **WHEN** capture starts with a second display, **Layout** set to **Automatic** and **Open the call screen automatically** on, or a display connects during the call with that toggle on, or the user chooses **Move to Display 2** - `inst-floating-dedicated`
2. [ ] - `p1` - **FROM** DEDICATED **TO** FLOATING **WHEN** the call display is unplugged (Display unplugged) or the user chooses **Use Floating Panel** - `inst-dedicated-floating`
3. [ ] - `p1` - **FROM** FLOATING **TO** COLLAPSED **WHEN** the user collapses the panel - `inst-floating-collapsed`
4. [ ] - `p1` - **FROM** COLLAPSED **TO** FLOATING **WHEN** the user expands it, or a capture notice arrives (it collapses again after the choice) - `inst-collapsed-floating`

### Capture as the window shows it

- [ ] `p1` - **ID**: `cpt-noter-state-ui-call-window-capture`

**States**: RECORDING, MIC_ONLY, NO_MIC, PAUSED, NOT_RECORDING, NOTICE_CALL_ENDED, NOTICE_NEW_MEETING, NOTICE_NOTHING_HEARD, STOPPED

**Initial State**: RECORDING

**Transitions**:
1. [ ] - `p1` - **FROM** RECORDING **TO** MIC_ONLY **WHEN** the core reports system audio silent - `inst-rec-miconly`
2. [ ] - `p1` - **FROM** MIC_ONLY **TO** RECORDING **WHEN** system audio arrives again - `inst-miconly-rec`
3. [ ] - `p1` - **FROM** RECORDING **TO** NO_MIC **WHEN** the core reports microphone off - `inst-rec-nomic`
4. [ ] - `p1` - **FROM** NO_MIC **TO** RECORDING **WHEN** microphone access returns - `inst-nomic-rec`
5. [ ] - `p1` - **FROM** RECORDING **TO** PAUSED **WHEN** the user pauses - `inst-rec-paused`
6. [ ] - `p1` - **FROM** PAUSED **TO** RECORDING **WHEN** the user resumes; a gap row appears - `inst-paused-rec`
7. [ ] - `p1` - **FROM** RECORDING **TO** NOT_RECORDING **WHEN** the engine stopped and could not restart - `inst-rec-notrec`
8. [ ] - `p1` - **FROM** NOT_RECORDING **TO** RECORDING **WHEN** **Try Again** continues the call - `inst-notrec-rec`
9. [ ] - `p1` - **FROM** RECORDING **TO** NOTICE_CALL_ENDED **WHEN** the call seems to have ended - `inst-rec-ended`
10. [ ] - `p1` - **FROM** NOTICE_CALL_ENDED **TO** RECORDING **WHEN** the user keeps recording - `inst-ended-rec`
11. [ ] - `p1` - **FROM** NOTICE_CALL_ENDED **TO** STOPPED **WHEN** the user stops or the countdown ends - `inst-ended-stopped`
12. [ ] - `p1` - **FROM** RECORDING **TO** NOTICE_NEW_MEETING **WHEN** a new meeting may have started - `inst-rec-newmeeting`
13. [ ] - `p1` - **FROM** NOTICE_NEW_MEETING **TO** RECORDING **WHEN** the user answers or 60 s pass (a new call starts, or the same call goes on) - `inst-newmeeting-rec`
14. [ ] - `p1` - **FROM** RECORDING **TO** NOTICE_NOTHING_HEARD **WHEN** nothing is heard for 5 minutes - `inst-rec-nothing`
15. [ ] - `p1` - **FROM** NOTICE_NOTHING_HEARD **TO** RECORDING **WHEN** the user keeps recording - `inst-nothing-rec`
16. [ ] - `p1` - **FROM** NOTICE_NOTHING_HEARD **TO** STOPPED **WHEN** the user discards the recording - `inst-nothing-stopped`
17. [ ] - `p1` - **FROM** RECORDING **TO** STOPPED **WHEN** the user stops - `inst-rec-stopped`
18. [ ] - `p1` - **FROM** STOPPED **TO** RECORDING **WHEN** the user continues within 5 minutes - `inst-stopped-rec`

## 5. Definitions of Done

### Call window shell and both layouts

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-call-window-shell`

The system **MUST** render the call window as one React tree with the dedicated layout (CS-R0 to CS-R5) and the floating layout (FP-R0 to FP-R6, FP-C1 to FP-C3) as `surface('call')` renders them in the **Copilot flag off** state, switch layouts from `window:call` without reloading, keep every view state across layout changes, hides and crashes, and never take focus except as the panel rules allow.

**Implements**:
- `cpt-noter-flow-ui-call-window-display-change`
- `cpt-noter-flow-ui-call-window-collapse`
- `cpt-noter-flow-ui-call-window-hide-reopen`
- `cpt-noter-algo-ui-call-window-layout-content`
- `cpt-noter-state-ui-call-window-window`
- `cpt-noter-state-ui-call-window-layout`

**Constraints**: `cpt-noter-constraint-one-call-window`, `cpt-noter-constraint-non-activating-panels`, `cpt-noter-constraint-share-exclusion-limits`, `cpt-noter-constraint-copilot-flag`

**Touches**:
- Commands: `window_show_call`, `window_hide_call`, `window_call_state`, `window_set_call_layout`, `window_set_collapsed`, `window_navigate`
- Tests: E2E `cpt-noter-seq-floating-panel-display-unplugged`, `cpt-noter-seq-floating-panel-collapse-strip`, `cpt-noter-seq-floating-panel-hide-and-reopen` (copilot-off variant); XCUITest for non-activation and ⌃⌥⌘N; screenshot specs `copilot-off`, `collapsed`, `unplugged`, `paused`, `presenting`

### Capture notices, closing state and controls

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-call-window-capture`

The system **MUST** provide the capture notice (call ended, new meeting, stopped automatically, stopped by you, nothing heard, with the inline discard), the closing state with **Continue Recording** for 5 minutes, the call status strip (dedicated, compact, copilot off) and the recording indicator (four variants, six state words), and call the capture commands with wanted state.

**Implements**:
- `cpt-noter-flow-ui-call-window-stop-at-call-end`
- `cpt-noter-flow-ui-call-window-controls`
- `cpt-noter-algo-ui-call-window-closing-state`
- `cpt-noter-state-ui-call-window-capture`

**Constraints**: `cpt-noter-constraint-non-activating-panels`

**Touches**:
- Commands: `capture_stop`, `capture_set_paused`, `capture_mark_moment`, `capture_answer_call_end`, `capture_hold_notice`, `capture_answer_new_meeting`, `capture_continue`, `capture_keep_recording`, `capture_discard`, `capture_set_sensitive`, `window_announce`
- Tests: E2E `cpt-noter-seq-call-screen-stop-at-call-end` (every path up to the stop; the notification is proven in M2); screenshot specs `call-ended`, `new-meeting`, `nothing-heard`, `closing-manual`, `closing-auto`

### Degraded states, presenting and share protection

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-call-window-degraded`

The system **MUST** show each capture problem in its banner slot with its fix, the matching indicator word and the gap rows, announce capture failures assertively once, hide every surface for presenting through `app_set_hidden_for_presenting`, show the share-protection glyph with its help tag in CS-R1 and FP-R1, and show the first-open share warning in the floating layout.

**Implements**:
- `cpt-noter-flow-ui-call-window-recover-capture`
- `cpt-noter-flow-ui-call-window-hide-for-presenting`
- `cpt-noter-algo-ui-call-window-degraded-banner`

**Constraints**: `cpt-noter-constraint-share-exclusion-limits`

**Touches**:
- Commands: `capture_exclude_source`, `capture_keep_source`, `capture_continue`, `capture_resume_interrupted` (MW-R5 quit banner), `app_set_hidden_for_presenting`, `open_external`
- Events: `degraded:changed`, `app:presenting`
- Tests: E2E `cpt-noter-seq-call-screen-recover-capture` (every path) and `cpt-noter-seq-call-screen-hide-for-presenting` (Happy path, Other — Share warning in the floating panel); screenshot specs `mic-only`, `mic-off`, `engine-stopped`, `stalled`, `disk`, `second-source`

### Participant chips

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-call-window-person-chip`

The system **MUST** show a person chip per participant in CS-R1 (with **You** and unnamed **Speaker 3**), with the person chip's variants and states as `C.personChip` renders them; the rename popover behind a chip arrives with `cpt-noter-feature-ui-speakers` (M2).

**Implements**:
- `cpt-noter-flow-ui-call-window-controls`

**Constraints**: `cpt-noter-constraint-three-languages`

**Touches**:
- Tests: screenshot specs of the header with resolved, unnamed and **You** chips

## 6. Acceptance Criteria

- [ ] Every call-window state the prototype lists for M1 renders as its `surface('call')` state in the copilot-off layout: Copilot flag off, Call seems to have ended, New meeting started, Nothing heard yet, Closing after Stop Recording, Closing after automatic stop, System audio silent, Microphone off, Not recording · engine stopped, Transcription stalled, Disk nearly full, Second audio source, Scrolled up, Replaying on headphones, Recording on speakers, Output not identified, Paused, Hidden for presenting, Display unplugged, Floating collapsed strip
- [ ] No click on the call window moves focus from the call app (XCUITest)
- [ ] A layout switch, a hide and a WebView crash each keep the transcript position, marks and pins
- [ ] **Continue Recording** works for 5 minutes after any stop and appends a gap row
- [ ] Capture failures are announced once, assertively; transcript lines never

## 7. Additional Context

**Prototype reuse.** Rewritten in React with the same structure, classes, tokens and data attributes: `surface('call')` in `src/js/20-b-surface.js` (both layouts, the notice slot, the closing state, the share warning), `C.captureNotice`, `C.callStatusStrip` and `C.collapsedCallStrip` in `src/js/20-b-components.js`, `C.recordingIndicator`, `C.personChip` and the `call.makeSensitive` behaviour in `src/js/04-shared.js`. Styles `.cw-*`, `.cs-*` and `.fp-*` (`src/css/20-b.css`) are ported as-is. Not reusable: the call window's prototype bar (`.cw-proto`: layout, output route, simulated card, card keys, make key), `NP.local('cw')`, `onDemo`, the "The call window closed" desk placeholder with **Open Main Window** and **Start a New Recording** (prototype chrome), and the clock ticker (the core sends `recorded_ms`).

**States coverage.**

| DESIGN state (shell, call screen, floating panel) | Prototype Call window › State ▾ |
| --- | --- |
| Call ended, countdown; Call seems to have ended | `call-ended` |
| New meeting | `new-meeting` |
| Nothing heard yet; Waiting for speech | `nothing-heard` |
| Closing after a manual stop; Stopped by the user | `closing-manual` |
| Closing after an automatic stop; Stopped automatically | `closing-auto` |
| System audio silent | `mic-only` |
| Microphone off | `mic-off` |
| Not recording · engine stopped | `engine-stopped` |
| Transcription stalled | `stalled` |
| Disk nearly full | `disk` |
| Second audio source | `second-source` |
| Paused | `paused` |
| Hidden for presenting | `presenting` |
| Display unplugged | `unplugged` |
| Collapsed | `collapsed` |
| Copilot flag off | `copilot-off` |
| Not key, Shown by ⌃⌥⌘N, Key while typing | the call window's prototype bar › make key |
| Display connected again, Panel would land off screen, Chosen display not connected | placement by the core; Settings › `display-absent` |
| Notice while collapsed | `collapsed` then `call-ended` |
| Hidden by the user | **Hide** (desk placeholder in the prototype) |
| Share warning, first open | floating layout first open |
| Made sensitive during the call | ⋯ › **Make This Call Sensitive** |
| Reopened after a UI crash; Closed by a crash | not drawn; behaviour per the store's snapshot rule |
| Device changed | not in the prototype (listed in `docs/DECOMPOSITION.md`); rendered with the gap-row style |
| No card yet, Card too late, Cards held, Pinned by key, Card key taken, Card keys released, No card with that number, Catch-up being written, Asked about the call, Switched to local, Budget near the cap, Sensitive call (copilot), Copilot muted, Single-agent copilot, Screen context, Degraded copilot banners | `listening`, `held`, `carry`, `single`, `muted`, `switched-local`, `budget`, `sensitive-off`, `key-taken`, `default` — `cpt-noter-feature-ui-copilot` (M4) |
| No matching person | `cpt-noter-feature-ui-speakers` (M2) |

**Milestone notes.** The M1 stories `cpt-noter-seq-floating-panel-display-unplugged` (step 4 pins card 2) and `cpt-noter-seq-floating-panel-collapse-strip` (card line, **Pin** from the strip, Copilot muted while collapsed) contain copilot steps whose commands are M4 and draft; M1 proves them in the copilot-off layout, and `cpt-noter-feature-ui-copilot` proves the card steps in M4 (discrepancy 4). The **Summary ready** steps of the stop and presenting stories are proven in M2 (discrepancy 6).

**Not applicable.** Alerts and sheets in this window: none by design (D38). Data: the window reads the capture state and the transcript; it writes nothing itself.
