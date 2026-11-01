---
title: "Feature: Post-call pipeline and outputs"
description: "Ordered post-call sections, archive upgrades, preserved edits, versions and outputs-ready notifications."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M2
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Post-call pipeline and outputs

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Write outputs after a call](#write-outputs-after-a-call)
  - [Read, edit and compare versions](#read-edit-and-compare-versions)
  - [Upgrade or regenerate outputs](#upgrade-or-regenerate-outputs)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Store validated sections and items](#store-validated-sections-and-items)
  - [Chunk and embed the active transcript](#chunk-and-embed-the-active-transcript)
  - [Merge regeneration with the user's edits](#merge-regeneration-with-the-users-edits)
  - [Release notifications and evaluate role switch-off](#release-notifications-and-evaluate-role-switch-off)
- [4. States (CDSL)](#4-states-cdsl)
  - [Output section](#output-section)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Ordered outputs and versions](#ordered-outputs-and-versions)
  - [Archive, regeneration and evidence](#archive-regeneration-and-evidence)
  - [Notifications and role policy](#notifications-and-role-policy)
  - [Evaluations, tests and gate](#evaluations-tests-and-gate)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p3` - **ID**: `cpt-noter-featstatus-core-postcall`

- [ ] `p3` - `cpt-noter-feature-core-postcall`

## 1. Feature Context

### 1.1 Overview

The post-call pipeline writes sections from the live transcript as soon as each validates, then improves them after the archive pass. It keeps every generated version and user edit, extracts suggested items with evidence spans, chunks and embeds the transcript and serves output read, edit, version and regeneration commands. Search and Ask over those chunks remain M3.

> **M2 decisions (Backend Teamlead, 1 Nov 2026).**  Story tests are story-named files in `apps/desktop/tests/conformance/m2-stories-*.test.ts` that drive the real core over `StdioCore` with the scripted runtime, secret store, native ops and engine, and assert the core-visible steps (rows, events, state); the UI E2E takes over when the UI M2 lands (TL-18, D-26).

### 1.2 Purpose

A 60-minute call produces usable outputs within two minutes on cloud or ten minutes locally, even if another call starts. Archive upgrades and regeneration never discard a user's correction, accepted item or rejected suggestion.

**Requirements**: PRD › Feature specification › 4. Post-call outputs; PRD › Success metrics › Post-call; PRD › LLM orchestration › Skills, not prompts.

**Principles**: No additional principle assigned in the decomposition; the shared writer, egress and capture-priority rules apply.

**Delivers**:
- Frozen commands (M2): `outputs_get`, `output_edit`, `outputs_regenerate`, `output_versions`, `output_version_get`.
- Events: `outputs:progress`, `entity:changed` for committed records.
- DESIGN.md stories (M2): `cpt-noter-seq-call-page-review-outputs`, `cpt-noter-seq-notifications-open-outputs`.
- DESIGN-core sequence: outputs half of `cpt-noter-seq-core-call-end-outputs`; stopping capture is M1.
- M2 skill evaluations in `evals/`: schema, citations and rubric over golden calls.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user (main window) | Reads, edits, compares and regenerates outputs |
| Job scheduler | Runs PostCall, ArchivePass and Regeneration |
| LLM router and engine supervisor | Return validated analysis and archive results |
| Session manager and native notifications | Hold or release outputs-ready and failed notices |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-postcall`; overview discrepancies 1, 7 and 8
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-postcall`, `cpt-noter-interface-skill-outputs`, `cpt-noter-seq-core-call-end-outputs`, `cpt-noter-dbtable-summaries`, `cpt-noter-dbtable-summary-versions`, `cpt-noter-dbtable-chunks`
- **Stories**: [DESIGN.md](../../DESIGN.md), output review and notification stories listed above
- **Contract**: `model/outputs.rs`, `model/transcript.rs`, `skills.rs` in `crates/noter-protocol/src`; `contracts/ipc.manifest.json`
- **Dependencies**: `cpt-noter-feature-core-jobs-scheduler`, `cpt-noter-feature-core-llm-gate`, `cpt-noter-feature-core-live-transcript`, `cpt-noter-feature-core-engine-offline`

## 2. Actor Flows (CDSL)

### Write outputs after a call

- [ ] `p1` - **ID**: `cpt-noter-flow-core-postcall-write`

**Actor**: Job scheduler, after the session manager stops a call

**Success Scenarios**:
- The transcript remains readable while Summary, Decisions, Action items, Open questions and Per participant appear; risks and call-type extras follow where applicable, and role reviews run last.
- Another live call keeps PostCall running at low priority; local results identify their writer and role reviews follow in the background.

**Error Scenarios**:
- One section fails: ready sections remain usable and the failed section offers retry or local rewrite.
- Continue Recording cancels this generation; a later stop queues a new one with edits retained.

**Steps**:
1. [x] - `p1` - Load the stopped call's current transcript, metadata, participants, glossary, configured summary language and call-type skill - `inst-write-load`
2. [x] - `p1` - Run `cpt-noter-algo-core-postcall-chunks` for live segments and build a packet with known evidence ids - `inst-write-packet`
3. [x] - `p1` - Run the call-type `PostCallOutput` through the router with cancellation and the scheduler's current run generation - `inst-write-model`
4. [x] - `p1` - **FOR EACH** output section in the stated order - `inst-write-sections`
   1. [x] - `p1` - Mark writing and publish `outputs:progress`; validate that section and its evidence before persistence - `inst-write-validate`
   2. [x] - `p1` - Commit its version and items through `cpt-noter-algo-core-postcall-store`; publish ready or empty and complete changed entities after commit - `inst-write-commit`
   3. [x] - `p1` - **IF** the section fails, store its typed failure and local-fallback availability, publish failed and continue with independent sections - `inst-write-failed-section`
5. [ ] - `p1` - Run enabled role reviews last through the router, parallel by default, with their own evidence checks and versions (M4: no agent can be enabled before the `agents` table) - `inst-write-reviews`
6. [x] - `p1` - Write `items.json` and `summary.md` from committed records; derive ready, partially_failed or failed status - `inst-write-files`
7. [x] - `p1` - Tell the session manager outputs are ready or failed; apply `cpt-noter-algo-core-postcall-notify` - `inst-write-notify`
8. [x] - `p1` - **RETURN** committed output state to the job; queue archive processing if audio is available - `inst-write-return`

### Read, edit and compare versions

- [x] `p1` - **ID**: `cpt-noter-flow-core-postcall-edit`

**Actor**: Primary user (main window)

**Success Scenarios**:
- `outputs_get` returns complete section state and provenance; editing adds a user-edit version; any generated or edited version remains readable for comparison.

**Error Scenarios**:
- Missing call, section or version: `not_found`; stale section revision: `conflict` with `current_rev`; wrong call/section association: `invalid_input`.

**Steps**:
1. [x] - `p1` - API: `outputs_get { call_id }`; join summaries, current versions and items into `CallOutputs`, including archive state, local writer and review count - `inst-edit-get`
2. [x] - `p1` - API: `output_edit { call_id, summary_id, rev, body_md }`; validate membership, revision and Markdown without raw HTML on the writer - `inst-edit-validate`
3. [x] - `p1` - Append a user-edit `summary_versions` row and logged change, update current version and revision in one transaction and preserve the generated base - `inst-edit-commit`
4. [x] - `p1` - After commit refresh files and indexes, publish the whole changed section and return `OutputMutation` with `change_id` - `inst-edit-publish`
5. [x] - `p1` - API: `output_versions { summary_id }` returns ordered version metadata; `output_version_get { summary_id, version_id }` returns that version's body and provenance - `inst-edit-versions`
6. [x] - `p1` - **RETURN** plain Markdown bodies for the UI's diff; cancelling an editor sends no mutation - `inst-edit-return`

### Upgrade or regenerate outputs

- [x] `p1` - **ID**: `cpt-noter-flow-core-postcall-regenerate`

**Actor**: Archive job or primary user (main window)

**Success Scenarios**:
- Archive upgrade reconciles labels, re-chunks and regenerates; manual regeneration can choose runtime, model, skill and sections or request a local rewrite of a failed section.

**Error Scenarios**:
- User regeneration during capture: `job_blocked`; an unavailable chosen runtime: typed runtime failure; failed archive leaves the live transcript usable as archive pending.

**Steps**:
1. [x] - `p1` - For `outputs_regenerate`, validate the call, requested sections and options, refuse during live capture and return `JobAccepted` for queued regeneration - `inst-regen-request`
2. [x] - `p1` - For ArchivePass, wait until no call is live, then request `offline_pass` with the latest user constraints - `inst-regen-archive`
3. [x] - `p1` - **IF** audio is absent or archive fails, retain the live transcript, expose archive pending or failed state and use the scheduled retry path when audio remains available - `inst-regen-archive-fail`
4. [x] - `p1` - On archive success, map clusters by time overlap, retain user speaker and term corrections, install archive segments and keep the live copy for seven days - `inst-regen-install`
5. [x] - `p1` - Rebuild chunks and embeddings for the active pass; refresh transcript read models and archive-change information - `inst-regen-rechunk`
6. [x] - `p1` - Generate only the requested sections and run `cpt-noter-algo-core-postcall-merge` with current edits re-read at commit time - `inst-regen-merge`
7. [x] - `p1` - Publish committed changes, including archive speaker relabelling information and section progress, then refresh per-call files - `inst-regen-publish`
8. [x] - `p1` - **RETURN** the job's result; cancellation or a superseded generation cannot install late output - `inst-regen-return`

## 3. Processes / Business Logic (CDSL)

### Store validated sections and items

- [x] `p1` - **ID**: `cpt-noter-algo-core-postcall-store`

**Input**: Validated section, run id, call revision, active pass and permitted evidence segments.

**Output**: Logged section version, items and progress.

**Steps**:
1. [x] - `p1` - Verify the call still exists, has not resumed and the job generation is current - `inst-store-current`
2. [x] - `p1` - Append generated versions with increasing version numbers and writer runtime, model, skill version, language, time and pass - `inst-store-version`
3. [x] - `p1` - Resolve owner hints to known people only when supported; otherwise leave ownership unset rather than inventing a match - `inst-store-owner`
4. [x] - `p1` - Convert cited segments into channel and time spans in `item_spans`; preserve the quote and source association across archive id changes - `inst-store-evidence`
5. [x] - `p1` - Write extracted items as suggested, keep pins accepted and attach supported topics; never turn an unreviewed suggestion into accepted output - `inst-store-items`
6. [x] - `p1` - Commit primary records, changes and derived indexes through the writer in batches of at most 200 rows; mark a section ready only after its complete committed state exists - `inst-store-commit`
7. [x] - `p1` - **RETURN** section state ready, empty or failed; an empty valid section is not an error - `inst-store-return`

### Chunk and embed the active transcript

- [x] `p1` - **ID**: `cpt-noter-algo-core-postcall-chunks`

**Input**: Confirmed active-pass segments, call header and speaker labels.

**Output**: Stored chunks and canonical embeddings ready for M3 retrieval.

**Steps**:
1. [x] - `p1` - Group ordered lines along segment boundaries into roughly 200–300-token chunks with a call header and speaker prefixes - `inst-chunk-group`
2. [x] - `p1` - Preserve call-relative time bounds and normalize shadow text using the existing storage normalization - `inst-chunk-normalize`
3. [x] - `p1` - Ask the engine for local bge-m3 embeddings and validate one finite 1024-dimensional vector per chunk - `inst-chunk-embed`
4. [x] - `p1` - Through the writer, replace obsolete active-pass chunks and update FTS and `chunk_vec` from canonical embeddings, without a per-call vector partition - `inst-chunk-store`
5. [x] - `p1` - **IF** embedding fails, retain the transcript and record retryable pipeline failure without claiming vector completion or blocking readable output sections - `inst-chunk-fail`
6. [x] - `p1` - **RETURN** chunk ids, spans and indexing state - `inst-chunk-return`

### Merge regeneration with the user's edits

- [x] `p1` - **ID**: `cpt-noter-algo-core-postcall-merge`

**Input**: Previous generated base, current user-edited body, new generated candidate and reviewed items.

**Output**: A new generated version, preserved edit version and current merged body with diff metadata.

**Steps**:
1. [x] - `p1` - Compute user changes against the previous generated base, and generator changes against that same base - `inst-merge-base`
2. [x] - `p1` - Apply non-overlapping generator changes while preserving every user change; on overlapping wording keep the user's text and retain the new candidate as a separate version - `inst-merge-text`
3. [x] - `p1` - Re-read current revisions at writer commit; if an edit landed during generation, re-merge against that latest edit rather than overwriting it - `inst-merge-race`
4. [x] - `p1` - Keep accepted, edited and pinned items; replace only still-suggested generated items; match rejected suggestions by their retained source/content identity and do not suggest them again - `inst-merge-items`
5. [x] - `p1` - Append versions and changes, set `regenerated_with_edits` when edits were kept and expose complete version bodies so the UI computes the diff - `inst-merge-version`
6. [x] - `p1` - **RETURN** the merged section and suppressed-rejection result through existing read-model fields; introduce no new contract field - `inst-merge-return`

### Release notifications and evaluate role switch-off

- [ ] `p1` - **ID**: `cpt-noter-algo-core-postcall-notify`

**Input**: Committed output outcome, current capture, presenting and main-window view state; role outcomes for completed calls.

**Output**: Held or released notification and any logged role switch-off.

**Steps**:
1. [x] - `p1` - Pass ready or failed outcome with its call target to the session manager's existing notification hold rule - `inst-notify-session`
2. [x] - `p1` - Hold while a call is live or presenting is hidden; suppress the system notification when the foreground main window already shows that call and announce readiness on the page - `inst-notify-hold`
3. [x] - `p1` - When released and authorization allows it, post Summary ready or the failed-summary notice with a thread per call and a `NavTarget` for Summary; clicking routes through `nav:request` - `inst-notify-release`
4. [ ] - `p1` - For each agent with outcomes over the last ten calls of this type, calculate dismissal share; when at least 80 percent, log an undoable switch-off for that call type and its one-time Agents notice (M4: the rule arithmetic is in place; cards and the `agents` table arrive in M4) - `inst-notify-switch`
5. [x] - `p1` - Do not infer dismissal history before M4 produces cards, and do not back-compute behaviour metrics for calls recorded before the setting was enabled - `inst-notify-no-backfill`
6. [ ] - `p1` - **RETURN** notification disposition and committed changes (M4, with the switch-off changes) - `inst-notify-return`

## 4. States (CDSL)

### Output section

- [x] `p1` - **ID**: `cpt-noter-state-core-postcall-section`

**States**: pending, writing, ready, empty, failed

**Initial State**: pending

**Transitions**:
1. [x] - `p1` - **FROM** pending **TO** writing **WHEN** the current job starts this section - `inst-st-writing`
2. [x] - `p1` - **FROM** writing **TO** ready **WHEN** validated nonempty content commits - `inst-st-ready`
3. [x] - `p1` - **FROM** writing **TO** empty **WHEN** a valid section contains no content - `inst-st-empty`
4. [x] - `p1` - **FROM** writing **TO** failed **WHEN** runtime or validation fails after the permitted retry and fallback - `inst-st-failed`
5. [x] - `p1` - **FROM** failed **TO** writing **WHEN** retry or local rewrite is admitted - `inst-st-retry`
6. [x] - `p1` - **FROM** ready **TO** writing **WHEN** archive or explicit regeneration starts; the existing version and edit remain available - `inst-st-regenerate`
7. [x] - `p1` - **FROM** empty **TO** writing **WHEN** a new generation starts - `inst-st-empty-retry`
8. [x] - `p1` - **FROM** processing **TO** failed (the call's status in `cpt-noter-state-core-library-calls-status`) **WHEN** the post-call work fails - `inst-st-call-failed`

Continue Recording invalidates the running generation and returns unfinished sections to pending for the next stop; committed versions are retained. Aggregate status is writing while sections run, ready when all required sections are ready or empty, partially_failed for mixed success and failure, and failed when no usable required section succeeded.

## 5. Definitions of Done

### Ordered outputs and versions

- [ ] `p1` - **ID**: `cpt-noter-dod-core-postcall-outputs`

The system **MUST** write validated sections in order, keep the transcript readable, expose complete section state and writer provenance, store every generated and edited version and accept edits only with the current revision. Failed sections must not hide ready sections, and local output must identify its writer.

**Implements**:
- `cpt-noter-flow-core-postcall-write`
- `cpt-noter-flow-core-postcall-edit`
- `cpt-noter-algo-core-postcall-store`
- `cpt-noter-state-core-postcall-section`

**Touches**:
- API: `outputs_get`, `output_edit`, `output_versions`, `output_version_get`, `outputs:progress`
- DB: `summaries`, `summary_versions`, `items`, `item_spans`, `changes`
- Entities: `CallOutputs`, `OutputSection`, `WriterInfo`, `PostCallOutput`

### Archive, regeneration and evidence

- [x] `p1` - **ID**: `cpt-noter-dod-core-postcall-regeneration`

The system **MUST** wait for capture before archive or regeneration, retain live segments for seven days after archive completion, preserve user constraints and evidence time spans, re-chunk and embed the active transcript and merge regeneration with edits and reviewed items. Continue Recording must invalidate obsolete work. Search commands are M3 and retention cleanup is M5.

**Implements**:
- `cpt-noter-flow-core-postcall-regenerate`
- `cpt-noter-algo-core-postcall-chunks`
- `cpt-noter-algo-core-postcall-merge`

**Touches**:
- API: `outputs_regenerate`, `entity:changed`
- DB: `segments`, `speakers`, `chunks`, `chunk_vec`, `summaries`, `summary_versions`
- Entities: `JobAccepted`, `ArchiveStatus`, evidence spans

### Notifications and role policy

- [ ] `p1` - **ID**: `cpt-noter-dod-core-postcall-notifications`

The system **MUST** hand output outcomes to the session manager for notification holds and native delivery, and log D4 role switch-off when sufficient actual card history exists. A notification click must open the correct call's Summary.

**Implements**:
- `cpt-noter-algo-core-postcall-notify`

**Touches**:
- API: `nav:request`, `entity:changed`
- DB: `agents`, `changes`
- Entities: native notification, `NavTarget`

### Evaluations, tests and gate

- [ ] `p1` - **ID**: `cpt-noter-dod-core-postcall-tests`

The system **MUST** pass unit tests for section failure isolation, version guards, three-way overlap and concurrent edits, rejected-item suppression, archive relinking and cancelled generations; conformance for all five commands; skill evaluations for schema, citations and rubric on golden calls; and both real-core story E2E. Cover the M2 registry entry `post-call-outputs` with `core_post_call_scripted` and measure actual outputs after a 60-minute call against two minutes cloud and ten minutes local on the Mac runner, with reviews last. `just gate` passes.

**Implements**:
- `cpt-noter-flow-core-postcall-write`
- `cpt-noter-flow-core-postcall-regenerate`
- `cpt-noter-algo-core-postcall-merge`

**Touches**:
- Entities: `evals/`, post-call timing evidence

## 6. Acceptance Criteria

- [ ] Real-core E2E `cpt-noter-seq-call-page-review-outputs` reads sections as they arrive, edits Summary, compares versions, retries a failed section locally and regenerates with edits preserved; all five commands succeed.
- [ ] Real-app/native E2E `cpt-noter-seq-notifications-open-outputs` opens the correct call for ready and failed outcomes, suppresses a notice for the visible call and holds it through a subsequent recording. XCUITest uses `test_cpt_noter_seq_notifications_open_outputs` in its test name.
- [x] Accepted, pinned and edited items survive regeneration; rejected suggestions never return; missing or unknown citations cannot be persisted.
- [x] Archive failure leaves live evidence usable; archive success resolves the same evidence spans to new text and labels while preserving corrections and edits.
- [x] Concurrent user edits and Continue Recording cannot be overwritten by a late job result; unit tests prove both races.
- [ ] Fake/real conformance and skill schema, citation and rubric evaluations pass; Mac timing evidence reports the stated cloud/local output targets.
- [ ] `just gate` passes.
