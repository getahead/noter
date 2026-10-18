---
title: "Feature: Engine sidecar and supervisor foundation"
description: "The sandboxed Swift engine and its Rust supervisor: spawn, handshake, liveness, the self-test, detection on and off, file mode and restart, with the signing and entitlement checks that keep the engine offline; plus the week-one spike."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M0
lane: engine
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Engine sidecar and supervisor foundation

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Start the engine](#start-the-engine)
  - [Run the engine self-test](#run-the-engine-self-test)
  - [Replay a recording in file mode](#replay-a-recording-in-file-mode)
  - [Week-one spike](#week-one-spike)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Read engine events](#read-engine-events)
  - [Restart a dead engine](#restart-a-dead-engine)
- [4. States (CDSL)](#4-states-cdsl)
  - [Engine process](#engine-process)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Engine package and codec](#engine-package-and-codec)
  - [Supervisor crate](#supervisor-crate)
  - [Offline by construction](#offline-by-construction)
  - [Week-one decisions recorded](#week-one-decisions-recorded)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-noter-featstatus-core-engine-foundation`

- [ ] `p1` - `cpt-noter-feature-core-engine-foundation`

## 1. Feature Context

### 1.1 Overview

Two halves that only work together. In Swift, the `engine/` package builds `noter-engine`: a sandboxed executable with audio input and the App Group, no network, whose protocol types are generated from `contracts/engine.schema.json`. In Rust, crate `noter-engine-client` spawns it with `tokio::process`, checks the protocol version on `ready`, writes commands, reads events on a dedicated task, detects `seq` gaps, correlates `ack` and `error` with command ids and restarts a dead engine. In M0 the engine can do the handshake, `ping`, `shutdown`, `set_detection` and the first-run `self_test`, and runs in file mode for tests. Capture and live ASR are M1. The week-one spike of PRD › Roadmap runs at the start of this feature.

### 1.2 Purpose

First run needs a self-test that proves both streams arrive, and everything after M0 needs an engine the core can trust to start, answer and come back. The privacy story needs the engine to be unable to reach the network, enforced by the OS, and checked in CI.

**Requirements**: PRD › Audio capture on macOS (entitlements and signing); PRD › Repository layout › Engine protocol and Sidecars; PRD › Roadmap (week one).

**Principles**: `cpt-noter-principle-core-fakes`

**Delivers**: no IPC command directly. It is the engine half of `self_test_run` and of `cpt-noter-seq-first-run-complete-setup` (owned by `cpt-noter-feature-core-first-run`), and the scripted-engine seam `cpt-noter-feature-core-harness` replaces.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Engine supervisor (core) | Spawns, talks to and restarts the engine |
| Engine sidecar | Answers commands with facts; never decides product rules |
| Test or golden-set replay | Runs the engine in file mode |
| Engine developer | Runs the week-one spike and records its decisions |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-engine-foundation`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-engine`, `cpt-noter-component-core-engine-supervisor`, `cpt-noter-interface-engine-stdio`, `cpt-noter-topology-core-processes`; open questions Q4 and Q7
- **Dependencies**: `cpt-noter-feature-core-contract`

## 2. Actor Flows (CDSL)

### Start the engine

- [x] `p1` - **ID**: `cpt-noter-flow-core-engine-foundation-start`

**Actor**: Engine supervisor (core)

**Success Scenarios**:
- On first need (self-test, detection, capture), the supervisor spawns the engine, gets `ready` with a matching protocol major, and the engine answers `ping`.

**Error Scenarios**:
- The engine binary is missing or does not start: `engine_unavailable` to callers; logged.
- `ready` reports another protocol major: the supervisor stops the engine and reports `engine_unavailable`; it never guesses around a version.
- No `ready` within the start timeout: the process is killed and counted as a failed start.

**Steps**:
1. [x] - `p1` - Resolve the engine path (bundle, or `NOTER_ENGINE_PATH` in development) and the App Group container - `inst-resolve`
2. [x] - `p1` - Spawn with `tokio::process`, stdin and stdout piped, stderr to the log; pass the App Group container; never a database or network path - `inst-spawn`
3. [x] - `p1` - Start the reader task with `cpt-noter-algo-core-engine-foundation-read-events` - `inst-reader`
4. [x] - `p1` - Wait for `ready { protocol_version, engine_version, models, sandboxed }` - `inst-wait-ready`
5. [x] - `p1` - **IF** the major of `protocol_version` differs from `ENGINE_PROTOCOL_VERSION` - `inst-if-major`
   1. [x] - `p1` - Send `shutdown`, kill after a grace period, **RETURN** `engine_unavailable` - `inst-return-major`
6. [x] - `p1` - Send `set_detection` with the current detection rule (off until the self-test passed) - `inst-set-detection`
7. [x] - `p1` - **RETURN** a ready engine handle - `inst-return-ready`

### Run the engine self-test

- [ ] `p1` - **ID**: `cpt-noter-flow-core-engine-foundation-self-test`

**Actor**: Engine supervisor (on behalf of `self_test_run`)

**Success Scenarios**:
- Both channels deliver non-zero buffers within the timeout; the engine streams arrival, levels and a recognised line per channel, then `self_test_result { passed: true }`.

**Error Scenarios**:
- One stream stays silent: `failed` with `OneStreamSilent { channel }`.
- Only exact digital zeros arrive: `failed` with `ZeroBuffers` (the System Audio Recording permission is off, inferred).
- The engine's own clip leaks into the tap: `failed` with `OwnSoundsLeak`.
- Nothing within 10 s: `failed` with `TimedOut`.
- The live model is not downloaded: `failed` with `ModelMissing`.

**Steps**:
1. [ ] - `p1` - Supervisor sends `self_test { play_clip, timeout_ms: 10000 }` - `inst-send-self-test`
2. [x] - `p1` - Engine opens the tap (excluding its own and the app's PIDs) and the microphone - `inst-open-taps`
3. [x] - `p1` - **FOR EACH** channel whose first non-zero buffer arrives, engine emits `self_test_stream` - `inst-stream-arrived`
4. [x] - `p1` - Engine emits levels - `inst-levels-lines`
5. [ ] - `p1` - **IF** `play_clip`, engine plays its clip and checks the tap does not hear it - `inst-play-clip`
6. [x] - `p1` - Engine emits `self_test_result { passed, failure, own_sounds_leak }` and closes the taps - `inst-result`
7. [x] - `p1` - **RETURN** the events to the caller in order - `inst-return-self-test`

The tap and the microphone on one clock, and `self_test_line` per channel when the model is present, are delivered with capture in M1: `cpt-noter-flow-core-engine-capture-self-test` (decision D-12).

### Replay a recording in file mode

- [x] `p2` - **ID**: `cpt-noter-flow-core-engine-foundation-file-mode`

**Actor**: Test or golden-set replay

**Success Scenarios**:
- `noter-engine --mic mic.wav --sys sys.wav` runs the same pipeline on files and speaks the same protocol, so the core and the golden set are tested without a live call.

**Error Scenarios**:
- A file is missing or unreadable: `error { code: device_unavailable }` and exit.

**Steps**:
1. [x] - `p1` - Start the engine with file arguments instead of devices - `inst-file-args`
2. [x] - `p1` - Engine emits `ready`, then events in file time (or as fast as possible with a flag) - `inst-file-events`
3. [x] - `p1` - **RETURN** when both files end, with `session_stopped` - `inst-file-return`

### Week-one spike

- [ ] `p1` - **ID**: `cpt-noter-flow-core-engine-foundation-spike`

**Actor**: Engine developer

**Success Scenarios**:
- A throwaway Swift CLI, spawned as a sandboxed helper, gets the System Audio Recording prompt attributed to Noter, receives non-zero buffers on both channels, runs one WhisperKit Turbo instance with per-utterance language ID on a real three-language call, and prints hypothesis and confirmed latency.

**Error Scenarios**:
- The prompt is not attributed to Noter from a sandboxed child: the engine ships unsandboxed (Q4) and the CI network-monitor test becomes the guarantee; `storage_move` becomes available.
- Latency misses the provisional budget (hypothesis ≤ 2 s, confirmed ≤ 4 s): the streaming policy is changed or Parakeet joins as a second backend.

**Steps**:
1. [ ] - `p1` - Build the spike CLI and run it as a sandboxed child of a stand-in app - `inst-spike-build`
2. [ ] - `p1` - Record whether the prompt is attributed to the app and whether buffers are non-zero on both channels - `inst-spike-prompt`
3. [ ] - `p1` - Run WhisperKit Turbo over both channels on a real three-language call and record hypothesis and confirmed lag - `inst-spike-latency`
4. [ ] - `p1` - **RETURN** the decisions (sandbox yes or no, streaming policy, backends) as an update of DESIGN-core Q4 by the owner and a note in this FEATURE - `inst-spike-return`

## 3. Processes / Business Logic (CDSL)

### Read engine events

- [x] `p1` - **ID**: `cpt-noter-algo-core-engine-foundation-read-events`

**Input**: The engine's stdout, one `EngineEventLine { seq, at, event }` per line.

**Output**: Events routed to their consumer; gaps and protocol errors reported.

**Steps**:
1. [x] - `p1` - **FOR EACH** line - `inst-for-lines`
   1. [x] - `p1` - Parse it; a line that does not parse is logged (without content) and counted - `inst-parse-event`
   2. [x] - `p1` - **IF** `seq` is not the previous `seq + 1`, record a gap; only `levels` and stale hypotheses may be missing - `inst-detect-gap`
   3. [x] - `p1` - **IF** the event is `ack`, `error` or `pong`, resolve the waiting command by id - `inst-correlate`
   4. [x] - `p1` - **ELSE** route the event to its subscriber (self-test, session, detection) - `inst-route`
2. [x] - `p1` - **IF** stdout closes, hand over to `cpt-noter-algo-core-engine-foundation-restart` - `inst-on-close`
3. [x] - `p1` - **RETURN** - `inst-return-read`

### Restart a dead engine

- [ ] `p1` - **ID**: `cpt-noter-algo-core-engine-foundation-restart`

**Input**: The engine exited or stopped answering `ping`.

**Output**: A running engine again, or `engine_unavailable`.

**Steps**:
1. [x] - `p1` - Fail every waiting command with `engine_unavailable` - `inst-fail-waiting`
2. [ ] - `p1` - **IF** a capture session was running, hand over to the capture-first restart (`cpt-noter-feature-core-engine-capture`, M1) - `inst-if-capture`
3. [x] - `p1` - **ELSE** restart with back-off; after three failed starts in a minute, stop trying until the next request - `inst-backoff`
4. [x] - `p1` - **RETURN** the new handle, or `engine_unavailable` - `inst-return-restart`

## 4. States (CDSL)

### Engine process

- [x] `p1` - **ID**: `cpt-noter-state-core-engine-foundation-process`

**States**: not_started, starting, ready, restarting, unavailable, stopped

**Initial State**: not_started

**Transitions**:
1. [x] - `p1` - **FROM** not_started **TO** starting **WHEN** a component first needs the engine - `inst-st-start`
2. [x] - `p1` - **FROM** starting **TO** ready **WHEN** `ready` arrives with a matching protocol major - `inst-st-ready`
3. [x] - `p1` - **FROM** starting **TO** unavailable **WHEN** the major differs or no `ready` arrives in time - `inst-st-unavailable`
4. [x] - `p1` - **FROM** ready **TO** restarting **WHEN** the process exits or misses `ping` - `inst-st-restart`
5. [x] - `p1` - **FROM** restarting **TO** ready **WHEN** a new process sends a valid `ready` - `inst-st-restarted`
6. [x] - `p1` - **FROM** restarting **TO** unavailable **WHEN** three starts failed within a minute - `inst-st-giveup`
7. [x] - `p1` - **FROM** ready **TO** stopped **WHEN** the core shuts down and the engine acknowledged `shutdown` - `inst-st-stopped`

## 5. Definitions of Done

### Engine package and codec

- [ ] `p1` - **ID**: `cpt-noter-dod-core-engine-foundation-package`

The system **MUST** build `noter-engine` from the Swift package `engine/` with protocol types generated from `contracts/engine.schema.json`, answering `ping`, `shutdown`, `set_detection` and `self_test`, and running in file mode; Swift tests replay WAV fixtures through file mode.

**Implements**:
- `cpt-noter-flow-core-engine-foundation-self-test`
- `cpt-noter-flow-core-engine-foundation-file-mode`

**Constraints**: `cpt-noter-constraint-core-macos`

**Touches**:
- Entities: `EngineCommandLine`, `EngineEventLine`

### Supervisor crate

- [ ] `p1` - **ID**: `cpt-noter-dod-core-engine-foundation-supervisor`

The system **MUST** provide `noter-engine-client` without a Tauri dependency: spawn with `tokio::process`, protocol-major check on `ready`, `seq` gap detection, `ack` and `error` correlation, liveness by `ping`, and restart with back-off; unit tests run against a scripted engine.

**Implements**:
- `cpt-noter-flow-core-engine-foundation-start`
- `cpt-noter-algo-core-engine-foundation-read-events`
- `cpt-noter-algo-core-engine-foundation-restart`
- `cpt-noter-state-core-engine-foundation-process`

**Touches**:
- Entities: engine handle

### Offline by construction

- [ ] `p1` - **ID**: `cpt-noter-dod-core-engine-foundation-offline`

The system **MUST** sign the engine in the Swift build with its own entitlements (App Sandbox, audio input, App Group `<TEAMID>.ai.noter`, no network) and Info.plist, ship it through `bundle.macOS.files` so the Tauri bundler does not re-sign it, and keep every path the supervisor sends relative to the App Group container; the architecture check finds no network entitlement in any engine entitlements file.

**Implements**:
- `cpt-noter-flow-core-engine-foundation-start`

**Decision E1 (Teamlead, 18 Oct 2026)**: this definition is conditional on Q4. If the week-one spike keeps the engine sandboxed, App Sandbox with no network entitlement is the guarantee; if Q4 decides the engine ships unsandboxed, the guarantee is no network entitlement plus the CI network-monitor test.

**Constraints**: `cpt-noter-constraint-core-engine-offline`

**Touches**:
- Entities: engine entitlements, App Group container layout (`audio/`, `models/`, `engine-io/`, capture ring)

### Week-one decisions recorded

- [ ] `p1` - **ID**: `cpt-noter-dod-core-engine-foundation-spike`

The system **MUST** have the week-one spike run and its results recorded: sandbox attribution (Q4), the streaming policy and whether Parakeet joins, with the owner's decision reflected in DESIGN-core before `cpt-noter-feature-core-engine-capture` starts.

**Implements**:
- `cpt-noter-flow-core-engine-foundation-spike`

**Touches**:
- Entities: spike report

## 6. Acceptance Criteria

- [ ] The supervisor starts the engine, gets `ready`, and refuses an engine reporting another protocol major with `engine_unavailable`.
- [ ] Killing the engine while idle leads to a restart; three failed starts within a minute stop the retries.
- [ ] The self-test passes on a Mac with both channels producing sound and fails with the right reason when one channel is silent or only zeros arrive.
- [ ] File mode replays a WAV pair and speaks the same protocol.
- [ ] `just arch` finds no network entitlement for the engine; the codesign check of the built engine shows its own entitlements.
- [ ] `just gate` passes (engine tests on the macOS runner).
