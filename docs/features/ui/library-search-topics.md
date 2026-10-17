---
title: "Feature — Library: search, filters and topics"
description: "Find calls, items and document sections, filter and tag calls, and follow, rename or merge a topic with evidence and Undo."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-library-search-topics
milestone: M3
---

# Feature: Library: search, filters and topics

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Search and check a match](#search-and-check-a-match)
  - [Filter, tag and export calls](#filter-tag-and-export-calls)
  - [Follow, rename and merge a topic](#follow-rename-and-merge-a-topic)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Keep filters and tokens in step](#keep-filters-and-tokens-in-step)
  - [Present ranked search results](#present-ranked-search-results)
- [4. States (CDSL)](#4-states-cdsl)
  - [Library reads and topic edits](#library-reads-and-topic-edits)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Search and filter surfaces](#search-and-filter-surfaces)
  - [Topics and reversible identity changes](#topics-and-reversible-identity-changes)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p4` - **ID**: `cpt-noter-featstatus-ui-library-search-topics`

## 1. Feature Context

- [ ] `p4` - `cpt-noter-feature-ui-library-search-topics`

### 1.1 Overview

Extend Calls with one filter state shared by tokens and pop-ups, sectioned search results, tags and the Topics and Topic thread pages. The core ranks and marks matches; the UI shows the original words, evidence and the actions that widen a weak search.

### 1.2 Purpose

Implement LC-R2, LS-R1 to LS-R7, LT-R1 to LT-R2 and TH-R1 to TH-R4 of the Library, plus tagging in LC-R3.

**Requirements**: PRD › Feature specification › 5. Library and search; Search and cross-meeting memory. The PRD has no requirement IDs.

**Principles**: follows the dependencies; `cpt-noter-principle-core-owns-state`, `cpt-noter-principle-evidence-one-click`.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Searches, filters, tags and follows topics |
| Noter core (system) | Retrieves ranked hits, applies tags and records topic changes |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 5; Search and cross-meeting memory
- **Design**: [DESIGN.md](../../DESIGN.md) › Screen — Library; Component — Filter bar, Search result row, Topic chip
- **Design elements**: `cpt-noter-component-screen-library` (search and topics), `cpt-noter-component-ui-filter-bar`, `cpt-noter-component-ui-search-result-row`, `cpt-noter-component-ui-topic-chip`
- **Stories (M3)**: `cpt-noter-seq-library-search-calls`, `cpt-noter-seq-library-filter-calls`, `cpt-noter-seq-library-follow-topic`
- **Frozen commands delivered (M3)**: `search`, `topics_list`, `topic_get`, `topic_rename`, `topics_merge`, `topics_keep_separate`
- **Earlier commands reused**: `calls_list`, `call_types_list`, `people_list` (M3, People), `call_tags_set`, `tags_list`, `audio_play`, `audio_stop`, `transcript_span`, `open_external`; `calls_export` through outputs and dialogs; `change_undo` through history
- **Data**: core-owned `cpt-noter-dbtable-chunks`, `cpt-noter-dbtable-topics`; no UI tables
- **Events**: `entity:changed`, `playback:state`; bridge resnapshot on recovery
- **Prototype modules**: `src/js/40-d-2-components.js`, `40-d-3-library.js`, `04-shared.js` (`C.topicChip`), `src/css/40-d.css`
- **Contract and test reference**: `apps/desktop/src/core/bindings.ts` and `apps/desktop/src/core/fake/` (read-only); [HARNESS.md](../../HARNESS.md); [DECOMPOSITION.md](../../DECOMPOSITION.md)
- **Dependencies**: `cpt-noter-feature-ui-library-calls`, `cpt-noter-feature-ui-items`; history, playback, export and dialog components are reused through those features

## 2. Actor Flows (CDSL)

### Search and check a match

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-library-search-topics-search`

**Actor**: Primary user

**Success Scenarios**:
- Search “websocket уведомления”, read Items, Transcripts and Documents, play a span, then open the Call page at it
- Back restores the query, filters, expanded groups and scroll position

**Error Scenarios**:
- Index rebuilding: keyword-only line and progress, with usable keyword results
- No matches: the query, active filter count, **Try fewer words**, applicable **Clear Filters**, and **Ask Instead**
- Weak-only: warning and applicable widening actions; search failed: **Couldn't search your calls** with **Try Again**

**Steps**:
1. [ ] - `p1` - User enters words in Calls and commits the search with Return - `inst-submit`
2. [ ] - `p1` - API: `search` with the words, current `CallFilter` and per-section limit - `inst-search`
3. [ ] - `p1` - UI: skeleton rows after 300 ms; on failure keep words and filters and offer **Try Again**, which repeats only on request - `inst-loading-error`
4. [ ] - `p1` - Algorithm: present the response with `cpt-noter-algo-ui-library-search-topics-results` - `inst-present`
5. [ ] - `p1` - User presses ↓ into results, then Space on a span - `inst-play`
6. [ ] - `p1` - UI: reuse playback with `audio_play` and `playback:state`; Space again pauses; missing audio shows its reason and retained text - `inst-playback`
7. [ ] - `p1` - User presses Return or › on the span; UI pushes Call page › **Transcript** at the returned span, highlighted for 3 s - `inst-open-span`
8. [ ] - `p1` - **IF** the user opens a document result - `inst-if-document`
   1. [ ] - `p1` - API: `open_external` for the returned document target; a deleted source cannot open - `inst-open-document`
9. [ ] - `p1` - **IF** the user chooses **Ask Instead** - `inst-if-ask`
   1. [ ] - `p1` - UI: open a new Ask thread and submit the same words once - `inst-ask`
10. [ ] - `p1` - **RETURN** the current results route - `inst-return-search`

### Filter, tag and export calls

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-library-search-topics-filter-tag`

**Actor**: Primary user

**Success Scenarios**:
- People Anna plus **Has Open Items** yields **8 calls match**; select three and export with the existing Export sheet
- Tag three calls “release”, then choose it from # suggestions or **Tags**

**Error Scenarios**:
- No calls match: **No calls match these filters** with **Clear Filters**
- No tags: **No tags yet. Add tags in a call's Call info.**; no calls yet retains the first-use self-test action

**Steps**:
1. [ ] - `p1` - User sets People, Type, Tags, Language, Date or **Has Open Items**; choices come from core people, call types and `tags_list` - `inst-choose`
2. [ ] - `p1` - Algorithm: reconcile tokens and filters with `cpt-noter-algo-ui-library-search-topics-filters` - `inst-reconcile`
3. [ ] - `p1` - API: `calls_list` with the resulting filter when no words are set, otherwise `search`; show the matching count without moving focus - `inst-query`
4. [ ] - `p1` - User selects three rows and chooses **Add Tag…**; UI shows **Add tag to 3 calls**, **Add tag…**, **In use: release, hotfix**, and **Add Tag** - `inst-add-popover`
5. [ ] - `p1` - User commits with Return, comma or **Add Tag**; reject a blank tag or more than 32 characters without silently truncating it - `inst-commit-tag`
6. [ ] - `p1` - API: `call_tags_set` with selected ids and add/remove sets; replace rows from the response and give its `change_id` to the undo strip - `inst-tags-set`
7. [ ] - `p1` - UI: **Tagged 3 calls “release” · Undo**; removal lists the selection's tags and reads **Removed “release” from 3 calls · Undo**; refresh `tags_list` - `inst-tag-result`
8. [ ] - `p1` - **IF** the write fails - `inst-if-write-fails`
   1. [ ] - `p1` - UI: keep selection and draft; show the typed error, leave core rows unchanged and allow an explicit retry - `inst-tag-error`
9. [ ] - `p1` - User chooses **Export…** or ⌘E with a selection; UI passes only those ids to the existing Export sheet and shows its save-panel result - `inst-export`
10. [ ] - `p1` - **RETURN** the filtered list; no selection leaves Export disabled with **Select calls to export** - `inst-return-filter`

### Follow, rename and merge a topic

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-library-search-topics-topic`

**Actor**: Primary user

**Success Scenarios**:
- Open Topics with ⌘5, follow a decision's evidence, rename a topic and undo it
- Review **What moves** and explicitly merge into the kept topic, or permanently **Keep Separate**

**Error Scenarios**:
- No topics, no topic-name match and no surviving topic items have separate empty states
- Taken name offers **Merge Instead**; a stale revision keeps the draft and refreshes current topic data

**Steps**:
1. [ ] - `p1` - User opens Topics; API: `topics_list`; UI shows Topic, Calls, Decisions, Open questions, Last discussed and merge glyphs - `inst-list-topics`
2. [ ] - `p1` - User searches names, selects a row or chip and opens it; API: `topic_get` with topic id - `inst-get-topic`
3. [ ] - `p1` - UI: title counts and month-grouped entries in date order; Return opens evidence, ⌘I opens the shared Item inspector - `inst-timeline`
4. [ ] - `p1` - User chooses **Ask About This Thread** or **Ask About This**; UI starts Ask scoped to this topic with **What was decided and what is still open about Websocket notifications?** - `inst-topic-ask`
5. [ ] - `p1` - User chooses **Rename…**; UI shows the current name, requires nonblank text and offers **Merge Instead** for a known name collision - `inst-rename-form`
6. [ ] - `p1` - API: `topic_rename` with id, `rev` and name; on success update the table, thread and chips and offer Undo with the returned change - `inst-rename`
7. [ ] - `p1` - User chooses a merge suggestion or **Merge With…**; UI shows the 520-pt sheet, target chooser excluding this topic, item preview and **Cancel** / **Merge** - `inst-merge-preview`
8. [ ] - `p1` - **IF** the user confirms a distinct target - `inst-if-confirm`
   1. [ ] - `p1` - API: `topics_merge` with source and target; navigate to the returned topic, refresh entries and show **Merged 3 items into “Notification service” · Undo** - `inst-merge`
9. [ ] - `p1` - **IF** the user chooses **Keep Separate** - `inst-if-separate`
   1. [ ] - `p1` - API: `topics_keep_separate` with both ids; clear the suggestion after success - `inst-separate`
10. [ ] - `p1` - **IF** all backing calls were deleted - `inst-if-empty-topic`
    1. [ ] - `p1` - UI: **Nothing left in this topic** and **The calls behind this topic were deleted.**; **Delete Topic** is a contract gap listed below - `inst-empty-topic`
11. [ ] - `p1` - **RETURN** the kept topic or original route after Cancel; errors keep the sheet and choices - `inst-return-topic`

## 3. Processes / Business Logic (CDSL)

### Keep filters and tokens in step

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-library-search-topics-filters`

**Input**: one filter action or token removal, the words and the window's filter state

**Output**: one `CallFilter`, its tokens and one new read

**Steps**:
1. [ ] - `p1` - Set or remove the chosen value only once; multi-values are alternatives within a group, and groups combine - `inst-set-value`
2. [ ] - `p1` - Derive tokens in order: people, types, tags, languages, date, open items; display **Anna**, **Planning**, **Tag: release**, **RU**, **Last 7 Days**, **Has open items** - `inst-tokens`
3. [ ] - `p1` - **IF** Clear is chosen: clear filters and tokens but keep typed words - `inst-clear`
4. [ ] - `p1` - **IF** a token is removed by × or ⌫ at the field start: remove its filter value - `inst-remove`
5. [ ] - `p1` - Offer # suggestions only from tags in use; a choice adds the tag filter and clears the suggestion draft - `inst-suggest`
6. [ ] - `p1` - Keep the date menu's Any Time, Last 7 Days, Last 30 Days and Custom range in the same state; issue a new read and ignore responses for superseded words or filters - `inst-read`
7. [ ] - `p1` - **RETURN** synchronized controls; state survives Back in this window, not an app restart - `inst-return`

### Present ranked search results

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-library-search-topics-results`

**Input**: `SearchResults`, current filters and expanded call groups

**Output**: topic suggestion, Items, Transcripts, Documents and Ask bridge

**Steps**:
1. [ ] - `p1` - Render only core-returned hits; never implement retrieval, stemming or strength scoring in React - `inst-authority`
2. [ ] - `p1` - Show the keyword-only mode and reported progress, or **Best matches · keyword and meaning**; show cross-language information when reported - `inst-mode`
3. [ ] - `p1` - Put items before transcript chunks; group spans by call with three visible initially and one at Narrow width; **More in This Call** reveals available hidden hits - `inst-groups`
4. [ ] - `p1` - **IF** all hits are weak: show the warning, active-filter count and applicable Clear Filters, Search All Languages and Ask Instead actions - `inst-all-weak`
5. [ ] - `p1` - **ELSE** put strong hits first within each result section, then **Weaker matches** before weak rows; every weak row keeps its tag and full contrast - `inst-mixed`
6. [ ] - `p1` - Render core highlight ranges on escaped original text with its language attribute; do not highlight a normalized copy - `inst-highlights`
7. [ ] - `p1` - Show **How Noter searched** from returned explanation and active filters; never fill missing terms with fixture text - `inst-explain`
8. [ ] - `p1` - Announce the final count once, adding **only weak matches** when applicable - `inst-announce`
9. [ ] - `p1` - **RETURN** results; when empty keep filters and the Ask bridge - `inst-return`

## 4. States (CDSL)

### Library reads and topic edits

- [ ] `p1` - **ID**: `cpt-noter-state-ui-library-search-topics-view`

**States**: LOADING, CALLS, FILTER_EMPTY, RESULTS, NO_MATCHES, WEAK_ONLY, READ_ERROR, TOPICS, NO_TOPICS, TOPIC_NO_MATCH, THREAD, THREAD_EMPTY, RENAMING, NAME_CLASH, MERGING

**Initial State**: LOADING

**Transitions**:
1. [ ] - `p1` - **FROM** LOADING **TO** CALLS **WHEN** a filtered call read returns rows - `inst-calls`
2. [ ] - `p1` - **FROM** LOADING **TO** FILTER_EMPTY **WHEN** calls exist but none meets the filters - `inst-filter-empty`
3. [ ] - `p1` - **FROM** LOADING **TO** RESULTS **WHEN** search returns at least one strong hit - `inst-results`
4. [ ] - `p1` - **FROM** LOADING **TO** WEAK_ONLY **WHEN** search reports only weak hits - `inst-weak`
5. [ ] - `p1` - **FROM** LOADING **TO** NO_MATCHES **WHEN** search returns no hits - `inst-no-matches`
6. [ ] - `p1` - **FROM** LOADING **TO** READ_ERROR **WHEN** the read fails; retry returns to LOADING with the same inputs - `inst-error`
7. [ ] - `p1` - **FROM** LOADING **TO** TOPICS **WHEN** topics arrive; zero topics goes to NO_TOPICS, a name filter matching none to TOPIC_NO_MATCH - `inst-topics`
8. [ ] - `p1` - **FROM** TOPIC_NO_MATCH **TO** TOPICS **WHEN** Clear Search restores the list - `inst-clear-topic`
9. [ ] - `p1` - **FROM** LOADING **TO** THREAD **WHEN** a topic has entries; no surviving entries goes to THREAD_EMPTY - `inst-thread`
10. [ ] - `p1` - **FROM** THREAD **TO** RENAMING **WHEN** Rename is chosen; a collision goes to NAME_CLASH - `inst-rename`
11. [ ] - `p1` - **FROM** NAME_CLASH **TO** MERGING **WHEN** Merge Instead is chosen - `inst-clash-merge`
12. [ ] - `p1` - **FROM** THREAD **TO** MERGING **WHEN** Merge is chosen; Cancel returns unchanged, success opens the target THREAD - `inst-merge`
13. [ ] - `p1` - **FROM** RENAMING **TO** THREAD **WHEN** a rename succeeds; failure keeps the draft in RENAMING - `inst-renamed`

## 5. Definitions of Done

### Search and filter surfaces

- [ ] `p4` - **ID**: `cpt-noter-dod-ui-library-search-topics-search`

The system **MUST** render the filter bar, result rows and all search states as the prototype, preserve navigation state, support multilingual highlights, weak matches, playback and evidence, and extend Calls with tag batches and export delegation.

**Implements**:
- `cpt-noter-flow-ui-library-search-topics-search`
- `cpt-noter-flow-ui-library-search-topics-filter-tag`
- `cpt-noter-algo-ui-library-search-topics-filters`
- `cpt-noter-algo-ui-library-search-topics-results`

**Constraints**: `cpt-noter-constraint-three-languages`, `cpt-noter-constraint-accessibility-baseline`, `cpt-noter-constraint-local-only-ui`

**Touches**:
- Commands: `search`, `calls_list`, `call_tags_set`, `tags_list`; shared playback and export
- Tests: unit tests for token synchronization, stale reads, highlight ranges and strength sections; conformance for filters, tags and `SearchResults`; E2E `cpt-noter-seq-library-search-calls`, `cpt-noter-seq-library-filter-calls`, happy, error, empty and batch paths against the real core

### Topics and reversible identity changes

- [ ] `p4` - **ID**: `cpt-noter-dod-ui-library-search-topics-topics`

The system **MUST** render topic counts, month groups, the inspector, rename collision and merge preview, apply changes only after core success, and route each returned change to Undo. Unsupported deletion remains a named contract gap, not a local hide. `just gate` passes.

**Implements**:
- `cpt-noter-flow-ui-library-search-topics-topic`
- `cpt-noter-state-ui-library-search-topics-view`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `topics_list`, `topic_get`, `topic_rename`, `topics_merge`, `topics_keep_separate`
- Tests: unit tests for merge target guards and read states; conformance for revisions, aliases and keep-separate; E2E `cpt-noter-seq-library-follow-topic`, with the unsupported Delete Topic path reported until the contract supports it

**Completion gate**: `just gate` passes.

## 6. Acceptance Criteria

- [ ] Prototype Library states `filtered-empty`, `no-tags`, `tagged`, `loading`, `cross-language`, `keyword-only`, `no-matches`, `weak-only`, `search-failed`, `no-topics`, `merge`, `nothing-left` and the rename forms match screenshots at Wide, Medium and Narrow
- [ ] Clear never deletes typed words; filter changes keep focus and announce one final count
- [ ] English, Russian and German snippets retain original script; highlights never execute HTML
- [ ] Filter controls wrap, the result column is at most 960 pt and the thread at most 860 pt; keyboard and VoiceOver expose every action
- [ ] Fake-core rendering is tested separately from real-core command and story coverage; no per-row retrieval or automatic mutation retry

## 7. Additional Context

**Prototype reuse.** Rewrite `C.filterBar` as FilterBar, `C.searchResultRow` as SearchResultRow, `C.topicChip` as TopicChip, and the search, topics, thread and `lib-*` overlays as React route components. Port `.lb-*` in `40-d.css` as-is with the original component, primitive, variant, size, state and region attributes. `00-core.js`, sample data, `pickResults`, demo timers and local mutation handlers are source of truth only; bridge calls replace them.

**DESIGN versus prototype.** DESIGN says typing switches to Search results; `lib.search` commits on Return. Follow the prototype's Return submission. DESIGN puts **Show How Noter Searched** in every result state; the prototype omits it on no matches, loading and failure. Follow those layouts. DESIGN's Narrow one-span rule and several keyboard behaviours have no matching rule in `40-d.css`; apply DESIGN where the prototype has no behaviour. The topic merge sheet adds a **Merge into** chooser; retain it. Prototype tag entry silently lowercases and truncates; use the contract's validation instead of silently losing input. The delete-alert wording difference is already owned by dialogs-host.

**Contract and fake gaps.** There is no topic-delete command, so the empty-topic Delete Topic story cannot be completed on the frozen surface. `SearchExplain` lacks the exact stem list and meaning/language labels used by the prototype; display returned normalized query, counts, mode and actual filters without invented data. SearchHit has no direct speaker or audio-availability field; reuse transcript-span data lazily for the focused/played result and existing call state rather than issuing one read per row. Use TopicRow.last_seen for Last discussed; no language field is supplied for the topic chip. A search response has no cursor or total-more count: expand returned hits only, never invent “+4”. The default fake ignores search filters and returns simple substring hits without documents or weak matches; typed scenario overrides must cover those states. Topic rename does not reject duplicate names in the default fake. These are owner/contract follow-ups, not new commands defined here.

**Milestone notes.** Tag commands are M2 but the Library tagging surface is M3. Ask is another M3 feature; export is the M2 outputs/dialogs path. No changes to milestone assignments are required.

**Not applicable.** UI database access, indexing, ranking, topic formation, network requests, server authorization and deployment: core responsibilities. The UI renders plain data through the bridge and logs only safe error metadata.
