---
title: "Feature: People, identity and voice profiles"
description: "Person pages, aliases, identity merges, unnamed speakers and opt-in encrypted voice profiles."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M3
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: People, identity and voice profiles

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Read people and prepare a call](#read-people-and-prepare-a-call)
  - [Create or edit a person and name a speaker](#create-or-edit-a-person-and-name-a-speaker)
  - [Merge or delete an identity](#merge-or-delete-an-identity)
  - [Opt into or delete a voice profile](#opt-into-or-delete-a-voice-profile)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Assemble pages and the unnamed queue](#assemble-pages-and-the-unnamed-queue)
  - [Merge all identity references](#merge-all-identity-references)
  - [Build and match local profiles](#build-and-match-local-profiles)
- [4. States (CDSL)](#4-states-cdsl)
  - [Voice profile lifecycle](#voice-profile-lifecycle)
- [5. Definitions of Done](#5-definitions-of-done)
  - [People and complete Person pages](#people-and-complete-person-pages)
  - [Merge and delete in one action](#merge-and-delete-in-one-action)
  - [Local opt-in profiles](#local-opt-in-profiles)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p4` - **ID**: `cpt-noter-featstatus-core-people`

- [ ] `p4` - `cpt-noter-feature-core-people`

## 1. Feature Context

### 1.1 Overview

The people service builds Person pages from calls and items, keeps aliases and speaker links, and merges identities as undoable batches. Voice profiles require an explicit opt-in for each person, stay encrypted on this Mac and can be deleted without removing existing names. Behaviour metrics are computed only from enablement onward, never back-computed (D5).

### 1.2 Purpose

Before a 1:1 the user can read the person's commitments, what they asked of the user and their shared topics. Unnamed voices can become people without silently creating a biometric profile.

**Requirements**: PRD › Diarization and speaker identity; PRD › Search and cross-meeting memory › People; PRD › Security, privacy and permissions › Deletion.

**Principles**: None assigned by the decomposition.

**Delivers**:
- Frozen commands (M3): `people_list`, `person_get`, `person_create`, `person_update`, `people_merge`, `person_delete`, `voice_profile_create`, `voice_profile_delete`.
- Event: `entity:changed`.
- DESIGN.md stories (M3): `cpt-noter-seq-people-prepare-one-on-one`, `cpt-noter-seq-people-name-unnamed-speaker`, `cpt-noter-seq-dialogs-set-up-voice-profile`.

Naming itself uses the M2 transcript commands; replay and History use existing services. Agent editing and behaviour-metric back-computation are outside this feature.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Creates people, corrects names, merges entries, opts into or deletes profiles |
| Main window | Reads Person pages and manages identities |
| Call screen | Searches people and creates a person for a speaker |
| Transcript service and offline engine | Supply speaker clusters and local voice embeddings |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-people`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-people`, `cpt-noter-constraint-core-local-data`, `cpt-noter-dbtable-people`, `cpt-noter-dbtable-call-participants`, `cpt-noter-dbtable-voice-profiles`; 4.2 D5
- **PRD**: [PRD.md](../../PRD.md) › Diarization and speaker identity
- **Contract**: `crates/noter-protocol/src/model/people.rs`, `model/transcript.rs`, `contracts/ipc.manifest.json`
- **Dependencies**: `cpt-noter-feature-core-speakers-audio`, `cpt-noter-feature-core-engine-offline`

`PeopleList.unnamed` carries per-call speaker rows, not a stable cross-call cluster id or count. The story's grouped naming requires the M2 naming operation and its must-link evidence; this spec does not invent an identity from a similar display label. `PersonPatch.notes` exists but `PersonPage` does not return notes for editing; this is an upstream read-model gap.

## 2. Actor Flows (CDSL)

### Read people and prepare a call

- [ ] `p4` - **ID**: `cpt-noter-flow-core-people-read`

**Actor**: Primary user (main › People, or the call-screen person picker)

**Success Scenarios**:
- Name or alias search finds a person; their page lists calls, commitments, things owed to them, open questions and topics.
- No people or no calls returns empty collections, not a model-generated biography.

**Error Scenarios**:
- Unknown person: `not_found`; read failure: typed error suitable for retry.

**Steps**:
1. [ ] - `p1` - API: `people_list { query }` from main or call-screen; normalize names and aliases for lookup without changing their display text - `inst-read-list`
2. [ ] - `p1` - Read people and the unnamed queue with `cpt-noter-algo-core-people-page`; return `PeopleList` - `inst-read-people`
3. [ ] - `p1` - API: `person_get { person_id }` from main; assemble `PersonPage` from read-only queries - `inst-read-page`
4. [ ] - `p1` - **RETURN** the complete page, with nullable `talk_share`; selected items, calls and topics open through existing navigation and evidence commands - `inst-read-return`

### Create or edit a person and name a speaker

- [ ] `p4` - **ID**: `cpt-noter-flow-core-people-edit`

**Actor**: Primary user (New Person, Edit Details or Name Speaker)

**Success Scenarios**:
- Create and Name creates a person and uses the M2 naming flow; no profile is created.
- Rename keeps the old name as an alias when the user chose it; all resolved chips show the new name.

**Error Scenarios**:
- Empty name or invalid reference: `invalid_input`; stale edit: `conflict` with `detail.current_rev`.

**Steps**:
1. [ ] - `p1` - API: `person_create { display_name, email, role, org }` from main or call-screen; validate a non-empty name - `inst-edit-create`
2. [ ] - `p1` - DB: create a `per_` id with initial revision, derived short name and no voice opt-in, together with a change row; **RETURN** `PersonMutation` - `inst-edit-insert`
3. [ ] - `p1` - **IF** the user chose Create and Name, pass the new person id to the existing transcript naming flow and retain its own returned change id for naming Undo - `inst-edit-name`
4. [ ] - `p1` - API: `person_update { person_id, rev, patch }` from main; validate names and normalize and deduplicate aliases - `inst-edit-update`
5. [ ] - `p1` - DB: guard revision and apply only present patch fields with their before/after change row; retaining the old name uses the supplied aliases list - `inst-edit-commit`
6. [ ] - `p1` - Emit `entity:changed` for affected read models after commit; **RETURN** `PersonMutation` with new revision and `change_id` - `inst-edit-return`

### Merge or delete an identity

- [ ] `p4` - **ID**: `cpt-noter-flow-core-people-merge-delete`

**Actor**: Primary user (main › People)

**Success Scenarios**:
- Merge keeps the chosen target and moves calls, speaker links, item owners, aliases and the opted-in profile in one undoable batch.
- Delete unnames the person's speakers everywhere and removes profiles and participation, while transcript words remain.

**Error Scenarios**:
- Self-merge or an operation that would break the single You identity: `invalid_input`; missing identity: `not_found`; transaction failure rolls back all links.

**Steps**:
1. [ ] - `p1` - API: `people_merge { source, target }` after the user reviews what moves; validate distinct existing ids - `inst-identity-merge`
2. [ ] - `p1` - Run `cpt-noter-algo-core-people-merge`; **RETURN** the target `PersonMutation` with the batch's `change_id` - `inst-identity-merged`
3. [ ] - `p1` - API: `person_delete { person_id }` after the destructive alert; validate the identity invariant - `inst-identity-delete`
4. [ ] - `p1` - DB: in one writer transaction remove voice profiles, aliases and participation, unlink speaker/person and item ownership references, then delete the person; write a non-undoable change without biometric or deleted personal content - `inst-identity-remove`
5. [ ] - `p1` - Invalidate cached identity and matching data so in-flight matches cannot restore the deleted person; emit removed and changed entity ids after commit - `inst-identity-publish`
6. [ ] - `p1` - **RETURN** `DeleteResult`; transcript text and existing calls remain under unnamed speaker labels - `inst-identity-return`

### Opt into or delete a voice profile

- [ ] `p4` - **ID**: `cpt-noter-flow-core-people-profile`

**Actor**: Primary user (main › Person page)

**Success Scenarios**:
- Create Profile deliberately seeds from already named lines; later calls can match the profile.
- Delete Profile stops future recognition and preserves labels already set.

**Error Scenarios**:
- Person or seed speaker missing: `not_found`; seed belongs to someone else or has no usable voice samples: `invalid_input`; Keychain unavailable: no plaintext fallback.

**Steps**:
1. [ ] - `p1` - API: `voice_profile_create { person_id, from_speaker }` only after the profile explanation and Create Profile action - `inst-profile-request`
2. [ ] - `p1` - Validate the person and optional seed; when no seed is given, select usable speaker embeddings from lines already named as this person - `inst-profile-samples`
3. [ ] - `p1` - Run `cpt-noter-algo-core-people-profile-match`; store opt-in date and encrypted profile centroids through the change-log writer - `inst-profile-create`
4. [ ] - `p1` - **RETURN** `VoiceProfileView` containing enabled state and centroid count, never embeddings; emit `entity:changed` after commit - `inst-profile-created`
5. [ ] - `p1` - API: `voice_profile_delete { person_id }` after the delete alert; atomically clear opt-in and remove every centroid, with a non-undoable change that contains no biometric blobs - `inst-profile-delete`
6. [ ] - `p1` - Invalidate matching caches and pending writes for the profile; **RETURN** disabled `VoiceProfileView` and emit the person change without renaming any speaker - `inst-profile-deleted`

## 3. Processes / Business Logic (CDSL)

### Assemble pages and the unnamed queue

- [ ] `p4` - **ID**: `cpt-noter-algo-core-people-page`

**Input**: Optional normalized name query or person id, read-pool connection, behaviour-metrics enablement time.

**Output**: `PeopleList` or `PersonPage` complete for its view.

**Steps**:
1. [ ] - `p1` - DB: SELECT people and matching `person_aliases`, with last call and open-item counts in grouped queries - `inst-page-people`
2. [ ] - `p1` - DB: SELECT unnamed speakers with their call, segment count, playable sample when audio remains and identity suggestion; group only by established speaker links, not label text - `inst-page-unnamed`
3. [ ] - `p1` - For a Person page, join participation and named speakers to calls, item ownership and requests to open commitments, things the user owes and open questions, and shared-call item links to topics - `inst-page-joins`
4. [ ] - `p1` - Keep empty collections for a person without calls; derive chip names from the current person row so renames need no transcript-text rewrite - `inst-page-empty`
5. [ ] - `p1` - **IF** behaviour metrics are enabled, compute talk share only from `call_participants.talk_time_ms` recorded since enablement; otherwise return no talk share - `inst-page-metrics`
6. [ ] - `p1` - **RETURN** complete read models without per-row follow-up queries or biometric data - `inst-page-return`

### Merge all identity references

- [ ] `p4` - **ID**: `cpt-noter-algo-core-people-merge`

**Input**: Existing distinct source and target people; current relationships.

**Output**: Target with new revision and one undoable change batch.

**Steps**:
1. [ ] - `p1` - Begin a writer transaction and read both people and all affected references; preserve exactly one `is_you` row - `inst-merge-read`
2. [ ] - `p1` - Move source speaker links, deduplicated participation, item ownership and scoped person references to target; preserve target identity and details - `inst-merge-links`
3. [ ] - `p1` - Add source display name and aliases to target aliases, deduplicated by normalized text - `inst-merge-aliases`
4. [ ] - `p1` - Transfer opted-in encrypted profile centroids without exporting or decrypting them into the change log; preserve the recorded opt-in and profile metadata needed by Undo - `inst-merge-profile`
5. [ ] - `p1` - Remove source and increment target revision; store reversible relational before/after deltas under one batch id, using the history service's revision guards - `inst-merge-batch`
6. [ ] - `p1` - **TRY** commit; **CATCH** any failure, roll back the whole batch and **RETURN** `internal` - `inst-merge-commit`
7. [ ] - `p1` - Publish affected people, calls and items after commit; **RETURN** the target and change id - `inst-merge-return`

### Build and match local profiles

- [ ] `p4` - **ID**: `cpt-noter-algo-core-people-profile-match`

**Input**: Named speaker embeddings or a later call's speaker centroid, opted-in profile rows, injected clock and Keychain encryption key.

**Output**: Encrypted centroids or a local identity suggestion; no exported biometric data.

**Steps**:
1. [ ] - `p1` - Read current person opt-in; **IF** it is absent during matching, exclude that person's profile - `inst-match-optin`
2. [ ] - `p1` - For creation, cluster usable 256-dimensional voice samples into several centroids per person, retaining device hint and sample count - `inst-match-build`
3. [ ] - `p1` - Encrypt every stored centroid with the Keychain-held key; never place plaintext centroids in logs, exports, MCP or cloud context - `inst-match-encrypt`
4. [ ] - `p1` - During matching, decrypt only locally; assign only above 0.75 cosine with a margin over the runner-up, narrow candidates to attendees when known, and exclude profiles decayed after 90 days unused - `inst-match-score`
5. [ ] - `p1` - Keep ambiguous matches as unnamed with a suggestion; update `last_used_at` only for a profile actually used, through the writer - `inst-match-used`
6. [ ] - `p1` - Recheck opt-in and person existence before committing any match or updated profile; deletion wins over pending inference - `inst-match-recheck`
7. [ ] - `p1` - **RETURN** the encrypted profile view or local match; release decrypted buffers after use - `inst-match-return`

## 4. States (CDSL)

### Voice profile lifecycle

- [ ] `p4` - **ID**: `cpt-noter-state-core-people-profile`

**States**: absent, building, enabled, decayed

**Initial State**: absent

**Transitions**:
1. [ ] - `p1` - **FROM** absent **TO** building **WHEN** Create Profile explicitly opts the person in - `inst-state-build`
2. [ ] - `p1` - **FROM** building **TO** enabled **WHEN** encrypted centroids and opt-in commit - `inst-state-enabled`
3. [ ] - `p1` - **FROM** building **TO** absent **WHEN** creation fails; no partial profile is enabled - `inst-state-failed`
4. [ ] - `p1` - **FROM** enabled **TO** decayed **WHEN** the profile has been unused for 90 days and no longer contributes to matching - `inst-state-decayed`
5. [ ] - `p1` - **FROM** decayed **TO** enabled **WHEN** an opted-in profile is refreshed from named samples - `inst-state-refreshed`
6. [ ] - `p1` - **FROM** enabled **TO** absent **WHEN** profile or person deletion commits; also from building or decayed; existing speaker names remain on profile-only deletion - `inst-state-deleted`

## 5. Definitions of Done

### People and complete Person pages

- [ ] `p4` - **ID**: `cpt-noter-dod-core-people-pages`

The system **MUST** implement list, create, revision-guarded edits, normalized aliases and query-built Person pages. The unnamed queue uses real speaker relationships and the existing naming service; creating or naming a person never creates a profile. Metrics remain absent when disabled and never backfill earlier calls.

**Implements**:
- `cpt-noter-flow-core-people-read`
- `cpt-noter-flow-core-people-edit`
- `cpt-noter-algo-core-people-page`

**Touches**:
- API: `people_list`, `person_get`, `person_create`, `person_update`, `entity:changed`
- DB: `people`, `person_aliases`, `call_participants`, `speakers`, `items`, `changes`
- Entities: `PersonRow`, `PersonPage`, `UnnamedSpeaker`

### Merge and delete in one action

- [ ] `p4` - **ID**: `cpt-noter-dod-core-people-identity`

The system **MUST** merge every source reference as one undoable batch, retain aliases and profile opt-in, and preserve the unique You identity. Person deletion removes profiles and participation and unnames speakers everywhere without deleting their words. Neither deletion nor a stale in-flight match can recreate biometric data.

**Implements**:
- `cpt-noter-flow-core-people-merge-delete`
- `cpt-noter-algo-core-people-merge`

**Touches**:
- API: `people_merge`, `person_delete`, `entity:changed`
- DB: people and referring rows, `changes`
- Entities: `PersonMutation`, `DeleteResult`

### Local opt-in profiles

- [ ] `p4` - **ID**: `cpt-noter-dod-core-people-profiles`

The system **MUST** create profiles only on explicit opt-in, encrypt their several centroids with a Keychain-held key, decay unused profiles after 90 days, and delete all of a person's profile data in one action. Profile-only deletion keeps names. Neither profiles nor plaintext centroid blobs enter an export, model packet, tool result or change-log payload.

**Implements**:
- `cpt-noter-flow-core-people-profile`
- `cpt-noter-algo-core-people-profile-match`
- `cpt-noter-state-core-people-profile`

**Constraints**: `cpt-noter-constraint-core-local-data`

**Touches**:
- API: `voice_profile_create`, `voice_profile_delete`
- DB: `people`, `voice_profiles`, `changes`
- Entities: `VoiceProfileView`

## 6. Acceptance Criteria

- [ ] E2E against the real core, `cpt-noter-seq-people-prepare-one-on-one`: a Person page shows commitments, what is owed, shared topics and calls; a new person has empty sections.
- [ ] E2E against the real core, `cpt-noter-seq-people-name-unnamed-speaker`: alias search for Дима finds Dmitri's identity, the existing naming command updates established linked speakers with Undo, and Create and Name creates no profile.
- [ ] E2E against the real core, `cpt-noter-seq-dialogs-set-up-voice-profile`: Create produces an encrypted profile; Delete Profile stops matching and keeps names.
- [ ] Merge with overlapping calls deduplicates participation and moves item owners, aliases and opted-in profiles; Undo restores the original links and revisions; forced transaction failure moves nothing.
- [ ] Person deletion leaves transcript words unnamed and removes every profile and participation link; pending matching cannot restore them.
- [ ] An injected clock proves 90-day decay; locked Keychain never results in plaintext storage; no export or tool result contains a profile blob.
- [ ] Stale `person_update` returns `conflict`; disabled talk share stays absent and enablement never computes older calls.
- [ ] Each of the eight commands succeeds at least once in real-core E2E runs; `just gate-fast` and `just gate` pass.
