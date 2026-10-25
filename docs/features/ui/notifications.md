---
title: "Feature — Notifications"
description: "Native Noter notifications without buttons: Summary ready, Couldn't write the summary and capture problems while no Noter surface is visible, with titles and counts only, held during a recording and while hidden for presenting, allowed from a call's page."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-notifications
milestone: M1
---

# Feature: Notifications


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Turn on summary notifications](#turn-on-summary-notifications)
  - [Receive and open a notification](#receive-and-open-a-notification)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Send rule](#send-rule)
- [4. States (CDSL)](#4-states-cdsl)
  - [Notification permission](#notification-permission)
  - [One notification](#one-notification)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Content, send rules and clicks](#content-send-rules-and-clicks)
  - [Permission from a call's page](#permission-from-a-calls-page)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p2` - **ID**: `cpt-noter-featstatus-ui-notifications`

## 1. Feature Context

- [ ] `p2` - `cpt-noter-feature-ui-notifications`

### 1.1 Overview

Noter sends three native notifications: NT-1 **Summary ready**, NT-2 **Couldn't write the summary** and NT-3 for a capture problem while no Noter surface is visible (**System audio silent**, **Microphone off**, **Not recording · engine stopped**). They carry titles and counts only, no buttons and no sound, one thread per call. They start only after the user allowed them from a call's page; they wait while a call is being recorded and while Noter is hidden for presenting, and arrive one per call afterwards; NT-3 is never held and never sent while hidden. Noter works fully with notifications denied.

**Native parts.** macOS draws the notifications; the core decides when to send each one and posts it through the Tauri notification plugin (core lane). This feature owns their content and send rules, the permission request on a call's page, the notifications-off line in Settings, what each click opens, and the native tests.

### 1.2 Purpose

It implements `cpt-noter-component-screen-notifications`.

**Requirements**: REVIEW › F5 (notifications without buttons); PRD › Security, privacy and permissions (Notifications asked only when needed); PM-31, PM-44, PM-67. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-never-steal-focus`, `cpt-noter-principle-privacy-visible`, `cpt-noter-principle-degrade-visibly`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Allows or denies notifications, clicks a notification |
| Noter core (system) | Decides, holds, combines and posts notifications; opens the page a click asks for |
| macOS (system) | Shows the permission prompt and draws notifications in Notification Centre |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Security, privacy and permissions
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Screen — Notifications; Screen — Call page (First recorded call); Screen — Settings window (Notifications off)
- **Design elements**: `cpt-noter-component-screen-notifications`
- **Stories**: `cpt-noter-seq-notifications-allow-notifications` (M1); NT-1 and NT-2 clicks are proven with `cpt-noter-seq-notifications-open-outputs` (M2, `cpt-noter-feature-ui-call-page-outputs`); NT-3 with `cpt-noter-seq-floating-panel-hide-and-reopen` (Error — Capture problem while hidden)
- **Frozen commands it calls**: `permission_request` (notifications), `window_report_view`; `open_external` (Settings › General **Open System Settings…**)
- **Events**: `env:changed` (notifications off for Noter), `nav:request` (a click)
- **Prototype modules**: `src/js/10-a-surfaces.js` (`surface('notifications')`, `NT_STATES`) — source of truth only; the banner on the Call page in `src/js/30-c-callpage.js`
- **Dependencies**: `cpt-noter-feature-ui-call-page-frame`, `cpt-noter-feature-ui-settings`

## 2. Actor Flows (CDSL)

### Turn on summary notifications

- [x] `p1` - **ID**: `cpt-noter-flow-ui-notifications-allow`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-notifications-allow-notifications`: **Get a notification when a summary is ready.** · **Notify Me When Summaries Are Ready** on the first recorded call's page, the macOS prompt, **Allow**; **Summary ready** after later calls

**Error Scenarios**:
- Error — Notifications not allowed: **Don't Allow**; no notification after the next call; **Open Last Summary — Design review · 09:30** in the menu bar opens the outputs
- Other — Turn notifications on later: Settings › General shows **Notifications are off for Noter** · **Open System Settings…**; after turning them on, **Summary ready** arrives after the next call and the line goes away

**Steps**:
1. [x] - `p1` - Flow: `cpt-noter-flow-ui-call-page-frame-notifications-banner` shows the banner and asks macOS through `permission_request` - `inst-banner-flow`
2. [x] - `p1` - **IF** the user denied, or turned notifications off in System Settings - `inst-if-denied`
   1. [x] - `p1` - Core: `env:changed` reports notifications off; Settings › General shows **Notifications are off for Noter** with **Open System Settings…** (`open_external`) - `inst-off-line`
   2. [x] - `p1` - UI: nothing else changes; the menu bar keeps **Open Last Summary** - `inst-nothing-else`
3. [x] - `p1` - **RETURN** notifications allowed, or off with every state still visible in Noter - `inst-return-allow`

### Receive and open a notification

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-notifications-receive`

**Actor**: Noter core

**Success Scenarios**:
- NT-1 **Summary ready** · **Planning: VHI 8.0 drawer redesign · 4 action items, 2 decisions**; a click opens the main window at the call's page
- NT-3 **System audio silent** · **Recording continues with your microphone.** while the panel is hidden; a click shows the call window with the banner

**Error Scenarios**:
- The main window already shows the call: no notification; the page announces **Summary ready** politely
- A call is being recorded: NT-1 and NT-2 wait and arrive one per call after the stop
- Hidden for presenting: nothing is sent, not even NT-3; held notifications arrive combined per call on **Show Noter**

**Steps**:
1. [ ] - `p1` - Core: outputs are written or fail, or capture has a problem - `inst-core-trigger`
2. [ ] - `p1` - Algorithm: decide with `cpt-noter-algo-ui-notifications-send-rule` - `inst-send-rule`
3. [ ] - `p1` - Core: posts the notification with its title and one-line body, in the call's thread, without sound or buttons - `inst-post`
4. [ ] - `p1` - User clicks it - `inst-user-click`
5. [ ] - `p1` - **MATCH** the notification - `inst-match-click`
   - [ ] - `p1` - **CASE** NT-1 or NT-2: `nav:request` to the call's page (**Summary** from M2) in the main window - `inst-case-nt1`
   - [ ] - `p1` - **CASE** NT-3: the core shows the call window in its layout with the degraded banner - `inst-case-nt3`
6. [ ] - `p1` - **RETURN** the place the notification names - `inst-return-receive`

## 3. Processes / Business Logic (CDSL)

### Send rule

- [x] `p1` - **ID**: `cpt-noter-algo-ui-notifications-send-rule`

**Input**: the kind (NT-1, NT-2, NT-3), the call, whether notifications were allowed, capture state, presenting state, which call page the main window reports (`window_report_view`) and whether it is frontmost, whether a call surface is visible

**Output**: send now, hold, or drop

**Steps**:
1. [x] - `p1` - **IF** notifications were never allowed or are off: **RETURN** drop (the state stays visible in Noter) - `inst-not-allowed`
2. [x] - `p1` - **IF** the kind is NT-3 - `inst-if-nt3`
   1. [x] - `p1` - **IF** Noter is hidden for presenting or a call surface is visible: **RETURN** drop (the menu bar's degraded line shows it) - `inst-nt3-drop`
   2. [x] - `p1` - **RETURN** send now (never held) - `inst-nt3-send`
3. [x] - `p1` - **IF** the frontmost main window shows this call's page: **RETURN** drop; the page announces **Summary ready** - `inst-window-front`
4. [x] - `p1` - **IF** a call is being recorded or Noter is hidden for presenting: **RETURN** hold - `inst-hold`
5. [x] - `p1` - **RETURN** send now; held ones are sent one per call (combined per call after hidden mode) when capture stops or Noter is shown - `inst-send`

## 4. States (CDSL)

### Notification permission

- [x] `p1` - **ID**: `cpt-noter-state-ui-notifications-permission`

**States**: NOT_ASKED, ALLOWED, DENIED

**Initial State**: NOT_ASKED

**Transitions**:
1. [x] - `p1` - **FROM** NOT_ASKED **TO** ALLOWED **WHEN** the user clicks **Notify Me When Summaries Are Ready** and allows the prompt - `inst-notasked-allowed`
2. [x] - `p1` - **FROM** NOT_ASKED **TO** DENIED **WHEN** the user clicks **Don't Allow** - `inst-notasked-denied`
3. [x] - `p1` - **FROM** DENIED **TO** ALLOWED **WHEN** the user turns notifications on in System Settings - `inst-denied-allowed`
4. [x] - `p1` - **FROM** ALLOWED **TO** DENIED **WHEN** the user turns them off in System Settings - `inst-allowed-denied`

### One notification

- [ ] `p1` - **ID**: `cpt-noter-state-ui-notifications-item`

**States**: PENDING, HELD, SENT, DROPPED, OPENED

**Initial State**: PENDING

**Transitions**:
1. [ ] - `p1` - **FROM** PENDING **TO** SENT **WHEN** the send rule says send now - `inst-pending-sent`
2. [ ] - `p1` - **FROM** PENDING **TO** HELD **WHEN** a call is recording or Noter is hidden for presenting (NT-1, NT-2) - `inst-pending-held`
3. [ ] - `p1` - **FROM** HELD **TO** SENT **WHEN** capture stops or Noter is shown again - `inst-held-sent`
4. [ ] - `p1` - **FROM** PENDING **TO** DROPPED **WHEN** the main window shows the call, notifications are off, or NT-3 meets a visible surface or hidden mode - `inst-pending-dropped`
5. [ ] - `p1` - **FROM** SENT **TO** OPENED **WHEN** the user clicks it - `inst-sent-opened`

## 5. Definitions of Done

### Content, send rules and clicks

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-notifications-content`

The system **MUST** supply the titles and bodies of NT-1, NT-2 and NT-3 from the string catalogue with plural rules (**1 action item**, **4 action items**), report the shown call page through `window_report_view`, and route a click to the call's page or the call window; the core applies the send rule and posts them natively.

**Implements**:
- `cpt-noter-flow-ui-notifications-receive`
- `cpt-noter-algo-ui-notifications-send-rule`
- `cpt-noter-state-ui-notifications-item`

**Constraints**: `cpt-noter-constraint-notification-limits`

**Touches**:
- Commands: `window_report_view`
- Events: `nav:request`
- Tests: XCUITest `test_cpt_noter_seq_floating_panel_hide_and_reopen__capture_problem_while_hidden` (NT-3 and its click); the NT-1 click is proven in M2

### Permission from a call's page

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-notifications-permission`

The system **MUST** ask for the Notifications permission only from **Notify Me When Summaries Are Ready** on a call's page, never at first run or during a call, and show **Notifications are off for Noter** with **Open System Settings…** in Settings › General while they are off.

**Implements**:
- `cpt-noter-flow-ui-notifications-allow`
- `cpt-noter-state-ui-notifications-permission`

**Constraints**: `cpt-noter-constraint-notification-limits`, `cpt-noter-constraint-no-dialog-after-setup`

**Touches**:
- Commands: `permission_request`, `open_external`
- Tests: E2E and XCUITest `cpt-noter-seq-notifications-allow-notifications` (every path)

## 6. Acceptance Criteria

- [ ] No notification carries a button, a quote or a name of what was said
- [ ] No notification arrives while a call is recorded, except NT-3 with no call surface visible
- [ ] Nothing is sent while hidden for presenting; held notifications arrive combined per call on **Show Noter**
- [ ] With notifications denied, the menu bar and the Call page show every ready and failed state

## 7. Additional Context

**Prototype reuse.** Source of truth only: macOS draws notifications, so `surface('notifications')` and `NT_STATES` in `src/js/10-a-surfaces.js` define the content and states; the `.nt-*` styles are not ported. The Call page banner is ported with `cpt-noter-feature-ui-call-page-frame`; the Settings line with `cpt-noter-feature-ui-settings`.

**States coverage.**

| DESIGN state | Prototype `NT_STATES` |
| --- | --- |
| Permission not asked yet | `not-asked` |
| Permission denied | `denied` |
| Outputs ready | `default` (NT-1, needs outputs in M2) |
| Outputs failed | `failed` (NT-2, M2) |
| Main window already shows the call | `window-front` |
| Capture problem, call window hidden | `capture`, `capture-mic`, `capture-engine` (NT-3) |
| Hidden for presenting; Next call already recording | `held` |
| Several calls in a row | `several` |
| Pre-call brief (v1.x) | not sent in v1 |

**Milestone notes.** milestones.toml places `cpt-noter-seq-notifications-allow-notifications` in M1; its happy path is on a call's page, which `cpt-noter-feature-ui-call-page-frame` ships in M1 (discrepancy 1). NT-1 and NT-2 need outputs (M2).

**Not applicable.** WebView rendering and screenshots: native. Data: titles and counts only (D67).
