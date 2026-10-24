---
title: "Feature: Library call list and call records"
description: "The Library list with filters, sort and pages; the call detail read model; call edits with a revision; call types from the built-in list and skill folders; deleting calls for good with everything recorded in them; fixture parity for the M1 read models."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M1
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Library call list and call records

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Browse the Library](#browse-the-library)
  - [Open a call](#open-a-call)
  - [Edit a call](#edit-a-call)
  - [List call types](#list-call-types)
  - [Delete calls for good](#delete-calls-for-good)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Assemble a call row](#assemble-a-call-row)
  - [Delete calls and their files](#delete-calls-and-their-files)
  - [Fixture parity](#fixture-parity)
- [4. States (CDSL)](#4-states-cdsl)
  - [Call status](#call-status)
- [5. Definitions of Done](#5-definitions-of-done)
  - [List and detail read models](#list-and-detail-read-models)
  - [Edits and call types](#edits-and-call-types)
  - [Delete for good](#delete-for-good)
  - [Fixture parity from M1](#fixture-parity-from-m1)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p2` - **ID**: `cpt-noter-featstatus-core-library-calls`

- [x] `p2` - `cpt-noter-feature-core-library-calls`

## 1. Feature Context

### 1.1 Overview

A library service in `noter-core` serves the read models over the call rows, segments, speakers, marks and gaps that capture writes: the paged Library list, the call detail, the call types, edits of a call's title and type, and permanent deletion of calls with their files. It also brings in fixture parity for these read models: the fixtures are seeded as rows and the fake world is generated through the real read models. Tags, search, outputs and items arrive in M2 and M3.

> **M1 decisions (Backend Teamlead, 21 Oct 2026).** The built-in list for `call_types_list` is a constant in noter-core for M1, the PRD's eight with the fixture ids `one_on_one`, `standup`, `planning`, `retro`, `cross_team`, `vendor`, `interview`, `incident` (`builtin: true`, `skill_path` `skills/<id>/SKILL.md`); skill folders under Application Support are listed with `builtin: false`, and an unreadable one is logged and skipped (TL-6, D-25). `calls_delete` writes one non-undoable, content-free change row per deleted call, through `Store::delete`, and the segments, speakers, marks and gaps under it go with it by cascade (TL-1). Until the UI ships the M1 screens, the `delete-call` story is proven by a story-named conformance test (TL-7).

### 1.2 Purpose

After M1 the user can record calls and find them again. The list and the call record are where the UI first reads real data instead of fixtures, so fake and real must agree field by field.

**Requirements**: PRD › Feature specification › 5. Library and search (list and call record); PRD › Security, privacy and permissions (delete for good).

**Principles**: `cpt-noter-principle-core-intent-commands`

**Delivers**:
- Frozen commands (M1): `calls_list`, `call_get`, `call_update`, `call_types_list`, `calls_delete`.
- Events: `entity:changed` for calls.
- DESIGN.md story (M1): `cpt-noter-seq-dialogs-delete-call`.
- The fixture-parity gate "from M1" of DESIGN-core 4.1 for these read models.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Browses the Library, opens a call, renames it, changes its type, deletes calls |
| UI window (main; call window for `call_get`; Settings for `call_types_list`) | Calls the commands |
| Capture session and live transcript | Write the rows these read models read |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-library-calls`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): 3.1 Domain model (Call), 3.3 Library and Ask group, 4.1 Fixture parity; tables `cpt-noter-dbtable-calls`, `cpt-noter-dbtable-segments`, `cpt-noter-dbtable-marks`, `cpt-noter-dbtable-gaps` (owned by the capture and transcript features)
- **Dependencies**: `cpt-noter-feature-core-capture-session`, `cpt-noter-feature-core-live-transcript`

## 2. Actor Flows (CDSL)

### Browse the Library

- [x] `p1` - **ID**: `cpt-noter-flow-core-library-calls-list`

**Actor**: Primary user (main window, Library)

**Success Scenarios**:
- The list shows the newest calls first, a page at a time, with duration, languages, privacy, status and outputs status; filters by call type, language and dates narrow it.

**Error Scenarios**:
- An unknown call type or a bad date range: `invalid_input`.
- The core is still starting: `not_ready`.

**Steps**:
1. [x] - `p1` - API: `calls_list { filter, sort, page }` from the main window - `inst-list-call`
2. [x] - `p1` - Validate the filter; a bad one **RETURN** `invalid_input` - `inst-list-validate`
3. [x] - `p1` - DB: SELECT from `calls` on a read-only connection with the filters in SQL, the sort, and the page cursor - `inst-list-select`
4. [x] - `p1` - Assemble each `CallRow` with `cpt-noter-algo-core-library-calls-row` - `inst-list-assemble`
5. [x] - `p1` - **RETURN** a page of `CallRow` with the next cursor - `inst-list-return`

### Open a call

- [x] `p1` - **ID**: `cpt-noter-flow-core-library-calls-get`

**Actor**: Primary user (main window Call page; call window)

**Success Scenarios**:
- The call detail comes back complete for its view: row fields, speakers, marks, gaps, calendar event, audio availability and the outputs status.

**Error Scenarios**:
- The call was deleted: `not_found` ("no longer exists").

**Steps**:
1. [x] - `p1` - API: `call_get { call_id }` - `inst-get-call`
2. [x] - `p1` - DB: SELECT the call, its speakers, marks and gaps - `inst-get-select`
3. [x] - `p1` - **IF** the call does not exist **RETURN** `not_found` - `inst-get-missing`
4. [x] - `p1` - **RETURN** `CallDetail`; outputs show `pending` until M2's pipeline exists - `inst-get-return`

### Edit a call

- [x] `p1` - **ID**: `cpt-noter-flow-core-library-calls-update`

**Actor**: Primary user (main window)

**Success Scenarios**:
- The user renames the call or changes its type; every window showing it gets the new record.

**Error Scenarios**:
- A stale `rev`: `conflict` with `detail.current_rev`.
- An unknown call type or an empty title: `invalid_input`.

**Steps**:
1. [x] - `p1` - API: `call_update { call_id, rev, title?, call_type? }` - `inst-update-call`
2. [x] - `p1` - Validate; **RETURN** `invalid_input` on failure - `inst-update-validate`
3. [x] - `p1` - DB: UPDATE `calls` through the change-log write path with the base `rev` - `inst-update-write`
4. [x] - `p1` - **IF** the write returned `conflict` **RETURN** it - `inst-update-conflict`
5. [x] - `p1` - Emit `entity:changed { call }` - `inst-update-emit`
6. [x] - `p1` - **RETURN** `CallMutation` with the new row and the change id - `inst-update-return`

### List call types

- [x] `p2` - **ID**: `cpt-noter-flow-core-library-calls-types`

**Actor**: UI window (main, call window, Settings)

**Success Scenarios**:
- The built-in call types and the skill folders the user added are listed, each with `builtin` and `skill_path` (Q5).

**Error Scenarios**:
- A user skill folder is unreadable: it is left out and logged; the built-in list is always returned.

**Steps**:
1. [x] - `p1` - API: `call_types_list {}` - `inst-types-call`
2. [x] - `p1` - Read the built-in types from the app bundle's `skills/` and user types from Application Support - `inst-types-read`
3. [x] - `p1` - **RETURN** `CallTypeList` - `inst-types-return`

### Delete calls for good

- [x] `p1` - **ID**: `cpt-noter-flow-core-library-calls-delete`

**Actor**: Primary user (main window, after the native alert that says what goes and that it cannot be undone)

**Success Scenarios**:
- The calls, their transcript, speakers, marks, gaps, audio and per-call files are gone; the list and every window drop them; the change log keeps a non-undoable entry without content.

**Error Scenarios**:
- One of the calls is being recorded: `already_recording`; nothing is deleted.
- A call is already gone: it is skipped and not counted.

**Steps**:
1. [x] - `p1` - API: `calls_delete { call_ids }` from the main window only (the call window may not delete) - `inst-delete-call`
2. [x] - `p1` - **IF** any id is the live call **RETURN** `already_recording` - `inst-delete-live`
3. [x] - `p1` - Run `cpt-noter-algo-core-library-calls-delete` - `inst-delete-run`
4. [x] - `p1` - Emit `entity:changed { removed }` for each deleted call - `inst-delete-emit`
5. [x] - `p1` - **RETURN** `DeleteResult { deleted }` - `inst-delete-return`

## 3. Processes / Business Logic (CDSL)

### Assemble a call row

- [x] `p1` - **ID**: `cpt-noter-algo-core-library-calls-row`

**Input**: A `calls` row and its related rows.

**Output**: A `CallRow` complete for the Library view.

**Steps**:
1. [x] - `p1` - Copy the stored fields (title, type, start, duration, privacy, status, archive status, audio retention and deletion) - `inst-row-fields`
2. [x] - `p1` - Derive languages from the call's segments and count unnamed speakers - `inst-row-derive`
3. [x] - `p1` - Leave participants, tags, open items and reviews empty or zero until their features land (M2, M3) - `inst-row-later`
4. [x] - `p1` - **RETURN** the row - `inst-row-return`

### Delete calls and their files

- [x] `p1` - **ID**: `cpt-noter-algo-core-library-calls-delete`

**Input**: Call ids that are not live.

**Output**: Rows and files removed; one change row per call, not undoable.

**Steps**:
1. [x] - `p1` - **FOR EACH** call - `inst-del-for`
   1. [x] - `p1` - DB: in one writer transaction, DELETE the call (cascading to segments, speakers, marks, gaps and later tables) and INSERT a `changes` row with `undoable = 0` and a summary without content - `inst-del-tx`
   2. [x] - `p1` - Remove `audio/<call_id>/` from the App Group container after the commit - `inst-del-files`
   3. [x] - `p1` - **CATCH** a file removal failure: log it and retry at the next start; the rows stay deleted - `inst-del-catch`
2. [x] - `p1` - **RETURN** the count deleted - `inst-del-return`

### Fixture parity

- [x] `p2` - **ID**: `cpt-noter-algo-core-library-calls-fixture-parity`

**Input**: The typed fixture world, an injected clock.

**Output**: The fake world regenerated through the real read models, and a comparison of the listed fields.

**Steps**:
1. [x] - `p1` - Seed the fixture calls, segments, speakers, marks and gaps as database rows - `inst-parity-seed`
2. [x] - `p1` - Run `calls_list`, `call_get` and the transcript snapshot over them with the injected clock - `inst-parity-run`
3. [x] - `p1` - Compare the fields the test lists with the fake world's values; a difference fails the test - `inst-parity-compare`
4. [x] - `p1` - **RETURN** pass or the differing fields - `inst-parity-return`

## 4. States (CDSL)

### Call status

- [x] `p1` - **ID**: `cpt-noter-state-core-library-calls-status`

**States**: recording, paused, processing, ready, failed

**Initial State**: recording

**Transitions**:
1. [x] - `p1` - **FROM** recording **TO** paused **WHEN** capture pauses - `inst-st-paused`
2. [x] - `p1` - **FROM** paused **TO** recording **WHEN** capture resumes - `inst-st-recording`
3. [x] - `p1` - **FROM** recording **TO** processing **WHEN** the call stops (also from paused) - `inst-st-processing`
4. [x] - `p1` - **FROM** processing **TO** ready **WHEN** the transcript file is written; from M2, when the post-call outputs are written - `inst-st-ready`
5. [x] - `p1` - **FROM** processing **TO** recording **WHEN** Continue Recording appends to the call - `inst-st-continued`
`failed` is entered by the post-call pipeline (`core-postcall`, M2); no M1 code writes it.

## 5. Definitions of Done

### List and detail read models

- [x] `p1` - **ID**: `cpt-noter-dod-core-library-calls-read`

The system **MUST** answer `calls_list` with filters in SQL, sort and cursor pages, and `call_get` with a `CallDetail` complete for its view, both from read-only connections, with the call status following the state machine above.

**Implements**:
- `cpt-noter-flow-core-library-calls-list`
- `cpt-noter-flow-core-library-calls-get`
- `cpt-noter-algo-core-library-calls-row`
- `cpt-noter-state-core-library-calls-status`

**Touches**:
- API: `calls_list`, `call_get`
- DB: `calls`, `segments`, `speakers`, `marks`, `gaps`
- Entities: `CallRow`, `CallDetail`

### Edits and call types

- [x] `p1` - **ID**: `cpt-noter-dod-core-library-calls-edit`

The system **MUST** apply `call_update` with the `rev` guard through the change log and broadcast `entity:changed`, and list call types from the built-in list and the user's skill folders.

**Implements**:
- `cpt-noter-flow-core-library-calls-update`
- `cpt-noter-flow-core-library-calls-types`

**Touches**:
- API: `call_update`, `call_types_list`, `entity:changed`
- DB: `calls`, `changes`
- Entities: `CallMutation`, `CallTypeInfo`

### Delete for good

- [x] `p1` - **ID**: `cpt-noter-dod-core-library-calls-delete`

The system **MUST** delete calls with every row and file recorded for them, refuse to delete the live call, log each deletion as a non-undoable change without content, and allow it only from the main window.

**Implements**:
- `cpt-noter-flow-core-library-calls-delete`
- `cpt-noter-algo-core-library-calls-delete`

**Touches**:
- API: `calls_delete`
- DB: `calls` and every table cascading from it, `changes`
- Entities: `DeleteResult`

### Fixture parity from M1

- [ ] `p2` - **ID**: `cpt-noter-dod-core-library-calls-parity`

The system **MUST** run the fixture-parity test for `calls_list`, `call_get` and the transcript snapshot in CI; a difference between the fake world and the real read models fails it and is fixed in the contract or the fixtures first (contract lane for the generator change).

**Implements**:
- `cpt-noter-algo-core-library-calls-fixture-parity`

**Touches**:
- API: `calls_list`, `call_get`, `transcript_subscribe`
- Entities: fixture world

## 6. Acceptance Criteria

- [x] E2E against the real core, story `cpt-noter-seq-dialogs-delete-call`: after the alert the call disappears from the Library and from every open window, its files are gone, and a non-undoable change row without content is written (History shows it from M2).
- [x] A recorded call (scripted engine) appears in `calls_list` and opens with `call_get` with its marks and gaps.
- [x] `call_update` with a stale `rev` returns `conflict`; deleting the live call returns `already_recording`.
- [x] The fixture-parity test passes for the M1 read models.
- [x] Each of the five commands succeeds at least once in E2E runs against the real core.
- [x] `just gate` passes.
