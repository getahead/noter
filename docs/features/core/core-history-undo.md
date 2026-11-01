---
title: "Feature: History, undo and redo"
description: "History read models and export, revision-safe undo and redo of any change or batch, without a time limit."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M2
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: History, undo and redo

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Read and export History](#read-and-export-history)
  - [Undo or redo a change or batch](#undo-or-redo-a-change-or-batch)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Replay a logged change safely](#replay-a-logged-change-safely)
- [4. States (CDSL)](#4-states-cdsl)
  - [Change reversal](#change-reversal)
- [5. Definitions of Done](#5-definitions-of-done)
  - [History and export](#history-and-export)
  - [Reversal without lost edits](#reversal-without-lost-edits)
  - [Tests and gate](#tests-and-gate)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p3` - **ID**: `cpt-noter-featstatus-core-history-undo`

- [ ] `p3` - `cpt-noter-feature-core-history-undo`

## 1. Feature Context

### 1.1 Overview

The change-log service gains History, undo and redo over the write path built in M0. A change or batch can be reversed at any time while its target rows have not been edited later. Capture data (confirmed segments, live speakers, gaps and marks, including user-pressed marks and pause gaps) is written without change rows (`cpt-noter-principle-core-single-writer`, Backend Teamlead M1 decision, 18 Oct 2026), so it is outside History and undo; PRD › 11 "undo any change" covers logged changes only, and the user's later edits to capture data are logged and undoable. Partial reversal keeps later edits and reports them. History lists the actor, reason, evidence and before/after values, and exports Markdown or JSON. Proposals and Activity remain M5.

### 1.2 Purpose

The user can inspect and reverse a correction, review or job batch without losing work done since it.

**Requirements**: PRD › Feature specification › 11. History and change log; PRD › Maintenance jobs, evidence collection and history.

**Principles**: `cpt-noter-principle-core-single-writer`

**Delivers**:
- Frozen commands (M2): `history_list`, `change_undo`, `change_redo`, `history_export`.
- DESIGN.md stories (M2): none owned here; supports review and tick undo in the items feature.
- DESIGN-core sequence: `cpt-noter-seq-core-review-undo`.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Reads History, undoes, redoes and exports |
| Main window; call screen for undo and redo | Sends the change or batch handle |
| Change-log writer | Serializes reversal with later writes |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-history-undo`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): 3.1 Change machine, `cpt-noter-component-core-changelog`, `cpt-noter-seq-core-review-undo`; shared table `cpt-noter-dbtable-changes`
- **Contract**: `model/history.rs`, `ipc/mod.rs` in `crates/noter-protocol/src`; `contracts/ipc.manifest.json`
- **Dependencies**: `cpt-noter-feature-core-storage`

## 2. Actor Flows (CDSL)

### Read and export History

- [ ] `p1` - **ID**: `cpt-noter-flow-core-history-undo-read`

**Actor**: Primary user (main window)

**Success Scenarios**:
- Call, item, person or global History is paged, filtered by actor, job and period; batches carry their size and text changes carry inline-diff values.
- Export uses the chosen call or period and Markdown or JSON.

**Error Scenarios**:
- An unreadable log returns `change_log_unreadable`; an invalid period returns `invalid_input`; closing the save panel returns `cancelled`.

**Steps**:
1. [x] - `p1` - API: `history_list { target, actor, job_id, from, to, page }`; validate the target and period - `inst-read-request`
2. [x] - `p1` - DB: SELECT `changes` on a read-only connection with target, actor, job and date filters and stable page ordering - `inst-read-select`
3. [x] - `p1` - Assemble `ChangeRow` values with actor labels, batch sizes, evidence, undoable and redoable state; return an empty page when no rows match - `inst-read-assemble`
4. [ ] - `p1` - **IF** the user calls `history_export { scope, format }` - `inst-export-request`
   1. [ ] - `p1` - Resolve whole-call or local-date period scope; show the native save panel - `inst-export-panel`
   2. [ ] - `p1` - **IF** cancelled, **RETURN** `cancelled` without creating a file - `inst-export-cancel`
   3. [ ] - `p1` - Read matching rows consistently and write one plain-language line per change for Markdown, or every export field for JSON - `inst-export-write`
   4. [ ] - `p1` - **RETURN** `ExportResult` only after the file is complete - `inst-export-result`
5. [x] - `p1` - **RETURN** the page of changes and its next cursor - `inst-read-return`

### Undo or redo a change or batch

- [x] `p1` - **ID**: `cpt-noter-flow-core-history-undo-reverse`

**Actor**: Primary user (main window or call screen)

**Success Scenarios**:
- Undo restores the eligible rows and increments their revisions; redo later uses the same handle and writes new changes.
- One row in a batch was edited later: the others reverse and the skipped count is returned.

**Error Scenarios**:
- Wrong state: `already_undone`, `not_undone` or `not_undoable`. Every row edited later: `edited_later`. Missing target: `not_found`.

**Steps**:
1. [x] - `p1` - API: `change_undo { target }` or `change_redo { target }`, where `UndoTarget` names a change or batch; a user-pressed mark or a pause gap has no change row and so no target (it is capture data, not undoable here) - `inst-reverse-request`
2. [x] - `p1` - Run `cpt-noter-algo-core-history-undo-replay` on the writer queue - `inst-reverse-apply`
3. [x] - `p1` - After commit, publish whole changed entities through `entity:changed` or their owning service's state event; refresh transcript snapshots and per-call files for transcript changes - `inst-reverse-publish`
4. [x] - `p1` - **RETURN** `UndoResult` with `undone` and `skipped_edited_later`; no undo or redo expiry is applied - `inst-reverse-return`

## 3. Processes / Business Logic (CDSL)

### Replay a logged change safely

- [x] `p1` - **ID**: `cpt-noter-algo-core-history-undo-replay`

**Input**: Undo or redo operation, `UndoTarget`, current records and the append-only change history.

**Output**: Committed reversal and counts, or a typed error without mutations.

**Steps**:
1. [x] - `p1` - On the single writer, load the target change or every member of its batch; **IF** absent **RETURN** `not_found` - `inst-replay-load`
2. [x] - `p1` - **IF** undo is requested for an irreversible change, **RETURN** `not_undoable`; if already undone, **RETURN** `already_undone` - `inst-replay-undo-guard`
3. [x] - `p1` - **IF** redo is requested for a target that is not undone, **RETURN** `not_undone` - `inst-replay-redo-guard`
4. [x] - `p1` - Decode single deltas or bulk blobs; group operations by target row so reversing several fields never overwrites another field's restoration - `inst-replay-deltas`
5. [x] - `p1` - Compare each target with its recorded post-change state for undo, or its restored state for redo; exclude rows with later independent edits and count skipped changes - `inst-replay-check-later`
6. [x] - `p1` - **IF** every target was edited later, **RETURN** `edited_later` - `inst-replay-all-skipped`
7. [x] - `p1` - **TRY** begin one transaction for eligible changes - `inst-replay-try`
   1. [x] - `p1` - For undo, restore before-values in reverse dependency order, increase editable revisions and mark the original changes undone - `inst-replay-before`
   2. [x] - `p1` - For redo, apply after-values in forward dependency order, increase revisions and append new applied rows linked by `redo_of`; original undone rows stay undone - `inst-replay-after`
   3. [x] - `p1` - Keep reasons, actors, evidence and batch linkage in the log; update derived indexes with primary records and commit - `inst-replay-commit`
8. [x] - `p1` - **CATCH** transaction or delta failure: roll back all eligible changes and return the typed storage or log error - `inst-replay-rollback`
9. [x] - `p1` - **RETURN** counts of reversed changes and later edits kept - `inst-replay-return`

## 4. States (CDSL)

### Change reversal

- [x] `p1` - **ID**: `cpt-noter-state-core-history-undo-change`

**States**: applied, undone; proposed and rejected are read-only here (proposal decisions belong to M5)

**Initial State**: applied for an applied mutation

**Transitions**:
1. [x] - `p1` - **FROM** applied **TO** undone **WHEN** undo commits for an undoable row not edited later - `inst-st-undo`
2. [x] - `p1` - **FROM** undone **TO** undone **WHEN** redo commits; new applied rows with `redo_of` represent the reapplied change - `inst-st-redo`
3. [x] - `p1` - **FROM** applied **TO** applied **WHEN** a later edit prevents reversal or the row is irreversible - `inst-st-ineligible`
4. [x] - `p1` - **FROM** undone **TO** undone **WHEN** a later edit prevents redo - `inst-st-redo-blocked`

History derives `redoable` from current row history, including subsequent redo rows; the same undone handle cannot overwrite a later independent edit. There is no time window and no client-held redo token.

## 5. Definitions of Done

### History and export

- [ ] `p1` - **ID**: `cpt-noter-dod-core-history-undo-history`

The system **MUST** serve filtered, paged History with before/after text, reason, evidence and batch metadata, and export the chosen scope through a core-owned save panel. Exports and logs must not resurrect content removed by irreversible deletion.

**Implements**:
- `cpt-noter-flow-core-history-undo-read`

**Touches**:
- API: `history_list`, `history_export`
- DB: `changes`
- Entities: `ChangeRow`, `HistoryTarget`, `LogScope`, `ExportResult`

### Reversal without lost edits

- [x] `p1` - **ID**: `cpt-noter-dod-core-history-undo-reversal`

The system **MUST** reverse changes or whole batches through the single writer, skip later-edited rows, return exact counts, increase revisions and publish committed records. Redo must work at any later time by writing new rows, preserving the original history.

**Implements**:
- `cpt-noter-flow-core-history-undo-reverse`
- `cpt-noter-algo-core-history-undo-replay`
- `cpt-noter-state-core-history-undo-change`

**Touches**:
- API: `change_undo`, `change_redo`, `entity:changed`
- DB: `changes` and the eligible target tables
- Entities: `UndoTarget`, `UndoResult`

### Tests and gate

- [ ] `p1` - **ID**: `cpt-noter-dod-core-history-undo-tests`

The system **MUST** pass unit tests for reversal ordering, partial batches, stale records, every wrong-state error and transaction rollback; conformance tests for scopes and typed results; and real-core E2E for all four commands. E2E review and Today tick tests exercise this service under their owning story IDs. `just gate` passes.

**Implements**:
- `cpt-noter-flow-core-history-undo-read`
- `cpt-noter-algo-core-history-undo-replay`

**Touches**:
- API: the four frozen commands above

## 6. Acceptance Criteria

- [x] Review an item, undo it and redo it much later using the same handle; revisions advance on each commit and stale edits return `conflict`.
- [x] Undo and redo a three-row batch after one row is edited elsewhere: two reverse, one is counted as skipped; an all-skipped batch returns `edited_later`.
- [x] Irreversible audio deletion returns `not_undoable`; proposed rows are not applied by these commands.
- [x] Unit tests inject a commit failure and prove no partial restoration or orphan log row is visible.
- [ ] Conformance against fake and real cores checks window scope, typed errors, page shape and undo results; real-core E2E successfully calls each of the four commands, including an export via the native panel seam.
- [ ] `just gate` passes.
