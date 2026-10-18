---
title: "Feature — Items, review and evidence"
description: "Review suggested items, edit their details, tick or reopen them, and check their evidence."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-items
milestone: M2
---

# Feature: Items, review and evidence

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Review suggested items](#review-suggested-items)
  - [Tick, reopen or add an item](#tick-reopen-or-add-an-item)
  - [Inspect details and check evidence](#inspect-details-and-check-evidence)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Save an item draft](#save-an-item-draft)
- [4. States (CDSL)](#4-states-cdsl)
  - [Item review](#item-review)
  - [Item completion](#item-completion)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Rows, review and completion](#rows-review-and-completion)
  - [Inspector and evidence](#inspector-and-evidence)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p3` - **ID**: `cpt-noter-featstatus-ui-items`

## 1. Feature Context

- [ ] `p3` - `cpt-noter-feature-ui-items`

### 1.1 Overview

Suggested items wait for review; accepted items can be ticked, edited, handed off or reopened. One row implementation serves the Call page and Today, and the Item inspector shows details, evidence and History. The core owns review, status, ranking, closing evidence and suppression after rejection. Output sections and sharing belong to `cpt-noter-feature-ui-call-page-outputs`.

### 1.2 Purpose

It implements `cpt-noter-component-ui-action-item-row`, `cpt-noter-component-ui-item-inspector` and `cpt-noter-component-ui-provenance-chip`.

**Requirements**: PRD › Feature specification › 4. Post-call outputs and 10. Self-maintenance; Maintenance jobs, evidence collection and history › Evidence rules. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-evidence-one-click`, `cpt-noter-principle-core-owns-state`, `cpt-noter-principle-undo-over-confirm`, `cpt-noter-principle-keyboard-first`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Reviews, edits, ticks and reopens items; checks evidence |
| Noter core (system) | Persists items and changes, resolves spans, returns closing evidence |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 4 and 10
- **Design**: [DESIGN.md](../../DESIGN.md) › Action item row; Item inspector; Provenance chip; Call page States and stories
- **Decomposition**: [DECOMPOSITION.md](../../DECOMPOSITION.md) › 2.17, M2, NOT_STARTED
- **Design elements**: `cpt-noter-component-ui-action-item-row`, `cpt-noter-component-ui-item-inspector`, `cpt-noter-component-ui-provenance-chip`; uses `cpt-noter-component-ui-output-item-row` from outputs
- **Stories**: `cpt-noter-seq-call-page-review-suggested-items`, `cpt-noter-seq-call-page-check-evidence` (M2, every path); serves `cpt-noter-seq-today-tick-item`
- **Frozen commands it delivers (M2)**: `items_list`, `item_get`, `item_set_done`, `item_review`, `items_review_all`, `item_edit`, `item_reopen`, `item_create`, `item_answer_handoff_landed`
- **Other commands it calls**: `transcript_span`, `audio_play`, `audio_stop`, `window_navigate`; `change_undo` through History
- **Events**: `entity:changed` (item, outputs), transcript updates and audio state through the existing stores
- **Contract**: `apps/desktop/src/core/bindings.ts` › ItemView, ItemMutation, ItemPatch, ItemDetail, TimeSpan, Provenance; `apps/desktop/src/core/fake/handlers.ts` and `fake-core.ts`
- **Prototype modules**: `src/js/30-c-0-components.js` › `C.actionItemRow`, item actions; `src/js/30-c-callpage.js` › `inspector('item')`; `src/js/04-shared.js` › `C.provenanceChip`; `.it-*`, `.pc-*`, `.np-prov*`
- **Dependencies**: `cpt-noter-feature-ui-call-page-frame`, `cpt-noter-feature-ui-history-undo`; stored transcript and playback through the frame

## 2. Actor Flows (CDSL)

### Review suggested items

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-items-review`

**Actor**: Primary user

**Success Scenarios**:
- **Start Review** focuses the first suggestion. A accepts; E edits; R rejects; ⇧A accepts the section. **Accept All** in the banner accepts all suggestions as one batch.
- No suggestions: no banner, review count or Accept All; pinned and user-created items arrive accepted.

**Error Scenarios**:
- Rejected by mistake: **Rejected · Undo** for 10 s, then **Rejected (1)** with **Restore**.
- Regeneration preserves accepted and edited items and rejected suppression; **1 item not suggested again because you rejected it** comes from core state.

**Steps**:
1. [ ] - `p1` - Read `items_list` for the call, with page cursors, and render the core review states; **Start Review** selects the first suggested row in section order - `inst-list`
2. [ ] - `p1` - **MATCH** the focused row action, outside text inputs and input-method composition - `inst-action`
   1. [ ] - `p1` - **CASE** A or **Accept**: `item_review` with item id, current rev and **accept**; show **Accepted** for 4 s and move focus to the next suggestion - `inst-accept`
   2. [ ] - `p1` - **CASE** R or **Reject**: `item_review` with **reject**; show **Rejected · Undo** for 10 s, then fold into **Rejected (n)**; move focus to the next suggestion - `inst-reject`
   3. [ ] - `p1` - **CASE** E on a full action row: fields for text, Owner, Due and Engineering; Cancel or Esc discards the draft; Save or ⌘Return invokes the edit process - `inst-edit`
   4. [ ] - `p1` - **CASE** E on a decision, question or compact row: open the Item inspector; saving details and accepting remain separate actions there - `inst-inspect`
   5. [ ] - `p1` - **CASE** ⇧A or section **Accept All**: `items_review_all` with call id and that section's kinds; banner **Accept All** uses empty kinds for all - `inst-all`
3. [ ] - `p1` - For a batch, show **Accepted 7 suggested items · Undo** using returned items and batch id; do not count skipped items as accepted - `inst-batch`
4. [ ] - `p1` - **IF** Restore is chosen: `item_review` with **restore** and current rev; return the rejected row to Suggested - `inst-restore`
5. [ ] - `p1` - **IF** any mutation fails: retain its draft, show the typed error and no success status; on conflict refresh `item_get` and require a new user save - `inst-error`
6. [ ] - `p1` - **RETURN** core review states, updated counts and the next suggested focus, or the section header when none remain - `inst-return`

### Tick, reopen or add an item

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-items-status`

**Actor**: Primary user

**Success Scenarios**:
- Space or the checkbox marks an action item done; a suggestion is also accepted. **Done · Undo** or **Accepted and done · Undo** lasts 10 s.
- **Add Action Item** creates an accepted item owned by the user; **Reopen** reverses a closed status with a logged user change.

**Error Scenarios**:
- An open handoff asks **Did the handoff land?** before completion; **Keep Open** or Esc keeps it handed off.
- `conflict`, empty text or a removed item never produces a success message.

**Steps**:
1. [ ] - `p1` - User ticks an action item; decisions and questions have no checkbox - `inst-tick`
2. [ ] - `p1` - **IF** its status is handed_off - `inst-handoff`
   1. [ ] - `p1` - Show **Yes, Landed**, **Done Another Way**, **Keep Open**; send `item_answer_handoff_landed` with current rev and **landed**, **done_another_way** or **keep_open** - `inst-answer`
3. [ ] - `p1` - **ELSE**: `item_set_done` with current rev and the desired done state; never send a toggle - `inst-done`
4. [ ] - `p1` - Render the returned item and retain its change id for Undo; Today moves it into Done today after the inline feedback - `inst-result`
5. [ ] - `p1` - **IF** the user chooses **Reopen** on closed_by_evidence or answered_in_call: `item_reopen` with current rev, then **Reopened · Undo** - `inst-reopen`
6. [ ] - `p1` - **IF** the user chooses **Add Action Item**: show **What needs doing, and who does it?**; trim and require text; Return or Add calls `item_create` for action_item with the user's existing person reference - `inst-create`
7. [ ] - `p1` - **IF** an operation fails: keep the previous view and draft, show the named error and allow explicit retry after refresh - `inst-failure`
8. [ ] - `p1` - **RETURN** the core item; row Undo uses the returned change target through History, preserving prior review and handoff state - `inst-return`

### Inspect details and check evidence

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-items-evidence`

**Actor**: Primary user

**Success Scenarios**:
- Click **00:23:40** or Return on a row: Transcript opens with the resolved line focused and highlighted for 3 s; Space plays its span with context; ⌘[ returns to Summary.
- The 320-pt Item inspector opens with Details and History; the date picker sets **Fri 17 Oct**, Save confirms **Saved** for 2 s.

**Error Scenarios**:
- Audio deleted: evidence remains text with speaker and time, deletion date in the header, no play controls.
- Archive pending: evidence opens the live span. Transcript upgraded: resolve the span again, show the archive notice and allow Show/Hide Archive Changes with user edits kept.

**Steps**:
1. [ ] - `p1` - User opens (i) or ⌘I; `item_get` returns the item, evidence and initial history - `inst-get`
2. [ ] - `p1` - UI: action details include text, Owner, Due with calendar button, Status, Linked issue and its automatic-close helper, Engineering with Handoff, review actions, Evidence, source quote and handoff record - `inst-details`
3. [ ] - `p1` - For decisions and questions show text, Linked issue, evidence and quote; omit Owner, Due, Status and Engineering - `inst-kind`
4. [ ] - `p1` - User changes Owner, Status or Engineering; apply supported commands immediately; text, Due and Linked issue wait for Save - `inst-edit`
5. [ ] - `p1` - User chooses History; mount the item variant of the history timeline with actor pop-up, no job filter and no export - `inst-history`
6. [ ] - `p1` - User opens a provenance time; `transcript_span` with its TimeSpan resolves current segments rather than a cached row index; navigate to Transcript and focus the first resolved line - `inst-resolve`
7. [ ] - `p1` - **IF** audio is unavailable: show the deletion or never-stored line and omit play; **ELSE** Space uses the existing playback flow and safety rules - `inst-audio`
8. [ ] - `p1` - **IF** the archive upgraded the transcript: resolve against the current pass and offer the archive diff; pending archive keeps the live evidence usable - `inst-archive`
9. [ ] - `p1` - **IF** the source is deleted: render **Source deleted** without a dead link; unresolved reads show **Finding the source…**, then a retryable error - `inst-source`
10. [ ] - `p1` - **RETURN** the evidence or inspector; Esc closes the inspector and returns focus to its row; back navigation restores the origin and scroll - `inst-return`

## 3. Processes / Business Logic (CDSL)

### Save an item draft

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-items-save`

**Input**: Item id, base rev, draft fields, inline-review or inspector context

**Output**: Updated item and change target, or retained draft and error

**Steps**:
1. [ ] - `p1` - Require non-empty trimmed text; map cleared Owner, Due and Linked issue to their typed clear variants, not null which leaves fields unchanged - `inst-normalize`
2. [ ] - `p1` - API: `item_edit` with base rev and only changed fields; retain the draft until success - `inst-edit`
3. [ ] - `p1` - **IF** conflict: fetch `item_get`, keep the draft separate from current values, show **Item changed since** and require the user to save again; **RETURN** the conflict - `inst-conflict`
4. [ ] - `p1` - **IF** another error: show field validation or section retry and **RETURN** the retained draft - `inst-error`
5. [ ] - `p1` - **IF** inline review saved a suggestion: `item_review` with **accept** and the new rev; show **Saved and accepted** for 4 s only after both calls succeed - `inst-accept`
6. [ ] - `p1` - **IF** acceptance fails after editing: keep the saved edit visible and Suggested, with retry for acceptance only - `inst-partial`
7. [ ] - `p1` - **RETURN** returned item and change targets; inspector Save shows **Saved** for 2 s without implicitly accepting - `inst-return`

## 4. States (CDSL)

### Item review

- [ ] `p1` - **ID**: `cpt-noter-state-ui-items-review`

**States**: SUGGESTED, EDITING, SAVING, ACCEPTED, REJECTED_OUTCOME, REJECTED

**Initial State**: SUGGESTED for extracted items; ACCEPTED for user-created and pinned items

**Transitions**:
1. [ ] - `p1` - **FROM** SUGGESTED **TO** EDITING **WHEN** Edit opens a draft - `inst-edit`
2. [ ] - `p1` - **FROM** EDITING **TO** SUGGESTED **WHEN** Cancel discards the draft - `inst-cancel`
3. [ ] - `p1` - **FROM** EDITING **TO** SAVING **WHEN** Save submits valid fields - `inst-save`
4. [ ] - `p1` - **FROM** SAVING **TO** ACCEPTED **WHEN** inline edit and acceptance both succeed - `inst-saved`
5. [ ] - `p1` - **FROM** SAVING **TO** EDITING **WHEN** save fails; retain the draft - `inst-failed`
6. [ ] - `p1` - **FROM** SAVING **TO** SUGGESTED **WHEN** inspector save succeeds or inline acceptance fails after the edit - `inst-separate`
7. [ ] - `p1` - **FROM** SUGGESTED **TO** ACCEPTED **WHEN** accept, batch accept, tick or handoff succeeds - `inst-accept`
8. [ ] - `p1` - **FROM** SUGGESTED **TO** REJECTED_OUTCOME **WHEN** rejection succeeds - `inst-reject`
9. [ ] - `p1` - **FROM** REJECTED_OUTCOME **TO** REJECTED **WHEN** its 10-second outcome expires - `inst-fold`
10. [ ] - `p1` - **FROM** REJECTED_OUTCOME, REJECTED, ACCEPTED **TO** SUGGESTED **WHEN** restore or the matching core undo restores the suggestion - `inst-restore`

### Item completion

- [ ] `p1` - **ID**: `cpt-noter-state-ui-items-completion`

**States**: OPEN, CARRIED, HANDOFF_QUESTION, HANDED_OFF, DONE, CLOSED_BY_EVIDENCE, ANSWERED_IN_CALL

**Initial State**: The core's ItemView.status

**Transitions**:
1. [ ] - `p1` - **FROM** OPEN, CARRIED **TO** DONE **WHEN** item_set_done succeeds - `inst-done`
2. [ ] - `p1` - **FROM** HANDED_OFF **TO** HANDOFF_QUESTION **WHEN** the checkbox is invoked - `inst-ask`
3. [ ] - `p1` - **FROM** HANDOFF_QUESTION **TO** DONE **WHEN** landed or done_another_way succeeds - `inst-landed`
4. [ ] - `p1` - **FROM** HANDOFF_QUESTION **TO** HANDED_OFF **WHEN** keep_open or Esc is chosen - `inst-keep`
5. [ ] - `p1` - **FROM** OPEN, CARRIED **TO** HANDED_OFF **WHEN** core reports a successful handoff launch - `inst-handoff`
6. [ ] - `p1` - **FROM** OPEN, CARRIED, HANDED_OFF **TO** CLOSED_BY_EVIDENCE **WHEN** core supplies qualifying linked-key evidence - `inst-evidence`
7. [ ] - `p1` - **FROM** OPEN, CARRIED **TO** ANSWERED_IN_CALL **WHEN** core reports an answered question - `inst-answered`
8. [ ] - `p1` - **FROM** DONE, CLOSED_BY_EVIDENCE, ANSWERED_IN_CALL **TO** OPEN **WHEN** untick or Reopen succeeds; core undo may restore a prior handed-off or carried status instead - `inst-reopen`
9. [ ] - `p1` - **FROM** CARRIED **TO** OPEN **WHEN** core reports the carry-forward call ended - `inst-returned`

## 5. Definitions of Done

### Rows, review and completion

- [ ] `p3` - **ID**: `cpt-noter-dod-ui-items-actions`

The system **MUST** render full, compact, done and read-only action rows; bind review keys, counts, timers, batch targets, restore, wanted-state completion and handoff answers to typed commands; never infer completion from keywords or commits.

**Implements**:
- `cpt-noter-flow-ui-items-review`
- `cpt-noter-flow-ui-items-status`
- `cpt-noter-algo-ui-items-save`
- `cpt-noter-state-ui-items-review`
- `cpt-noter-state-ui-items-completion`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: all nine M2 item commands listed above
- Tests: unit review order, timer, focus, patch-clear, rev-conflict and handoff-answer cases; conformance for each command, accepted creation, batch skipped counts and restore; real-core E2E `cpt-noter-seq-call-page-review-suggested-items` (every path), `cpt-noter-seq-today-tick-item`; screenshots of all row states and variants

### Inspector and evidence

- [ ] `p3` - **ID**: `cpt-noter-dod-ui-items-inspector`

The system **MUST** show Details and History, persist fields at the designed point, resolve evidence against the current transcript, preserve back navigation and keep deleted-audio evidence readable. Diff changes use underline and strike-through as well as colour.

**Implements**:
- `cpt-noter-flow-ui-items-evidence`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `item_get`, `item_edit`, `transcript_span`, `audio_play`, `audio_stop`; History commands through its feature
- Tests: unit kind-specific fields, focus return and stale span resolution; conformance audio-deleted and transcript-upgraded errors; real-core E2E `cpt-noter-seq-call-page-check-evidence` (every path); screenshots of Details, History, evidence, archive pending and upgraded states

**Completion gate.** Write failing tests first; unit and changed-line coverage meet 80% per side. Real-core E2E counts successful frozen commands and named stories toward the 60% bar; fake-only tests do not count. Screenshots meet 98%, due performance coverage meets 60% and scenarios stay within 10% of base instruction counts; trace coverage never falls. `just gate-fast` stays green; `just gate` passes.

## 6. Acceptance Criteria

- [ ] A, E, R and ⇧A work only in row context, with no action during text composition
- [ ] Saved inline edits accept with the new revision; inspector Save alone leaves review unchanged
- [ ] Rejected items restore as Suggested, and batch Undo targets the returned batch
- [ ] Ticking an open handoff asks all three choices; Keep Open and Esc do not complete it
- [ ] Evidence opens in one action with focus and a 3-second highlight; audio loss never hides the quote
- [ ] Inspector fields match the item kind, and closing it returns focus to the row

## 7. Additional Context

**Prototype reuse.** Rewrite `C.actionItemRow`, `inspector('item')` and `C.provenanceChip` as React `ActionItemRow`, `ItemInspector` and `ProvenanceChip`; the shared review controller also serves outputs' `OutputItemRow`. Port `.it-*`, `.pc-info*`, `.np-prov*` styles from Group C and shared base styles. Keep component, primitive, variant, state, size and region attributes; replace `NP` mutations, fixture ids and flash timers with typed commands and view state. The inspector docks at Wide and overlays at Medium/Narrow. Labels wrap before controls truncate; Cyrillic and German +30% fixtures carry their own language attributes. Status feedback is polite; checkbox hit areas include the text and small actions keep 24-pt targets. Reduce motion removes sliding and collapse animation.

**States coverage.** Rows cover open, suggested, editing, accepted, rejected, done, handoff question, handed off, carried, closed by evidence, close proposed, overdue and writing. The inspector covers viewing, editing, saving, closed, proposal pending and loading; errors retain drafts. Provenance covers loading, source deleted, external, not reviewed and unverified model guess. Model guesses are never styled as verified sources.

**DESIGN versus prototype.** The prototype's inline action save changes review and fields together; the frozen `item_edit` does not accept. Production uses the two calls above and exposes partial success. Prototype checkbox undo resets status locally; production restores the returned change so prior review/handoff state is kept. Single-key review and full keyboard selection are shown but not wired in the prototype; DESIGN supplies their behaviour. The inspector's Status menu includes Carried, Handed Off and Closed, but ItemPatch has no status field: these statuses are core results, and completion/reopen use the explicit commands. Arbitrary direct status assignment remains an owner contract gap, not a new UI API. People lookup/create in owner pickers is M3; the shared speakers picker supplies the M2 fake path and records that real-core limitation.

**Data.** Read through core only: `cpt-noter-dbtable-items`, `cpt-noter-dbtable-item-spans`, `cpt-noter-dbtable-evidence`, `cpt-noter-dbtable-suppressions`. Suppression, automatic closure and append-only logging are core responsibilities. The fake's item/batch changes do not prove real suppression, inverse writes or Today regrouping; conformance needs the real core.

**Not applicable.** No new schema, network client, evidence job, credential, migration or deployment is introduced. Activity proposal decisions ship in M5. Logging uses the bridge's ids and error codes, never item or quote text.
