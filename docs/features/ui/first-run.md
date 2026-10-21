---
title: "Feature — First-run wizard"
description: "Six-step first-run window that downloads the models in the background, asks for Microphone and System Audio Recording, proves both streams with the self-test, and sets the call display and audio retention, so call detection is on before the first call."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-first-run
milestone: M0
---

# Feature: First-run wizard


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Set up Noter before the first call](#set-up-noter-before-the-first-call)
  - [Download the models while finishing setup](#download-the-models-while-finishing-setup)
  - [Run the audio self-test](#run-the-audio-self-test)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Render a self-test message](#render-a-self-test-message)
  - [Choose the default call display](#choose-the-default-call-display)
- [4. States (CDSL)](#4-states-cdsl)
  - [Setup steps](#setup-steps)
  - [Stepper item](#stepper-item)
  - [Permission row](#permission-row)
  - [Self-test panel](#self-test-panel)
- [5. Definitions of Done](#5-definitions-of-done)
  - [First-run window and steps](#first-run-window-and-steps)
  - [Models step](#models-step)
  - [Permission rows, self-test panel and display picker](#permission-rows-self-test-panel-and-display-picker)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [x] `p1` - **ID**: `cpt-noter-featstatus-ui-first-run`

## 1. Feature Context

- [x] `p1` - `cpt-noter-feature-ui-first-run`

### 1.1 Overview

The first-run window (760×560, fixed width) walks through six steps: **Welcome**, **Models**, **Permissions** with the audio self-test, **Call display**, **Audio storage** and **Assistants**. Downloads run in the background while the user carries on; permissions are asked only at the step that needs them; the self-test switches call detection on when it passes. Skipping leaves call detection off and puts a banner up, but never blocks **Record** (PM-30, PM-60). Closing mid-setup keeps Noter in the menu bar and reopening resumes at the same step.

### 1.2 Purpose

It implements `cpt-noter-component-screen-first-run` and the four components it introduces, which Settings reuses: `cpt-noter-component-ui-wizard-stepper`, `cpt-noter-component-ui-permission-check-row`, `cpt-noter-component-ui-self-test-panel` and `cpt-noter-component-ui-display-picker`. Step 6's key fields and own-account rows belong to `cpt-noter-feature-ui-accounts` (M3); this feature builds step 6's frame, its local-runtime line, its privacy-mode radio group and **Finish**.

**Requirements**: PRD › Live copilot › Surfaces › First run; PRD › Security, privacy and permissions › macOS permissions requested; PRD › Repository layout › Models. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-degrade-visibly`, `cpt-noter-principle-privacy-visible`

Success criteria: a user with an external display reaches **Self-test passed** and Today with call detection on in one sitting while the 2 GB of models download.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Grants permissions, runs the self-test, chooses the display and audio retention, skips or finishes |
| Noter core (system) | Downloads and checks models, requests and re-reads permissions, runs the self-test and decides pass or fail, switches call detection on, stores choices as settings |
| macOS (system) | Shows the Microphone prompt and the System Settings privacy panes |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Live copilot › Surfaces › First run
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Screen — First-run wizard; Component — Wizard stepper; Component — Permission check row; Component — Self-test panel; Component — Display picker; 3.5 Permissions the UI asks for
- **Design elements**: `cpt-noter-component-screen-first-run`, `cpt-noter-component-ui-wizard-stepper`, `cpt-noter-component-ui-permission-check-row`, `cpt-noter-component-ui-self-test-panel`, `cpt-noter-component-ui-display-picker`
- **Stories**: `cpt-noter-seq-first-run-complete-setup`, `cpt-noter-seq-first-run-download-models` (M0)
- **Frozen commands it calls**: `setup_status`, `setup_set_step`, `models_download`, `permission_request`, `self_test_run` (Channel `SelfTestMsg`), `setup_set_call_display`, `setup_set_audio_storage`, `settings_get`, `settings_update` (privacy mode); placed in M1 by milestones.toml: `levels_subscribe`, `open_external`, `window_navigate`
- **Events**: `setup:changed`, `env:changed` (displays, disk, connection), `jobs:progress` (downloads)
- **Prototype modules**: `src/js/10-a-surfaces.js` (`surface('firstrun')`, `FR_STATES`, step renderers), `src/js/10-a-components.js` (`C.wizardStepper`, `C.permissionCheckRow`, `C.selfTestPanel`, `C.displayPicker`), `src/css/10-a.css` (`.fr-*`)
- **Dependencies**: `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-primitives`, `cpt-noter-feature-ui-accessibility-l10n`

## 2. Actor Flows (CDSL)

### Set up Noter before the first call

- [x] `p1` - **ID**: `cpt-noter-flow-ui-first-run-complete-setup`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-first-run-complete-setup`: Microphone allowed, system audio allowed from System Settings, **Self-test passed**, then **Call display**
- Other — Finish the remaining steps: **Call display** with the display without the call app chosen and **Open the call screen automatically** on, **Audio storage** with **Keep audio for 30 days**, **Assistants**, **Finish** opens Today with call detection on

**Error Scenarios**:
- Error — Microphone not allowed: **Microphone · not allowed** with **Open System Settings…**, then **Hearing you** when Noter is in front again
- Error — System audio not allowed: **System audio recording · not allowed yet** with the how-to line; back from System Settings the row shows **Checking…** then **Granted**
- Error — Self-test hears only one stream: **We hear your microphone but not system audio. Play any sound in another app and try again.**
- Empty — Self-test skipped: step 3 marked with a dash; after **Finish**, the app banner **Call detection is off until the audio self-test passes** · **Run Audio Self-Test…** · **Finish Setup…**; **Record** works as always

**Steps**:
1. [x] - `p1` - User opens Noter for the first time, or **Run Setup Again…**, **Finish Setup…** - `inst-open`
2. [x] - `p1` - API: `setup_status` (steps, models, permissions, self-test, call display, detection) - `inst-api-status`
3. [x] - `p1` - UI: open at the step where setup stopped (resumed variant of the stepper), or **Welcome** - `inst-open-step`
4. [x] - `p1` - User reads **Welcome to Noter** and clicks **Continue**; API: `setup_set_step` (models) - `inst-welcome`
5. [x] - `p1` - Flow: the Models step runs `cpt-noter-flow-ui-first-run-download-models`; **Continue** is enabled at once - `inst-models-step`
6. [x] - `p1` - UI: the Permissions step shows the **Microphone** and **System audio recording** rows and the self-test, with **Run Test** dimmed until system audio is allowed - `inst-permissions-step`
7. [x] - `p1` - User clicks **Allow…** beside **Microphone** - `inst-allow-mic`
8. [x] - `p1` - API: `permission_request` (microphone); macOS shows its prompt - `inst-api-mic`
9. [x] - `p1` - **IF** the user allows - `inst-if-mic-allowed`
   1. [x] - `p2` - API: `levels_subscribe` (M1); the row shows the device, a moving meter and **Hearing you** - `inst-mic-meter`
10. [x] - `p1` - **ELSE** - `inst-else-mic-denied`
    1. [x] - `p1` - UI: the row reads **Microphone · not allowed** with **Open System Settings…** - `inst-mic-denied`
11. [x] - `p1` - User clicks **Open System Settings…** beside **System audio recording** (or beside a denied microphone) - `inst-open-settings`
12. [x] - `p2` - API: `open_external` (the System Settings privacy pane, M1) - `inst-api-open-settings`
13. [x] - `p1` - UI: when Noter becomes active again, the row shows a spinner and **Checking…** while the core re-reads the permission (`setup:changed`), then **Granted**; the self-test line **System audio recording is not allowed yet.** goes away - `inst-checking`
14. [x] - `p1` - User clicks **Run Test**; Flow: `cpt-noter-flow-ui-first-run-self-test` - `inst-run-test`
15. [x] - `p1` - **IF** the user clicks **Skip for Now** on steps 3 or 4 - `inst-if-skip`
    1. [x] - `p1` - API: `setup_set_step` (skip); the stepper marks the step skipped with a dash - `inst-api-skip`
16. [x] - `p1` - UI: **Call display** with `cpt-noter-component-ui-display-picker`; the user keeps or changes the choice; API: `setup_set_call_display` (display identity, open automatically) - `inst-call-display`
17. [x] - `p1` - UI: **Audio storage** radio group (**Keep audio for 30 days**, **7 days**, **90 days**, **Forever**, **Never store audio**); API: `setup_set_audio_storage` - `inst-audio-storage`
18. [x] - `p1` - UI: **Assistants** shows the step 6 frame: the cards of `cpt-noter-feature-ui-accounts` (key fields M2, sign-in M3), the **Local runtime** line and the **Privacy mode** radio group; a change calls `settings_update` (privacy) - `inst-assistants`
19. [x] - `p1` - **IF** no key is stored, no account is signed in and no local runtime is found - `inst-if-no-assistant`
    1. [x] - `p1` - UI: the warning **Without an assistant Noter still records and transcribes; summaries wait until one is connected.**; **Finish** stays enabled - `inst-no-assistant`
20. [x] - `p1` - User clicks **Finish** - `inst-finish`
21. [x] - `p2` - API: `setup_set_step` (done), then `window_navigate` (Today, M1); the first-run window closes - `inst-api-finish`
22. [x] - `p1` - **RETURN** the main window with call detection on, or with the self-test banner in MW-R5 when step 3 was skipped - `inst-return-finish`

### Download the models while finishing setup

- [x] `p1` - **ID**: `cpt-noter-flow-ui-first-run-download-models`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-first-run-download-models`: the three bundles with size, progress and percentage, **About 2 GB** with **Pause**; **Continue** at once; downloads go on in the background with a ring on **Models** in the stepper

**Error Scenarios**:
- Error — No connection: **Waiting for a connection — downloads resume automatically**
- Error — Not enough disk space: error banner **Needs 2.1 GB, 1.4 GB free** with **Try Again**
- Error — Download failed its check: **Check failed** and **Try Again** on the bundle row, progress stopped; **Models** shows the error glyph once the user moves on
- Error — Speech model not downloaded yet: the self-test shows **Waiting for the speech model · 62 %** and runs by itself once the model is in

**Steps**:
1. [x] - `p1` - UI: the Models step lists **Speech model · WhisperKit Large v3 Turbo** 1.5 GB, **Speaker model** 0.1 GB, **Search model** 0.4 GB - `inst-list-bundles`
2. [x] - `p1` - API: `models_download` (start) unless the core already downloads them - `inst-api-download`
3. [x] - `p1` - UI: each row follows `jobs:progress` with its percentage or **Ready**; the footer reads **About 2 GB** with **Pause** or **Resume** (`models_download` pause or resume) - `inst-progress`
4. [x] - `p1` - **MATCH** the download state the core reports - `inst-match-download`
   - [x] - `p1` - **CASE** offline: the line **Waiting for a connection — downloads resume automatically**; nothing to do - `inst-case-offline`
   - [x] - `p1` - **CASE** disk short (`disk_full`): the error banner in FR-R2 **Needs 2.1 GB, 1.4 GB free** · **Try Again** (`models_download` again) - `inst-case-disk`
   - [x] - `p1` - **CASE** a bundle failed its check (`checksum_failed`): **Check failed** · **Try Again** on that row, its bar stopped; the stepper marks **Models** with the error glyph - `inst-case-checksum`
5. [x] - `p1` - User clicks **Continue** at any time; the stepper shows the background ring on **Models** with **Downloading in the background · 64 %** - `inst-continue-bg`
6. [x] - `p1` - UI: when every bundle is in, announce **Models downloaded** politely once - `inst-announce-done`
7. [x] - `p1` - **RETURN** the models downloading or ready, with setup going on - `inst-return-models`

### Run the audio self-test

- [x] `p1` - **ID**: `cpt-noter-flow-ui-first-run-self-test`

**Actor**: Primary user

**Success Scenarios**:
- **Play Test Clip**, the transcript line shows "Noter test. Привет. Hallo." in three languages, **Self-test passed** with **System audio arrives**, **Your microphone arrives**, **Both streams line up** and **Noter's own sounds stay out of the recording**

**Error Scenarios**:
- Only one stream arrives: the failure line names the silent stream; **Run Test** runs again
- Permission missing: meters at zero, **Play Test Clip** and **Run Test** dimmed, **System audio recording is not allowed yet.** with **Open System Settings…**
- Exclusion off or failed: the fourth line is information only; the test still passes for call detection

**Steps**:
1. [x] - `p1` - User clicks **Play Test Clip** or **Run Test**, or plays any sound in another app - `inst-user-test`
2. [x] - `p1` - **IF** the speech model is not in - `inst-if-model`
   1. [x] - `p1` - UI: **Waiting for the speech model · 62 %** from the setup status, **Play Test Clip** and **Run Test** dimmed; the core refuses `self_test_run` with `model_missing` until the speech bundle is ready (D-21), so the UI calls it again by itself when the bundle turns ready - `inst-wait-model`
3. [x] - `p1` - API: `self_test_run` with the snapshot-then-stream rule; the Channel sends `levels`, `line`, `stream_arrived`, `passed` or `failed`, then `ended` - `inst-api-selftest`
4. [x] - `p1` - Algorithm: render each message with `cpt-noter-algo-ui-first-run-self-test-result` - `inst-render-selftest`
5. [x] - `p1` - **IF** the test passed - `inst-if-passed`
   1. [x] - `p1` - UI: **Self-test passed** beside the heading, the result lines and **Details** (lag, alignment, clip heard after); each line announced politely once, then "Self-test passed"; the stepper marks **Permissions** done - `inst-passed`
6. [x] - `p1` - **RETURN** the self-test result; the core switches call detection on after a pass - `inst-return-selftest`

## 3. Processes / Business Logic (CDSL)

### Render a self-test message

- [x] `p1` - **ID**: `cpt-noter-algo-ui-first-run-self-test-result`

**Input**: one `SelfTestEvent`

**Output**: the self-test panel's new state

**Steps**:
1. [x] - `p1` - **MATCH** the event type - `inst-match-event`
   - [x] - `p1` - **CASE** `levels`: update the **You** and **Others** meters (at most every 100 ms; peak hold off under Reduce motion) - `inst-case-levels`
   - [x] - `p1` - **CASE** `line`: show the live transcript line with each part's language attribute; never announce it - `inst-case-line`
   - [x] - `p1` - **CASE** `stream_arrived`: tick **System audio arrives** or **Your microphone arrives** - `inst-case-arrived`
   - [x] - `p1` - **CASE** `passed`: tick **Both streams line up**; show the fourth line as passed, as **Noter's own sounds are recorded. Replay while recording stays off. Change this in Settings › Audio & Transcription.** (exclusion off) or as **Noter's own sounds reached the recording. Replay while recording stays off until this passes.** (exclusion failed) - `inst-case-passed`
   - [x] - `p1` - **CASE** `failed`: show **We hear your microphone but not system audio. Play any sound in another app and try again.** or its mirror for the microphone; **zero buffers** counts as system audio recording not allowed: **System audio recording is not allowed yet.** with **Open System Settings…** and the **System audio recording** row back to its missing state; **timed out** fails with **The test didn't finish. Check that sound is playing, then try again.** and **Run Test** enabled (HoD decision D-14) - `inst-case-failed`
   - [x] - `p1` - **CASE** `ended`: stop the running state; **Run Test** is enabled again - `inst-case-ended`
2. [x] - `p1` - **RETURN** the panel state - `inst-return-panel`

### Choose the default call display

- [x] `p1` - **ID**: `cpt-noter-algo-ui-first-run-default-display`

**Input**: the display list from the core (identity, name, resolution, arrangement, whether the call app is there) and the remembered choice

**Output**: the picker's options and selection

**Steps**:
1. [x] - `p1` - **IF** one display is connected - `inst-if-one`
   1. [x] - `p1` - **RETURN** the one-display variant: one rectangle, the floating-layout note and drawing, only the default option - `inst-return-one`
2. [x] - `p1` - Options: **The display without the call app** (default, **Recommended**), then each display by name with **· Call app is here** where it applies - `inst-options`
3. [x] - `p1` - **IF** a remembered display is not connected: list it as **LG UltraFine 5K (not connected)** in secondary text, still selectable - `inst-absent`
4. [x] - `p1` - Select the remembered choice, or the default - `inst-select`
5. [x] - `p1` - **RETURN** the options and selection; the list redraws in place when `env:changed` reports a display added or removed - `inst-return-display`

## 4. States (CDSL)

### Setup steps

- [x] `p1` - **ID**: `cpt-noter-state-ui-first-run-steps`

**States**: WELCOME, MODELS, PERMISSIONS, CALL_DISPLAY, AUDIO_STORAGE, ASSISTANTS, DONE

**Initial State**: WELCOME

**Transitions**:
1. [x] - `p1` - **FROM** WELCOME **TO** MODELS **WHEN** the user clicks **Continue** - `inst-welcome-models`
2. [x] - `p1` - **FROM** MODELS **TO** PERMISSIONS **WHEN** the user clicks **Continue** (downloads go on) - `inst-models-permissions`
3. [x] - `p1` - **FROM** PERMISSIONS **TO** CALL_DISPLAY **WHEN** the user clicks **Continue** or **Skip for Now** - `inst-permissions-display`
4. [x] - `p1` - **FROM** CALL_DISPLAY **TO** AUDIO_STORAGE **WHEN** the user clicks **Continue** or **Skip for Now** - `inst-display-storage`
5. [x] - `p1` - **FROM** AUDIO_STORAGE **TO** ASSISTANTS **WHEN** the user clicks **Continue** - `inst-storage-assistants`
6. [x] - `p1` - **FROM** ASSISTANTS **TO** DONE **WHEN** the user clicks **Finish** - `inst-assistants-done`
7. [x] - `p1` - **FROM** CALL_DISPLAY **TO** PERMISSIONS **WHEN** the user clicks **Back** or a done, skipped or failed step in the stepper (the same for every later step and its earlier steps) - `inst-back`

### Stepper item

- [x] `p1` - **ID**: `cpt-noter-state-ui-first-run-stepper-item`

**States**: UPCOMING, CURRENT, DONE, SKIPPED, ERROR, RUNNING_IN_BACKGROUND

**Initial State**: UPCOMING

**Transitions**:
1. [x] - `p1` - **FROM** UPCOMING **TO** CURRENT **WHEN** the wizard reaches the step - `inst-upcoming-current`
2. [x] - `p1` - **FROM** CURRENT **TO** DONE **WHEN** the user continues and the step's work is complete - `inst-current-done`
3. [x] - `p1` - **FROM** CURRENT **TO** SKIPPED **WHEN** the user clicks **Skip for Now** - `inst-current-skipped`
4. [x] - `p1` - **FROM** CURRENT **TO** RUNNING_IN_BACKGROUND **WHEN** the user leaves **Models** while downloads continue - `inst-current-running`
5. [x] - `p1` - **FROM** RUNNING_IN_BACKGROUND **TO** DONE **WHEN** every bundle is in - `inst-running-done`
6. [x] - `p1` - **FROM** RUNNING_IN_BACKGROUND **TO** ERROR **WHEN** a bundle fails its check - `inst-running-error`
7. [x] - `p1` - **FROM** SKIPPED **TO** CURRENT **WHEN** the user clicks it - `inst-skipped-current`
8. [x] - `p1` - **FROM** ERROR **TO** CURRENT **WHEN** the user clicks it - `inst-error-current`

### Permission row

- [x] `p1` - **ID**: `cpt-noter-state-ui-first-run-permission-row`

**States**: NOT_ASKED, MISSING, CHECKING, GRANTED, DENIED

**Initial State**: NOT_ASKED

**Transitions**:
1. [x] - `p1` - **FROM** NOT_ASKED **TO** GRANTED **WHEN** the user allows the macOS prompt after **Allow…** - `inst-notasked-granted`
2. [x] - `p1` - **FROM** NOT_ASKED **TO** DENIED **WHEN** the user clicks **Don't Allow** - `inst-notasked-denied`
3. [x] - `p1` - **FROM** MISSING **TO** CHECKING **WHEN** the user returns from System Settings after **Open System Settings…** (system audio starts in MISSING because macOS has no prompt for it) - `inst-missing-checking`
4. [x] - `p1` - **FROM** DENIED **TO** CHECKING **WHEN** the user returns from System Settings - `inst-denied-checking`
5. [x] - `p1` - **FROM** CHECKING **TO** GRANTED **WHEN** the core reads the permission as granted - `inst-checking-granted`
6. [x] - `p1` - **FROM** CHECKING **TO** MISSING **WHEN** the core still reads it as not granted - `inst-checking-missing`

### Self-test panel

- [x] `p1` - **ID**: `cpt-noter-state-ui-first-run-self-test`

**States**: IDLE, WAITING_FOR_MODEL, PERMISSION_MISSING, RUNNING, PASSED, FAILED

**Initial State**: IDLE

**Transitions**:
1. [x] - `p1` - **FROM** IDLE **TO** WAITING_FOR_MODEL **WHEN** the user runs the test before the speech model is in - `inst-idle-waiting`
2. [x] - `p1` - **FROM** WAITING_FOR_MODEL **TO** RUNNING **WHEN** the speech model arrives - `inst-waiting-running`
3. [x] - `p1` - **FROM** IDLE **TO** PERMISSION_MISSING **WHEN** system audio recording is not allowed - `inst-idle-missing`
4. [x] - `p1` - **FROM** PERMISSION_MISSING **TO** IDLE **WHEN** the permission is granted - `inst-missing-idle`
5. [x] - `p1` - **FROM** IDLE **TO** RUNNING **WHEN** the user clicks **Run Test** or **Play Test Clip** - `inst-idle-running`
6. [x] - `p1` - **FROM** RUNNING **TO** PASSED **WHEN** the first three result lines pass within 10 s - `inst-running-passed`
7. [x] - `p1` - **FROM** RUNNING **TO** FAILED **WHEN** a stream stays silent - `inst-running-failed`
8. [x] - `p1` - **FROM** FAILED **TO** RUNNING **WHEN** the user clicks **Run Test** again - `inst-failed-running`

## 5. Definitions of Done

### First-run window and steps

- [x] `p1` - **ID**: `cpt-noter-dod-ui-first-run-window`

The system **MUST** render the first-run window FR-R1 to FR-R3 and its six steps as the prototype's `surface('firstrun')` does, resume at the stored step, save each choice through its command, keep **Continue** enabled during downloads, and open the main window on **Finish**.

**Implements**:
- `cpt-noter-flow-ui-first-run-complete-setup`
- `cpt-noter-state-ui-first-run-steps`
- `cpt-noter-state-ui-first-run-stepper-item`

**Constraints**: `cpt-noter-constraint-no-dialog-after-setup`

**Touches**:
- Commands: `setup_status`, `setup_set_step`, `setup_set_call_display`, `setup_set_audio_storage`, `settings_get`, `settings_update`, `window_navigate` (M1)
- Tests: E2E `cpt-noter-seq-first-run-complete-setup` (Happy path, Other, every Error and Empty path) against `noter-core-harness`; screenshot specs per step and per state of `FR_STATES`

### Models step

- [x] `p1` - **ID**: `cpt-noter-dod-ui-first-run-models`

The system **MUST** show the three model bundles with progress, **Pause** and **Resume**, the no-connection line, the disk banner with **Try Again**, the per-row **Check failed** with **Try Again**, and the background ring in the stepper.

**Implements**:
- `cpt-noter-flow-ui-first-run-download-models`

**Constraints**: `cpt-noter-constraint-no-dialog-after-setup`

**Touches**:
- Commands: `models_download`
- Events: `jobs:progress`, `env:changed`
- Tests: E2E `cpt-noter-seq-first-run-download-models` (all paths)

### Permission rows, self-test panel and display picker

- [x] `p1` - **ID**: `cpt-noter-dod-ui-first-run-components`

The system **MUST** provide the permission check row (setup, status and test-only variants), the self-test panel (step and sheet variants) and the display picker (several displays, one display, remembered display absent) as reusable components with the prototype's markup, so Settings and the self-test sheet use the same ones.

**Implements**:
- `cpt-noter-flow-ui-first-run-self-test`
- `cpt-noter-algo-ui-first-run-self-test-result`
- `cpt-noter-algo-ui-first-run-default-display`
- `cpt-noter-state-ui-first-run-permission-row`
- `cpt-noter-state-ui-first-run-self-test`

**Constraints**: `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `permission_request`, `self_test_run`, `levels_subscribe` (M1), `open_external` (M1)
- Tests: unit tests per component state; announcement test for the result lines

## 6. Acceptance Criteria

- [x] Every state of the first-run States table that belongs to steps 1 to 5 renders as the matching `FR_STATES` entry of the prototype (Welcome, Models downloading, No connection, Not enough disk space, Checksum failed, Speech model not ready, Permission not asked, Microphone denied, System audio permission missing, Back from System Settings, Self-test passed, One stream silent, Self-test skipped, Call display, One display, Audio storage); the step 6 states belong to `cpt-noter-feature-ui-accounts`
- [x] No permission prompt appears except after **Allow…** or **Open System Settings…**
- [x] **Continue** is never disabled by a running download
- [x] Closing the window mid-setup and reopening it resumes at the same step
- [x] The self-test's transcript line is never announced; each result line is announced once

## 7. Additional Context

**Prototype reuse.** Rewritten in React with the same structure, classes and data attributes: `surface('firstrun')` and its step renderers in `src/js/10-a-surfaces.js` (FR-R1, FR-R2, FR-R3 regions), and `C.wizardStepper`, `C.permissionCheckRow`, `C.selfTestPanel`, `C.displayPicker` in `src/js/10-a-components.js`; the `.fr-*` styles of `src/css/10-a.css` are ported as-is. Not reusable: the `setInterval` timers that simulate downloads and the self-test, and the `state.setup` flags (prototype plumbing); production reads both from the core.

**States coverage.**

| DESIGN state | Prototype `FR_STATES` |
| --- | --- |
| Models downloading | `models` |
| No connection | `no-connection` |
| Not enough disk space | `disk` |
| Checksum failed | `checksum` |
| Speech model not ready | `speech-wait` |
| Permission not asked | `perm-not-asked` |
| Microphone denied | `mic-denied` |
| Permission missing | `sys-missing` |
| Back from System Settings | `sys-missing` then the row's **Checking…** in `C.permissionCheckRow` |
| Self-test passed | `passed` |
| One stream silent | `one-silent` |
| Self-test skipped | `skipped` |
| Remaining steps | `display`, `storage`, `assistants` |
| One display | `one-display` |
| Key rejected, Assistants · sign in, Installing a local runtime, No key and no local runtime | `key-rejected`, `acct-wizard`, `assistants`, `no-assistant` (step 6, `cpt-noter-feature-ui-accounts`: key states M2, sign-in M3; the warning line is built here) |
| Setup left unfinished, Audio access not granted yet | Menu bar and record prompt states (`cpt-noter-feature-ui-menu-bar`, `cpt-noter-feature-ui-record-prompt`) |

**Milestone notes.** `levels_subscribe`, `open_external` and `window_navigate` are placed in M1 by milestones.toml; M0 builds and unit-tests them against the fake core, and their E2E proof against the real core counts from M1 (`docs/DECOMPOSITION.md`, discrepancy 2). The skipped-self-test banner shows in MW-R5 until Today ships in M2 (discrepancy 8).

**Not applicable.** Credentials in this feature: none; step 6's key fields are M2 and its sign-ins M3 (`cpt-noter-feature-ui-accounts`). Data: the UI stores nothing; every choice is a setting the core writes.
