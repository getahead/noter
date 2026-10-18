---
title: "Decomposition: Noter Core (backend)"
description: "The backend features of DESIGN-core: Rust core, Swift engine, noter-mcp, contract crate and noter-core-harness, with milestones from harness/milestones.toml, lanes, dependencies and full coverage of the design's elements."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
design: docs/DESIGN-core.md
prd: docs/PRD.md
milestones: harness/milestones.toml
---

# Decomposition: Noter Core (backend)

<!-- toc -->

- [1. Overview](#1-overview)
- [2. Entries](#2-entries)
  - [2.1 Contract crate and conformance - HIGH](#21-contract-crate-and-conformance---high)
  - [2.2 Storage and the change-log write path - HIGH](#22-storage-and-the-change-log-write-path---high)
  - [2.3 IPC host, app snapshot and stream hub - HIGH](#23-ipc-host-app-snapshot-and-stream-hub---high)
  - [2.4 noter-core-harness and real-core conformance - HIGH](#24-noter-core-harness-and-real-core-conformance---high)
  - [2.5 Settings, hotkeys and glossary - HIGH](#25-settings-hotkeys-and-glossary---high)
  - [2.6 Engine sidecar and supervisor foundation - HIGH](#26-engine-sidecar-and-supervisor-foundation---high)
  - [2.7 First run, permissions and environment - HIGH](#27-first-run-permissions-and-environment---high)
  - [2.8 Engine capture, live ASR and capture-first restart - HIGH](#28-engine-capture-live-asr-and-capture-first-restart---high)
  - [2.9 Capture session manager - HIGH](#29-capture-session-manager---high)
  - [2.10 Live transcript, levels and replay - HIGH](#210-live-transcript-levels-and-replay---high)
  - [2.11 Native surfaces: panels, menu bar, notifications and windows - HIGH](#211-native-surfaces-panels-menu-bar-notifications-and-windows---high)
  - [2.12 Library call list and call records - HIGH](#212-library-call-list-and-call-records---high)
  - [2.13 Speaker naming, term fixes and audio deletion - MEDIUM](#213-speaker-naming-term-fixes-and-audio-deletion---medium)
  - [2.14 Engine offline pass and embeddings - MEDIUM](#214-engine-offline-pass-and-embeddings---medium)
  - [2.15 LLM router, egress gate and audit - MEDIUM](#215-llm-router-egress-gate-and-audit---medium)
  - [2.16 Job scheduler and pipeline jobs - MEDIUM](#216-job-scheduler-and-pipeline-jobs---medium)
  - [2.17 Post-call pipeline and outputs - MEDIUM](#217-post-call-pipeline-and-outputs---medium)
  - [2.18 Items, Today, sharing and export - MEDIUM](#218-items-today-sharing-and-export---medium)
  - [2.19 Handoff launcher and repositories - MEDIUM](#219-handoff-launcher-and-repositories---medium)
  - [2.20 History, undo and redo - MEDIUM](#220-history-undo-and-redo---medium)
  - [2.21 Native services: launch, clipboard, panels and share test - MEDIUM](#221-native-services-launch-clipboard-panels-and-share-test---medium)
  - [2.22 Retrieval, search, Ask and topics - MEDIUM](#222-retrieval-search-ask-and-topics---medium)
  - [2.23 People, identity and voice profiles - MEDIUM](#223-people-identity-and-voice-profiles---medium)
  - [2.24 Knowledge sources - MEDIUM](#224-knowledge-sources---medium)
  - [2.25 Credentials, own accounts and the Privacy pane - MEDIUM](#225-credentials-own-accounts-and-the-privacy-pane---medium)
  - [2.26 noter-mcp and the core socket - MEDIUM](#226-noter-mcp-and-the-core-socket---medium)
  - [2.27 Agents and council configuration - LOW](#227-agents-and-council-configuration---low)
  - [2.28 Copilot loop and cards - LOW](#228-copilot-loop-and-cards---low)
  - [2.29 Maintenance jobs, retention and recovery - LOW](#229-maintenance-jobs-retention-and-recovery---low)
  - [2.30 Evidence, proposals and Activity - LOW](#230-evidence-proposals-and-activity---low)
  - [2.31 Metrics and Performance - LOW](#231-metrics-and-performance---low)
- [3. Feature Dependencies](#3-feature-dependencies)

<!-- /toc -->

## 1. Overview

This decomposition breaks `docs/DESIGN-core.md` (v0.4) into backend features: the Rust core, the Swift engine sidecar, noter-mcp, the contract crate and the test binary `noter-core-harness`. The UI design (`docs/DESIGN.md`) has its own decomposition; the two meet at the contract (`cpt-noter-interface-core-ipc`) and at the DESIGN.md stories, which this document assigns to the backend feature that makes them work against the real core.

**How it was cut.**

- **By milestone first.** Every IPC command and every DESIGN.md story belongs to exactly one feature, and that feature sits in the milestone `harness/milestones.toml` gives the command or story. The E2E gate counts what each milestone delivers, so a feature never spans two milestones. Where PRD › Roadmap and milestones and `milestones.toml` disagree, `milestones.toml` wins and the difference is listed below.
- **Then by component and lane.** Inside a milestone a feature groups one component (or two that cannot be built apart, such as the IPC host and the stream hub) and stays in one lane of `docs/HARNESS.md` where it can. Features that touch both `apps/desktop/src-tauri` (core lane) and `noter-native` (engine lane) say so; they land as two pull requests.
- **Not too small.** A feature is a few weeks of work for one builder with agents, not a task. Every feature, M0 to M5, has a FEATURE spec under `docs/features/core/`; the M2 to M5 specs are revisited before their milestone starts.

**Status words.** NOT_STARTED: nothing of the feature exists. IN_PROGRESS: part of it exists on `main`. A feature's checkbox is checked only when all its FEATURE items are implemented and `just gate` passes (traceability FULL: a checked flow, algorithm, state or definition of done needs its `@cpt-*` markers in code).

**Milestones at a glance.**

| Milestone | Features | Commands | DESIGN.md stories | FEATURE specs |
| --- | --- | --- | --- | --- |
| M0 | 7 | 22 | 3 | written |
| M1 | 5 | 36 | 13 | written |
| M2 | 9 | 41 | 10 | written |
| M3 | 5 | 39 | 13 | written |
| M4 | 2 | 23 | 6 | written |
| M5 | 3 | 11 | 4 | written |
| Total | 31 | 172 | 49 | 31 written |

**Coverage of DESIGN-core.** Every element is assigned to at least one feature: principles 7 of 7, constraints 8 of 8, components 24 of 24, interfaces 5 of 5, sequences 10 of 10, the database (`cpt-noter-db-core-library`) and dbtables 28 of 28, plus the deployment topology. All 172 commands of `contracts/ipc.manifest.json` and all 49 stories of `harness/milestones.toml` are placed once.

**Shared elements, on purpose.** A few elements belong to more than one feature because they are built in stages, one per milestone:

- The engine and its supervisor (`cpt-noter-component-engine`, `cpt-noter-component-core-engine-supervisor`, `cpt-noter-interface-engine-stdio`): foundation in M0, capture and live ASR in M1, offline pass and embeddings in M2.
- Native macOS (`cpt-noter-component-core-native`): permissions, environment, login item and updates in M0; panels, menu bar, notifications and windows in M1; launch, clipboard, save panels and the screen-share test in M2.
- The transcript (`cpt-noter-component-core-transcript`): live persistence, streams and replay in M1; corrections in M2.
- The change log (`cpt-noter-component-core-changelog`): the write path in M0, undo, redo and History in M2, proposals in M5. Storage (`cpt-noter-component-core-storage`): writer and migrations in M0, backups, integrity and recovery in M5. Jobs (`cpt-noter-component-core-jobs`): scheduler and pipeline jobs in M2, maintenance and evidence in M5.
- Keys and runtime availability (`cpt-noter-flow-core-credentials-privacy-keys`, `cpt-noter-algo-core-credentials-privacy-availability`, `cpt-noter-state-core-credentials-privacy-key`): `accounts_get` and `api_key_set` (steps 1 to 5 of the flow, the availability algorithm, the key state except removal) in M2 with the LLM gate; `api_key_remove` and the rest in M3 with credentials (discrepancy 1).
- Two sequences are split at a seam: `cpt-noter-seq-core-call-end-outputs` (the stop half in M1, the outputs half in M2) and `cpt-noter-seq-core-live-tick` (the transcript half in M1, the tick half in M4).
- Interfaces are declared once by the contract feature and implemented elsewhere: `cpt-noter-interface-core-ipc` is served by the IPC host and run over stdio by the harness; `cpt-noter-interface-engine-stdio` is spoken by the three engine features; `cpt-noter-interface-skill-outputs` is validated by the LLM router and the post-call pipeline.

**Discrepancies found** between DESIGN-core, PRD › Roadmap and milestones and `harness/milestones.toml`. This decomposition follows `milestones.toml` in each case; none needs a contract change.

1. **Model runtime credentials come after the first model runs.** Post-call outputs (M2) need an LLM runtime, but `api_key_set`, `accounts_get` and `cli_install` are placed in M3. **Decided by the owner (18 Oct): moved to M2.** `accounts_get` and `api_key_set` are delivered with `cpt-noter-feature-core-llm-gate`, so the M2 post-call runtime can be configured from the app; `cli_install`, key removal and own accounts stay in M3 with `cpt-noter-feature-core-credentials-privacy`. The E2E flows still use the scripted runtime.
2. **Model download is a job in DESIGN-core, but the scheduler comes later.** DESIGN-core lists model download among the pipeline jobs of `noter-jobs`; `models_download` is M0, the scheduler arrives with post-call in M2 and the Jobs commands in M5. M0 runs the download as a setup task; M2 moves it onto the scheduler without changing the contract. **Confirmed by the owner (18 Oct).**
3. **First run needs commands placed in M1.** DESIGN-core allows `levels_subscribe` from the first-run and Settings windows and first run opens System Settings panes and leaves to the main window, but `levels_subscribe`, `open_external` and `window_navigate` are M1. In M0 the first-run levels come from the self-test Channel; QA should not count those three commands in M0. **Confirmed by the owner (18 Oct).**
4. **Calendar.** PRD › Roadmap lists "calendar" under v1.x, while DESIGN-core reads EventKit in v1 (new-meeting detection and Today) and `milestones.toml` places the Calendar permission in M0 and `today_get` in M2. This decomposition reads the PRD's v1.x calendar as the calendar integration as a knowledge source and keeps EventKit reads in v1 (M1 detection, M2 Today). **Confirmed by the owner (18 Oct).**
5. **Two "week one" tests.** PRD › Roadmap makes week one of M0 a throwaway Swift spike (sandbox attribution Q4, streaming policy); DESIGN-core Q7 names "the M1 week-one test (engine kills during capture)". Both are kept: the Q4 spike in `cpt-noter-feature-core-engine-foundation` (M0), the Q7 drill in `cpt-noter-feature-core-engine-capture` (M1). **Confirmed by the owner (18 Oct).**
6. **Footprint and dropout metrics.** DESIGN-core samples memory, CPU and thermal state every 10 s during capture into `metrics` and stores `dropout_ms` there, and `harness/perf.toml` has `call-memory-footprint` in M1; the Metrics component, the `metrics` table and the Performance commands are M5. In M1 footprint is measured by the harness scenario and gaps are stored in `gaps`; in-app sampling and roll-ups arrive with `cpt-noter-feature-core-metrics-performance`.
7. **Audit visible one milestone late.** The egress gate writes `audit_log` from the first cloud run (M2), while `audit_list` and `audit_export` are M3, so for one milestone the audit exists but the Privacy pane cannot show it.
8. **Summary notifications.** `cpt-noter-seq-notifications-allow-notifications` is M1, but the summary it is about arrives with post-call outputs in M2. M1 delivers the authorization path and NT-3; the "Summary ready" notification itself is M2.
9. **Assistants step of first run.** `SetupStep::Assistants` exists in the M0 setup status, but connecting an assistant (`cpt-noter-seq-first-run-connect-assistant`) is M3. In M0 the step can only be skipped. **Confirmed by the owner (18 Oct).**
10. **Lanes.** DESIGN-core puts the native component in `apps/desktop/src-tauri` and `noter-native`, which `docs/HARNESS.md` assigns to different lanes (core and engine). Features that touch both are marked and land as two pull requests. **Confirmed by the owner (18 Oct).**

## 2. Entries

**Overall implementation status:**

- [ ] `p1` - **ID**: `cpt-noter-status-core-overall`

### 2.1 [Contract crate and conformance](features/core/core-contract.md) - HIGH

- [ ] `p1` - **ID**: `cpt-noter-feature-core-contract`

- **Milestone**: M0 · **Lane**: contract · **Status**: IN_PROGRESS: the crate, the generated files and the fake core exist; M0 adds what the real core needs from them. FEATURE spec: [features/core/core-contract.md](features/core/core-contract.md)

- **Purpose**: Keep `noter-protocol` the single source of every boundary while the real core starts to answer it: `CoreApi` and `CommandCtx` fit the IPC host, the contract tests cover what the core relies on, and the conformance suite can run against the fake and the real core.

- **Depends On**: None

- **Scope**:
  - `CoreApi`, `CommandCtx`, `Caller` and `Sink` as the core and the IPC host consume them
  - Contract tests: names, stability per name, window scopes, `#[serde(default)]` on optional argument fields, error list, fixture round trip
  - Engine protocol types, noter-mcp tool and socket types, skill output schemas and the egress allow-list as declarations
  - Conformance assertions that the fake and the real core share (window scope, typed errors, snapshot then stream, revisions)

- **Out of scope**:
  - Behaviour behind any command (each owning feature)
  - UI bindings consumers and screens (UI DECOMPOSITION)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - Owner request for UI-first development (17 Oct)
  - PRD › Repository layout › Engine protocol

- **Design Principles Covered**:

  - [ ] `p1` - `cpt-noter-principle-core-contract-first`

- **Design Constraints Covered**:

  - [ ] `p1` - `cpt-noter-constraint-core-contract-tooling`

- **Domain Model Entities**:
  - CoreError and ErrorCode
  - every view model and argument type (declarations only)

- **Design Components**:

  - [ ] `p1` - `cpt-noter-component-core-protocol`

- **API**:
  - Interface `cpt-noter-interface-core-ipc`
  - Interface `cpt-noter-interface-engine-stdio`
  - Interface `cpt-noter-interface-skill-outputs`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - None

- **Data**:

  - None

### 2.2 [Storage and the change-log write path](features/core/core-storage.md) - HIGH

- [ ] `p1` - **ID**: `cpt-noter-feature-core-storage`

- **Milestone**: M0 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-storage.md](features/core/core-storage.md)

- **Purpose**: Give the core one SQLite file with one writer, numbered migrations and a write API that commits every mutation together with its change-log row, so every later feature writes through the same door.

- **Depends On**: `cpt-noter-feature-core-contract`

- **Scope**:
  - Crate `noter-db`: writer task, read-only pool, WAL and pragmas, numbered migrations
  - Change-log write API: a mutation and its `changes` row in one transaction, batches with `batch_id`
  - Migration framework each later feature adds its own tables to; FTS5 and sqlite-vec loaded and smoke-tested
  - `rev` and `version` counters as the storage layer hands them out

- **Out of scope**:
  - Undo, redo, History and export (`cpt-noter-feature-core-history-undo`, M2)
  - Proposals (`cpt-noter-feature-core-evidence-proposals`, M5)
  - Backups, integrity checks and recovery (`cpt-noter-feature-core-maintenance`, M5)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Data model and storage
  - PRD › Feature specification › 11. History and change log

- **Design Principles Covered**:

  - [ ] `p1` - `cpt-noter-principle-core-single-writer`

- **Design Constraints Covered**:

  - [ ] `p1` - `cpt-noter-constraint-core-local-data`

- **Domain Model Entities**:
  - Change

- **Design Components**:

  - [ ] `p1` - `cpt-noter-component-core-storage`
  - [ ] `p1` - `cpt-noter-component-core-changelog`

- **API**:
  - None

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - None

- **Data**:

  - [ ] `p1` - `cpt-noter-db-core-library`
  - `cpt-noter-dbtable-changes`

### 2.3 [IPC host, app snapshot and stream hub](features/core/core-ipc-host.md) - HIGH

- [ ] `p1` - **ID**: `cpt-noter-feature-core-ipc-host`

- **Milestone**: M0 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-ipc-host.md](features/core/core-ipc-host.md)

- **Purpose**: Open the one typed door between the windows and the core: scoped commands, typed errors, whole-state events with versions, and Channels that start after a snapshot, are acknowledged and survive a reload.

- **Depends On**: `cpt-noter-feature-core-contract`, `cpt-noter-feature-core-storage`

- **Scope**:
  - `apps/desktop/src-tauri`: one handler per `COMMANDS` entry, `CommandCtx` with `Caller`, scope check, capabilities generated in `build.rs`, handler parity test
  - `noter-core` composition root implementing `CoreApi` (other features add services to it)
  - Stream hub: sequence counters, replay buffers, subscriptions, `stream_ack`, `lagged`, webview reload and destroy
  - App snapshot, banners and degraded set as whole-state payloads with versions; UI log without transcript text

- **Out of scope**:
  - The content of each stream (transcript, levels, cards, Ask: their features)
  - Native menu, hotkey and notification callers (`cpt-noter-feature-core-native-surfaces`)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - DESIGN.md › Core bridge and Window store
  - DESIGN.md › Core owns the state

- **Design Principles Covered**:

  - [ ] `p1` - `cpt-noter-principle-core-snapshot-stream`
  - [ ] `p1` - `cpt-noter-principle-core-intent-commands`

- **Design Constraints Covered**:

  - [ ] `p1` - `cpt-noter-constraint-core-stack`

- **Domain Model Entities**:
  - AppSnapshot
  - BannerSet
  - DegradedSet

- **Design Components**:

  - [ ] `p1` - `cpt-noter-component-core-ipc-host`
  - [ ] `p1` - `cpt-noter-component-core-stream-hub`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `app_snapshot`, `stream_unsubscribe`, `stream_ack`, `banner_dismiss`, `log_ui`
  - Events: `banners:changed`, `degraded:changed`, `entity:changed`
  - Interface `cpt-noter-interface-core-ipc`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-core-window-open`

- **Data**:

  - None

### 2.4 [noter-core-harness and real-core conformance](features/core/core-harness.md) - HIGH

- [ ] `p1` - **ID**: `cpt-noter-feature-core-harness`

- **Milestone**: M0 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-harness.md](features/core/core-harness.md)

- **Purpose**: Run the real `CoreApi` without Tauri over JSON Lines, with a fixture database, a scripted engine and a scripted runtime, so the conformance suite and the UI E2E flows can count against the real core from M0.

- **Depends On**: `cpt-noter-feature-core-contract`, `cpt-noter-feature-core-ipc-host`

- **Scope**:
  - Test binary `crates/noter-core-harness` and its wire format (docs/HARNESS.md)
  - `--fixture world` loading `contracts/fixtures/world.json` into a fresh database
  - Scripted engine (file mode replay) and scripted runtime seams
  - E2E command log for the coverage gate; logs to stderr only

- **Out of scope**:
  - The conformance suite and the stdio transport in `apps/desktop/tests` (UI and contract lanes)
  - CI wiring (DevOps)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - ADR-0003 harness and quality gates

- **Design Principles Covered**:

  - [ ] `p1` - `cpt-noter-principle-core-fakes`

- **Design Constraints Covered**:

  - [ ] `p1` - `cpt-noter-constraint-core-small-team`

- **Domain Model Entities**:
  - Harness request, result, error, channel message and event lines

- **Design Components**:

  - None of its own (see Purpose)

- **API**:
  - Interface `cpt-noter-interface-core-ipc`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - None

- **Data**:

  - None

### 2.5 [Settings, hotkeys and glossary](features/core/core-settings.md) - HIGH

- [ ] `p1` - **ID**: `cpt-noter-feature-core-settings`

- **Milestone**: M0 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-settings.md](features/core/core-settings.md)

- **Purpose**: Own the typed settings every component reads: sections with defaults and a revision, global hotkeys with conflict detection, ignored apps and the glossary, written from two windows without losing an edit.

- **Depends On**: `cpt-noter-feature-core-storage`, `cpt-noter-feature-core-ipc-host`

- **Scope**:
  - Settings sections with defaults, migrations and `rev`; replace one section per call
  - Hotkeys: list, set, reset, conflict and reserved detection, registration at launch through the Tauri global-shortcut plugin
  - Card keys stored as one setting (registered later by the copilot)
  - Glossary with `rev`; ignored apps

- **Out of scope**:
  - Repositories (`cpt-noter-feature-core-handoff`, M2)
  - Retention runs (`cpt-noter-feature-core-maintenance`, M5)
  - Credentials (`cpt-noter-feature-core-credentials-privacy`, M3)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 14. Settings

- **Design Principles Covered**:

  - [ ] `p1` - `cpt-noter-principle-core-intent-commands`

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - Settings
  - HotkeyList
  - GlossaryList

- **Design Components**:

  - [ ] `p1` - `cpt-noter-component-core-settings`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `settings_get`, `settings_update`, `settings_unignore_app`, `hotkeys_list`, `hotkey_set`, `hotkeys_reset`, `glossary_list`, `glossary_upsert`, `glossary_remove`
  - Events: `settings:changed`, `hotkeys:changed`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-settings-set-hotkeys`

- **Data**:

  - `cpt-noter-dbtable-settings`

### 2.6 [Engine sidecar and supervisor foundation](features/core/core-engine-foundation.md) - HIGH

- [ ] `p1` - **ID**: `cpt-noter-feature-core-engine-foundation`

- **Milestone**: M0 · **Lane**: engine · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-engine-foundation.md](features/core/core-engine-foundation.md)

- **Purpose**: Stand up the sandboxed Swift engine and its Rust supervisor: spawn, handshake, liveness, the self-test, detection on and off, file mode and restart, with the signing and entitlement checks that keep the engine offline.

- **Depends On**: `cpt-noter-feature-core-contract`

- **Scope**:
  - Swift package `engine/` with the protocol codec generated from `contracts/engine.schema.json`
  - `ready`, `ping`, `shutdown`, `self_test` with its stream, line and result events, `set_detection`, file mode
  - Crate `noter-engine-client`: spawn with `tokio::process`, version check, `seq` gap detection, ack and error correlation, restart
  - App Group container layout and relative paths; signing and entitlements checks (engine without network)
  - Week-one spike results (sandbox attribution Q4, streaming policy) recorded in the FEATURE

- **Out of scope**:
  - Capture, ASR and diarization (`cpt-noter-feature-core-engine-capture`, M1)
  - Offline pass and embeddings (`cpt-noter-feature-core-engine-offline`, M2)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Audio capture on macOS
  - PRD › Repository layout › Engine protocol

- **Design Principles Covered**:

  - [ ] `p1` - `cpt-noter-principle-core-fakes`

- **Design Constraints Covered**:

  - [ ] `p1` - `cpt-noter-constraint-core-macos`
  - [ ] `p1` - `cpt-noter-constraint-core-engine-offline`

- **Domain Model Entities**:
  - EngineCommandLine
  - EngineEventLine

- **Design Components**:

  - [ ] `p1` - `cpt-noter-component-engine`
  - [ ] `p1` - `cpt-noter-component-core-engine-supervisor`

- **API**:
  - Interface `cpt-noter-interface-engine-stdio`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - None

- **Data**:

  - [ ] `p1` - `cpt-noter-topology-core-processes`

### 2.7 [First run, permissions and environment](features/core/core-first-run.md) - HIGH

- [ ] `p1` - **ID**: `cpt-noter-feature-core-first-run`

- **Milestone**: M0 · **Lane**: core (src-tauri) and engine (noter-native) · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-first-run.md](features/core/core-first-run.md)

- **Purpose**: Make first run real: setup status, resumable model downloads with checksums, permission requests at the step that needs them, the self-test stream, the call display and audio storage choices, the environment state, launch at login and update install. None of it ever gates a start (owner decision O1).

- **Depends On**: `cpt-noter-feature-core-settings`, `cpt-noter-feature-core-engine-foundation`, `cpt-noter-feature-core-ipc-host`

- **Scope**:
  - Setup status and steps; `setup:changed`
  - Model download task with pause, resume, retry and checksum
  - Permission requests through `noter-native` (microphone, system audio inferred, calendar, notifications, screen recording, automation)
  - Self-test orchestration over the engine with a Channel
  - Environment state (`env:changed`), launch at login (SMAppService), update install

- **Out of scope**:
  - Capture itself (`cpt-noter-feature-core-capture-session`, M1)
  - Notification posting and panels (`cpt-noter-feature-core-native-surfaces`, M1)
  - Own accounts and CLI install (M3)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 14. Settings (first run)
  - PRD › Security, privacy and permissions

- **Design Principles Covered**:

  - [ ] `p1` - `cpt-noter-principle-core-degrade`

- **Design Constraints Covered**:

  - [ ] `p1` - `cpt-noter-constraint-core-macos`

- **Domain Model Entities**:
  - SetupStatus
  - PermissionRow
  - EnvironmentState

- **Design Components**:

  - [ ] `p1` - `cpt-noter-component-core-native`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `setup_status`, `models_download`, `permission_request`, `self_test_run`, `setup_set_call_display`, `setup_set_audio_storage`, `setup_set_step`, `update_install`
  - Events: `setup:changed`, `env:changed`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-first-run-complete-setup`
  - `cpt-noter-seq-first-run-download-models`

- **Data**:

  - None

### 2.8 [Engine capture, live ASR and capture-first restart](features/core/core-engine-capture.md) - HIGH

- [ ] `p2` - **ID**: `cpt-noter-feature-core-engine-capture`

- **Milestone**: M1 · **Lane**: engine · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-engine-capture.md](features/core/core-engine-capture.md)

- **Purpose**: Record both channels on one clock into a crash-safe ring, transcribe them live, report the facts the session manager needs, play replay audio, and come back after a crash with at most a 2 s gap.

- **Depends On**: `cpt-noter-feature-core-engine-foundation`

- **Scope**:
  - Global tap (excluding the engine and app PIDs) and microphone; capture ring as a memory-mapped file; AAC writers
  - VAD, per-utterance language ID, streaming decode on WhisperKit, hallucination and term filters, live diarization labels
  - Call detection listeners and the facts `call_detected`, `call_audio_released`, `audio_source_added`, `silence`, `device_changed`, `system_audio_silent`
  - Replay (`play`, `stop_playback`, `playback_position`)
  - Supervisor: capture-first restart with `resume_from_ms`, `CaptureFailed`, `transcription_stalled` and `system_audio_silent` degraded states

- **Out of scope**:
  - Offline pass, speaker and text embeddings (M2)
  - Persisting segments and notices (core features)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Audio capture on macOS
  - PRD › Transcription pipeline
  - PRD › Success metrics › Capture (release blocker), Live

- **Design Principles Covered**:

  - [ ] `p2` - `cpt-noter-principle-core-degrade`

- **Design Constraints Covered**:

  - [ ] `p2` - `cpt-noter-constraint-core-macos`
  - [ ] `p2` - `cpt-noter-constraint-core-engine-offline`

- **Domain Model Entities**:
  - Engine session
  - EngineSegment

- **Design Components**:

  - [ ] `p2` - `cpt-noter-component-engine`
  - [ ] `p2` - `cpt-noter-component-core-engine-supervisor`

- **API**:
  - Interface `cpt-noter-interface-engine-stdio`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - None

- **Data**:

  - None

### 2.9 [Capture session manager](features/core/core-capture-session.md) - HIGH

- [ ] `p2` - **ID**: `cpt-noter-feature-core-capture-session`

- **Milestone**: M1 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-capture-session.md](features/core/core-capture-session.md)

- **Purpose**: Own the capture state machine every surface drives the same way: detection and the record prompt, start, pause, stop, notices and their timers, Continue Recording, resume after a quit or crash, the back-to-back split, the sensitive flag and when notifications go out.

- **Depends On**: `cpt-noter-feature-core-engine-capture`, `cpt-noter-feature-core-first-run`, `cpt-noter-feature-core-settings`

- **Scope**:
  - `CaptureState`, `CallDetection` and every capture transition of DESIGN-core 3.1
  - Notices with timers: record prompt, call ended and hold, call seems ended, new meeting, nothing heard, second source
  - Call rows, marks and gaps; `capture:state`, `capture:detected`, capture rows of `degraded:changed`, the interrupted-recording banner
  - Notification hold and release rules (delivery is native)
  - Hand-off of a stopped call to the post-call queue once it exists (M2)

- **Out of scope**:
  - Post-call outputs (M2)
  - Copilot loop start (M4; behind the flag)
  - Panels and menu bar drawing (`cpt-noter-feature-core-native-surfaces`)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 1. Capture
  - PRD › Success metrics › Capture (release blocker)

- **Design Principles Covered**:

  - [ ] `p2` - `cpt-noter-principle-core-degrade`
  - [ ] `p2` - `cpt-noter-principle-core-intent-commands`

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - Call
  - CaptureState
  - CallDetection
  - Mark
  - Gap

- **Design Components**:

  - [ ] `p2` - `cpt-noter-component-core-session`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `capture_start`, `capture_stop`, `capture_set_paused`, `capture_mark_moment`, `capture_answer_call_end`, `capture_continue`, `capture_answer_new_meeting`, `capture_discard`, `capture_set_sensitive`, `capture_exclude_source`, `capture_dismiss_detection`, `capture_ignore_app`, `capture_hold_notice`, `capture_keep_recording`, `capture_keep_source`, `capture_resume_interrupted`
  - Events: `capture:state`, `capture:detected`, `degraded:changed`, `banners:changed`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-core-record-detected-call`
  - `cpt-noter-seq-core-call-end-outputs`
  - `cpt-noter-seq-record-prompt-start-recording`
  - `cpt-noter-seq-record-prompt-record-after-missed-prompt`
  - `cpt-noter-seq-call-screen-recover-capture`
  - `cpt-noter-seq-call-screen-stop-at-call-end`
  - `cpt-noter-seq-menu-bar-control-recording`

- **Data**:

  - `cpt-noter-dbtable-calls`
  - `cpt-noter-dbtable-marks`
  - `cpt-noter-dbtable-gaps`

### 2.10 [Live transcript, levels and replay](features/core/core-live-transcript.md) - HIGH

- [ ] `p2` - **ID**: `cpt-noter-feature-core-live-transcript`

- **Milestone**: M1 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-live-transcript.md](features/core/core-live-transcript.md)

- **Purpose**: Persist every confirmed segment exactly once, stream hypotheses and confirmed lines to every window with snapshot-then-stream, serve levels and span previews, and replay a line through the engine only where it cannot leak into the call.

- **Depends On**: `cpt-noter-feature-core-capture-session`, `cpt-noter-feature-core-engine-capture`, `cpt-noter-feature-core-ipc-host`

- **Scope**:
  - Segment ids, batched persistence (at most 250 ms) with normalised shadow text, publish after commit
  - Live speaker rows from engine labels (naming is M2)
  - `transcript_subscribe`, `levels_subscribe`, `transcript_span`
  - Replay decision (headphones only during capture) and `playback:state`
  - `transcript.jsonl` at call end

- **Out of scope**:
  - Speaker renames, term fixes, post-call naming and audio deletion (`cpt-noter-feature-core-speakers-audio`, M2)
  - Archive pass replacement (M2)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 2. Live transcript
  - PRD › Success metrics › Live

- **Design Principles Covered**:

  - [ ] `p2` - `cpt-noter-principle-core-snapshot-stream`

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - Segment
  - Speaker
  - PlaybackState

- **Design Components**:

  - [ ] `p2` - `cpt-noter-component-core-transcript`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `transcript_subscribe`, `levels_subscribe`, `transcript_span`, `audio_play`, `audio_stop`
  - Events: `playback:state`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-core-live-tick`
  - `cpt-noter-seq-call-screen-replay-line`

- **Data**:

  - `cpt-noter-dbtable-segments`
  - `cpt-noter-dbtable-speakers`

### 2.11 [Native surfaces: panels, menu bar, notifications and windows](features/core/core-native-surfaces.md) - HIGH

- [ ] `p2` - **ID**: `cpt-noter-feature-core-native-surfaces`

- **Milestone**: M1 · **Lane**: core (src-tauri) and engine (noter-native) · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-native-surfaces.md](features/core/core-native-surfaces.md)

- **Purpose**: Show the call where the user needs it without stealing focus: non-activating panels, the call window's two layouts across displays, hide for presenting, the menu bar and tray, notifications through `UNUserNotificationCenter`, announcements, navigation and external opens, with menu and hotkey actions calling the core as native callers.

- **Depends On**: `cpt-noter-feature-core-capture-session`, `cpt-noter-feature-core-settings`

- **Scope**:
  - NSPanel conversion (tauri-nspanel pinned), placement by display identity, layout switch on display change
  - Window commands and `window:call`, `app:presenting`, `nav:request`
  - Tray menu and title, menu actions as `Caller::Native`
  - Notifications: authorization, delivery with `threadIdentifier` and `NavTarget`, click to `nav:request`
  - EventKit read for detection matching (Today uses it in M2); accessibility announcements; `open_external`

- **Out of scope**:
  - Screen Share Test, Launch Services handoff and rich clipboard (`cpt-noter-feature-core-native-services`, M2)
  - Card keys (M4)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Live copilot › Surfaces
  - PRD › Live copilot › Surfaces › Menu bar

- **Design Principles Covered**:

  - [ ] `p2` - `cpt-noter-principle-core-degrade`

- **Design Constraints Covered**:

  - [ ] `p2` - `cpt-noter-constraint-core-macos`

- **Domain Model Entities**:
  - CallWindowState
  - PresentingState
  - NavTarget

- **Design Components**:

  - [ ] `p2` - `cpt-noter-component-core-native`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `window_show_call`, `window_hide_call`, `window_call_state`, `window_set_call_layout`, `window_set_collapsed`, `app_set_hidden_for_presenting`, `window_navigate`, `window_announce`, `window_report_view`, `open_external`
  - Events: `window:call`, `app:presenting`, `nav:request`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-call-screen-hide-for-presenting`
  - `cpt-noter-seq-floating-panel-display-unplugged`
  - `cpt-noter-seq-floating-panel-collapse-strip`
  - `cpt-noter-seq-floating-panel-hide-and-reopen`
  - `cpt-noter-seq-menu-bar-check-state`
  - `cpt-noter-seq-notifications-allow-notifications`

- **Data**:

  - None

### 2.12 [Library call list and call records](features/core/core-library-calls.md) - HIGH

- [ ] `p2` - **ID**: `cpt-noter-feature-core-library-calls`

- **Milestone**: M1 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-library-calls.md](features/core/core-library-calls.md)

- **Purpose**: Serve the Library list and the call record: list with filters and sort, the call detail read model, edits with a revision, call types from the built-in list and skill folders, and deleting calls for good with everything recorded in them.

- **Depends On**: `cpt-noter-feature-core-capture-session`, `cpt-noter-feature-core-live-transcript`

- **Scope**:
  - `calls_list` (paged, filtered, sorted), `call_get`, `call_update` with `rev`
  - Call types: built-in list plus user skill folders (Q5)
  - `calls_delete`: rows, files in the App Group container and index rows in one logged, irreversible change
  - `entity:changed` for calls
  - Fixture parity for the M1 read models (fixtures seeded as rows, the fake world generated through the real read models)

- **Out of scope**:
  - Tags (`call_tags_set`, `tags_list`, M2)
  - Search (M3)
  - Outputs on the Call page (M2)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 5. Library and search

- **Design Principles Covered**:

  - [ ] `p2` - `cpt-noter-principle-core-intent-commands`

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - CallRow
  - CallDetail
  - CallTypeInfo

- **Design Components**:

  - None of its own (see Purpose)

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `calls_list`, `call_get`, `call_update`, `call_types_list`, `calls_delete`
  - Events: `entity:changed`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-dialogs-delete-call`

- **Data**:

  - None

### 2.13 Speaker naming, term fixes and audio deletion - MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-core-speakers-audio`

- **Milestone**: M2 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-speakers-audio.md](features/core/core-speakers-audio.md)

- **Purpose**: Let the user correct the transcript through logged changes (rename a speaker for the call or one line, fix a term and teach the glossary, name speakers after the call) and delete audio for good.

- **Depends On**: `cpt-noter-feature-core-live-transcript`, `cpt-noter-feature-core-history-undo`

- **Scope**:
  - Renames, term fixes, post-call naming, must-link and cannot-link constraints
  - Audio deletion now and by age

- **Out of scope**:
  - Voice profiles and person pages (M3)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Diarization and speaker identity

- **Design Principles Covered**:

  - [ ] `p3` - `cpt-noter-principle-core-single-writer`

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - Speaker
  - Segment

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-core-transcript`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `transcript_rename_speaker`, `transcript_fix_term`, `transcript_name_speakers`, `audio_delete`, `audio_delete_older`
  - Events: `entity:changed`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-call-screen-name-speaker`
  - `cpt-noter-seq-call-page-name-speakers`

- **Data**:

  - None

### 2.14 Engine offline pass and embeddings - MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-core-engine-offline`

- **Milestone**: M2 · **Lane**: engine · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-engine-offline.md](features/core/core-engine-offline.md)

- **Purpose**: Run the offline Large v3 and VBx pass with the user's corrections as constraints, and serve speaker and text embeddings for identity and retrieval.

- **Depends On**: `cpt-noter-feature-core-engine-capture`

- **Scope**:
  - `offline_pass` and its progress and result files
  - `speaker_embedding`, `embed_texts`

- **Out of scope**:
  - Using the results (post-call, people, retrieval)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Transcription pipeline
  - PRD › Diarization and speaker identity

- **Design Principles Covered**:

  - None

- **Design Constraints Covered**:

  - [ ] `p3` - `cpt-noter-constraint-core-engine-offline`

- **Domain Model Entities**:
  - Archive result
  - Embedding

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-engine`
  - [ ] `p3` - `cpt-noter-component-core-engine-supervisor`

- **API**:
  - Interface `cpt-noter-interface-engine-stdio`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - None

- **Data**:

  - None

### 2.15 LLM router, egress gate and audit - MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-core-llm-gate`

- **Milestone**: M2 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-llm-gate.md](features/core/core-llm-gate.md)

- **Purpose**: Route every model call through one runtime interface, validate output against the app-owned skill schemas, lock every CLI run down, and send nothing off the Mac without the egress gate's redaction and audit row.

- **Depends On**: `cpt-noter-feature-core-storage`, `cpt-noter-feature-core-settings`

- **Scope**:
  - `LlmRuntime` with Claude Code, Codex and Ollama adapters; version pins; schema validation and retry
  - Run lockdown flags and the run-lockdown CI test
  - Egress gate: privacy mode, sensitive flag, redaction, `audit_log` before send; `llm_runs`
  - `accounts_get` and `api_key_set` (owner decision of 18 Oct, discrepancy 1): runtime availability and verified API keys in the Keychain, steps 1 to 5 of `cpt-noter-flow-core-credentials-privacy-keys`

- **Out of scope**:
  - Key removal, own accounts, CLI install and the Privacy pane commands (M3)
  - noter-mcp (M3)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › LLM orchestration
  - PRD › Security, privacy and permissions
  - PRD › Success metrics › Privacy (release blocker)

- **Design Principles Covered**:

  - [ ] `p3` - `cpt-noter-principle-core-egress-gate`

- **Design Constraints Covered**:

  - [ ] `p3` - `cpt-noter-constraint-core-api-keys`

- **Domain Model Entities**:
  - LLM run
  - Audit entry

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-core-llm-router`
  - [ ] `p3` - `cpt-noter-component-core-privacy`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `accounts_get`, `api_key_set`
  - Events: `privacy:changed`, `accounts:changed`
  - Interface `cpt-noter-interface-llm-runtime`
  - Interface `cpt-noter-interface-skill-outputs`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - None

- **Data**:

  - `cpt-noter-dbtable-llm-runs`
  - `cpt-noter-dbtable-audit-log`

### 2.16 Job scheduler and pipeline jobs - MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-core-jobs-scheduler`

- **Milestone**: M2 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-jobs-scheduler.md](features/core/core-jobs-scheduler.md)

- **Purpose**: Run background work without disturbing a live call: triggers, priorities, the battery rule, the live-call rule (post-call keeps running at low priority, owner decision D2) and the pipeline jobs.

- **Depends On**: `cpt-noter-feature-core-storage`, `cpt-noter-feature-core-capture-session`

- **Scope**:
  - Scheduler, `jobs` and `job_runs`, `jobs:progress`
  - Pipeline jobs: post-call, archive pass, model download (moved from the M0 setup task), CLI install

- **Out of scope**:
  - Maintenance, evidence and retention jobs and the Jobs commands (M5)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Maintenance jobs, evidence collection and history

- **Design Principles Covered**:

  - [ ] `p3` - `cpt-noter-principle-core-degrade`

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - Job run

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-core-jobs`

- **API**:
  - Events: `jobs:progress`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - None

- **Data**:

  - `cpt-noter-dbtable-jobs`

### 2.17 Post-call pipeline and outputs - MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-core-postcall`

- **Milestone**: M2 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-postcall.md](features/core/core-postcall.md)

- **Purpose**: Write the outputs within two minutes from the live transcript, section by section, then improve them after the archive pass without losing an edit; serve and version the output sections.

- **Depends On**: `cpt-noter-feature-core-jobs-scheduler`, `cpt-noter-feature-core-llm-gate`, `cpt-noter-feature-core-live-transcript`, `cpt-noter-feature-core-engine-offline`

- **Scope**:
  - Post-call skill, sections in order, suggested items, owners, topics, role reviews last
  - Archive pass replacement, re-chunk, three-way merge regeneration
  - Chunking and embedding of the transcript
  - Outputs commands and `outputs:progress`; agent switch-off per call type (D4)

- **Out of scope**:
  - Search and Ask over the chunks (M3)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 4. Post-call outputs
  - PRD › Success metrics › Post-call

- **Design Principles Covered**:

  - None

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - Summary
  - Version
  - Chunk

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-core-postcall`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `outputs_get`, `output_edit`, `outputs_regenerate`, `output_versions`, `output_version_get`
  - Events: `outputs:progress`
  - Interface `cpt-noter-interface-skill-outputs`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-core-call-end-outputs`
  - `cpt-noter-seq-call-page-review-outputs`
  - `cpt-noter-seq-notifications-open-outputs`

- **Data**:

  - `cpt-noter-dbtable-summaries`
  - `cpt-noter-dbtable-summary-versions`
  - `cpt-noter-dbtable-chunks`

### 2.18 Items, Today, sharing and export - MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-core-items-today`

- **Milestone**: M2 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-items-today.md](features/core/core-items-today.md)

- **Purpose**: Own the records the user acts on most: item lifecycle and review, evidence spans, the carry-forward query, the Today read model, call tags, share formats and export.

- **Depends On**: `cpt-noter-feature-core-postcall`, `cpt-noter-feature-core-native-surfaces`, `cpt-noter-feature-core-history-undo`

- **Scope**:
  - Item status x review machine, edits with `rev`, creation and reopen
  - Carry-forward query; Today ranking (D3); calendar on Today
  - Share for Slack, Jira and Markdown; export to a folder; call tags

- **Out of scope**:
  - Evidence collection (M5)
  - Handoff prompts (`cpt-noter-feature-core-handoff`)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 4, 6 and 13

- **Design Principles Covered**:

  - [ ] `p3` - `cpt-noter-principle-core-intent-commands`

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - Item
  - Evidence span
  - TodayView

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-core-items`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `items_list`, `item_get`, `item_set_done`, `item_review`, `items_review_all`, `item_edit`, `item_reopen`, `item_create`, `item_answer_handoff_landed`, `today_get`, `share_copy`, `calls_export`, `call_tags_set`, `tags_list`
  - Events: `entity:changed`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-today-review-before-call`
  - `cpt-noter-seq-today-tick-item`
  - `cpt-noter-seq-call-page-review-suggested-items`
  - `cpt-noter-seq-call-page-share-outputs`
  - `cpt-noter-seq-call-page-check-evidence`

- **Data**:

  - `cpt-noter-dbtable-items`
  - `cpt-noter-dbtable-item-spans`
  - `cpt-noter-dbtable-call-tags`

### 2.19 Handoff launcher and repositories - MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-core-handoff`

- **Milestone**: M2 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-handoff.md](features/core/core-handoff.md)

- **Purpose**: Generate handoff prompts on demand, keep their versions and edits, resolve the repository, detect the launch path and open the prompt in Claude Code or Codex pre-filled, never sent.

- **Depends On**: `cpt-noter-feature-core-items-today`, `cpt-noter-feature-core-llm-gate`, `cpt-noter-feature-core-native-services`

- **Scope**:
  - Handoff commands and prompt versions
  - Repository mappings
  - Launch order with the terminal fallback; prompt use recorded for the Handoff metric

- **Out of scope**:
  - Improvement briefs (M5)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 9. Handoff

- **Design Principles Covered**:

  - None

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - Handoff

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-core-handoff`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `handoff_get`, `handoff_generate`, `handoff_edit`, `handoff_set_target`, `handoff_open`, `handoff_copy`, `handoff_cancel`, `repos_list`, `repo_upsert`, `repo_remove`
  - Events: `entity:changed`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-core-handoff`
  - `cpt-noter-seq-call-page-hand-off-item`

- **Data**:

  - `cpt-noter-dbtable-prompt-versions`

### 2.20 History, undo and redo - MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-core-history-undo`

- **Milestone**: M2 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-history-undo.md](features/core/core-history-undo.md)

- **Purpose**: Make every logged change readable and reversible: undo and redo by change or batch at any time, skipping rows edited later, and the History read model and export.

- **Depends On**: `cpt-noter-feature-core-storage`

- **Scope**:
  - `change_undo`, `change_redo` by `UndoTarget`
  - History list and export

- **Out of scope**:
  - Proposals and Activity (M5)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 11. History and change log

- **Design Principles Covered**:

  - [ ] `p3` - `cpt-noter-principle-core-single-writer`

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - Change

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-core-changelog`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `history_list`, `change_undo`, `change_redo`, `history_export`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-core-review-undo`

- **Data**:

  - None

### 2.21 Native services: launch, clipboard, panels and share test - MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-core-native-services`

- **Milestone**: M2 · **Lane**: core (src-tauri) and engine (noter-native) · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-native-services.md](features/core/core-native-services.md)

- **Purpose**: Give the M2 commands the macOS services they need from the core: Launch Services and Apple Events for handoff, rich clipboard formats, save panels for export, and the Screen Share Test.

- **Depends On**: `cpt-noter-feature-core-native-surfaces`

- **Scope**:
  - Launch Services, Apple Events, terminal fallback
  - Rich clipboard and save panels
  - Screen Share Test run in the core process

- **Out of scope**:
  - Decisions about when to use them (owning features)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 6 and 9

- **Design Principles Covered**:

  - None

- **Design Constraints Covered**:

  - [ ] `p3` - `cpt-noter-constraint-core-macos`

- **Domain Model Entities**:
  - ShareTestResult

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-core-native`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `share_test_run`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - None

- **Data**:

  - None

### 2.22 Retrieval, search, Ask and topics - MEDIUM

- [ ] `p4` - **ID**: `cpt-noter-feature-core-retrieval-ask`

- **Milestone**: M3 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-retrieval-ask.md](features/core/core-retrieval-ask.md)

- **Purpose**: One retrieval function behind search, Ask, copilot facts and the pre-call brief: hybrid FTS5 and vector search with filters, cited answers, and topics across calls.

- **Depends On**: `cpt-noter-feature-core-postcall`, `cpt-noter-feature-core-llm-gate`, `cpt-noter-feature-core-engine-offline`

- **Scope**:
  - Hybrid retrieval and keyword-only mode
  - Ask threads, streamed cited answers
  - Topics, merges, keep separate

- **Out of scope**:
  - Document indexing (`cpt-noter-feature-core-knowledge`)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Search and cross-meeting memory
  - PRD › Success metrics › Search, Knowledge

- **Design Principles Covered**:

  - None

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - Topic
  - Ask thread

- **Design Components**:

  - [ ] `p4` - `cpt-noter-component-core-retrieval`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `search`, `ask_start`, `ask_stop`, `ask_threads_list`, `ask_thread_get`, `ask_thread_delete`, `ask_scope_presets`, `topics_list`, `topic_get`, `topic_rename`, `topics_merge`, `topics_keep_separate`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-core-ask`
  - `cpt-noter-seq-library-search-calls`
  - `cpt-noter-seq-library-filter-calls`
  - `cpt-noter-seq-library-follow-topic`
  - `cpt-noter-seq-ask-cited-answer`
  - `cpt-noter-seq-ask-follow-up-and-copy`

- **Data**:

  - `cpt-noter-dbtable-topics`
  - `cpt-noter-dbtable-suppressions`
  - `cpt-noter-dbtable-ask-threads`

### 2.23 People, identity and voice profiles - MEDIUM

- [ ] `p4` - **ID**: `cpt-noter-feature-core-people`

- **Milestone**: M3 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-people.md](features/core/core-people.md)

- **Purpose**: Person pages, aliases, merges, one-action deletion and opt-in encrypted voice profiles, with speaker matching against them.

- **Depends On**: `cpt-noter-feature-core-speakers-audio`, `cpt-noter-feature-core-engine-offline`

- **Scope**:
  - People commands, merges as batches
  - Voice profiles (encrypted, decaying)
  - Unnamed-speaker queue

- **Out of scope**:
  - Behaviour metrics back-computation (never, D5)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Diarization and speaker identity

- **Design Principles Covered**:

  - None

- **Design Constraints Covered**:

  - [ ] `p4` - `cpt-noter-constraint-core-local-data`

- **Domain Model Entities**:
  - Person
  - Voice profile

- **Design Components**:

  - [ ] `p4` - `cpt-noter-component-core-people`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `people_list`, `person_get`, `person_create`, `person_update`, `people_merge`, `person_delete`, `voice_profile_create`, `voice_profile_delete`
  - Events: `entity:changed`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-people-prepare-one-on-one`
  - `cpt-noter-seq-people-name-unnamed-speaker`
  - `cpt-noter-seq-dialogs-set-up-voice-profile`

- **Data**:

  - `cpt-noter-dbtable-people`
  - `cpt-noter-dbtable-call-participants`
  - `cpt-noter-dbtable-voice-profiles`

### 2.24 Knowledge sources - MEDIUM

- [ ] `p4` - **ID**: `cpt-noter-feature-core-knowledge`

- **Milestone**: M3 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-knowledge.md](features/core/core-knowledge.md)

- **Purpose**: Index folder and MCP sources into the same store with privacy class and scope applied before any model sees a chunk.

- **Depends On**: `cpt-noter-feature-core-retrieval-ask`, `cpt-noter-feature-core-jobs-scheduler`, `cpt-noter-feature-core-llm-gate`

- **Scope**:
  - Folder sources, extraction, chunking
  - Indexed MCP sources with OAuth
  - Sync runs as jobs

- **Out of scope**:
  - Live MCP lookups (relayed by noter-mcp, D1)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 7. Knowledge sources

- **Design Principles Covered**:

  - None

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - Source
  - Document

- **Design Components**:

  - [ ] `p4` - `cpt-noter-component-core-knowledge`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `sources_list`, `source_add_folder`, `source_add_mcp`, `source_update`, `source_reindex`, `source_remove`, `source_revoke_token`
  - Events: `entity:changed`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-settings-add-knowledge-source`

- **Data**:

  - `cpt-noter-dbtable-sources`

### 2.25 Credentials, own accounts and the Privacy pane - MEDIUM

- [ ] `p4` - **ID**: `cpt-noter-feature-core-credentials-privacy`

- **Milestone**: M3 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-credentials-privacy.md](features/core/core-credentials-privacy.md)

- **Purpose**: Keys in the Keychain, the own-account sign-in driven through the CLI, CLI install, the Privacy pane over the audit log, and the storage move if the engine ships unsandboxed.

- **Depends On**: `cpt-noter-feature-core-llm-gate`, `cpt-noter-feature-core-first-run`

- **Scope**:
  - API key removal, own accounts, agent binding with Undo (`accounts_get` and `api_key_set` are M2, `cpt-noter-feature-core-llm-gate`)
  - CLI install as a job
  - Audit list and export; `storage_move` (draft, Q4)

- **Out of scope**:
  - Agent editing (M4)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › LLM orchestration › Own accounts
  - PRD › Security, privacy and permissions

- **Design Principles Covered**:

  - [ ] `p4` - `cpt-noter-principle-core-egress-gate`

- **Design Constraints Covered**:

  - [ ] `p4` - `cpt-noter-constraint-core-api-keys`

- **Domain Model Entities**:
  - Credentials
  - Audit entry

- **Design Components**:

  - [ ] `p4` - `cpt-noter-component-core-credentials`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `api_key_remove`, `account_signin_prepare`, `cli_install`, `account_signin_start`, `account_signin_cancel`, `account_use_existing`, `account_bind_agents`, `account_test`, `account_sign_out`, `audit_list`, `audit_export`, `storage_move`
  - Events: `accounts:changed`, `signin:progress`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-core-account-signin`
  - `cpt-noter-seq-first-run-connect-assistant`
  - `cpt-noter-seq-settings-replace-api-key`
  - `cpt-noter-seq-settings-sign-in-account`
  - `cpt-noter-seq-settings-check-privacy`

- **Data**:

  - None

### 2.26 noter-mcp and the core socket - MEDIUM

- [ ] `p4` - **ID**: `cpt-noter-feature-core-mcp`

- **Milestone**: M3 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-mcp.md](features/core/core-mcp.md)

- **Purpose**: Let agents look things up in the library themselves through a local-only tool server whose results pass the egress gate for cloud runs (owner decision O2).

- **Depends On**: `cpt-noter-feature-core-retrieval-ask`, `cpt-noter-feature-core-items-today`, `cpt-noter-feature-core-llm-gate`

- **Scope**:
  - `noter-mcp` binary, per-run token, socket handler
  - Read tools, staging tools, live MCP relay (D1)

- **Out of scope**:
  - `emit_card` live path decision (Q3, M4)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › LLM orchestration › noter-mcp

- **Design Principles Covered**:

  - [ ] `p4` - `cpt-noter-principle-core-egress-gate`

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - McpRunContext

- **Design Components**:

  - [ ] `p4` - `cpt-noter-component-core-mcp`

- **API**:
  - Interface `cpt-noter-interface-mcp-tools`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - None

- **Data**:

  - None

### 2.27 Agents and council configuration - LOW

- [ ] `p5` - **ID**: `cpt-noter-feature-core-agents`

- **Milestone**: M4 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-agents.md](features/core/core-agents.md)

- **Purpose**: Agents as rows with runtime, model, effort, tools and call types; skills per agent; fused or parallel council mode.

- **Depends On**: `cpt-noter-feature-core-credentials-privacy`, `cpt-noter-feature-core-llm-gate`

- **Scope**:
  - Agent commands (draft until the M4 gate)
  - Agent skills
  - Council mode

- **Out of scope**:
  - The live loop (`cpt-noter-feature-core-copilot`)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 8. Role council

- **Design Principles Covered**:

  - None

- **Design Constraints Covered**:

  - [ ] `p5` - `cpt-noter-constraint-core-copilot-flag`

- **Domain Model Entities**:
  - Agent

- **Design Components**:

  - None of its own (see Purpose)

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `agents_get`, `agent_create`, `agent_update`, `agents_reorder`, `agent_remove`, `agent_skill_get`, `agent_skill_save`, `agent_skill_reset`, `council_set_mode`
  - Events: `entity:changed`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-agents-add-agent`
  - `cpt-noter-seq-agents-tune-council`

- **Data**:

  - `cpt-noter-dbtable-agents`

### 2.28 Copilot loop and cards - LOW

- [ ] `p5` - **ID**: `cpt-noter-feature-core-copilot`

- **Milestone**: M4 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-copilot.md](features/core/core-copilot.md)

- **Purpose**: One loop per live call: signals, topic tracker, one tick in flight, council fan-out, merge and rank, degrade rules, the card machine and its stream, behind the flag until the M4 latency gate.

- **Depends On**: `cpt-noter-feature-core-agents`, `cpt-noter-feature-core-retrieval-ask`, `cpt-noter-feature-core-live-transcript`, `cpt-noter-feature-core-items-today`

- **Scope**:
  - Tick loop and budget
  - Card machine and cards Channel
  - Card keys and `copilot:status`

- **Out of scope**:
  - Screen context chips (v1.x)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Live copilot
  - PRD › Live copilot loop
  - PRD › Success metrics › Copilot, Council

- **Design Principles Covered**:

  - [ ] `p5` - `cpt-noter-principle-core-degrade`

- **Design Constraints Covered**:

  - [ ] `p5` - `cpt-noter-constraint-core-copilot-flag`

- **Domain Model Entities**:
  - Card
  - CopilotStatus

- **Design Components**:

  - [ ] `p5` - `cpt-noter-component-core-copilot`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `cards_subscribe`, `card_pin`, `card_dismiss`, `card_unpin`, `card_undo_last`, `card_set_held`, `card_rate`, `card_shown`, `copilot_catch_up`, `copilot_ask_about_call`, `copilot_mute`, `copilot_mute_agent`, `copilot_raise_budget`, `context_chip_set`
  - Events: `copilot:status`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-core-live-tick`
  - `cpt-noter-seq-call-screen-pin-card`
  - `cpt-noter-seq-call-screen-catch-up`
  - `cpt-noter-seq-call-screen-read-copilot-state`
  - `cpt-noter-seq-menu-bar-mute-copilot`

- **Data**:

  - `cpt-noter-dbtable-cards`

### 2.29 Maintenance jobs, retention and recovery - LOW

- [ ] `p6` - **ID**: `cpt-noter-feature-core-maintenance`

- **Milestone**: M5 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-maintenance.md](features/core/core-maintenance.md)

- **Purpose**: The self-maintenance jobs and their controls: updates, integrity check and repair, index rebuild, re-derive, reconciliation, backups, nightly retention, and recovery from a corrupted database within ten minutes.

- **Depends On**: `cpt-noter-feature-core-jobs-scheduler`, `cpt-noter-feature-core-history-undo`

- **Scope**:
  - Jobs commands
  - Integrity, backup, rebuild, re-derive, reconciliation (propose-only)
  - Retention
  - Corruption recovery

- **Out of scope**:
  - Evidence collection (`cpt-noter-feature-core-evidence-proposals`)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 10. Self-maintenance
  - PRD › Success metrics › Maintenance

- **Design Principles Covered**:

  - [ ] `p6` - `cpt-noter-principle-core-single-writer`

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - Job run

- **Design Components**:

  - [ ] `p6` - `cpt-noter-component-core-jobs`
  - [ ] `p6` - `cpt-noter-component-core-storage`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `jobs_list`, `job_run_now`, `job_cancel`, `job_update`
  - Events: `jobs:progress`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-core-db-recovery`

- **Data**:

  - None

### 2.30 Evidence, proposals and Activity - LOW

- [ ] `p6` - **ID**: `cpt-noter-feature-core-evidence-proposals`

- **Milestone**: M5 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-evidence-proposals.md](features/core/core-evidence-proposals.md)

- **Purpose**: Close accepted items on evidence from Jira, Bitbucket, GitHub and later calls, turn weaker matches into proposals, and serve the Activity page.

- **Depends On**: `cpt-noter-feature-core-maintenance`, `cpt-noter-feature-core-items-today`, `cpt-noter-feature-core-llm-gate`

- **Scope**:
  - Evidence job with the auto-close rule
  - Proposals and decisions
  - Activity read model and `proposals:counts`

- **Out of scope**:
  - Term and people reconciliation beyond propose-only (later)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 10 and 11

- **Design Principles Covered**:

  - None

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - Evidence
  - Proposal

- **Design Components**:

  - [ ] `p6` - `cpt-noter-component-core-jobs`
  - [ ] `p6` - `cpt-noter-component-core-changelog`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `proposals_list`, `proposal_decide`, `proposal_always_for_term`, `activity_get`
  - Events: `proposals:counts`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-core-evidence-close`
  - `cpt-noter-seq-activity-review-proposals`
  - `cpt-noter-seq-activity-undo-batch`

- **Data**:

  - `cpt-noter-dbtable-evidence`

### 2.31 Metrics and Performance - LOW

- [ ] `p6` - **ID**: `cpt-noter-feature-core-metrics-performance`

- **Milestone**: M5 · **Lane**: core · **Status**: NOT_STARTED. FEATURE spec: [features/core/core-metrics-performance.md](features/core/core-metrics-performance.md)

- **Purpose**: Measure every stage the same way, roll it up nightly and serve the Performance page and the improvement brief.

- **Depends On**: `cpt-noter-feature-core-copilot`, `cpt-noter-feature-core-handoff`, `cpt-noter-feature-core-jobs-scheduler`

- **Scope**:
  - Stage timings, dropouts, footprint samples, correction rates
  - Roll-ups
  - Performance read model and brief

- **Out of scope**:
  - Telemetry (none exists)

- **Requirements Covered** (the PRD has no requirement IDs; sections by name):
  - PRD › Feature specification › 12. Performance
  - PRD › Success metrics

- **Design Principles Covered**:

  - None

- **Design Constraints Covered**:

  - None

- **Domain Model Entities**:
  - Metric

- **Design Components**:

  - [ ] `p6` - `cpt-noter-component-core-metrics`

- **API**:
  - Commands (frozen unless noted in DESIGN-core 3.3): `perf_overview`, `perf_call`, `perf_brief`

- **Sequences** (DESIGN-core sequences, then the DESIGN.md stories this feature delivers for the E2E gate):

  - `cpt-noter-seq-performance-find-bottleneck`
  - `cpt-noter-seq-performance-export-brief`

- **Data**:

  - `cpt-noter-dbtable-metrics`

---

## 3. Feature Dependencies

```text
M0  cpt-noter-feature-core-contract
      ├─→ cpt-noter-feature-core-storage ─→ cpt-noter-feature-core-ipc-host ─┬─→ cpt-noter-feature-core-harness
      │                                                                     └─→ cpt-noter-feature-core-settings ─┐
      └─→ cpt-noter-feature-core-engine-foundation ──────────────────────────────────────────────────────────────┴─→ cpt-noter-feature-core-first-run
M1  cpt-noter-feature-core-engine-foundation ─→ cpt-noter-feature-core-engine-capture
    engine-capture + first-run + settings ─→ cpt-noter-feature-core-capture-session
    capture-session ─┬─→ cpt-noter-feature-core-live-transcript ─→ cpt-noter-feature-core-library-calls
                     └─→ cpt-noter-feature-core-native-surfaces
M2  storage ─→ cpt-noter-feature-core-history-undo
    storage + settings ─→ cpt-noter-feature-core-llm-gate
    storage + capture-session ─→ cpt-noter-feature-core-jobs-scheduler
    engine-capture ─→ cpt-noter-feature-core-engine-offline
    live-transcript + history-undo ─→ cpt-noter-feature-core-speakers-audio
    jobs-scheduler + llm-gate + live-transcript + engine-offline ─→ cpt-noter-feature-core-postcall
    native-surfaces ─→ cpt-noter-feature-core-native-services
    postcall + native-surfaces + history-undo ─→ cpt-noter-feature-core-items-today ─→ cpt-noter-feature-core-handoff (+ llm-gate, native-services)
M3  postcall + llm-gate + engine-offline ─→ cpt-noter-feature-core-retrieval-ask ─┬─→ cpt-noter-feature-core-knowledge (+ jobs-scheduler)
                                                                               └─→ cpt-noter-feature-core-mcp (+ items-today)
    speakers-audio + engine-offline ─→ cpt-noter-feature-core-people
    llm-gate + first-run ─→ cpt-noter-feature-core-credentials-privacy
M4  credentials-privacy + llm-gate ─→ cpt-noter-feature-core-agents ─→ cpt-noter-feature-core-copilot (+ retrieval-ask, live-transcript, items-today)
M5  jobs-scheduler + history-undo ─→ cpt-noter-feature-core-maintenance ─→ cpt-noter-feature-core-evidence-proposals (+ items-today, llm-gate)
    copilot + handoff + jobs-scheduler ─→ cpt-noter-feature-core-metrics-performance
```

**Dependency Rationale**:

- `cpt-noter-feature-core-storage` requires `cpt-noter-feature-core-contract`: row and view-model types and `Rev` come from the contract crate.
- `cpt-noter-feature-core-ipc-host` requires the contract and storage: it implements `CoreApi` and its snapshot reads use the writer connection under the hub lock.
- `cpt-noter-feature-core-harness` requires the IPC host: it drives the same `CoreApi` composition root without Tauri.
- `cpt-noter-feature-core-settings` requires storage and the IPC host: sections are rows written through the change log and served as commands and events.
- `cpt-noter-feature-core-first-run` requires settings and the engine foundation: setup choices are settings, and the self-test runs in the engine.
- `cpt-noter-feature-core-engine-capture` requires the engine foundation: the same process, codec and supervisor gain capture.
- `cpt-noter-feature-core-capture-session` requires engine capture, first run and settings: it turns engine facts into the capture machine, and detection depends on the self-test and `offer_to_record`.
- `cpt-noter-feature-core-live-transcript` requires the capture session and engine capture: segments belong to a live call and arrive from the engine.
- `cpt-noter-feature-core-native-surfaces` requires the capture session and settings: panels and the menu bar show capture state, and hotkeys come from settings.
- `cpt-noter-feature-core-library-calls` requires the capture session and the live transcript: it reads the call rows, segments, marks and gaps they write.
- M2 to M5 dependencies follow the crate graph of DESIGN-core 3.4: everything that calls a model needs `cpt-noter-feature-core-llm-gate`, everything that runs in the background needs `cpt-noter-feature-core-jobs-scheduler`, and every user-visible undo needs `cpt-noter-feature-core-history-undo`.
- Parallel tracks: in M0, the engine foundation (engine lane) runs beside storage, the IPC host and the harness (core lane), and the contract lane keeps the conformance suite in step. In M1, engine capture and native surfaces (engine lane) run beside the session manager and the live transcript (core lane).

