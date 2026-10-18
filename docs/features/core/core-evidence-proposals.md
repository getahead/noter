---
title: "Feature: Evidence, proposals and Activity"
description: "Evidence-based closure of accepted items, guarded proposal decisions, glossary rules and the Activity day log."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M5
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Evidence, proposals and Activity

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Read Activity and waiting proposals](#read-activity-and-waiting-proposals)
  - [Accept or reject a proposal](#accept-or-reject-a-proposal)
  - [Undo a batch from Activity](#undo-a-batch-from-activity)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Collect and classify evidence](#collect-and-classify-evidence)
  - [Close only on linked completion](#close-only-on-linked-completion)
  - [Apply a guarded decision](#apply-a-guarded-decision)
  - [Assemble Activity and counts](#assemble-activity-and-counts)
- [4. States (CDSL)](#4-states-cdsl)
  - [Proposal and applied change](#proposal-and-applied-change)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Evidence closure and proposals](#evidence-closure-and-proposals)
  - [Decisions and Activity](#decisions-and-activity)
  - [Undo integration and proof](#undo-integration-and-proof)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p6` - **ID**: `cpt-noter-featstatus-core-evidence-proposals`

- [ ] `p6` - `cpt-noter-feature-core-evidence-proposals`

## 1. Feature Context

### 1.1 Overview

The evidence job checks Jira, Bitbucket, GitHub and later calls, attaches evidence and either closes an accepted item under the strict rule or proposes a change. The change-log service gains proposal decisions and the Activity read model. Every automatic closure is visible, undoable and available to the next call's carry-forward review.

Term and people reconciliation beyond propose-only is out of scope. The maintenance feature finds reconciliation candidates; this feature lists and applies their proposals. M2 history, undo, redo and item reopening are reused.

### 1.2 Purpose

Let the user review the night's changes in one list and reverse a wrong correction. Strong linked evidence can close accepted work; weaker evidence must wait for a decision.

**Requirements**: PRD › Feature specification › 10. Self-maintenance and 11. History and change log; PRD › Maintenance jobs, evidence collection and history › Evidence rules; PRD › Success metrics › Maintenance.

**Principles**: None assigned by the decomposition; writes use the existing change-log boundary.

**Delivers**:
- Frozen commands (M5): `proposals_list`, `proposal_decide`, `proposal_always_for_term`, `activity_get`.
- Events: `proposals:counts`, `entity:changed`, `jobs:progress` for the evidence run.
- DESIGN-core sequence: `cpt-noter-seq-core-evidence-close`.
- DESIGN.md stories (M5): `cpt-noter-seq-activity-review-proposals`, `cpt-noter-seq-activity-undo-batch`.
- Supporting commands from earlier milestones: `change_undo`, `change_redo`, `history_list`, `history_export`, `item_get`, `item_reopen`; M5 job retry uses `job_run_now` from maintenance. These are not counted again as delivered commands here.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Reviews evidence, accepts or rejects proposals, saves a term rule, undoes a batch |
| Main window | Requests Activity and proposals and sends decisions |
| Scheduler | Runs evidence collection hourly while items remain open and after calls |
| Jira, Bitbucket and GitHub tools | Supply status transitions and merged pull requests under the user's login |
| Later-call analysis | Supplies local speech judgements with spans |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md), Self-maintenance, History, Evidence rules and Maintenance success metrics
- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-evidence-proposals`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md), 3.1 Item status × review, 3.2 Jobs and Change log, 3.3 History commands, 3.5 Evidence tools, 3.6 Close an item on evidence; [DESIGN.md](../../DESIGN.md), Activity and its two stories
- **Components**:
  - [ ] `p6` - `cpt-noter-component-core-jobs`
  - [ ] `p6` - `cpt-noter-component-core-changelog`
- **Data**: `cpt-noter-dbtable-evidence`; proposals reuse `changes` and job runs rather than a new proposals table
- **Dependencies**: `cpt-noter-feature-core-maintenance`, `cpt-noter-feature-core-items-today`, `cpt-noter-feature-core-llm-gate`
- **Contract**: `crates/noter-protocol/src/model/history.rs`, item evidence views, job and glossary types, `ipc/mod.rs`, `contracts/ipc.manifest.json`

## 2. Actor Flows (CDSL)

### Read Activity and waiting proposals

- [ ] `p1` - **ID**: `cpt-noter-flow-core-evidence-proposals-read`

**Actor**: Primary user (main window)

**Success Scenarios**:
- Activity shows failed runs, proposals and day groups with batches, diffs, evidence and undo/redo availability.
- An empty day or queue returns empty collections and zero waiting counts.

**Error Scenarios**:
- A bad day or page cursor returns `invalid_input`; an unreadable change log returns `change_log_unreadable` for Try Again.

**Steps**:
1. [ ] - `p1` - API: `activity_get` with optional local day and actor filter; default an omitted day to today using the injected clock - `inst-read-activity`
2. [ ] - `p1` - Run `cpt-noter-algo-core-evidence-proposals-activity` - `inst-read-build`
3. [ ] - `p1` - API: `proposals_list` with kind filters and cursor page when requesting the waiting queue - `inst-read-proposals`
4. [ ] - `p1` - DB: SELECT proposed changes using the status index, filter by requested kinds and return a stable cursor page of `ProposalRow`, including target revision, reason, count, term and evidence - `inst-read-page`
5. [ ] - `p1` - **RETURN** `ActivityView` or the requested proposal page; no placeholder evidence or fabricated changes - `inst-read-return`

### Accept or reject a proposal

- [ ] `p1` - **ID**: `cpt-noter-flow-core-evidence-proposals-decide`

**Actor**: Primary user (main window, expanded proposal)

**Success Scenarios**:
- Acceptance applies a propagation as one undoable batch; rejection records the decision without changing the target.
- Saving a term rule accepts the term proposal and updates the glossary for new calls.

**Error Scenarios**:
- Stale acceptance returns `conflict` with the current revision; an inapplicable proposal returns `proposal_not_applicable` without partial writes.
- A missing proposal returns `not_found`; a failed write leaves the proposal waiting for Try Again.

**Steps**:
1. [ ] - `p1` - The user inspects before/after values and evidence before choosing Accept or Reject - `inst-decide-inspect`
2. [ ] - `p1` - API: `proposal_decide` with proposal id, displayed `rev` and decision - `inst-decide-call`
3. [ ] - `p1` - Run `cpt-noter-algo-core-evidence-proposals-apply`; stale acceptance keeps the current target and proposal unchanged - `inst-decide-apply`
4. [ ] - `p1` - **IF** the user saves Always for This Term on a term proposal - `inst-decide-always`
   1. [ ] - `p1` - API: `proposal_always_for_term` with proposal id and `always` - `inst-decide-rule-call`
   2. [ ] - `p1` - Load the term proposal and current glossary rule under the writer; reject a non-term, missing or stale applicable target before changing either - `inst-decide-rule-check`
   3. [ ] - `p1` - Apply the pending term batch and persist the requested glossary rule through the logged write path as one decision; rollback both on failure - `inst-decide-rule-write`
   4. [ ] - `p1` - **RETURN** `GlossaryTerm`; future calls use the rule, while future retroactive reconciliation still proposes changes - `inst-decide-rule-return`
5. [ ] - `p1` - Publish entity invalidations and refreshed `proposals:counts` after commit; **RETURN** `ProposalOutcome` for an ordinary decision - `inst-decide-return`

### Undo a batch from Activity

- [ ] `p1` - **ID**: `cpt-noter-flow-core-evidence-proposals-undo`

**Actor**: Primary user (main window)

**Success Scenarios**:
- One action undoes the batch; Redo remains available after the ten-second UI strip disappears.
- Partial undo preserves later user edits and reports their count; Open exposes the item and its closing evidence with Reopen.

**Error Scenarios**:
- All rows edited later: `edited_later`; wrong undo/redo state: `already_undone` or `not_undone`; irreversible changes: `not_undoable`.

**Steps**:
1. [ ] - `p1` - The user expands a batch in Activity and selects Undo - `inst-undo-select`
2. [ ] - `p1` - API: existing `change_undo` with the batch `UndoTarget`; delegate restoration and later-edit checks to `cpt-noter-feature-core-history-undo` - `inst-undo-call`
3. [ ] - `p1` - **RETURN** `UndoResult` with restored and skipped counts; refresh Activity so the batch is undone and redoable where allowed - `inst-undo-result`
4. [ ] - `p1` - **IF** the user selects Redo, even after the strip expired - `inst-undo-redo`
   1. [ ] - `p1` - API: existing `change_redo` with the same target; write new change rows through history and refresh Activity - `inst-undo-redo-call`
5. [ ] - `p1` - **IF** the user opens an evidence-closed item and chooses Reopen - `inst-undo-reopen`
   1. [ ] - `p1` - API: existing `item_get` and `item_reopen` with the current item revision; preserve evidence and show the user's reopening in History - `inst-undo-reopen-call`

## 3. Processes / Business Logic (CDSL)

### Collect and classify evidence

- [ ] `p1` - **ID**: `cpt-noter-algo-core-evidence-proposals-collect`

**Input**: Eligible evidence run, evidence settings, open items and later calls.

**Output**: Evidence rows, applied closures or proposed changes, run counts and typed failures.

**Steps**:
1. [ ] - `p1` - Admit the run only outside live capture under maintenance power policy; read accepted open work and handed-off items awaiting evidence, plus suggested candidates that can only receive proposals - `inst-collect-select`
2. [ ] - `p1` - Detect enabled `acli`, `bkt` and `gh` tools and tested versions under the user's login; never store their tokens or infer completion from a missing or signed-out tool - `inst-collect-tools`
3. [ ] - `p1` - **IF** a required tool is missing or unsupported, report not configured and `evidence_tool_missing` or `cli_version_unsupported` for its attempted run rather than inventing evidence - `inst-collect-tool-error`
4. [ ] - `p1` - **FOR EACH** candidate in batches of at most 200, yielding to capture between batches - `inst-collect-loop`
   1. [ ] - `p1` - Route each enabled external lookup through the LLM egress gate, which writes `audit_log` with kind lookup before dispatch; pass keys as subprocess arguments, never shell commands - `inst-collect-egress`
   2. [ ] - `p1` - Read Jira status category and transition date, and Bitbucket/GitHub merged pull requests whose title, branch or description carries the user-linked key; require the default target branch - `inst-collect-external`
   3. [ ] - `p1` - Judge owner utterances about completion in later calls on the same topic with the local model and preserve the cited time span; sensitive call content stays local - `inst-collect-speech`
   4. [ ] - `p1` - Run `cpt-noter-algo-core-evidence-proposals-close` for each collected fact - `inst-collect-classify`
5. [ ] - `p1` - **IF** a tracker cannot be reached, fail the run with `tracker_unreachable`; preserve earlier committed batches and their counts, and allow a fresh run through Run now - `inst-collect-unreachable`
6. [ ] - `p1` - **RETURN** counts and `jobs:progress`; a retry must not create a second closure or duplicate waiting proposal for the same target and evidence - `inst-collect-return`

### Close only on linked completion

- [ ] `p1` - **ID**: `cpt-noter-algo-core-evidence-proposals-close`

**Input**: Candidate item and revision, evidence source, reference, date and confidence.

**Output**: An undoable closure, a waiting proposal or no mutation.

**Steps**:
1. [ ] - `p1` - DB: under the writer, reload the item and verify its revision and current review/status; skip a removed or already closed item - `inst-close-recheck`
2. [ ] - `p1` - Recognise automatic completion only for Jira category Done or a default-branch merged pull request carrying the user-linked key, dated strictly after the item's creation - `inst-close-rule`
3. [ ] - `p1` - **IF** the item is accepted, still awaits completion and the strict rule holds - `inst-close-auto`
   1. [ ] - `p1` - DB: in one change-log transaction INSERT evidence with source, reference, summary, dated and collected times and `closed_item` set; UPDATE item to `closed_by_evidence` and attach its evidence id; INSERT applied change with before/after, actor, reason and batch id - `inst-close-transaction`
   2. [ ] - `p1` - Preserve review as accepted and emit `entity:changed` only after commit; make the closure available to the next call's carry-forward review - `inst-close-publish`
4. [ ] - `p1` - **ELSE IF** the item is not rejected and evidence supports a possible completion - `inst-close-propose`
   1. [ ] - `p1` - DB: store supporting evidence without a closing flag and a proposed CloseItem change with its target base revision; leave item status and review unchanged - `inst-close-proposal-write`
5. [ ] - `p1` - Treat commits, keyword matches, speech, unlinked or older completions as proposal-only; never promote a suggested item automatically or revive a rejected suggestion - `inst-close-weak`
6. [ ] - `p1` - **RETURN** the committed outcome; rollback evidence and item/log changes together on transaction failure - `inst-close-return`

### Apply a guarded decision

- [ ] `p1` - **ID**: `cpt-noter-algo-core-evidence-proposals-apply`

**Input**: Proposal id, displayed revision, decision and its recorded target set.

**Output**: `ProposalOutcome`, or a typed error with no partial decision.

**Steps**:
1. [ ] - `p1` - DB: SELECT the proposal and full propagation delta under the writer; **RETURN** `not_found` if absent or `proposal_not_applicable` if no longer pending - `inst-apply-load`
2. [ ] - `p1` - **IF** accepting, compare the supplied base revision and every affected target with the proposed snapshot; **RETURN** `conflict` with current revision when any target was edited later - `inst-apply-revision`
3. [ ] - `p1` - **IF** accepting, validate all targets and evidence using their owning service's rules; **RETURN** `proposal_not_applicable` if the change cannot be applied - `inst-apply-valid`
4. [ ] - `p1` - **TRY** one writer transaction - `inst-apply-try`
   1. [ ] - `p1` - For acceptance apply the complete proposed delta through the owning services and append logged applied changes as one undoable batch, with reason and evidence retained - `inst-apply-accept`
   2. [ ] - `p1` - For rejection record rejected status and a logged user decision without modifying target values; allow dismissal of a stale proposal using its current proposal revision - `inst-apply-reject`
   3. [ ] - `p1` - Persist the decision and commit before invalidations and counts; acceptance returns its applied count and batch id - `inst-apply-commit`
5. [ ] - `p1` - **CATCH** failure: rollback all target and decision writes and **RETURN** the typed error, leaving the proposal waiting - `inst-apply-catch`
6. [ ] - `p1` - **RETURN** `ProposalOutcome` with the original proposal details and resulting status - `inst-apply-return`

### Assemble Activity and counts

- [ ] `p1` - **ID**: `cpt-noter-algo-core-evidence-proposals-activity`

**Input**: Local day, actor filter and a consistent read snapshot.

**Output**: `ActivityView` and app-wide `ProposalCounts`.

**Steps**:
1. [ ] - `p1` - Validate the local day and read its timezone-aware start and end; use bound query parameters for day, actor and kind filters - `inst-activity-range`
2. [ ] - `p1` - DB: SELECT changes for the day and actor using the change-log indexes; join actors, evidence and job runs in bulk - `inst-activity-read`
3. [ ] - `p1` - Group job changes by run, preserve batch ids and sizes, and supply before/after, reason, confidence, evidence and undoable/redoable flags from history; user changes have no run - `inst-activity-group`
4. [ ] - `p1` - Read pending proposals and unresolved failed runs, including source sync and evidence failures, for Waiting and Needs attention; a later successful retry clears the resolved warning - `inst-activity-attention`
5. [ ] - `p1` - Compute global waiting and needs-attention counts independently of the selected day and actor; publish a newer version of `proposals:counts` after decisions and run outcome changes, and include it in app snapshots - `inst-activity-counts`
6. [ ] - `p1` - **IF** the log cannot be read, **RETURN** `change_log_unreadable`; do not replace the failure with an empty day - `inst-activity-error`
7. [ ] - `p1` - **RETURN** `ActivityView` with empty collections for a genuinely empty result - `inst-activity-return`

## 4. States (CDSL)

### Proposal and applied change

- [ ] `p1` - **ID**: `cpt-noter-state-core-evidence-proposals-change`

**States**: proposed, applied, rejected, undone

**Initial State**: proposed (automatic strict closures start applied)

**Transitions**:
1. [ ] - `p1` - **FROM** proposed **TO** applied **WHEN** acceptance passes every target revision and commits the batch - `inst-state-accept`
2. [ ] - `p1` - **FROM** proposed **TO** rejected **WHEN** Reject or Dismiss records the user's decision without changing targets - `inst-state-reject`
3. [ ] - `p1` - **FROM** applied **TO** undone **WHEN** history undo restores eligible records; later-edited rows are skipped and counted - `inst-state-undo`
4. [ ] - `p1` - **FROM** undone **TO** applied **WHEN** history redo applies eligible records in new change rows with `redo_of`; original undone rows remain undone - `inst-state-redo`

A stale acceptance stays proposed and returns conflict. Rejection decisions are themselves logged and undone through history; restoring a rejected proposal does not apply its target delta. The M2 history service owns these inverse changes and the all-rows-edited guards.

## 5. Definitions of Done

### Evidence closure and proposals

- [ ] `p1` - **ID**: `cpt-noter-dod-core-evidence-proposals-evidence`

The system **MUST** use audited tool lookups and local speech judgements, apply only the linked completion rule to accepted work, and keep every weaker match as a proposal. Every automatic closure has an evidence row with `closed_item` set and an undoable applied change.

**Implements**:
- `cpt-noter-algo-core-evidence-proposals-collect`
- `cpt-noter-algo-core-evidence-proposals-close`

**Covers (DESIGN)**:
- [ ] `p6` - `cpt-noter-component-core-jobs`
- `cpt-noter-seq-core-evidence-close`
- `cpt-noter-dbtable-evidence`

**Touches**:
- API: egress gate, evidence tools, `entity:changed`, `jobs:progress`
- DB: `items`, `evidence`, `changes`, `audit_log`, `job_runs`
- Entities: evidence views and item status/review

### Decisions and Activity

- [ ] `p1` - **ID**: `cpt-noter-dod-core-evidence-proposals-decisions`

The system **MUST** implement all four commands in the main window scope, apply proposal batches atomically with revision guards, save a term rule with its pending acceptance, and serve Activity with current global counts, meaningful empty states and retryable log failures.

**Implements**:
- `cpt-noter-flow-core-evidence-proposals-read`
- `cpt-noter-flow-core-evidence-proposals-decide`
- `cpt-noter-algo-core-evidence-proposals-apply`
- `cpt-noter-algo-core-evidence-proposals-activity`
- `cpt-noter-state-core-evidence-proposals-change`

**Covers (DESIGN)**:
- [ ] `p6` - `cpt-noter-component-core-changelog`
- `cpt-noter-seq-activity-review-proposals`

**Touches**:
- API: `proposals_list`, `proposal_decide`, `proposal_always_for_term`, `activity_get`, `proposals:counts`
- DB: `changes`, `glossary`, `job_runs`, affected target records
- Entities: `ProposalRow`, `ProposalOutcome`, `GlossaryTerm`, `ActivityView`, `ProposalCounts`

### Undo integration and proof

- [ ] `p1` - **ID**: `cpt-noter-dod-core-evidence-proposals-undo-tests`

The system **MUST** expose proposal and evidence batches through existing history undo/redo, preserve later user edits and show reopened items correctly. Unit, conformance and real-core E2E tests prove the strict closure rule, atomic decisions and both M5 Activity stories. `just gate` passes.

**Implements**:
- `cpt-noter-flow-core-evidence-proposals-undo`

**Covers (DESIGN)**:
- `cpt-noter-seq-activity-undo-batch`

**Touches**:
- API: existing history and item commands
- DB: `changes`, `items`, `evidence`
- Entities: `UndoResult`, Activity groups

## 6. Acceptance Criteria

- [ ] Unit tests cover linked Jira Done and default-branch merged PRs strictly newer than item creation; older, equal-time, unlinked, commit-only, keyword and speech matches never auto-close. Suggested items remain suggested and rejected items never return.
- [ ] Storage integration tests prove evidence, item closure and applied change commit together, retries do not duplicate closures/proposals, and a target edited during collection is not overwritten.
- [ ] Egress tests prove lookup audit rows precede subprocess requests, missing or signed-out tools do not guess, tracker failure records `tracker_unreachable`, and later-call judgement stays local with a resolvable span.
- [ ] Unit tests cover all-or-nothing propagation, stale `rev`, missing targets, Reject/Dismiss, term-only validation, atomic rule-plus-acceptance and future propose-only reconciliation.
- [ ] Conformance against the real core covers all four commands' main-only scopes, paging, kind and actor filters, typed errors, result payloads and increasing `proposals:counts.version` consistent with app snapshots.
- [ ] E2E against the real core, story `cpt-noter-seq-activity-review-proposals`: expand and accept a term batch, reject a proposal, save Always for This Term, handle stale acceptance, show empty Waiting, and retry a failed evidence run until its warning clears.
- [ ] E2E against the real core, story `cpt-noter-seq-activity-undo-batch`: undo 37 changes, redo after the strip expires, keep two later edits during a partial undo, open/reopen a mistaken closure, and distinguish an empty log from `change_log_unreadable`.
- [ ] Each of the four M5 commands succeeds at least once against the real core. Correction/closure quality is measured against the PRD's ≥95% correct evidence closures and ≤5% undone automated corrections; batch/read-model scenarios meet harness limits.
- [ ] Contract limits are explicit: `ActivityArgs` reads one day and has no Proposals actor value; the UI uses its waiting section for that filter and existing `history_list` for paged batch details. `ProposalRow` has no per-span delta list or numeric confidence; detailed proposal previews need an upstream contract decision. No new endpoint or payload field is defined here.
- [ ] Remote service deployment, cross-tenant roles and regulatory certification are not applicable to this local feature. Tool login and privacy controls reuse existing boundaries; keyboard handling, focus, inline diffs and announcements belong to the UI.
- [ ] `just gate` passes.
