---
title: "Feature: noter-core-harness and real-core conformance"
description: "A test binary that runs the real CoreApi without Tauri over JSON Lines, with a fixture database, a scripted engine and a scripted runtime, so the conformance suite and the UI E2E flows count against the real core from M0."
status: PROPOSED
version: "0.4"
date: "2026-11-14"
milestone: M0
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: noter-core-harness and real-core conformance

> **Change log (v0.2):** The fixture seeds engine-named audio files and the scripted stop writes physical recordings.
> **Change log (v0.3):** The built-in offline archive returns live transcript segments when call audio exists and fails when it does not.
> **Change log (v0.4):** Protocol fixtures and TypeScript-export dependencies are feature-gated so ordinary application builds omit them; the harness and export binary opt into the needed features. Scripted native services mirror calendar range/attendee/time-zone behavior and expose deterministic failures for permission, login-item and updater operations.

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Drive the real core over stdio](#drive-the-real-core-over-stdio)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Boot the core on a fixture](#boot-the-core-on-a-fixture)
  - [Dispatch a request line](#dispatch-a-request-line)
  - [Scripted engine](#scripted-engine)
- [4. States (CDSL)](#4-states-cdsl)
  - [Harness process](#harness-process)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Wire format](#wire-format)
  - [Fixture world and seams](#fixture-world-and-seams)
  - [Conformance and E2E against the real core](#conformance-and-e2e-against-the-real-core)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [x] `p1` - **ID**: `cpt-noter-featstatus-core-harness`

- [x] `p1` - `cpt-noter-feature-core-harness`

## 1. Feature Context

### 1.1 Overview

`crates/noter-core-harness` is a small, unshipped binary. It builds the same `noter-core` composition root the app uses, without Tauri, on a fresh database seeded from `contracts/fixtures/world.json`, with a scripted engine and a scripted runtime behind the real seams. It speaks the JSON Lines wire format of docs/HARNESS.md on stdin and stdout. The conformance suite and the Playwright flows reach it through `apps/desktop/tests/support/stdio-transport.ts`.

Protocol fixture data is enabled only for the harness and contract-export binary; TypeScript-export dependencies and the exporter binary are enabled only by the protocol crate's `export` feature.

### 1.2 Purpose

The E2E bar counts only runs against the real core. Without this binary nothing could count before the Tauri app and the engine exist on a Mac runner, and the fake core would stay the only thing the UI is tested against.

**Requirements**: ADR-0003 and docs/HARNESS.md › noter-core-harness wire format.

**Principles**: `cpt-noter-principle-core-fakes`

**Delivers**: every M0 and M1 command and story becomes countable by the E2E gate through this binary (22 commands and 3 stories in M0; the M1 set once its features land). It owns no command behaviour.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Test runner (conformance suite, Playwright E2E flows) | Starts the binary, writes request lines, reads result, error, channel and event lines |
| Scripted engine | Replays an engine event script or file-mode output through the engine-client seam |
| Scripted runtime | Replays recorded CLI output through the `LlmRuntime` seam (used from M2) |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-harness`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md) 3.4 (`noter-core-harness`), 4.1 Integration checkpoints, 4.4 Quality approach; `cpt-noter-interface-core-ipc`
- **Harness**: [HARNESS.md](../../HARNESS.md) › noter-core-harness wire format
- **Dependencies**: `cpt-noter-feature-core-contract`, `cpt-noter-feature-core-ipc-host`

## 2. Actor Flows (CDSL)

### Drive the real core over stdio

- [x] `p1` - **ID**: `cpt-noter-flow-core-harness-session`

**Actor**: Test runner

**Success Scenarios**:
- The runner starts `noter-core-harness --fixture world`, sends requests as a given window, receives results, Channel messages after the result of their subscribing command, and broadcast events; closing stdin shuts the core down.

**Error Scenarios**:
- A request line does not parse: an error line with `invalid_input` for that id; the harness keeps running.
- A command is called from a window outside its scope: an error line with `window_not_allowed`, exactly as the IPC host answers.
- The fixture cannot be loaded: the process exits non-zero before reading any request, with the reason on stderr.

**Steps**:
1. [x] - `p1` - Runner starts the binary with `--fixture world`; the `--engine-script` option comes with golden-set replay in M1 (Teamlead decision M1-D3) - `inst-start`
2. [x] - `p1` - Harness runs `cpt-noter-algo-core-harness-boot` - `inst-boot`
3. [x] - `p1` - Runner writes a request line `{ id, window, cmd, args, channel }` - `inst-request`
4. [x] - `p1` - Harness runs `cpt-noter-algo-core-harness-dispatch` for the line - `inst-dispatch`
5. [x] - `p1` - Harness writes `{ id, ok }` or `{ id, error }`; for a subscribing command, then `{ id, message }` lines in `seq` order - `inst-write-result`
6. [x] - `p1` - Harness writes `{ event, payload }` for every event the core emits - `inst-write-events`
7. [x] - `p1` - **IF** stdin reaches its end - `inst-if-eof`
   1. [x] - `p1` - Shut the core down (streams end with `shutdown`), flush, **RETURN** exit code 0 - `inst-return-exit`

## 3. Processes / Business Logic (CDSL)

### Boot the core on a fixture

- [x] `p1` - **ID**: `cpt-noter-algo-core-harness-boot`

**Input**: Command-line options: fixture name, optional engine script, optional fixed clock.

**Output**: A running core composition root, or exit with an error.

**Steps**:
1. [x] - `p1` - Create a fresh temporary data folder (database, App Group stand-in) - `inst-temp-dir`
2. [x] - `p1` - Open the store and run migrations (`cpt-noter-flow-core-storage-open`) - `inst-open-store`
3. [x] - `p1` - **IF** `--fixture world` - `inst-if-fixture`
   1. [x] - `p1` - DB: seed the rows of `contracts/fixtures/world.json` through the storage write path - `inst-seed`
4. [x] - `p1` - Inject the clock (fixed or real), the scripted engine (`cpt-noter-algo-core-harness-scripted-engine`) and the scripted runtime (Backend Teamlead decision D8/H2, 18 Oct 2026: the scripted LLM runtime comes with `cpt-noter-feature-core-llm-gate`, M2) - `inst-inject`
5. [x] - `p1` - Build the `noter-core` composition root exactly as `src-tauri` does, with an event emitter that writes event lines - `inst-build-core`
6. [x] - `p1` - **RETURN** ready; log the start to stderr only - `inst-return-booted`

### Dispatch a request line

- [x] `p1` - **ID**: `cpt-noter-algo-core-harness-dispatch`

**Input**: One request line.

**Output**: One result or error line, and Channel message lines after it for a subscribing command.

**Steps**:
1. [x] - `p1` - Parse the line; a failure **RETURN** an error line with `invalid_input` - `inst-parse-line`
2. [x] - `p1` - Build `CommandCtx` with `Caller::Window { label: window }` and run the same scope check as the IPC host (`cpt-noter-algo-core-ipc-host-scope-check`) - `inst-ctx-scope`
3. [x] - `p1` - **IF** `channel` is true, create a `Sink` that holds messages until the result line is written, then writes `{ id, message }` lines - `inst-channel-sink`
4. [x] - `p1` - API: call the `CoreApi` method named by `cmd` with the parsed arguments - `inst-call`
5. [x] - `p1` - Write the result or error line, then release any held Channel messages in order - `inst-write-ordered`
6. [x] - `p1` - **RETURN** - `inst-return-dispatch`

### Scripted engine

> Delivered by `ScriptedEngine` in `crates/noter-engine-client` (engine lane, #67); the harness injects it in `inst-inject` above. The steps below are ticked in the engine lane's change, not in this core-lane PR.

- [x] `p1` - **ID**: `cpt-noter-algo-core-harness-scripted-engine`

**Input**: An engine script: timed `EngineEventLine`s, or a recording of the engine's file mode over golden-set audio.

**Output**: The same events the supervisor would read from a live engine, answered commands acknowledged.

**Built-in archive behavior** (implemented in this change for issue #681): when no explicit `offline_pass` script overrides the built-in answer, a call whose audio directory contains audio must return that call's live segments as its scripted archive result. The real core installs that result through its normal archive path. If the directory contains no audio, the built-in answer must fail the archive pass. A two-segment live transcript is a regression scenario, not a fixed segment count for every call. This scripts the engine seam; it does not perform speech recognition.

**Steps**:
1. [x] - `p1` - Answer `ready` with the current `ENGINE_PROTOCOL_VERSION` - `inst-ready`
2. [x] - `p1` - **FOR EACH** command the supervisor sends - `inst-for-commands`
   1. [x] - `p1` - Write `ack` (or the scripted `error`) with the command id - `inst-ack-command`
   2. [x] - `p1` - Start the script section bound to that command (for example `start_session` → `session_started`, segments, levels) on the injected clock - `inst-start-section`
3. [x] - `p1` - **RETURN** when the script ends or `shutdown` arrives - `inst-return-engine`

## 4. States (CDSL)

### Harness process

- [x] `p1` - **ID**: `cpt-noter-state-core-harness-process`

**States**: booting, serving, shutting_down, exited

**Initial State**: booting

**Transitions**:
1. [x] - `p1` - **FROM** booting **TO** serving **WHEN** the fixture is loaded and the core is built - `inst-st-serving`
2. [x] - `p1` - **FROM** booting **TO** exited **WHEN** the fixture or the store fails to load (non-zero exit) - `inst-st-boot-fail`
3. [x] - `p1` - **FROM** serving **TO** shutting_down **WHEN** stdin ends - `inst-st-shutdown`
4. [x] - `p1` - **FROM** shutting_down **TO** exited **WHEN** every stream ended and output is flushed - `inst-st-exited`

## 5. Definitions of Done

### Wire format

- [x] `p1` - **ID**: `cpt-noter-dod-core-harness-wire`

The system **MUST** speak exactly the request, result, error, channel-message and event lines of docs/HARNESS.md, apply the `window` field as the IPC host applies a window label, write Channel messages only after the result of their subscribing command, and write nothing but protocol lines to stdout (logs go to stderr).

**Implements**:
- `cpt-noter-flow-core-harness-session`
- `cpt-noter-algo-core-harness-dispatch`
- `cpt-noter-state-core-harness-process`

**Constraints**: `cpt-noter-constraint-core-small-team`

**Touches**:
- API: every command the real core answers
- Entities: harness lines

### Fixture world and seams

- [x] `p1` - **ID**: `cpt-noter-dod-core-harness-fixture`

The system **MUST** load `contracts/fixtures/world.json` into a fresh database with `--fixture world`, inject a fixed clock on request, and replace the engine and the runtime with scripted ones behind the same seams the app uses; it is never shipped in the app bundle.

The scripted native services must match the host contracts used by the core: calendar range reads include events overlapping the requested interval, nearby-event lookup returns the seeded event and attendees, and local-time formatting uses a configurable UTC offset. Permission requests, login-item changes and updater installation must be able to return a configured typed failure so tests can verify recovery in the core rather than the fake's own success result.

The scripted runtime arrives with the LLM runtime in M2 (decision D8); in M0 the harness scripts the engine.

**Implements**:
- `cpt-noter-algo-core-harness-boot`
- `cpt-noter-algo-core-harness-scripted-engine`

**Touches**:
- DB: every table the fixture world seeds
- Entities: fixture world

### Conformance and E2E against the real core

- [x] `p1` - **ID**: `cpt-noter-dod-core-harness-conformance`

The system **MUST** let the conformance suite (`NOTER_CORE=stdio`) and the Playwright flows run against the harness for every M0 command, so that the E2E gate counts them; the CI step that builds the binary and sets `NOTER_CORE_CMD` is the owner's (DevOps), this feature only provides the binary and its contract. Kept-audio calls are seeded with engine-named M4A channel files and a timeline; scripted stops write and report equivalent files. Delete, discard and export assertions verify physical file outcomes.

**Implements**:
- `cpt-noter-flow-core-harness-session`

**Touches**:
- API: the 22 M0 commands

## 6. Acceptance Criteria

- [x] `cargo run -p noter-core-harness -- --fixture world` answers `app_snapshot` from the `main` window and refuses a settings-only command from the `call-screen` window with `window_not_allowed`.
- [x] A subscribing command's Channel messages always follow its result line, in `seq` order.
- [x] Closing stdin ends every open stream with `shutdown` and exits with code 0; stdout holds only protocol lines.
- [x] The conformance suite passes with `NOTER_CORE=stdio` for every M0 command.
- [x] `just gate` passes.

**Additional archive regression criteria** (issue #681; not included in the checked M0 criteria above):

- With no explicit `offline_pass` script, a stopped call with audio and two live segments gets an archive result containing those two segments; the real core installs them and reports archive success.
- With no explicit `offline_pass` script and no audio in the call's audio directory, the archive pass fails rather than reporting a successful upgrade.

**Verification in this change**: unit tests in `crates/noter-engine-client/tests/offline.rs` cover the built-in success and no-audio answers; real-core tests in `crates/noter-core/tests/postcall_archive.rs` cover installation and failure; conformance coverage in `apps/desktop/tests/conformance/m2-stories-postcall.test.ts` uses no explicit offline script. The call-page review outputs DESIGN story runs against the real core. These additional criteria remain unchecked until `just gate` passes.

**Additional native-parity regression criteria** (issue #681; not included in the checked M0 criteria above):

- Calendar range reads return events overlapping the requested interval, including an event that starts before the interval; nearby-event lookup returns the matching seeded event and attendees; configured UTC offsets affect local-time text.
- A configured `harness.native_fail` operation produces its typed error for permission requests, login-item changes and updater installation, and the real core remains available to answer the next request.
- These criteria are tested through the real core harness and remain unchecked until `just gate` passes.

**Change log**: 0.4 (2026-11-14) records release feature-gating for fixtures/export tooling and scripted native parity/failure seams. Version 0.3 specifies built-in archive behavior and regression criteria; implementation and focused regressions are in that change, with the definition-of-done gate still outstanding. Version 0.2 records fixture audio seeding and physical recordings on scripted stop.
