---
title: "Feature — Live and stored transcript"
description: "The virtualised transcript log of a call: confirmed and hypothesis rows with speaker, time and language, gap and mark rows, Jump to Live, the waiting state, and safe replay of a line on headphones during the call and on any output afterwards."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-live-transcript
milestone: M1
---

# Feature: Live and stored transcript


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Follow the live transcript](#follow-the-live-transcript)
  - [Reread or replay a line during the call](#reread-or-replay-a-line-during-the-call)
  - [Read a stored transcript](#read-a-stored-transcript)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Follow output](#follow-output)
  - [Decide the play control](#decide-the-play-control)
- [4. States (CDSL)](#4-states-cdsl)
  - [Transcript view](#transcript-view)
  - [Playback bar](#playback-bar)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Transcript view and rows](#transcript-view-and-rows)
  - [Speaker label and language tag (display)](#speaker-label-and-language-tag-display)
  - [Safe replay](#safe-replay)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p2` - **ID**: `cpt-noter-featstatus-ui-live-transcript`

## 1. Feature Context

- [ ] `p2` - `cpt-noter-feature-ui-live-transcript`

### 1.1 Overview

The transcript view renders a call's segments as a log: confirmed rows in time order that never move, one hypothesis row last, gap rows for time lost, mark rows for marked moments. It follows live speech while the user is at the end, stops following when the user scrolls up and offers **Jump to Live · 12 new lines**, and stays fast for a three-hour call by drawing only the rows on screen. Each row carries speaker, time and language; its play control replays the line where that is safe. The same components draw the live log in the call screen, the tail in the floating panel and the stored transcript on a call's page.

### 1.2 Purpose

It implements `cpt-noter-component-ui-transcript-view`, `cpt-noter-component-ui-transcript-segment-row`, `cpt-noter-component-ui-speaker-label` (display; the rename popover is M2), `cpt-noter-component-ui-language-tag` and `cpt-noter-component-ui-playback-bar`.

**Requirements**: PRD › Feature specification › 2. Live transcript; PRD › Success metrics › Live (hypothesis within 2 s, confirmed within 4 s of speech); PRD › Success metrics › Footprint. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-core-owns-state`, `cpt-noter-principle-accessible-multilingual`, `cpt-noter-principle-quiet-surface`

Success criteria: a 90-minute recorded stream replayed into the view adds no lag beyond the 100 ms flush; scrolling a three-hour transcript stays smooth; a line never replays into a call on speakers.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Reads, scrolls, jumps to live, replays a line, copies a line |
| Noter core (system) | Streams segments, gaps and marks in order; reports the output route; plays audio natively and reports playback position |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 2. Live transcript
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Component — Transcript view; Transcript segment row; Speaker label; Language tag; Playback bar; Screen — Call screen (CS-R2, CS-R2b); Screen — Floating panel (FP-R5)
- **Design elements**: `cpt-noter-component-ui-transcript-view`, `cpt-noter-component-ui-transcript-segment-row`, `cpt-noter-component-ui-speaker-label`, `cpt-noter-component-ui-language-tag`, `cpt-noter-component-ui-playback-bar`
- **Stories**: `cpt-noter-seq-call-screen-replay-line` (M1); the transcript states of `cpt-noter-seq-call-screen-recover-capture` (owned by `cpt-noter-feature-ui-call-window`)
- **Frozen commands it calls**: `transcript_subscribe` (Channel `TranscriptMsg`), `levels_subscribe` (Channel `LevelsMsg`), `transcript_span`, `audio_play`, `audio_stop`
- **Events**: `playback:state`, `capture:state` (`output_route`, `replay_available`, `audio_not_stored`)
- **Prototype modules**: `src/js/20-b-components.js` (`C.transcriptView`, `C.segmentRow`, `C.playbackBar`, `routeHelp`), `src/js/04-shared.js` (`C.speakerLabel`, `C.languageTag`), `src/css/20-b.css` (`.cw-tr*`, `.cw-seg*`, `.np-play*`)
- **Dependencies**: `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-primitives`

## 2. Actor Flows (CDSL)

### Follow the live transcript

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-live-transcript-follow`

**Actor**: Primary user

**Success Scenarios**:
- New confirmed rows appear at the end and the view stays at the end; the hypothesis row changes in place
- Before the first speech: **You** and **Others** meters with **Waiting for speech…**

**Error Scenarios**:
- The stream has a `seq` gap or ends with `lagged`: the bridge resubscribes; the rows shown stay put
- The call is deleted while open: the stream ends; the page shows its empty state

**Steps**:
1. [ ] - `p1` - UI: the host (call screen, floating panel, call page) mounts the view with the call id and variant (live, tail, stored) - `inst-mount`
2. [ ] - `p1` - API: `transcript_subscribe` (call id) with the snapshot-then-stream rule of the core bridge - `inst-api-subscribe`
3. [ ] - `p1` - **IF** the snapshot has no segment and the call is live - `inst-if-waiting`
   1. [ ] - `p1` - API: `levels_subscribe`; UI: the waiting state with the two meters and **Waiting for speech…** (also right after **Start as New Call**) - `inst-waiting`
4. [ ] - `p1` - Store: every 100 ms the buffered messages flush: confirmed appended, hypothesis replaced, gaps and marks inserted, updated segments and speakers replaced by identity - `inst-flush`
5. [ ] - `p1` - Algorithm: keep or release the end with `cpt-noter-algo-ui-live-transcript-follow-output` - `inst-follow`
6. [ ] - `p1` - UI: render only the rows in view (virtualised), each with its language attribute; the hypothesis row in the secondary colour with the trailing … glyph, no time, no tag, no actions, hidden from VoiceOver until confirmed - `inst-render-rows`
7. [ ] - `p1` - **RETURN** the log following live speech - `inst-return-follow`

### Reread or replay a line during the call

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-live-transcript-replay-line`

**Actor**: Primary user

**Success Scenarios**:
- Happy path of `cpt-noter-seq-call-screen-replay-line`: scroll up, the view stops following and shows **Jump to Live**; the play control on Anna K.'s line with **Play this line**; the playback bar with **Replaying while recording · headphones**; **Jump to Live** follows again

**Error Scenarios**:
- Error — Recording on speakers: the play control is shown disabled with **Replay is off while recording on speakers: the call would hear it. Use headphones, or replay after the call.**
- Error — Output switches to speakers: playback stops at once, **Replay stopped: output switched to speakers** for 3 s, the play controls are disabled with their reason
- Error — Output not identified: disabled with **Noter can't tell whether this output is headphones. Mark it as headphones in Settings › Audio & Transcription to replay while recording.**
- Error — Noter's own sounds not excluded: disabled with **Replay would be recorded. Turn on Exclude Noter's own sounds in Settings › Audio & Transcription.**

**Steps**:
1. [ ] - `p1` - User scrolls up more than one row - `inst-user-scroll`
2. [ ] - `p1` - UI: the view detaches and shows the pill **Jump to Live · N new lines**, counted with plural rules - `inst-detach`
3. [ ] - `p1` - User hovers or focuses a line - `inst-user-hover`
4. [ ] - `p1` - Algorithm: decide the play control with `cpt-noter-algo-ui-live-transcript-play-control` - `inst-play-control`
5. [ ] - `p1` - **IF** the control is enabled and the user clicks it or presses Space - `inst-if-play`
   1. [ ] - `p1` - API: `audio_play` (call id, span); the core plays it natively (no media in the WebView) - `inst-api-play`
   2. [ ] - `p1` - UI: the playback bar opens (CS-R2b, 40 pt; in the floating panel it takes the tail's place) with the live-headphones line; it follows `playback:state` - `inst-bar`
   3. [ ] - `p1` - **IF** the result is `replay_needs_headphones`, `output_route_unknown` or `own_sounds_not_excluded`: the control shows its disabled reason as an inline status - `inst-play-refused`
6. [ ] - `p1` - **IF** the core reports the route switched to speakers while playing - `inst-if-route`
   1. [ ] - `p1` - UI: the bar shows **Replay stopped: output switched to speakers** for 3 s, then closes; the controls return to disabled - `inst-route-stop`
7. [ ] - `p1` - **IF** the user clicks ×, presses Esc on the bar, or plays another line - `inst-if-stop`
   1. [ ] - `p1` - API: `audio_stop` - `inst-api-stop`
8. [ ] - `p1` - User clicks **Jump to Live** or presses ⌘J while the panel is key - `inst-jump`
9. [ ] - `p1` - **RETURN** the view following again, the recording untouched - `inst-return-replay`

### Read a stored transcript

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-live-transcript-stored`

**Actor**: Primary user

**Success Scenarios**:
- On a call's page the transcript shows every row with a play control on any output, a find bar (⌘F) with **3 of 120 lines**, and the header line about the audio
- An evidence link opens the row highlighted for 3 s with focus on its first line

**Error Scenarios**:
- Loading longer than 300 ms: skeleton rows
- The read fails: the page's inline banner with **Try Again** in the view body
- Audio deleted or never stored: no play controls; the header reads **Audio deleted on 15 Nov (kept 30 days) · transcript kept** or **Audio not stored for this call**

**Steps**:
1. [ ] - `p1` - UI: the call page mounts the stored variant (at most 960 pt wide) - `inst-mount-stored`
2. [ ] - `p1` - API: `transcript_subscribe` (call id; the snapshot is the whole transcript) - `inst-api-stored`
3. [ ] - `p1` - **IF** a span to show was given (evidence, search result) - `inst-if-span`
   1. [ ] - `p1` - API: `transcript_span` when the span's rows are not loaded; scroll to it and apply the evidence highlight for 3 s (static under Reduce motion) - `inst-span`
4. [ ] - `p1` - User presses ⌘F and types - `inst-user-find`
5. [ ] - `p1` - UI: matches in the match highlight, the current one with a focus ring; Return and ⇧Return move - `inst-find`
6. [ ] - `p1` - **RETURN** the stored transcript - `inst-return-stored`

## 3. Processes / Business Logic (CDSL)

### Follow output

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-live-transcript-follow-output`

**Input**: the scroll position, the number of rows added since the last flush, the user's last scroll action

**Output**: following or detached with a count

**Steps**:
1. [ ] - `p1` - **IF** the view is at the end (within one row) - `inst-if-end`
   1. [ ] - `p1` - Keep the end in view after the flush (smooth scroll; a jump under Reduce motion) - `inst-keep-end`
   2. [ ] - `p1` - **RETURN** following - `inst-return-following`
2. [ ] - `p1` - Add the new confirmed rows to the pill's count - `inst-count`
3. [ ] - `p1` - Never move the rows in view: confirmed rows keep their position - `inst-no-jump`
4. [ ] - `p1` - **RETURN** detached with the count - `inst-return-detached`

### Decide the play control

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-live-transcript-play-control`

**Input**: the row (hypothesis or confirmed, whether audio exists for its moment), capture state (recording, `output_route`, `replay_available`, `audio_not_stored`), the call's audio retention

**Output**: hidden, enabled, or disabled with a help tag

**Steps**:
1. [ ] - `p1` - **IF** the row is the hypothesis: **RETURN** hidden - `inst-hypothesis`
2. [ ] - `p1` - **IF** the audio is deleted or never stored: **RETURN** hidden; the time's help tag carries the reason - `inst-no-audio`
3. [ ] - `p1` - **IF** no audio exists for this moment (system audio lost): **RETURN** disabled with **No audio for this moment (system audio was lost)** - `inst-gap-audio`
4. [ ] - `p1` - **IF** the call is not being recorded: **RETURN** enabled with **Play this line** - `inst-after-call`
5. [ ] - `p1` - **MATCH** the output route during capture - `inst-match-route`
   - [ ] - `p1` - **CASE** headphones and `replay_available`: enabled with **Play this line** - `inst-case-headphones`
   - [ ] - `p1` - **CASE** headphones but own sounds not excluded: disabled with **Replay would be recorded. Turn on Exclude Noter's own sounds in Settings › Audio & Transcription.** - `inst-case-own-sounds`
   - [ ] - `p1` - **CASE** speakers: disabled with **Replay is off while recording on speakers: the call would hear it. Use headphones, or replay after the call.** - `inst-case-speakers`
   - [ ] - `p1` - **CASE** unknown: disabled with **Noter can't tell whether this output is headphones. Mark it as headphones in Settings › Audio & Transcription to replay while recording.** - `inst-case-unknown`
6. [ ] - `p1` - **RETURN** the control state; a disabled control stays focusable and Space posts its reason as an inline status - `inst-return-control`

## 4. States (CDSL)

### Transcript view

- [ ] `p1` - **ID**: `cpt-noter-state-ui-live-transcript-view`

**States**: LOADING, WAITING_FOR_SPEECH, FOLLOWING, DETACHED, FIND_ACTIVE, ERROR

**Initial State**: LOADING

**Transitions**:
1. [ ] - `p1` - **FROM** LOADING **TO** WAITING_FOR_SPEECH **WHEN** a live call has no segment yet - `inst-loading-waiting`
2. [ ] - `p1` - **FROM** LOADING **TO** FOLLOWING **WHEN** the snapshot has rows - `inst-loading-following`
3. [ ] - `p1` - **FROM** LOADING **TO** ERROR **WHEN** the stored transcript fails to load - `inst-loading-error`
4. [ ] - `p1` - **FROM** ERROR **TO** LOADING **WHEN** the user chooses **Try Again** - `inst-error-loading`
5. [ ] - `p1` - **FROM** WAITING_FOR_SPEECH **TO** FOLLOWING **WHEN** the first segment arrives - `inst-waiting-following`
6. [ ] - `p1` - **FROM** FOLLOWING **TO** DETACHED **WHEN** the user scrolls up more than one row - `inst-following-detached`
7. [ ] - `p1` - **FROM** DETACHED **TO** FOLLOWING **WHEN** the user chooses **Jump to Live**, presses ⌘J or scrolls back to the end - `inst-detached-following`
8. [ ] - `p1` - **FROM** FOLLOWING **TO** FIND_ACTIVE **WHEN** the user opens the find bar (stored variant) - `inst-following-find`
9. [ ] - `p1` - **FROM** FIND_ACTIVE **TO** FOLLOWING **WHEN** the user closes the find bar - `inst-find-following`
10. [ ] - `p1` - **FROM** FOLLOWING **TO** WAITING_FOR_SPEECH **WHEN** a new call starts in the same window after **Start as New Call** - `inst-following-waiting`

### Playback bar

- [ ] `p1` - **ID**: `cpt-noter-state-ui-live-transcript-playback`

**States**: CLOSED, LOADING, PLAYING, PAUSED, ENDED, STOPPED_BY_ROUTE

**Initial State**: CLOSED

**Transitions**:
1. [ ] - `p1` - **FROM** CLOSED **TO** LOADING **WHEN** the user plays a line - `inst-closed-loading`
2. [ ] - `p1` - **FROM** LOADING **TO** PLAYING **WHEN** the core reports playback started - `inst-loading-playing`
3. [ ] - `p1` - **FROM** PLAYING **TO** PAUSED **WHEN** the user pauses - `inst-playing-paused`
4. [ ] - `p1` - **FROM** PAUSED **TO** PLAYING **WHEN** the user plays again - `inst-paused-playing`
5. [ ] - `p1` - **FROM** PLAYING **TO** ENDED **WHEN** the span plus its context ends - `inst-playing-ended`
6. [ ] - `p1` - **FROM** PLAYING **TO** STOPPED_BY_ROUTE **WHEN** the output switches to speakers during capture - `inst-playing-route`
7. [ ] - `p1` - **FROM** STOPPED_BY_ROUTE **TO** CLOSED **WHEN** 3 s pass - `inst-route-closed`
8. [ ] - `p1` - **FROM** PLAYING **TO** CLOSED **WHEN** the user closes the bar - `inst-playing-closed`

## 5. Definitions of Done

### Transcript view and rows

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-live-transcript-view`

The system **MUST** render the transcript view in its live, tail and stored variants with the segment row's variants (confirmed, hypothesis, You and **Guest (your side)**, crosstalk, low confidence, tail), gap and mark rows, **Jump to Live**, the waiting state and the find bar, virtualised so that only visible rows are in the DOM, from the transcript Channel through the store's 100 ms flush, with the prototype's markup.

**Implements**:
- `cpt-noter-flow-ui-live-transcript-follow`
- `cpt-noter-flow-ui-live-transcript-stored`
- `cpt-noter-algo-ui-live-transcript-follow-output`
- `cpt-noter-state-ui-live-transcript-view`

**Constraints**: `cpt-noter-constraint-three-languages`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `transcript_subscribe`, `levels_subscribe`, `transcript_span`
- Tests: unit tests for append, replace and gap handling; a performance scenario that replays a 90-minute stream (`harness/perf.toml`); screenshot specs `detached` and the waiting state

### Speaker label and language tag (display)

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-live-transcript-labels`

The system **MUST** render the speaker label (resolved, unresolved **Speaker 2**, **Guest (your side)**, crosstalk **Anna K. / Speaker 3**, **You**) and the language tag (segment, call and filter-token variants; low confidence **RU?** with a dashed outline; VoiceOver reads the language name) as `C.speakerLabel` and `C.languageTag` do; the rename popover is added by `cpt-noter-feature-ui-speakers`.

**Implements**:
- `cpt-noter-flow-ui-live-transcript-follow`

**Constraints**: `cpt-noter-constraint-three-languages`

**Touches**:
- Tests: unit tests for labels and VoiceOver names

### Safe replay

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-live-transcript-replay`

The system **MUST** show each row's play control by the output-route table, play only through `audio_play` and `audio_stop`, stop and say so when the route switches to speakers, and provide the playback bar in its stored, search-and-ask and live-headphones variants.

**Implements**:
- `cpt-noter-flow-ui-live-transcript-replay-line`
- `cpt-noter-algo-ui-live-transcript-play-control`
- `cpt-noter-state-ui-live-transcript-playback`

**Constraints**: `cpt-noter-constraint-local-only-ui`

**Touches**:
- Commands: `audio_play`, `audio_stop`
- Events: `playback:state`, `capture:state`
- Tests: E2E `cpt-noter-seq-call-screen-replay-line` (every path) against `noter-core-harness` with the scripted engine's output routes; screenshot specs `replay`, `speakers`, `unknown-route`

## 6. Acceptance Criteria

- [ ] Confirmed rows never move or change after they are shown; only the hypothesis row changes
- [ ] The DOM holds only the rows in view plus a small overscan, for any call length
- [ ] No play control is enabled during capture unless the route is headphones and own sounds are excluded
- [ ] Transcript lines are never announced; the hypothesis row is hidden from VoiceOver
- [ ] Every row carries its own `lang` attribute

## 7. Additional Context

**Prototype reuse.** Rewritten in React with the same structure, classes, tokens and data attributes: `C.transcriptView`, `C.segmentRow` (with `routeHelp` for the disabled reasons) and `C.playbackBar` in `src/js/20-b-components.js`; `C.speakerLabel` and `C.languageTag` in `src/js/04-shared.js`. Styles `.cw-tr*`, `.cw-seg*` and `.np-play*` (`src/css/20-b.css`) are ported as-is. Production adds virtualisation, which the prototype does not need for its sample data; the row markup does not change. Not reusable: the sample segments of `03-data.js` and the prototype's output-route switch in the call window's bar.

**States coverage.** Following, Detached (`detached`), Waiting for speech (`nothing-heard`), Replaying on headphones (`replay`), Recording on speakers (`speakers`), Output not identified (`unknown-route`), Output switches to speakers and Noter's own sounds not excluded (strings in `C.playbackBar` and `routeHelp`), Loading and Error (stored, on the Call page). Find active and archive changes are part of the stored variant; archive diff marks arrive with `cpt-noter-feature-ui-call-page-outputs` (M2).

**Not applicable.** Media in the WebView: none; audio plays natively in the core (D6). Data: the view reads segments from the store only.
