---
title: "Feature: Speaker naming, term fixes and audio deletion"
description: "Logged transcript corrections that survive the archive pass, post-call naming and permanent audio deletion."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M2
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Speaker naming, term fixes and audio deletion

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Name a speaker live or after the call](#name-a-speaker-live-or-after-the-call)
  - [Correct a term and teach future decoding](#correct-a-term-and-teach-future-decoding)
  - [Delete audio permanently](#delete-audio-permanently)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Apply a correction that survives archive clustering](#apply-a-correction-that-survives-archive-clustering)
- [4. States (CDSL)](#4-states-cdsl)
  - [Audio availability](#audio-availability)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Corrections and naming](#corrections-and-naming)
  - [Delete audio for good](#delete-audio-for-good)
  - [Tests and gate](#tests-and-gate)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p3` - **ID**: `cpt-noter-featstatus-core-speakers-audio`

- [ ] `p3` - `cpt-noter-feature-core-speakers-audio`

## 1. Feature Context

### 1.1 Overview

The transcript service gains whole-call and single-line speaker naming, term fixes with glossary teaching, post-call naming and permanent audio deletion by call or age. Corrections become constraints for the archive pass. Voice-profile creation and person-page commands remain M3; a new name can still be created through the existing `PersonRef` in a naming command.

> **M2 decisions (Backend Teamlead, 1 Nov 2026).** `CallRow` and `CallDetail` gain `audio_deleted_at: Option<TimestampMs>` and `audio_retention_days`, delivered with `audio_delete_older` in a contract-lane PR (wire change, UI review by the UI Teamlead; `milestones.toml` untouched); the dated "Audio deleted on <date> (kept N days)" copy returns with it (TL-20, D-36). Story tests are story-named files in `apps/desktop/tests/conformance/m2-stories-*.test.ts` that drive the real core over `StdioCore` with the scripted runtime, secret store, native ops and engine, and assert the core-visible steps (rows, events, state); the UI E2E takes over when the UI M2 lands (TL-18, D-26).

### 1.2 Purpose

A name or term corrected once stays corrected after offline transcription, and deleting audio leaves the transcript and its evidence readable.

**Requirements**: PRD › Diarization and speaker identity; PRD › Feature specification › 2. Live transcript; PRD › Security, privacy and permissions.

**Principles**: `cpt-noter-principle-core-single-writer`

**Delivers**:
- Frozen commands (M2): `transcript_rename_speaker`, `transcript_fix_term`, `transcript_name_speakers`, `audio_delete`, `audio_delete_older`.
- Events: `entity:changed`; transcript `segments_updated` and `speakers_updated` after committed corrections.
- DESIGN.md stories (M2): `cpt-noter-seq-call-screen-name-speaker`, `cpt-noter-seq-call-page-name-speakers`.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Names speakers, corrects terms, deletes audio |
| Main window and call screen | Send corrections; audio deletion is main-window only |
| Transcript service and archive pipeline | Preserve corrections across live and archive passes |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-speakers-audio`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-transcript`, 3.1 Segment relationships; shared tables `cpt-noter-dbtable-speakers`, `cpt-noter-dbtable-segments`, `cpt-noter-dbtable-changes`
- **Stories**: [DESIGN.md](../../DESIGN.md), naming stories listed above
- **Contract**: `model/transcript.rs`, `common.rs`, `ipc/mod.rs` in `crates/noter-protocol/src`; `contracts/ipc.manifest.json`
- **Dependencies**: `cpt-noter-feature-core-live-transcript`, `cpt-noter-feature-core-history-undo`

## 2. Actor Flows (CDSL)

### Name a speaker live or after the call

- [ ] `p1` - **ID**: `cpt-noter-flow-core-speakers-audio-name`

**Actor**: Primary user (main window or call screen)

**Success Scenarios**:
- Whole call is the default scope; a known or newly created person replaces Speaker 3 on all its lines.
- A one-line correction leaves other lines alone; post-call assignments name several speakers in one batch, with skipped speakers unchanged.

**Error Scenarios**:
- Call, speaker or scoped segment is missing: `not_found`; a segment or speaker from another call is `invalid_input`.

**Steps**:
1. [ ] - `p1` - API: `transcript_rename_speaker { call_id, speaker_id, person, scope }` or `transcript_name_speakers { call_id, assignments }` - `inst-name-request`
2. [ ] - `p1` - Validate every speaker and optional segment belongs to the call; resolve existing `PersonRef` values or create the named person as part of the same logged batch - `inst-name-validate`
3. [ ] - `p1` - Leave null assignments unchanged; for each actual assignment run `cpt-noter-algo-core-speakers-audio-correct` - `inst-name-correct`
4. [ ] - `p1` - Commit one logged batch, then publish changed speakers and segments and whole affected entities; return `SpeakerMutation` with its undo handle - `inst-name-publish`
5. [ ] - `p1` - Keep text-only naming available when audio is gone; sample replay uses existing `audio_play` when available - `inst-name-no-audio`
6. [ ] - `p1` - **RETURN** names and counts through the existing view models; undo uses `change_undo` - `inst-name-return`

### Correct a term and teach future decoding

- [ ] `p1` - **ID**: `cpt-noter-flow-core-speakers-audio-term`

**Actor**: Primary user (main window or call screen)

**Success Scenarios**:
- A selected term is replaced, the original is retained in correction metadata and the glossary is updated when requested.

**Error Scenarios**:
- A range no longer fits the segment or crosses invalid text boundaries: `invalid_input`; a deleted segment: `not_found`.

**Steps**:
1. [ ] - `p1` - API: `transcript_fix_term { call_id, segment_id, range, replacement, add_to_glossary }` - `inst-term-request`
2. [ ] - `p1` - On the writer, validate call membership, range and replacement; apply the replacement and record its original text - `inst-term-validate`
3. [ ] - `p1` - DB: UPDATE `segments` text, normalized shadow text and corrections; when requested, upsert the glossary term in the same logged operation - `inst-term-write`
4. [ ] - `p1` - Commit, refresh the per-call transcript file and indexes, send `segments_updated` and `entity:changed`, and update the engine glossary for future decoding - `inst-term-publish`
5. [ ] - `p1` - Record reconciliation intent for earlier calls without rewriting them; return `proposal_queued` truthfully for work queued, with processing and proposal controls deferred to M5 - `inst-term-reconcile`
6. [ ] - `p1` - **RETURN** `FixTermResult` with segment, change id and optional glossary term id - `inst-term-return`

### Delete audio permanently

- [ ] `p1` - **ID**: `cpt-noter-flow-core-speakers-audio-delete`

**Actor**: Primary user (main window)

**Success Scenarios**:
- Explicit calls or calls older than the requested age lose audio; their transcript, outputs and evidence spans remain readable.

**Error Scenarios**:
- A selected call is live: `invalid_input`; filesystem failure must not report deleted bytes as freed.

**Steps**:
1. [ ] - `p1` - After the native permanent-delete alert for explicit calls, or the Delete Old Audio sheet, API: `audio_delete { call_ids }` or `audio_delete_older { older_than_days }`; cancelling confirmation sends no deletion - `inst-delete-request`
2. [ ] - `p1` - Resolve and deduplicate explicit calls or the age selection; refuse an explicit live-call target and exclude active capture from age deletion - `inst-delete-select`
3. [ ] - `p1` - Stop playback and prevent new replay or archive reads of the selected audio while deleting - `inst-delete-lock`
4. [ ] - `p1` - Remove stored microphone and system files; keep transcript files, summaries, items, marks and gaps - `inst-delete-files`
5. [ ] - `p1` - Through the writer, set audio-deleted availability for successfully removed files and append non-undoable changes without audio content; publish the calls - `inst-delete-log`
6. [ ] - `p1` - **IF** removal fails, retain truthful availability, release the guard and return the typed I/O error; retry must tolerate files already removed - `inst-delete-failure`
7. [ ] - `p1` - **RETURN** `DeleteAudioResult` with actual calls and freed megabytes; future replay returns `audio_deleted` - `inst-delete-return`

## 3. Processes / Business Logic (CDSL)

### Apply a correction that survives archive clustering

- [ ] `p1` - **ID**: `cpt-noter-algo-core-speakers-audio-correct`

**Input**: Validated person assignment, speaker, whole-call or one-segment scope, current transcript and dependent records.

**Output**: A logged correction batch and persisted archive constraints.

**Steps**:
1. [ ] - `p1` - Load the selected speaker's segments and existing corrections on the writer - `inst-correct-load`
2. [ ] - `p1` - **IF** scope is one segment, split its assignment from the original cluster without renaming other segments - `inst-correct-split`
3. [ ] - `p1` - Store the user's mapping and must-link or cannot-link constraints in `speaker_constraints`, tied to channel and time spans so archive segment ids may change - `inst-correct-constraints`
4. [ ] - `p1` - DB: UPDATE affected speaker mappings and segment references, call participants and derived owner attribution; refresh per-participant and generated name references without replacing user-written prose - `inst-correct-propagate`
5. [ ] - `p1` - Keep the user's name ahead of calendar or voice suggestions; never enroll or update a voice profile implicitly - `inst-correct-no-enroll`
6. [ ] - `p1` - Log the complete batch for reversal; refresh `transcript.jsonl` after commit and flag wording that can improve through explicit regeneration - `inst-correct-log`
7. [ ] - `p1` - **RETURN** updated speaker views and the change handle - `inst-correct-return`

## 4. States (CDSL)

### Audio availability

- [ ] `p1` - **ID**: `cpt-noter-state-core-speakers-audio-availability`

**States**: kept, not_stored, deleted

**Initial State**: kept if capture stores audio, otherwise not_stored

**Transitions**:
1. [ ] - `p1` - **FROM** kept **TO** deleted **WHEN** explicit deletion or age deletion removes stored audio and its log entry commits - `inst-st-delete`
2. [ ] - `p1` - **FROM** deleted **TO** deleted **WHEN** deletion is repeated; no bytes are counted twice - `inst-st-repeat`
3. [ ] - `p1` - **FROM** not_stored **TO** not_stored **WHEN** deletion is requested for a call that never wrote audio - `inst-st-not-stored`

No reversal restores deleted audio. Nightly retention uses the same deletion path from M5. Naming remains allowed in every state.

## 5. Definitions of Done

### Corrections and naming

- [ ] `p1` - **ID**: `cpt-noter-dod-core-speakers-audio-corrections`

The system **MUST** name speakers at call or line scope, accept batch naming with skips, create a person from `PersonRef` without the M3 person commands, and fix terms with optional glossary teaching. All affected records and correction constraints must be logged together, reflected in other windows and written to the per-call transcript after commit. A rename must not create a voice profile.

**Implements**:
- `cpt-noter-flow-core-speakers-audio-name`
- `cpt-noter-flow-core-speakers-audio-term`
- `cpt-noter-algo-core-speakers-audio-correct`

**Touches**:
- API: `transcript_rename_speaker`, `transcript_fix_term`, `transcript_name_speakers`, `entity:changed`
- DB: `segments`, `speakers`, `speaker_constraints`, `call_participants`, `people`, `glossary`, `changes`; dependent items and summaries
- Entities: `SpeakerMutation`, `FixTermResult`, `PersonRef`

### Delete audio for good

- [ ] `p1` - **ID**: `cpt-noter-dod-core-speakers-audio-deletion`

The system **MUST** delete stored audio explicitly or by age through a non-undoable operation, keep text and evidence, report actual freed bytes and refuse to delete active capture. Archive jobs and playback must not keep using removed files.

**Implements**:
- `cpt-noter-flow-core-speakers-audio-delete`
- `cpt-noter-state-core-speakers-audio-availability`

**Touches**:
- API: `audio_delete`, `audio_delete_older`
- DB: `calls`, `changes`
- Entities: `DeleteAudioResult`, audio files

### Tests and gate

- [ ] `p1` - **ID**: `cpt-noter-dod-core-speakers-audio-tests`

The system **MUST** pass unit tests for line scope, call scope, Unicode term ranges, constraint persistence, undo, partial filesystem failure and idempotent deletion; conformance for all five commands; and real-core E2E for both naming stories. `just gate` passes.

**Implements**:
- `cpt-noter-flow-core-speakers-audio-name`
- `cpt-noter-flow-core-speakers-audio-term`
- `cpt-noter-flow-core-speakers-audio-delete`

**Touches**:
- API: the five frozen commands above

## 6. Acceptance Criteria

- [ ] Real-core E2E `cpt-noter-seq-call-screen-name-speaker`: name Speaker 3 as an existing or new person; all intended lines update and undo restores them.
- [ ] Real-core E2E `cpt-noter-seq-call-page-name-speakers`: sample replay, skip and text-only naming work; dependent owners and names update while edited wording is kept.
- [ ] A one-line rename changes one line; the archive pass respects its cannot-link constraint and whole-call must-link constraints.
- [ ] Term fixes preserve originals and update normalized search text; glossary teaching affects future decoding without silently rewriting earlier calls.
- [ ] Both deletion commands succeed in real-core E2E; replay after deletion returns `audio_deleted`, text evidence still opens and undo returns `not_undoable`.
- [ ] Unit and conformance tests cover missing ids, cross-call input, invalid ranges and failed file removal without false freed-byte counts.
- [ ] `just gate` passes.
