---
title: "Feature: First run, permissions and environment"
description: "Setup status, resumable model downloads with checksums, permission requests at the step that needs them, the self-test stream, the call display and audio storage choices, the environment state, launch at login and update install; none of it ever gates a start."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M0
lane: core (src-tauri, noter-core) and engine (noter-native)
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: First run, permissions and environment

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Download the models](#download-the-models)
  - [Grant a permission](#grant-a-permission)
  - [Run the self-test](#run-the-self-test)
  - [Choose call display, audio storage and step states](#choose-call-display-audio-storage-and-step-states)
  - [Install a downloaded update](#install-a-downloaded-update)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Download task](#download-task)
  - [Detection rule](#detection-rule)
  - [Assemble setup status and environment](#assemble-setup-status-and-environment)
  - [Launch at login](#launch-at-login)
- [4. States (CDSL)](#4-states-cdsl)
  - [Model bundle](#model-bundle)
  - [Self-test](#self-test)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Setup status and choices](#setup-status-and-choices)
  - [Resumable, verified model downloads](#resumable-verified-model-downloads)
  - [Permissions only where asked](#permissions-only-where-asked)
  - [Self-test and detection](#self-test-and-detection)
  - [Login item and update install](#login-item-and-update-install)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-noter-featstatus-core-first-run`

- [ ] `p1` - `cpt-noter-feature-core-first-run`

## 1. Feature Context

### 1.1 Overview

The setup service in `noter-core` assembles `SetupStatus` (steps, model bundles, permissions, self-test, call display, whether detection is on) and answers the first-run commands. Model bundles download from pinned URLs with checksums into `models/` in the App Group container. Permissions are asked through `noter-native` only from `permission_request`. The self-test streams over a Channel from the engine. The native side also reports the environment (`env:changed`), registers the login item and installs a downloaded update.

### 1.2 Purpose

The user should finish setup in one sitting before the first real call, and call detection should be on by then. But setup is never a gate: owner decision O1 says a start is refused only while recording, below 500 MB free or without the live model; permissions and the self-test only decide whether automatic detection runs.

**Requirements**: PRD › Feature specification › 14. Settings (first run); PRD › Security, privacy and permissions; PRD › Repository layout › Models.

**Principles**: `cpt-noter-principle-core-degrade`

**Delivers**:
- Frozen commands (M0): `setup_status`, `models_download`, `permission_request`, `self_test_run`, `setup_set_call_display`, `setup_set_audio_storage`, `setup_set_step`, `update_install`.
- Events: `setup:changed`, `env:changed`.
- DESIGN.md stories (M0): `cpt-noter-seq-first-run-complete-setup`, `cpt-noter-seq-first-run-download-models`.

**Pending** (named follow-ups, not in M0's first run yet):
- Decision D14: `noter-native` gives the App Group container path (an engine-lane change the owner must allow); the Tauri host then passes it to the engine and to `models/`, wires `noter-native` as `NativeServices` and `noter-llm` as the default `ModelSource`. Until then the data folder stands in.
- The D-19 re-check needs the Swift engine to play its clip (`inst-play-clip` of `cpt-noter-flow-core-engine-foundation-self-test`); until it does, a granted tap with nothing playing still reads as denied.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Walks the first-run window (or Settings later): downloads models, grants permissions, runs the self-test, picks the call display and audio storage |
| UI window (First run, Settings, main) | Calls the commands; shows `SetupStatus` and `EnvironmentState` |
| macOS (TCC, login items, displays) | Shows permission prompts; reports permission and display state |
| Engine sidecar | Runs the self-test |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-first-run`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-native` (permissions, environment, login item, updates), 3.5 macOS services; DESIGN.md stories `cpt-noter-seq-first-run-complete-setup`, `cpt-noter-seq-first-run-download-models`
- **Dependencies**: `cpt-noter-feature-core-settings`, `cpt-noter-feature-core-engine-foundation`, `cpt-noter-feature-core-ipc-host`

## 2. Actor Flows (CDSL)

### Download the models

- [x] `p1` - **ID**: `cpt-noter-flow-core-first-run-download`

**Actor**: Primary user (First run › Models, or Settings › Models and Runtimes)

**Success Scenarios**:
- The user starts the download and moves on to the other steps; progress arrives on `setup:changed`; each bundle is verified and becomes `ready`.
- The user pauses and resumes; a resumed bundle continues from its partial file.

**Error Scenarios**:
- No connection: `offline` (retryable); the bundle stays `paused` with its partial file.
- A checksum mismatch: the bundle becomes `checksum_failed`, the partial file is deleted, `checksum_failed` is reported; **Retry** downloads again.
- Not enough disk for the remaining size: `disk_full` with `detail.needed_mb`.

**Steps**:
1. [x] - `p1` - API: `models_download { action: start }` from the First run or Settings window - `inst-download-call`
2. [x] - `p1` - **IF** free disk is below the remaining size plus a margin, **RETURN** `disk_full` with `detail.needed_mb` - `inst-check-disk`
3. [x] - `p1` - Start `cpt-noter-algo-core-first-run-download-task` in the background (a setup task in M0; moved onto the job scheduler in M2) - `inst-start-task`
4. [x] - `p1` - **RETURN** `SetupStatus` with the bundles `downloading` at once - `inst-return-started`
5. [x] - `p1` - **IF** `action` is `pause`, `resume` or `retry`, apply it to the task and **RETURN** the new `SetupStatus` - `inst-other-actions`

### Grant a permission

- [x] `p1` - **ID**: `cpt-noter-flow-core-first-run-permission`

**Actor**: Primary user (at the step that needs the permission)

**Success Scenarios**:
- The user clicks **Allow…**; macOS shows its prompt attributed to Noter; the row becomes `granted`.
- A permission that macOS needs a relaunch for becomes `needs_relaunch`.

**Error Scenarios**:
- The user denies it: the row becomes `denied` and the command answers `permission_denied`; the UI offers System Settings (`open_external`, M1).
- System Audio Recording cannot be queried: it is reported as inferred from the self-test (non-zero buffers) and never blocks anything.
- Back from System Settings (the app becomes active, or macOS reports a change) while first run shows system audio denied: one engine test of about 3 s plays the test clip and re-checks it, never during a capture; the row becomes `granted` or stays `denied`, and `setup:changed` ends the check either way (decision D-19). Settings leaves it to **Run Test**.

**Steps**:
1. [x] - `p1` - API: `permission_request { kind }` from the First run, Settings or main window - `inst-permission-call`
2. [x] - `p1` - **IF** `kind` is `system_audio` - `inst-if-system-audio`
   1. [x] - `p1` - Ask the engine to open the tap briefly so macOS shows its prompt; the state comes from the next self-test - `inst-system-audio`
3. [x] - `p1` - **ELSE** ask through `noter-native` (AVCaptureDevice for the microphone, EventKit for the calendar, `UNUserNotificationCenter` for notifications, the screen-capture check, Apple Events for automation) - `inst-native-ask`
4. [x] - `p1` - Update the permission row and emit `env:changed` and `setup:changed` with new versions - `inst-emit-permission`
5. [x] - `p1` - **IF** the result is denied **RETURN** `permission_denied` - `inst-if-denied`
6. [x] - `p1` - **RETURN** the `PermissionRow` - `inst-return-permission`

### Run the self-test

- [x] `p1` - **ID**: `cpt-noter-flow-core-first-run-self-test`

**Actor**: Primary user (First run › Permissions, or Settings, or main)

**Success Scenarios**:
- Both streams arrive, the user sees levels and a recognised line per channel, the test passes within 10 s, and call detection turns on if **Offer to record** is on.

**Error Scenarios**:
- The live model is not downloaded: `model_missing` before the Channel opens.
- A permission is missing: the Channel ends with `failed { reason: permission_missing { kind } }`.
- One stream is silent or only zeros arrive: `failed` with that reason; detection stays off; capture is still allowed.

**Steps**:
1. [x] - `p1` - API: `self_test_run { play_clip }` with a Channel - `inst-self-test-call`
2. [x] - `p1` - **IF** the live model is missing **RETURN** `model_missing` - `inst-if-model-missing`
3. [x] - `p1` - Register a one-off subscription with the stream hub and **RETURN** its `SubscriptionHandle` - `inst-register-stream`
4. [x] - `p1` - Run the engine self-test (`cpt-noter-flow-core-engine-foundation-self-test`) and map its events to `SelfTestMsg`: `stream_arrived`, `levels`, `line`, then `passed` or `failed { reason }`, then `ended` - `inst-map-events`
5. [x] - `p1` - DB: store the `SelfTestState` (passed with its time, or failed with its reason) through the change-log write path - `inst-store-result`
6. [x] - `p1` - Apply `cpt-noter-algo-core-first-run-detection-rule` and tell the engine `set_detection` - `inst-apply-detection`
7. [x] - `p1` - Emit `setup:changed` - `inst-emit-setup`

### Choose call display, audio storage and step states

- [x] `p2` - **ID**: `cpt-noter-flow-core-first-run-choices`

**Actor**: Primary user (First run)

**Success Scenarios**:
- The user picks the display where the call window opens, chooses whether audio is stored and for how long, and marks steps done or skipped; `SetupStatus` reflects each choice.

**Error Scenarios**:
- The chosen display is gone: `invalid_input`; the window reloads the display list from `env:changed`.

**Steps**:
1. [x] - `p1` - API: `setup_set_call_display { display_id }`, `setup_set_audio_storage { never_store_audio, retention }` or `setup_set_step { step, state }` - `inst-choice-call`
2. [x] - `p1` - Validate the display id against the current displays; an unknown one **RETURN** `invalid_input` - `inst-validate-display`
3. [x] - `p1` - DB: write the choice into its settings section through the change-log write path (`cpt-noter-flow-core-settings-update` rules) - `inst-write-choice`
4. [x] - `p1` - Recompute `SetupStatus.complete`; the Assistants step may be marked done or skipped in M0, while connecting an assistant is M3 (decision D10) - `inst-recompute`
5. [x] - `p1` - **RETURN** `SetupStatus`; emit `setup:changed` - `inst-return-choice`

### Install a downloaded update

- [ ] `p2` - **ID**: `cpt-noter-flow-core-first-run-update`

**Actor**: Primary user (Settings or main window, from the update banner)

**Success Scenarios**:
- The update was downloaded and verified by the updater; the user installs it and Noter restarts.

**Error Scenarios**:
- A capture is running: the install waits until the capture stops, so a restart never cuts a call (the command still answers `Ack` at once).
- No update is ready: `not_found`.

**Steps**:
1. [x] - `p1` - API: `update_install {}` - `inst-update-call`
2. [x] - `p1` - **IF** no verified update is ready **RETURN** `not_found` (checked first, decision F3) - `inst-if-no-update`
3. [x] - `p1` - **IF** a capture is running, schedule the install for the next stop and **RETURN** `Ack` - `inst-if-recording`
4. [ ] - `p1` - Let `tauri-plugin-updater` install the update; on success shut the core down in order (streams end with `shutdown`, the writer drains) and relaunch, on failure keep running - `inst-install`
5. [x] - `p1` - **RETURN** `Ack` before the relaunch - `inst-return-update`

## 3. Processes / Business Logic (CDSL)

### Download task

- [ ] `p1` - **ID**: `cpt-noter-algo-core-first-run-download-task`

**Input**: The pinned model manifest (bundle name, URL, size, checksum), compiled into the app; hosts listed in `contracts/egress-hosts.json`.

**Output**: Each bundle `ready` in `models/`, or its failure state.

**Steps**:
1. [x] - `p1` - **FOR EACH** bundle not `ready`, required-for-capture bundles first - `inst-for-bundles`
   1. [ ] - `p1` - **TRY** download into a partial file with HTTP range resume, publishing progress at most twice a second; the HTTP fetcher is noter-llm's `RangeFetcher`, the egress gate, since noter-core opens no connection (backend decision D11) - `inst-try-download`
   2. [x] - `p1` - **CATCH** a network failure: state `paused`, error `offline` - `inst-catch-offline`
   3. [x] - `p1` - Verify the checksum (`verifying`); on mismatch delete the partial file, state `checksum_failed` - `inst-verify`
   4. [x] - `p1` - Move the verified file into `models/` (0600) and mark the bundle `ready` - `inst-move-ready`
2. [x] - `p1` - Emit `setup:changed` after each state change - `inst-emit-progress`
3. [x] - `p1` - **RETURN** when every bundle is `ready` or a failure stops the task - `inst-return-task`

### Detection rule

- [x] `p1` - **ID**: `cpt-noter-algo-core-first-run-detection-rule`

**Input**: `GeneralSettings.offer_to_record`, the stored `SelfTestState`.

**Output**: Whether call detection runs, and the matching degraded state.

**Steps**:
1. [x] - `p1` - **IF** `offer_to_record` is on and the self-test passed - `inst-if-detect`
   1. [x] - `p1` - Detection on; remove `SetupIncomplete` from the degraded set - `inst-detect-on`
2. [x] - `p1` - **ELSE** detection off; add `SetupIncomplete` to the degraded set when the self-test has not passed - `inst-detect-off`
3. [x] - `p1` - **RETURN** the decision; it never affects `capture_start` - `inst-return-detection`

### Assemble setup status and environment

- [x] `p1` - **ID**: `cpt-noter-algo-core-first-run-status`

**Input**: Settings, model states, permission rows, self-test state, displays, output route and device, notification authorization, network reachability, update info, free disk.

**Output**: `SetupStatus` and `EnvironmentState`, each with a new `version` when it changed.

**Steps**:
1. [x] - `p1` - Build `SetupStatus` from the stored choices and the current states; `complete` is true when every step is done or skipped - `inst-build-setup`
2. [x] - `p1` - Build `EnvironmentState` from `noter-native` readings; re-read on display, output-route, permission, notification-authorization, reachability and disk notifications - `inst-build-env`
3. [x] - `p1` - **IF** either changed, stamp a new version and emit `setup:changed` or `env:changed` - `inst-emit-changes`
4. [x] - `p1` - **RETURN** both - `inst-return-status`

### Launch at login

- [ ] `p2` - **ID**: `cpt-noter-algo-core-first-run-login-item`

**Input**: `GeneralSettings.launch_at_login` after a settings change.

**Output**: The login item registered or unregistered with SMAppService.

**Steps**:
1. [x] - `p1` - **IF** on, register the main app with SMAppService; **ELSE** unregister it - `inst-login-apply`
2. [ ] - `p1` - **IF** macOS needs approval in System Settings, keep the setting on and report it in `EnvironmentState` - `inst-login-approval`
3. [ ] - `p1` - **RETURN** - `inst-login-return`

## 4. States (CDSL)

### Model bundle

- [x] `p1` - **ID**: `cpt-noter-state-core-first-run-bundle`

**States**: pending, downloading, paused, verifying, ready, checksum_failed, failed

**Initial State**: pending

**Transitions**:
1. [x] - `p1` - **FROM** pending **TO** downloading **WHEN** the user starts the download - `inst-st-download`
2. [x] - `p1` - **FROM** downloading **TO** paused **WHEN** the user pauses or the network drops - `inst-st-pause`
3. [x] - `p1` - **FROM** paused **TO** downloading **WHEN** the user resumes or retries, or macOS reports the network back after it stopped the download - `inst-st-resume`
4. [x] - `p1` - **FROM** downloading **TO** verifying **WHEN** the last byte arrived - `inst-st-verify`
5. [x] - `p1` - **FROM** verifying **TO** ready **WHEN** the checksum matches - `inst-st-ready`
6. [x] - `p1` - **FROM** verifying **TO** checksum_failed **WHEN** the checksum differs - `inst-st-checksum`
7. [x] - `p1` - **FROM** checksum_failed **TO** downloading **WHEN** the user retries - `inst-st-retry`
8. [x] - `p1` - **FROM** downloading **TO** failed **WHEN** the disk fills or the file cannot be written - `inst-st-failed`

### Self-test

- [x] `p1` - **ID**: `cpt-noter-state-core-first-run-self-test`

**States**: not_run, running, passed, failed, skipped

**Initial State**: not_run

**Transitions**:
1. [x] - `p1` - **FROM** not_run **TO** running **WHEN** `self_test_run` starts - `inst-st-run`
2. [x] - `p1` - **FROM** running **TO** passed **WHEN** both channels delivered non-zero buffers within 10 s - `inst-st-passed`
3. [x] - `p1` - **FROM** running **TO** failed **WHEN** a stream stayed silent, only zeros arrived, own sounds leaked, a permission or the model was missing, or 10 s passed - `inst-st-failed-test`
4. [x] - `p1` - **FROM** failed **TO** running **WHEN** the user runs it again - `inst-st-rerun`
5. [x] - `p1` - **FROM** not_run **TO** skipped **WHEN** the user skips the step (detection stays off) - `inst-st-skipped`

## 5. Definitions of Done

### Setup status and choices

- [x] `p1` - **ID**: `cpt-noter-dod-core-first-run-status`

The system **MUST** answer `setup_status`, `setup_set_call_display`, `setup_set_audio_storage` and `setup_set_step` with a versioned `SetupStatus`, store the choices in settings through the change log, and emit `setup:changed` and `env:changed` whole on every change.

**Implements**:
- `cpt-noter-flow-core-first-run-choices`
- `cpt-noter-algo-core-first-run-status`

**Touches**:
- API: `setup_status`, `setup_set_call_display`, `setup_set_audio_storage`, `setup_set_step`, `setup:changed`, `env:changed`
- DB: `settings`
- Entities: `SetupStatus`, `EnvironmentState`

### Resumable, verified model downloads

- [ ] `p1` - **ID**: `cpt-noter-dod-core-first-run-models`

The system **MUST** download the pinned bundles with range resume, verify each checksum before use, report `offline`, `checksum_failed` and `disk_full` as typed errors and bundle states, and reach only hosts listed in `contracts/egress-hosts.json`.

**Implements**:
- `cpt-noter-flow-core-first-run-download`
- `cpt-noter-algo-core-first-run-download-task`
- `cpt-noter-state-core-first-run-bundle`

**Touches**:
- API: `models_download`
- Entities: `ModelsStatus`, `ModelBundle`

### Permissions only where asked

- [ ] `p1` - **ID**: `cpt-noter-dod-core-first-run-permissions`

The system **MUST** ask for a permission only from `permission_request`, report each as `not_asked`, `granted`, `denied` or `needs_relaunch` (System Audio Recording inferred from the self-test), and never read a permission in `capture_start`.

**Implements**:
- `cpt-noter-flow-core-first-run-permission`

**Constraints**: `cpt-noter-constraint-core-macos`

**Touches**:
- API: `permission_request`
- Entities: `PermissionRow`

### Self-test and detection

- [x] `p1` - **ID**: `cpt-noter-dod-core-first-run-self-test`

The system **MUST** stream the self-test over a Channel (`stream_arrived`, `levels`, `line`, `passed` or `failed`, `ended`) within 10 s, store its result, and turn detection on only when **Offer to record** is on and the test passed; nothing in this feature can refuse or gate a capture start.

**Implements**:
- `cpt-noter-flow-core-first-run-self-test`
- `cpt-noter-algo-core-first-run-detection-rule`
- `cpt-noter-state-core-first-run-self-test`

**Touches**:
- API: `self_test_run`
- Entities: `SelfTestState`, `SelfTestMsg`

### Login item and update install

- [ ] `p2` - **ID**: `cpt-noter-dod-core-first-run-login-update`

The system **MUST** apply `launch_at_login` through SMAppService and install a verified update with `update_install`, deferring the restart while a capture runs.

**Implements**:
- `cpt-noter-flow-core-first-run-update`
- `cpt-noter-algo-core-first-run-login-item`

**Touches**:
- API: `update_install`
- Entities: `UpdateInfo`

## 6. Acceptance Criteria

- [ ] E2E against the real core, story `cpt-noter-seq-first-run-download-models`: the download starts, progress arrives on `setup:changed`, the user completes other steps meanwhile, and the bundles become ready (scripted download source in the harness).
- [ ] E2E against the real core, story `cpt-noter-seq-first-run-complete-setup`: permissions requested, the self-test passes with the scripted engine, the call display and audio storage are chosen, `SetupStatus.complete` is true and detection is on.
- [ ] A failed or skipped self-test leaves detection off and adds `SetupIncomplete`, and nothing else changes (capture start is never refused for it; checked again in M1).
- [ ] A checksum mismatch deletes the partial file and reports `checksum_failed`.
- [ ] Every M0 first-run command succeeds at least once in E2E runs against the real core.
- [ ] `just gate` passes.
