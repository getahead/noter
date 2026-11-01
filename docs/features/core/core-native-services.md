---
title: "Feature: Native services: launch, clipboard, panels and share test"
description: "Core-owned macOS launch, rich clipboard and export panels, plus the Screen Share Test."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M2
lane: core and engine
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Native services: launch, clipboard, panels and share test

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Run the Screen Share Test](#run-the-screen-share-test)
  - [Perform a native operation for an owning service](#perform-a-native-operation-for-an-owning-service)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Inspect share visibility](#inspect-share-visibility)
  - [Launch through native services safely](#launch-through-native-services-safely)
- [4. States (CDSL)](#4-states-cdsl)
  - [Optional capture probe](#optional-capture-probe)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Native clipboard, panels and launch](#native-clipboard-panels-and-launch)
  - [Share visibility and capture test](#share-visibility-and-capture-test)
  - [Tests and gate](#tests-and-gate)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [x] `p3` - **ID**: `cpt-noter-featstatus-core-native-services`

- [x] `p3` - `cpt-noter-feature-core-native-services`

## 1. Feature Context

### 1.1 Overview

The native bridge in `apps/desktop/src-tauri` and `noter-native` supplies M2 launch, rich clipboard, folder/save panels and the Screen Share Test. Owning services decide which prompt to launch or which content to export. The capture test runs in the core process so it measures the actual Noter surfaces. Core and engine lane work lands separately at this boundary.

> **M2 decisions (Backend Teamlead, 1 Nov 2026).** `NativeOps` is a trait on `CoreDeps` (save panel, rich clipboard, launch, share test); the harness answers it scripted (a path under its data dir, a recorded clipboard, recorded launches, a fixed `ShareTestResult`), and the real implementations come with 2.21 native-services (TL-15). The `share_test_run` consumer codes against the trait first; this feature delivers the macOS half last.

### 1.2 Purpose

M2 services can use macOS without granting a WebView shell access or putting OS rules into UI code. The user can check how each Noter surface appears in a share before presenting.

**Requirements**: PRD › Feature specification › 6. Integrations and 9. Handoff; PRD › Live copilot › Surfaces (Screen Share Test).

**Principles**: No additional principle assigned in the decomposition; native services expose mechanisms, with product decisions in their owning features.

**Delivers**:
- Frozen command (M2): `share_test_run` (Settings window only).
- DESIGN.md stories (M2): none owned here; native behavior supports the sharing and handoff stories in their owning features.
- Native mechanisms used by `share_copy`, `handoff_copy`, `calls_export`, `history_export`, repository choice and handoff launch; those commands retain their owning features and scopes.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user (Settings) | Runs the share visibility and optional capture test |
| Handoff, sharing and History services | Request native operations through the host |
| AppKit, Launch Services and Apple Events | Show panels, inspect handlers and open pre-filled targets |
| NSPasteboard and ScreenCaptureKit | Write rich formats and test visibility |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-native-services`; overview discrepancy 10 (lanes)
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-native`, 3.3 Native panels and Clipboard conventions, 3.5 macOS services, 3.8 entitlements
- **UI design**: [DESIGN.md](../../DESIGN.md), Settings Screen Share Test and handoff/share stories
- **Contract**: `crates/noter-protocol/src/model/settings.rs` (`ShareTestArgs`, `ShareTestResult`); `model/handoff.rs`; `contracts/ipc.manifest.json`
- **Dependencies**: `cpt-noter-feature-core-native-surfaces`

## 2. Actor Flows (CDSL)

### Run the Screen Share Test

- [x] `p1` - **ID**: `cpt-noter-flow-core-native-services-share-test`

**Actor**: Primary user (Settings window)

**Success Scenarios**:
- The test returns one row per Noter surface with window, app and display sharing visibility; the optional capture probe reports passed, failed or not run.
- A live call still permits the non-capturing visibility report but blocks the optional capture probe.

**Error Scenarios**:
- Screen Recording was denied or the capture API fails: the result reports the existing typed failure without recording a false pass or interrupting capture.

**Steps**:
1. [x] - `p1` - API: `share_test_run { run_capture_test }` from Settings - `inst-test-request`
2. [x] - `p1` - Inspect actual core-owned window/panel protection and hidden-for-presenting state; assemble visibility rows with `cpt-noter-algo-core-native-services-visibility` - `inst-test-rows`
3. [x] - `p1` - **IF** capture testing was not requested, set capture outcome not_run - `inst-test-not-run`
4. [x] - `p1` - **ELSE IF** a call is live, set capture outcome blocked_by_call without a Screen Recording prompt or probe - `inst-test-blocked`
5. [x] - `p1` - **ELSE** run the optional screen capture probe in the core process, requesting Screen Recording only for this explicit action if needed - `inst-test-probe`
   1. [x] - `p1` - Compare the probe with the protected Noter surfaces, set passed with timestamp or failed with the existing error code - `inst-test-outcome`
   2. [x] - `p1` - Dispose of temporary capture buffers immediately; never retain or upload screen frames - `inst-test-dispose`
6. [x] - `p1` - **RETURN** `ShareTestResult` with visibility rows and capture outcome - `inst-test-return`

### Perform a native operation for an owning service

- [x] `p1` - **ID**: `cpt-noter-flow-core-native-services-operation`

**Actor**: Core handoff, sharing, export or repository service

**Success Scenarios**:
- Rich text and plain fallback reach the clipboard; a save/folder panel returns the user's path; launch reports actual handler or Automation failure.

**Error Scenarios**:
- Panel cancelled: `cancelled`; unavailable handler: `no_link_handler`; denied terminal Automation: `automation_denied`; native or filesystem failure never becomes success.

**Steps**:
1. [x] - `p1` - Receive a typed operation from the owning service after IPC scope validation; dispatch AppKit work on the appropriate app thread - `inst-op-dispatch`
2. [x] - `p1` - For clipboard, atomically publish the requested rich representation and matching plain text; return success only after the pasteboard write succeeds - `inst-op-clipboard`
3. [x] - `p1` - For export or folder choice, show the native panel attached to the requesting window with the service's suggested name and allowed kind - `inst-op-panel`
4. [x] - `p1` - **IF** cancelled, **RETURN** `cancelled` without invoking the owning service's file-writing step - `inst-op-cancel`
5. [x] - `p1` - For launch inspection, query registered handlers and Automation facts without opening a tool or asking permission - `inst-op-plan`
6. [x] - `p1` - For explicit launch, use `cpt-noter-algo-core-native-services-launch` and return the actual path used or typed failure - `inst-op-launch`
7. [x] - `p1` - **RETURN** the native result; item transitions, prompt selection and share scope remain the caller's responsibility - `inst-op-return`

## 3. Processes / Business Logic (CDSL)

### Inspect share visibility

- [x] `p1` - **ID**: `cpt-noter-algo-core-native-services-visibility`

**Input**: Core-owned windows/panels, surface roles, content protection and presenting-hidden state.

**Output**: `ShareTestRow` values for all `NoterSurface` roles.

**Steps**:
1. [x] - `p1` - Enumerate surfaces from the core's window registry, not WebView-reported protection flags - `inst-visibility-enumerate`
2. [x] - `p1` - Inspect protected call and record panels, normal main/Settings windows and menu-bar surfaces for each share mode - `inst-visibility-properties`
3. [x] - `p1` - Report hidden where the mode excludes that surface, visible where it includes it, and depends_on_app where the meeting application's share behavior determines the result - `inst-visibility-report`
4. [x] - `p1` - Reflect Hide for Presenting and actual window sharing type; do not promise whole-display protection from window-exclusion flags alone - `inst-visibility-presenting`
5. [x] - `p1` - **RETURN** the rows without starting capture, changing recording state or automatically hiding a window - `inst-visibility-return`

### Launch through native services safely

- [x] `p1` - **ID**: `cpt-noter-algo-core-native-services-launch`

**Input**: Validated target, directory, prompt file and launch path selected by handoff.

**Output**: Native launch success with path used, or existing typed error.

**Steps**:
1. [x] - `p1` - Verify the selected handler still exists and its scheme matches the handoff target - `inst-launch-check`
2. [x] - `p1` - Encode path and short read-file instruction as data for Launch Services; never interpolate prompt text into shell or AppleScript source - `inst-launch-encode`
3. [x] - `p1` - **IF** the operation uses Terminal or iTerm, use the signed app's Apple Events entitlement and usage description, and request Automation only on the explicit launch - `inst-launch-automation`
4. [x] - `p1` - **IF** authorization is denied, **RETURN** `automation_denied`; do not retry by another privileged route - `inst-launch-denied`
5. [x] - `p1` - Open the selected tool and cwd with the prompt pre-filled; do not send the message, submit a keystroke or execute work in the repository - `inst-launch-prefill`
6. [x] - `p1` - **RETURN** native success or typed failure to handoff; the bridge never marks the item handed off itself - `inst-launch-return`

## 4. States (CDSL)

### Optional capture probe

- [x] `p1` - **ID**: `cpt-noter-state-core-native-services-probe`

**States**: not_run, blocked_by_call, passed, failed

**Initial State**: not_run for each new `share_test_run`

**Transitions**:
1. [x] - `p1` - **FROM** not_run **TO** blocked_by_call **WHEN** the optional probe is requested during capture - `inst-st-blocked`
2. [x] - `p1` - **FROM** not_run **TO** passed **WHEN** the explicitly requested core-process probe succeeds outside capture - `inst-st-passed`
3. [x] - `p1` - **FROM** not_run **TO** failed **WHEN** permission or capture failure prevents the requested probe - `inst-st-failed`
4. [x] - `p1` - **FROM** failed **TO** not_run **WHEN** the user starts a fresh test; blocked or passed results also reset on a fresh request - `inst-st-retry`

These are result states, not persistent database rows. A fresh request rechecks capture and authorization; prior pass does not grant future capture permission.

## 5. Definitions of Done

### Native clipboard, panels and launch

- [x] `p1` - **ID**: `cpt-noter-dod-core-native-services-mechanisms`

The system **MUST** expose native rich/plain clipboard writes, core-owned save and folder panels, Launch Services handler inspection and explicit Apple Events launch with typed results. Inspection must not prompt, panel cancellation must not write files, and launch must keep prompt/path data separate from executable syntax and leave the message unsent. Only the owning service records product state.

**Implements**:
- `cpt-noter-flow-core-native-services-operation`
- `cpt-noter-algo-core-native-services-launch`

**Constraints**: `cpt-noter-constraint-core-macos`

**Touches**:
- API: native service boundary consumed by sharing, History and handoff
- Entities: NSPasteboard, native panels, Launch Services, Apple Events, `LaunchPlan`

### Share visibility and capture test

- [x] `p1` - **ID**: `cpt-noter-dod-core-native-services-share-test`

The system **MUST** answer `share_test_run` from Settings with actual per-surface visibility and an optional core-process probe. It must block the probe during capture, ask Screen Recording only for explicit testing, dispose of buffers and report failure without false success.

**Implements**:
- `cpt-noter-flow-core-native-services-share-test`
- `cpt-noter-algo-core-native-services-visibility`
- `cpt-noter-state-core-native-services-probe`

**Constraints**: `cpt-noter-constraint-core-macos`

**Touches**:
- API: `share_test_run`
- Entities: `ShareTestResult`, `ShareVisibility`, `CaptureTestOutcome`

### Tests and gate

- [x] `p1` - **ID**: `cpt-noter-dod-core-native-services-tests`

The system **MUST** pass unit tests for visibility mapping, call guards, permission failures, argument encoding and cancellation; conformance for the command's Settings-only scope and result shapes; and macOS native tests for clipboard formats, panels and launch. `share_test_run` must succeed in real-app E2E and contribute to the command count; owning stories remain counted under items and handoff. System TCC prompt appearance remains on the existing manual macOS checklist. `just gate` passes.

**Implements**:
- `cpt-noter-flow-core-native-services-share-test`
- `cpt-noter-flow-core-native-services-operation`

**Touches**:
- API: `share_test_run` and owning services' native seams

## 6. Acceptance Criteria

- [x] A real-app E2E call to `share_test_run` from Settings succeeds with per-surface rows; another window receives `window_not_allowed`.
- [x] Optional capture testing during a call returns blocked_by_call without prompting, writing frames or changing capture state; outside a call it records passed or a typed failed result.
- [x] Native tests verify protected-panel and whole-display behavior, including Hide for Presenting; uncertain app-sharing results remain depends_on_app.
- [x] Native clipboard tests inspect both rich and plain representations; native-panel cancellation creates no export, with the caller receiving `cancelled`.
- [x] Native launch tests cover handler disappearance, Automation denial, Unicode and shell-like paths, and prove the prompt remains pre-filled and unsent.
- [x] Unit, conformance and native tests pass; XCUITest names use underscore story IDs when exercising the owning handoff or sharing stories.
- [x] `just gate` passes.

The native tests above are noter-native's (#243) and the host's (`apps/desktop/src-tauri/tests/native.rs`: the panel off the async runtime, a private-pasteboard round trip, the Screen Share Test through `MacOps`). Only the owner's Mac proves the `cwd`/`q` parameters of `claude://code/new` and `codex://new`, a real Screen Recording and Automation prompt (the manual macOS checklist), and a real launch pre-filled and unsent. `apps/desktop/tests/conformance/m2-share-test.test.ts` runs `share_test_run` against the fake and the real core.
