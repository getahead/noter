---
title: "Feature — Settings window"
description: "The separate Noter Settings window: 11 panes with a search field, settings applied at once, the hotkey and card-key recorder with conflict checks, and the panes Noter needs from M0."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-settings
milestone: M0
---

# Feature: Settings window


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Change a hotkey safely](#change-a-hotkey-safely)
  - [Change a setting](#change-a-setting)
  - [Test what a screen share would show](#test-what-a-screen-share-would-show)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Check a recorded chord](#check-a-recorded-chord)
  - [Filter panes by search](#filter-panes-by-search)
- [4. States (CDSL)](#4-states-cdsl)
  - [Hotkey recorder](#hotkey-recorder)
  - [Settings window](#settings-window)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Settings window, pane list and search](#settings-window-pane-list-and-search)
  - [Hotkeys pane and recorder](#hotkeys-pane-and-recorder)
  - [Privacy settings rows and the Screen Share Test](#privacy-settings-rows-and-the-screen-share-test)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-noter-featstatus-ui-settings`

## 1. Feature Context

- [ ] `p1` - `cpt-noter-feature-ui-settings`

### 1.1 Overview

Settings is its own window (⌘,) with a pane list in the style of System Settings and a search field that filters panes by name and keywords. Every change applies at once through `settings_update` with the whole section as wanted state. This feature builds the window and the panes Noter needs from M0 — General, Audio & Transcription, Privacy (its settings rows and the Screen Share Test), Call Screen & Menu Bar, Hotkeys, Performance and Updates — and the empty frames of Models & Runtimes, Repositories, Knowledge Sources and Maintenance, which later features fill.

### 1.2 Purpose

It implements `cpt-noter-component-screen-settings` and `cpt-noter-component-ui-hotkey-recorder`, reusing the first-run components for permissions, the self-test and the display picker.

**Requirements**: PRD › Feature specification › 14. Settings; PRD › Security, privacy and permissions › Privacy modes; PRD › Live copilot › Surfaces (hotkeys). The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-keyboard-first`, `cpt-noter-principle-privacy-visible`, `cpt-noter-principle-degrade-visibly`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Changes settings, records hotkeys, runs the self-test and the screen share test, installs updates |
| Noter core (system) | Writes settings, test-registers hotkeys and reports conflicts, runs the self-test and the capture test, installs updates |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 14. Settings
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Screen — Settings window (Regions, the Privacy, Models & Runtimes and Hotkeys wireframes, Elements, States); Component — Hotkey recorder; Screen — Dialogs (Run Audio Self-Test…, Screen Share Test…)
- **Design elements**: `cpt-noter-component-screen-settings`, `cpt-noter-component-ui-hotkey-recorder`; reuses `cpt-noter-component-ui-permission-check-row`, `cpt-noter-component-ui-self-test-panel`, `cpt-noter-component-ui-display-picker` (from `cpt-noter-feature-ui-first-run`) and `cpt-noter-component-ui-mode-indicator` (from `cpt-noter-feature-ui-main-window-shell`)
- **Stories**: `cpt-noter-seq-settings-set-hotkeys` (M0)
- **Frozen commands it calls**: `settings_get`, `settings_update`, `settings_unignore_app`, `hotkeys_list`, `hotkey_set`, `hotkeys_reset`, `glossary_list`, `glossary_upsert`, `glossary_remove`, `update_install`, `models_download`, `permission_request`, `self_test_run`, `setup_set_call_display`; `open_external` (M1); `share_test_run` (M2)
- **Events**: `settings:changed`, `hotkeys:changed`, `env:changed`, `setup:changed`
- **Prototype modules**: `src/js/50-e-5-settings.js` (`surface('settings')`, `PANES`, `general`, `audio`, `privacy`, `callscreen`, `hotkeys`, `performancePane`, `updates`, the `st.*` actions), `src/js/10-a-components.js` (`C.hotkeyRecorder`), `src/js/30-c-dialogs.js` (`dlg-selftest`, `dlg-share-test`), `src/css/50-e.css` (`.st-*`, `.e-*`), `src/css/10-a.css` (`.hk-*`)
- **Dependencies**: `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-primitives`, `cpt-noter-feature-ui-first-run`

## 2. Actor Flows (CDSL)

### Change a hotkey safely

- [x] `p1` - **ID**: `cpt-noter-flow-ui-settings-set-hotkeys`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-settings-set-hotkeys`: the **Catch me up** field reads **Type a shortcut…**, ⌃⌥⌘U is pressed and appears in the row and beside **Catch Me Up** in the menu bar and on the call screen

**Error Scenarios**:
- Error — Shortcut used by VoiceOver: **Used by VoiceOver** under the row; a different chord clears it
- Error — Card key used by another app: **Card key** ⌃⌥⌘3 **is used by another app** under **Pin a card**; reopening **Hotkeys** after freeing it clears it
- Error — Shortcut without a modifier: **Add Command, Option or Control**; the old chord stays
- Empty — No setting matches the search: “zoom calls”, which matches no pane name or keyword (HoD decision D-2; plain “zoom” finds Privacy and Call Screen & Menu Bar), shows the search field's empty state **No settings match “zoom calls”** in place of the pane list; the E2E test types the same words

**Steps**:
1. [x] - `p1` - User opens Settings and selects **Hotkeys** - `inst-open-hotkeys`
2. [x] - `p1` - API: `hotkeys_list` (the core test-registers the whole set when the pane opens and reports each row's result) - `inst-api-list`
3. [x] - `p1` - UI: one row per global hotkey in sentence case with its chord as key caps, the group **Card keys during calls** (**Use card keys during calls**, **Pin a card** with **+ 1, 2 or 3**, **Dismiss with keys** off, **Dismiss a card** derived, **Undo last card action**), **Restore Defaults** and the footnote; a conflict line under each row the core reports - `inst-render-hotkeys`
4. [x] - `p1` - User clicks a chord field or presses Return on it - `inst-start-record`
5. [x] - `p1` - UI: the field shows the focus ring and **Type a shortcut…** - `inst-recording`
6. [x] - `p1` - User presses a chord, Esc or ⌫ - `inst-user-chord`
7. [x] - `p1` - Algorithm: check it with `cpt-noter-algo-ui-settings-check-chord` - `inst-check`
8. [x] - `p1` - **IF** the chord is accepted locally - `inst-if-accepted`
   1. [x] - `p1` - API: `hotkey_set` (action, chord) - `inst-api-set`
   2. [x] - `p1` - **IF** the core reports `hotkey_conflict` or `hotkey_reserved` - `inst-if-conflict`
      1. [x] - `p1` - UI: keep the old chord and show the conflict line (**Used by VoiceOver**, **Used by macOS for Minimize**, **Card key** ⌃⌥⌘3 **is used by another app**), announced politely - `inst-conflict-line`
   3. [x] - `p1` - **ELSE** the row shows the new chord; `hotkeys:changed` updates the menu bar and the call window's labels - `inst-new-chord`
9. [x] - `p1` - **IF** the user clicks **Restore Defaults** - `inst-if-restore`
   1. [x] - `p1` - API: `hotkeys_reset`; the set is checked again - `inst-api-reset`
10. [x] - `p1` - **RETURN** the Hotkeys pane with every chord and conflict as the core reports them - `inst-return-hotkeys`

### Change a setting

- [x] `p1` - **ID**: `cpt-noter-flow-ui-settings-change-setting`

**Actor**: Primary user

**Success Scenarios**:
- A toggle, pop-up, radio group, slider or list row applies at once, as macOS settings do
- **Remove** under **Apps Noter doesn't ask about** lets the record prompt appear for that app again
- **Check Now** in Updates reads **Noter is up to date**; **Restart Now** installs a waiting update

**Error Scenarios**:
- The core rejects the section (`conflict`, `invalid_input`): the control returns to the stored value and the pane shows its error under the row
- **Offer to record when a call starts** is disabled until the audio self-test passes, with **Needs a passed audio self-test** · **Run Audio Self-Test…**
- **Storage location** in iCloud Drive or Dropbox: the warning line under the path

**Steps**:
1. [x] - `p1` - User opens a pane by the pane list (↑ and ↓), the search field, ⌘, or a deep link from elsewhere (`nav:request` with pane and row) - `inst-open-pane`
2. [x] - `p1` - API: `settings_get` once per window; panes render from the settings slice - `inst-api-get`
3. [x] - `p1` - User changes a control - `inst-user-change`
4. [x] - `p1` - API: `settings_update` with the whole section as wanted state and its `rev` - `inst-api-update`
5. [x] - `p1` - **MATCH** the pane-specific control - `inst-match-control`
   - [x] - `p1` - **CASE** **Apps Noter doesn't ask about** › **Remove**: `settings_unignore_app` (bundle id) - `inst-case-unignore`
   - [x] - `p1` - **CASE** Glossary **+**, edit or **−**: `glossary_upsert` or `glossary_remove`; a new term leads to proposals in Activity (M5) - `inst-case-glossary`
   - [x] - `p1` - **CASE** **Run Audio Self-Test…**: open the self-test sheet with the self-test panel (sheet variant, `self_test_run`) - `inst-case-selftest`
   - [x] - `p1` - **CASE** Models › download or update: `models_download` - `inst-case-models`
   - [x] - `p1` - **CASE** **Call screen display**: the display picker, `setup_set_call_display` - `inst-case-display`
   - [x] - `p1` - **CASE** **Allow Calendar Access** (Privacy): `permission_request` (calendar) - `inst-case-calendar`
   - [x] - `p1` - **CASE** **Open System Settings…**: `open_external` (M1) - `inst-case-open`
   - [x] - `p1` - **CASE** **Restart Now**: `update_install` - `inst-case-update`
6. [x] - `p1` - Store: `settings:changed` replaces the slice; the control shows the stored value - `inst-store-settings`
7. [x] - `p1` - **RETURN** the pane with the new value - `inst-return-pane`

### Test what a screen share would show

- [x] `p1` - **ID**: `cpt-noter-flow-ui-settings-share-test`

**Actor**: Primary user

**Success Scenarios**:
- **Screen Share Test…** shows **What a share would show** with **Hidden**, **Visible** or **May be visible** per surface and share type; **Run Capture Test** shows **On your screen** beside **What the share sees** and one result row per surface

**Error Scenarios**:
- During a call: **Run Capture Test** disabled with **Run the test when no call is being recorded.**; the table still answers
- Screen Recording refused: **Screen Recording · needed for this test only** then **Open System Settings…**; the table and the limits line stay
- Capture failed: **Couldn't capture the display.** · **Try Again**

**Steps**:
1. [x] - `p1` - User clicks **Screen Share Test…** in Privacy - `inst-open-share-test`
2. [x] - `p1` - UI: the 640-pt sheet with the table and the limits line ending **Share a window, not a display, or press** ⌃⌥⌘0 **to hide Noter.** - `inst-share-table`
3. [x] - `p1` - **IF** a call is being recorded - `inst-if-call`
   1. [x] - `p1` - UI: **Run Capture Test** disabled with its reason - `inst-capture-disabled`
4. [x] - `p1` - User clicks **Run Capture Test**; the test-only permission row asks once (**Continue**) - `inst-run-capture`
5. [x] - `p2` - API: `share_test_run` (M2); while it runs, **Showing test windows on Display 2…** with a spinner - `inst-api-share`
6. [x] - `p2` - UI: the two images and one status row per surface (**Call window: hidden**, **Main window: visible: hide it before presenting**) - `inst-share-result`
7. [x] - `p1` - User clicks **Done** - `inst-share-done`
8. [x] - `p1` - **RETURN** the Privacy pane - `inst-return-share`

## 3. Processes / Business Logic (CDSL)

### Check a recorded chord

- [x] `p1` - **ID**: `cpt-noter-algo-ui-settings-check-chord`

**Input**: the key event while a chord field records, the row's variant (single chord, modifier set) and the VoiceOver state

**Output**: accept the chord, keep the old one with a message, cancel or clear

**Steps**:
1. [x] - `p1` - **IF** the key is Esc - `inst-if-esc`
   1. [x] - `p1` - **RETURN** cancel: the old chord stays, recording ends (the field never traps the keyboard) - `inst-return-cancel`
2. [x] - `p1` - **IF** the key is ⌫ - `inst-if-delete`
   1. [x] - `p1` - **RETURN** clear: the field reads **None** and menus show the item without a key - `inst-return-clear`
3. [x] - `p1` - **IF** no Command, Option or Control modifier is held - `inst-if-nomod`
   1. [x] - `p1` - **RETURN** keep the old chord with **Add Command, Option or Control** - `inst-return-nomod`
4. [x] - `p1` - **IF** VoiceOver runs and the chord starts with ⌃⌥ - `inst-if-vo`
   1. [x] - `p1` - **RETURN** keep the old chord with **Used by VoiceOver** (the pane's note explains the VO-Tab pass-through) - `inst-return-vo`
5. [x] - `p1` - Read the key by physical code so the Latin letter shows on any layout - `inst-physical`
6. [x] - `p1` - **RETURN** accept; the core may still refuse it at registration - `inst-return-accept`

### Filter panes by search

- [x] `p1` - **ID**: `cpt-noter-algo-ui-settings-search`

**Input**: the search text and the 11 panes with their names and keyword lists

**Output**: the panes to list, or the empty state

**Steps**:
1. [x] - `p1` - **IF** the text is empty: **RETURN** all 11 panes in their fixed order - `inst-if-empty`
2. [x] - `p1` - Keep the panes whose name or keywords contain the text, ignoring case (the prototype's `PANES` keywords) - `inst-match-keywords`
3. [x] - `p1` - **IF** none matches - `inst-if-none`
   1. [x] - `p1` - **RETURN** **No settings match “…”** in place of the pane list; × in the field clears it - `inst-return-none`
4. [x] - `p1` - **RETURN** the matching panes - `inst-return-matches`

## 4. States (CDSL)

### Hotkey recorder

- [x] `p1` - **ID**: `cpt-noter-state-ui-settings-hotkey-recorder`

**States**: IDLE, RECORDING, CONFLICT, INVALID, CLEARED, DISABLED

**Initial State**: IDLE

**Transitions**:
1. [x] - `p1` - **FROM** IDLE **TO** RECORDING **WHEN** the user clicks the field or presses Return or Space on it - `inst-idle-recording`
2. [x] - `p1` - **FROM** RECORDING **TO** IDLE **WHEN** an accepted chord registers, or Esc cancels - `inst-recording-idle`
3. [x] - `p1` - **FROM** RECORDING **TO** INVALID **WHEN** the chord has no modifier - `inst-recording-invalid`
4. [x] - `p1` - **FROM** RECORDING **TO** CONFLICT **WHEN** VoiceOver, macOS or another app holds the chord - `inst-recording-conflict`
5. [x] - `p1` - **FROM** IDLE **TO** CONFLICT **WHEN** the pane's test registration reports the row's chord refused - `inst-idle-conflict`
6. [x] - `p1` - **FROM** CONFLICT **TO** RECORDING **WHEN** the user records again - `inst-conflict-recording`
7. [x] - `p1` - **FROM** INVALID **TO** RECORDING **WHEN** the user records again - `inst-invalid-recording`
8. [x] - `p1` - **FROM** RECORDING **TO** CLEARED **WHEN** the user presses ⌫ or **Clear shortcut** - `inst-recording-cleared`
9. [x] - `p1` - **FROM** IDLE **TO** DISABLED **WHEN** **Use card keys during calls** turns off (card rows) or **Dismiss with keys** is off (**Dismiss a card**) - `inst-idle-disabled`
10. [x] - `p1` - **FROM** DISABLED **TO** IDLE **WHEN** the switch turns on - `inst-disabled-idle`

### Settings window

- [x] `p1` - **ID**: `cpt-noter-state-ui-settings-window`

**States**: PANE, SEARCH_RESULTS, NO_MATCH, PANE_ERROR, HIDDEN_FOR_PRESENTING

**Initial State**: PANE

**Transitions**:
1. [x] - `p1` - **FROM** PANE **TO** SEARCH_RESULTS **WHEN** the user types in the search field and panes match - `inst-pane-search`
2. [x] - `p1` - **FROM** SEARCH_RESULTS **TO** NO_MATCH **WHEN** no pane matches - `inst-search-nomatch`
3. [x] - `p1` - **FROM** NO_MATCH **TO** PANE **WHEN** the user clears the field - `inst-nomatch-pane`
4. [x] - `p1` - **FROM** PANE **TO** PANE_ERROR **WHEN** a pane-level error arrives (ST-R3), such as **Keychain is locked** (M3) - `inst-pane-error`
5. [x] - `p1` - **FROM** PANE_ERROR **TO** PANE **WHEN** the core reports the fix - `inst-error-pane`
6. [x] - `p1` - **FROM** PANE **TO** HIDDEN_FOR_PRESENTING **WHEN** Noter hides for presenting; it comes back as it was - `inst-pane-hidden`
7. [x] - `p1` - **FROM** HIDDEN_FOR_PRESENTING **TO** PANE **WHEN** Noter is shown again - `inst-hidden-pane`

## 5. Definitions of Done

### Settings window, pane list and search

- [x] `p1` - **ID**: `cpt-noter-dod-ui-settings-window`

The system **MUST** render the Settings window (820×620, minimum 700×480) with ST-R1 (search and the 11 panes in DESIGN's order), ST-R2 (grouped inset form up to 560 pt, labels above controls below 600 pt) and ST-R3, open at a pane and row from deep links, remember each pane's scroll position, and filter panes by name and keywords as the prototype does.

**Implements**:
- `cpt-noter-flow-ui-settings-change-setting`
- `cpt-noter-algo-ui-settings-search`
- `cpt-noter-state-ui-settings-window`

**Constraints**: `cpt-noter-constraint-behaviour-metrics-off`

**Touches**:
- Commands: `settings_get`, `settings_update`, `settings_unignore_app`, `glossary_list`, `glossary_upsert`, `glossary_remove`, `models_download`, `permission_request`, `self_test_run`, `setup_set_call_display`, `update_install`, `open_external` (M1)
- Tests: screenshot specs per pane and per prototype state (`self-test`, `notifications-off`, `icloud`, `model-downloading`, `display-absent`, `one-display`, `update-ready`, `no-match`, `calendar-off`); unit tests for search

### Hotkeys pane and recorder

- [x] `p1` - **ID**: `cpt-noter-dod-ui-settings-hotkeys`

The system **MUST** provide the hotkey recorder in its single-chord, modifier-set and derived variants, show the core's test-registration result when the pane opens, keep the old chord on any refusal with the conflict or invalid line, and offer **Restore Defaults**.

**Implements**:
- `cpt-noter-flow-ui-settings-set-hotkeys`
- `cpt-noter-algo-ui-settings-check-chord`
- `cpt-noter-state-ui-settings-hotkey-recorder`

**Constraints**: `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `hotkeys_list`, `hotkey_set`, `hotkeys_reset`
- Events: `hotkeys:changed`
- Tests: E2E `cpt-noter-seq-settings-set-hotkeys` (Happy path and every Error and Empty path) against `noter-core-harness`; screenshot specs `hk-voiceover`, `hk-nomod`, `hk-card-conflict`

### Privacy settings rows and the Screen Share Test

- [x] `p1` - **ID**: `cpt-noter-dod-ui-settings-privacy`

The system **MUST** show the Privacy pane's **Privacy mode** (with the mode indicator in force), **Audio retention** with its next-nightly-run line, the **Calendar** permission row, the behaviour-metrics switch with its footnote (off by default, rows absent until on), **Voice profiles** with **Manage on Person Pages**, and the **Screen Share Test…** sheet; **What left this Mac** is a frame filled by `cpt-noter-feature-ui-privacy-sources` (M3).

**Implements**:
- `cpt-noter-flow-ui-settings-share-test`

**Constraints**: `cpt-noter-constraint-behaviour-metrics-off`, `cpt-noter-constraint-share-exclusion-limits`

**Touches**:
- Commands: `settings_update`, `permission_request`, `share_test_run` (M2)
- Tests: screenshot specs of the share-test sheet states; E2E of the capture test from M2

## 6. Acceptance Criteria

- [x] Every Settings state of the prototype's `ST` State menu for the panes this feature builds renders identically (General, Audio & Transcription, Privacy rows, Call Screen & Menu Bar, Hotkeys, Updates, search)
- [x] A change applies without a Save button and survives a window reload (it comes back from `settings_get`)
- [x] No hotkey can be set without a modifier; Esc always ends recording
- [x] Searching for a word in a pane's keywords lists that pane; a word in none shows **No settings match “…”**
- [x] The Models & Runtimes, Repositories, Knowledge Sources and Maintenance panes show their frames and state their later milestone instead of a blank area

## 7. Additional Context

**Prototype reuse.** Rewritten in React with the same structure, classes and data attributes: `surface('settings')`, `PANES`, the pane renderers `general`, `audio`, `privacy`, `callscreen`, `hotkeys`, `performancePane` and `updates` in `src/js/50-e-5-settings.js`; `C.hotkeyRecorder` in `src/js/10-a-components.js`; the `dlg-selftest` and `dlg-share-test` sheets in `src/js/30-c-dialogs.js`. Styles `.st-*` and `.e-*` (`src/css/50-e.css`) and `.hk-*` (`src/css/10-a.css`) are ported as-is. Not reusable: `ST()` local state, `onDemo` and the `ALIAS` table (prototype navigation shortcuts).

**States coverage.**

| DESIGN state | Prototype Settings › State ▾ | Feature |
| --- | --- | --- |
| Shortcut used by VoiceOver | `hk-voiceover` | this |
| Card key used by another app | `hk-card-conflict` | this |
| Shortcut without a modifier | `hk-nomod` | this |
| Self-test not passed | `self-test` | this |
| Notifications off | `notifications-off` | this (with `cpt-noter-feature-ui-notifications`) |
| App not asked about | General list after **Don't Ask** | this |
| Storage folder in iCloud or Dropbox | `icloud` | this |
| Model downloading | `model-downloading` | this |
| Remembered display not connected | `display-absent` | this |
| One display | `one-display` | this |
| Update ready | `update-ready` | this |
| No setting matches | `no-match` | this |
| Calendar access off | `calendar-off` | this |
| Screen share test, Capture test running, Screen Recording needed, Capture test failed, Capture test during a call | the `dlg-share-test` sheet | this (bound in M2) |
| Key rejected, Key being verified, Keychain locked, No own account, Signing in, Account signed in, Both accounts signed in, Session ended, Sign out asked, Local model not ready | `key-rejected`, `keychain-locked`, `local-not-ready`, account states | `cpt-noter-feature-ui-accounts` (key states M2, account states and Local model not ready M3) |
| Nothing left this Mac, No knowledge sources, Source indexing, Source sync failed, Sign-in expired, Remove source asked | `nothing-left`, `no-sources`, `source-failed`, `sign-in-expired` | `cpt-noter-feature-ui-privacy-sources` (M3) |
| No repository mapped | `no-repo` | `cpt-noter-feature-ui-handoff` (M2) |
| Job failed, Job running or a call is live, Evidence tool missing | `job-failed`, `jobs-during-call`, `evidence-missing` | `cpt-noter-feature-ui-activity` (M5) |

**DESIGN versus prototype.** The story `cpt-noter-seq-settings-set-hotkeys` (Empty — No setting matches the search) used the word “zoom”, which the prototype's keyword search matches to Privacy and Call Screen & Menu Bar. HoD decision D-2 keeps the prototype's keyword search and changes the story to the prototype's own empty-state words, “zoom calls”, which match no pane; the E2E test of that path types them (listed in `docs/DECOMPOSITION.md`).

**Milestone notes.** `share_test_run` is M2 in milestones.toml; the sheet is built and screenshot-tested in M0 against the fake core and its E2E proof counts from M2 (discrepancy 3).

**Not applicable.** Keys and secrets: none in the panes of this feature (Models & Runtimes belongs to `cpt-noter-feature-ui-accounts`: the API keys and Runtime per task in M2, the rest in M3). Data: settings live in the core's `settings` table; the UI keeps no copy beyond the store slice.
