---
title: "Feature: Retrieval, search, Ask and topics"
description: "Shared hybrid retrieval, sectioned search, cited Ask threads and topic threads across calls."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M3
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Retrieval, search, Ask and topics

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Search and filter the library](#search-and-filter-the-library)
  - [Ask a question or follow-up](#ask-a-question-or-follow-up)
  - [Stop or reopen an Ask thread](#stop-or-reopen-an-ask-thread)
  - [Read and edit topic threads](#read-and-edit-topic-threads)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Retrieve permitted evidence](#retrieve-permitted-evidence)
  - [Validate citations and answer provenance](#validate-citations-and-answer-provenance)
  - [Attach items to topics](#attach-items-to-topics)
  - [Rebuild derived indexes](#rebuild-derived-indexes)
- [4. States (CDSL)](#4-states-cdsl)
  - [Ask turn lifecycle](#ask-turn-lifecycle)
  - [Retrieval index readiness](#retrieval-index-readiness)
- [5. Definitions of Done](#5-definitions-of-done)
  - [One retrieval function](#one-retrieval-function)
  - [Cited and cancellable Ask](#cited-and-cancellable-ask)
  - [Topics and undoable edits](#topics-and-undoable-edits)
  - [Retrieval evaluation and harness](#retrieval-evaluation-and-harness)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p4` - **ID**: `cpt-noter-featstatus-core-retrieval-ask`

- [ ] `p4` - `cpt-noter-feature-core-retrieval-ask`

## 1. Feature Context

### 1.1 Overview

`noter-retrieval` gives search, Ask, copilot facts and the pre-call brief one retrieval function. It combines keyword and local vector results, applies filters before ranking, returns evidence, and keeps Ask turns and topic threads. Document ingestion belongs to knowledge sources; copilot ticks belong to M4.

### 1.2 Purpose

The user can find a decision across English, Russian and German calls and ask a follow-up whose claims can be checked against the original lines. Topics keep related decisions and questions together across calls.

**Requirements**: PRD › Feature specification › 5. Library and search; PRD › Search and cross-meeting memory; PRD › Success metrics › Search, Knowledge.

**Principles**: None assigned by the decomposition; the shared router and egress gate still govern every model request.

**Delivers**:
- Frozen commands (M3): `search`, `ask_start`, `ask_stop`, `ask_threads_list`, `ask_thread_get`, `ask_thread_delete`, `ask_scope_presets`, `topics_list`, `topic_get`, `topic_rename`, `topics_merge`, `topics_keep_separate`.
- Channel: `AskMsg`; entity edits publish `entity:changed` after commit.
- DESIGN.md stories (M3): `cpt-noter-seq-library-search-calls`, `cpt-noter-seq-library-filter-calls`, `cpt-noter-seq-library-follow-topic`, `cpt-noter-seq-ask-cited-answer`, `cpt-noter-seq-ask-follow-up-and-copy`.
- Performance scenarios: `retrieval_search`, `retrieval_rebuild` in `harness/perf.toml`.

The filter story also uses M1 `calls_list` and M2 tags and export; those commands stay owned by their earlier features. Copy with Citations uses the returned answer and citation metadata; it adds no IPC command.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Searches, asks, follows topics, renames or merges them |
| Main window | Sends queries and scope; consumes the Ask Channel |
| Post-call pipeline | Submits indexed items for topic attachment |
| Router and engine | Run the answer skill and local embeddings respectively |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-retrieval-ask`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-retrieval`, `cpt-noter-seq-core-ask`, `cpt-noter-dbtable-topics`, `cpt-noter-dbtable-suppressions`, `cpt-noter-dbtable-ask-threads`; 3.7 chunks and 4.2 D1
- **PRD**: [PRD.md](../../PRD.md) › Search and cross-meeting memory
- **Contract**: `crates/noter-protocol/src/model/library.rs`, `skills.rs`, `contracts/ipc.manifest.json`
- **Dependencies**: `cpt-noter-feature-core-postcall`, `cpt-noter-feature-core-llm-gate`, `cpt-noter-feature-core-engine-offline`

The empty-topic story offers Delete Topic, but the frozen contract has no such command. This spec covers the empty thread, not a new delete API. AskScope has `include_documents`, not a source-id list; source scope is enforced internally. The UI's lookup-count and elapsed-time footer has no corresponding fields on `AskAnswer`; do not invent them here. `StreamEndReason` has no normal Ask completion or cancellation case: `done` completes an answer, `failed` carries `answer_stopped` on Stop, and `ended` is used only for its declared unsubscribe, lag or shutdown cases.

## 2. Actor Flows (CDSL)

### Search and filter the library

- [ ] `p4` - **ID**: `cpt-noter-flow-core-retrieval-ask-search`

**Actor**: Primary user (main window › Calls)

**Success Scenarios**:
- A mixed-language query returns items, transcript spans, documents and topics with evidence and match strength.
- People, date, type, tag, language and open-item filters narrow the same query; clearing them runs it again.

**Error Scenarios**:
- Index rebuilding: keyword search continues with progress.
- No matches or only weak matches: the result says so without guessing; a read failure returns a typed error and leaves the query available for retry.

**Steps**:
1. [ ] - `p1` - API: `search { query, filter, limit }` from main; reject invalid dates or limits with `invalid_input`; the default limit is 20 per section - `inst-search-request`
2. [ ] - `p1` - Run `cpt-noter-algo-core-retrieval-ask-retrieve` using the current library filters - `inst-search-retrieve`
3. [ ] - `p1` - Build `SearchResults` sections and `SearchExplain` with normalized query, keyword and semantic counts and number of active filters - `inst-search-sections`
4. [ ] - `p1` - Set `only_weak` only when there are hits and every hit is weak; return empty sections for no matches - `inst-search-strength`
5. [ ] - `p1` - **RETURN** results with snippets, highlight ranges into the returned text, provenance and `cross_language`; a selected span uses existing `transcript_span`, `audio_play` and navigation - `inst-search-return`

### Ask a question or follow-up

- [ ] `p4` - **ID**: `cpt-noter-flow-core-retrieval-ask-answer`

**Actor**: Primary user (main window › Ask)

**Success Scenarios**:
- A new question returns a handle immediately and streams a cited answer; a follow-up appends a turn to the chosen thread.
- Scope presets constrain people, type, dates, topic, call and document inclusion.

**Error Scenarios**:
- No cited evidence: `found: false`, never a model-knowledge answer.
- Runtime failure or the 60 s Ask deadline: a typed failure on the Channel; local retry follows the router's policy.
- Sensitive sources skipped or only weak evidence: the answer carries the corresponding counts and flags.

**Steps**:
1. [ ] - `p1` - API: `ask_scope_presets` returns readable presets; API: `ask_start { thread_id, question, scope }` with a Channel starts a turn - `inst-ask-request`
2. [ ] - `p1` - Validate a non-empty question, scope references and dates; an unknown thread returns `not_found` before opening the stream - `inst-ask-validate`
3. [ ] - `p1` - DB: create a thread if needed, with the first question as title, and record the turn through the writer and change log - `inst-ask-create`
4. [ ] - `p1` - Register the subscription and **RETURN** `AskHandle` with thread, turn and subscription ids before sending Channel messages - `inst-ask-handle`
5. [ ] - `p1` - Resolve the search-answer runtime and effective privacy; retrieve the top 30 permitted hits with `cpt-noter-algo-core-retrieval-ask-retrieve` - `inst-ask-context`
6. [ ] - `p1` - Emit `started`; run `ask-answer` through the router and gate, including prior thread context subject to the current privacy rules; refinements use noter-mcp - `inst-ask-run`
7. [ ] - `p1` - Run `cpt-noter-algo-core-retrieval-ask-citations`; stream answer `delta` and `citation` messages without claiming unvalidated evidence - `inst-ask-validate-answer`
8. [ ] - `p1` - DB: store the completed answer, citations, runtime and run id with the updated thread time; emit terminal `done` through the stream hub and release runtime and subscription resources - `inst-ask-finish`
9. [ ] - `p1` - **IF** execution fails, emit terminal `failed` with `CoreError`; release the runtime and subscription; use `ended` only for a declared `StreamEndReason` - `inst-ask-failure`

### Stop or reopen an Ask thread

- [ ] `p4` - **ID**: `cpt-noter-flow-core-retrieval-ask-threads`

**Actor**: Primary user (main window › Ask)

**Success Scenarios**:
- Stop cancels the active turn; recent threads reopen with their turns in order.
- A deleted source is shown as deleted in an old citation; asking again retrieves only current evidence.

**Error Scenarios**:
- Unknown thread or turn: `not_found`; late runtime output cannot recreate a deleted thread.

**Steps**:
1. [ ] - `p1` - API: `ask_stop { turn_id }` cancels that turn and its runtime; preserve the displayed partial answer as stopped, emit `failed` with `answer_stopped`, release its Channel and **RETURN** `Ack` - `inst-thread-stop`
2. [ ] - `p1` - API: `ask_threads_list` reads recent thread titles, counts and update times newest first - `inst-thread-list`
3. [ ] - `p1` - API: `ask_thread_get { thread_id }` reads its scope and turns; resolve every citation target and set `deleted` when its source is gone - `inst-thread-get`
4. [ ] - `p1` - **IF** the user deletes a thread with `ask_thread_delete`, cancel its active turns before deleting the thread and turns together through the change-log writer - `inst-thread-delete`
   1. [ ] - `p1` - Discard late results for the deleted thread; **RETURN** `Ack` - `inst-thread-deleted`
5. [ ] - `p1` - **RETURN** typed thread read models, including complete citation metadata for Markdown copy in the UI - `inst-thread-return`

### Read and edit topic threads

- [ ] `p4` - **ID**: `cpt-noter-flow-core-retrieval-ask-topics`

**Actor**: Primary user (main window › Topics)

**Success Scenarios**:
- Topic rows open into items grouped by call, newest call first; rename and merge propagate to chips.
- Keep Separate suppresses the pair's merge suggestion permanently.

**Error Scenarios**:
- Stale rename: `conflict` with `detail.current_rev`; missing topic: `not_found`; self-merge: `invalid_input`.

**Steps**:
1. [ ] - `p1` - API: `topics_list` and `topic_get { topic_id }` read topic counts, aliases and merge suggestion, then items grouped by their call; return an empty thread when no calls remain - `inst-topic-read`
2. [ ] - `p1` - API: `topic_rename { topic_id, rev, name }` validates a non-empty name and guards `rev`; write the name and change row in one transaction - `inst-topic-rename`
3. [ ] - `p1` - API: `topics_merge { source, target }` validates both ids; in one change batch move item links, preserve source names and aliases on target, update its centroid and date range, and remove source - `inst-topic-merge`
4. [ ] - `p1` - API: `topics_keep_separate { a, b }` stores the canonical unordered pair as a `topic_merge` suppression through the writer - `inst-topic-separate`
5. [ ] - `p1` - Emit `entity:changed` only after commit; return `TopicMutation` with `change_id` for rename or merge, and `Ack` for Keep Separate - `inst-topic-return`

## 3. Processes / Business Logic (CDSL)

### Retrieve permitted evidence

- [ ] `p4` - **ID**: `cpt-noter-algo-core-retrieval-ask-retrieve`

**Input**: Query, filters, wanted count, runtime privacy context and index readiness.

**Output**: Ranked strong or weak hits, source-skip count and search explanation.

**Steps**:
1. [ ] - `p1` - Normalize a shadow query as NFKC, lowercase, ё to е, ß to ss, and Snowball stems for English, Russian and German; retain raw text for display - `inst-retrieve-normalize`
2. [ ] - `p1` - Build parameterized SQL predicates for people, dates, call types, languages, tags and open items; apply source privacy and scope before any model receives evidence - `inst-retrieve-filters`
3. [ ] - `p1` - For cloud runs exclude sensitive calls and sources and count skips; for calls-only scope exclude documents - `inst-retrieve-privacy`
4. [ ] - `p1` - Run FTS5 BM25 on normalized shadow text with trigram matches for names and acronyms - `inst-retrieve-keywords`
5. [ ] - `p1` - **IF** vector indexes are ready, embed locally through the engine and scan call, item and permitted document vectors; over-fetch four times the requested count and filter people and scope in SQL before fusion - `inst-retrieve-vectors`
6. [ ] - `p1` - **ELSE** use keyword hits only and report `KeywordOnly` with rebuild progress - `inst-retrieve-keyword-only`
7. [ ] - `p1` - Fuse permitted keyword and vector ranks with reciprocal rank fusion, k = 60; rank matching items ahead of raw chunks and deduplicate evidence - `inst-retrieve-fuse`
8. [ ] - `p1` - Mark literal keyword evidence strong and semantic-only evidence weak; preserve original quotes, segment spans, document headings and cross-language attribution - `inst-retrieve-evidence`
9. [ ] - `p1` - **RETURN** the requested top hits and explanation without logging query or source text - `inst-retrieve-return`

### Validate citations and answer provenance

- [ ] `p4` - **ID**: `cpt-noter-algo-core-retrieval-ask-citations`

**Input**: Router-validated `AskAnswerOutput`, permitted evidence supplied initially or by tools, current source rows and the run's pseudonym map.

**Output**: An `AskAnswer` with valid citations, or a typed validation failure.

**Steps**:
1. [ ] - `p1` - Resolve cited segment and chunk ids against evidence available to this run; reject unknown or out-of-scope ids through the router's validation and retry policy - `inst-cite-resolve`
2. [ ] - `p1` - Recheck source existence and privacy before publishing; build quotes and speaker, call, time or document section from stored evidence - `inst-cite-build`
3. [ ] - `p1` - Map pseudonyms back locally and number citations to match the Markdown references - `inst-cite-map`
4. [ ] - `p1` - **IF** no valid citations remain, discard the unsupported answer and set `found: false` with the not-found response - `inst-cite-not-found`
5. [ ] - `p1` - Carry runtime, local-answer flag, keyword-only flag, sensitive-skip count and only-weak-evidence flag into the answer - `inst-cite-flags`
6. [ ] - `p1` - **RETURN** the answer; raw HTML is not part of answer Markdown - `inst-cite-return`

### Attach items to topics

- [ ] `p4` - **ID**: `cpt-noter-algo-core-retrieval-ask-attach-topic`

**Input**: A new item, its local embedding and existing topic centroids.

**Output**: Logged topic attachment or a new named topic; computed merge suggestions.

**Steps**:
1. [ ] - `p1` - Find the nearest topic centroid - `inst-attach-nearest`
2. [ ] - `p1` - **IF** cosine similarity is above 0.8, attach the item to that topic - `inst-attach-existing`
3. [ ] - `p1` - **ELSE** ask the router to name a new topic from the item under its privacy context - `inst-attach-new`
4. [ ] - `p1` - DB: commit the topic, item link, updated centroid and first/last-seen values with their change rows - `inst-attach-commit`
5. [ ] - `p1` - Suggest pairs whose centroids are above 0.9 similarity, excluding canonical pairs in `suppressions`; never merge automatically - `inst-attach-suggest`
6. [ ] - `p1` - **RETURN** the topic and suggestions - `inst-attach-return`

### Rebuild derived indexes

- [ ] `p4` - **ID**: `cpt-noter-algo-core-retrieval-ask-rebuild`

**Input**: Canonical segments, items, summaries, chunks and document chunks; local embeddings.

**Output**: Rebuildable FTS5 and vector indexes, with progress.

**Steps**:
1. [ ] - `p1` - Enter keyword-only mode; keep normalized keyword reads available while vector indexes rebuild - `inst-rebuild-start`
2. [ ] - `p1` - Read canonical rows in bounded batches; rebuild normalized shadows and indexes through `noter-db`, without holding a writer transaction during engine inference - `inst-rebuild-batches`
3. [ ] - `p1` - Restore vectors from canonical embedding blobs; `chunk_vec` has no call partition and `doc_vec` partitions by privacy class - `inst-rebuild-vectors`
4. [ ] - `p1` - Reconcile edits and deletions committed during the rebuild before making the replacement indexes visible - `inst-rebuild-reconcile`
5. [ ] - `p1` - **IF** a batch fails, retain keyword-only mode and progress; retry cannot duplicate canonical data - `inst-rebuild-failure`
6. [ ] - `p1` - **RETURN** hybrid readiness after successful completion; the maintenance trigger belongs to M5 - `inst-rebuild-return`

## 4. States (CDSL)

### Ask turn lifecycle

- [ ] `p4` - **ID**: `cpt-noter-state-core-retrieval-ask-turn`

**States**: accepted, retrieving, answering, done, failed, cancelled

**Initial State**: accepted

**Transitions**:
1. [ ] - `p1` - **FROM** accepted **TO** retrieving **WHEN** the returned handle's worker starts - `inst-turn-retrieve`
2. [ ] - `p1` - **FROM** retrieving **TO** answering **WHEN** permitted evidence is ready and the runtime starts - `inst-turn-answer`
3. [ ] - `p1` - **FROM** answering **TO** done **WHEN** a validated answer or cited not-found result is persisted - `inst-turn-done`
4. [ ] - `p1` - **FROM** retrieving **TO** failed **WHEN** retrieval fails; also from answering on runtime, citation or persistence failure - `inst-turn-failed`
5. [ ] - `p1` - **FROM** accepted **TO** cancelled **WHEN** Stop, thread deletion, unsubscribe or shutdown cancels work; also from retrieving or answering - `inst-turn-cancelled`

### Retrieval index readiness

- [ ] `p4` - **ID**: `cpt-noter-state-core-retrieval-ask-index`

**States**: hybrid, keyword_only

**Initial State**: keyword_only until indexes are ready

**Transitions**:
1. [ ] - `p1` - **FROM** hybrid **TO** keyword_only **WHEN** a rebuild starts or vector indexes become unavailable - `inst-index-rebuilding`
2. [ ] - `p1` - **FROM** keyword_only **TO** hybrid **WHEN** rebuilt indexes include all committed changes - `inst-index-ready`

## 5. Definitions of Done

### One retrieval function

- [ ] `p4` - **ID**: `cpt-noter-dod-core-retrieval-ask-search`

The system **MUST** use the same privacy-filtered hybrid function for search, Ask and later context consumers, with normalized keyword search, RRF k = 60, item preference, evidence strength, section limits and keyword-only rebuild progress. Queries use the read pool; bounded rebuild writes use the single writer.

**Implements**:
- `cpt-noter-flow-core-retrieval-ask-search`
- `cpt-noter-algo-core-retrieval-ask-retrieve`
- `cpt-noter-algo-core-retrieval-ask-rebuild`
- `cpt-noter-state-core-retrieval-ask-index`

**Touches**:
- API: `search`
- DB: call, item and document FTS/vector indexes, canonical `chunks`
- Entities: `SearchResults`, `SearchHit`, `SearchExplain`

### Cited and cancellable Ask

- [ ] `p4` - **ID**: `cpt-noter-dod-core-retrieval-ask-answers`

The system **MUST** return handles before Channel messages, enforce the 60 s task timeout, stream through the acknowledged stream hub, persist threads and validated answers, and cancel runtime work on Stop. Uncited answers are not found; old deleted citations remain marked as deleted. No source text goes to logs or bypasses the gate. Channel lag follows the shared 2,000-message rule.

**Implements**:
- `cpt-noter-flow-core-retrieval-ask-answer`
- `cpt-noter-flow-core-retrieval-ask-threads`
- `cpt-noter-algo-core-retrieval-ask-citations`
- `cpt-noter-state-core-retrieval-ask-turn`

**Touches**:
- API: all seven `ask_*` commands, `AskMsg`
- DB: `ask_threads`, `ask_turns`, `changes`, `llm_runs`
- Entities: `AskAnswer`, `Citation`, `AskThread`

### Topics and undoable edits

- [ ] `p4` - **ID**: `cpt-noter-dod-core-retrieval-ask-topics`

The system **MUST** attach and name topics by the PRD thresholds, expose their threads, guard rename revisions, merge as one undoable batch with source aliases retained, and persist Keep Separate. Failed writes publish no entity event; undo restores links and aliases through the M2 history service.

**Implements**:
- `cpt-noter-flow-core-retrieval-ask-topics`
- `cpt-noter-algo-core-retrieval-ask-attach-topic`

**Touches**:
- API: `topics_list`, `topic_get`, `topic_rename`, `topics_merge`, `topics_keep_separate`, `entity:changed`
- DB: `topics`, `topic_aliases`, `items`, `suppressions`, `changes`
- Entities: `TopicRow`, `TopicThread`, `TopicMutation`

### Retrieval evaluation and harness

- [ ] `p4` - **ID**: `cpt-noter-dod-core-retrieval-ask-evaluation`

The system **MUST** evaluate the 50-question golden-call set and 20-document question set, recording recall@5, citation correctness and latency, with citation correctness at least 85 %. Implement `retrieval_search` and `retrieval_rebuild` scenarios for a year of fixture calls and EN/RU/DE queries under the harness's instruction-count comparison. Test through the real core with a scripted runtime and engine.

**Implements**:
- `cpt-noter-algo-core-retrieval-ask-retrieve`
- `cpt-noter-algo-core-retrieval-ask-citations`
- `cpt-noter-algo-core-retrieval-ask-rebuild`

**Touches**:
- Entities: retrieval evaluation results, performance scenarios

## 6. Acceptance Criteria

- [ ] E2E against the real core, `cpt-noter-seq-library-search-calls`: mixed Russian and English finds cited spans; keyword-only rebuild, no hits and weak-only hits carry distinct metadata.
- [ ] E2E against the real core, `cpt-noter-seq-library-filter-calls`: people and open-item filters combine with type and tags; clearing filters restores rows; M2 export writes the selection.
- [ ] E2E against the real core, `cpt-noter-seq-library-follow-topic`: thread groups open the cited call; rename propagates; merge is undoable; Keep Separate survives restart.
- [ ] E2E against the real core, `cpt-noter-seq-ask-cited-answer`: cited answers open evidence; unknown citations fail validation; no citations yields `found: false`; cloud excludes sensitive sources while local can cite them.
- [ ] E2E against the real core, `cpt-noter-seq-ask-follow-up-and-copy`: reopen, append a follow-up and copy Markdown with citations; deleting a source marks old citations deleted.
- [ ] Stop, timeout, lag and thread deletion release work and subscriptions; late output cannot recreate deleted rows or emit a second terminal result.
- [ ] Each of the twelve frozen commands succeeds at least once in real-core E2E runs; stale renames and failed merge transactions change nothing.
- [ ] Both retrieval performance scenarios and citation evaluations pass; `just gate-fast` and `just gate` pass.
