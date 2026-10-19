---
title: "Feature: noter-core-harness and real-core conformance"
description: "A test binary that runs the real CoreApi without Tauri over JSON Lines, with a fixture database, a scripted engine and a scripted runtime, so the conformance suite and the UI E2E flows count against the real core from M0."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M0
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: noter-core-harness and real-core conformance

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

- [ ] `p1` - **ID**: `cpt-noter-featstatus-core-harness`

- [ ] `p1` - `cpt-noter-feature-core-harness`

## 1. Feature Context

### 1.1 Overview

`crates/noter-core-harness` is a small, unshipped binary. It builds the same `noter-core` composition root the app uses, without Tauri, on a fresh database seeded from `contracts/fixtures/world.json`, with a scripted engine and a scripted runtime behind the real seams. It speaks the JSON Lines wire format of docs/HARNESS.md on stdin and stdout. The conformance suite and the Playwright flows reach it through `apps/desktop/tests/support/stdio-transport.ts`.

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

The scripted runtime arrives with the LLM runtime in M2 (decision D8); in M0 the harness scripts the engine.

**Implements**:
- `cpt-noter-algo-core-harness-boot`
- `cpt-noter-algo-core-harness-scripted-engine`

**Touches**:
- DB: every table the fixture world seeds
- Entities: fixture world

### Conformance and E2E against the real core

- [ ] `p1` - **ID**: `cpt-noter-dod-core-harness-conformance`

The system **MUST** let the conformance suite (`NOTER_CORE=stdio`) and the Playwright flows run against the harness for every M0 command, so that the E2E gate counts them; the CI step that builds the binary and sets `NOTER_CORE_CMD` is the owner's (DevOps), this feature only provides the binary and its contract.

**Implements**:
- `cpt-noter-flow-core-harness-session`

**Touches**:
- API: the 22 M0 commands

## 6. Acceptance Criteria

- [ ] `cargo run -p noter-core-harness -- --fixture world` answers `app_snapshot` from the `main` window and refuses a settings-only command from the `call-screen` window with `window_not_allowed`.
- [ ] A subscribing command's Channel messages always follow its result line, in `seq` order.
- [ ] Closing stdin ends every open stream with `shutdown` and exits with code 0; stdout holds only protocol lines.
- [ ] The conformance suite passes with `NOTER_CORE=stdio` for every M0 command.
- [ ] `just gate` passes.
