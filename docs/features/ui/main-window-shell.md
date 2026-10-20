---
title: "Feature — Main window shell and navigation"
description: "The frame every Noter main-window page lives in: glass sidebar with the live-call row and badges, unified toolbar with one Back and Forward history, banner slot, inspector slot, app menu and collapse order."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-main-window-shell
milestone: M0
---

# Feature: Main window shell and navigation


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Navigate between sections](#navigate-between-sections)
  - [React to app-level state](#react-to-app-level-state)
  - [Resize, zoom and collapse](#resize-zoom-and-collapse)
  - [Read the privacy mode](#read-the-privacy-mode)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Keep one history](#keep-one-history)
  - [Width class and collapse order](#width-class-and-collapse-order)
- [4. States (CDSL)](#4-states-cdsl)
  - [Main window frame](#main-window-frame)
  - [Banner slot MW-R5](#banner-slot-mw-r5)
  - [Mode indicator](#mode-indicator)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Frame, sidebar and toolbar](#frame-sidebar-and-toolbar)
  - [History, routing and app menu](#history-routing-and-app-menu)
  - [Collapse order and zoom](#collapse-order-and-zoom)
  - [Mode indicator](#mode-indicator-1)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [x] `p1` - **ID**: `cpt-noter-featstatus-ui-main-window-shell`

## 1. Feature Context

- [x] `p1` - `cpt-noter-feature-ui-main-window-shell`

### 1.1 Overview

The main window is the standard macOS window for every page outside the call. Its shell draws the sidebar (MW-R2), the toolbar (MW-R1), the banner slot (MW-R5), the content (MW-R3) and the inspector slot (MW-R4), keeps one Back and Forward history across sections, shows the most severe app-level state, owns the app menu model and applies one collapse order at every width. Pages register with the shell; this feature ships with the routes of M0 and M1 and an empty, labelled page for sections whose feature has not landed.

### 1.2 Purpose

It implements `cpt-noter-component-shell-main-window`, the main-window row of `cpt-noter-topology-ui-windows`, and `cpt-noter-component-ui-mode-indicator` with all its variants, because the sidebar footer (M0) and Settings › Privacy (M0) need it before the call window and the menu bar (M1) use it.

**Requirements**: PRD › Architecture overview (UI row); the app-level states of PRD › Feature specification › 10, 11 and 13. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-keyboard-first`, `cpt-noter-principle-native-macos`, `cpt-noter-principle-core-owns-state`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Navigates sections, goes back and forward, reads and acts on app banners, opens Settings and the call window |
| Noter core (system) | Sends banners, capture state, privacy status, proposal counts and navigation requests; places the window; builds the native app menu |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Architecture overview
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Shell — Main window (Regions, Wireframe, Elements, App menu, Size behaviour, Keyboard, States); 3.8 Deployment Topology
- **Design elements**: `cpt-noter-component-shell-main-window`, `cpt-noter-component-ui-mode-indicator`, `cpt-noter-topology-ui-windows` (main window row); uses `cpt-noter-component-ui-recording-indicator` (live row, from `cpt-noter-feature-ui-call-window`, M1) and `cpt-noter-component-ui-inline-banner` (from `cpt-noter-feature-ui-primitives`)
- **Stories**: none of its own; its States table cites `cpt-noter-seq-first-run-complete-setup` (Empty — Self-test skipped), `cpt-noter-seq-call-screen-stop-at-call-end` (Happy path, page loaded in the background), `cpt-noter-seq-call-screen-hide-for-presenting` (Happy path) and `cpt-noter-seq-settings-check-privacy` (Other — Install an update)
- **Frozen commands it calls**: `app_snapshot` (through the bridge), `banner_dismiss`, `update_install`; `window_navigate` and the `nav:request` event (M1); `capture_resume_interrupted` (M1, the quit banner's **Resume Recording**, owned by `cpt-noter-feature-ui-call-window`)
- **Prototype modules**: `src/js/04-shared.js` (`C.modeIndicator`, `MODE_ICON`, `MODE_TEXT`, `overlay('mode-info')`), `src/js/05-shell.js` (`S.window`, `sidebar`, `toolbar`, `bannerSlot`, `inspectorSlot`, `SECTIONS`, `S.goSection`, `currentSection`, `sidebarBadges`), `src/css/00-base.css` and `src/css/01-macos27.css` (`.np-win`, `.np-sidebar`, `.np-srclist`, `.np-tb`)
- **Dependencies**: `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-primitives`, `cpt-noter-feature-ui-accessibility-l10n`

## 2. Actor Flows (CDSL)

### Navigate between sections

- [x] `p1` - **ID**: `cpt-noter-flow-ui-main-window-shell-navigate`

**Actor**: Primary user

**Success Scenarios**:
- ⌘3 opens Calls at the place the user last left it; ⌘[ returns to the previous page in any section
- A page pushed from a list (a call from Calls) can be left with Back to the same list, query, filters and scroll position

**Error Scenarios**:
- The section's feature has not shipped yet: the page shows an empty state naming the section, never a blank area

**Steps**:
1. [x] - `p1` - User selects a sidebar item, presses ⌘1 to ⌘8, uses Back or Forward (⌘[ and ⌘]), or opens a row - `inst-user-nav`
2. [x] - `p1` - Algorithm: update the history with `cpt-noter-algo-ui-main-window-shell-history` - `inst-history`
3. [x] - `p1` - UI: render the page registered for the route in MW-R3; restore its view state (scroll, selection) from the store's view state - `inst-render-page`
4. [x] - `p1` - UI: mark the section selected in the sidebar; disable Back or Forward at the ends of the history - `inst-mark-section`
5. [x] - `p1` - UI: move focus to the page heading - `inst-focus-heading`
6. [x] - `p1` - **RETURN** the page - `inst-return-page`

### React to app-level state

- [x] `p1` - **ID**: `cpt-noter-flow-ui-main-window-shell-app-state`

**Actor**: Noter core

**Success Scenarios**:
- The banner slot shows **Call detection is off until the audio self-test passes** · **Run Audio Self-Test…** · **Finish Setup…** after a skipped self-test
- The sidebar shows the live-call row **● Planning · 23:14** while capturing, and the footer **Recording · Planning**
- **Version 1.2 installs on next launch** · **Restart Now** installs the update

**Error Scenarios**:
- `update_install` fails: the banner keeps its action with **Try Again** when retryable
- Several banners wait: the most severe shows with **+2 More**

**Steps**:
1. [x] - `p1` - Core: sends `banners:changed`, `capture:state`, `privacy:changed`, `proposals:counts`, `degraded:changed`, `app:presenting` or `nav:request` - `inst-core-event`
2. [x] - `p1` - Store: apply the whole state with the bridge's version rule - `inst-apply`
3. [x] - `p1` - **IF** banners changed - `inst-if-banners`
   1. [x] - `p1` - UI: fill MW-R5 through the inline banner's slot ordering (error, warning, degraded, info) - `inst-fill-banner`
4. [x] - `p1` - **IF** capture is recording or paused - `inst-if-capture`
   1. [x] - `p1` - UI: show the live-call row at the top of the source list (recording indicator, live-row variant); a click calls `window_show_call` without making the call window key and keeps the sidebar selection - `inst-live-row`
5. [x] - `p1` - UI: the status footer shows the mode indicator's sidebar variant: **Idle · API key · local fallback ready**, **Recording · Planning**, **Local only**, **Switched to local** or **No assistant** - `inst-footer`
6. [x] - `p1` - **IF** a navigation request arrives (`nav:request`, M1) - `inst-if-nav`
   1. [x] - `p2` - UI: navigate to its target without activating the window when the request says so (the Call page loaded in the background after a stop, D81) - `inst-nav-request`
7. [x] - `p1` - **IF** the user chooses a banner action - `inst-if-banner-action`
   1. [x] - `p1` - API: run the action's command (`update_install`, `banner_dismiss`, or the action owned by another feature) - `inst-api-banner`
8. [x] - `p1` - **RETURN** the frame showing the core's state - `inst-return-frame`

### Resize, zoom and collapse

- [x] `p1` - **ID**: `cpt-noter-flow-ui-main-window-shell-resize`

**Actor**: Primary user

**Success Scenarios**:
- Narrowing the window first stops the inspector docking, then makes grids one column, hides low-priority columns, and last collapses the sidebar into an overlay
- ⌘+ zooms to 200 % without horizontal scrolling

**Error Scenarios**:
- None

**Steps**:
1. [x] - `p1` - User resizes the window, zooms (⌘+, ⌘−, ⌘0) or hides the sidebar (⌃⌘S) - `inst-user-resize`
2. [x] - `p1` - Algorithm: compute the width class and the collapse step with `cpt-noter-algo-ui-main-window-shell-collapse` - `inst-collapse`
3. [x] - `p1` - UI: apply the width class to the page and the toolbar overflow » at Narrow; Back, the page title and the primary action never overflow - `inst-apply-width`
4. [x] - `p1` - **RETURN** the reflowed frame - `inst-return-reflow`

### Read the privacy mode

- [x] `p1` - **ID**: `cpt-noter-flow-ui-main-window-shell-mode`

**Actor**: Primary user

**Success Scenarios**:
- The user clicks the mode indicator and reads **Cloud with redaction: names and PII are replaced before anything leaves this Mac** with **Open Privacy Settings**
- In the call window the same popover adds **Make This Call Sensitive** (M1); on the Call page **Mark as Sensitive** (M2)

**Error Scenarios**:
- The mode is degraded (**Switched to local**, **No assistant**): the indicator uses the warning glyph and word; the reason is in the copilot banner or the menu bar line, not here

**Steps**:
1. [x] - `p1` - Core: sends the privacy status (`privacy:changed`, also in `app_snapshot`) with the mode in force and the runtime - `inst-core-privacy`
2. [x] - `p1` - UI: render the variant of the host (sidebar footer, call header, floating mode line, glyph only, Ask toolbar, Call info, Settings, menu bar text) with glyph and word, plus the runtime name where the variant has one - `inst-render-mode`
3. [x] - `p1` - User presses the indicator (Space, Return or click) - `inst-user-mode`
4. [x] - `p1` - UI: open the popover with the mode's explanation; **Open Privacy Settings** calls `window_navigate` to Settings › Privacy (M1; in M0 the Settings window opens through the app menu ⌘,) - `inst-mode-popover`
5. [x] - `p1` - **RETURN** the popover, closed by Esc with focus back on the indicator - `inst-return-mode`

## 3. Processes / Business Logic (CDSL)

### Keep one history

- [x] `p1` - **ID**: `cpt-noter-algo-ui-main-window-shell-history`

**Input**: the current history (list and index), each section's last location, and the requested move (section, push, back, forward, replace)

**Output**: the new history and the route to show

**Steps**:
1. [x] - `p1` - **MATCH** the move - `inst-match-move`
   - [x] - `p1` - **CASE** section: route to that section's last location, or its root; push it - `inst-case-section`
   - [x] - `p1` - **CASE** push: drop the entries after the index, append the route - `inst-case-push`
   - [x] - `p1` - **CASE** back or forward: move the index by one when possible - `inst-case-back`
   - [x] - `p1` - **CASE** replace: replace the entry at the index - `inst-case-replace`
2. [x] - `p1` - Remember the route as its section's last location - `inst-remember-section`
3. [x] - `p1` - Close the inspector unless the move keeps it (an inspector opened for an item on the same page) - `inst-close-inspector`
4. [x] - `p1` - **RETURN** the history and the route - `inst-return-history`

### Width class and collapse order

- [x] `p1` - **ID**: `cpt-noter-algo-ui-main-window-shell-collapse`

**Input**: window width, zoom, sidebar width (180 to 320 pt) and whether an inspector is docked

**Output**: width class and collapse step

**Steps**:
1. [x] - `p1` - Content width = window width − sidebar − docked inspector - `inst-content-width`
2. [x] - `p1` - Class: Wide at 1100 pt or more, Medium 760 to 1099 pt, Narrow below 760 pt - `inst-class`
3. [x] - `p1` - **IF** the content is below the page's need with the inspector docked: the inspector overlays from the trailing edge - `inst-step-inspector`
4. [x] - `p1` - **IF** still short: multi-column grids become one column - `inst-step-grid`
5. [x] - `p1` - **IF** still short: low-priority table columns hide, as each screen names them - `inst-step-columns`
6. [x] - `p1` - **IF** the window is narrower than 900 pt or the zoom is 175 % or more: the sidebar collapses and opens as an overlay from the leading edge - `inst-step-sidebar`
7. [x] - `p1` - **RETURN** the class and the step - `inst-return-class`

## 4. States (CDSL)

### Main window frame

- [x] `p1` - **ID**: `cpt-noter-state-ui-main-window-shell-frame`

**States**: LOADING, READY, CAPTURING, HIDDEN_FOR_PRESENTING

**Initial State**: LOADING

**Transitions**:
1. [x] - `p1` - **FROM** LOADING **TO** READY **WHEN** the app snapshot is applied (skeleton rows show after 300 ms until then, "Window reloaded") - `inst-loading-ready`
2. [x] - `p1` - **FROM** READY **TO** CAPTURING **WHEN** capture is recording or paused; the live-call row shows, **Paused** instead of the time while paused - `inst-ready-capturing`
3. [x] - `p1` - **FROM** CAPTURING **TO** READY **WHEN** capture stops; the row goes away - `inst-capturing-ready`
4. [x] - `p1` - **FROM** READY **TO** HIDDEN_FOR_PRESENTING **WHEN** `app:presenting` reports hidden; the core hides the window - `inst-ready-hidden`
5. [x] - `p1` - **FROM** CAPTURING **TO** HIDDEN_FOR_PRESENTING **WHEN** `app:presenting` reports hidden - `inst-capturing-hidden`
6. [x] - `p1` - **FROM** HIDDEN_FOR_PRESENTING **TO** READY **WHEN** any show action restores Noter and nothing records; the window comes back exactly as it was - `inst-hidden-ready`
7. [x] - `p1` - **FROM** HIDDEN_FOR_PRESENTING **TO** CAPTURING **WHEN** any show action restores Noter while a call records - `inst-hidden-capturing`

### Banner slot MW-R5

- [x] `p1` - **ID**: `cpt-noter-state-ui-main-window-shell-banner-slot`

**States**: EMPTY, ONE, SEVERAL

**Initial State**: EMPTY

**Transitions**:
1. [x] - `p1` - **FROM** EMPTY **TO** ONE **WHEN** the core sends one app banner (self-test, calendar access off, keyword-only search, update ready, quit during a recording) - `inst-empty-one`
2. [x] - `p1` - **FROM** ONE **TO** SEVERAL **WHEN** another banner waits; **+2 More** appears - `inst-one-several`
3. [x] - `p1` - **FROM** SEVERAL **TO** ONE **WHEN** all but one are resolved or dismissed - `inst-several-one`
4. [x] - `p1` - **FROM** ONE **TO** EMPTY **WHEN** it is resolved, or dismissed where its variant allows (the quit banner's × ends its **Resume Recording** offer, PM-67) - `inst-one-empty`

### Mode indicator

- [x] `p1` - **ID**: `cpt-noter-state-ui-main-window-shell-mode-indicator`

**States**: CLOUD, CLOUD_REDACTED, LOCAL_ONLY, SENSITIVE_LOCAL, SWITCHED_TO_LOCAL, NO_ASSISTANT

**Initial State**: CLOUD_REDACTED

**Transitions**:
1. [x] - `p1` - **FROM** CLOUD_REDACTED **TO** CLOUD **WHEN** the user picks **Cloud allowed** in Settings › Privacy - `inst-redacted-cloud`
2. [x] - `p1` - **FROM** CLOUD_REDACTED **TO** LOCAL_ONLY **WHEN** the user picks **Local only** - `inst-redacted-local`
3. [x] - `p1` - **FROM** CLOUD_REDACTED **TO** SENSITIVE_LOCAL **WHEN** the call in view is sensitive (call surfaces only) - `inst-redacted-sensitive`
4. [x] - `p1` - **FROM** CLOUD_REDACTED **TO** SWITCHED_TO_LOCAL **WHEN** the core reports `switched_to_local` in the degraded set; warning glyph and word - `inst-redacted-switched`
5. [x] - `p1` - **FROM** SWITCHED_TO_LOCAL **TO** CLOUD_REDACTED **WHEN** the degraded state clears - `inst-switched-redacted`
6. [x] - `p1` - **FROM** CLOUD_REDACTED **TO** NO_ASSISTANT **WHEN** the core reports `no_assistant`; warning glyph and word; recording and transcription still work - `inst-redacted-none`
7. [x] - `p1` - **FROM** NO_ASSISTANT **TO** CLOUD_REDACTED **WHEN** a key, an account or a local runtime becomes available - `inst-none-redacted`

## 5. Definitions of Done

### Frame, sidebar and toolbar

- [x] `p1` - **ID**: `cpt-noter-dod-ui-main-window-shell-frame`

The system **MUST** render MW-R1 to MW-R5 as the prototype's `S.window`, `sidebar()`, `toolbar()`, `bannerSlot()` and `inspectorSlot()` do, with the same regions, classes and data attributes: the glass sidebar with the live-call row, eight sections in three groups with badges (**Activity, 3 waiting, 1 problem** for VoiceOver), the status footer, the 56-pt unified toolbar with Back and Forward in one capsule, the 240 to 360 pt search field, and the inspector slot at 280, 320 or 400 pt.

**Implements**:
- `cpt-noter-flow-ui-main-window-shell-app-state`
- `cpt-noter-state-ui-main-window-shell-frame`
- `cpt-noter-state-ui-main-window-shell-banner-slot`

**Constraints**: `cpt-noter-constraint-tauri-webview`

**Touches**:
- Commands: `banner_dismiss`, `update_install`, `window_show_call` (live row, M1)
- Events: `banners:changed`, `capture:state`, `privacy:changed`, `proposals:counts`, `app:presenting`
- Tests: screenshot specs for idle, capturing, banner, several banners, Narrow; unit tests for the slot order

### History, routing and app menu

- [x] `p1` - **ID**: `cpt-noter-dod-ui-main-window-shell-navigation`

The system **MUST** keep one Back and Forward history across sections with per-section last locations, route ⌘1 to ⌘8, ⌘[, ⌘], ⌃⌘S, ⌥⌘I, ⌘F, ⌘, and ⌘W, let later features register their pages, and publish the app menu model (Noter, File, Edit, View, Call, Window, Help with their shortcuts) for the core to build natively.

**Implements**:
- `cpt-noter-flow-ui-main-window-shell-navigate`
- `cpt-noter-algo-ui-main-window-shell-history`

**Constraints**: `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `window_navigate` (M1), event `nav:request` (M1)
- Tests: unit tests for the history; a keyboard-only E2E pass across sections

### Collapse order and zoom

- [x] `p1` - **ID**: `cpt-noter-dod-ui-main-window-shell-collapse`

The system **MUST** apply the Wide, Medium and Narrow classes and the one collapse order to every page, overflow toolbar items into » from the trailing side, and reflow up to 200 % zoom without horizontal scrolling.

**Implements**:
- `cpt-noter-flow-ui-main-window-shell-resize`
- `cpt-noter-algo-ui-main-window-shell-collapse`

**Constraints**: `cpt-noter-constraint-three-languages`

**Touches**:
- Tests: screenshot specs at Wide, Medium and Narrow; pseudo-localised sidebar and toolbar

### Mode indicator

- [x] `p1` - **ID**: `cpt-noter-dod-ui-main-window-shell-mode-indicator`

The system **MUST** provide the mode indicator in its eight variants with glyph and word (never colour alone), the warning form for **Switched to local** and **No assistant**, and the explanation popover with **Open Privacy Settings** (and, in the call window, **Make This Call Sensitive**), as `C.modeIndicator` and `overlay('mode-info')` render them; council-mode words never appear in it.

**Implements**:
- `cpt-noter-flow-ui-main-window-shell-mode`
- `cpt-noter-state-ui-main-window-shell-mode-indicator`

**Constraints**: `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Events: `privacy:changed`, `degraded:changed`
- Commands: `window_navigate` (M1)
- Tests: screenshot specs of each variant and degraded form; VoiceOver label "Mode: cloud with redaction"

## 6. Acceptance Criteria

- [ ] Every main-window state of DESIGN's States table that M0 and M1 can reach renders as in the prototype (App-level banner, Switched to local, No assistant, Capturing, Hidden for presenting, Update ready, Reopened after a quit, Window reloaded); Calendar access denied, Keyword-only search, Outputs being written and Proposals waiting render once their features land
- [ ] The mode indicator shows the same glyph and word on every surface for the same mode, with the warning form for degraded modes
- [ ] Back and Forward return to the same query, filters and scroll position
- [ ] The live-call row shows the call window without taking focus from the call app
- [ ] No sidebar label, group header or toolbar button truncates in the pseudo-localised build

## 7. Additional Context

**Prototype reuse.** Rewritten in React with the same structure, classes and data attributes: `C.modeIndicator` with `MODE_ICON` and `MODE_TEXT`, and `overlay('mode-info')` from `src/js/04-shared.js`; `S.window` (window chrome with `data-component`, `data-variant`, `data-state`), `sidebar()` (MW-R2 with `.np-srclist__live`, items, badges and footer), `toolbar()` (MW-R1), `bannerSlot()` (MW-R5), `inspectorSlot()` (MW-R4) and the `SECTIONS` table from `src/js/05-shell.js`; their styles in `src/css/00-base.css` and `src/css/01-macos27.css` are ported as-is. Not reusable: the harness bar, surface tabs, **Dialogs ▾**, **State ▾**, **Capture ▾**, **Inspect**, the component panel (`fillPanel`) and `S.caption` in the same file, and the ⌃1–⌃8 aliases.

**States coverage.**

| DESIGN state | Prototype |
| --- | --- |
| App-level banner | Today › State ▾ setup states; `bannerSlot()` |
| Calendar access denied | Today › State ▾ (M2 page; the banner slot is this feature's) |
| Keyword-only search | Library › State ▾ › Search · Keyword-only (M3) |
| Switched to local, No assistant | **Capture ▾** › no assistant; footer text in `sidebar()` |
| Capturing | **Capture ▾** › recording or paused; `.np-srclist__live` |
| Outputs being written | `state.outputsWriting` spinner beside **Calls** |
| Proposals waiting or a job failed | `sidebarBadges()` |
| Call page loaded in the background | Call window › closing state › main window shows the Call page |
| Hidden for presenting | Call window › State ▾ › Hidden for presenting |
| Update ready | Settings › State ▾ › Updates · Update ready (same line as MW-R5) |
| Reopened after Noter quit during a recording | Today › quit banner with **Open Call**, **Resume Recording** and × |
| Window reloaded | Not drawn (transient); skeleton rows as in Library › Loading |

**Not applicable.** Data access: the shell renders store slices only. Authentication: none.
