---
title: "Feature: Maintenance jobs, retention and recovery"
description: "Job controls, verified updates and backups, integrity repair, index rebuild, re-derive, propose-only reconciliation and nightly retention."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M5
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Maintenance jobs, retention and recovery

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Inspect and configure jobs](#inspect-and-configure-jobs)
  - [Run or cancel a job](#run-or-cancel-a-job)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Execute maintenance safely](#execute-maintenance-safely)
  - [Verify updates and backups](#verify-updates-and-backups)
  - [Recover and rebuild](#recover-and-rebuild)
  - [Re-derive and propose reconciliation](#re-derive-and-propose-reconciliation)
  - [Apply nightly retention](#apply-nightly-retention)
- [4. States (CDSL)](#4-states-cdsl)
  - [Maintenance run](#maintenance-run)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Job controls and safe execution](#job-controls-and-safe-execution)
  - [Verified maintenance and recovery](#verified-maintenance-and-recovery)
  - [Retention and proof](#retention-and-proof)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p6` - **ID**: `cpt-noter-featstatus-core-maintenance`

- [ ] `p6` - `cpt-noter-feature-core-maintenance`

## 1. Feature Context

### 1.1 Overview

`noter-jobs` gains the maintenance work and the controls over the scheduler delivered in M2. Storage gains verified backups, integrity checks and recovery from per-call files. Maintenance yields to capture and changes primary records only through the change log.

Evidence collection belongs to `cpt-noter-feature-core-evidence-proposals`; source sync, pipeline jobs and metrics roll-up keep their owning features. This feature schedules and exposes them without reimplementing them. `update_install` remains the M0 settings command.

### 1.2 Purpose

Keep the app usable without tending its database or models. A corrupted database must recover to a working app within ten minutes without lost calls.

**Requirements**: PRD › Feature specification › 10. Self-maintenance; PRD › Maintenance jobs, evidence collection and history; PRD › Success metrics › Maintenance.

**Principles**: `cpt-noter-principle-core-single-writer`

**Delivers**:
- Frozen commands (M5): `jobs_list`, `job_run_now`, `job_cancel`, `job_update`.
- Events: `jobs:progress`; `degraded:changed` during index rebuilds.
- DESIGN-core sequence: `cpt-noter-seq-core-db-recovery`.
- DESIGN.md stories (M5): none assigned directly; the job controls support the Activity and Performance stories owned by the other M5 features.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Reads jobs, runs or cancels them, changes their switches |
| Settings and main windows | Invoke job commands within their allowed scopes |
| Scheduler and core startup | Trigger maintenance and recovery |
| Capture session | Pauses maintenance while a call is live |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md), Self-maintenance, Maintenance jobs, Success metrics
- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-maintenance`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md), 3.1 Job run lifecycle, 3.2 Jobs and evidence and Storage, 3.3 Job commands, 3.6 database recovery
- **Components**:
  - [ ] `p6` - `cpt-noter-component-core-jobs`
  - [ ] `p6` - `cpt-noter-component-core-storage`
- **Dependencies**: `cpt-noter-feature-core-jobs-scheduler`, `cpt-noter-feature-core-history-undo`
- **Contract**: `crates/noter-protocol/src/model/jobs.rs`, settings and error types, `ipc/mod.rs`, `contracts/ipc.manifest.json`; reuse the M2 `jobs` and `job_runs` storage, without declaring new tables

## 2. Actor Flows (CDSL)

### Inspect and configure jobs

- [ ] `p1` - **ID**: `cpt-noter-flow-core-maintenance-list-update`

**Actor**: Primary user (Settings; main window for reads)

**Success Scenarios**:
- Each job shows its trigger, enabled and battery switches, last run, counts, error, running flag and live-call block; installed evidence tools appear beside the jobs.
- Updating one switch preserves omitted switches and returns the fresh list.

**Error Scenarios**:
- Unknown job: `not_found`; `job_update` from the main window: `window_not_allowed`.

**Steps**:
1. [ ] - `p1` - API: `jobs_list` from Settings or main - `inst-list-call`
2. [ ] - `p1` - DB: SELECT jobs and their last runs; combine scheduler state, power policy and evidence tool detection into `JobList` - `inst-list-read`
3. [ ] - `p1` - **IF** the user changes a switch in Settings - `inst-update-if`
   1. [ ] - `p1` - API: `job_update` with job id and optional enabled and battery switches - `inst-update-call`
   2. [ ] - `p1` - Validate the job exists; **RETURN** `not_found` otherwise - `inst-update-check`
   3. [ ] - `p1` - DB: persist supplied switches through the writer and change log; refresh scheduler policy without starting a run - `inst-update-write`
4. [ ] - `p1` - **RETURN** `JobList` - `inst-list-return`

### Run or cancel a job

- [ ] `p1` - **ID**: `cpt-noter-flow-core-maintenance-run-cancel`

**Actor**: Primary user (Settings or main window, including Activity retry and Performance roll-up retry)

**Success Scenarios**:
- Run now returns the accepted run id; progress and terminal counts arrive on `jobs:progress`.
- Cancel stops a queued or active run at a safe boundary and keeps already committed batches visible.

**Error Scenarios**:
- A live call blocks every job except post-call analysis; battery policy can also return `job_blocked`.
- Evidence tools or trackers can report `evidence_tool_missing`, `cli_version_unsupported` or `tracker_unreachable` through the owning runner.

**Steps**:
1. [ ] - `p1` - API: `job_run_now` with job id - `inst-run-call`
2. [ ] - `p1` - Validate the id; **RETURN** `not_found` if absent - `inst-run-find`
3. [ ] - `p1` - **IF** a call is live and the kind is not PostCall, or effective battery policy forbids the run, **RETURN** `job_blocked` without queuing work - `inst-run-block`
4. [ ] - `p1` - Ask the M2 scheduler to accept the run and persist its queued state; **RETURN** `JobAccepted` - `inst-run-accept`
5. [ ] - `p1` - Publish `jobs:progress` when the run starts, advances, pauses or finishes - `inst-run-progress`
6. [ ] - `p1` - **IF** the user selects Cancel - `inst-cancel-if`
   1. [ ] - `p1` - API: `job_cancel` with the job id; resolve its queued or active run through the scheduler - `inst-cancel-call`
   2. [ ] - `p1` - Cancel queued work or signal the active runner, including a run paused for capture; rollback its unfinished transaction and release its resources - `inst-cancel-stop`
   3. [ ] - `p1` - Persist cancelled status and finish time, publish `jobs:progress`, and **RETURN** `JobList`; a terminal run is not restarted by Cancel - `inst-cancel-return`

## 3. Processes / Business Logic (CDSL)

### Execute maintenance safely

- [ ] `p1` - **ID**: `cpt-noter-algo-core-maintenance-execute`

**Input**: An accepted maintenance run, injected clock, capture and power state, maintenance settings.

**Output**: Committed work with counts, or a paused, cancelled or failed run.

**Steps**:
1. [ ] - `p1` - Use scheduler triggers and priorities: startup quick check, daily app check, weekly model check, nightly full check and backup, rebuild on corruption or model change, re-derive after migrations or on demand, term reconciliation after calls and nightly, people reconciliation after calls - `inst-exec-triggers`
2. [ ] - `p1` - Apply the nightly window (default 02:00–05:00), enabled switch and battery policy (default off battery); on-demand work still respects capture and power guards - `inst-exec-policy`
3. [ ] - `p1` - **FOR EACH** batch of at most 200 rows - `inst-exec-batches`
   1. [ ] - `p1` - Recheck cancellation, power and live capture before starting; pause maintenance at the boundary while capture is live - `inst-exec-yield`
   2. [ ] - `p1` - **TRY** the batch through the single writer; record primary-data changes and their change rows together - `inst-exec-try`
      1. [ ] - `p1` - Commit the batch and its counts; persist per-call recovery files after any edit batch - `inst-exec-commit`
   3. [ ] - `p1` - **CATCH** a write failure: rollback the unfinished batch, keep prior batches, record the typed error and fail the run - `inst-exec-fail`
   4. [ ] - `p1` - Emit `jobs:progress` and yield before the next batch - `inst-exec-progress`
4. [ ] - `p1` - **RETURN** the run's final status and counts; structured logs contain ids and errors without transcript text - `inst-exec-return`

### Verify updates and backups

- [ ] `p1` - **ID**: `cpt-noter-algo-core-maintenance-verify`

**Input**: App channel and model manifests, current database, backup settings.

**Output**: A verified staged update or backup; the previous working version remains on failure.

**Steps**:
1. [ ] - `p1` - For app updates, use the native updater's signed release manifest for the selected stable or beta channel and the fixed download host list; stage verified downloads for next launch with release notes - `inst-verify-app`
2. [ ] - `p1` - For model updates, compare the pinned manifest, download from allowed hosts and verify checksums before golden-set smoke testing - `inst-verify-model`
3. [ ] - `p1` - **IF** verification or the smoke test fails, keep the previous model bundle and **RETURN** the failed run with its typed error - `inst-verify-reject`
4. [ ] - `p1` - Keep the previous bundle until the new one passes; a changed embedding model schedules index rebuild and re-embedding - `inst-verify-promote`
5. [ ] - `p1` - For the nightly backup, take a consistent snapshot with the SQLite backup API and check the snapshot with quick_check - `inst-verify-backup`
6. [ ] - `p1` - **IF** the snapshot fails verification, retain earlier verified backups and **RETURN** a failed run - `inst-verify-bad-backup`
7. [ ] - `p1` - Rotate only verified backups, keeping the configured count (seven by default); preserve per-call files regardless of audio retention - `inst-verify-rotate`
8. [ ] - `p1` - **RETURN** success and counts; update checks and swaps are logged, backup progress belongs to the run - `inst-verify-return`

### Recover and rebuild

- [ ] `p1` - **ID**: `cpt-noter-algo-core-maintenance-recover`

**Input**: Startup quick_check or nightly full integrity_check result, verified backup candidates, per-call files.

**Output**: A working database and rebuilt indexes, or a visible failed recovery without overwriting the recovery sources.

**Steps**:
1. [ ] - `p1` - **IF** integrity is good, **RETURN** success without restoring - `inst-recover-healthy`
2. [ ] - `p1` - Quiesce database access through storage; check backups newest first and select the newest one that passes quick_check - `inst-recover-select`
3. [ ] - `p1` - **IF** none passes, fail the integrity run visibly and preserve the corrupt database and per-call files for repair; do not report recovery complete - `inst-recover-no-backup`
4. [ ] - `p1` - **ELSE** restore the selected backup before reopening read connections - `inst-recover-restore`
   1. [ ] - `p1` - Re-import newer calls and edits from `transcript.jsonl`, `items.json` and `summary.md` through storage, preserving ids and avoiding duplicate records on retry - `inst-recover-import`
   2. [ ] - `p1` - Publish `degraded:changed` with keyword-only search and rebuild progress - `inst-recover-degraded`
   3. [ ] - `p1` - Rebuild FTS5 and sqlite-vec indexes from stored rows and embeddings; re-embed only where the embedding model changed - `inst-recover-index`
   4. [ ] - `p1` - Verify rebuilt indexes and integrity before clearing degraded state; failed or cancelled rebuilds retain keyword-only search and a retryable job record - `inst-recover-check`
5. [ ] - `p1` - **RETURN** the recovery result through `jobs:progress`; the corruption drill measures time to the working app - `inst-recover-return`

### Re-derive and propose reconciliation

- [ ] `p1` - **ID**: `cpt-noter-algo-core-maintenance-reconcile`

**Input**: Migration or manual re-derive request; new glossary entries, corrected terms, references or speaker names.

**Output**: Rebuilt derived records or proposed changes; recorded text and user edits are preserved until acceptance.

**Steps**:
1. [ ] - `p1` - Re-derive chunks, topics and person statistics from segments and items through their owning services - `inst-reconcile-derived`
2. [ ] - `p1` - Find earlier transcript and item candidates using each term's Latin, Cyrillic transliteration and spoken variants; include Jira keys and document references - `inst-reconcile-terms`
3. [ ] - `p1` - For people, consider opted-in voice profiles above the configured match threshold and calendar attendees as evidence for past unnamed speakers - `inst-reconcile-people`
4. [ ] - `p1` - DB: INSERT proposed changes with target base revisions, before and after values, reason, evidence, confidence and a propagation batch id through the change-log service - `inst-reconcile-propose`
5. [ ] - `p1` - Do not apply retroactive changes automatically in v1, including when a glossary rule governs new calls; leave decisions to `cpt-noter-feature-core-evidence-proposals` - `inst-reconcile-boundary`
6. [ ] - `p1` - **RETURN** candidate counts and proposal batches without exposing transcript content in run logs - `inst-reconcile-return`

### Apply nightly retention

- [ ] `p1` - **ID**: `cpt-noter-algo-core-maintenance-retention`

**Input**: Injected clock, latest audio retention settings, archived segments and metrics.

**Output**: Expired data removed with non-undoable change records and accurate counts.

**Steps**:
1. [ ] - `p1` - Re-evaluate existing calls against the latest retention setting for this run; use the same eligibility query as Settings' next-run audio count - `inst-retention-select`
2. [ ] - `p1` - **FOR EACH** eligible batch of at most 200 rows, outside live capture - `inst-retention-batch`
   1. [ ] - `p1` - Delete audio past its effective retention date and record audio-deleted metadata with a content-free, non-undoable change; retry failed file removal without counting it as removed - `inst-retention-audio`
   2. [ ] - `p1` - Delete only the live-segment copy seven days after a successful archive pass; keep archive rows and time-span evidence resolvable - `inst-retention-live`
   3. [ ] - `p1` - Delete metrics older than 365 days under the default one-year policy, using the configured metrics retention; log retention as non-undoable - `inst-retention-metrics`
   4. [ ] - `p1` - Preserve per-call recovery files, summaries, items and transcripts still needed for recovery - `inst-retention-files`
3. [ ] - `p1` - **RETURN** actual deletion counts through `jobs:progress`; undo of retention returns `not_undoable` - `inst-retention-return`

## 4. States (CDSL)

### Maintenance run

- [ ] `p1` - **ID**: `cpt-noter-state-core-maintenance-run`

**States**: queued, running, paused, succeeded, failed, cancelled

**Initial State**: queued

**Transitions**:
1. [ ] - `p1` - **FROM** queued **TO** running **WHEN** the scheduler admits the run under capture and power policy - `inst-state-start`
2. [ ] - `p1` - **FROM** running **TO** paused **WHEN** a live call starts; finish or rollback the current batch before yielding - `inst-state-pause`
3. [ ] - `p1` - **FROM** paused **TO** running **WHEN** the call ends and policy permits resumption - `inst-state-resume`
4. [ ] - `p1` - **FROM** queued **TO** cancelled **WHEN** Cancel removes the queued run - `inst-state-cancel-queued`
5. [ ] - `p1` - **FROM** running **TO** cancelled **WHEN** Cancel reaches a safe boundary; also from paused - `inst-state-cancel-active`
6. [ ] - `p1` - **FROM** running **TO** succeeded **WHEN** all work and verification finish - `inst-state-success`
7. [ ] - `p1` - **FROM** running **TO** failed **WHEN** a runner reports a typed failure - `inst-state-failure`

Terminal runs keep their counts and finish time. A retry creates a new run; it does not reopen a terminal row. The PostCall exception and restart recovery of active runs remain with the M2 scheduler.

## 5. Definitions of Done

### Job controls and safe execution

- [ ] `p1` - **ID**: `cpt-noter-dod-core-maintenance-controls`

The system **MUST** expose all four commands with their contract scopes, optional-update semantics and scheduler guards, publish progress only for persisted run changes, and yield maintenance between batches of at most 200 rows during capture.

**Implements**:
- `cpt-noter-flow-core-maintenance-list-update`
- `cpt-noter-flow-core-maintenance-run-cancel`
- `cpt-noter-algo-core-maintenance-execute`
- `cpt-noter-state-core-maintenance-run`

**Touches**:
- API: `jobs_list`, `job_run_now`, `job_cancel`, `job_update`, `jobs:progress`
- DB: `jobs`, `job_runs`, `changes`
- Entities: `JobList`, `JobRow`, `JobRunRow`, `JobAccepted`

### Verified maintenance and recovery

- [ ] `p1` - **ID**: `cpt-noter-dod-core-maintenance-recovery`

The system **MUST** verify updates and backups, recover the newest valid snapshot plus newer per-call records, rebuild indexes with keyword-only search while rebuilding, and leave retroactive reconciliation as proposals. Recovery **MUST** pass the ten-minute, no-lost-calls corruption drill.

**Implements**:
- `cpt-noter-algo-core-maintenance-verify`
- `cpt-noter-algo-core-maintenance-recover`
- `cpt-noter-algo-core-maintenance-reconcile`

**Covers (DESIGN)**:
- [ ] `p6` - `cpt-noter-principle-core-single-writer`
- [ ] `p6` - `cpt-noter-component-core-jobs`
- [ ] `p6` - `cpt-noter-component-core-storage`
- `cpt-noter-seq-core-db-recovery`

**Touches**:
- API: `jobs:progress`, `degraded:changed`
- DB: database snapshots, indexes, derived rows, `changes`, `job_runs`
- Entities: verified backups, model bundles, per-call recovery files

### Retention and proof

- [ ] `p1` - **ID**: `cpt-noter-dod-core-maintenance-retention-tests`

The system **MUST** apply retention to existing calls from the next nightly run, preserve recovery files and evidence links, and prove the job and recovery paths with unit, conformance and real-core E2E tests. `just gate` passes.

**Implements**:
- `cpt-noter-algo-core-maintenance-retention`

**Touches**:
- DB: `calls`, `segments`, `metrics`, `changes`, `job_runs`
- Entities: audio files and retention counts

## 6. Acceptance Criteria

- [ ] Unit tests use an injected clock and power/capture state to prove nightly boundaries, live-call pause/resume, PostCall exception, cancellation and the 200-row maximum.
- [ ] Unit and storage integration tests prove checksum/signature failure preserves working versions, failed backup verification preserves good snapshots, and recovery chooses the newest passing backup and imports newer edits exactly once.
- [ ] Retention tests cover changed settings on existing calls, never/forever audio policies, exactly seven days after archive and 365-day metrics boundaries, failed unlinks and non-undoable content-free logs; recovery files survive.
- [ ] Conformance against the real core proves all four commands' window scopes, omitted switches, `not_found`, `job_blocked`, `JobAccepted` and progress payloads.
- [ ] Real-core E2E successfully invokes each of the four M5 commands, completes and cancels runs, and proves Activity retry and Performance roll-up retry with the stories owned by the other M5 specs; no separate M5 story is assigned here.
- [ ] A corruption drill on a database copy restores a working app within ten minutes with no lost calls, shows keyword-only search during rebuild and clears degraded state only after verification; disk-full and rebuild failure remain visible and retryable.
- [ ] Reconciliation tests show earlier terms, references and names as proposals without rewriting user edits; maintenance and recovery performance scenarios obey the harness limits.
- [ ] Cross-tenant auth, network service deployment and regulatory certification are not applicable to this local core feature. Native controls, keyboard handling and announcements belong to the UI; this feature supplies typed progress and errors. Download trust uses the existing updater and allow-list.
- [ ] `just gate` passes.
