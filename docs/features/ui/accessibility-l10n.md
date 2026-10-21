---
title: "Feature — Accessibility, keyboard and localisation"
description: "The shared services every Noter screen uses for keyboard-first operation, focus, VoiceOver announcements and translation-ready text, with the automated checks that gate them."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-accessibility-l10n
milestone: M0
---

# Feature: Accessibility, keyboard and localisation


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Hear what changed](#hear-what-changed)
  - [Move by keyboard](#move-by-keyboard)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Route an announcement](#route-an-announcement)
  - [Match a shortcut by physical key](#match-a-shortcut-by-physical-key)
  - [Format a string](#format-a-string)
- [4. States (CDSL)](#4-states-cdsl)
  - [Focus return](#focus-return)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Announcement service](#announcement-service)
  - [Keyboard and focus](#keyboard-and-focus)
  - [Translation-ready strings and checks](#translation-ready-strings-and-checks)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-noter-featstatus-ui-accessibility-l10n`

## 1. Feature Context

- [ ] `p1` - `cpt-noter-feature-ui-accessibility-l10n`

### 1.1 Overview

Four services that every screen calls instead of solving them alone: the announcement service (one politeness policy, live regions in key windows, native announcements through the core from panels that are not key), focus management (order, return and never obscured), physical-key shortcuts that work on Russian and German layouts, and a string catalogue with plural rules and locale formats. Automated checks keep them honest: accessibility assertions in component tests, a pseudo-localisation run and a German string pass on every screen.

### 1.2 Purpose

It implements the **Keyboard and VoiceOver** and **Localisation rules for controls** parts of `cpt-noter-component-ui-primitives` and the announcement policy (D55, D56), so that the accessibility baseline and the three content languages hold everywhere.

**Requirements**: owner acceptance criterion AC5 (WCAG 2.2 AA, VoiceOver, keyboard-first, dark mode, Reduce motion); PRD › Live copilot › Guardrails; REVIEW › F12 (German and Cyrillic). The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-accessible-multilingual`, `cpt-noter-principle-keyboard-first`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Works by keyboard and VoiceOver, on an English, Russian or German keyboard layout |
| VoiceOver (system) | Reads roles, labels and announcements |
| Noter core (system) | Posts native announcements for panels that are not key, and passes the 12- or 24-hour preference |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Live copilot › Guardrails
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Primitives inventory › Keyboard and VoiceOver (announcement table), Localisation rules for controls, Focus rings and hit targets; 4.3 Test approach (Accessibility, Localisation)
- **Design elements**: `cpt-noter-component-ui-primitives` (keyboard, VoiceOver and localisation parts, shared)
- **Stories**: none of its own; every story's keyboard and VoiceOver behaviour runs through it
- **Frozen commands it calls**: `window_announce` (M1, native announcement from the record prompt and the call window), `log_ui`
- **Prototype modules**: `src/js/00-core.js` (`renderNow` focus and selection restore), `src/js/05-shell.js` (focus return after overlays) — source of truth only
- **Dependencies**: `cpt-noter-feature-ui-primitives`

## 2. Actor Flows (CDSL)

### Hear what changed

- [x] `p1` - **ID**: `cpt-noter-flow-ui-accessibility-l10n-announce`

**Actor**: Primary user

**Success Scenarios**:
- A VoiceOver user hears "Recording started" from the call window although the call app keeps focus
- A capture failure is announced assertively once; a copied confirmation politely once

**Error Scenarios**:
- The window is not key and is a panel: the WebView live region would not speak, so the announcement goes to the core as a native announcement

**Steps**:
1. [x] - `p1` - UI: a screen reports an event from DESIGN's announcement table with its text - `inst-report-event`
2. [x] - `p1` - Algorithm: choose the route with `cpt-noter-algo-ui-accessibility-l10n-route-announcement` - `inst-route`
3. [x] - `p1` - **IF** the route is native - `inst-if-native`
   1. [x] - `p1` - API: `window_announce` (text, politeness) - `inst-api-announce`
4. [x] - `p1` - **ELSE** - `inst-else-live`
   1. [x] - `p1` - UI: write the text into the window's polite or assertive live region - `inst-live-region`
5. [x] - `p1` - **RETURN** spoken once - `inst-return-spoken`

### Move by keyboard

- [x] `p1` - **ID**: `cpt-noter-flow-ui-accessibility-l10n-keyboard`

**Actor**: Primary user

**Success Scenarios**:
- Tab and ⇧Tab move through every control whatever the macOS keyboard-navigation setting (D51)
- After a popover, sheet or inspector closes, focus is back on the control that opened it
- A single-key action (A, E, R, T, U) works on a Russian layout because the physical key is matched

**Error Scenarios**:
- A sticky header, the undo strip or a banner would cover the focused row: the list reserves padding so the row stays visible (WCAG 2.4.11)

**Steps**:
1. [x] - `p1` - User presses Tab, an arrow key, Esc or a shortcut - `inst-user-key`
2. [x] - `p1` - **IF** the key is a single-key or ⌘ shortcut - `inst-if-shortcut`
   1. [x] - `p1` - Algorithm: match it with `cpt-noter-algo-ui-accessibility-l10n-physical-key` - `inst-match-key`
3. [x] - `p1` - **IF** the key closes a popover, sheet, menu or inspector - `inst-if-close`
   1. [x] - `p1` - UI: close it and return focus to the control that opened it - `inst-return-focus`
4. [x] - `p1` - UI: scroll the focused element into view below sticky parts - `inst-unobscure`
5. [x] - `p1` - **RETURN** focus on the intended control - `inst-return-focus-done`

## 3. Processes / Business Logic (CDSL)

### Route an announcement

- [x] `p1` - **ID**: `cpt-noter-algo-ui-accessibility-l10n-route-announcement`

**Input**: event kind, text, the window label and whether the window is key

**Output**: the route (native or live region) and the politeness, or no announcement

**Steps**:
1. [x] - `p1` - **IF** the event is a transcript line, a level meter value, a clock tick or countdown seconds - `inst-if-silent`
   1. [x] - `p1` - **RETURN** no announcement - `inst-return-silent`
2. [x] - `p1` - Set politeness: assertive for capture failures and capture decisions (call ended, new meeting); polite for everything else - `inst-politeness`
3. [x] - `p1` - **IF** the same event was announced already - `inst-if-repeat`
   1. [x] - `p1` - **RETURN** no announcement (at most once per event, D56) - `inst-return-once`
4. [x] - `p1` - **IF** the window is the record prompt or the call window and is not key - `inst-if-panel`
   1. [x] - `p1` - **RETURN** native, with the politeness (D55) - `inst-return-native`
5. [x] - `p1` - **RETURN** live region, with the politeness - `inst-return-live`

### Match a shortcut by physical key

- [x] `p1` - **ID**: `cpt-noter-algo-ui-accessibility-l10n-physical-key`

**Input**: a key event and the shortcut table of the focused region

**Output**: the matched action, or none

**Steps**:
1. [x] - `p1` - Read the physical key code, not the produced character - `inst-read-code`
2. [x] - `p1` - **IF** a text field has focus and the shortcut has no ⌘ or ⌃ - `inst-if-typing`
   1. [x] - `p1` - **RETURN** none (typing wins) - `inst-return-typing`
3. [x] - `p1` - Look up the code with its modifiers in the region's table, then in the window's table - `inst-lookup`
4. [x] - `p1` - **RETURN** the action, or none - `inst-return-action`

### Format a string

- [x] `p1` - **ID**: `cpt-noter-algo-ui-accessibility-l10n-format`

**Input**: a catalogue key, its arguments (counts, names, dates, durations, money) and the content language of any quoted user text

**Output**: the display string and the language attribute of its parts

**Steps**:
1. [x] - `p1` - Pick the English message (v1) from the catalogue; never concatenate fragments - `inst-pick-message`
2. [x] - `p1` - **FOR EACH** count argument: choose the plural form by the plural rules of the interface language - `inst-plural`
3. [x] - `p1` - Format dates and times by the macOS locale, with the 12- or 24-hour preference the core sends; call-relative times as HH:MM:SS; durations localised (**48 min**); money as US dollars in the locale format - `inst-format-values`
4. [x] - `p1` - Wrap quoted user text in “…” and give it its own language attribute - `inst-quote-user-text`
5. [x] - `p1` - **RETURN** the string - `inst-return-string`

## 4. States (CDSL)

### Focus return

- [x] `p1` - **ID**: `cpt-noter-state-ui-accessibility-l10n-focus-return`

**States**: IN_PAGE, IN_OVERLAY, RETURNED

**Initial State**: IN_PAGE

**Transitions**:
1. [x] - `p1` - **FROM** IN_PAGE **TO** IN_OVERLAY **WHEN** a popover, sheet, menu or inspector opens; its first control takes focus and the opener is remembered - `inst-page-overlay`
2. [x] - `p1` - **FROM** IN_OVERLAY **TO** RETURNED **WHEN** it closes by Esc, a click outside or its action; focus goes back to the opener - `inst-overlay-returned`
3. [x] - `p1` - **FROM** RETURNED **TO** IN_PAGE **WHEN** the user moves on - `inst-returned-page`

## 5. Definitions of Done

### Announcement service

- [x] `p1` - **ID**: `cpt-noter-dod-ui-accessibility-l10n-announce`

The system **MUST** provide one announcement service that follows DESIGN's announcement table: nothing for transcript lines, meters, clocks and countdown seconds; assertive for capture failures and decisions; polite once for everything else; native through `window_announce` for the record prompt and the call window while they are not key.

**Implements**:
- `cpt-noter-flow-ui-accessibility-l10n-announce`
- `cpt-noter-algo-ui-accessibility-l10n-route-announcement`

**Constraints**: `cpt-noter-constraint-accessibility-baseline`, `cpt-noter-constraint-non-activating-panels`

**Touches**:
- Commands: `window_announce` (M1)
- Code: `apps/desktop/src/app/a11y/announce.ts`

### Keyboard and focus

- [x] `p1` - **ID**: `cpt-noter-dod-ui-accessibility-l10n-keyboard`

The system **MUST** make every action reachable by keyboard, restore focus to the opener after every overlay, keep focused elements clear of sticky parts, and match single-key and ⌘ shortcuts by physical key.

**Implements**:
- `cpt-noter-flow-ui-accessibility-l10n-keyboard`
- `cpt-noter-algo-ui-accessibility-l10n-physical-key`
- `cpt-noter-state-ui-accessibility-l10n-focus-return`

**Constraints**: `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Code: `apps/desktop/src/app/a11y/focus.ts`, `apps/desktop/src/app/a11y/keys.ts`
- Tests: a keyboard-only E2E pass per screen in its feature

### Translation-ready strings and checks

- [x] `p1` - **ID**: `cpt-noter-dod-ui-accessibility-l10n-strings`

The system **MUST** take every interface string from a catalogue with plural rules and locale formats, put a language attribute on every content block, and run a pseudo-localisation build (+40 %, Cyrillic) and a German string pass on every screen in the screenshot suite, failing on truncated labels.

**Implements**:
- `cpt-noter-algo-ui-accessibility-l10n-format`

**Constraints**: `cpt-noter-constraint-three-languages`

**Touches**:
- Code: `apps/desktop/src/i18n/*`
- Tests: pseudo-localised screenshot specs; a unit test that no component builds a sentence by concatenation (lint rule)

## 6. Acceptance Criteria

- [x] No transcript line, meter value or clock tick is ever announced; each listed event is announced once with the listed politeness
- [x] Every screen passes a keyboard-only run and a VoiceOver label check in its component tests
- [x] Single-key actions work with the Russian and German keyboard layouts
- [x] The pseudo-localised build shows no truncated button, menu item or sidebar label on any screen
- [ ] Every content block carries a `lang` attribute

## 7. Additional Context

**Prototype reuse.** Source of truth only. The prototype wires roles and `aria-*` attributes inside its render functions, restores focus and selection after each render (`renderNow` in `src/js/00-core.js`) and closes overlays with Esc (`bindEvents`). Production rewrites this as React hooks (`useAnnounce`, `useFocusReturn`, `usePhysicalKey`) used by the components that the screen features port; the roles and labels the prototype emits are kept. The prototype does not wire single-key shortcuts and uses ⌃1 to ⌃8 for the sidebar (README › Not built), so DESIGN's keyboard tables are the reference for those.

**Not applicable.** Data and authentication: none. Translations into German and Russian are v1.x (PM-02); v1 ships English strings in a translation-ready catalogue.
