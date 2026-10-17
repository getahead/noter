---
title: "Feature — History, change log and undo"
description: "Read changes, undo or redo them, and export a call’s log."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-history-undo
milestone: M2
---

# Feature: History, change log and undo


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Read and filter a history](#read-and-filter-a-history)
  - [Undo or redo a change](#undo-or-redo-a-change)
  - [Export a call log](#export-a-call-log)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Undo strip timing and target](#undo-strip-timing-and-target)
- [4. States (CDSL)](#4-states-cdsl)
  - [History read](#history-read)
  - [Undo strip](#undo-strip)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Timeline, diff and export](#timeline-diff-and-export)
  - [Shared reversible actions](#shared-reversible-actions)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p3` - **ID**: `cpt-noter-featstatus-ui-history-undo`

## 1. Feature Context

- [ ] `p3` - `cpt-noter-feature-ui-history-undo`

### 1.1 Overview

Show the append-only history of a call, person or item, with actor and job filters, inline diffs, Undo and Redo. Inline outcomes and the shared undo strip point to the same core change or batch; dismissing a strip never expires History actions. Activity and its day log belong to M5.

### 1.2 Purpose

Read changes, undo or redo them, and export a call’s log.

**Requirements**: PRD › Feature specification › 11. History and change log; Maintenance jobs, evidence collection and history › Change log. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-undo-over-confirm`, `cpt-noter-principle-core-owns-state`, `cpt-noter-principle-keyboard-first`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Read changes, undo or redo them, and export a call’s log. |
| Noter core (system) | Owns persisted records, permissions and jobs; returns typed views and errors |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 11. History and change log; Maintenance jobs, evidence collection and history › Change log
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2; 3.6 stories below
- **Decomposition**: [DECOMPOSITION.md](../../DECOMPOSITION.md) › M2, History, change log and undo; NOT_STARTED
- **Design elements**: `cpt-noter-component-ui-undo-strip`, `cpt-noter-component-ui-change-row`, `cpt-noter-component-ui-history-timeline`
- **Stories**: None owned. Serves M2 `cpt-noter-seq-call-page-review-outputs` (No changes yet; Export the call’s change log), `cpt-noter-seq-call-page-check-evidence` (Item History), and undo paths in `cpt-noter-seq-today-tick-item` and `cpt-noter-seq-call-page-review-suggested-items`
- **Frozen commands it delivers (M2)**: `history_list`, `change_undo`, `change_redo`, `history_export`
- **Contract**: `apps/desktop/src/core/bindings.ts`; `apps/desktop/src/core/fake/handlers.ts` and `fake-core.ts`; generated types are used without redefining them
- **Prototype modules**: `src/js/04-shared.js` › `C.undoStrip`; `src/js/30-c-0-components.js` › `C.changeRow`, `C.historyTimeline`; `src/js/30-c-callpage.js` › History; `src/js/30-c-dialogs.js` › `dlg-export-log`; `.np-undo`, `.pc-hist*`, `.pc-chg*`
- **Dependencies**: `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-dialogs-host`

## 2. Actor Flows (CDSL)

### Read and filter a history

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-history-undo-read`

**Actor**: Primary user

**Success Scenarios**:
- History opens newest first, grouped as Today, Yesterday, then dates; empty history reads **No changes yet**.
- Call and person filters are **All**, **You**, **Jobs**, **Models**, then **All jobs**; item History uses an actor pop-up only.

**Error Scenarios**:
- A filtered empty result names the filter and keeps **All** available.
- `change_log_unreadable`: **Couldn’t read the history of this call.** · **Try Again**.

**Steps**:
1. [ ] - `p1` - User opens Call page › **History**, Item inspector › **History**, or the delivered person host - `inst-open`
2. [ ] - `p1` - API: `history_list` with the record target, actor **all**, no job and the first page; show skeleton rows after 300 ms - `inst-read`
3. [ ] - `p1` - **IF** the read fails - `inst-error`
   1. [ ] - `p1` - Show the section error; **Try Again** repeats this read only - `inst-retry`
   2. [ ] - `p1` - **RETURN** the retryable history error - `inst-end-error`
4. [ ] - `p1` - UI: date groups and change rows with time, actor, description, target, batch count and available core metadata - `inst-render`
5. [ ] - `p1` - User chooses an actor or job; request the first page for that filter, discard superseded reads, and announce the returned count politely - `inst-filter`
6. [ ] - `p1` - User toggles **Diff** on a row with before and after; show inserted and deleted words, or **No differences** - `inst-diff`
7. [ ] - `p1` - User expands a batch; show at most 50 known member rows, then **Show 50 More** only when real members can be read - `inst-batch`
8. [ ] - `p1` - **RETURN** the filtered history; **Open** routes to the changed record without losing the history filter - `inst-return`

### Undo or redo a change

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-history-undo-reverse`

**Actor**: Primary user

**Success Scenarios**:
- Row **Undo**, U on the focused row, ⌘Z, or the inline outcome all target the same change; a batch reverses as one action.
- After undo, **Redo** stays on the row even after the strip leaves.

**Error Scenarios**:
- Rows edited later are kept and counted in **Undone 35 of 37 · 2 kept because you edited them later**.
- `not_undoable`, `already_undone`, `not_undone`, `edited_later`, `undo_expired` or `not_found` leave records intact and refresh available actions.

**Steps**:
1. [ ] - `p1` - User chooses **Undo** or **Redo**; resolve the returned change id or batch id, never a row index - `inst-choose`
2. [ ] - `p1` - UI: busy action, suppress duplicate submissions for that target - `inst-working`
3. [ ] - `p1` - API: `change_undo` or `change_redo` with the typed `UndoTarget` - `inst-call`
4. [ ] - `p1` - **IF** the command fails - `inst-failed`
   1. [ ] - `p1` - Keep the current records; show the named error, refresh History and enable an explicit retry only when still valid - `inst-keep`
   2. [ ] - `p1` - **RETURN** the unchanged view - `inst-return-failure`
5. [ ] - `p1` - Refresh the affected core views and `history_list`; do not locally reconstruct inverse writes - `inst-refresh`
6. [ ] - `p1` - UI: **Undone 37 changes · Redo**, or the single-change message, using the returned counts; partial result offers **Show** for kept records when available - `inst-strip`
7. [ ] - `p1` - **RETURN** the core’s restored records and append-only history - `inst-finish`

### Export a call log

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-history-undo-export`

**Actor**: Primary user

**Success Scenarios**:
- M2 review-outputs story: **Export Log…** → **Whole call** → **JSON** → **Exported log to Downloads/Noter log 16 Oct.json**.

**Error Scenarios**:
- Save-panel cancellation changes nothing; write failure keeps the sheet and chosen format for retry.

**Steps**:
1. [ ] - `p1` - User clicks **Export Log…** in call History; dialog host opens `dlg-export-log` with the call title - `inst-open`
2. [ ] - `p1` - UI: **Period: Whole call**, **Format: Markdown** or **JSON**, **Cancel**, **Export…** - `inst-choose`
3. [ ] - `p1` - User exports; API: `history_export` with call log scope and selected format; the core owns the save panel - `inst-export`
4. [ ] - `p1` - **IF** `cancelled`: **RETURN** to History without a success status - `inst-cancel`
5. [ ] - `p1` - **IF** export fails: keep the sheet and show **Try Again**; **RETURN** no exported path - `inst-error`
6. [ ] - `p1` - **RETURN** **Exported log to** the returned Finder-style path, announced politely - `inst-done`

## 3. Processes / Business Logic (CDSL)

### Undo strip timing and target

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-history-undo-strip`

**Input**: Core change or batch target, outcome, pointer and focus, elapsed visible time

**Output**: Visible strip and available action

**Steps**:
1. [ ] - `p1` - Keep the immutable target with the message; show for 10 s without taking focus or drawing a countdown - `inst-show`
2. [ ] - `p1` - **IF** hovered or focused: pause expiry; restart 10 s only when both end - `inst-pause`
3. [ ] - `p1` - **IF** working: retain the message and spinner until the command settles - `inst-work`
4. [ ] - `p1` - **IF** undo succeeded: switch once to **Redo** for the same target; subsequent actions remain in History - `inst-switch`
5. [ ] - `p1` - **IF** 10 s elapse or × is clicked or Esc is pressed on the strip: hide it without removing row actions - `inst-dismiss`
6. [ ] - `p1` - **RETURN** the strip; ⌘Z and ⇧⌘Z use this target only while it remains the last applicable change; text fields keep native text undo - `inst-return`

## 4. States (CDSL)

### History read

- [ ] `p1` - **ID**: `cpt-noter-state-ui-history-undo-read`

**States**: LOADING, READY, EMPTY, FILTERED_EMPTY, ERROR

**Initial State**: LOADING

**Transitions**:
1. [ ] - `p1` - **FROM** LOADING **TO** READY **WHEN** the current read returns rows - `inst-ready`
2. [ ] - `p1` - **FROM** LOADING **TO** EMPTY **WHEN** the unfiltered read returns none - `inst-empty`
3. [ ] - `p1` - **FROM** LOADING **TO** FILTERED_EMPTY **WHEN** a selected filter returns none - `inst-filtered`
4. [ ] - `p1` - **FROM** LOADING **TO** ERROR **WHEN** the read fails - `inst-error`
5. [ ] - `p1` - **FROM** ERROR **TO** LOADING **WHEN** the user chooses **Try Again** - `inst-retry`
6. [ ] - `p1` - **FROM** READY, EMPTY, FILTERED_EMPTY **TO** LOADING **WHEN** the target or filter changes - `inst-refilter`

### Undo strip

- [ ] `p1` - **ID**: `cpt-noter-state-ui-history-undo-strip`

**States**: HIDDEN, VISIBLE, PAUSED, WORKING, SWITCHED, PARTIAL

**Initial State**: HIDDEN

**Transitions**:
1. [ ] - `p1` - **FROM** HIDDEN **TO** VISIBLE **WHEN** an undoable action returns a target - `inst-show`
2. [ ] - `p1` - **FROM** VISIBLE, SWITCHED, PARTIAL **TO** PAUSED **WHEN** hover or focus starts; retain the action and message - `inst-pause`
3. [ ] - `p1` - **FROM** PAUSED **TO** VISIBLE **WHEN** hover and focus both end; retain the action and restart 10 s - `inst-resume`
4. [ ] - `p1` - **FROM** VISIBLE, PAUSED, SWITCHED, PARTIAL **TO** WORKING **WHEN** the action is invoked - `inst-work`
5. [ ] - `p1` - **FROM** WORKING **TO** SWITCHED **WHEN** the command succeeds fully - `inst-undo`
6. [ ] - `p1` - **FROM** WORKING **TO** PARTIAL **WHEN** edited-later records were skipped - `inst-partial`
7. [ ] - `p1` - **FROM** WORKING **TO** VISIBLE **WHEN** the command fails; show error without a success message - `inst-fail`
8. [ ] - `p1` - **FROM** VISIBLE, SWITCHED, PARTIAL, PAUSED **TO** HIDDEN **WHEN** dismissed, or the unpaused timer expires - `inst-hide`

## 5. Definitions of Done

### Timeline, diff and export

- [ ] `p3` - **ID**: `cpt-noter-dod-ui-history-undo-timeline`

The system **MUST** render all three timeline variants, actor and job filters, empty/error states, 50-row disclosures where the contract supplies members, and the call Export Log sheet.

**Implements**:
- `cpt-noter-flow-ui-history-undo-read`
- `cpt-noter-flow-ui-history-undo-export`
- `cpt-noter-state-ui-history-undo-read`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `history_list`, `history_export`
- Tests: unit filter, stale-response, paging and date-group tests; conformance for targets, actor/job filters, cursors, export and cancellation; real-core E2E `cpt-noter-seq-call-page-review-outputs` (No changes yet, Export log), `cpt-noter-seq-call-page-check-evidence` (Item History); screenshots of each timeline variant

### Shared reversible actions

- [ ] `p3` - **ID**: `cpt-noter-dod-ui-history-undo-undo`

The system **MUST** bind row, strip and app-menu actions to core targets, show partial counts, preserve actions after expiry, pause timers on hover/focus and keep standard editor undo.

**Implements**:
- `cpt-noter-flow-ui-history-undo-reverse`
- `cpt-noter-algo-ui-history-undo-strip`
- `cpt-noter-state-ui-history-undo-strip`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `change_undo`, `change_redo`
- Tests: unit fake-clock timing, focus, duplicate-submit and target tests; conformance undo/redo by change and batch including edited-later rows; E2E `cpt-noter-seq-today-tick-item` and `cpt-noter-seq-call-page-review-suggested-items`; screenshots of working, undone and partial strips

**Completion gate.** Write the failing tests first. Unit and changed-line coverage meet 80% per side; conformance runs against fake and real core. E2E names the DESIGN story IDs and exercises the real core; fake-only runs do not count toward the 60% delivered frozen-command and story bars. Native tests spell story IDs with underscores. Screenshots meet 98% in the pinned WebKit container; due performance scenarios meet the 60% coverage bar and stay within 10% of base instruction counts. Trace coverage never falls. `just gate-fast` stays green; `just gate` passes.

## 6. Acceptance Criteria

- [ ] No checkbox or timer expiry removes Undo or Redo from History.
- [ ] Filtering announces one count, keeps roving row focus and never hides it under sticky headers.
- [ ] Undo and redo use returned counts and core views, including partial results.
- [ ] Export cancellation produces no exported status; JSON and Markdown export the selected call only.

## 7. Additional Context

**Prototype reuse.** Rewrite `C.undoStrip`, `C.changeRow` and `C.historyTimeline` as `UndoStrip`, `ChangeRow` and `HistoryTimeline` React components; retain their DOM, tokens and data attributes. Port `.np-undo`, `.pc-hist*` and `.pc-chg*` from the shared and Group C styles. Use the dialog host for `dlg-export-log`; macOS draws its save panel. No sample log records or prototype inverse callbacks enter production.

**States coverage.** Ready, empty (`history-empty`), actor/job-filtered empty, loading and error use the timeline; visible, paused, working, switched, partial and gone use the strip; rows cover single, batch, model run and undone. Item History is 320 pt with no job or export control. Person History is reusable in M2; its page arrives in M3.

**DESIGN versus prototype.** Prototype batch members and model metadata are sample strings; they are source-of-truth presentation only. The prototype’s short in-memory diffs and synthetic batch rows cannot stand in for persisted changes. Single-key U and app undo need production wiring (README limitation).

**Contract limits.** `history_list` has no batch-member filter; `ChangeRow` has no full member list, skill/cost metadata or kept-record details in `UndoResult`. Show only returned rows and counts. Full arbitrary batch expansion, model metadata and **Show** for kept rows need owner contract work before those details can pass acceptance; do not synthesize records. The fake changes log flags on undo and does not restore every underlying entity, so real-core conformance must prove restoration and append-only undo rows.

**Data.** Core-owned `cpt-noter-dbtable-changes`; the UI reads through the bridge only.

**Not applicable.** Activity’s app-wide filters and batch jobs ship in M5. This feature creates no database schema, network integration, migration, credential, deployment or independent health endpoint. Shared core-bridge logging uses codes and ids, never before/after text.
