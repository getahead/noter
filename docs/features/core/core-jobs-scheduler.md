---
title: "Feature: Job scheduler and pipeline jobs"
description: "Durable pipeline jobs with call and battery guards, progress, bounded writes and cancellation."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M2
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Job scheduler and pipeline jobs

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Queue and execute pipeline work](#queue-and-execute-pipeline-work)
  - [React to capture, power and cancellation](#react-to-capture-power-and-cancellation)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Admit work without disturbing capture](#admit-work-without-disturbing-capture)
  - [Commit bounded job batches](#commit-bounded-job-batches)
- [4. States (CDSL)](#4-states-cdsl)
  - [Durable job run](#durable-job-run)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Scheduling and interruption](#scheduling-and-interruption)
  - [Bounded logged work and tests](#bounded-logged-work-and-tests)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. M2 decisions](#7-m2-decisions)

<!-- /toc -->

- [ ] `p3` - **ID**: `cpt-noter-featstatus-core-jobs-scheduler`

- [ ] `p3` - `cpt-noter-feature-core-jobs-scheduler`

## 1. Feature Context

### 1.1 Overview

`noter-jobs` gains durable job definitions and runs, trigger dispatch, priorities, battery guards and progress. M2 runs PostCall, ArchivePass, Regeneration and model download, and provides the CLI-install job handler for its M3 command. Maintenance, evidence, retention and the Jobs UI commands remain M5. The previous call's PostCall runs at low priority during another live call; archive, regeneration and all other jobs wait.

### 1.2 Purpose

Outputs must arrive after back-to-back calls while capture and live ASR keep priority. Background writes remain bounded and logged.

**Requirements**: PRD › Maintenance jobs, evidence collection and history; PRD › Feature specification › 10. Self-maintenance; DESIGN-core decision D2.

**Principles**: `cpt-noter-principle-core-degrade`

**Delivers**:
- Frozen IPC commands (M2): none; `models_download` remains M0 and moves from a setup task to this scheduler.
- DESIGN.md stories (M2): none owned here; post-call and item features own the visible stories.
- Events: `jobs:progress` with complete `JobRunRow` values.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Core startup and trigger sources | Queue due jobs |
| Session manager | Reports live capture, stop and Continue Recording |
| Pipeline worker | Performs bounded, cancellable work and reports progress |
| Power environment | Supplies battery state |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-jobs-scheduler`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-jobs`, 3.1 Job run machine, `cpt-noter-dbtable-jobs` (including `job_runs`)
- **Contract**: `crates/noter-protocol/src/model/jobs.rs`; `contracts/ipc.manifest.json`
- **Dependencies**: `cpt-noter-feature-core-storage`, `cpt-noter-feature-core-capture-session`

## 2. Actor Flows (CDSL)

### Queue and execute pipeline work

- [x] `p1` - **ID**: `cpt-noter-flow-core-jobs-scheduler-run`

**Actor**: Session manager, setup task or another internal trigger

**Success Scenarios**:
- A stop queues a PostCall and an archive job; a second live call does not stop the former but keeps the latter waiting.
- Setup model download uses the same durable run and progress path without changing its M0 command.

**Error Scenarios**:
- A repeated trigger must not create duplicate work for the same call revision; a worker failure records its typed error and preserves completed batches.

**Steps**:
1. [x] - `p1` - Receive startup, after-call, hourly, nightly-window, source-change or on-demand trigger and resolve enabled job definitions - `inst-run-trigger`
2. [x] - `p1` - DB: INSERT a queued `job_runs` row for due work or return the existing run for the same pending work generation - `inst-run-enqueue`
3. [x] - `p1` - Apply `cpt-noter-algo-core-jobs-scheduler-admit` before dispatch - `inst-run-admit`
4. [x] - `p1` - Mark the admitted run running and publish `jobs:progress`; execute its pipeline handler with a cancellation signal - `inst-run-start`
5. [x] - `p1` - Persist counts and progress after each completed stage or logged batch, then publish the updated run - `inst-run-progress`
6. [x] - `p1` - On completion set `finished_at`, succeeded status and final counts; on failure set failed and the typed `error_code` - `inst-run-finish`
7. [x] - `p1` - **RETURN** the run id to the trigger caller; worker completion is asynchronous - `inst-run-return`

### React to capture, power and cancellation

- [x] `p1` - **ID**: `cpt-noter-flow-core-jobs-scheduler-interrupt`

**Actor**: Session manager or power environment

**Success Scenarios**:
- A new capture pauses archive and regeneration at a safe boundary, while another call's PostCall yields to live ASR and continues.
- Continue Recording cancels the same call's pending analysis and stale completions cannot write into it.

**Error Scenarios**:
- The worker dies: the run records failure; a restart does not pretend an unfinished run succeeded.

**Steps**:
1. [x] - `p1` - Re-evaluate queued and running jobs when capture or power state changes - `inst-interrupt-change`
2. [x] - `p1` - **IF** a running job is no longer eligible, signal pause at its next safe checkpoint and persist paused status - `inst-interrupt-pause`
3. [x] - `p1` - **IF** it is PostCall for a previous call, keep it runnable below live ASR priority; no maintenance job gains this exception - `inst-interrupt-postcall`
4. [x] - `p1` - **IF** Continue Recording resumes the source call, cancel its queued or running pipeline generation and invalidate pending results - `inst-interrupt-continue`
5. [x] - `p1` - **IF** cancellation is requested, stop dispatch, stop or abandon the worker at a safe boundary and mark cancelled with final counts - `inst-interrupt-cancel`
6. [x] - `p1` - When guards clear, resume paused work from its checkpoint and reconsider queued work; a later stop queues fresh PostCall work with prior edits retained - `inst-interrupt-resume`
7. [x] - `p1` - **RETURN** updated run state through `jobs:progress` - `inst-interrupt-return`

## 3. Processes / Business Logic (CDSL)

### Admit work without disturbing capture

- [x] `p1` - **ID**: `cpt-noter-algo-core-jobs-scheduler-admit`

**Input**: Enabled jobs, queued runs, trigger time, battery state and current capture state.

**Output**: Runnable work in priority order or a waiting reason.

**Steps**:
1. [x] - `p1` - Ignore disabled definitions and triggers outside their configured schedule; deduplicate a still-pending trigger - `inst-admit-enabled`
2. [x] - `p1` - **IF** on battery and the job does not allow battery operation, keep it queued or paused until power permits - `inst-admit-battery`
3. [x] - `p1` - **IF** a call is live and the job is not the previous call's PostCall, keep it queued or paused - `inst-admit-call`
4. [x] - `p1` - **IF** PostCall belongs to the currently resumed call, cancel its obsolete generation instead of admitting it - `inst-admit-same-call`
5. [x] - `p1` - Order eligible jobs by configured priority with capture and live ASR ahead of all pipeline work - `inst-admit-priority`
6. [x] - `p1` - **RETURN** runnable jobs and guards; do not hold the SQLite writer while models or native services run - `inst-admit-return`

### Commit bounded job batches

- [x] `p1` - **ID**: `cpt-noter-algo-core-jobs-scheduler-batch`

**Input**: Run id, current generation, pending mutations and cancellation or pause state.

**Output**: A committed batch and checkpoint, or no mutation when work is obsolete.

**Steps**:
1. [x] - `p1` - Check cancellation, call guard and run generation before each batch - `inst-batch-check`
2. [x] - `p1` - Take at most 200 target rows and submit their mutations through the change-log writer with the run actor and batch id - `inst-batch-limit`
3. [x] - `p1` - **TRY** commit mutations, changes and progress checkpoint consistently - `inst-batch-try`
4. [x] - `p1` - **CATCH** a failure: roll back the current batch, persist the typed run failure and keep earlier committed batches readable - `inst-batch-fail`
5. [x] - `p1` - Yield before the next batch; publish only committed progress and re-check capture and power guards - `inst-batch-yield`
6. [x] - `p1` - **RETURN** the next checkpoint or completed counts - `inst-batch-return`

## 4. States (CDSL)

### Durable job run

- [x] `p1` - **ID**: `cpt-noter-state-core-jobs-scheduler-run`

**States**: queued, running, paused, succeeded, failed, cancelled

**Initial State**: queued

**Transitions**:
1. [x] - `p1` - **FROM** queued **TO** running **WHEN** trigger, call, power and priority guards permit dispatch - `inst-st-start`
2. [x] - `p1` - **FROM** running **TO** paused **WHEN** a call or battery guard blocks it at a safe checkpoint - `inst-st-pause`
3. [x] - `p1` - **FROM** paused **TO** running **WHEN** guards clear and the worker resumes its checkpoint - `inst-st-resume`
4. [x] - `p1` - **FROM** running **TO** succeeded **WHEN** the final stage and checkpoint commit - `inst-st-success`
5. [x] - `p1` - **FROM** running **TO** failed **WHEN** the worker reports a typed failure or recovery detects unfinished interrupted work - `inst-st-failed`
6. [x] - `p1` - **FROM** queued **TO** cancelled **WHEN** its generation is cancelled; the same applies from running or paused at the next safe boundary - `inst-st-cancel`

Terminal runs are retained; retries create a new run linked to the same job definition. On startup, reconcile unfinished records with checkpoints before dispatching a retry. M5 exposes user job controls; M2 internal cancellation already uses this machine.

## 5. Definitions of Done

### Scheduling and interruption

- [x] `p1` - **ID**: `cpt-noter-dod-core-jobs-scheduler-scheduling`

The system **MUST** persist job definitions and run state, enforce trigger and battery settings, wait or pause during live calls except for the previous call's low-priority PostCall, and cancel obsolete work on Continue Recording. Pipeline handlers cover post-call, archive, regeneration, model download and CLI install without adding later-milestone commands to M2.

**Implements**:
- `cpt-noter-flow-core-jobs-scheduler-run`
- `cpt-noter-flow-core-jobs-scheduler-interrupt`
- `cpt-noter-algo-core-jobs-scheduler-admit`
- `cpt-noter-state-core-jobs-scheduler-run`

**Touches**:
- API: `jobs:progress`
- DB: `jobs`, `job_runs`
- Entities: `JobKind`, `JobRunRow`, `JobAccepted`

### Bounded logged work and tests

- [x] `p1` - **ID**: `cpt-noter-dod-core-jobs-scheduler-batches`

The system **MUST** use logged batches of at most 200 rows, yield between them and persist truthful progress and errors. Unit tests use a deterministic clock, power source and controllable worker to prove guard combinations, deduplication, pause, resume, cancellation, failure and restart. Event conformance and real-core post-call E2E prove the integration; no story is counted twice. `just gate` passes.

**Implements**:
- `cpt-noter-algo-core-jobs-scheduler-batch`
- `cpt-noter-flow-core-jobs-scheduler-interrupt`

**Touches**:
- API: `jobs:progress`
- DB: `changes`, `job_runs`

## 6. Acceptance Criteria

- [x] A second capture leaves the previous call's PostCall running at low priority and its archive and regeneration waiting or paused; live ASR keeps priority.
- [x] Continue Recording cancels the same call's pipeline, rejects late results and queues a fresh generation at the next stop.
- [x] Battery, trigger and enabled settings are tested independently; no-battery jobs resume when power allows.
- [x] No transaction changes more than 200 target rows per batch; rollback leaves prior committed batches intact and progress truthful.
- [x] Startup reconciles interrupted runs; worker failure and cancellation produce terminal progress events with typed errors or counts.
- [ ] Event conformance and the post-call feature's real-core story E2E pass; setup model downloads still satisfy the M0 contract.
- [ ] `just gate` passes.

## 7. M2 decisions

- `job_runs.subject` (TEXT, nullable) holds the work a run is for (a call id; a download generation), so one pending run per kind and subject is the deduplication key.
- Job definitions are created lazily with their defaults the first time a kind is triggered; there is no seeding migration.
- The nightly window is read in UTC hours (`"HH-HH"`, wrapping midnight); the user's time zone comes with the maintenance jobs (M5).
- `models_download` queues one `ModelDownload` run per start (subject `download-N`); a live call holds the download (bundles show paused) and it goes on by itself when the call ends. Pausing it yourself during a call keeps it paused.
- Power: the scheduler reads a `PowerSource` from `CoreDeps` (mains by default). The macOS battery reading arrives with 2.21 native-services; the harness answers `--power battery|ac`.
