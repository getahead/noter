---
title: "Feature — Call page frame and transcript"
description: "The page of one call in the main window from M1: toolbar with the view control, the ⋯ menu (rename, call type, sensitive, Delete Call…), the banner slot with the notification-permission banner, Call info and the stored transcript with replay."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-call-page-frame
milestone: M1
---

# Feature: Call page frame and transcript


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Open a call's page](#open-a-calls-page)
  - [Manage the call from its ⋯ menu](#manage-the-call-from-its--menu)
  - [Allow summary notifications](#allow-summary-notifications)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Views delivered so far](#views-delivered-so-far)
- [4. States (CDSL)](#4-states-cdsl)
  - [Call page frame](#call-page-frame)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Frame, Call info and stored transcript](#frame-call-info-and-stored-transcript)
  - [⋯ menu and the notification banner](#menu-and-the-notification-banner)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p2` - **ID**: `cpt-noter-featstatus-ui-call-page-frame`

## 1. Feature Context

- [ ] `p2` - `cpt-noter-feature-ui-call-page-frame`

### 1.1 Overview

Every call gets a page in the main window, pushed from the Calls list, **Open in Noter** in the call window, **Open Last Summary** in the menu bar or a notification. In M1 the page has its frame and the stored transcript: the toolbar (Back, title and subtitle, the view control, **Share** placeholder, ⋯ More, the inspector toggle), the banner slot PC-R2, Call info in the inspector slot, and the **Transcript** view with replay on any output. The outputs (**Summary**, items, review, naming, share, **Agent Reviews**, **History**) plug into this frame in M2 and M4. After a stop the page loads in the background without taking focus (D81).

### 1.2 Purpose

It implements the frame of `cpt-noter-component-screen-call-page` (PC-R1, PC-R2, PC-R4 Call info, PC-R5, PC-R6). milestones.toml places `cpt-noter-seq-dialogs-delete-call` and `cpt-noter-seq-notifications-allow-notifications` in M1, and both start on a call's page, so the frame ships in M1 although PRD › Parallel UI and core work lists the Call page under M2 (`docs/DECOMPOSITION.md`, discrepancy 1).

**Requirements**: PRD › Feature specification › 2 (stored transcript and replay after the call); PRD › Feature specification › 4 (the page that will hold the outputs); PRD › Security, privacy and permissions › Deletion. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-core-owns-state`, `cpt-noter-principle-never-steal-focus`, `cpt-noter-principle-privacy-visible`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Opens a call, reads and replays its transcript, renames it, sets its type or marks it sensitive, deletes it, allows notifications |
| Noter core (system) | Returns the call view, streams the stored transcript, plays audio, deletes, asks macOS for the Notifications permission, sends the page to the main window after a stop |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 4. Post-call outputs
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Screen — Call page (Regions PC-R1, PC-R2, PC-R4, PC-R5, PC-R6; Elements ⋯ More, inspector toggle, Call info, Transcript header, **Notify Me When Summaries Are Ready**; States Loading the stored transcript, First recorded call, Opened from a notification, Audio no longer kept)
- **Design elements**: `cpt-noter-component-screen-call-page` (frame); uses `cpt-noter-component-ui-transcript-view` (stored variant), `cpt-noter-component-ui-playback-bar`, `cpt-noter-component-ui-person-chip`, `cpt-noter-component-ui-mode-indicator`, `cpt-noter-component-ui-inline-banner`
- **Stories**: serves `cpt-noter-seq-dialogs-delete-call` (Happy path) and `cpt-noter-seq-notifications-allow-notifications` (Happy path), owned by `cpt-noter-feature-ui-dialogs-host` and `cpt-noter-feature-ui-notifications`
- **Frozen commands it calls**: `call_get`, `call_update`, `call_types_list`, `capture_set_sensitive`, `transcript_subscribe`, `audio_play`, `audio_stop`, `permission_request` (notifications), `window_report_view`, `open_external` (**Show in Finder**); `calls_delete` through the dialog host
- **Events**: `entity:changed`, `nav:request`, `outputs:progress`, `env:changed` (notification permission)
- **Prototype modules**: `src/js/30-c-callpage.js` (`screen('call-page')` toolbar, ⋯ menu, view control, `inspector('call-info')`, the Transcript view, the notifications banner), `src/css/30-c.css` (`.pc-*`)
- **Dependencies**: `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-live-transcript`, `cpt-noter-feature-ui-dialogs-host`

## 2. Actor Flows (CDSL)

### Open a call's page

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-page-frame-open`

**Actor**: Primary user

**Success Scenarios**:
- From Calls, **Open in Noter**, **Open Last Summary** or a notification, the page shows the call's title, **Today 10:00 · 48 min · Anna K., Pavel, Dmitri S., You**, the view control, Call info docked in Wide, and the transcript
- After a stop the page loads in the main window without taking focus

**Error Scenarios**:
- The call is gone (`not_found`): the page shows the empty state and Back returns to Calls
- The read fails: the section error with **Try Again**

**Steps**:
1. [ ] - `p1` - User or core opens the route `call_page` (call id, tab, optional span) - `inst-open-route`
2. [ ] - `p1` - API: `call_get` (call id) - `inst-api-get`
3. [ ] - `p1` - **IF** the result is `not_found` - `inst-if-gone`
   1. [ ] - `p1` - **RETURN** the empty state with Back to Calls - `inst-return-gone`
4. [ ] - `p1` - UI: PC-R1 with Back, the title (tail-truncated, full title in a help tag), the subtitle, the view control listing only the views delivered so far (**Transcript** in M1; **Summary**, **Agent Reviews** and **History** join in M2 and M4), ⋯ More and the inspector toggle (⌥⌘I) - `inst-toolbar`
5. [ ] - `p1` - API: `window_report_view` (call id), so the core sends no notification for the call this window shows; `null` when the page closes - `inst-api-report`
6. [ ] - `p1` - UI: PC-R4 Call info at 280 pt in Wide (overlay in Medium and Narrow): **Participants** (person chips), **Call** (**Type**, **App**, **When**, **Length**, **Languages**), **Privacy** (the mode indicator and a **Sensitive** switch), **Audio** (**Kept until 15 Nov**, or **Audio deleted on 15 Nov · transcript kept**), **Processing** - `inst-call-info`
7. [ ] - `p1` - Flow: the stored transcript with `cpt-noter-flow-ui-live-transcript-stored` in PC-R5, with the playback bar PC-R6 from the first play - `inst-transcript`
8. [ ] - `p1` - **IF** the core opened the page after a stop (`nav:request` without activation) - `inst-if-background`
   1. [ ] - `p1` - UI: render without taking focus or activating the window - `inst-background`
9. [ ] - `p1` - **RETURN** the call's page - `inst-return-open`

### Manage the call from its ⋯ menu

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-page-frame-more-menu`

**Actor**: Primary user

**Success Scenarios**:
- **Rename…** and **Call Type ▸** change the title and type in place
- **Mark as Sensitive** turns the call sensitive; the menu then shows a checked **Sensitive**
- **Show in Finder** reveals the call's folder
- **Delete Call…** (⌘⌫) opens the delete alert; after **Delete** the Library's **Calls** list shows

**Error Scenarios**:
- `conflict` on rename or type: the page shows the core's current values
- **Regenerate Outputs…** and **Show Performance** are shown once their features land (M2, M5)

**Steps**:
1. [ ] - `p1` - User opens ⋯ More - `inst-user-more`
2. [ ] - `p1` - **MATCH** the item - `inst-match-more`
   - [ ] - `p1` - **CASE** **Rename…**: an inline field in the title; Return saves with `call_update` (title, `rev`) - `inst-case-rename`
   - [ ] - `p1` - **CASE** **Call Type ▸**: the types from `call_types_list`; `call_update` (type) - `inst-case-type`
   - [ ] - `p1` - **CASE** **Mark as Sensitive** or the Call info **Sensitive** switch: `capture_set_sensitive` (call id, true) - `inst-case-sensitive`
   - [ ] - `p1` - **CASE** **Show in Finder**: `open_external` (the call's folder) - `inst-case-finder`
   - [ ] - `p1` - **CASE** **Delete Call…**: Flow `cpt-noter-flow-ui-dialogs-host-delete-call` with this call - `inst-case-delete`
3. [ ] - `p1` - **RETURN** the page with the change, or Library › **Calls** after a delete - `inst-return-more`

### Allow summary notifications

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-page-frame-notifications-banner`

**Actor**: Primary user

**Success Scenarios**:
- After the first recorded call, PC-R2 shows **Get a notification when a call's summary is ready.** with **Notify Me When Summaries Are Ready** and ×; the button brings up the macOS prompt; after **Allow** the banner goes away

**Error Scenarios**:
- **Don't Allow**: the banner goes away; ready and failed states stay visible in Noter; Settings › General shows **Notifications are off for Noter**
- × closes the banner and leaves notifications off without asking

**Steps**:
1. [ ] - `p1` - Core: the app snapshot reports that the Notifications permission was never asked and a call was recorded - `inst-core-not-asked`
2. [ ] - `p1` - UI: the info banner in PC-R2 (one banner at a time, by the slot order) - `inst-banner`
3. [ ] - `p1` - User clicks **Notify Me When Summaries Are Ready** - `inst-user-notify`
4. [ ] - `p1` - API: `permission_request` (notifications); macOS shows its prompt - `inst-api-permission`
5. [ ] - `p1` - **IF** the user closes the banner with × - `inst-if-close`
   1. [ ] - `p1` - UI: hide the banner as local view state for this window's lifetime; send no command and show no prompt (`banner_dismiss` has no notification-consent `BannerKind`; persisting the dismissal is a contract gap for the owner) - `inst-local-dismiss`
6. [ ] - `p1` - **RETURN** the banner gone, notifications allowed or not - `inst-return-banner`

## 3. Processes / Business Logic (CDSL)

### Views delivered so far

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-call-page-frame-views`

**Input**: the feature flags and registered page views, the requested tab

**Output**: the view control's segments and the view to show

**Steps**:
1. [ ] - `p1` - List the views in DESIGN's order (**Summary**, **Transcript**, **Agent Reviews**, **History**) that a delivered feature has registered - `inst-list-views`
2. [ ] - `p1` - **IF** the requested tab is not registered: show **Transcript** - `inst-fallback`
3. [ ] - `p1` - At Narrow width render the segments as a pop-up button - `inst-narrow`
4. [ ] - `p1` - **RETURN** the segments and the view - `inst-return-views`

## 4. States (CDSL)

### Call page frame

- [ ] `p1` - **ID**: `cpt-noter-state-ui-call-page-frame-page`

**States**: LOADING, READY, NOT_FOUND, ERROR, DELETED

**Initial State**: LOADING

**Transitions**:
1. [ ] - `p1` - **FROM** LOADING **TO** READY **WHEN** `call_get` returns the call (skeleton rows after 300 ms until then) - `inst-loading-ready`
2. [ ] - `p1` - **FROM** LOADING **TO** NOT_FOUND **WHEN** the call no longer exists - `inst-loading-notfound`
3. [ ] - `p1` - **FROM** LOADING **TO** ERROR **WHEN** the read fails - `inst-loading-error`
4. [ ] - `p1` - **FROM** ERROR **TO** LOADING **WHEN** the user chooses **Try Again** - `inst-error-loading`
5. [ ] - `p1` - **FROM** READY **TO** DELETED **WHEN** the user deletes the call; the route moves to Library › **Calls** - `inst-ready-deleted`
6. [ ] - `p1` - **FROM** READY **TO** READY **WHEN** `entity:changed` reports a new title, type, sensitivity or audio state; the page re-renders - `inst-ready-ready`

## 5. Definitions of Done

### Frame, Call info and stored transcript

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-call-page-frame-frame`

The system **MUST** render PC-R1, PC-R2, PC-R4 Call info, PC-R5 and PC-R6 as the prototype's `screen('call-page')` and `inspector('call-info')` render them, with the view control listing only delivered views, the stored transcript of `cpt-noter-feature-ui-live-transcript`, background loading after a stop, and `window_report_view` on show and close.

**Implements**:
- `cpt-noter-flow-ui-call-page-frame-open`
- `cpt-noter-algo-ui-call-page-frame-views`
- `cpt-noter-state-ui-call-page-frame-page`

**Constraints**: `cpt-noter-constraint-local-only-ui`

**Touches**:
- Commands: `call_get`, `transcript_subscribe`, `audio_play`, `audio_stop`, `window_report_view`
- Tests: screenshot specs of the Transcript view, Call info (audio kept, audio deleted) and the loading state; unit tests for the view list

### ⋯ menu and the notification banner

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-call-page-frame-actions`

The system **MUST** offer **Rename…**, **Call Type ▸**, **Mark as Sensitive**, **Show in Finder** and **Delete Call…** in ⋯ More through their commands, and show the notification-permission banner after the first recorded call with **Notify Me When Summaries Are Ready** and ×.

**Implements**:
- `cpt-noter-flow-ui-call-page-frame-more-menu`
- `cpt-noter-flow-ui-call-page-frame-notifications-banner`

**Constraints**: `cpt-noter-constraint-notification-limits`

**Touches**:
- Commands: `call_update`, `call_types_list`, `capture_set_sensitive`, `open_external`, `permission_request`, `calls_delete`
- Tests: E2E `cpt-noter-seq-dialogs-delete-call` (Happy path from the ⋯ menu); E2E `cpt-noter-seq-notifications-allow-notifications` (Happy path) with XCUITest for the macOS prompt

## 6. Acceptance Criteria

- [ ] Opening a call from Calls, the call window, the menu bar or a notification lands on the same page
- [ ] After a stop the page loads without the main window becoming active (checked natively)
- [ ] **Delete Call…** never deletes without the alert, and lands on Library › **Calls**
- [ ] The notification banner appears only after the first recorded call and never during a call

## 7. Additional Context

**Prototype reuse.** Rewritten in React with the same structure, classes, tokens and data attributes: the toolbar, view control, ⋯ menu and inspector toggle of `screen('call-page')`, `inspector('call-info')` and the Transcript view in `src/js/30-c-callpage.js`; the notification banner (`Notify Me When Summaries`) there. Styles `.pc-*` (`src/css/30-c.css`) are ported as-is. Not reusable: `NP.local('call-page')`, the regeneration timers and the sample outputs, which belong to M2.

**States coverage.** M1 renders these rows of DESIGN's Call page States table: Loading the stored transcript, First recorded call (prototype Call page › State ▾ first-call banner), Opened from a notification (lands on the page; on **Summary** from M2), Audio no longer kept (Transcript header and Call info). Every other row belongs to `cpt-noter-feature-ui-call-page-outputs`, `cpt-noter-feature-ui-items`, `cpt-noter-feature-ui-speakers`, `cpt-noter-feature-ui-handoff` (M2) or `cpt-noter-feature-ui-copilot` (M4).

**Not applicable.** Outputs, items and sharing: M2. Data: the page reads the call view and transcript only.
