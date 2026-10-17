---
title: "Feature — Speaker naming and transcript corrections"
description: "Name speakers during or after a call and correct transcript terms without losing focus or evidence."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-speakers
milestone: M2
---

# Feature: Speaker naming and transcript corrections

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Name a speaker during the call](#name-a-speaker-during-the-call)
  - [Name speakers after the call](#name-speakers-after-the-call)
  - [Correct a transcript term](#correct-a-transcript-term)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Person picker matching and validation](#person-picker-matching-and-validation)
- [4. States (CDSL)](#4-states-cdsl)
  - [Naming row and panel](#naming-row-and-panel)
  - [Correction popover](#correction-popover)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Shared identity and post-call naming](#shared-identity-and-post-call-naming)
  - [Correct terms with glossary intent](#correct-terms-with-glossary-intent)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p3` - **ID**: `cpt-noter-featstatus-ui-speakers`

## 1. Feature Context

- [ ] `p3` - `cpt-noter-feature-ui-speakers`

### 1.1 Overview

A shared person picker names a provisional speaker from a transcript label or the post-call naming panel. The core applies the identity to labels, owners and prose; optional regeneration improves wording. A separate Fix term popover corrects a selected term and can add it to the glossary. People pages and voice-profile creation ship in M3.

### 1.2 Purpose

It implements `cpt-noter-component-ui-speaker-naming-panel`, `cpt-noter-component-ui-term-fix-popover` and `cpt-noter-component-ui-person-picker`, including the speaker-label rename popover.

**Requirements**: PRD › Feature specification › 2. Live transcript and 4. Post-call outputs; Diarization and speaker identity. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-core-owns-state`, `cpt-noter-principle-never-steal-focus`, `cpt-noter-principle-accessible-multilingual`, `cpt-noter-principle-undo-over-confirm`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Names or skips speakers, chooses or creates a person, fixes a term |
| Noter core (system) | Resolves identities, logs changes, updates transcript and derived views |
| Call app (external system) | Keeps typing focus except while the user edits a Noter popover |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 2 and 4; Diarization and speaker identity
- **Design**: [DESIGN.md](../../DESIGN.md) › Call screen; Call page PC-R9; Speaker label; Speaker naming panel; Term fix popover; Person picker; D88, D89, D92, D93
- **Decomposition**: [DECOMPOSITION.md](../../DECOMPOSITION.md) › 2.19, M2, NOT_STARTED
- **Design elements**: `cpt-noter-component-ui-speaker-naming-panel`, `cpt-noter-component-ui-term-fix-popover`, `cpt-noter-component-ui-person-picker`
- **Stories**: `cpt-noter-seq-call-screen-name-speaker`, `cpt-noter-seq-call-page-name-speakers` (M2, every path)
- **Frozen commands it delivers (M2)**: `transcript_rename_speaker`, `transcript_fix_term`, `transcript_name_speakers`
- **Other commands it calls**: `audio_play`, `audio_stop`, `glossary_list`, `change_undo`; `people_list`, `person_create` are frozen but placed in M3, fake-backed in M2
- **Events**: `entity:changed` (speakers, item, outputs), transcript `segments_updated`; existing window focus handling
- **Contract**: `apps/desktop/src/core/bindings.ts` › RenameScope, PersonRef, SpeakerAssignment, SpeakerMutation, FixTermArgs, FixTermResult; `apps/desktop/src/core/fake/handlers.ts` and `fake-core.ts`
- **Prototype modules**: `src/js/20-b-components.js` › `C.personPicker`, `speaker-rename`, `person-picker`, `term-fix`; `src/js/30-c-0-components.js` › `C.speakerNamingPanel`; `src/css/20-b.css` (`.cw-pp*`), `src/css/30-c.css` (`.pc-name*`)
- **Dependencies**: `cpt-noter-feature-ui-live-transcript`, `cpt-noter-feature-ui-call-page-frame`; undo uses the delivered History service

## 2. Actor Flows (CDSL)

### Name a speaker during the call

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-speakers-live-name`

**Actor**: Primary user

**Success Scenarios**:
- Speaker 3 → **Rename Speaker 3** → Oleg M. → Rename: every line uses Oleg M.; status **Named Speaker 3 as Oleg M. · 12 lines**; Esc returns typing to Teams.

**Error Scenarios**:
- No match for Lena: **No one called “Lena”** → **New Person “Lena”…** → Name, Email, Role → **Create and Name**.
- Call app takes focus: the popover and draft stay; clicking a field or ⌃⌥⌘N resumes typing. Empty name or invalid email stays inline.

**Steps**:
1. [ ] - `p1` - User clicks the speaker label; open the 320-pt popover anchored to it, make the panel key for editing and focus **Name…** without moving the panel - `inst-open`
2. [ ] - `p1` - Show **In this call** then **Recent people**, role/source captions, Whole call selected and Only this line; the picker process filters suggestions - `inst-picker`
3. [ ] - `p1` - User chooses a person by click or arrows/Return; Rename remains disabled until selection is valid - `inst-select`
4. [ ] - `p1` - **IF** the user chooses New Person: replace the list with Name, Email, Role, Back and Create and Name; validate and check duplicates without opening a sheet - `inst-new`
5. [ ] - `p1` - User confirms; API: `transcript_rename_speaker` with call id, speaker id, existing or new PersonRef and whole_call or one_segment scope; never submit during composition - `inst-rename`
6. [ ] - `p1` - **IF** the command fails: keep the draft and focus, show the typed error with explicit retry; a missing speaker refreshes the transcript before another attempt - `inst-error`
7. [ ] - `p1` - **ELSE** apply the returned speakers and core events to every affected line and header; announce the actual affected count when supplied and retain change_id for Undo - `inst-result`
8. [ ] - `p1` - **RETURN** the named speaker; Esc closes the popover and returns typing to the call app; row edits never change earlier calls - `inst-return`

### Name speakers after the call

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-speakers-post-call`

**Actor**: Primary user

**Success Scenarios**:
- Play Sample → invitation suggestion → Name: **Named Speaker 2 as Oleg M. · 14 lines, 2 action items updated · Undo**; optional **Regenerate for better wording**.
- Hide leaves **3 speakers not named · Show**; a skipped speaker can return from **Skipped (1)**.

**Error Scenarios**:
- Audio no longer kept: no Play Sample; first line and count still allow naming.
- Naming fails: the row stays with its chosen person and retry. All skipped is not All speakers named.

**Steps**:
1. [ ] - `p1` - In Summary and Transcript show PC-R9 above the content with one row per unnamed speaker, first confirmed line, line count, Name field, suggestion chips, Name and Skip - `inst-panel`
2. [ ] - `p1` - **IF** audio is available: Play Sample requests a 5-s span through `audio_play`, shows Playing… until audio state ends and uses existing replay safety rules; a second sample stops the previous one - `inst-sample`
3. [ ] - `p1` - User chooses an invitation chip or picker result; mark the chip pressed, put the name in the field and enable Name - `inst-pick`
4. [ ] - `p1` - Name submits `transcript_name_speakers` with this row's assignment; Skip submits the assignment with person null and keeps the local skipped disclosure - `inst-name`
5. [ ] - `p1` - Core updates transcript labels, owners, Per participant and label substitutions in Summary while preserving edits; show **Names updated · Regenerate for better wording**, never regenerate automatically - `inst-update`
6. [ ] - `p1` - Show the result with Undo for 10 s; on the last named speaker show All speakers named, then remove the panel; skipped rows remain nameable - `inst-outcome`
7. [ ] - `p1` - **IF** Name… in Skipped is chosen: restore that row to the naming list; choosing Hide or Show changes presentation only - `inst-unskip`
8. [ ] - `p1` - **RETURN** the core identities with undo targets, or the unchanged row on failure - `inst-return`

### Correct a transcript term

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-speakers-fix-term`

**Actor**: Primary user

**Success Scenarios**:
- Fix term shows selected words, Correct term, glossary suggestions, Language and Add to glossary checked; applying leaves original wording in the corrected word's help tag.

**Error Scenarios**:
- Empty replacement disables Fix; stale selection after archive replacement must be resolved again, not applied to a different word.
- Esc cancels and returns focus; during capture the call app regains typing focus.

**Steps**:
1. [ ] - `p1` - User opens Fix Term… from the selected text's context menu or Edit menu; anchor the 280–360-pt popover to that selection - `inst-open`
2. [ ] - `p1` - Keep call id, segment id and the selected TextRange; populate Correct term and `glossary_list` suggestions; show **Older calls get a proposal in Activity** - `inst-range`
3. [ ] - `p1` - User types a replacement or picks a glossary variant and optionally clears Add to glossary; Return applies only outside composition - `inst-draft`
4. [ ] - `p1` - API: `transcript_fix_term` with retained ids/range, replacement and add_to_glossary; show the Fix spinner - `inst-call`
5. [ ] - `p1` - **IF** segment changed, range is stale or command fails: retain the replacement, refresh the segment and require reselection/explicit retry; never replace text by a stale offset - `inst-error`
6. [ ] - `p1` - **ELSE** apply returned segment/corrections, close the popover, show **Fixed “notification service” · added to the glossary** only when glossary_term_id is present and retain change_id - `inst-result`
7. [ ] - `p1` - **RETURN** corrected text; older-call changes remain proposals, and Undo is available through History - `inst-return`

## 3. Processes / Business Logic (CDSL)

### Person picker matching and validation

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-speakers-picker`

**Input**: Query, core-ordered invitees/recent people, host scope, selected person and optional new-person draft

**Output**: Grouped matches, selected PersonRef or inline validation error

**Steps**:
1. [ ] - `p1` - Keep original display names; match core-provided names, aliases and transliterations with case folding, ё/е and ß/ss equivalence; preserve core order within In this call and Recent people - `inst-match`
2. [ ] - `p1` - Limit inline groups to five visible entries each and popover list to eight before scrolling; New Person… remains last - `inst-groups`
3. [ ] - `p1` - **IF** no match: show No one called the query and New Person with the quoted query, not an empty menu - `inst-empty`
4. [ ] - `p1` - New form trims Name to 1–80 characters; empty submit says **Enter a name.**; invalid non-empty Email on blur says **Enter an email like name@company.com.** - `inst-validate`
5. [ ] - `p1` - **IF** a duplicate is returned: show **Lena K. (QA) is already in your people.**, **Use Lena K.**, **Create Anyway**; require the user's choice - `inst-duplicate`
6. [ ] - `p1` - Keep draft when focus leaves; suppress Return, Esc submission and review/card keys during composition; first Esc clears query and a second closes the picker - `inst-focus`
7. [ ] - `p1` - **RETURN** existing or new PersonRef for the host command; owner hosts use Create and Assign, speaker hosts Create and Name; the picker creates no voice profile - `inst-return`

## 4. States (CDSL)

### Naming row and panel

- [ ] `p1` - **ID**: `cpt-noter-state-ui-speakers-naming`

**States**: UNNAMED, SELECTED, NAMING, NAMED, SKIPPED, ERROR, ALL_NAMED, HIDDEN

**Initial State**: UNNAMED for a provisional speaker

**Transitions**:
1. [ ] - `p1` - **FROM** UNNAMED, ERROR **TO** SELECTED **WHEN** a valid person is picked - `inst-pick`
2. [ ] - `p1` - **FROM** SELECTED **TO** NAMING **WHEN** Name is confirmed - `inst-name`
3. [ ] - `p1` - **FROM** NAMING **TO** NAMED **WHEN** the core returns the identity - `inst-named`
4. [ ] - `p1` - **FROM** NAMING **TO** ERROR **WHEN** the command fails; keep the draft - `inst-error`
5. [ ] - `p1` - **FROM** UNNAMED, SELECTED **TO** SKIPPED **WHEN** Skip is chosen - `inst-skip`
6. [ ] - `p1` - **FROM** SKIPPED **TO** UNNAMED **WHEN** Name… is chosen in Skipped - `inst-unskip`
7. [ ] - `p1` - **FROM** NAMED **TO** UNNAMED **WHEN** core Undo restores the provisional speaker - `inst-undo`
8. [ ] - `p1` - **FROM** NAMED **TO** ALL_NAMED **WHEN** no unnamed or skipped speakers remain; show result for 10 s - `inst-all`
9. [ ] - `p1` - **FROM** UNNAMED, SELECTED, SKIPPED, ALL_NAMED **TO** HIDDEN **WHEN** Hide is clicked, or the all-named outcome expires; retain row states - `inst-hide`
10. [ ] - `p1` - **FROM** HIDDEN **TO** UNNAMED **WHEN** Show is chosen with unnamed rows remaining; restore selected and skipped row state - `inst-show`

### Correction popover

- [ ] `p1` - **ID**: `cpt-noter-state-ui-speakers-correction`

**States**: CLOSED, EDITING, INVALID, APPLYING, ERROR

**Initial State**: CLOSED

**Transitions**:
1. [ ] - `p1` - **FROM** CLOSED **TO** EDITING **WHEN** Fix Term… opens with a confirmed-text selection - `inst-open`
2. [ ] - `p1` - **FROM** EDITING **TO** INVALID **WHEN** the replacement is empty - `inst-invalid`
3. [ ] - `p1` - **FROM** INVALID, ERROR **TO** EDITING **WHEN** valid text and current selection are restored - `inst-valid`
4. [ ] - `p1` - **FROM** EDITING **TO** APPLYING **WHEN** Fix is confirmed - `inst-apply`
5. [ ] - `p1` - **FROM** APPLYING **TO** CLOSED **WHEN** the returned segment is applied - `inst-done`
6. [ ] - `p1` - **FROM** APPLYING **TO** ERROR **WHEN** the command fails or selection becomes stale - `inst-error`
7. [ ] - `p1` - **FROM** EDITING, INVALID, ERROR **TO** CLOSED **WHEN** Esc cancels; restore anchor/call-app focus - `inst-cancel`

## 5. Definitions of Done

### Shared identity and post-call naming

- [ ] `p3` - **ID**: `cpt-noter-dod-ui-speakers-naming`

The system **MUST** render the picker, New person form, live rename and PC-R9 with all scopes, invitation suggestions, sample/text-only paths, skip/unskip, hide/show and core Undo. Identity changes preserve user edits and never rename earlier calls automatically.

**Implements**:
- `cpt-noter-flow-ui-speakers-live-name`
- `cpt-noter-flow-ui-speakers-post-call`
- `cpt-noter-algo-ui-speakers-picker`
- `cpt-noter-state-ui-speakers-naming`

**Constraints**: `cpt-noter-constraint-accessibility-baseline`, `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-non-activating-panels`

**Touches**:
- Commands: `transcript_rename_speaker`, `transcript_name_speakers`, `audio_play`, `audio_stop`, `change_undo`; M3 `people_list`, `person_create` via fake in M2
- Tests: unit matching, duplicates, validation, composition, draft retention and panel timers; conformance whole-call/one-segment, skip, labels/owners/prose propagation and inverse changes; E2E `cpt-noter-seq-call-screen-name-speaker`, `cpt-noter-seq-call-page-name-speakers` (all paths); XCUITest `test_cpt_noter_seq_call_screen_name_speaker` for key-panel and call-app focus; screenshots picker/new/duplicate, selected/named/skipped/compact and audio-gone panel

### Correct terms with glossary intent

- [ ] `p3` - **ID**: `cpt-noter-dod-ui-speakers-corrections`

The system **MUST** preserve the selected range and original wording, apply only confirmed corrections, honour Add to glossary and show older-call proposal intent, with inline retry and focus return.

**Implements**:
- `cpt-noter-flow-ui-speakers-fix-term`
- `cpt-noter-state-ui-speakers-correction`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `transcript_fix_term`, `glossary_list`, `change_undo`
- Tests: unit empty replacement, stale selection, Unicode TextRange and composition cases; conformance correction/original text, glossary intent and proposal_queued; real-core command E2E for fix and Undo; screenshots live/stored popover, glossary match, invalid and applying states

**Completion gate.** Write failing tests first; unit and changed-line coverage meet 80% per side. Conformance runs fake and real; successful frozen commands and named real-core stories count toward 60%, M3 fake commands do not. Native tests use underscore story ids. Screenshots meet 98%; due performance scenarios meet 60% coverage and stay within 10% of base instructions. Trace never falls. `just gate-fast` stays green; `just gate` passes.

## 6. Acceptance Criteria

- [ ] Live rename defaults to Whole call; Only this line uses the selected segment id
- [ ] Choosing or creating a person never submits during composition or drops a draft when the call app regains focus
- [ ] Names reach transcript, owners and prose through core views; the UI never substitutes strings in generated prose
- [ ] Skipped speakers remain nameable and are never counted as All speakers named
- [ ] Deleted audio removes sample controls but keeps first-line naming
- [ ] Term fixes retain original words, respect glossary intent and never silently alter past calls

## 7. Additional Context

**Prototype reuse.** Rewrite `C.personPicker`, `speaker-rename`, `person-picker`, `term-fix` and `C.speakerNamingPanel` as React PersonPicker, SpeakerRenamePopover, TermFixPopover and SpeakerNamingPanel. Port `.cw-pp*`/popover styles from `20-b.css` and `.pc-name*` from `30-c.css`, with shared tokens and SVG icons. Keep stable component/primitive/variant/state/region attributes. Prototype runtime, fake person ids, sample sound timers and local name maps are presentation references only. Suggestions wrap before truncating; the first quote keeps its language; counts pluralise. Name speakers is a labelled region; fields are comboboxes with grouped listbox options, chips are pressed buttons and results are polite statuses. Reduce motion collapses rows instantly.

**States coverage.** Picker covers empty, typing, no match, applying, error, new form, missing name, invalid email, duplicate, draft kept and created/applied outcomes. Naming covers unnamed, selected/focused chip, naming, named, skipped, all named, hidden and audio gone. Term fix covers default, glossary match, invalid, applying and applied in live/stored hosts.

**DESIGN versus prototype.** README calls out missing Return/arrow selection in the name picker and Fix Term as a row hover button instead of a selection context menu. Add the DESIGN keyboard/context-menu behaviour while retaining the prototype look. Prototype Play Sample flashes for 2 s rather than playing the specified 5-s clip; use real audio state. Prototype skip and rename alter local fixture maps; production uses the typed commands and store events. Its voice-profile checkbox has no backing effect.

**Milestone and contract limits.** Decomposition discrepancy 7 places `people_list`/`person_create` in M3 although the live naming story uses them. M2 builds those controls with the fake; real M2 rename can use existing PersonRef or new PersonRef directly. PersonRef has name/email but no role, and separate person_create plus rename is not an atomic create-and-name with one Undo: Role persistence and atomic undo for that full form need owner contract work. RenameSpeakerArgs and SpeakerAssignment have no update-voice-profile option; FixTermArgs has no language; the complete checkbox and Language controls therefore cannot claim persisted effects yet. SpeakerMutation lacks affected-item counts; SpeakerView supplies segment_count, sample and one suggestion, but not grouped invite/recent suggestions, invite-source captions or the first quote. Use its real sample and count, resolve the first quote from the transcript and request owner contract support for missing suggestion metadata. The fake ignores one_segment scope, does not propagate every derived view, and null assignments do not persist skip: conformance must cover these against real core. No frozen command or generated binding is changed by this spec.

**Data and non-applicability.** The UI owns no tables. Identity, glossary writes and undo are core responsibilities; no voice profile is created here. Network calls, credential handling, migrations, deployment and earlier-call reconciliation are not applicable to this UI feature. Bridge logs omit names, selected text and replacements.
