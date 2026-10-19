---
title: "Feature: IPC host, app snapshot and stream hub"
description: "The one typed door between the windows and the core: scoped commands, typed errors, whole-state events with versions, and Channels that start after a snapshot, are acknowledged and survive a reload."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M0
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: IPC host, app snapshot and stream hub

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Call a command from a window](#call-a-command-from-a-window)
  - [Open or reload a window](#open-or-reload-a-window)
  - [Dismiss an app banner](#dismiss-an-app-banner)
  - [Log a UI error](#log-a-ui-error)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Window scope check](#window-scope-check)
  - [Subscribe with a snapshot](#subscribe-with-a-snapshot)
  - [Publish and acknowledge](#publish-and-acknowledge)
  - [End subscriptions of a webview](#end-subscriptions-of-a-webview)
  - [Stamp whole-state versions](#stamp-whole-state-versions)
  - [Scrub log lines](#scrub-log-lines)
- [4. States (CDSL)](#4-states-cdsl)
  - [Subscription lifecycle](#subscription-lifecycle)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Scoped handlers with parity](#scoped-handlers-with-parity)
  - [Stream hub](#stream-hub)
  - [App snapshot, banners and versions](#app-snapshot-banners-and-versions)
  - [No content in logs](#no-content-in-logs)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-noter-featstatus-core-ipc-host`

- [ ] `p1` - `cpt-noter-feature-core-ipc-host`

## 1. Feature Context

### 1.1 Overview

The Tauri host in `apps/desktop/src-tauri` registers one handler per contract command, builds `CommandCtx` with the calling window's label, checks the window scope, parses the arguments and calls `CoreApi` on `noter-core`. The stream hub inside `noter-core` gives every Channel a snapshot and a sequence, buffers a bounded replay, takes acknowledgements and ends lagging or orphaned subscriptions. The app snapshot, banners and degraded set are whole-state payloads with a `version`. Every later feature plugs its service into this composition root.

### 1.2 Purpose

The UI is built on the rules of ADR-0002 (one `args` object, result or `CoreError`, wanted state, revisions, snapshot then stream, whole-state events). This feature makes the real core keep those rules in one place, so a window that reloads or crashes shows the same state, and no window can call a command outside its scope.

**Requirements**: DESIGN.md › Core bridge and Window store; DESIGN.md › Core owns the state; PRD › Repository layout (`src-tauri` thin IPC host).

**Principles**: `cpt-noter-principle-core-snapshot-stream`, `cpt-noter-principle-core-intent-commands`

**Delivers**:
- Frozen commands: `app_snapshot`, `stream_unsubscribe`, `stream_ack`, `banner_dismiss`, `log_ui` (milestone M0).
- Events: `banners:changed`, `degraded:changed` and `entity:changed` as mechanisms other features publish through.
- DESIGN-core sequence `cpt-noter-seq-core-window-open`.
- M0 performance scenario `core_app_snapshot`, the handler-parity test and the log-scrubbing test (docs/HARNESS.md › What comes next).
- No DESIGN.md story on its own: every story of M0 and M1 runs through it.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| UI window (WebView) | Calls commands with its label; opens Channels; acknowledges messages; reloads or crashes |
| Native surface (menu, menu bar, hotkey, notification) | Calls `CoreApi` in process as `Caller::Native { surface }` |
| Core service | Answers commands, publishes stream messages and whole-state events |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-ipc-host`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-ipc-host`, `cpt-noter-component-core-stream-hub`, `cpt-noter-interface-core-ipc`, `cpt-noter-seq-core-window-open`
- **ADRs**: `cpt-noter-adr-0002-ipc-conventions`
- **Dependencies**: `cpt-noter-feature-core-contract`, `cpt-noter-feature-core-storage`

## 2. Actor Flows (CDSL)

### Call a command from a window

- [x] `p1` - **ID**: `cpt-noter-flow-core-ipc-host-command`

**Actor**: UI window (WebView)

**Success Scenarios**:
- The window is in the command's scope and the arguments parse: the result comes back, typed.

**Error Scenarios**:
- The window is not in the scope (or Tauri's own capability check denies it): `window_not_allowed`.
- The arguments do not parse: `invalid_input`.
- The core is still starting: `not_ready`, retryable.

**Steps**:
1. [x] - `p1` - Window invokes the command with `{ args }` (and `channel` for subscribing commands) - `inst-invoke`
2. [x] - `p1` - Host builds `CommandCtx` with `Caller::Window { label }` from the calling webview - `inst-build-ctx`
3. [x] - `p1` - Host runs `cpt-noter-algo-core-ipc-host-scope-check` - `inst-scope-check`
4. [x] - `p1` - **IF** the scope check refused - `inst-if-refused`
   1. [x] - `p1` - **RETURN** `CoreError { code: window_not_allowed }` - `inst-return-not-allowed`
5. [x] - `p1` - Host deserializes `args` into the command's argument type; a failure **RETURN** `invalid_input` - `inst-parse-args`
6. [x] - `p1` - **IF** the command subscribes, adapt the Tauri Channel into a contract `Sink` - `inst-adapt-sink`
7. [x] - `p1` - API: call the `CoreApi` method on the concrete core - `inst-call-core`
8. [x] - `p1` - **RETURN** the result, or the `CoreError` serialized as the rejection - `inst-return-result`

### Open or reload a window

- [x] `p1` - **ID**: `cpt-noter-flow-core-ipc-host-window-open`

**Actor**: UI window (WebView)

**Success Scenarios**:
- On open, reload or after a WebView crash, the window gets the app snapshot, subscribes to what it shows and sees the same transcript, cards, pins and marks, with nothing lost or doubled.

**Error Scenarios**:
- The window falls 2 000 messages behind: its subscription ends with `ended { lagged }` and it subscribes again with a fresh snapshot.
- The webview reloads: every subscription it held ends; the reloaded page subscribes again.

**Steps**:
1. [x] - `p1` - API: `app_snapshot {}` returns `AppSnapshot` with each slice carrying its `version` - `inst-app-snapshot`
2. [x] - `p1` - Window calls a subscribing command (for example `transcript_subscribe`) with a Channel - `inst-subscribe`
3. [x] - `p1` - Hub runs `cpt-noter-algo-core-ipc-host-subscribe` and returns the snapshot with `last_seq` - `inst-run-subscribe`
4. [x] - `p1` - Hub delivers messages with `seq = last_seq + 1, + 2, …`; the generated transport buffers any that arrive before the snapshot and drops `seq ≤ last_seq` - `inst-deliver`
5. [x] - `p1` - API: window sends `stream_ack { subscription_id, seq }` every 100 messages or 1 s; hub runs `cpt-noter-algo-core-ipc-host-ack` - `inst-ack`
6. [x] - `p1` - **IF** the window calls `stream_unsubscribe` - `inst-if-unsubscribe`
   1. [x] - `p1` - Hub ends the subscription with `ended { unsubscribed }` and **RETURN** `Ack` - `inst-return-unsubscribed`

### Dismiss an app banner

- [x] `p1` - **ID**: `cpt-noter-flow-core-ipc-host-banner-dismiss`

**Actor**: UI window (main)

**Success Scenarios**:
- The user closes a banner; every window gets the new `BannerSet`. Dismissing `RecordingInterruptedByQuit` also ends the offer to resume that call.

**Error Scenarios**:
- The banner is already gone: the current `BannerSet` is returned unchanged.

**Steps**:
1. [x] - `p1` - API: `banner_dismiss { banner }` from the main window - `inst-dismiss`
2. [x] - `p1` - Core removes the banner kind from the set (an absent kind returns the set unchanged, without an event). The `RecordingInterruptedByQuit` banner is the resume offer itself, so removing it ends the offer to resume that call - `inst-remove-banner`
3. [x] - `p1` - Bump the `BannerSet` version and emit `banners:changed` with the whole set - `inst-emit-banners`
4. [x] - `p1` - **RETURN** the `BannerSet` - `inst-return-banners`

### Log a UI error

- [x] `p2` - **ID**: `cpt-noter-flow-core-ipc-host-log-ui`

**Actor**: UI window

**Success Scenarios**:
- A UI error reaches the local log with its level, window and message.

**Error Scenarios**:
- The message carries a field that may hold transcript, document or model text: the field is dropped before writing.

**Steps**:
1. [x] - `p1` - API: `log_ui { level, message, context }` - `inst-log-call`
2. [x] - `p1` - Core applies `cpt-noter-algo-core-ipc-host-scrub-log` - `inst-log-scrub`
3. [x] - `p1` - Write the line to `logs/` (structured, 0600); bounding and rotating `logs/noter.log` is M5 maintenance (`cpt-noter-feature-core-maintenance`) - `inst-log-write`
4. [x] - `p1` - **RETURN** `Ack` - `inst-log-return`

## 3. Processes / Business Logic (CDSL)

### Window scope check

- [x] `p1` - **ID**: `cpt-noter-algo-core-ipc-host-scope-check`

**Input**: `CommandCtx.caller` and the command's window list from `COMMANDS`.

**Output**: Allowed, or refused with `window_not_allowed`.

**Steps**:
1. [x] - `p1` - **IF** the caller is `Caller::Native { surface }` - `inst-if-native`
   1. [x] - `p1` - **RETURN** allowed; record the surface as the actor surface for any change the command writes - `inst-return-native`
2. [x] - `p1` - **IF** the window label is in the command's list - `inst-if-in-scope`
   1. [x] - `p1` - **RETURN** allowed - `inst-return-allowed`
3. [x] - `p1` - **RETURN** refused - `inst-return-refused`

### Subscribe with a snapshot

- [x] `p1` - **ID**: `cpt-noter-algo-core-ipc-host-subscribe`

**Input**: Stream kind and key (for example transcript of a call), the window label, the `Sink`.

**Output**: The snapshot with `last_seq` and a subscription id.

**Steps**:
1. [x] - `p1` - Take the hub lock for the stream key - `inst-lock`
2. [x] - `p1` - Ask the owning service for its snapshot, read through the writer connection (`cpt-noter-algo-core-storage-snapshot-read`) - `inst-snapshot`
3. [x] - `p1` - Read the stream's current `seq` as `last_seq` - `inst-read-seq`
4. [x] - `p1` - Register the subscription: id, window label, `Sink`, last acknowledged `seq = last_seq` - `inst-register`
5. [x] - `p1` - Release the lock - `inst-unlock`
6. [x] - `p1` - **RETURN** the snapshot, `last_seq` and the subscription id - `inst-return-subscribe`

### Publish and acknowledge

- [x] `p1` - **ID**: `cpt-noter-algo-core-ipc-host-ack`

**Input**: A stream message from a service, or a `stream_ack` from a window.

**Output**: Messages delivered in order; lagging subscriptions ended.

**Steps**:
1. [x] - `p1` - On publish, take the hub lock, assign `seq + 1`, append to the replay buffer (bounded at 2 000 messages, the lag limit), send to every subscription of the stream - `inst-publish`
2. [x] - `p1` - **FOR EACH** subscription after a send - `inst-for-subs`
   1. [x] - `p1` - **IF** unacknowledged messages reach 2 000, end it with `ended { lagged }` and drop it - `inst-end-lagged`
3. [x] - `p1` - On `stream_ack`, set the subscription's last acknowledged `seq` (never lower than before) - `inst-ack-update`
4. [x] - `p1` - Levels are coalesced per stream to at most one message per 100 ms, before a `seq` is assigned: a skipped level takes no `seq` and is not kept for replay, so every subscriber sees consecutive `seq`s (ADR-0002); cards are never batched or delayed - `inst-coalesce`
5. [x] - `p1` - **RETURN** - `inst-return-publish`

### End subscriptions of a webview

- [x] `p1` - **ID**: `cpt-noter-algo-core-ipc-host-webview-reset`

**Input**: A page-load or destroy notice for a webview label, or a stream end (stop, discard, shutdown).

**Output**: Every affected subscription ended with a reason.

**Steps**:
1. [x] - `p1` - **IF** a webview loaded a page or was destroyed - `inst-if-webview`
   1. [x] - `p1` - End every subscription of that label with `ended { unsubscribed }` - `inst-end-webview`
2. [x] - `p1` - **IF** a stream ended (call stopped, discarded, shutdown) - `inst-if-stream-end`
   1. [x] - `p1` - End every subscription of the stream with that reason (`call_stopped`, `discarded`, `shutdown`) - `inst-end-stream`
3. [x] - `p1` - **RETURN** - `inst-return-reset`

### Stamp whole-state versions

- [x] `p1` - **ID**: `cpt-noter-algo-core-ipc-host-version`

**Input**: A whole-state payload kind (capture, degraded, banners, settings, setup, environment, …) and its new state.

**Output**: The payload stamped with a `version` higher than any earlier one of that kind.

**Steps**:
1. [x] - `p1` - Increment the kind's counter (kept in memory, starting from 1 at each core start) - `inst-increment`
2. [x] - `p1` - Stamp the payload, and the matching command result or snapshot slice, with it - `inst-stamp`
3. [x] - `p1` - Emit the event with the whole state - `inst-emit-event`
4. [x] - `p1` - **RETURN** the stamped payload - `inst-return-version`

### Scrub log lines

- [x] `p1` - **ID**: `cpt-noter-algo-core-ipc-host-scrub-log`

**Input**: A log record from the UI or from any core module.

**Output**: The record without transcript, document or model text.

**Steps**:
1. [x] - `p1` - Keep only fields of an allow-list (level, module, window, command name, error code, ids, durations, counts) - `inst-allow-list`
2. [x] - `p1` - Keep no free text: a UI message keeps only its length (`message_len`), and any string that is not a short identifier (screen, command, id, error code) is left out - `inst-truncate`
3. [x] - `p1` - **RETURN** the scrubbed record - `inst-return-scrubbed`

## 4. States (CDSL)

### Subscription lifecycle

- [x] `p1` - **ID**: `cpt-noter-state-core-ipc-host-subscription`

**States**: registering, streaming, ended

**Initial State**: registering

**Transitions**:
1. [x] - `p1` - **FROM** registering **TO** streaming **WHEN** the snapshot was taken and the subscription registered under the hub lock - `inst-st-streaming`
2. [x] - `p1` - **FROM** streaming **TO** ended **WHEN** the window unsubscribes, its webview reloads or is destroyed, it falls 2 000 messages behind, or the stream ends (call stopped, discarded, shutdown) - `inst-st-ended`

## 5. Definitions of Done

### Scoped handlers with parity

- [x] `p1` - **ID**: `cpt-noter-dod-core-ipc-host-handlers`

The system **MUST** register one handler per entry of `COMMANDS` in `src-tauri`, generate `AppManifest::commands` and one capability per window in `build.rs`, map Tauri's denial to `window_not_allowed` and parse failures to `invalid_input`, and prove with `tauri::test::mock_builder` that the registered list equals `COMMANDS` and every command called from every window gets its answer or `window_not_allowed`.

**Implements**:
- `cpt-noter-flow-core-ipc-host-command`
- `cpt-noter-algo-core-ipc-host-scope-check`

**Constraints**: `cpt-noter-constraint-core-stack`

**Touches**:
- API: all 172 commands (registered; unanswered ones return `not_implemented` until their milestone)
- Entities: `CommandCtx`, `Caller`

### Stream hub

- [x] `p1` - **ID**: `cpt-noter-dod-core-ipc-host-stream-hub`

The system **MUST** start every Channel at `last_seq + 1` after a snapshot taken under the hub lock, keep consecutive `seq` numbers, accept `stream_ack`, end a subscription at 2 000 unacknowledged messages with `lagged`, end every subscription of a webview on page load or destroy, and end streams with their reason.

**Implements**:
- `cpt-noter-flow-core-ipc-host-window-open`
- `cpt-noter-algo-core-ipc-host-subscribe`
- `cpt-noter-algo-core-ipc-host-ack`
- `cpt-noter-algo-core-ipc-host-webview-reset`
- `cpt-noter-state-core-ipc-host-subscription`

**Touches**:
- API: `stream_ack`, `stream_unsubscribe`, and every subscribing command of later features

### App snapshot, banners and versions

- [ ] `p1` - **ID**: `cpt-noter-dod-core-ipc-host-snapshot`

The system **MUST** answer `app_snapshot` with every slice the current milestone provides (each with its `version`, defaults for slices whose feature comes later), keep `banner_dismiss` and `banners:changed` whole-state, and stamp every whole-state payload with a monotonic `version` per kind; the `core_app_snapshot` perf scenario is built and measured.

**Implements**:
- `cpt-noter-flow-core-ipc-host-banner-dismiss`
- `cpt-noter-algo-core-ipc-host-version`

**Touches**:
- API: `app_snapshot`, `banner_dismiss`, `banners:changed`, `degraded:changed`

### No content in logs

- [x] `p1` - **ID**: `cpt-noter-dod-core-ipc-host-log-scrub`

The system **MUST** never write transcript, document or model text to `logs/`; a test feeds every log path (including `log_ui`) records with such text and finds none of it on disk.

**Implements**:
- `cpt-noter-flow-core-ipc-host-log-ui`
- `cpt-noter-algo-core-ipc-host-scrub-log`

**Touches**:
- API: `log_ui`

## 6. Acceptance Criteria

- [x] The handler-parity test passes: registered handlers equal `COMMANDS`, and every command from every window is answered or refused with `window_not_allowed`.
- [x] A Channel message published before the subscribing `invoke` resolves is delivered after the snapshot, and none with `seq ≤ last_seq` is delivered (conformance, against the real core).
- [x] A subscriber that stops acknowledging is ended with `lagged` at 2 000 messages; a reloaded webview's subscriptions end.
- [ ] `app_snapshot`, `stream_unsubscribe`, `stream_ack`, `banner_dismiss` and `log_ui` succeed in E2E runs against the real core.
- [x] No log file contains transcript text after the log-scrubbing test.
- [ ] `just gate` passes.
