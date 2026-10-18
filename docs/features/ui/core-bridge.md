---
title: "Feature — Core bridge and window stores"
description: "How every Noter WebView window talks to the Rust core through the generated contract and renders from its own in-memory store: snapshot then stream, wanted state, typed errors to named states, no retries."
status: IN_PROGRESS
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-core-bridge
milestone: M0
---

# Feature: Core bridge and window stores


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Open or reload a window](#open-or-reload-a-window)
  - [Act on a record](#act-on-a-record)
  - [Close a window](#close-a-window)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Snapshot, then stream](#snapshot-then-stream)
  - [Apply whole state](#apply-whole-state)
  - [Flush stream buffers](#flush-stream-buffers)
  - [Map a typed error to a named state](#map-a-typed-error-to-a-named-state)
- [4. States (CDSL)](#4-states-cdsl)
  - [Window store lifecycle](#window-store-lifecycle)
  - [Command call](#command-call)
- [5. Definitions of Done](#5-definitions-of-done)
  - [One bridge per window over the generated client](#one-bridge-per-window-over-the-generated-client)
  - [Store with whole state, versions and stream buffers](#store-with-whole-state-versions-and-stream-buffers)
  - [Typed errors to named states, no retries](#typed-errors-to-named-states-no-retries)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-noter-featstatus-ui-core-bridge`

## 1. Feature Context

- [ ] `p1` - `cpt-noter-feature-ui-core-bridge`

### 1.1 Overview

Each WebView window (main, call window, record prompt, Settings, first run) gets one bridge and one store. The bridge wraps the generated client `createCore()` from `apps/desktop/src/core/bindings.ts`, so every command is typed and resolves to `{status: "ok" | "error"}` and never throws. The store holds what the core sent, keyed by record identity and `version`, buffers the three Channels (transcript, levels, cards) and flushes them every 100 ms. Screens render from the store and call the bridge; nothing else reaches the core.

Problem: without one seam, screens would invent state, retry on their own and lose stream messages around reloads. Primary value: a window can reload or come back after a crash and show exactly what the core has, and every screen can be built and tested against the fake core first.

### 1.2 Purpose

The bridge and store implement DESIGN's app layer: `cpt-noter-component-app-core-bridge` and `cpt-noter-component-app-window-store`, over the interface `cpt-noter-interface-ui-core-ipc` (DESIGN 3.3) and the technology stack `cpt-noter-tech-ui-stack`. The contract rules come from ADR-0001 and ADR-0002 and `apps/desktop/src/core/README.md`.

**Requirements**: PRD › Architecture overview ("the UI never holds state the core does not have"); PRD › Live copilot loop › Surfaces. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-core-owns-state`, `cpt-noter-principle-degrade-visibly`

Success criteria: every window renders from `app_snapshot` within one frame after it resolves; no Channel message is lost or doubled across a reload; every `ErrorCode` the contract defines maps to a named state or to the section-level error with **Try Again**.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user (PRD › Problem, users and jobs to be done) | Opens, reloads and closes windows; acts through screens, which call the bridge |
| Noter core (system) | Answers commands, sends events with whole state and `version`, streams Channels with `seq` |
| Fake core (test double) | Stands in for the core in unit tests, stories, visual specs and the browser dev loop (`VITE_FAKE_CORE=1`) |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Architecture overview; Roadmap and milestones › Parallel UI and core work
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 App layer — Core bridge, App layer — Window store; 3.3 API Contracts (Request and response shapes, Error handling, Reload and replay, Window scoping)
- **Design elements**: `cpt-noter-component-app-core-bridge`, `cpt-noter-component-app-window-store`, `cpt-noter-interface-ui-core-ipc`, `cpt-noter-tech-ui-stack`
- **ADRs**: `cpt-noter-adr-0001-contract-source-of-truth`, `cpt-noter-adr-0002-ipc-conventions`, `cpt-noter-adr-0003-harness-and-quality-gates`
- **Contract**: `contracts/ipc.manifest.json`, `apps/desktop/src/core/bindings.ts` (generated), `apps/desktop/src/core/tauri-transport.ts`, `apps/desktop/src/core/fake/*`
- **Stories**: none of its own; every story of DESIGN 3.6 runs through this feature
- **Frozen commands it calls**: `app_snapshot`, `stream_unsubscribe`, `stream_ack`, `log_ui` (M0); `window_navigate`, `window_announce`, `open_external` (M1, offered to screens as shared calls)
- **Prototype modules**: `docs/prototype/clickable/src/js/00-core.js` (source of truth only), `src/js/03-data.js` and `src/js/40-d-1-data.js` (content reference for fixtures)
- **Dependencies**: None

## 2. Actor Flows (CDSL)

### Open or reload a window

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-core-bridge-open-window`

**Actor**: Primary user

**Success Scenarios**:
- The window shows the same records the core has, then follows changes live
- A window that comes back after a crash shows the same call, transcript, cards, pins and marks (PM-46)

**Error Scenarios**:
- The snapshot fails: the window shows its section-level error with **Try Again**
- The contract major version differs: the bridge refuses to start and logs the mismatch

**Steps**:
1. [x] - `p1` - User opens, reloads or reopens a window; the window reads its label (`main`, `call-screen`, `record-prompt`, `settings`, `first-run`) - `inst-read-label`
2. [x] - `p1` - UI: build the bridge for that label over the Tauri transport, or over `FakeCore` when `VITE_FAKE_CORE` is set or in tests and stories - `inst-build-bridge`
3. [x] - `p1` - UI: create an empty store for the window; view state starts from defaults (no browser storage) - `inst-create-store`
4. [x] - `p1` - UI: subscribe to the 20 events of the contract before asking for the snapshot, so no change between the two is lost - `inst-subscribe-events`
5. [x] - `p1` - API: `app_snapshot` (no arguments; returns `AppSnapshot` with setup, capture, detection, copilot, privacy, presenting, degraded, accounts, features, prefs, proposals, banners, environment) - `inst-api-snapshot`
6. [x] - `p1` - **IF** the snapshot's `contract_version` major differs from the bindings' `CONTRACT_VERSION` - `inst-if-version`
   1. [x] - `p1` - API: `log_ui` with the mismatch, no content; the window shows the section-level error and stops - `inst-version-stop`
7. [x] - `p1` - Algorithm: apply each slice with `cpt-noter-algo-ui-core-bridge-apply-whole-state` - `inst-apply-snapshot`
8. [x] - `p1` - UI: the screen the window shows calls its own read commands and Channels through `cpt-noter-algo-ui-core-bridge-snapshot-then-stream` - `inst-screen-reads`
9. [x] - `p1` - **IF** a read takes longer than 300 ms - `inst-if-slow`
   1. [ ] - `p1` - UI: the region shows skeleton rows until the data arrives (DESIGN state "Window reloaded") - `inst-skeleton`
10. [x] - `p1` - **RETURN** a window rendering only what the core sent - `inst-return-window`

### Act on a record

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-core-bridge-act`

**Actor**: Primary user

**Success Scenarios**:
- The control shows its waiting state, the core sends the changed record, the screen shows it

**Error Scenarios**:
- The core answers `conflict`: the screen shows "Item changed since" with the current record
- The core answers a retryable error: the screen shows the named state with **Try Again**
- The window may not call the command (`window_not_allowed`): the screen shows its section-level error; this is a bug and is logged

**Steps**:
1. [ ] - `p1` - User acts on a control (click, key, menu item) - `inst-user-acts`
2. [x] - `p1` - UI: the control enters its loading state; nothing in the store changes yet (no optimistic writes) - `inst-loading`
3. [x] - `p1` - API: the screen calls the bridge method for the command with the wanted state (never a toggle) and the record's `rev` for edits - `inst-api-command`
4. [x] - `p1` - **IF** the result is `ok` - `inst-if-ok`
   1. [x] - `p1` - Store: write the returned record or whole-state slice, keeping the higher `version` - `inst-write-result`
   2. [x] - `p1` - UI: the control leaves its loading state and the screen re-renders from the store - `inst-render-result`
5. [x] - `p1` - **ELSE** - `inst-else-error`
   1. [x] - `p1` - Algorithm: map the error with `cpt-noter-algo-ui-core-bridge-map-error` - `inst-map-error`
   2. [x] - `p1` - UI: the screen shows the named state, with **Try Again** only where the error is retryable; the bridge never retries by itself - `inst-show-error`
6. [x] - `p1` - **RETURN** the screen in its new state - `inst-return-act`

### Close a window

- [x] `p1` - **ID**: `cpt-noter-flow-ui-core-bridge-close-window`

**Actor**: Primary user

**Success Scenarios**:
- Every open Channel of the window ends; the core keeps running

**Error Scenarios**:
- The unsubscribe fails because the core already ended the Channel: ignored

**Steps**:
1. [x] - `p1` - User closes the window (⌘W, ×, **Hide**) - `inst-user-closes`
2. [x] - `p1` - **FOR EACH** open Channel subscription of the window - `inst-for-each-sub`
   1. [x] - `p1` - API: `stream_unsubscribe` with its `subscription_id` - `inst-api-unsubscribe`
3. [x] - `p1` - UI: drop the store; nothing is persisted in the WebView - `inst-drop-store`
4. [x] - `p1` - **RETURN** closed - `inst-return-closed`

## 3. Processes / Business Logic (CDSL)

### Snapshot, then stream

- [x] `p1` - **ID**: `cpt-noter-algo-ui-core-bridge-snapshot-then-stream`

**Input**: a subscribing command (`transcript_subscribe`, `levels_subscribe`, `cards_subscribe`, `ask_start`, `self_test_run`) with its arguments, and the store slice it fills

**Output**: the slice filled from the snapshot and kept current by the Channel, or a named error state

**Steps**:
1. [x] - `p1` - Call the command with a message handler; the generated client buffers Channel messages that arrive before the result - `inst-call-subscribing`
2. [x] - `p1` - **IF** the result is an error - `inst-if-sub-error`
   1. [x] - `p1` - **RETURN** the mapped error state (`cpt-noter-algo-ui-core-bridge-map-error`) - `inst-return-sub-error`
3. [x] - `p1` - Store the snapshot part of the result in the slice and remember `subscription_id` and `last_seq` - `inst-store-snapshot`
4. [x] - `p1` - **FOR EACH** delivered message, in `seq` order (the client already drops `seq <= last_seq` and duplicates and sends `stream_ack` every 100 messages or 1 s) - `inst-for-each-msg`
   1. [x] - `p1` - **IF** `seq` is not `last_seq + 1` - `inst-if-gap`
      1. [x] - `p1` - Close the subscription and run this algorithm again from step 1 (resubscribe); the screen keeps showing what it has - `inst-resubscribe`
   2. [x] - `p1` - Append the message to the slice's buffer - `inst-buffer`
   3. [x] - `p1` - **IF** the message is `ended` with a reason - `inst-if-ended`
      1. [x] - `p1` - Map the reason to the screen's named state (for example `lagged` to resubscribe, `call_deleted` to the page's empty state) - `inst-map-ended`
5. [x] - `p1` - Every 100 ms, flush the buffer into the slice in one store update (`cpt-noter-algo-ui-core-bridge-flush-buffer`) - `inst-flush`
6. [x] - `p1` - **RETURN** the live slice - `inst-return-live`

### Apply whole state

- [x] `p1` - **ID**: `cpt-noter-algo-ui-core-bridge-apply-whole-state`

**Input**: a whole-state payload (from `app_snapshot`, an event or a command result) for a slice such as capture, degraded, banners, presenting, privacy, setup, settings, accounts, environment, window:call

**Output**: the store slice holding the newest state

**Steps**:
1. [x] - `p1` - Read the payload's `version` - `inst-read-version`
2. [x] - `p1` - **IF** the store already holds the same slice with a higher or equal `version` - `inst-if-older`
   1. [x] - `p1` - **RETURN** unchanged (a late payload is dropped) - `inst-return-unchanged`
3. [x] - `p1` - Replace the whole slice with the payload; never merge a partial change into it - `inst-replace`
4. [x] - `p1` - **RETURN** the updated slice - `inst-return-updated`

### Flush stream buffers

- [x] `p1` - **ID**: `cpt-noter-algo-ui-core-bridge-flush-buffer`

**Input**: the buffered transcript, levels or card messages of the last 100 ms

**Output**: one store update per slice

**Steps**:
1. [x] - `p1` - **FOR EACH** buffered transcript message - `inst-for-each-tr`
   1. [x] - `p1` - **MATCH** its type - `inst-match-tr`
      - [x] - `p1` - **CASE** `confirmed`: append the segment; confirmed segments never move or change position - `inst-case-confirmed`
      - [x] - `p1` - **CASE** `hypothesis`: replace the one hypothesis row - `inst-case-hypothesis`
      - [x] - `p1` - **CASE** `segments_updated` or `speakers_updated`: replace those records by identity - `inst-case-updated`
      - [x] - `p1` - **CASE** `gap` or `mark`: insert the row at its time - `inst-case-gap-mark`
2. [x] - `p1` - **FOR EACH** buffered levels message: keep only the newest per channel (meters update at most every 100 ms) - `inst-levels-newest`
3. [x] - `p1` - **FOR EACH** buffered card message: apply it to the card slice as the core sent it; numbers, expiry and ranking come from the core (M4) - `inst-cards`
4. [x] - `p1` - Commit one store update so screens re-render once - `inst-commit`
5. [x] - `p1` - **RETURN** the updated slices - `inst-return-flush`

### Map a typed error to a named state

- [x] `p1` - **ID**: `cpt-noter-algo-ui-core-bridge-map-error`

**Input**: a `CoreError` (`code`, `message`, `retryable`, `detail`) and the calling screen's error table

**Output**: the named state the screen shows

**Steps**:
1. [x] - `p1` - **IF** the screen's States table names a state for `code` - `inst-if-named`
   1. [x] - `p1` - **RETURN** that state with its words and next action; offer **Try Again** only when `retryable` is true - `inst-return-named`
2. [x] - `p1` - **IF** `code` is `window_not_allowed` or `invalid_input` - `inst-if-bug`
   1. [x] - `p1` - API: `log_ui` with the command name and code, never with transcript, document or model text - `inst-log-bug`
3. [x] - `p1` - **RETURN** the screen's section-level error with **Try Again** when `retryable`, and log it through `log_ui` - `inst-return-generic`

## 4. States (CDSL)

### Window store lifecycle

- [x] `p1` - **ID**: `cpt-noter-state-ui-core-bridge-window-store`

**States**: EMPTY, LOADING, READY, RESYNCING, FAILED, CLOSED

**Initial State**: EMPTY

**Transitions**:
1. [x] - `p1` - **FROM** EMPTY **TO** LOADING **WHEN** the window has subscribed to events and called `app_snapshot` - `inst-empty-loading`
2. [x] - `p1` - **FROM** LOADING **TO** READY **WHEN** the snapshot resolves and its slices are applied - `inst-loading-ready`
3. [x] - `p1` - **FROM** LOADING **TO** FAILED **WHEN** the snapshot returns an error or the contract major version differs - `inst-loading-failed`
4. [x] - `p1` - **FROM** FAILED **TO** LOADING **WHEN** the user chooses **Try Again** - `inst-failed-loading`
5. [x] - `p1` - **FROM** READY **TO** RESYNCING **WHEN** a Channel shows a `seq` gap or ends with `lagged` - `inst-ready-resync`
6. [x] - `p1` - **FROM** RESYNCING **TO** READY **WHEN** the resubscription's snapshot is applied - `inst-resync-ready`
7. [x] - `p1` - **FROM** READY **TO** CLOSED **WHEN** the window closes and its Channels are unsubscribed - `inst-ready-closed`

### Command call

- [x] `p1` - **ID**: `cpt-noter-state-ui-core-bridge-command`

**States**: IDLE, WAITING, DONE, ERROR

**Initial State**: IDLE

**Transitions**:
1. [x] - `p1` - **FROM** IDLE **TO** WAITING **WHEN** a screen calls a command; the control shows loading - `inst-idle-waiting`
2. [x] - `p1` - **FROM** WAITING **TO** DONE **WHEN** the result is `ok` and the record is written to the store - `inst-waiting-done`
3. [x] - `p1` - **FROM** WAITING **TO** ERROR **WHEN** the result is an error; the screen shows the mapped state - `inst-waiting-error`
4. [x] - `p1` - **FROM** ERROR **TO** WAITING **WHEN** the user chooses **Try Again** on a retryable state; never automatically - `inst-error-waiting`

## 5. Definitions of Done

### One bridge per window over the generated client

- [x] `p1` - **ID**: `cpt-noter-dod-ui-core-bridge-bridge`

The system **MUST** give each window one bridge built on `createCore()` with the Tauri transport in the app and `FakeCore` in tests, stories and the browser dev loop; only `apps/desktop/src/core/tauri-transport.ts` imports `@tauri-apps/*`, and only `main.tsx`, tests and stories import the fake core (`just arch`).

**Implements**:
- `cpt-noter-flow-ui-core-bridge-open-window`
- `cpt-noter-flow-ui-core-bridge-close-window`
- `cpt-noter-state-ui-core-bridge-window-store`

**Constraints**: `cpt-noter-constraint-tauri-webview`, `cpt-noter-constraint-local-only-ui`

**Touches**:
- Commands: `app_snapshot`, `stream_unsubscribe`, `log_ui`
- Code: `apps/desktop/src/core/*` (generated client untouched), `apps/desktop/src/app/bridge/*`
- Tests: unit tests against `FakeCore`; the conformance suite `apps/desktop/tests/conformance` against both cores

### Store with whole state, versions and stream buffers

- [x] `p1` - **ID**: `cpt-noter-dod-ui-core-bridge-store`

The system **MUST** keep one in-memory store per window with entity slices keyed by identity, whole-state slices kept by highest `version`, a 100 ms flush of the transcript, levels and card Channels, and no persistent browser storage.

**Implements**:
- `cpt-noter-algo-ui-core-bridge-snapshot-then-stream`
- `cpt-noter-algo-ui-core-bridge-apply-whole-state`
- `cpt-noter-algo-ui-core-bridge-flush-buffer`

**Constraints**: `cpt-noter-constraint-local-only-ui`

**Touches**:
- Commands: `stream_ack` (sent by the generated client), `stream_unsubscribe`
- Events: all 20 events of `contracts/ipc.manifest.json`
- Code: `apps/desktop/src/app/store/*` (Zustand, `cpt-noter-tech-ui-stack`)

### Typed errors to named states, no retries

- [x] `p1` - **ID**: `cpt-noter-dod-ui-core-bridge-errors`

The system **MUST** map every `ErrorCode` of the contract to the calling screen's named state or to its section-level error with **Try Again** when retryable, never retry on its own, send wanted state and `rev` with every edit, and log UI errors through `log_ui` without transcript text.

**Implements**:
- `cpt-noter-flow-ui-core-bridge-act`
- `cpt-noter-algo-ui-core-bridge-map-error`
- `cpt-noter-state-ui-core-bridge-command`

**Constraints**: `cpt-noter-constraint-local-only-ui`

**Touches**:
- Commands: `log_ui`; every command through its screen
- Tests: a unit test per code with `FakeCore.failNext`

## 6. Acceptance Criteria

- [ ] A window reload against the fake core and against `noter-core-harness` shows the same records before and after, with no message lost or doubled (conformance `snapshot-stream`)
- [ ] A `seq` gap forces a resubscription and the slice ends equal to the core's state
- [ ] A late whole-state payload with a lower `version` never replaces a newer one
- [ ] Every `ErrorCode` has a mapping test; no command is retried without a user action
- [ ] No module outside `src/core` imports `@tauri-apps/*`; no screen imports the fake core (`just arch` passes)
- [ ] No `localStorage`, `sessionStorage`, IndexedDB or cookie access exists in the UI bundle
- [ ] Unit line coverage of the new code is at least 80 % (`just cov-unit`)

## 7. Additional Context

**Prototype reuse.** Source of truth only. The prototype keeps all state in one global object in `src/js/00-core.js` (`state`, `local()`, `demo()`), renders by replacing `innerHTML` and calls no core. None of it is ported: production uses the generated client, one store per window and React rendering. The prototype is still the reference for which view state each screen keeps (the keys of `local()` per screen: selection, expanded rows, open inspector, flashes) and for the 2 s, 3 s and 10 s timings of `flash()` and `undo()`. `src/js/03-data.js` and `src/js/40-d-1-data.js` hold the sample records ("today" is Thursday 16 October 2026); the fake core's fixture world (`contracts/fixtures/world.json`, contract lane) should carry the same calls, people and items so that screenshots match the prototype.

**States coverage.** The bridge and store have no screen of their own. The main window's "Window reloaded" state (skeleton rows after 300 ms) is implemented by `inst-skeleton`; every other screen state is owned by its screen feature.

**Not applicable.** Authentication and authorization: Noter has one macOS user; least privilege is the per-window command scope that Tauri capabilities enforce (PM-08), which this feature surfaces as `window_not_allowed`. Database access: the UI never opens the database. Network: the WebView makes no request (`cpt-noter-constraint-local-only-ui`).

**Testing.** Unit tests with `FakeCore` (`failNext`, `setWorld`, `push` with explicit `seq` for gaps); the conformance suite runs the same checks against the real core through `noter-core-harness` from M0. Trace markers: `@cpt-flow:cpt-noter-flow-ui-core-bridge-open-window:p1` and the other IDs of this file on the implementing modules.
