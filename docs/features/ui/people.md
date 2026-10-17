---
title: "Feature — People and Person pages"
description: "Prepare a 1:1, name speakers, edit or merge people and explicitly opt in to local voice profiles."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-people
milestone: M3
---

# Feature: People and Person pages

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Prepare a 1:1](#prepare-a-11)
  - [Add a person and name a speaker](#add-a-person-and-name-a-speaker)
  - [Edit, merge or delete a person](#edit-merge-or-delete-a-person)
  - [Opt in to a voice profile](#opt-in-to-a-voice-profile)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Present identity and privacy safely](#present-identity-and-privacy-safely)
- [4. States (CDSL)](#4-states-cdsl)
  - [People and identity operations](#people-and-identity-operations)
- [5. Definitions of Done](#5-definitions-of-done)
  - [People and preparation views](#people-and-preparation-views)
  - [Identity edits and voice consent](#identity-edits-and-voice-consent)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p4` - **ID**: `cpt-noter-featstatus-ui-people`

## 1. Feature Context

- [ ] `p4` - `cpt-noter-feature-ui-people`

### 1.1 Overview

People finds a person by name or alias and opens their commitments, what they asked of you, recurring topics and calls. The same surface turns unnamed speakers into people and offers deliberate voice-profile creation, editing, merging and deletion.

### 1.2 Purpose

Implement PL-R1 to PL-R3, PE-R1 to PE-R6, Calls and History views, and the New person, Edit details, Merge and voice-profile surfaces.

**Requirements**: PRD › Feature specification › 5, Person pages; Diarization and speaker identity. The PRD has no requirement IDs.

**Principles**: follows the speakers, items and Library dependencies, including evidence and reversible user changes.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Prepares a 1:1, corrects identity and opts in to recognition |
| Noter core (system) | Queries Person pages, stores changes and applies opted-in profiles |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 5; Search and cross-meeting memory › People
- **Design**: [DESIGN.md](../../DESIGN.md) › Screen — People and Person page; Dialogs — Create a voice profile
- **Design elements**: `cpt-noter-component-screen-people`; reuses `cpt-noter-component-ui-person-picker`, `cpt-noter-component-ui-person-chip`, `cpt-noter-component-ui-speaker-label`, action rows, history and dialogs
- **Stories (M3)**: `cpt-noter-seq-people-prepare-one-on-one`, `cpt-noter-seq-people-name-unnamed-speaker`, `cpt-noter-seq-dialogs-set-up-voice-profile`
- **Frozen commands delivered (M3)**: `people_list`, `person_get`, `person_create`, `person_update`, `people_merge`, `person_delete`, `voice_profile_create`, `voice_profile_delete`
- **Earlier commands reused**: `transcript_rename_speaker`, `transcript_name_speakers`, `transcript_span`, item commands through Items; `history_list`, `change_undo`, `change_redo` through History
- **Data**: core-owned `cpt-noter-dbtable-people`, `cpt-noter-dbtable-voice-profiles`; no UI tables
- **Events**: `entity:changed`, `settings:changed`; mutation responses refresh profile state
- **Prototype modules**: `src/js/40-d-5-people.js` (`people`, `person`, `ppl-*` overlays), `src/css/40-d.css` (`.pe-*`, shared `.lb-*`)
- **Contract and test reference**: `apps/desktop/src/core/bindings.ts` and `apps/desktop/src/core/fake/` (read-only); [HARNESS.md](../../HARNESS.md); [DECOMPOSITION.md](../../DECOMPOSITION.md)
- **Dependencies**: `cpt-noter-feature-ui-speakers`, `cpt-noter-feature-ui-items`, `cpt-noter-feature-ui-library-calls`

## 2. Actor Flows (CDSL)

### Prepare a 1:1

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-people-prepare`

**Actor**: Primary user

**Success Scenarios**:
- Open Anna, read Open commitments and Asked you, visit a topic and return, then open the last 1:1
- Space marks an item done with Undo; ⌘I opens the inspector; engineering Handoff uses the existing drawer

**Error Scenarios**:
- No people: **No people yet** with **Add Person**; no match: **No people match “…”** with **Clear Search**
- No calls: the person's first-call message; empty blocks retain their specific messages; no History reads **No changes yet**
- Failed read keeps route and query, offers Try Again; deleted person returns to People

**Steps**:
1. [ ] - `p1` - User opens People; API: `people_list`; UI shows Name, Role · org, Their open items, You owe, Last call and Voice profile where data exists - `inst-list`
2. [ ] - `p1` - User searches a name or alias; UI uses the identity matching rules in `cpt-noter-algo-ui-people-identity` and ignores superseded reads - `inst-search`
3. [ ] - `p1` - User selects a row; Return, double-click or its name opens Overview; API: `person_get` with person id - `inst-get`
4. [ ] - `p1` - UI: skeletons after 300 ms, then returned commitments, Asked you, topics, identity and five most recent calls - `inst-overview`
5. [ ] - `p1` - User chooses a topic or call; UI pushes its route; Back restores Person view and scroll - `inst-navigate`
6. [ ] - `p1` - User switches to Calls or chooses Show All; UI reuses Call rows for this person's returned calls - `inst-calls`
7. [ ] - `p1` - User switches to History; API: `history_list` for this person; shared history renders actor filters, job filter, diffs, Undo and Redo - `inst-history`
8. [ ] - `p1` - User acts on an item; UI delegates tick, review, evidence, inspector and Handoff to Items without inventing a second item state - `inst-items`
9. [ ] - `p1` - **RETURN** the selected Person view; behaviour metrics rows exist only when explicitly enabled - `inst-return-prepare`

### Add a person and name a speaker

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-people-name`

**Actor**: Primary user

**Success Scenarios**:
- Add Anna before the first call; name an unnamed speaker as an existing person or create Lena and name them
- Wrong choice can be undone immediately or from History

**Error Scenarios**:
- Blank name disables Create; duplicate name offers the existing person; typed core validation remains under the field
- Cross-call naming as one change is a contract gap; the UI cannot claim a batch succeeded from several separate calls

**Steps**:
1. [ ] - `p1` - User clicks Add Person; UI shows New person with Name, Email, Role and Create - `inst-new-form`
2. [ ] - `p1` - User enters a name; UI offers **Use Lena K.** and **Create Anyway** for a possible duplicate, retaining the core's final validation authority - `inst-duplicate`
3. [ ] - `p1` - User chooses Create; API: `person_create`; on success show the returned person without a voice profile; errors keep the form - `inst-create`
4. [ ] - `p1` - User clicks Name on an unnamed row; UI shows Name Speaker 2, its sample and person picker with up to five matches - `inst-name-popover`
5. [ ] - `p1` - API: `transcript_span` for the row's sample when present; quote stays in its original language; absent samples show no fabricated speech - `inst-sample`
6. [ ] - `p1` - User types “Дима” and chooses Dmitri, or New Person “Lena”… followed by Create and Name - `inst-pick`
7. [ ] - `p1` - **IF** naming only the returned call's speaker - `inst-if-single`
   1. [ ] - `p1` - Reuse Speakers: `transcript_rename_speaker` with call id, speaker id and existing or new person; consume its change id and refresh People - `inst-name-single`
8. [ ] - `p1` - **IF** the design's recurring speaker spans several calls - `inst-if-batch`
   1. [ ] - `p1` - Keep the intended batch preview and flag the missing cross-call identity/atomic mutation contract; do not merge equal speaker numbers from different calls - `inst-batch-gap`
9. [ ] - `p1` - User chooses Undo on a successful change or in the Person History; shared history calls `change_undo` and refreshes names and unnamed rows - `inst-undo`
10. [ ] - `p1` - **RETURN** core-confirmed People rows; no profile is created by naming - `inst-return-name`

### Edit, merge or delete a person

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-people-edit-merge`

**Actor**: Primary user

**Success Scenarios**:
- Edit Pavel to Pavel R. with Keep Pavel as an alias; every refreshed label uses the new name
- Select exactly two entries, preview what moves and keep the chosen person with Undo

**Error Scenarios**:
- Merge disabled without a distinct target; stale edits preserve draft and show current values
- Delete is irreversible; Cancel is the default and leaves the person unchanged

**Steps**:
1. [ ] - `p1` - User chooses Edit Details from a row or Person menu; UI opens the 520-pt sheet with Name, Also known as, Email, Role, Organisation and Notes - `inst-edit-sheet`
2. [ ] - `p1` - On a changed name show **Keep “Pavel” as an alias**, initially on; Cancel discards the draft - `inst-alias`
3. [ ] - `p1` - User saves; API: `person_update` with id, current `rev` and patch including the desired aliases; success replaces the entity; `conflict` refreshes current data without resubmitting - `inst-update`
4. [ ] - `p1` - User chooses Merge With, or Merge 2 People with exactly two rows selected; prefill the second under Keep - `inst-merge-open`
5. [ ] - `p1` - UI: 540-pt sheet, target picker excluding the source, **What moves** with calls/labels, owned items, aliases and voice profile when present - `inst-preview`
6. [ ] - `p1` - User confirms; API: `people_merge` with source and target; open returned target and show **Merged Anna K. into Anna Kuznetsova · Undo** with its change id - `inst-merge`
7. [ ] - `p1` - **IF** a merge or save fails - `inst-if-error`
   1. [ ] - `p1` - Keep choices and show the typed error; not-found refreshes the source/target choices; do not locally remove a person - `inst-error`
8. [ ] - `p1` - User chooses Delete Person; native alert explains that names are removed from every call, speakers become unnamed and the profile is deleted, with Cancel default - `inst-delete-alert`
9. [ ] - `p1` - User explicitly confirms Delete; API: `person_delete`; success returns to People, failure keeps the person with an error - `inst-delete`
10. [ ] - `p1` - **RETURN** the kept person or People list after confirmed deletion - `inst-return-edit`

### Opt in to a voice profile

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-people-voice-profile`

**Actor**: Primary user

**Success Scenarios**:
- Off → Set Up Voice Profile → Create Profile → enabled for later calls
- Delete Profile removes recognition for new calls while existing names stay

**Error Scenarios**:
- Failed creation leaves Off and the sheet's error; failed deletion keeps the current profile
- Cancel creates or deletes nothing

**Steps**:
1. [ ] - `p1` - User clicks Set Up Voice Profile on Identity; UI opens the prototype's 480-pt Person voice sheet, explains local recognition and shows only known source counts - `inst-open-profile`
2. [ ] - `p1` - User chooses Create Profile; API: `voice_profile_create` with person id and optional named seed speaker; disable duplicate submission - `inst-create-profile`
3. [ ] - `p1` - UI: use `VoiceProfileView.enabled`, centroids and opt-in time for the result; refresh the person and show the success, never a simulated timeout - `inst-profile-result`
4. [ ] - `p1` - User chooses Delete Profile; native alert reads **Noter stops recognising this voice in new calls. Names already given in past calls stay.** with Cancel default - `inst-delete-profile-alert`
5. [ ] - `p1` - User confirms; API: `voice_profile_delete`; success shows Off and Set Up Voice Profile again - `inst-delete-profile`
6. [ ] - `p1` - **RETURN** Identity with the core's profile status; no audio or profile leaves the Mac - `inst-return-profile`

## 3. Processes / Business Logic (CDSL)

### Present identity and privacy safely

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-people-identity`

**Input**: returned people, unnamed rows, query, Person page and privacy settings

**Output**: matching identities, stable selection and permitted Identity rows

**Steps**:
1. [ ] - `p1` - Match display name, short name and aliases ignoring case and folding ё/е and ß/ss; preserve original spelling in labels - `inst-match`
2. [ ] - `p1` - Sort visible names with interface-language collation; use core initials in the name's script and exclude You from merge targets - `inst-sort`
3. [ ] - `p1` - Key unnamed rows by call and speaker id, not display number; never infer a shared voice from the number Speaker 2 - `inst-unnamed`
4. [ ] - `p1` - Omit the unnamed group when empty; distinguish no people from no query match; use the returned commitment and asked-you collections without recomputing ownership - `inst-empty`
5. [ ] - `p1` - **IF** behaviour metrics are off or the core sends no permitted value: omit the talk-time row entirely - `inst-metrics`
6. [ ] - `p1` - Render the Identity fields actually returned; do not fabricate language percentages, call cadence or profile match counts from fixture facts - `inst-fields`
7. [ ] - `p1` - **RETURN** text and rows; clear stale selections after entity removal and refresh active Person data - `inst-return`

## 4. States (CDSL)

### People and identity operations

- [ ] `p1` - **ID**: `cpt-noter-state-ui-people-view`

**States**: LOADING, EMPTY, NO_MATCH, LISTED, OVERVIEW, NO_CALLS, CALLS, HISTORY, NO_HISTORY, EDITING, MERGING, PROFILE_OFF, PROFILE_CREATING, PROFILE_ON, ERROR

**Initial State**: LOADING

**Transitions**:
1. [ ] - `p1` - **FROM** LOADING **TO** EMPTY **WHEN** no people exist; NO_MATCH when only the query excludes them; otherwise LISTED - `inst-list-result`
2. [ ] - `p1` - **FROM** LISTED **TO** OVERVIEW **WHEN** person_get succeeds; no shared calls uses NO_CALLS - `inst-person`
3. [ ] - `p1` - **FROM** OVERVIEW **TO** CALLS **WHEN** Calls or Show All is selected - `inst-calls`
4. [ ] - `p1` - **FROM** OVERVIEW **TO** HISTORY **WHEN** History is selected; no entries uses NO_HISTORY - `inst-history`
5. [ ] - `p1` - **FROM** OVERVIEW **TO** EDITING **WHEN** Edit Details is chosen; success or Cancel returns to OVERVIEW - `inst-edit`
6. [ ] - `p1` - **FROM** LISTED **TO** MERGING **WHEN** two selected people are merged; success opens the target OVERVIEW, Cancel restores the selection - `inst-merge`
7. [ ] - `p1` - **FROM** PROFILE_OFF **TO** PROFILE_CREATING **WHEN** Create Profile is confirmed - `inst-profile-create`
8. [ ] - `p1` - **FROM** PROFILE_CREATING **TO** PROFILE_ON **WHEN** the core confirms enabled; failure returns to PROFILE_OFF with the error - `inst-profile-on`
9. [ ] - `p1` - **FROM** PROFILE_ON **TO** PROFILE_OFF **WHEN** Delete Profile succeeds after confirmation - `inst-profile-off`
10. [ ] - `p1` - **FROM** LOADING **TO** ERROR **WHEN** a read fails; explicit Try Again returns to LOADING - `inst-error`

## 5. Definitions of Done

### People and preparation views

- [ ] `p4` - **ID**: `cpt-noter-dod-ui-people-pages`

The system **MUST** provide searchable People, Overview, Calls and person-scoped History, core-owned item actions, evidence, Back restoration and the distinct empty states, with metrics absent until enabled.

**Implements**:
- `cpt-noter-flow-ui-people-prepare`
- `cpt-noter-algo-ui-people-identity`
- `cpt-noter-state-ui-people-view`

**Constraints**: `cpt-noter-constraint-behaviour-metrics-off`, `cpt-noter-constraint-three-languages`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `people_list`, `person_get`; shared items and history
- Tests: unit tests for alias folding, locale collation, stale reads and absent metrics; conformance for Person queries; E2E `cpt-noter-seq-people-prepare-one-on-one` happy and empty paths

### Identity edits and voice consent

- [ ] `p4` - **ID**: `cpt-noter-dod-ui-people-identity`

The system **MUST** support create, edit, previewed merge, confirmed deletion and explicit profile consent from core results, offer returned changes to History, and never turn a name assignment into consent. Cross-call atomic naming remains blocked by the contract gap below. `just gate` passes.

**Implements**:
- `cpt-noter-flow-ui-people-name`
- `cpt-noter-flow-ui-people-edit-merge`
- `cpt-noter-flow-ui-people-voice-profile`

**Constraints**: `cpt-noter-constraint-behaviour-metrics-off`, `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `person_create`, `person_update`, `people_merge`, `person_delete`, `voice_profile_create`, `voice_profile_delete`; shared naming and Undo
- Tests: unit tests for duplicate/blank names, alias preservation and merge guards; conformance for revision conflict, deletion and profile opt-in; E2E `cpt-noter-seq-people-name-unnamed-speaker`, `cpt-noter-seq-dialogs-set-up-voice-profile`, with unsupported paths explicitly reported

**Completion gate**: `just gate` passes.

## 6. Acceptance Criteria

- [ ] People prototype states `default`, `empty`, `no-match`, `named`, `new-person` and Person states `default`, `voice-off`, `no-calls`, `no-history`, `merged`, `edit` match screenshots, including all overlays
- [ ] Tab order follows DESIGN; row arrows and Return work; merge is enabled only for two selected people or one distinct chosen target
- [ ] Identity never exposes behaviour metrics while off, including after cached reads or setting changes
- [ ] Wide uses the prototype's two columns, collapsed at its 1250-px rule; German labels wrap and action labels never truncate
- [ ] Mutations use core responses and change ids; no local array mutation substitutes for persistence or Undo

## 7. Additional Context

**Prototype reuse.** Rewrite `screen('people')` as PeoplePage and UnnamedSpeakers; `screen('person')` as PersonPage with Overview, Calls and History. Port `ppl-new`, `ppl-name-speaker`, `ppl-edit`, `ppl-merge` and `ppl-voice` as React overlays using existing picker, dialog and history components. Port `.pe-*` and reused `.lb-*` from `40-d.css` as-is, retaining component, primitive, variant, size, state and region attributes. Sample `peopleFacts`, local named/removed maps and demo timers are source of truth only.

**DESIGN versus prototype.** DESIGN's no-match example says Lena; the prototype seeds Lenara because Lena exists. Use the actual query in the message. DESIGN orders narrow Overview blocks R2, R3, R5, R4, R6; prototype collapses its existing columns as R2, R3, R4, R5, R6. Follow prototype order. The Person action checks for an unregistered `voice-profile` overlay, so reaches `ppl-voice`: **Create a voice profile for Anna K.?**, local-recognition text and **Built from 6 named calls · about 40 minutes of speech**. The separate Dialogs gallery uses `dlg-voice`, **Set Up Voice Profile** and 31 calls; preserve each entry's prototype layout but derive counts from real data. Delete-profile story wording differs from the screen/prototype; use **in new calls. Names already given in past calls stay.**

**Contract and fake gaps.** `UnnamedSpeaker` is per call with no recurring-voice group, call count or atomic cross-call naming command. `transcript_name_speakers` is also per call; several calls cannot become one batch by UI convention. `person_create` has no duplicate override and the fake rejects exact duplicates, so Create Anyway cannot guarantee success. `PersonPage` lacks language histograms, cadence and profile matching counts; `PersonRow` lacks Notes for prefilling although `PersonPatch` accepts notes. Do not invent missing facts or clear unseen notes. The fake ignores notes and does not fully propagate merges, deletes or profile changes to transcripts; typed fixtures and conformance must expose those limits. M3 can bind the M2 picker/naming commands, but the full recurring-speaker story remains a contract follow-up.

**Not applicable.** Speaker clustering, recognition, profile encryption, persistent transactions, schema changes, deployment and external authentication are core responsibilities. UI reads are bounded page queries, no query per row; error logs contain ids/codes only, not samples or identity notes.
