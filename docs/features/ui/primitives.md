---
title: "Feature — Primitives and feedback components"
description: "The 26 Noter primitives and the empty state, inline banner and inline status components, rewritten in React from the clickable prototype with the same structure, tokens and data attributes."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-primitives
milestone: M0
---

# Feature: Primitives and feedback components


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Operate a control](#operate-a-control)
  - [Read and act on a banner](#read-and-act-on-a-banner)
  - [See a confirmation where the eye is](#see-a-confirmation-where-the-eye-is)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Order banners in a slot](#order-banners-in-a-slot)
  - [Fit labels without truncation](#fit-labels-without-truncation)
- [4. States (CDSL)](#4-states-cdsl)
  - [Push button](#push-button)
  - [Inline banner](#inline-banner)
  - [Inline status](#inline-status)
- [5. Definitions of Done](#5-definitions-of-done)
  - [The 26 primitives](#the-26-primitives)
  - [Empty state, inline banner and inline status](#empty-state-inline-banner-and-inline-status)
  - [Text-only rendering](#text-only-rendering)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [x] `p1` - **ID**: `cpt-noter-featstatus-ui-primitives`

## 1. Feature Context

- [x] `p1` - `cpt-noter-feature-ui-primitives`

### 1.1 Overview

Every screen and complex component is assembled from 26 primitives (push-button to split-divider) and three feedback components: the empty state, the inline banner and the inline status. This feature builds them once as React components that behave like their AppKit counterparts, keep a 24 by 24 pt hit area, show a focus ring for keyboard focus only, and carry the prototype's data attributes so screenshots and tests address them exactly as the prototype does.

### 1.2 Purpose

It implements the controls of `cpt-noter-component-ui-primitives` (its inventory table) and the components `cpt-noter-component-ui-empty-state`, `cpt-noter-component-ui-inline-banner` and `cpt-noter-component-ui-inline-status`. A small team builds the UI from one fixed set (`cpt-noter-constraint-small-team`), and every failure has a visible place with its next action (`cpt-noter-principle-degrade-visibly`).

**Requirements**: PRD › UI prototype; PRD › Product principles › 6 (degrade visibly). The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-native-macos`, `cpt-noter-principle-degrade-visibly`, `cpt-noter-principle-keyboard-first`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Operates every control by pointer, keyboard and VoiceOver |
| Screen features (system) | Compose the primitives, supply labels and states, and run the commands behind them |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › UI prototype
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Primitives inventory (the table of 26), Component — Empty state, Component — Inline banner, Component — Inline status
- **Design elements**: `cpt-noter-component-ui-primitives` (controls part), `cpt-noter-component-ui-empty-state`, `cpt-noter-component-ui-inline-banner`, `cpt-noter-component-ui-inline-status`
- **Stories**: none of its own; every story uses them
- **Commands**: none (a banner action runs the command of the screen that shows the banner)
- **Prototype modules**: `src/js/02-primitives.js`, `src/js/04-shared.js` (`C.emptyState`, `C.inlineBanner`, `C.inlineStatus`, `banner.dismiss`, `banner.more`), `src/js/01-icons.js`, `src/css/00-base.css` and `src/css/01-macos27.css` (`.np-btn`, `.np-icbtn`, `.np-seg`, `.np-popup`, `.np-field`, `.np-search`, `.np-toggle`, `.np-check`, `.np-radio`, `.np-meter`, `.np-progress`, `.np-badge`, `.np-kbd`, `.np-menu`, `.np-sheet`, `.np-pop`, `.np-banner`, `.np-empty`, `.np-status`)
- **Dependencies**: `cpt-noter-feature-ui-tokens-theming`

## 2. Actor Flows (CDSL)

### Operate a control

- [x] `p1` - **ID**: `cpt-noter-flow-ui-primitives-operate-control`

**Actor**: Primary user

**Success Scenarios**:
- A push button runs its action on click, Space or Return (Return for the region's default button), with hover and pressed feedback
- A composite primitive (segmented control, radio group, table, source list, menu) moves with the arrow keys

**Error Scenarios**:
- The control is disabled: it keeps its look of disabled by more than colour, takes no action and exposes its reason as its description
- The action is running: the control shows its loading state (a spinner replaces the icon, the label stays) and ignores a second activation

**Steps**:
1. [x] - `p1` - User points at, clicks, tabs to or presses a key on a control - `inst-user-input`
2. [x] - `p1` - UI: show hover (120 ms), pressed and focus feedback; the focus ring shows for keyboard focus only - `inst-feedback`
3. [x] - `p1` - **IF** the control is disabled or loading - `inst-if-disabled`
   1. [x] - `p1` - **RETURN** no action; a disabled control with a reason keeps it as its help tag and description - `inst-return-noop`
4. [x] - `p1` - UI: call the handler the owning component passed in; primitives call no core command themselves - `inst-call-handler`
5. [x] - `p1` - **RETURN** the control in the state its owner sets - `inst-return-control`

### Read and act on a banner

- [x] `p1` - **ID**: `cpt-noter-flow-ui-primitives-banner`

**Actor**: Primary user

**Success Scenarios**:
- The banner names the cause and the fix; its action runs the owning screen's command, the banner shows the action's loading state and leaves when the core reports the fix
- An info or success banner is dismissed with × or Esc on ×

**Error Scenarios**:
- Several banners wait for one slot: the highest severity shows, with **+2 More** that lists the rest in place

**Steps**:
1. [x] - `p1` - UI: the slot receives the banners the screen maps from typed errors and degraded events - `inst-receive`
2. [x] - `p1` - Algorithm: order them with `cpt-noter-algo-ui-primitives-order-banners` - `inst-order`
3. [x] - `p1` - UI: show the first banner with severity icon, optional title, one sentence, up to three actions, optional progress, × for info and success, and **+2 More** when others wait - `inst-show-banner`
4. [x] - `p1` - User chooses an action, × or **+2 More** - `inst-user-banner`
5. [x] - `p1` - **IF** the user chose **+2 More** - `inst-if-more`
   1. [x] - `p1` - UI: list the waiting banners in place, most severe first - `inst-list-more`
6. [x] - `p1` - **IF** the user chose × on an info or success banner - `inst-if-dismiss`
   1. [x] - `p1` - UI: hide it until the event happens again (the owner may also send `banner_dismiss` for app-level banners) - `inst-dismiss`
7. [x] - `p1` - **RETURN** the slot showing the next banner, or empty - `inst-return-slot`

### See a confirmation where the eye is

- [x] `p1` - **ID**: `cpt-noter-flow-ui-primitives-inline-status`

**Actor**: Primary user

**Success Scenarios**:
- After **Copy**, **Save** or **Mark Moment**, the control itself reads the confirmation for 2 s, then its label returns
- A row outcome offers **Undo** for 10 s, paused while hovered or focused

**Error Scenarios**:
- None: failures use the inline banner, never the inline status

**Steps**:
1. [x] - `p1` - UI: the owning control passes the text and variant (on the label, trailing, blind feedback, row outcome, notice) - `inst-receive-status`
2. [x] - `p1` - UI: show the check or info glyph and the text with a status role; focus never moves to it - `inst-show-status`
3. [x] - `p1` - **WHILE** the status is hovered or focused and has an action - `inst-while-hover`
   1. [x] - `p1` - UI: pause its timer - `inst-pause-timer`
4. [x] - `p1` - UI: after 2 s (label, notice), 3 s (blind feedback) or 10 s (row outcome), remove it; nothing else moves - `inst-remove-status`
5. [x] - `p1` - **RETURN** the control's own label - `inst-return-label`

## 3. Processes / Business Logic (CDSL)

### Order banners in a slot

- [x] `p1` - **ID**: `cpt-noter-algo-ui-primitives-order-banners`

**Input**: the banners waiting for one slot (MW-R5, CS-R3, CS-R4d, FP-R3, ST-R3, a section, a sheet)

**Output**: the banner to show and the count behind **+2 More**

**Steps**:
1. [x] - `p1` - Sort by severity: error, warning, degraded, info, success - `inst-sort-severity`
2. [x] - `p1` - Within one severity keep the order the core sent - `inst-keep-order`
3. [x] - `p1` - **RETURN** the first banner and the number of the others - `inst-return-first`

### Fit labels without truncation

- [x] `p1` - **ID**: `cpt-noter-algo-ui-primitives-fit-labels`

**Input**: a control or control group and its available width

**Output**: the layout that keeps every label whole

**Steps**:
1. [x] - `p1` - Push buttons hug their label and never truncate; at regular size they are at least 56 pt wide - `inst-hug`
2. [x] - `p1` - **IF** a segmented control's labels do not fit - `inst-if-seg`
   1. [x] - `p1` - Render it as a popup-button with the same options - `inst-seg-popup`
3. [x] - `p1` - **IF** a footer's buttons do not fit side by side - `inst-if-footer`
   1. [x] - `p1` - Stack them, the default button last - `inst-stack`
4. [x] - `p1` - Table cells and pop-up values tail-truncate with the full text in a help tag and for VoiceOver - `inst-tail-truncate`
5. [x] - `p1` - **RETURN** the layout - `inst-return-layout`

## 4. States (CDSL)

### Push button

- [x] `p1` - **ID**: `cpt-noter-state-ui-primitives-push-button`

**States**: DEFAULT, HOVER, PRESSED, FOCUS, DISABLED, LOADING

**Initial State**: DEFAULT

**Transitions**:
1. [x] - `p1` - **FROM** DEFAULT **TO** HOVER **WHEN** the pointer enters - `inst-default-hover`
2. [x] - `p1` - **FROM** HOVER **TO** PRESSED **WHEN** the pointer is pressed - `inst-hover-pressed`
3. [x] - `p1` - **FROM** DEFAULT **TO** FOCUS **WHEN** keyboard focus arrives - `inst-default-focus`
4. [x] - `p1` - **FROM** PRESSED **TO** LOADING **WHEN** the owner starts a command for this button - `inst-pressed-loading`
5. [x] - `p1` - **FROM** LOADING **TO** DEFAULT **WHEN** the owner reports the result - `inst-loading-default`
6. [x] - `p1` - **FROM** DEFAULT **TO** DISABLED **WHEN** the owner disables it, with or without a reason - `inst-default-disabled`
7. [x] - `p1` - **FROM** DISABLED **TO** DEFAULT **WHEN** the owner enables it - `inst-disabled-default`

### Inline banner

- [x] `p1` - **ID**: `cpt-noter-state-ui-primitives-inline-banner`

**States**: SHOWN, WORKING, STACKED, DISMISSED, RESOLVED

**Initial State**: SHOWN

**Transitions**:
1. [x] - `p1` - **FROM** SHOWN **TO** WORKING **WHEN** the user runs an action and the owner's command is running - `inst-shown-working`
2. [x] - `p1` - **FROM** WORKING **TO** SHOWN **WHEN** the command fails and the cause remains - `inst-working-shown`
3. [x] - `p1` - **FROM** SHOWN **TO** STACKED **WHEN** the user opens **+2 More** - `inst-shown-stacked`
4. [x] - `p1` - **FROM** STACKED **TO** SHOWN **WHEN** the user closes the list - `inst-stacked-shown`
5. [x] - `p1` - **FROM** SHOWN **TO** DISMISSED **WHEN** the user dismisses an info or success banner, or the warning **Noter quit during …** - `inst-shown-dismissed`
6. [x] - `p1` - **FROM** SHOWN **TO** RESOLVED **WHEN** the core reports the fix and the owner removes the banner - `inst-shown-resolved`
7. [x] - `p1` - **FROM** WORKING **TO** RESOLVED **WHEN** the core reports the fix - `inst-working-resolved`

### Inline status

- [x] `p1` - **ID**: `cpt-noter-state-ui-primitives-inline-status`

**States**: HIDDEN, SHOWN, PAUSED

**Initial State**: HIDDEN

**Transitions**:
1. [x] - `p1` - **FROM** HIDDEN **TO** SHOWN **WHEN** the owner reports a result to confirm - `inst-hidden-shown`
2. [x] - `p1` - **FROM** SHOWN **TO** PAUSED **WHEN** a row outcome or blind feedback with an action is hovered or focused - `inst-shown-paused`
3. [x] - `p1` - **FROM** PAUSED **TO** SHOWN **WHEN** hover and focus leave - `inst-paused-shown`
4. [x] - `p1` - **FROM** SHOWN **TO** HIDDEN **WHEN** its time (2, 3 or 10 s) ends or its **Undo** runs - `inst-shown-hidden`

## 5. Definitions of Done

### The 26 primitives

- [x] `p1` - **ID**: `cpt-noter-dod-ui-primitives-controls`

The system **MUST** provide React components for the 26 primitives of DESIGN's inventory with their variants, sizes (20, 24, 28, 32 pt), visual states, keys and VoiceOver roles, rendering `data-component="cpt-noter-component-ui-primitives"`, `data-primitive`, `data-variant`, `data-size` and `data-state` exactly as `src/js/02-primitives.js` does, with a 24 by 24 pt hit area and a focus ring for keyboard focus only.

**Implements**:
- `cpt-noter-flow-ui-primitives-operate-control`
- `cpt-noter-algo-ui-primitives-fit-labels`
- `cpt-noter-state-ui-primitives-push-button`

**Constraints**: `cpt-noter-constraint-small-team`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Code: `apps/desktop/src/ui/primitives/*`
- Prototype: `src/js/02-primitives.js`, `src/js/01-icons.js`, the `.np-*` rules of `src/css/00-base.css` and `src/css/01-macos27.css`
- Tests: a unit test per primitive (roles, keys, disabled reason); one screenshot spec of the primitives page in light, dark and Increase Contrast

### Empty state, inline banner and inline status

- [x] `p1` - **ID**: `cpt-noter-dod-ui-primitives-feedback`

The system **MUST** provide the empty state (first use, filtered empty, section line, large area), the inline banner (info, warning, error, degraded, success, compact; one per slot, highest severity first, **+2 More**) and the inline status (on the label, trailing, blind feedback, row outcome, notice) with the prototype's markup and timings.

**Implements**:
- `cpt-noter-flow-ui-primitives-banner`
- `cpt-noter-flow-ui-primitives-inline-status`
- `cpt-noter-algo-ui-primitives-order-banners`
- `cpt-noter-state-ui-primitives-inline-banner`
- `cpt-noter-state-ui-primitives-inline-status`

**Constraints**: `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Code: `apps/desktop/src/ui/feedback/*`
- Prototype: `src/js/04-shared.js` › `C.emptyState`, `C.inlineBanner`, `C.inlineStatus`
- Tests: unit tests for ordering, dismissal and timers

### Text-only rendering

- [x] `p1` - **ID**: `cpt-noter-dod-ui-primitives-text-only`

The system **MUST** render transcript, document, model and user text as plain text in every primitive (no `dangerouslySetInnerHTML`), and Markdown only through a renderer that drops raw HTML, so hostile strings never become markup (PM-08).

**Implements**:
- `cpt-noter-flow-ui-primitives-operate-control`

**Constraints**: `cpt-noter-constraint-local-only-ui`

**Touches**:
- Tests: a security test that renders markup, very long lines and mixed scripts in each text-bearing primitive

## 6. Acceptance Criteria

- [x] Each primitive renders the same `data-*` attributes as the prototype for the same variant and state
- [x] Every interactive primitive is reachable and operable by keyboard and exposes the role in DESIGN's table
- [x] Every hit area is at least 24 by 24 pt, including 20-pt buttons and 22-pt inline icon buttons
- [x] A banner slot never shows two banners at once; **+2 More** lists the rest by severity
- [x] Hostile strings render as text in every primitive
- [x] The primitives page renders identically to the prototype's light, dark and Increase Contrast renderings in the four appearance states of `cpt-noter-state-ui-tokens-theming-appearance` (screenshot match ≥ 98 % in the pinned container); the harness self-test fixture `apps/desktop/tests/visual/fixtures/primitives.html` becomes this page. Moved here from `cpt-noter-feature-ui-tokens-theming`, which checks the tokens themselves against the prototype

## 7. Additional Context

**Prototype reuse.** Rewritten in React with the same structure, class names, tokens and data attributes: the factory functions of `src/js/02-primitives.js` (`button`, `iconButton`, `segmented`, `popup`, `pulldown`, `menu`, `checkbox`, `toggle`, `radioGroup`, `textField`, `searchField`, `slider`, `progress`, `levelMeter`, `badge`, `disclosure`, `link`, `table`, `th`, `splitDivider`, `kbd`, `helpTag`) become components with the same props; `C.emptyState`, `C.inlineBanner` and `C.inlineStatus` from `src/js/04-shared.js` likewise. Ported as-is: `src/js/01-icons.js` (the SVG path set, as an icon module) and the `.np-*` styles. Not reusable: `NP.flash()` and `NP.undo()` timers in `00-core.js` (prototype plumbing; the timings are kept), `data-proto-*` attributes and the `proto.*` actions. The prototype carries help tags as `title`/`data-help-tag` rather than a tooltip primitive (README); production builds the tooltip primitive with the 500 ms delay and keyboard-focus trigger DESIGN describes.

**States coverage.** Every state in DESIGN's inventory table for each primitive and in the States lists of the three feedback components has a prototype rendering (the **Components** panel of the prototype lists them per view); production renders each in the primitives page used by the screenshot spec.

**Not applicable.** Data access and commands: primitives hold no data and call no command. Authentication: none.
