---
title: "Feature: Native surfaces: panels, menu bar, notifications and windows"
description: "Non-activating, content-protected panels; the call window's two layouts across displays; hide for presenting; the menu bar and tray; notifications through UNUserNotificationCenter; announcements, navigation and external opens; menu and hotkey actions as native callers."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M1
lane: core (src-tauri) and engine (noter-native)
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Native surfaces: panels, menu bar, notifications and windows

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Show and place the call window](#show-and-place-the-call-window)
  - [Follow a display change](#follow-a-display-change)
  - [Hide for presenting](#hide-for-presenting)
  - [Use the menu bar](#use-the-menu-bar)
  - [Allow and deliver notifications](#allow-and-deliver-notifications)
  - [Navigate, announce, report and open](#navigate-announce-report-and-open)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Place the call window](#place-the-call-window)
  - [Non-activating, content-protected panels](#non-activating-content-protected-panels)
  - [Calendar facts for detection](#calendar-facts-for-detection)
  - [Native E2E command log](#native-e2e-command-log)
- [4. States (CDSL)](#4-states-cdsl)
  - [Call window](#call-window)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Panels and placement](#panels-and-placement)
  - [Every surface hides at once](#every-surface-hides-at-once)
  - [Menu bar and native callers](#menu-bar-and-native-callers)
  - [Notifications](#notifications)
  - [Navigation, announcements, external opens and calendar](#navigation-announcements-external-opens-and-calendar)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p2` - **ID**: `cpt-noter-featstatus-core-native-surfaces`

- [ ] `p2` - `cpt-noter-feature-core-native-surfaces`

## 1. Feature Context

### 1.1 Overview

In `apps/desktop/src-tauri` and the `noter-native` crate (objc2), the core builds everything that must work while no WebView has focus. The call window and the record prompt become non-activating, content-protected NSPanels (tauri-nspanel, pinned to a commit), placed by display identity and switched between the dedicated and floating layouts when displays change. Hide for presenting removes every surface. The tray shows the recording state and a menu whose items call the core as `Caller::Native`. Notifications go through `UNUserNotificationCenter` with a thread per call and a `NavTarget`, and a click becomes `nav:request`. EventKit is read for detection matching. Window commands, announcements and external opens complete the set.

> **M1 decisions (Backend Teamlead, 21 Oct 2026).** `CallWindowState`, `PresentingState`, the record prompt request and all ten commands of this feature live in noter-core behind the `Surfaces` trait on `CoreDeps`; `src-tauri` implements it over noter-native and the harness has a scripted implementation that records calls and answers the display list, so the window-free parts of the stories are proven through the harness (TL-2). The tray shows the privacy mode from `Settings.privacy.mode` and updates on `settings:changed`; `PrivacyStatus` is M2 (TL-10). The XCUITest stories (display unplugged, allow notifications, and the AppKit half of the others) wait for the UI lane; until then the core halves are proven by story-named conformance tests (TL-7).

### 1.2 Purpose

During a call Noter must never steal focus from the call app, never appear in a screen share, and keep every quick action within a second of the click, without a dialog.

**Requirements**: PRD › Live copilot › Surfaces (call window, floating panel, menu bar, notifications); PRD › Live copilot › Surfaces › Menu bar (every quick action within a second, no dialog after setup).

**Principles**: `cpt-noter-principle-core-degrade`

**Delivers**:
- Frozen commands (M1): `window_show_call`, `window_hide_call`, `window_call_state`, `window_set_call_layout`, `window_set_collapsed`, `app_set_hidden_for_presenting`, `window_navigate`, `window_announce`, `window_report_view`, `open_external`.
- Events: `window:call`, `app:presenting`, `nav:request`.
- DESIGN.md stories (M1): `cpt-noter-seq-call-screen-hide-for-presenting`, `cpt-noter-seq-floating-panel-display-unplugged`, `cpt-noter-seq-floating-panel-collapse-strip`, `cpt-noter-seq-floating-panel-hide-and-reopen`, `cpt-noter-seq-menu-bar-check-state`, `cpt-noter-seq-notifications-allow-notifications`; the menu bar half of `cpt-noter-seq-menu-bar-control-recording`.
- The app's E2E command log for native callers (`NOTER_E2E_LOG_DIR`), so XCUITest runs count toward the E2E bar.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Uses the call window and floating panel, the menu bar, hotkeys and notifications |
| UI window (call window, main, record prompt, Settings, First run) | Calls window commands; receives `window:call`, `app:presenting`, `nav:request` |
| macOS (AppKit, displays, Notification Center, EventKit, Accessibility) | Hosts panels, reports displays, delivers notifications and clicks, reads calendars, speaks announcements |
| Capture session | Asks to show the prompt and the call window; decides when a notification is sent |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-native-surfaces`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-native`, 3.5 macOS services, decisions C19 (notifications) and C10 (`call-screen` label)
- **Harness**: [HARNESS.md](../../HARNESS.md) › Native UI tests (XCUITest)
- **Dependencies**: `cpt-noter-feature-core-capture-session`, `cpt-noter-feature-core-settings`

## 2. Actor Flows (CDSL)

### Show and place the call window

- [x] `p1` - **ID**: `cpt-noter-flow-core-native-surfaces-call-window`

**Actor**: Primary user (Open Call Screen, the hotkey, the menu), or the capture session at start

**Success Scenarios**:
- The call window appears on the chosen call display without focus; a second request makes it key (PM-40).
- The user chooses the dedicated or floating layout, collapses the floating panel to one line, hides it and brings it back with one key.

**Error Scenarios**:
- The chosen display is not connected: the window opens on the main display and `chosen_display_missing` is true.
- Collapse is asked in the dedicated layout: the state is returned unchanged.

**Steps**:
1. [x] - `p1` - API: `window_show_call` from the main window, the record prompt or the call window, or the same call from a native surface - `inst-show-call`
2. [x] - `p1` - **IF** the window is visible and not key, make it key; **ELSE** show it without activation on the display chosen by `cpt-noter-algo-core-native-surfaces-placement` - `inst-show-or-key`
3. [x] - `p1` - API: `window_set_call_layout { preference }`, `window_set_collapsed { collapsed }`, `window_hide_call {}` change the layout, the strip state or visibility - `inst-layout-commands`
4. [x] - `p1` - Emit `window:call` with the whole `CallWindowState` and a new version - `inst-emit-window`
5. [x] - `p1` - **RETURN** `CallWindowState`; `window_call_state {}` returns it unchanged - `inst-return-window`

### Follow a display change

- [x] `p1` - **ID**: `cpt-noter-flow-core-native-surfaces-display-change`

**Actor**: macOS (a display is unplugged or plugged in)

**Success Scenarios**:
- The user undocks during a call; the call carries on in the floating panel on the laptop display with its cards, pins and transcript; docking again restores the dedicated layout on the call display.

**Error Scenarios**:
- No display matches any saved identity: the main display and the floating layout are used.

**Steps**:
1. [x] - `p1` - Receive the screen-parameters change and re-read displays by identity - `inst-read-displays`
2. [x] - `p1` - Run `cpt-noter-algo-core-native-surfaces-placement` for the call window - `inst-replace`
3. [x] - `p1` - Emit `env:changed` (displays) and `window:call` - `inst-emit-displays`
4. [x] - `p1` - **RETURN** - `inst-return-display`

### Hide for presenting

- [x] `p1` - **ID**: `cpt-noter-flow-core-native-surfaces-presenting`

**Actor**: Primary user (one key, the menu, the call window)

**Success Scenarios**:
- Before sharing the whole display, every Noter surface hides; recording continues; the menu bar icon alone shows state; a new meeting appears only as a menu bar line; afterwards everything comes back as it was.

**Error Scenarios**:
- Asked to hide while already hidden (wanted state): the current state is returned.

**Steps**:
1. [x] - `p1` - API: `app_set_hidden_for_presenting { hidden }` from the call window or main window, or the hotkey as a native caller - `inst-presenting-call`
2. [x] - `p1` - **IF** `hidden`, remember which surfaces were visible and hide every window and panel; **ELSE** restore them - `inst-hide-restore`
3. [x] - `p1` - Tell the capture session (notification hold, `CallSeemsEnded` timing) and unregister card keys while hidden (they are registered by the copilot from M4) - `inst-tell-session`
4. [x] - `p1` - While hidden, show a new-meeting notice as a menu bar line whose start item calls `capture_answer_new_meeting(start_as_new_call)` - `inst-menu-new-meeting`
5. [x] - `p1` - Emit `app:presenting` with the whole `PresentingState` - `inst-emit-presenting`
6. [x] - `p1` - **RETURN** `PresentingState` - `inst-return-presenting`

### Use the menu bar

- [x] `p1` - **ID**: `cpt-noter-flow-core-native-surfaces-menu-bar`

**Actor**: Primary user (status item)

**Success Scenarios**:
- One click shows whether Noter is recording, which call, and where text may go (the privacy mode); **Mark**, **Pause** and **Stop** take effect within a second, with no dialog.

**Error Scenarios**:
- The core refuses an action (for example `not_recording`): the menu item is shown disabled at the next update; no dialog appears.

**Steps**:
1. [x] - `p1` - Build the tray menu and title from `CaptureState`, the call title and `PrivacyStatus`; update them on `capture:state` and `privacy:changed` - `inst-build-menu`
2. [x] - `p1` - Set the tray glyph: idle, recording, paused, or copilot muted - `inst-glyph`
3. [x] - `p1` - On a menu click, call the matching core command in process as a native caller from the menu bar surface - `inst-menu-click`
4. [x] - `p1` - **RETURN** - `inst-return-menu`

### Allow and deliver notifications

- [x] `p1` - **ID**: `cpt-noter-flow-core-native-surfaces-notifications`

**Actor**: Primary user (allows notifications from the call's page after a first call); the capture session (asks to send)

**Success Scenarios**:
- The user turns on notifications; macOS asks once; `EnvironmentState.notifications` becomes `authorized`.
- A notification the session decided to send is posted with the call's thread and a `NavTarget`; a click brings the main window to that target.

**Error Scenarios**:
- The user denies: `notifications: denied`; `permission_denied` from `permission_request`; nothing is posted later.
- The system prompt must not appear during a meeting: the UI offers the request only from the call's page after a call (DESIGN.md), and the core never asks on its own.

**Steps**:
1. [x] - `p1` - `permission_request { kind: notifications }` (`cpt-noter-flow-core-first-run-permission`) calls `requestAuthorization` through `noter-native` - `inst-request-auth`
2. [x] - `p1` - Read the notification settings into `EnvironmentState.notifications` (`not_determined`, `denied`, `authorized`) at launch and on change; emit `env:changed` - `inst-read-auth`
3. [x] - `p1` - When the session's rule (`cpt-noter-algo-core-capture-session-notify`) says send, post through `UNUserNotificationCenter` with `threadIdentifier` = call id and `userInfo` = `NavTarget` - `inst-post`
4. [x] - `p1` - On a click, emit `nav:request` with the `NavTarget` and bring the main window forward - `inst-click`
5. [x] - `p1` - **RETURN** - `inst-return-notify`

### Navigate, announce, report and open

- [x] `p2` - **ID**: `cpt-noter-flow-core-native-surfaces-navigation`

**Actor**: UI window

**Success Scenarios**:
- `window_navigate` shows the main or Settings window at a place; `window_announce` speaks text for a panel that is not key; `window_report_view` tells the core which call the main window shows; `open_external` opens a URL, a document citation, a System Settings pane or a Finder location.

**Error Scenarios**:
- `open_external` with a scheme outside the allowed list: `invalid_input`.

**Steps**:
1. [x] - `p1` - API: `window_navigate { target }`: show the right window and emit `nav:request` to it - `inst-navigate`
2. [x] - `p1` - API: `window_announce { text, politeness }`: post an NSAccessibility announcement - `inst-announce`
3. [x] - `p1` - API: `window_report_view { call_id }`: store it for the notification rule - `inst-report-view`
4. [x] - `p1` - API: `open_external { target }`: open through Launch Services (`https`, document paths the core gave the UI, `x-apple.systempreferences:` panes, reveal in Finder); **IF** the target is not allowed **RETURN** `invalid_input` - `inst-open-external`
5. [x] - `p1` - **RETURN** `Ack` - `inst-return-nav`

## 3. Processes / Business Logic (CDSL)

### Place the call window

- [ ] `p1` - **ID**: `cpt-noter-algo-core-native-surfaces-placement`

**Input**: Displays by identity, the chosen call display, the layout preference, the saved frames per display.

**Output**: Display, layout and frame for the call window; `chosen_display_missing`.

**Steps**:
1. [x] - `p1` - **IF** the chosen call display is connected, use it with the preferred layout (dedicated by default) - `inst-chosen-display`
2. [x] - `p1` - **ELSE** use the display with the main window, the floating layout, and set `chosen_display_missing` - `inst-fallback-display`
3. [ ] - `p1` - Restore the saved frame for that display and layout, clamped to the visible frame - `inst-frame`
4. [x] - `p1` - **RETURN** the placement - `inst-return-placement`

### Non-activating, content-protected panels

- [ ] `p1` - **ID**: `cpt-noter-algo-core-native-surfaces-panels`

**Input**: The call window and record prompt at creation.

**Output**: NSPanels that take clicks without becoming key and do not appear in screen sharing.

**Steps**:
1. [ ] - `p1` - Convert the windows to NSPanel with the non-activating style through tauri-nspanel (pinned commit) - `inst-convert`
2. [x] - `p1` - Set the sharing type so screen capture excludes them - `inst-content-protect`
3. [x] - `p1` - Keep them above normal windows on every Space while a call runs - `inst-level`
4. [ ] - `p1` - **RETURN** - `inst-return-panels`

### Calendar facts for detection

- [x] `p2` - **ID**: `cpt-noter-algo-core-native-surfaces-calendar`

**Input**: Calendar authorization; a time window.

**Output**: Events running now or starting within 10 minutes, for detection matching and new-meeting notices.

**Steps**:
1. [x] - `p1` - **IF** calendar access is not granted, **RETURN** none (never ask here; asking is `permission_request`) - `inst-no-access`
2. [x] - `p1` - Read events from EventKit for the window - `inst-read-events`
3. [x] - `p1` - **IF** the read fails, add `CalendarAccessDenied` or log it, and **RETURN** none - `inst-read-fail`
4. [x] - `p1` - **RETURN** the events as `CalendarEventRef` - `inst-return-events`

### Native E2E command log

- [ ] `p2` - **ID**: `cpt-noter-algo-core-native-surfaces-e2e-log`

**Input**: A debug build started with `NOTER_E2E_LOG_DIR`.

**Output**: `commands-native-app-<pid>.json` with the names of commands the core ran successfully, from windows and native callers, written on quit.

**Steps**:
1. [ ] - `p1` - **IF** `NOTER_E2E_LOG_DIR` is not set or the build is a release build, do nothing - `inst-log-off`
2. [ ] - `p1` - Record the name of every command that returned a result, whatever the caller - `inst-log-record`
3. [ ] - `p1` - On quit, write `{ "suite": "native", "target": "app", "commands": [...], "stories": [] }` with names only, no content - `inst-log-write`
4. [ ] - `p1` - **RETURN** - `inst-log-return`

## 4. States (CDSL)

### Call window

- [x] `p1` - **ID**: `cpt-noter-state-core-native-surfaces-call-window`

**States**: hidden, shown_inactive, key, collapsed, hidden_for_presenting

**Initial State**: hidden

**Transitions**:
1. [x] - `p1` - **FROM** hidden **TO** shown_inactive **WHEN** capture starts or `window_show_call` - `inst-st-show`
2. [x] - `p1` - **FROM** shown_inactive **TO** key **WHEN** a second `window_show_call`, or the user clicks into a text field - `inst-st-key`
3. [x] - `p1` - **FROM** shown_inactive **TO** collapsed **WHEN** `window_set_collapsed(true)` in the floating layout - `inst-st-collapse`
4. [x] - `p1` - **FROM** collapsed **TO** shown_inactive **WHEN** `window_set_collapsed(false)` - `inst-st-expand`
5. [x] - `p1` - **FROM** shown_inactive **TO** hidden **WHEN** `window_hide_call` - `inst-st-hide`
6. [x] - `p1` - **FROM** shown_inactive **TO** hidden_for_presenting **WHEN** `app_set_hidden_for_presenting(true)` (also from key and collapsed) - `inst-st-presenting`
7. [x] - `p1` - **FROM** hidden_for_presenting **TO** shown_inactive **WHEN** `app_set_hidden_for_presenting(false)` and it was visible before - `inst-st-unhide`

## 5. Definitions of Done

### Panels and placement

- [ ] `p1` - **ID**: `cpt-noter-dod-core-native-surfaces-panels`

The system **MUST** make the call window and the record prompt non-activating, content-protected panels, place the call window by display identity, switch layouts on display changes, and answer the window commands with a versioned `CallWindowState`.

**Implements**:
- `cpt-noter-flow-core-native-surfaces-call-window`
- `cpt-noter-flow-core-native-surfaces-display-change`
- `cpt-noter-algo-core-native-surfaces-placement`
- `cpt-noter-algo-core-native-surfaces-panels`
- `cpt-noter-state-core-native-surfaces-call-window`

**Constraints**: `cpt-noter-constraint-core-macos`

**Touches**:
- API: `window_show_call`, `window_hide_call`, `window_call_state`, `window_set_call_layout`, `window_set_collapsed`, `window:call`
- Entities: `CallWindowState`

### Every surface hides at once

- [ ] `p1` - **ID**: `cpt-noter-dod-core-native-surfaces-presenting`

The system **MUST** hide every surface with one action while recording continues, show state only on the menu bar while hidden, route a new meeting to a menu bar line, and restore what was visible.

**Implements**:
- `cpt-noter-flow-core-native-surfaces-presenting`

**Touches**:
- API: `app_set_hidden_for_presenting`, `app:presenting`
- Entities: `PresentingState`

### Menu bar and native callers

- [ ] `p1` - **ID**: `cpt-noter-dod-core-native-surfaces-menu-bar`

The system **MUST** show recording state, the call and the privacy mode in the tray menu with the four glyphs, and call the core in process as `Caller::Native` from menu items, so each action takes effect within a second; XCUITest drives every menu item (UI lane writes the tests; this feature provides the behaviour and the command log).

**Implements**:
- `cpt-noter-flow-core-native-surfaces-menu-bar`
- `cpt-noter-algo-core-native-surfaces-e2e-log`

**Touches**:
- Entities: tray menu, `Caller::Native`

### Notifications

- [x] `p1` - **ID**: `cpt-noter-dod-core-native-surfaces-notifications`

The system **MUST** use `UNUserNotificationCenter` through `noter-native` (not `tauri-plugin-notification`): request authorization only from `permission_request`, report it in `EnvironmentState.notifications`, post with a thread per call and a `NavTarget`, and turn a click into `nav:request`.

**Implements**:
- `cpt-noter-flow-core-native-surfaces-notifications`

**Touches**:
- API: `permission_request` (notifications), `nav:request`, `env:changed`
- Entities: `NotificationAuth`, `NavTarget`

### Navigation, announcements, external opens and calendar

- [ ] `p2` - **ID**: `cpt-noter-dod-core-native-surfaces-navigation`

The system **MUST** answer `window_navigate`, `window_announce`, `window_report_view` and `open_external` (allowed targets only), and read EventKit for detection matching only after calendar access was granted.

**Implements**:
- `cpt-noter-flow-core-native-surfaces-navigation`
- `cpt-noter-algo-core-native-surfaces-calendar`

**Touches**:
- API: `window_navigate`, `window_announce`, `window_report_view`, `open_external`
- Entities: `CalendarEventRef`

## 6. Acceptance Criteria

- [ ] Story `cpt-noter-seq-call-screen-hide-for-presenting`: one key hides every surface, recording continues, the same key restores them (XCUITest on the macOS runner).
- [ ] Stories `cpt-noter-seq-floating-panel-display-unplugged`, `cpt-noter-seq-floating-panel-collapse-strip` and `cpt-noter-seq-floating-panel-hide-and-reopen`: the call carries on in the floating panel after a display change, collapses to one line and comes back with one key (XCUITest).
- [ ] Stories `cpt-noter-seq-menu-bar-check-state` and `cpt-noter-seq-menu-bar-control-recording`: the menu shows state, call and privacy mode; mark, pause and stop take effect within a second (XCUITest, plus core tests as `Caller::Native`).
- [ ] Story `cpt-noter-seq-notifications-allow-notifications`: authorization is requested only from the call's page after a call; a notification click navigates to its target (XCUITest).
- [ ] The call window and record prompt never become key on show and do not appear in a screen capture.
- [ ] Every window command and `open_external` succeeds at least once in E2E runs (Playwright through the harness for the window-free parts, the native command log for the rest).
- [ ] `just gate` passes, `just native` included.
