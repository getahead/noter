---
title: "Feature — Activity, proposals and maintenance"
description: "Activity's proposal queue and day log, batch undo and redo, and Settings Maintenance with jobs and evidence sources."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-activity
milestone: M5
---

# Feature: Activity, proposals and maintenance


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Read and filter Activity](#read-and-filter-activity)
  - [Decide a proposal](#decide-a-proposal)
  - [Undo a batch or reopen an item](#undo-a-batch-or-reopen-an-item)
  - [Run jobs and check evidence sources](#run-jobs-and-check-evidence-sources)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Build the sections](#build-the-sections)
  - [Present an undo result](#present-an-undo-result)
- [4. States (CDSL)](#4-states-cdsl)
  - [Proposal row](#proposal-row)
  - [Maintenance run](#maintenance-run)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Activity and proposal decisions](#activity-and-proposal-decisions)
  - [Batch reversal and evidence closure](#batch-reversal-and-evidence-closure)
  - [Maintenance and verification](#maintenance-and-verification)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p6` - **ID**: `cpt-noter-featstatus-ui-activity`

## 1. Feature Context

- [ ] `p6` - `cpt-noter-feature-ui-activity`

### 1.1 Overview

Activity (⌘6) shows **Needs attention**, **Waiting for you** and the day log in one quiet list. The user expands a proposal before accepting or rejecting it, saves a glossary rule inline, and undoes a whole batch without a confirmation. Settings › **Maintenance** holds the schedule, jobs and evidence sources. The core owns every decision, change, run and count; the UI holds only selection, expanded rows, filters and feedback timers.

### 1.2 Purpose

It implements `cpt-noter-component-screen-activity`, `cpt-noter-component-ui-proposal-row` (full and compact), and the Maintenance pane of `cpt-noter-component-screen-settings`. It reuses the History, diff, undo and Item inspector components delivered in M2. Performance belongs to `cpt-noter-feature-ui-performance`.

**Requirements**: PRD › Feature specification › 10. Self-maintenance and 11. History and change log; PRD › Maintenance jobs, evidence collection and history. The PRD has no requirement IDs.

**Principles**: none newly allocated in DECOMPOSITION; follows `cpt-noter-principle-core-owns-state`, `cpt-noter-principle-undo-over-confirm`, `cpt-noter-principle-keyboard-first` through its dependencies.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Reviews proposals, reverses changes, exports the log and configures jobs |
| Noter core (system) | Proposes and applies changes, restores batches, runs jobs and detects evidence tools |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 10 and 11; Maintenance jobs, evidence collection and history
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Screen — Activity (AC-R1 to AC-R5, inspector, States); Component — Proposal row; Screen — Settings window (Maintenance); Components — Change row, Undo strip, Status row, Diff view, Item inspector
- **Design elements**: `cpt-noter-component-screen-activity`, `cpt-noter-component-ui-proposal-row`; reuses `cpt-noter-component-ui-change-row`, `cpt-noter-component-ui-history-timeline`, `cpt-noter-component-ui-undo-strip`, `cpt-noter-component-ui-diff-view`, `cpt-noter-component-ui-item-inspector`, `cpt-noter-component-ui-status-row`, `cpt-noter-component-ui-inline-banner`, `cpt-noter-component-ui-empty-state`
- **Stories delivered (M5)**: `cpt-noter-seq-activity-review-proposals`, `cpt-noter-seq-activity-undo-batch` (all paths)
- **Frozen commands delivered (M5)**: `proposals_list`, `proposal_decide`, `proposal_always_for_term`, `activity_get`, `jobs_list`, `job_run_now`, `job_cancel`, `job_update`
- **Earlier commands reused**: `history_list`, `change_undo`, `change_redo`, `history_export` (M2); `item_get`, `item_reopen` (M2); `settings_get`, `settings_update`, `glossary_list`, `window_navigate` through the existing bridge and Settings features; source repair through `cpt-noter-feature-ui-privacy-sources` (M3)
- **Events**: `proposals:counts`, `jobs:progress`, `entity:changed`, `settings:changed`, `capture:state`; the bridge subscribes before reading
- **Data**: read through the core only; `cpt-noter-dbtable-jobs` belongs to [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md). Proposal, change batch and job run are generated view records; the UI writes no database
- **Prototype modules**: `src/js/50-e-2-activity.js`, `src/js/50-e-1-components.js` (`C.proposalRow`, shared proposal actions, `C.statusRow`), `src/js/50-e-5-settings.js` (`maintenance`), `src/css/50-e.css` (`.ac-*`, `.e-prop*`, `.e-status*`, `.st-*`)
- **Dependencies**: `cpt-noter-feature-ui-history-undo`, `cpt-noter-feature-ui-settings`, `cpt-noter-feature-ui-items`
- **Manifest**: [DECOMPOSITION.md](../../DECOMPOSITION.md) › 2.29; [milestones.toml](../../../harness/milestones.toml) › M5

## 2. Actor Flows (CDSL)

### Read and filter Activity

- [ ] `p6` - **ID**: `cpt-noter-flow-ui-activity-browse`

**Actor**: Primary user

**Success Scenarios**:
- ⌘6 opens the toolbar, sticky undo slot, failures, proposals and changes in day groups; **Jobs** narrows them to job activity
- **Export Log…** exports today, 7 days, 30 days or a custom period as Markdown or JSON through the existing History export sheet

**Error Scenarios**:
- **Nothing has changed yet**, **Nothing waiting. Noter asks before it changes older records.**, or **No model changes in this period.** appears in its own section
- `change_log_unreadable` leaves proposals and failures usable and shows **Couldn't read the change log** · **Try Again** in AC-R5

**Steps**:
1. [ ] - `p6` - User opens Activity from the sidebar, ⌘6, Today › **Show All in Activity**, or Maintenance › **Show Activity** - `inst-open`
2. [ ] - `p6` - API: `activity_get` for today with actor `all`; `proposals_list` with all kinds and the first page; use `history_list` for preceding days and subsequent pages - `inst-read`
3. [ ] - `p6` - Algorithm: render sections with `cpt-noter-algo-ui-activity-sections`; a Today link focuses and expands the named proposal - `inst-sections`
4. [ ] - `p6` - User selects **All**, **Proposals**, **Jobs**, **Models** or **You** - `inst-filter`
5. [ ] - `p6` - API: reload `activity_get` and `history_list` with the corresponding actor; **Proposals** uses actor `all` and the proposal-decision view, not a new ActorFilter value - `inst-filter-read`
6. [ ] - `p6` - UI: preserve the selected filter and scroll on Back; ignore responses for an older filter or a closed page - `inst-preserve`
7. [ ] - `p6` - **IF** the day log cannot be read - `inst-if-log-error`
   1. [ ] - `p6` - UI: show its inline error; **Try Again** repeats that read once on request without clearing the other sections - `inst-log-retry`
8. [ ] - `p6` - User chooses **Export Log…**, the period and format in the History export sheet, then a location in the native save panel - `inst-export`
9. [ ] - `p6` - API: `history_export` with that scope and format; Cancel changes nothing, and a failed export stays in the sheet with its error - `inst-export-command`
10. [ ] - `p6` - **RETURN** the filtered list or saved log - `inst-return`

### Decide a proposal

- [ ] `p6` - **ID**: `cpt-noter-flow-ui-activity-decide`

**Actor**: Primary user

**Success Scenarios**:
- `cpt-noter-seq-activity-review-proposals`: expand **Apply term “ostor” to 14 older transcripts · 21 spans**, inspect the spans, press A, see **Accepted · Undo**, then the decision under **Today**
- R rejects without changing the target; T on a term proposal expands its glossary rule and **Save Rule** accepts the proposal and saves the rule

**Error Scenarios**:
- `proposal_not_applicable` or a retryable failure: **Couldn't apply** · **Try Again**
- `conflict`: **The item changed since** · **Dismiss**, with the current text and editor in expanded details; never overwrite a later edit

**Steps**:
1. [ ] - `p6` - User moves to a waiting row with ↑ or ↓ and presses Return or its disclosure - `inst-expand`
2. [ ] - `p6` - UI: show evidence and every affected span as before-and-after diffs; show the current target beside the evidence when out of date - `inst-details`
3. [ ] - `p6` - **IF** the user chooses **Always for This Term…** or T on a term row - `inst-if-rule`
   1. [ ] - `p6` - UI: expand **Glossary rule: always write ostor for “o-store”, “o store”, “O-Store”. New calls use it at once.** with **Save Rule**; opening it changes nothing - `inst-rule-preview`
   2. [ ] - `p6` - User chooses **Save Rule**; API: `proposal_always_for_term` with the proposal id and wanted `always` true, then `proposal_decide` with the shown revision and `accept` if the proposal is still waiting - `inst-rule-save`
4. [ ] - `p6` - **ELSE IF** the user chooses **Accept** (A) or **Reject** (R) - `inst-if-decision`
   1. [ ] - `p6` - API: `proposal_decide` with the id, displayed `rev` and `accept` or `reject`; lock only that row while it applies - `inst-decide`
5. [ ] - `p6` - **IF** the command succeeds - `inst-if-success`
   1. [ ] - `p6` - UI: keep **Accepted · Undo** or **Rejected · Undo** in Activity for 10 s of unhovered, unfocused time; collapse details and politely announce the result and affected count - `inst-outcome`
   2. [ ] - `p6` - UI: after a saved rule show **Saved the glossary rule for “ostor”** above the list; refresh the authoritative glossary and queue - `inst-rule-feedback`
   3. [ ] - `p6` - Store: use the highest version of `proposals:counts` for the sidebar and Today; after the outcome expires, refresh the log and show **Accepted: …** or **Rejected: …** there once - `inst-log-outcome`
6. [ ] - `p6` - **ELSE IF** the error is `conflict` - `inst-if-conflict`
   1. [ ] - `p6` - UI: show **The item changed since** with **Dismiss**; reread the target, never send its new revision automatically to accept the old proposal - `inst-conflict`
   2. [ ] - `p6` - User chooses **Dismiss**; retain the target as edited and remove the stale proposal only after the core confirms dismissal; the current dismissal contract gap is listed in Additional Context - `inst-dismiss`
7. [ ] - `p6` - **ELSE** - `inst-else-failure`
   1. [ ] - `p6` - UI: show **Couldn't apply** with **Try Again** where retry is allowed; retry only the failed operation, then reread queue and log - `inst-failure`
8. [ ] - `p6` - **IF** the user chooses **Undo** on an outcome - `inst-if-undo`
   1. [ ] - `p6` - API: `change_undo` with the returned batch id, otherwise the proposal change id; refresh queue, log and target from the core - `inst-undo`
9. [ ] - `p6` - **RETURN** the confirmed outcome or the row's recoverable error - `inst-return`

### Undo a batch or reopen an item

- [ ] `p6` - **ID**: `cpt-noter-flow-ui-activity-undo-batch`

**Actor**: Primary user

**Success Scenarios**:
- `cpt-noter-seq-activity-undo-batch`: under **Jobs**, expand the “shaman” batch of 37, inspect the diffs, press U and see **Undone 37 changes** · **Redo**; Redo also works after the strip is gone

**Error Scenarios**:
- Partial success keeps two later edits and shows **Undone 35 of 37 · 2 kept because you edited them later** · **Show**
- An item closed by mistake opens in the Item inspector with **Closed: PR #448 merged on 14 Oct** · **Reopen**

**Steps**:
1. [ ] - `p6` - User selects **Jobs**, focuses the batch and chooses **Show 37 changes**, Return or **Diff** - `inst-select`
2. [ ] - `p6` - UI: expand changes with their record, time and inline diff, 50 at a time with **Show 50 More**; reuse History reads, subject to the batch-detail gap below - `inst-diff`
3. [ ] - `p6` - User presses U or **Undo**; API: `change_undo` with the batch id (a single change uses its change id), once, without confirmation - `inst-undo`
4. [ ] - `p6` - Algorithm: use `cpt-noter-algo-ui-activity-undo-result` for returned counts and refresh the changed records - `inst-result`
5. [ ] - `p6` - **IF** the result kept later edits and the user chooses **Show** - `inst-if-kept`
   1. [ ] - `p6` - UI: open **Kept because you edited them later · 2** above the sections, showing each retained edit and **Close**; never claim to have restored those records - `inst-kept`
6. [ ] - `p6` - User chooses **Redo** from the strip, ⇧⌘Z through the shared undo service, or the undone batch row after the strip expired - `inst-redo-action`
7. [ ] - `p6` - API: `change_redo` with the same target; refresh History, showing the new change rows the core wrote and its returned skipped count - `inst-redo`
8. [ ] - `p6` - **IF** the core returns `edited_later`, `not_undoable`, `already_undone`, `not_undone`, `undo_expired` or `not_found` - `inst-if-refused`
   1. [ ] - `p6` - UI: keep the authoritative row and show the shared History error inline; reread its capabilities, never reverse text locally or retry automatically - `inst-refused`
9. [ ] - `p6` - **IF** the user chooses **Open** on an evidence closure - `inst-if-item`
   1. [ ] - `p6` - API: `item_get`; show the Item inspector in MW-R4 with the closure reason and **Reopen** - `inst-inspector`
   2. [ ] - `p6` - User chooses **Reopen**; API: `item_reopen` through the Items feature; show the open item and the user-authored History entry after success - `inst-reopen`
10. [ ] - `p6` - **RETURN** the batch's confirmed state or the reopened item - `inst-return`

### Run jobs and check evidence sources

- [ ] `p6` - **ID**: `cpt-noter-flow-ui-activity-maintenance`

**Actor**: Primary user

**Success Scenarios**:
- **Try Again** on **Evidence check failed: Jira not reachable** starts a run, shows progress, then removes the resolved failure and sidebar warning
- Settings › Maintenance shows the nightly window, jobs, evidence tools and **Show Activity**; after installing bkt outside Noter, **Check Again** changes its row from **Not configured · install bkt** to **Detected**

**Error Scenarios**:
- During a live call maintenance reads **Jobs wait until the call ends**; `job_blocked` keeps that state
- Failed runs retain counts and a safe error with **Try Again**; cancelling a run never claims its earlier committed changes were undone

**Steps**:
1. [ ] - `p6` - User chooses **Try Again** on a failed job, or **Open Settings** to its Maintenance row; a failed source opens Knowledge Sources with that source selected - `inst-enter`
2. [ ] - `p6` - API: `jobs_list`; Settings also reads `settings_get`; display each job's enabled state, trigger, last run, counts, error, running state and call block - `inst-read`
3. [ ] - `p6` - User edits **Nightly window**, **Allow on battery** or **Backups kept**; validate on blur, with backup count from 1 to 30 and valid clock times - `inst-settings`
4. [ ] - `p6` - API: `settings_update { rev, section }` with the current revision and the whole maintenance section, through the Settings window as in `cpt-noter-flow-core-settings-update`; a job switch or its battery override calls `job_update` with the wanted value from the Settings window only - `inst-update`
5. [ ] - `p6` - User chooses **Run Now** or **Try Again**; API: `job_run_now` with that job id - `inst-run`
6. [ ] - `p6` - **IF** `blocked_by_call` is set or the command returns `job_blocked` - `inst-if-blocked`
   1. [ ] - `p6` - UI: show **Waiting** and **Jobs wait until the call ends**; let the core pause or resume scheduled work, never start a local timer to bypass the block - `inst-blocked`
7. [ ] - `p6` - **ELSE** - `inst-else-running`
   1. [ ] - `p6` - UI: associate the accepted run id with the row; `jobs:progress` shows determinate progress or a spinner, counts and safe error; **Cancel** calls `job_cancel` with the job id - `inst-progress`
   2. [ ] - `p6` - Store: reread `jobs_list` and `activity_get` after a terminal run event; remove a failure only when the core reports it resolved - `inst-finish`
8. [ ] - `p6` - User sees **Jira (acli)**, **Bitbucket (bkt)**, **GitHub (gh)** and **Later calls**, with detection/version information from `jobs_list` and the evidence settings - `inst-tools`
9. [ ] - `p6` - **IF** a tool is missing - `inst-if-missing`
   1. [ ] - `p6` - UI: show **Not configured · install bkt** (or the named tool); **Check Again** rereads `jobs_list` after the user installs it in Terminal - `inst-check`
10. [ ] - `p6` - UI: keep **Closes automatically only for a linked key with a Done transition or a merged pull request; everything else is proposed.**; **Show Activity** uses the existing window navigation - `inst-policy`
11. [ ] - `p6` - **RETURN** confirmed job and evidence-tool states - `inst-return`

## 3. Processes / Business Logic (CDSL)

### Build the sections

- [ ] `p6` - **ID**: `cpt-noter-algo-ui-activity-sections`

**Input**: ActivityView, proposal pages, History pages, selected filter, expanded ids, ProposalCounts and pending feedback

**Output**: AC-R2 to AC-R5 with stable row identity and one roving focus

**Steps**:
1. [ ] - `p6` - Keep counts and records from the core; merge pages by opaque id, never parse ids or count a retained outcome as a waiting proposal - `inst-merge`
2. [ ] - `p6` - Show the sticky undo slot, then failures only for **All** or **Jobs**, then waiting proposals only for **All** or **Proposals** - `inst-sections`
3. [ ] - `p6` - **FOR EACH** day in descending local date order - `inst-days`
   1. [ ] - `p6` - Label today and yesterday, otherwise the locale's date; keep run groups and reverse chronological changes, with one row for each batch - `inst-day`
4. [ ] - `p6` - **IF** the filter is **Proposals**: show only proposal decisions in the day log; the missing decision discriminator is a contract gap below - `inst-decisions`
5. [ ] - `p6` - Distinguish an empty queue, first-use empty log, filter-empty log and failed read; show skeletons only after 300 ms - `inst-empty`
6. [ ] - `p6` - Draw only visible day and batch rows; expand at most 50 more records per action; fetch pages per section, not per visible row - `inst-window`
7. [ ] - `p6` - Preserve the focused row by id; when it leaves, focus the next row, otherwise the preceding row or section heading; keep it clear of the sticky strip - `inst-focus`
8. [ ] - `p6` - **RETURN** sections and focus target - `inst-return`

### Present an undo result

- [ ] `p6` - **ID**: `cpt-noter-algo-ui-activity-undo-result`

**Input**: UndoResult, change or batch target, its description, and current row capabilities

**Output**: full or partial outcome, refreshed History and the appropriate strip action

**Steps**:
1. [ ] - `p6` - **IF** skipped_edited_later is zero: show **Undone 37 changes** with **Redo**, using the returned count and the batch's description - `inst-full`
2. [ ] - `p6` - **ELSE**: show **Undone 35 of 37 · 2 kept because you edited them later** with **Show**, using undone plus skipped as the total - `inst-partial`
3. [ ] - `p6` - Reread History and affected entity state; trust `undoable` and `redoable` on the returned rows, not the feedback timer - `inst-refresh`
4. [ ] - `p6` - Start the shared 10-s strip, pausing while hovered or focused; × or expiry removes only the strip, never the undone row's **Redo** capability - `inst-strip`
5. [ ] - `p6` - Announce the count and action politely; do not include transcript text in diagnostics - `inst-announce`
6. [ ] - `p6` - **RETURN** the outcome with the original target retained for Redo or Show - `inst-return`

## 4. States (CDSL)

### Proposal row

- [ ] `p6` - **ID**: `cpt-noter-state-ui-activity-proposal`

**States**: WAITING, EXPANDED, RULE_OPEN, APPLYING, ACCEPTED, REJECTED, FAILED, OUT_OF_DATE, LOGGED, DISMISSED

**Initial State**: WAITING

**Transitions**:
1. [ ] - `p6` - **FROM** WAITING **TO** EXPANDED **WHEN** Return or the disclosure opens details - `inst-expand`
2. [ ] - `p6` - **FROM** EXPANDED **TO** WAITING **WHEN** details close - `inst-collapse`
3. [ ] - `p6` - **FROM** WAITING or EXPANDED **TO** RULE_OPEN **WHEN** T or **Always for This Term…** is chosen on a term proposal - `inst-rule`
4. [ ] - `p6` - **FROM** WAITING, EXPANDED or RULE_OPEN **TO** APPLYING **WHEN** an enabled decision or **Save Rule** is submitted - `inst-apply`
5. [ ] - `p6` - **FROM** APPLYING **TO** ACCEPTED or REJECTED **WHEN** the core confirms that decision - `inst-success`
6. [ ] - `p6` - **FROM** APPLYING **TO** OUT_OF_DATE **WHEN** `conflict` says the shown revision is stale - `inst-stale`
7. [ ] - `p6` - **FROM** APPLYING **TO** FAILED **WHEN** applying fails - `inst-failure`
8. [ ] - `p6` - **FROM** FAILED **TO** APPLYING **WHEN** the user chooses **Try Again** for the failed operation - `inst-retry`
9. [ ] - `p6` - **FROM** OUT_OF_DATE **TO** DISMISSED **WHEN** dismissal is confirmed without changing the target - `inst-dismiss`
10. [ ] - `p6` - **FROM** ACCEPTED or REJECTED **TO** LOGGED **WHEN** 10 s elapse outside hover and focus; compact Today rows leave immediately for its undo strip - `inst-log`
11. [ ] - `p6` - **FROM** ACCEPTED, REJECTED or LOGGED **TO** WAITING **WHEN** undo succeeds and the core returns the proposal to the queue - `inst-undo`

Only listed actions are enabled. Feedback and expansion are view state; queue membership and outcomes survive reload only through core reads. A missing proposal is reread, never recreated locally.

### Maintenance run

- [ ] `p6` - **ID**: `cpt-noter-state-ui-activity-job`

**States**: IDLE, OFF, WAITING, RUNNING, PAUSED, SUCCEEDED, FAILED, CANCELLED

**Initial State**: IDLE (reconciled with jobs_list on open)

**Transitions**:
1. [ ] - `p6` - **FROM** IDLE, SUCCEEDED, FAILED or CANCELLED **TO** OFF **WHEN** `job_update` confirms disabled - `inst-disable`
2. [ ] - `p6` - **FROM** OFF **TO** IDLE **WHEN** `job_update` confirms enabled - `inst-enable`
3. [ ] - `p6` - **FROM** IDLE, SUCCEEDED, FAILED or CANCELLED **TO** RUNNING **WHEN** the core accepts and starts a run - `inst-start`
4. [ ] - `p6` - **FROM** IDLE, SUCCEEDED, FAILED or CANCELLED **TO** WAITING **WHEN** the core queues work or blocks it during a call - `inst-wait`
5. [ ] - `p6` - **FROM** RUNNING **TO** PAUSED **WHEN** the core pauses maintenance for a live call - `inst-pause`
6. [ ] - `p6` - **FROM** WAITING or PAUSED **TO** RUNNING **WHEN** the core reports work resumed after the call - `inst-resume`
7. [ ] - `p6` - **FROM** RUNNING **TO** SUCCEEDED or FAILED **WHEN** `jobs:progress` reports that terminal status - `inst-finish`
8. [ ] - `p6` - **FROM** RUNNING, PAUSED or WAITING **TO** CANCELLED **WHEN** the core confirms cancellation - `inst-cancel`

Job enabled state and last-run status are separate core fields: switching a job off never pretends to cancel its run. Only post-call analysis may run during another call; the core reports that exception. A rejected command leaves the last confirmed state and an inline error.

## 5. Definitions of Done

### Activity and proposal decisions

- [ ] `p6` - **ID**: `cpt-noter-dod-ui-activity-proposals`

The system **MUST** render AC-R1 to AC-R5 and both proposal variants from core records, with the prototype's text, evidence, inline rule, outcomes and empty/error states. Full rows retain decisions for 10 s; compact Today rows use Today's undo strip. It must retain edits after a conflict, disable repeat submissions and keep authoritative counts in sync. The contract gaps below must be resolved before the affected story paths can be counted as delivered.

**Implements**:
- `cpt-noter-flow-ui-activity-browse`
- `cpt-noter-flow-ui-activity-decide`
- `cpt-noter-algo-ui-activity-sections`
- `cpt-noter-state-ui-activity-proposal`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `activity_get`, `proposals_list`, `proposal_decide`, `proposal_always_for_term`, `history_list`, `history_export`
- Tests: unit tests for actor filters, stale reads, waiting counts, row focus, rule-save partial failure and paused outcome timers; conformance for revisions, all proposal kinds, queue pagination and outcomes against fake and real core; E2E `cpt-noter-seq-activity-review-proposals` (happy, nothing waiting, couldn't apply, item changed since, always for this term)

### Batch reversal and evidence closure

- [ ] `p6` - **ID**: `cpt-noter-dod-ui-activity-history`

The system **MUST** reuse History's change rows, diffs and undo service for single and batch reversal, partial results and persistent Redo, including **Show** for kept edits. **Open** must route an item to the inspector, a call to its page and a person to its page. Evidence closure must show its reason and **Reopen**. Export must reuse the period/format sheet and native save panel.

**Implements**:
- `cpt-noter-flow-ui-activity-undo-batch`
- `cpt-noter-algo-ui-activity-undo-result`

**Constraints**: `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `history_list`, `change_undo`, `change_redo`, `history_export`, `item_get`, `item_reopen`
- Tests: unit tests for 37/0 and 35/2 results, strip expiry, focus and disallowed capabilities; conformance for batch restoration, later-edit skipping and redo after expiry; E2E `cpt-noter-seq-activity-undo-batch` (every path, including unreadable and empty logs)

### Maintenance and verification

- [ ] `p6` - **ID**: `cpt-noter-dod-ui-activity-maintenance`

The system **MUST** render Maintenance's schedule, job and evidence sections, persist wanted settings, show progress and Cancel, and respect call-blocked and paused work. Failed jobs and sources must stay visible until resolved, with a working Settings deep link. Evidence tools are detected by the core under the user's existing logins; the WebView never installs tools, runs subprocesses or stores their credentials.

**Implements**:
- `cpt-noter-flow-ui-activity-maintenance`
- `cpt-noter-state-ui-activity-job`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-no-dialog-after-setup`

**Touches**:
- Commands: `jobs_list`, `job_run_now`, `job_cancel`, `job_update`, `settings_get`, `settings_update`
- Tests: unit tests for job-state mapping, settings validation and run-id matching; conformance for window scopes, duplicate Run Now, job_blocked, cancellation and tool detection; E2E `cpt-noter-seq-activity-review-proposals` (job failed and evidence tool missing), plus Maintenance scheduling and cancellation
- Visual: all Activity states and Maintenance normal, failed, call-blocked and tool-missing states, in light, dark, Increase Contrast, narrow and German layouts, in the pinned screenshot container

Write failing tests before implementation. Prove the eight M5 frozen commands against the real core; fake runs alone do not count. Keep the HARNESS coverage, screenshot, performance and trace bars. Resolve the listed contract gaps and run the required checks: `just gate` passes.

## 6. Acceptance Criteria

- [ ] Both M5 Activity stories pass every path against the real core, with their exact story IDs in E2E test titles
- [ ] Expanding the ostor proposal shows all 21 spans; Accept updates 14 transcripts, preserves later edits and logs one batch; Reject changes no target
- [ ] Batch undo restores 37 changes, or exactly 35 while keeping two later edits; Redo remains on the row after the 10-s strip expires
- [ ] ↑/↓ roves through rows; Return expands; physical A, R, T and U work only on a focused row outside an editor; Tab leaves the list
- [ ] Outcomes announce politely, timers pause on hover/focus, and the sticky strip never covers the focused row; German actions wrap without truncating
- [ ] Every failure offers its supported recovery, never an automatic retry; no transcript, diff or evidence text reaches log_ui
- [ ] Maintenance shows defaults 02:00–05:00, battery off and seven backups from the core; Check Again reflects real tool detection; work waits through live capture

## 7. Additional Context

**Prototype reuse.** Rewrite `screen('activity')` in `src/js/50-e-2-activity.js` as ActivityPage with AttentionSection, ProposalList and ActivityDayGroups. Rewrite `C.proposalRow` and its shared actions in `src/js/50-e-1-components.js` as ProposalRow and a typed command controller, shared with Today. Reuse the existing StatusRow, ChangeRow, DiffView, UndoStrip and ItemInspector React components; rewrite `maintenance` in `src/js/50-e-5-settings.js` as MaintenancePane in the Settings window. Keep the emitted component, primitive, region, variant, size and state attributes and the `.ac-*`, `.e-prop*`, `.e-status*`, `.st-*` styles from `src/css/50-e.css`. Sample records, local outcome maps, fake retry timers and hardcoded OPEN/BEFORE mappings are source of truth for appearance only; production uses generated core records. The log export sheet comes from `src/js/30-c-dialogs.js` through the dialog host.

**States coverage.**

| DESIGN state | Prototype state or component state |
| --- | --- |
| Normal | `default` |
| Nothing has changed yet; Nothing waiting; Filter shows nothing | `nothing-changed`, `nothing-waiting`, `filter-empty` |
| Loading; Change log unreadable | `loading`, `log-unreadable` |
| Job or sync failed | `job-failed`, normal failed source/backup rows |
| Applying; Accepted or rejected | `applying`, ProposalRow `accepted` / `rejected` |
| Couldn't apply; Item changed since | `couldnt-apply`, `item-changed` |
| Batch undone; Some changes edited later; Undo strip gone | `batch-undone`, `partial-undo`, `strip-gone` |
| Item closed by mistake | normal evidence-closure row → existing Item inspector |
| Maintenance running, failed, call-blocked, missing tool | StatusRow `running`, Settings `job-failed`, `jobs-during-call`, `evidence-missing` |

**DESIGN versus prototype.** The prototype normal Activity includes failed Confluence and backup rows, so normal screenshots include them. Its outcome timer runs for 10 s without hover/focus pausing, and its batch demo pins the strip for 600,000 ms; these are runtime simplifications, not product timing rules. Use the shared accessible 10-s timer. The prototype omits running-job Cancel and simulates a successful run even during capture; follow the core's call block and the PRD's Cancel behavior using the existing status-row look. It does not wire the row keys, virtualisation or 50-record paging; implement DESIGN's keyboard and paging rules. Its reconciliation preview says 21 spans but renders three examples; production must show every returned span. No design or prototype file is changed here.

**Contract and fake-core gaps.** These are prerequisites for implementation, not new API definitions:

| Gap | Effect and required resolution |
| --- | --- |
| ProposalRow has no actor, numeric confidence, affected-span diffs or current editor; confidence is only a coarse ConfidenceLevel | The full proposal anatomy and 21-span preview cannot come from this record. The contract owner must provide the view data; do not hardcode 0.88 or sample spans |
| `proposal_always_for_term` returns a GlossaryTerm and the fake leaves the proposal waiting | Save Rule currently needs a separate accept. If rule save succeeds but accept fails, preserve the saved rule, report the failed acceptance, reread both and retry only acceptance. Atomic save-and-accept is not guaranteed by the current contract |
| Dismiss has no command or decision value; proposal_decide only accepts accept/reject | Do not silently equate dismissal with rejection or clear the sidebar count locally. Durable stale-proposal dismissal needs an owner-defined contract meaning |
| ActivityArgs is one day and ActorFilter has no proposals; HistoryListArgs has no batch selector or proposal-decision discriminator | Read prior days through history_list; **Proposals** is a view filter, not an invented enum value. Complete batch details and decision-only filtering need a supported mapping/data contract; do not identify decisions by English summary prefixes |
| UndoResult returns skipped counts only | The two kept records and later edits for **Show** cannot be recovered reliably from counts; the owner must supply the detail mapping through the History contract |
| ActivityView.needs_attention contains job runs, not source identities | Use the source feature's existing reads for source failures; selecting the failed source needs its actual SourceId, never a guessed job id |
| Fake activity_get ignores day and collapses job/model filtering; decisions remove proposals without writing/restoring the full History batch; fake undo never skips later edits | Use typed scenario handlers for UI states and extend fake/real conformance in the owning lane before claiming those behaviors delivered |
| Fake jobs complete after one second; they do not model scheduler pause/resume, tool re-detection or stale run races | Prove these with scripted conformance and real-core E2E; ignore progress from a superseded run id and reconcile with jobs_list on reopen |

**Operational boundaries.** Diagnostics use command name, code and ids only. Lists and event listeners are released on route/window close; stale reads cannot replace a newer filter. Settings owns persistence and validation errors. Core transactions, evidence classification, backups, retention, job scheduling and migrations are outside this UI feature. There is no new service, network path, plugin hook, authentication system, audit store or rollout mechanism here; these checklist areas are not applicable because the feature uses the local typed bridge and existing core services. Evidence links and diffs render as escaped content, with external links sent through the shared opener. Existing History and Settings remain the fallback while a dependent contract path is unavailable; this is not evidence that the M5 story passed.

**Milestone notes.** M5 assigns exactly the eight commands and two stories above. History, undo, exports, item reopening and source repair are earlier dependencies; none is moved to M5. DECOMPOSITION's overview lists no M5-specific milestone discrepancy. Registration in artifacts.toml and implementation markers remain outside this spec-only change.
