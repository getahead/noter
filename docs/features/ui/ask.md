---
title: "Feature — Ask"
description: "Question threads with streamed cited answers, readable scope presets, follow-ups, playback and copy with citations."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-ask
milestone: M3
---

# Feature: Ask

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Ask a question and inspect its citations](#ask-a-question-and-inspect-its-citations)
  - [Stop, follow up, copy and manage threads](#stop-follow-up-copy-and-manage-threads)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Consume one answer stream](#consume-one-answer-stream)
  - [Copy one cited turn](#copy-one-cited-turn)
- [4. States (CDSL)](#4-states-cdsl)
  - [Answer turn](#answer-turn)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Threads, composer and stream](#threads-composer-and-stream)
  - [Cited answer and copy](#cited-answer-and-copy)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [x] `p4` - **ID**: `cpt-noter-featstatus-ui-ask`

## 1. Feature Context

- [x] `p4` - `cpt-noter-feature-ui-ask`

### 1.1 Overview

Ask holds recent question threads and one conversation about calls and documents. Answers stream from the core, cite their evidence, keep each quote's language and say when nothing was found.

### 1.2 Purpose

Implement AK-R1 to AK-R5 and the cited answer, including scope, follow-ups, stopped answers, weak evidence and source deletion.

**Requirements**: PRD › Search and cross-meeting memory › Ask mode; Feature specification › 5. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-evidence-one-click`.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Asks, checks, stops, reopens and copies answers |
| Noter core (system) | Selects permitted sources and runtime, streams answers and resolved citations |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Search and cross-meeting memory; LLM orchestration
- **Design**: [DESIGN.md](../../DESIGN.md) › Screen — Ask; Component — Cited answer
- **Design elements**: `cpt-noter-component-screen-ask`, `cpt-noter-component-ui-cited-answer`; uses mode indicator, provenance, person and language chips and playback
- **Stories (M3)**: `cpt-noter-seq-ask-cited-answer`, `cpt-noter-seq-ask-follow-up-and-copy`
- **Frozen commands delivered (M3)**: `ask_start` (Channel `AskMsg`), `ask_stop`, `ask_threads_list`, `ask_thread_get`, `ask_thread_delete`, `ask_scope_presets`, `ask_rate`
- **Earlier commands reused**: `transcript_span`, `audio_play`, `audio_stop`, `open_external`, bridge `stream_ack` and `stream_unsubscribe`
- **Events**: the Ask Channel; `playback:state`, `entity:changed`, `privacy:changed`, `accounts:changed`
- **Data**: core-owned `cpt-noter-dbtable-ask-threads`; no UI tables
- **Prototype modules**: `src/js/40-d-4-ask.js` (`screen('ask')`), `40-d-2-components.js` (`C.citedAnswer`), `src/css/40-d.css` (`.ak-*`)
- **Contract and test reference**: `apps/desktop/src/core/bindings.ts` and `apps/desktop/src/core/fake/` (read-only); [HARNESS.md](../../HARNESS.md); [DECOMPOSITION.md](../../DECOMPOSITION.md)
- **Dependencies**: `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-live-transcript`

## 2. Actor Flows (CDSL)

### Ask a question and inspect its citations

- [x] `p1` - **ID**: `cpt-noter-flow-ui-ask-question`

**Actor**: Primary user

**Success Scenarios**:
- ⌘N, question, streaming answer, citation focus, playback and Call page at 00:41:10
- Library arrivals submit a new thread once; topic arrivals select the matching topic scope

**Error Scenarios**:
- No evidence: **I could not find this in your calls.** with **Search by Keyword** and applicable **Widen Scope**
- Runtime unreachable: **Couldn't reach Claude Code**, **Try Again**, **Answer with Local Model**
- Sensitive sources skipped, index rebuilding and weak evidence remain visible with their explanation and applicable actions

**Steps**:
1. [x] - `p1` - User opens Ask with ⌘2 or **New Question** with ⌘N; API: `ask_threads_list` and `ask_scope_presets` - `inst-open`
2. [x] - `p1` - UI: recent questions grouped by date; before the first question show **Your questions appear here**, the first composer and three recent-person/topic suggestions when available - `inst-first`
3. [x] - `p1` - User chooses a readable scope and enters a nonblank question; Return sends, ⇧Return inserts a line; IME composition does not submit - `inst-compose`
4. [x] - `p1` - API: `ask_start` with no thread id, question and chosen scope; keep the returned thread, turn and subscription ids - `inst-start`
5. [x] - `p1` - Algorithm: consume `AskMsg` through `cpt-noter-algo-ui-ask-stream`; title reads **Answering…** and **Stop** replaces Ask - `inst-stream`
6. [x] - `p1` - **IF** the completed answer was not found or has no citations - `inst-if-not-found`
   1. [x] - `p1` - UI: the not-found sentence and search/widen actions; no speculative answer, citation list or thumbs - `inst-not-found`
7. [x] - `p1` - **ELSE** render the answer, numbered citations and available meta information, then announce **Answer ready, 6 citations** once - `inst-ready`
8. [x] - `p1` - User hovers or focuses a superscript; UI highlights it and its row; Return moves focus to the row and ⇧Tab returns to the originating superscript - `inst-citation-focus`
9. [x] - `p1` - User presses Space or ▶ on a call citation; shared playback plays its span in AK-R5, or explains unavailable audio - `inst-play`
10. [x] - `p1` - User opens its title; UI pushes Call page › Transcript at the span with the 3 s highlight; document targets open through `open_external` - `inst-evidence`
11. [x] - `p1` - **IF** the user chooses **Search by Keyword** - `inst-if-search`
    1. [x] - `p1` - UI: Library search with this turn's exact question - `inst-search`
12. [x] - `p1` - **IF** the user chooses **Widen Scope** with a narrowed scope - `inst-if-widen`
    1. [x] - `p1` - UI: set **All calls · all sources** and ask the same question again (from the selected turn's recorded `AskAnswer.scope`, including reopened threads) - `inst-widen`
13. [x] - `p1` - **RETURN** the thread; local retry actions are constrained by the contract gap below - `inst-return-question`

### Stop, follow up, copy and manage threads

- [x] `p1` - **ID**: `cpt-noter-flow-ui-ask-follow-up-copy`

**Actor**: Primary user

**Success Scenarios**:
- Reopen a recent thread, ask a follow-up under the first answer and copy Markdown with call names and dates
- Stop keeps received text and resolved citations with **Stopped by you ·**

**Error Scenarios**:
- Deleted citation: **Source deleted**, no active link or play, **Ask Again**
- Clipboard denied: keep the answer and show a copy error; never show Copied before clipboard success
- Thread deleted elsewhere: return to the empty composer and refresh recent questions

**Steps**:
1. [x] - `p1` - User selects a recent question; API: `ask_thread_get` with thread id; UI renders its turns in order - `inst-get-thread`
2. [x] - `p1` - User sends **Who owns the acceptance criteria for the reconnect?** in **Ask a follow-up…** - `inst-follow-up`
3. [x] - `p1` - API: `ask_start` with this thread id, question and next-question scope; append the turn with its own citation numbering - `inst-start-follow-up`
4. [x] - `p1` - **IF** the user presses Stop or ⌘. while answering - `inst-if-stop`
   1. [x] - `p1` - API: `ask_stop` with the active turn id; keep text so far and resolved citations, remove unresolved superscripts and label the result **Stopped by you ·** - `inst-stop`
5. [x] - `p1` - User chooses **Copy with Citations** on a completed or stopped cited answer - `inst-copy`
6. [x] - `p1` - Algorithm: serialize that turn with `cpt-noter-algo-ui-ask-copy`; write to the clipboard; after success show and politely announce **Copied** for 2 s - `inst-clipboard`
7. [x] - `p1` - **IF** a cited source has been deleted - `inst-if-deleted`
   1. [x] - `p1` - UI: keep its number and focus destination, mark **Source deleted**, disable opening/play and offer **Ask Again** - `inst-deleted`
   2. [x] - `p1` - User chooses **Ask Again**; API: `ask_start` with the same question and scope, letting the core retrieve only surviving sources - `inst-again`
8. [x] - `p1` - User chooses **Copy Question** or **Delete** in a recent row's menu; copy its title or call `ask_thread_delete` with its id - `inst-manage`
9. [x] - `p1` - UI: remove a thread only after success, refresh `ask_threads_list`, and clear the active route if it was deleted; failure keeps the row with an explicit retry - `inst-deleted-thread`
10. [x] - `p1` - **RETURN** the selected thread or an empty new question - `inst-return-follow-up`

## 3. Processes / Business Logic (CDSL)

### Consume one answer stream

- [x] `p1` - **ID**: `cpt-noter-algo-ui-ask-stream`

**Input**: active `AskHandle`, ordered `AskMsg` events and the current partial turn

**Output**: growing text, resolved citations, final answer or a named failure

**Steps**:
1. [x] - `p1` - Use bridge buffering, sequencing and acknowledgements; accept only this subscription and turn; ignore late results after disposal - `inst-scope`
2. [x] - `p1` - **MATCH** the event - `inst-match`
   - [x] - `p1` - **CASE** started: show returned runtime and effective mode; never infer cloud/local from a label - `inst-started`
   - [x] - `p1` - **CASE** delta: append escaped text in the bridge's buffered render cadence; do not announce each word - `inst-delta`
   - [x] - `p1` - **CASE** citation: resolve its stable number and quote; never renumber earlier references - `inst-citation`
   - [x] - `p1` - **CASE** done: replace the partial with authoritative `AskAnswer`; update history and render skipped-source, keyword-only and weak-evidence flags - `inst-done`
   - [x] - `p1` - **CASE** failed with `answer_stopped`: retain the stopped partial and clear busy state - `inst-stopped`
   - [x] - `p1` - **CASE** other failed: show the typed runtime error with explicit retry; preserve the question - `inst-failed`
   - [x] - `p1` - **CASE** ended: release the subscription; an end before done or a user stop shows interrupted-answer recovery, not an invented success - `inst-ended`
3. [x] - `p1` - Render Markdown without raw HTML; citation links use typed targets and never model-provided executable markup - `inst-safe-render`
4. [x] - `p1` - On a sequence gap, stop applying deltas, use bridge recovery and reload the stored thread; do not automatically start a second billable answer - `inst-gap`
5. [x] - `p1` - On route disposal detach the listener and unsubscribe; explicit Stop cancels generation; a sheet or component unmount must not attach the stream to another thread - `inst-dispose`
6. [x] - `p1` - **RETURN** the current turn state - `inst-return`

### Copy one cited turn

- [x] `p1` - **ID**: `cpt-noter-algo-ui-ask-copy`

**Input**: a completed or stopped turn and its resolved citations

**Output**: Markdown suitable for a status update

**Steps**:
1. [x] - `p1` - Keep the answer's paragraphs and reference numbers; exclude UI controls and status spinners - `inst-answer`
2. [x] - `p1` - Append citations in first-use order with number, call name, locale date and time, or document title, section, source and freshness - `inst-citations`
3. [x] - `p1` - Preserve original quotes, **Weak match**, **suggested, not reviewed**, and **Source deleted** where present; do not invent links to deleted sources - `inst-qualifiers`
4. [x] - `p1` - **RETURN** the selected turn only, with no other question history or hidden credentials - `inst-return`

## 4. States (CDSL)

### Answer turn

- [x] `p1` - **ID**: `cpt-noter-state-ui-ask-turn`

**States**: FIRST, STARTING, STREAMING, READY, NOT_FOUND, WEAK, ERROR, STOPPING, STOPPED, SOURCE_DELETED, COPIED

**Initial State**: FIRST

**Transitions**:
1. [x] - `p1` - **FROM** FIRST **TO** STARTING **WHEN** a nonblank question is submitted - `inst-submit`
2. [x] - `p1` - **FROM** STARTING **TO** STREAMING **WHEN** the handle and started event arrive - `inst-started`
3. [x] - `p1` - **FROM** STREAMING **TO** READY **WHEN** done has supported citations - `inst-done`
4. [x] - `p1` - **FROM** STREAMING **TO** NOT_FOUND **WHEN** done says not found or has no citations - `inst-not-found`
5. [x] - `p1` - **FROM** STREAMING **TO** WEAK **WHEN** done reports only weak evidence - `inst-weak`
6. [x] - `p1` - **FROM** STARTING **TO** ERROR **WHEN** start fails; a failed stream also enters ERROR - `inst-error`
7. [x] - `p1` - **FROM** STREAMING **TO** STOPPING **WHEN** Stop is requested; a confirmed user stop enters STOPPED - `inst-stop`
8. [x] - `p1` - **FROM** ERROR **TO** STARTING **WHEN** the user retries; no automatic retry - `inst-retry`
9. [x] - `p1` - **FROM** READY **TO** SOURCE_DELETED **WHEN** a citation's source is removed - `inst-deleted`
10. [x] - `p1` - **FROM** READY **TO** COPIED **WHEN** clipboard write succeeds; after 2 s restore READY; weak and stopped answers restore their own prior state - `inst-copy`
11. [x] - `p1` - **FROM** SOURCE_DELETED **TO** STARTING **WHEN** Ask Again is chosen - `inst-again`

## 5. Definitions of Done

### Threads, composer and stream

- [x] `p4` - **ID**: `cpt-noter-dod-ui-ask-threads`

The system **MUST** provide first question, scope presets, history, follow-ups, Stop and explicit recovery using the frozen Ask commands, preserve the runtime and privacy mode sent by the core, and keep late events out of other threads.

**Implements**:
- `cpt-noter-flow-ui-ask-question`
- `cpt-noter-flow-ui-ask-follow-up-copy`
- `cpt-noter-algo-ui-ask-stream`
- `cpt-noter-state-ui-ask-turn`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: all six M3 Ask commands; bridge stream lifecycle
- Tests: unit tests for out-of-order responses, partial stop, no-citation guard and IME; conformance for handle-before-events, sequence gaps, follow-ups, stop and thread deletion; E2E both Ask stories against the real core, including first question, not found and errors

### Cited answer and copy

- [x] `p4` - **ID**: `cpt-noter-dod-ui-ask-citations`

The system **MUST** render the cited-answer variants with original-language quotes, stable superscripts, safe Markdown, weakness and suggested-item qualifiers, evidence navigation, playback and successful clipboard feedback. Contract gaps below remain visible in delivery review. `just gate` passes.

**Implements**:
- `cpt-noter-algo-ui-ask-copy`
- `cpt-noter-flow-ui-ask-question`
- `cpt-noter-flow-ui-ask-follow-up-copy`

**Constraints**: `cpt-noter-constraint-three-languages`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `transcript_span`, `audio_play`, `audio_stop`, `open_external`
- Tests: unit tests for superscript focus return, Markdown escaping and clipboard failure; E2E `cpt-noter-seq-ask-cited-answer`, `cpt-noter-seq-ask-follow-up-and-copy`, including deleted sources and copy; screenshots of every Ask prototype state

**Completion gate**: `just gate` passes.

## 6. Acceptance Criteria

**Contract batch regression requirements (2026-11-20; pending).** Contract 2.18 (#981–#982, #984): stored-turn Widen Scope and Ask Again use that turn's returned nullable scope; unknown historical scope is not inferred from the thread's later scope. Quotes set lang only from returned Citation.lang. Optional answer meta presents actual call/item/document evidence counts and elapsed time; absent historical measurements remain omitted. Helpful / Not helpful toggle or clear `ask_rate`, show only acknowledged feedback, disable while saving, and retain prior state with a recoverable error on failure. Unit, conformance and real-core `cpt-noter-seq-ask-cited-answer` and `cpt-noter-seq-ask-follow-up-and-copy` prove these paths; new criteria remain open until `just gate` passes.

- [x] `default`, `first`, `answering`, `not-found`, `unreachable`, `local`, `sensitive`, `keyword-only`, `weak`, `deleted`, stopped and copied states match the prototype's structure and tokens (QA could not reach the local, sensitive, keyword-only and weak states on the real core, so those are unverified)
- [x] A follow-up uses the same core thread id; citation numbers restart per answer and never change during a turn
- [x] Copy writes only the chosen answer and its citations; Copied lasts 2 s after success
- [x] At Wide the recent pane is 260 pt and thread at most 860 pt; Medium/Narrow use Recent in the toolbar, with scope overflowing before the mode indicator (QA verified the Medium and Narrow layout and the focus items on the real core; the citation speaker chip was not verifiable by hand, because no citation QA got carried a speaker, and is covered by the real-core E2E in `m3-ask-ui.spec.ts`, which cites `seg_live_005`, Dmitri Sokolov)
- [x] Streaming is silent to VoiceOver; completion is announced once, with weakness included; quotes carry their own language (the weak-variant announcement and quotes in their own language could not be produced on the real core, so those parts are unverified)

## 7. Additional Context

**Prototype reuse.** Rewrite `screen('ask')` from `40-d-4-ask.js` as AskPage, RecentQuestions, AskComposer and AskThread; `C.citedAnswer` in `40-d-2-components.js` becomes CitedAnswer and CitationRow. Port `.ak-*` from `40-d.css` as-is with component, primitive, variant, size, state and region attributes. The runtime, sample answers, regex answer picker and simulated timers are source of truth only. Never generate answers in the WebView.

**DESIGN versus prototype.** DESIGN enables each citation when resolved; the prototype gates all superscripts until the answer ends. Follow the prototype's disabled-during-stream layout. The prototype's sensitive demo can show both a two-source info line and a one-source not-found note; render the single authoritative core count rather than duplicate fixture messages. DESIGN's responsive Recent pop-up and scope overflow have no corresponding implementation in these modules; apply DESIGN for these missing behaviours. The prototype's Copy handler suppresses clipboard failures; production reports them.

**Contract and fake gaps.** `AskStartArgs` has no per-answer runtime override. **Answer with Local Model** and **Use Local Model** cannot silently select a local runtime through this command; task runtime settings can change through Settings, but that is not an equivalent per-answer override. `AskAnswer.meta` reports actual retrieved evidence counts and measured elapsed time; it does not report external lookup counts or detailed search/read progress or rebuild percentage. Ratings persist through `ask_rate`; absent measurements on older answers are not fabricated. Citation contains number, provenance, quote, nullable source language, speaker, strength and deleted flag, but no audio availability or suggested-item flag. Use the shared transcript span/record data where available; document freshness is not present in document provenance, while live lookup provenance carries its time. Missing detail is not inferred. The default fake emits a simple cited answer and marks a stop as `failed` with `answer_stopped`; scenario overrides cover weak, not-found, skipped-source and interruption states. These gaps block the corresponding full story paths until the contract owner resolves them.

**Historical delivery (18 Nov 2026; the scope, language, metadata and rating gaps below are addressed by the pending contract 2.18 criteria above).** Recorded gaps at that time: **Widen Scope** is not offered on a reloaded narrowed turn, because `AskAnswer.scope` is not read back (`inst-widen`); the meta line counts and the stored thumbs rating (contract gaps above); and a not-found answer on the default fake, which never produces one (scenario overrides do). QA could not reach these states on the real core: local and sensitive (the settings change was accepted but the mode indicator did not follow), keyword-only and weak (the harness cannot set the index states). Quotes carry no `lang` attribute, because the contract's `Citation` has no language field, so a quote in its own language is unverified. Every other flow, algorithm, state and DoD is delivered and marked.

**Not applicable.** Retrieval, source permissions, model prompts, account authentication, persistence, database queries, service deployment and billable retry policy belong to the core. The UI retains only current view state and clears listeners on disposal; safe error logging never includes questions or quotes.
