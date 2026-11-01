---
title: "Feature: Items, Today, sharing and export"
description: "Item lifecycle and review, stable evidence, ranked Today, scoped rich sharing, export and call tags."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M2
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Items, Today, sharing and export

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Read items and their evidence](#read-items-and-their-evidence)
  - [Review, edit, create and reopen items](#review-edit-create-and-reopen-items)
  - [Tick an item or answer a handoff](#tick-an-item-or-answer-a-handoff)
  - [Read Today before the next call](#read-today-before-the-next-call)
  - [Share or export a scope](#share-or-export-a-scope)
  - [Set and list call tags](#set-and-list-call-tags)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Apply an item intent atomically](#apply-an-item-intent-atomically)
  - [Carry forward and rank relevant work](#carry-forward-and-rank-relevant-work)
  - [Resolve and format share content](#resolve-and-format-share-content)
- [4. States (CDSL)](#4-states-cdsl)
  - [Item status and review](#item-status-and-review)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Item intents and evidence](#item-intents-and-evidence)
  - [Today and carry-forward](#today-and-carry-forward)
  - [Sharing, export and tags](#sharing-export-and-tags)
  - [Tests and gate](#tests-and-gate)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [x] `p3` - **ID**: `cpt-noter-featstatus-core-items-today`

- [x] `p3` - `cpt-noter-feature-core-items-today`

## 1. Feature Context

### 1.1 Overview

The items service owns item status and review, revision-guarded edits, evidence views, the shared carry-forward query and Today. It formats scoped sharing for Slack, Jira and Markdown, exports selected calls or sections through native services and stores call tags. Evidence collection and proposal decisions remain M5; prompt generation belongs to handoff.

> **M2 decisions (Backend Teamlead, 1 Nov 2026).** `NativeOps` is a trait on `CoreDeps` (save panel, rich clipboard, launch, share test); the harness answers it scripted (a path under its data dir, a recorded clipboard, recorded launches, a fixed `ShareTestResult`), and the real implementations come with 2.21 native-services (TL-15). `share_copy` and `calls_export` code against it from day one. Story tests are story-named files in `apps/desktop/tests/conformance/m2-stories-*.test.ts` that drive the real core over `StdioCore` with the scripted runtime, secret store, native ops and engine, and assert the core-visible steps (rows, events, state); the UI E2E takes over when the UI M2 lands (TL-18, D-26).

### 1.2 Purpose

The user can review what a call produced, check the words behind an item, tick work done and see what to raise before the next call. Sharing reflects the chosen scope and never silently treats a suggestion as reviewed.

**Requirements**: PRD › Feature specification › 4. Post-call outputs, 6. Integrations and 13. Today dashboard; 5. Library and search (tags).

**Principles**: `cpt-noter-principle-core-intent-commands`

**Delivers**:
- Frozen commands (M2): `items_list`, `item_get`, `item_set_done`, `item_review`, `items_review_all`, `item_edit`, `item_reopen`, `item_create`, `item_answer_handoff_landed`, `today_get`, `share_copy`, `calls_export`, `call_tags_set`, `tags_list`.
- Events: `entity:changed` for items and calls.
- DESIGN.md stories (M2): `cpt-noter-seq-today-review-before-call`, `cpt-noter-seq-today-tick-item`, `cpt-noter-seq-call-page-review-suggested-items`, `cpt-noter-seq-call-page-share-outputs`, `cpt-noter-seq-call-page-check-evidence`.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Reviews, edits, ticks, reads evidence, shares and exports |
| Main window; call screen for item read and mutation commands in its scope | Sends wanted state and current revisions |
| Session manager and post-call pipeline | Carry items into a call and supply generated suggestions |
| Native services | Read permitted calendars, write rich clipboard formats and show save panels |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-items-today`; overview discrepancy 4 (v1 EventKit)
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-items`, 3.1 Item status × review, `cpt-noter-dbtable-items`, `cpt-noter-dbtable-item-spans`, `cpt-noter-dbtable-call-tags`
- **Stories**: [DESIGN.md](../../DESIGN.md), five stories listed above; Today ranking decision D3 and rejected-item rule D75
- **Contract**: `model/items.rs`, `model/today.rs`, `model/outputs.rs`, `model/library.rs`, `ipc/mod.rs` in `crates/noter-protocol/src`; `contracts/ipc.manifest.json`
- **Dependencies**: `cpt-noter-feature-core-postcall`, `cpt-noter-feature-core-native-surfaces`, `cpt-noter-feature-core-history-undo`
- **Native seam**: `cpt-noter-feature-core-native-services` supplies clipboard and export panels; the decomposition lists native-surfaces as this feature's direct native dependency.

## 2. Actor Flows (CDSL)

### Read items and their evidence

- [x] `p1` - **ID**: `cpt-noter-flow-core-items-today-read`

**Actor**: Primary user (main window; call screen for inspector)

**Success Scenarios**:
- A filtered page contains complete `ItemView` values; the inspector includes evidence and History; a provenance span opens current transcript text and optional replay.

**Error Scenarios**:
- Deleted item or source call: `not_found`; unavailable audio leaves text evidence usable and replay returns `audio_deleted`.

**Steps**:
1. [x] - `p1` - API: `items_list { filter, page }`; validate filters and read a stable page from `items`, joining owners, calls, topics and spans in the core - `inst-read-list`
2. [x] - `p1` - API: `item_get { item_id }`; read the item, supporting and closing evidence, and its changes into `ItemDetail` - `inst-read-detail`
3. [x] - `p1` - Resolve `item_spans` by call, channel and time against the active transcript pass rather than storing archive-fragile segment ids - `inst-read-span`
4. [x] - `p1` - Serve evidence through existing `transcript_span`; report audio availability and `upgraded_by_archive` so the UI can show changed wording or live evidence while archive is pending - `inst-read-preview`
5. [x] - `p1` - **RETURN** complete view models; replay and navigation use the M1 commands, with their existing route guards - `inst-read-return`

### Review, edit, create and reopen items

- [x] `p1` - **ID**: `cpt-noter-flow-core-items-today-review`

**Actor**: Primary user (main window; call screen only for allowed item mutations)

**Success Scenarios**:
- Accept or reject a suggestion, restore a rejected row, accept all selected kinds as one batch, create a manual item as accepted or edit fields with a current revision.

**Error Scenarios**:
- Stale revision returns `conflict` with `current_rev`; invalid owner, date, text or source span returns `invalid_input`; nothing is written on failure.

**Steps**:
1. [x] - `p1` - API: `item_review { item_id, rev, decision }` applies accept, reject or restore without changing item status - `inst-review-single`
2. [x] - `p1` - API: `items_review_all { call_id, kinds }` selects current suggested rows of those kinds, or all kinds when empty; accept eligible rows under one batch id and report skipped rows - `inst-review-batch`
3. [x] - `p1` - API: `item_edit { item_id, rev, patch }` validates wanted fields, treating omitted fields as unchanged and explicit set-or-clear values as the nullable-field operation - `inst-review-edit`
4. [x] - `p1` - Preserve the generated text for edit comparison; saving in the review row can then accept through `item_review` with the returned revision; inspector save alone need not accept - `inst-review-accept-edit`
5. [x] - `p1` - API: `item_create { call_id, kind, text, owner, due, span }` creates a user-authored, accepted item and validates any optional evidence span - `inst-review-create`
6. [x] - `p1` - API: `item_reopen { item_id, rev }` returns a closed or handed-off item to open without changing review, retaining its history and evidence - `inst-review-reopen`
7. [x] - `p1` - Apply every operation through `cpt-noter-algo-core-items-today-mutate`; return the record and change id, or `ItemsBatchResult` for bulk review - `inst-review-return`

### Tick an item or answer a handoff

- [x] `p1` - **ID**: `cpt-noter-flow-core-items-today-tick`

**Actor**: Primary user (main window or call screen)

**Success Scenarios**:
- A tick accepts a suggestion and marks it done; undo restores its prior review and status. A handed-off row asks whether the handoff landed.

**Error Scenarios**:
- An item changed elsewhere returns `conflict` rather than closing a stale version.

**Steps**:
1. [x] - `p1` - For an ordinary item, API: `item_set_done { item_id, rev, done }` sets wanted done/open state; repeating the current wanted state creates no duplicate effect - `inst-tick-wanted`
2. [x] - `p1` - **IF** the user ticks a handed-off row, ask Did the handoff land in the UI before sending its answer; do not infer the answer from a generic tick - `inst-tick-handoff`
3. [x] - `p1` - API: `item_answer_handoff_landed { item_id, rev, answer }`; landed or done_another_way marks done with the stated reason, keep_open leaves handed_off and asks again next matching call - `inst-tick-answer`
4. [x] - `p1` - Log status, review and completion time atomically, publish the changed item, and recompute Today counts from committed data - `inst-tick-commit`
5. [x] - `p1` - A UI Undo uses `change_undo` with the returned handle; the ten-second strip is presentation only and History reversal remains available later - `inst-tick-undo`
6. [x] - `p1` - **RETURN** `ItemMutation` - `inst-tick-return`

### Read Today before the next call

- [x] `p1` - **ID**: `cpt-noter-flow-core-items-today-dashboard`

**Actor**: Primary user (main window)

**Success Scenarios**:
- Today shows upcoming calls, last-time lines, carried work, due items without a call, done today, review counts and current proposals; a live call is represented first.
- No recorded calls or no calendar events produces the contract's empty state without fabricated data.

**Error Scenarios**:
- Calendar not asked or denied: no automatic prompt and item sections remain available; failed permitted EventKit read returns `calendar_unavailable` for Try Again.

**Steps**:
1. [x] - `p1` - API: `today_get {}`; read local date, Today settings, capture state and current calendar authorization - `inst-today-request`
2. [x] - `p1` - **IF** calendar is not asked or denied, return the corresponding `CalendarAccess` and no protected events; only `permission_request` may ask for access - `inst-today-no-access`
3. [x] - `p1` - **ELSE** read allowed calendars for the configured horizon through EventKit; **IF** it fails **RETURN** `calendar_unavailable` - `inst-today-calendar`
4. [x] - `p1` - For each event run `cpt-noter-algo-core-items-today-carry`, add known attendees, sensitivity, last-time summary and source call; group Today and This week by event time - `inst-today-carry`
5. [x] - `p1` - Include the live call even without a calendar match, due-without-call items, done-today items, suggested review count and existing waiting proposals; before M5 proposal production these may be empty - `inst-today-sections`
6. [x] - `p1` - Return self-test, audio-access and interrupted-recording banners from existing setup/capture facts; first use has no invented open items - `inst-today-banners`
7. [x] - `p1` - **RETURN** a complete `TodayView` with its effective ranking - `inst-today-return`

### Share or export a scope

- [x] `p1` - **ID**: `cpt-noter-flow-core-items-today-share`

**Actor**: Primary user (main window)

**Success Scenarios**:
- Whole call, one section or selected items copy in the chosen format with owners, dates and review labels; export writes a folder containing the requested content.
- A sensitive call may be explicitly copied, with `sensitive` reported to the UI.

**Error Scenarios**:
- Unwritten outputs: `outputs_not_ready`; suggested items excluded by the request's review guard: `unreviewed_in_scope`; cancelled panel: `cancelled`.

**Steps**:
1. [x] - `p1` - API: `share_copy { call_id, scope, format }` or `calls_export { call_ids, include, scope }`; resolve the scope with `cpt-noter-algo-core-items-today-format` - `inst-share-request`
2. [x] - `p1` - For copy, write rich and plain clipboard representations through native services and return `ShareResult` with text, section count, item count, unreviewed count and sensitivity - `inst-share-copy`
3. [x] - `p1` - For export, show the native save panel; **IF** cancelled **RETURN** `cancelled` without writing a completed export - `inst-share-panel`
4. [x] - `p1` - Write selected summary/items as Markdown, transcript as SRT and JSON, and audio only while stored and requested; keep scope restrictions in every format - `inst-share-export`
5. [x] - `p1` - **IF** requested audio has been deleted, return `audio_deleted` rather than inventing files; an I/O failure returns the typed error and no success count for incomplete output - `inst-share-fail`
6. [x] - `p1` - **RETURN** `ExportResult` after completion; reveal-in-Finder uses the existing external-open command - `inst-share-return`

### Set and list call tags

- [x] `p1` - **ID**: `cpt-noter-flow-core-items-today-tags`

**Actor**: Primary user (main window)

**Success Scenarios**:
- Add and remove tags across selected calls with Undo; suggestions include only tags currently used by calls.

**Error Scenarios**:
- A tag outside 1–32 characters is `invalid_input`; a deleted target call is `not_found`.

**Steps**:
1. [x] - `p1` - API: `call_tags_set { call_ids, add, remove }`; validate calls and tags, normalize case for uniqueness and deduplicate - `inst-tags-set`
2. [x] - `p1` - DB: apply explicit tag additions and removals to every selected call under the writer, advance affected call revisions and append the logged change in one transaction; repeated additions or removals have no duplicate effect - `inst-tags-write`
3. [x] - `p1` - Publish whole changed calls and return `TagsSetResult` with the calls and undo handle - `inst-tags-publish`
4. [x] - `p1` - API: `tags_list {}` reads distinct currently used tags and their counts for `TagList`; do not generate model suggestions - `inst-tags-list`
5. [x] - `p1` - **RETURN** the tag result - `inst-tags-return`

## 3. Processes / Business Logic (CDSL)

### Apply an item intent atomically

- [x] `p1` - **ID**: `cpt-noter-algo-core-items-today-mutate`

**Input**: Validated intent, current revision where supplied, actor and target item or selected batch.

**Output**: Changed complete item and undo handle, batch result, or a typed error.

**Steps**:
1. [x] - `p1` - On the writer, load the target and compare the supplied revision; **IF** stale **RETURN** `conflict` with `current_rev` - `inst-mutate-rev`
2. [x] - `p1` - Validate status × review transition and all referenced people, call, topic and evidence spans - `inst-mutate-validate`
3. [x] - `p1` - Compute wanted status and review independently; done on suggested means accepted and done, restore rejection means suggested without losing provenance - `inst-mutate-state`
4. [x] - `p1` - Write item fields, spans, normalized indexes and change rows in the same transaction; keep rejection identity for regeneration suppression - `inst-mutate-write`
5. [x] - `p1` - For bulk review, re-check selected rows on the writer, skip rows no longer suggested and use one batch handle with bounded logged writes - `inst-mutate-bulk`
6. [x] - `p1` - After commit refresh per-call `items.json`, publish whole changed entities and return the updated revision and handles - `inst-mutate-publish`
7. [x] - `p1` - **RETURN** without running a model or network request inside the writer transaction - `inst-mutate-return`

### Carry forward and rank relevant work

- [x] `p1` - **ID**: `cpt-noter-algo-core-items-today-carry`

**Input**: Known attendees, upcoming or live call, Today settings and current item/call rows.

**Output**: Ranked open work, questions and awaiting handoffs with source-call references.

**Steps**:
1. [x] - `p1` - Resolve known participants and read the last two calls with the same people; unknown attendees alone do not imply a match - `inst-carry-match`
2. [x] - `p1` - Select open accepted items and suggested items marked Not reviewed; exclude rejected or completed work and include awaiting handoffs in their separate collection - `inst-carry-select`
3. [x] - `p1` - Deduplicate by item id, join owners, due dates and spans, and retain `carried_from` provenance - `inst-carry-join`
4. [x] - `p1` - For default `owed_to_todays_people`, rank items owed to today's people first, then due date, then age; for `due_then_owed_to_you`, rank due date then owed to you, with stable identity tie-breaking - `inst-carry-rank`
5. Logging offered open items as carried at call start: delivered by `core-people` (M3), which owns the live-call people hook; `inst-carry-start` is there.
6. Returning carried items to open at call end: delivered by `core-people` (M3); `inst-carry-end` is there.
7. [x] - `p1` - **RETURN** the same query result to Today and the later copilot's initial context - `inst-carry-return`

### Resolve and format share content

- [x] `p1` - **ID**: `cpt-noter-algo-core-items-today-format`

**Input**: Call ids, `ShareScope`, requested format and current committed outputs/items.

**Output**: Sanitized formatted content and exact scope counts or typed error.

**Steps**:
1. [x] - `p1` - Treat empty section or item selectors as all content within their containing selection; reject item ids outside the selected call or sections - `inst-format-scope`
2. [x] - `p1` - Read only committed available sections; **IF** nothing requested is ready **RETURN** `outputs_not_ready` - `inst-format-ready`
3. [x] - `p1` - Count suggested items in scope; **IF** present and `include_unreviewed` is false **RETURN** `unreviewed_in_scope`; otherwise include them visibly marked Not reviewed - `inst-format-review`
4. [x] - `p1` - Omit rejected items; render Slack, Jira or Markdown with owners, dates and evidence links, escaping target markup and excluding raw HTML - `inst-format-render`
5. [x] - `p1` - Keep explicit sensitive-call copies available, reporting sensitivity; this clipboard action is not an automatic cloud request - `inst-format-sensitive`
6. [x] - `p1` - **RETURN** the formatted content and actual counts without changing review or status - `inst-format-return`

## 4. States (CDSL)

### Item status and review

- [x] `p1` - **ID**: `cpt-noter-state-core-items-today-item`

**States**: status open, done, handed_off, carried, closed_by_evidence, answered_in_call; review suggested, accepted, rejected

**Initial State**: open and suggested for extraction; open and accepted for manual creation or pins

**Transitions**:
1. [x] - `p1` - **FROM** open **TO** done **WHEN** `item_set_done(true)` commits; suggested review becomes accepted - `inst-st-done`
2. [x] - `p1` - **FROM** done **TO** open **WHEN** `item_set_done(false)` commits, with review unchanged - `inst-st-untick`
3. [x] - `p1` - **FROM** open **TO** handed_off **WHEN** handoff successfully opens or copies; a suggestion becomes accepted - `inst-st-handoff`
4. [x] - `p1` - **FROM** handed_off **TO** done **WHEN** landed or done_another_way is answered with the current revision - `inst-st-landed`
5. [x] - `p1` - **FROM** handed_off **TO** handed_off **WHEN** keep_open or Esc leaves it awaiting the next matching call - `inst-st-keep-open`
6. The open to carried transition: delivered by `core-people` (M3); `inst-st-carried` is there.
7. The carried to open transition: delivered by `core-people` (M3); `inst-st-return-open` is there.
8. The open to answered_in_call transition: delivered by `core-evidence-proposals` (M5); `inst-st-answered` is there.
9. The open to closed_by_evidence transition: delivered by `core-evidence-proposals` (M5); `inst-st-evidence` is there.
10. [x] - `p1` - **FROM** done **TO** open **WHEN** `item_reopen` commits; the same applies from handed_off, closed_by_evidence or answered_in_call, review unchanged - `inst-st-reopen`
11. [x] - `p1` - **FROM** suggested **TO** accepted **WHEN** review accept commits, with status unchanged - `inst-st-accept`
12. [x] - `p1` - **FROM** suggested **TO** rejected **WHEN** review reject commits; its regeneration suppression remains recorded - `inst-st-reject`
13. [x] - `p1` - **FROM** rejected **TO** suggested **WHEN** explicit restore commits - `inst-st-restore`

Every transition is persisted with a change row and revision. Invalid input leaves both axes unchanged. The stale `ItemStatus` doc comment suggesting keep_open returns open is superseded by `HandoffLandedAnswer`, DESIGN-core 3.1 and the PRD: it stays handed_off. Evidence production is M5; M2 renders existing evidence and implements the lifecycle boundary.

## 5. Definitions of Done

### Item intents and evidence

- [x] `p1` - **ID**: `cpt-noter-dod-core-items-today-items`

The system **MUST** serve filtered pages and complete inspectors, apply revision-guarded review, edits, manual creation, wanted completion, reopen and handoff answers, and persist independent status and review with Undo. Bulk review returns one batch handle and skipped count. Evidence spans must resolve after archive replacement and without audio.

**Implements**:
- `cpt-noter-flow-core-items-today-read`
- `cpt-noter-flow-core-items-today-review`
- `cpt-noter-flow-core-items-today-tick`
- `cpt-noter-algo-core-items-today-mutate`
- `cpt-noter-state-core-items-today-item`

**Touches**:
- API: the nine item commands above, `entity:changed`
- DB: `items`, `item_spans`, `changes`; read `evidence`
- Entities: `ItemView`, `ItemDetail`, `ItemMutation`, `ItemsBatchResult`

### Today and carry-forward

- [x] `p1` - **ID**: `cpt-noter-dod-core-items-today-dashboard`

The system **MUST** assemble Today from permitted EventKit data and local records, use the same last-two-calls carry query as initial copilot context, honor both ranking settings and retain due/done/review sections without calendar access. Calendar reads never prompt; failed authorized reads return `calendar_unavailable`.

**Implements**:
- `cpt-noter-flow-core-items-today-dashboard`
- `cpt-noter-algo-core-items-today-carry`

**Touches**:
- API: `today_get`
- DB: `items`, `calls`, `call_participants`, `summaries`, `changes`, settings
- Entities: `TodayView`, `UpcomingCall`, `TodayRanking`

### Sharing, export and tags

- [x] `p1` - **ID**: `cpt-noter-dod-core-items-today-sharing`

The system **MUST** format exactly the selected scope, guard unreviewed items, write rich clipboard formats and export only requested files through the native panel. Tag additions and removals across selected calls must be validated, case-normalized for uniqueness, serialized by the writer and undoable, with suggestions drawn only from current usage. The command has no caller-supplied revision.

**Implements**:
- `cpt-noter-flow-core-items-today-share`
- `cpt-noter-flow-core-items-today-tags`
- `cpt-noter-algo-core-items-today-format`

**Touches**:
- API: `share_copy`, `calls_export`, `call_tags_set`, `tags_list`
- DB: `call_tags`, `calls`, `changes`
- Entities: `ShareResult`, `ExportResult`, `TagsSetResult`, `TagList`

### Tests and gate

- [x] `p1` - **ID**: `cpt-noter-dod-core-items-today-tests`

The system **MUST** pass unit tests for status × review, conflicts, batch undo, carry matching, both rankings, timezone boundaries, calendar guards, share scopes and tags; fake/real conformance for all fourteen commands; and the five real-core story E2E named above. Cover the M2 performance entry `items-list` with `core_items_today` over a year of fixture calls, including `items_list` and `today_get`. Native clipboard and save-panel tests use the built app, with deterministic adapters at the harness boundary. `just gate` passes.

Not covered here: the built-app clipboard and save-panel XCUITest is UI M2 (owner-gated); the `items-list` performance entry is not covered (NO PERFORMANCE TESTS); the real-core story E2E exercises `keep_open` and `landed` but not `done_another_way`, which only the core unit tests cover.

**Implements**:
- `cpt-noter-algo-core-items-today-mutate`
- `cpt-noter-algo-core-items-today-carry`
- `cpt-noter-algo-core-items-today-format`

**Touches**:
- API: the fourteen frozen commands above

## 6. Acceptance Criteria

- [ ] Real-core E2E `cpt-noter-seq-today-review-before-call` reads known-attendee carry-forward, evidence, last-time text, live-call and calendar empty/denied/failure states.
- [ ] Real-core E2E `cpt-noter-seq-today-tick-item` ticks, accepts a suggestion, undoes it and answers all handoff outcomes with current revisions.
- [ ] Real-core E2E `cpt-noter-seq-call-page-review-suggested-items` accepts, edits then accepts, rejects, restores and bulk-accepts; undo reverses the batch and regeneration keeps reviewed work and suppresses rejected suggestions.
- [ ] Real-core E2E `cpt-noter-seq-call-page-share-outputs` copies every rich format, checks whole/section/selection scope, reports sensitive and unreviewed content and exports selected files through the native seam.
- [ ] Real-core E2E `cpt-noter-seq-call-page-check-evidence` opens current evidence with archive pending, after archive upgrade and after audio deletion; inspector edits and History remain available.
- [ ] All fourteen commands succeed in real-core E2E, with native-app coverage for actual clipboard and panels; conformance checks scopes, revisions, errors and complete view models.
- [ ] Unit tests prove deterministic ranking, no implicit calendar request, no duplicate tag usage, correct set/clear patches and rollback without orphan changes.
- [ ] `just gate` passes.
