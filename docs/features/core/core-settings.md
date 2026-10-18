---
title: "Feature: Settings, hotkeys and glossary"
description: "Typed settings sections with defaults and one revision, global hotkeys with conflict and reserved-chord detection registered at launch, ignored apps and the glossary, written from two windows without losing an edit."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M0
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Settings, hotkeys and glossary

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Change a settings section](#change-a-settings-section)
  - [Set a global hotkey](#set-a-global-hotkey)
  - [Reset hotkeys and card keys](#reset-hotkeys-and-card-keys)
  - [Edit the glossary and ignored apps](#edit-the-glossary-and-ignored-apps)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Load and validate sections](#load-and-validate-sections)
  - [Check a hotkey chord](#check-a-hotkey-chord)
  - [Register app hotkeys at launch](#register-app-hotkeys-at-launch)
- [4. States (CDSL)](#4-states-cdsl)
  - [Hotkey binding](#hotkey-binding)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Typed sections with one revision](#typed-sections-with-one-revision)
  - [Hotkeys](#hotkeys)
  - [Glossary](#glossary)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-noter-featstatus-core-settings`

- [ ] `p1` - `cpt-noter-feature-core-settings`

## 1. Feature Context

### 1.1 Overview

The settings service in `noter-core` stores each section of `Settings` as one row of `settings`, with defaults for a fresh install and migrations for older shapes. A write replaces one whole section and must carry the current `rev`. Hotkeys are registered at launch through the Tauri global-shortcut plugin and checked for conflicts, VoiceOver chords and missing modifiers. The glossary and ignored apps live here too. Every change is a change-log row and is broadcast whole.

### 1.2 Purpose

Every component reads settings, and two windows (Settings and First run) write them. One typed owner with one revision stops lost updates, and wanted-state section writes keep the UI simple.

**Requirements**: PRD › Feature specification › 14. Settings.

**Principles**: `cpt-noter-principle-core-intent-commands`

**Delivers**:
- Frozen commands (M0): `settings_get`, `settings_update`, `settings_unignore_app`, `hotkeys_list`, `hotkey_set`, `hotkeys_reset`, `glossary_list`, `glossary_upsert`, `glossary_remove`.
- Events: `settings:changed`, `hotkeys:changed`.
- DESIGN.md story: `cpt-noter-seq-settings-set-hotkeys` (M0).

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Changes settings in the Settings window or during first run; sets hotkeys; edits the glossary |
| UI window (Settings, First run, main) | Calls the commands with the `rev` it saw |
| Core startup | Loads settings and registers app hotkeys |
| macOS | Owns global shortcuts; refuses chords another app holds |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-settings`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-settings`, `cpt-noter-dbtable-settings`; DESIGN.md story `cpt-noter-seq-settings-set-hotkeys`
- **Dependencies**: `cpt-noter-feature-core-storage`, `cpt-noter-feature-core-ipc-host`

## 2. Actor Flows (CDSL)

### Change a settings section

- [x] `p1` - **ID**: `cpt-noter-flow-core-settings-update`

**Actor**: Primary user (Settings or First run window)

**Success Scenarios**:
- The user changes a value; the window sends the whole section with the `rev` it saw; every window gets the new `Settings`.

**Error Scenarios**:
- Another window changed settings in between: `conflict` with `detail.current_rev`; the window reloads the section.
- A value is out of range or of the wrong shape: `invalid_input`.
- The call is made from a window outside the scope (only Settings and First run may write): `window_not_allowed`.

**Steps**:
1. [x] - `p1` - API: `settings_update { rev, section }` - `inst-update-call`
2. [x] - `p1` - Validate the section with `cpt-noter-algo-core-settings-validate`; a failure **RETURN** `invalid_input` - `inst-validate`
3. [x] - `p1` - DB: replace the section row and bump the settings `rev` through `cpt-noter-algo-core-storage-change-tx` (actor `you`, before and after the section) - `inst-write-section`
4. [x] - `p1` - **IF** the write returned `conflict` - `inst-if-conflict`
   1. [x] - `p1` - **RETURN** `conflict` with `detail.current_rev` - `inst-return-conflict`
5. [x] - `p1` - Call the section-changed hook with the new section; first run subscribes to it and applies `launch_at_login` (native login item) and `offer_to_record` (detection rule), so settings never calls into first-run code - `inst-side-effects`
6. [x] - `p1` - Emit `settings:changed` with the whole `Settings` and a new `version` - `inst-emit-settings`
7. [x] - `p1` - **RETURN** the whole `Settings` - `inst-return-settings`

### Set a global hotkey

- [x] `p1` - **ID**: `cpt-noter-flow-core-settings-hotkey-set`

**Actor**: Primary user (Settings › Hotkeys)

**Success Scenarios**:
- The user records a new chord for an action; it is registered and listed as `registered`.
- The user clears a chord; the action has no hotkey (`not_set`).

**Error Scenarios**:
- The chord has no modifier: `invalid_input` with `rule: no_modifier` ("Shortcut without a modifier").
- The chord is a VoiceOver or system chord: `hotkey_reserved`.
- Another app holds the chord: `hotkey_conflict` with the owner when macOS reveals it; the old chord stays.
- Another Noter action already uses the chord: `hotkey_conflict` naming that action.

**Steps**:
1. [x] - `p1` - API: `hotkey_set { action, shortcut }` from the Settings window - `inst-hotkey-call`
2. [x] - `p1` - **IF** `shortcut` is null - `inst-if-clear`
   1. [x] - `p1` - Unregister the action's chord, store `null`, go to step 6 - `inst-clear`
3. [x] - `p1` - Run `cpt-noter-algo-core-settings-hotkey-check`; **RETURN** its error if any - `inst-run-check`
4. [x] - `p1` - Register the new chord with the global-shortcut plugin; on refusal **RETURN** `hotkey_conflict` and keep the old chord registered - `inst-register-new`
5. [x] - `p1` - Unregister the old chord - `inst-unregister-old`
6. [x] - `p1` - DB: store the binding through the change-log write path - `inst-store-binding`
7. [x] - `p1` - Emit `hotkeys:changed` with the whole `HotkeyList` and a new `version` - `inst-emit-hotkeys`
8. [x] - `p1` - **RETURN** the `HotkeyList` - `inst-return-hotkeys`

### Reset hotkeys and card keys

- [x] `p2` - **ID**: `cpt-noter-flow-core-settings-hotkeys-reset`

**Actor**: Primary user (Settings › Hotkeys)

**Success Scenarios**:
- Every app hotkey and the card-key setting return to their defaults and are registered again.

**Error Scenarios**:
- A default chord is now held by another app: that action is listed with status `conflict` and `HotkeyNotRegistered` joins the degraded set; the others register.

**Steps**:
1. [x] - `p1` - API: `hotkeys_reset {}` - `inst-reset-call`
2. [x] - `p1` - Unregister every app hotkey - `inst-unregister-all`
3. [x] - `p1` - DB: write the default bindings and the default `CardKeySettings` in one batch - `inst-write-defaults`
4. [x] - `p1` - Run `cpt-noter-algo-core-settings-register-hotkeys` - `inst-register-defaults`
5. [x] - `p1` - **RETURN** the `HotkeyList`; emit `hotkeys:changed` - `inst-return-reset`

### Edit the glossary and ignored apps

- [x] `p2` - **ID**: `cpt-noter-flow-core-settings-glossary`

**Actor**: Primary user (Settings, or the main window when fixing a term)

**Success Scenarios**:
- A term is added or edited with its variants and spoken forms; the list comes back; a live engine session receives the new glossary.
- An ignored app is removed from the list, so its calls are offered again.

**Error Scenarios**:
- A stale `rev` on an existing term: `conflict`.
- An empty term: `invalid_input`.

**Steps**:
1. [x] - `p1` - API: `glossary_upsert { id?, rev?, term, variants_latin, variants_cyrillic, spoken_forms, lang?, always_apply }`, `glossary_remove { id }` or `settings_unignore_app { bundle_id }` - `inst-glossary-call`
2. [x] - `p1` - Validate; an empty term **RETURN** `invalid_input` - `inst-glossary-validate`
3. [x] - `p1` - DB: write the term (with `rev`) or the ignored-apps list through the change-log write path - `inst-glossary-write`
4. [x] - `p1` - Call the glossary-changed hook with the new list; while a call is captured the capture session sends it to the engine (`set_glossary`, M1) - `inst-glossary-live`
5. [x] - `p1` - **RETURN** the `GlossaryList`, or the `Settings` for an unignore (with `settings:changed`) - `inst-glossary-return`

## 3. Processes / Business Logic (CDSL)

### Load and validate sections

- [x] `p1` - **ID**: `cpt-noter-algo-core-settings-validate`

**Input**: A stored or submitted section.

**Output**: A valid section of the current shape, or `invalid_input` for a submitted one.

**Steps**:
1. [x] - `p1` - **IF** the section is missing (fresh install), **RETURN** its defaults - `inst-defaults`
2. [x] - `p1` - **IF** a stored section has an older shape, migrate it to the current shape and keep unknown fields out - `inst-migrate-shape`
3. [x] - `p1` - Check every value against its type's range and enum - `inst-check-values`
4. [x] - `p1` - **RETURN** the section, or `invalid_input` naming the field - `inst-return-section`

### Check a hotkey chord

- [x] `p1` - **ID**: `cpt-noter-algo-core-settings-hotkey-check`

**Input**: Action and chord in Tauri accelerator syntax.

**Output**: Ok, or `invalid_input`, `hotkey_reserved` or `hotkey_conflict`.

**Steps**:
1. [x] - `p1` - **IF** the chord has no modifier **RETURN** `invalid_input` with `rule: no_modifier` - `inst-no-modifier`
2. [x] - `p1` - **IF** the chord is on the reserved list (VoiceOver, system chords) **RETURN** `hotkey_reserved` - `inst-reserved`
3. [x] - `p1` - **IF** another Noter action or the card-key chords use it **RETURN** `hotkey_conflict` naming that action - `inst-internal-conflict`
4. [x] - `p1` - **RETURN** ok - `inst-return-ok`

### Register app hotkeys at launch

- [x] `p1` - **ID**: `cpt-noter-algo-core-settings-register-hotkeys`

**Input**: Stored bindings over the defaults (`DEFAULT_HOTKEYS`, PRD › 14: ⌃⌥⌘K mute the copilot, ⌃⌥⌘Z undo the last card action, ⌃⌥⌘0 Hide for Presenting, the others ⌃⌥⌘ + a letter; the fake core's world uses the same).

**Output**: Every bound app hotkey registered, or its status set to `conflict`.

**Steps**:
1. [x] - `p1` - **FOR EACH** app hotkey binding with a chord - `inst-for-bindings`
   1. [x] - `p1` - **TRY** register it through the host's `ShortcutRegistrar` in `CoreDeps` (the Tauri global-shortcut plugin in the app, a scripted one in the harness), unless the chord is now on the reserved list (status `reserved_by_system`); its press calls `CoreApi` as `Caller::Native { surface: hotkey }` - `inst-try-register`
   2. [x] - `p1` - **CATCH** a refusal: status `conflict`; add `HotkeyNotRegistered` to the degraded set - `inst-catch-register`
2. [x] - `p1` - Card keys (`undo_card_action`) are not registered here and are listed as `registered_during_capture`; the copilot registers them while capture runs (M4) - `inst-skip-card-keys`
3. [x] - `p1` - **RETURN** the `HotkeyList` - `inst-return-registered`

## 4. States (CDSL)

### Hotkey binding

- [x] `p1` - **ID**: `cpt-noter-state-core-settings-hotkey`

**States**: not_set, registered, conflict, reserved_by_system, registered_during_capture

**Initial State**: registered for actions with a default chord, not_set otherwise

**Transitions**:
1. [x] - `p1` - **FROM** not_set **TO** registered **WHEN** a chord is set and macOS accepts it - `inst-st-register`
2. [x] - `p1` - **FROM** registered **TO** registered **WHEN** a new chord is accepted (the old one is released) - `inst-st-rebind`
3. [x] - `p1` - **FROM** registered **TO** conflict **WHEN** registration at launch is refused because another app holds the chord - `inst-st-conflict`
4. [x] - `p1` - **FROM** conflict **TO** registered **WHEN** a new chord or a reset registers - `inst-st-resolve`
5. [x] - `p1` - **FROM** registered **TO** not_set **WHEN** the chord is cleared - `inst-st-clear`
6. [x] - `p2` - **FROM** not_set **TO** registered_during_capture **WHEN** card keys are enabled (registration itself belongs to the copilot, M4) - `inst-st-card-keys`
7. [x] - `p1` - **FROM** registered **TO** reserved_by_system **WHEN** a stored chord is on the reserved list at launch; it is not registered - `inst-st-reserved`

## 5. Definitions of Done

### Typed sections with one revision

- [x] `p1` - **ID**: `cpt-noter-dod-core-settings-sections`

The system **MUST** store each `Settings` section in `settings`, serve defaults on a fresh install, migrate older shapes, replace a whole section per `settings_update` guarded by the settings `rev`, log every change, and emit `settings:changed` with the whole state and a new `version`.

**Implements**:
- `cpt-noter-flow-core-settings-update`
- `cpt-noter-algo-core-settings-validate`

**Touches**:
- API: `settings_get`, `settings_update`, `settings_unignore_app`
- DB: `settings`, `changes`
- Entities: `Settings`, `SettingsSection`

### Hotkeys

- [ ] `p1` - **ID**: `cpt-noter-dod-core-settings-hotkeys`

The system **MUST** register app hotkeys at launch and keep them registered, refuse chords without a modifier, reserved chords and conflicts with the codes above while keeping the old chord, call the core as `Caller::Native { surface: hotkey }` when a hotkey fires, and restore defaults with `hotkeys_reset`.

**Implements**:
- `cpt-noter-flow-core-settings-hotkey-set`
- `cpt-noter-flow-core-settings-hotkeys-reset`
- `cpt-noter-algo-core-settings-hotkey-check`
- `cpt-noter-algo-core-settings-register-hotkeys`
- `cpt-noter-state-core-settings-hotkey`

**Touches**:
- API: `hotkeys_list`, `hotkey_set`, `hotkeys_reset`, `hotkeys:changed`
- DB: `settings`
- Entities: `HotkeyList`, `CardKeySettings`

### Glossary

- [x] `p2` - **ID**: `cpt-noter-dod-core-settings-glossary`

The system **MUST** keep glossary terms with `rev`, variants and spoken forms, refuse empty terms and stale revisions, and hand the glossary to a live engine session when one exists.

**Implements**:
- `cpt-noter-flow-core-settings-glossary`

**Touches**:
- API: `glossary_list`, `glossary_upsert`, `glossary_remove`
- DB: `glossary` (PRD table, with `rev`; its migration belongs to this feature in M0)
- Entities: `GlossaryTerm`

## 6. Acceptance Criteria

- [ ] E2E against the real core, story `cpt-noter-seq-settings-set-hotkeys`: setting a chord without a modifier shows "Shortcut without a modifier", a VoiceOver chord shows "Shortcut used by VoiceOver", a valid chord is listed as registered.
- [x] Two windows editing settings: the second write with the old `rev` gets `conflict` and nothing is lost.
- [ ] Every M0 settings command succeeds at least once in E2E runs against the real core.
- [x] A fresh install answers `settings_get` with every section at its default.
- [ ] `just gate` passes.
