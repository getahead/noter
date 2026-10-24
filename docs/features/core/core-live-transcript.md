---
title: "Feature: Live transcript, levels and replay"
description: "Persist every confirmed segment exactly once, stream hypotheses and confirmed lines to every window with snapshot then stream, serve levels and span previews, and replay a line through the engine only where it cannot leak into the call."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M1
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Live transcript, levels and replay

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Follow the transcript](#follow-the-transcript)
  - [Watch levels](#watch-levels)
  - [Preview a span](#preview-a-span)
  - [Replay a line](#replay-a-line)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Batch, persist and publish segments](#batch-persist-and-publish-segments)
  - [Live speakers](#live-speakers)
  - [Replay route rule](#replay-route-rule)
  - [Write the transcript file](#write-the-transcript-file)
- [4. States (CDSL)](#4-states-cdsl)
  - [Playback](#playback)
  - [Segment](#segment)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Exactly once, published after commit](#exactly-once-published-after-commit)
  - [Snapshot, then stream](#snapshot-then-stream)
  - [Span previews and the transcript file](#span-previews-and-the-transcript-file)
  - [Replay without leaking into the call](#replay-without-leaking-into-the-call)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p2` - **ID**: `cpt-noter-featstatus-core-live-transcript`

- [ ] `p2` - `cpt-noter-feature-core-live-transcript`

## 1. Feature Context

### 1.1 Overview

The transcript service in `noter-core` receives segments from the supervisor. Hypotheses go straight to the stream hub, never to the database. Confirmed segments get an id and a normalised shadow text for FTS, are written in batches of at most 250 ms, and are published only after their batch commits. Live speaker labels become `speakers` rows of pass `live`. The service answers `transcript_subscribe` (snapshot, then stream), `levels_subscribe`, `transcript_span` previews, and replay through the engine with the headphones-only rule during capture. At call end it writes `transcript.jsonl`. Renames, term fixes and naming are M2.

> **M1 decisions (Backend Teamlead, 21 Oct 2026).** The commit-then-publish crash test uses the hook `TranscriptService::fail_after_commit_once()` (`cfg(test)` or feature `testing`), not sleeps (TL-11). The session manager and the transcript service both subscribe to `EngineClient::events()`: the session owns the engine commands and the `EngineSession` state, the transcript owns `segment`, `speaker_turn` and `levels`; the session writes gap and mark rows and calls `publish_gap` and `publish_mark` on the transcript. Segments and live speakers are inserted with `insert_batch` and no change row (TL-1). Timers use tokio time (TL-4).

### 1.2 Purpose

The transcript is primary data: written exactly once, never lost on a reload, and never doubled. Replay must never send the call's own audio back into the meeting.

**Requirements**: PRD › Feature specification › 2. Live transcript; PRD › Success metrics › Live; owner decisions D6 (the engine plays replay audio) and Q2 (headphones only, 17 Oct).

**Principles**: `cpt-noter-principle-core-snapshot-stream`

**Delivers**:
- Frozen commands (M1): `transcript_subscribe`, `levels_subscribe`, `transcript_span`, `audio_play`, `audio_stop`.
- Events: `playback:state`.
- DESIGN.md story (M1): `cpt-noter-seq-call-screen-replay-line`.
- The transcript half of DESIGN-core `cpt-noter-seq-core-live-tick` (the tick half is M4) and the M1 performance scenario `stream-hub-fanout`.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Follows the live transcript, scrolls back, replays a line on headphones |
| UI window (call window, main) | Subscribes, acknowledges, previews spans, starts and stops replay |
| Engine supervisor | Delivers hypotheses, confirmed segments, speaker turns, levels; plays replay |
| Capture session | Owns the live call; ends streams on stop or discard |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-live-transcript`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-transcript`, `cpt-noter-seq-core-live-tick`, `cpt-noter-dbtable-segments`, `cpt-noter-dbtable-speakers`
- **Dependencies**: `cpt-noter-feature-core-capture-session`, `cpt-noter-feature-core-engine-capture`, `cpt-noter-feature-core-ipc-host`

## 2. Actor Flows (CDSL)

### Follow the transcript

- [ ] `p1` - **ID**: `cpt-noter-flow-core-live-transcript-subscribe`

**Actor**: UI window (call window or main)

**Success Scenarios**:
- For a live call: the snapshot holds every committed segment and the current hypotheses, then the Channel delivers `hypothesis`, `confirmed`, `gap` and `mark` messages in order.
- For a stopped call: the snapshot holds the whole transcript, `live: false`, and the Channel ends with `call_stopped` right away.
- After a reload the window subscribes again and shows the same lines, nothing lost or doubled.

**Error Scenarios**:
- Unknown call: `not_found`.
- The window falls behind: `ended { lagged }`; it subscribes again.

**Steps**:
1. [ ] - `p1` - API: `transcript_subscribe { call_id }` with a Channel from the call window or main window - `inst-subscribe-call`
2. [ ] - `p1` - **IF** the call does not exist **RETURN** `not_found` - `inst-if-unknown`
3. [ ] - `p1` - Stream hub runs `cpt-noter-algo-core-ipc-host-subscribe`; the snapshot is read through the writer connection: committed segments of the current pass, current hypotheses, speakers, gaps, marks - `inst-snapshot`
4. [ ] - `p1` - **RETURN** `TranscriptSnapshot { subscription_id, call_id, live, pass, archive, segments, hypotheses, last_seq }` - `inst-return-snapshot`
5. [ ] - `p1` - Deliver `TranscriptMsg` events as `cpt-noter-algo-core-live-transcript-batch` publishes them - `inst-deliver`
6. [ ] - `p1` - On stop or discard, end with `call_stopped` or `discarded` - `inst-end-stream`

### Watch levels

- [ ] `p2` - **ID**: `cpt-noter-flow-core-live-transcript-levels`

**Actor**: UI window (call window, main, Settings, First run)

**Success Scenarios**:
- During a call the window gets microphone and system levels at most every 100 ms.

**Error Scenarios**:
- No call and no self-test running: the subscription stays open with no messages until one starts or the window unsubscribes.

**Steps**:
1. [ ] - `p1` - API: `levels_subscribe { call_id? }` with a Channel - `inst-levels-call`
2. [ ] - `p1` - **RETURN** a `SubscriptionHandle` - `inst-levels-handle`
3. [ ] - `p1` - Forward engine `levels` as `LevelsMsg { seq, at_ms, mic_db, sys_db }`, coalesced to one per 100 ms per stream, before a `seq` is assigned - `inst-levels-forward`
4. [ ] - `p1` - End with `stream_unsubscribe` or a webview reload - `inst-levels-end`

### Preview a span

- [ ] `p2` - **ID**: `cpt-noter-flow-core-live-transcript-span`

**Actor**: UI window (evidence popover, span preview)

**Success Scenarios**:
- The lines of a time span come back with the call reference and whether audio is available.

**Error Scenarios**:
- The span's call is gone: `not_found`.
- The archive pass replaced the lines the span pointed to (from M2): `transcript_upgraded`, with `upgraded_by_archive` set on the preview when it can still be resolved.

**Steps**:
1. [ ] - `p1` - API: `transcript_span { span }` - `inst-span-call`
2. [ ] - `p1` - DB: SELECT `segments` of the call's current pass overlapping the span - `inst-span-select`
3. [ ] - `p1` - **RETURN** `SpanPreview { span, call, segments, audio_available, upgraded_by_archive }` - `inst-span-return`

### Replay a line

- [x] `p1` - **ID**: `cpt-noter-flow-core-live-transcript-replay`

**Actor**: Primary user (call window or Call page)

**Success Scenarios**:
- After a call, any line plays on any output.
- During capture, a line plays on headphones, or on an unidentified output the user marked as headphones; the live transcript keeps streaming.

**Error Scenarios**:
- During capture on detected speakers: `replay_needs_headphones` ("Recording on speakers").
- During capture on an unidentified output not marked as headphones: `output_route_unknown`.
- During capture when own sounds are not excluded: `own_sounds_not_excluded`.
- The audio was not stored or was deleted: `audio_deleted`.
- The output switches to speakers while playing: playback stops with `output_switched_to_speakers`; a capture starting stops it with `capture_started`.

**Steps**:
1. [x] - `p1` - API: `audio_play { call_id, from_ms, to_ms?, channel? }` - `inst-play-call`
2. [x] - `p1` - **IF** the call has no stored audio **RETURN** `audio_deleted` - `inst-if-no-audio`
3. [x] - `p1` - Run `cpt-noter-algo-core-live-transcript-replay-route`; **RETURN** its error if any - `inst-route-check`
4. [x] - `p1` - Ask the supervisor to `play` (`cpt-noter-flow-core-engine-capture-replay`) - `inst-engine-play`
5. [x] - `p1` - Publish `playback:state` from `playback_position` events with a new version - `inst-playback-events`
6. [x] - `p1` - **RETURN** `PlaybackState { playing: true, call_id, position_ms, to_ms, route }` - `inst-play-return`
7. [x] - `p1` - API: `audio_stop {}` sends `stop_playback` and **RETURN** `PlaybackState` with `stopped_reason: user` - `inst-stop-replay`

## 3. Processes / Business Logic (CDSL)

### Batch, persist and publish segments

- [ ] `p1` - **ID**: `cpt-noter-algo-core-live-transcript-batch`

**Input**: `segment` events from the supervisor (hypothesis or confirmed), `speaker_turn` events.

**Output**: Confirmed segments in `segments`, live speakers in `speakers`, messages on the transcript stream.

**Steps**:
1. [ ] - `p1` - **IF** the segment is a hypothesis - `inst-if-hypothesis`
   1. [ ] - `p1` - Publish `hypothesis` (it replaces the channel's grey line); never persist it - `inst-publish-hypothesis`
2. [ ] - `p1` - **ELSE** assign a segment id, map the live speaker label with `cpt-noter-algo-core-live-transcript-speakers`, compute the normalised shadow text, add it to the open batch - `inst-add-confirmed`
3. [ ] - `p1` - When the batch is 250 ms old or the call stops, DB: INSERT the batch into `segments` (pass `live`) in one writer transaction - `inst-commit-batch`
4. [ ] - `p1` - After the commit, publish `confirmed` for each segment in order (it removes the hypothesis) - `inst-publish-confirmed`
5. [ ] - `p1` - Publish `gap` and `mark` messages as the session manager writes them - `inst-publish-gap-mark`
6. [ ] - `p1` - **RETURN** - `inst-return-batch`

### Live speakers

- [ ] `p1` - **ID**: `cpt-noter-algo-core-live-transcript-speakers`

**Input**: Live speaker labels per channel from the engine.

**Output**: `speakers` rows of pass `live` for the call.

**Steps**:
1. [ ] - `p1` - The microphone channel's main speaker is **You** - `inst-you`
2. [ ] - `p1` - **FOR EACH** new label on the system channel, DB: INSERT `speakers { call_id, label, pass: live, n }` as an unnamed speaker - `inst-new-speaker`
3. [ ] - `p1` - **RETURN** the speaker id for the segment - `inst-return-speaker`

### Replay route rule

- [x] `p1` - **ID**: `cpt-noter-algo-core-live-transcript-replay-route`

**Input**: Whether a capture runs, the current `OutputRoute` and output device, `AudioOutputSettings.headphones_devices`, whether own sounds are excluded.

**Output**: Allowed, or the refusing error code.

**Steps**:
1. [x] - `p1` - **IF** no capture runs **RETURN** allowed - `inst-no-capture`
2. [x] - `p1` - **IF** the route is speakers **RETURN** `replay_needs_headphones` - `inst-speakers`
3. [x] - `p1` - **IF** the route is unknown and the device is not in `headphones_devices` **RETURN** `output_route_unknown` - `inst-unknown`
4. [x] - `p1` - **IF** own sounds are not excluded from the tap **RETURN** `own_sounds_not_excluded` - `inst-own-sounds`
5. [x] - `p1` - **RETURN** allowed - `inst-route-allowed`

### Write the transcript file

- [ ] `p2` - **ID**: `cpt-noter-algo-core-live-transcript-file`

**Input**: A call that stopped.

**Output**: `audio/<call_id>/transcript.jsonl`, 0600, for re-import after a corruption.

**Steps**:
1. [ ] - `p1` - Flush the open batch - `inst-file-flush`
2. [ ] - `p1` - Write every segment of the call's current pass, one JSON line each, to a temporary file and rename it into place - `inst-file-write`
3. [ ] - `p1` - **RETURN** - `inst-file-return`

## 4. States (CDSL)

### Playback

- [x] `p1` - **ID**: `cpt-noter-state-core-live-transcript-playback`

**States**: idle, playing, stopped

**Initial State**: idle

**Transitions**:
1. [x] - `p1` - **FROM** idle **TO** playing **WHEN** `audio_play` passed the route rule and the engine started playing - `inst-st-play`
2. [x] - `p1` - **FROM** playing **TO** stopped **WHEN** the span ended (`ended`), the user stopped (`user`), the output switched to speakers during capture (`output_switched_to_speakers`) or a capture started (`capture_started`) - `inst-st-stop`
3. [x] - `p1` - **FROM** stopped **TO** playing **WHEN** `audio_play` again - `inst-st-replay`

### Segment

- [ ] `p1` - **ID**: `cpt-noter-state-core-live-transcript-segment`

**States**: hypothesis, confirmed

**Initial State**: hypothesis

**Transitions**:
1. [ ] - `p1` - **FROM** hypothesis **TO** confirmed **WHEN** the engine confirms the utterance and its batch commits - `inst-st-confirm`
2. [ ] - `p1` - **FROM** hypothesis **TO** hypothesis **WHEN** a newer hypothesis for the channel replaces it - `inst-st-replace`

## 5. Definitions of Done

### Exactly once, published after commit

- [ ] `p1` - **ID**: `cpt-noter-dod-core-live-transcript-persist`

The system **MUST** persist every confirmed segment exactly once in batches of at most 250 ms with its normalised shadow text, never persist hypotheses, publish `confirmed` only after its batch committed, and map live speaker labels to `speakers` rows of pass `live`.

**Implements**:
- `cpt-noter-algo-core-live-transcript-batch`
- `cpt-noter-algo-core-live-transcript-speakers`
- `cpt-noter-state-core-live-transcript-segment`

**Touches**:
- DB: `segments`, `speakers`
- Entities: `SegmentView`, `SpeakerView`

### Snapshot, then stream

- [ ] `p1` - **ID**: `cpt-noter-dod-core-live-transcript-stream`

The system **MUST** answer `transcript_subscribe` with a snapshot and `last_seq` read under the hub lock, stream every message in order after it, end streams with their reason, and fan out to three windows at 10 messages a second within the `stream-hub-fanout` scenario's budget.

**Implements**:
- `cpt-noter-flow-core-live-transcript-subscribe`
- `cpt-noter-flow-core-live-transcript-levels`

**Touches**:
- API: `transcript_subscribe`, `levels_subscribe`
- Entities: `TranscriptSnapshot`, `TranscriptMsg`, `LevelsMsg`

### Span previews and the transcript file

- [ ] `p2` - **ID**: `cpt-noter-dod-core-live-transcript-span-file`

The system **MUST** answer `transcript_span` from the call's current pass and write `transcript.jsonl` atomically at call end.

**Implements**:
- `cpt-noter-flow-core-live-transcript-span`
- `cpt-noter-algo-core-live-transcript-file`

**Touches**:
- API: `transcript_span`
- Entities: `SpanPreview`

### Replay without leaking into the call

- [x] `p1` - **ID**: `cpt-noter-dod-core-live-transcript-replay`

The system **MUST** play replay through the engine only, refuse replay during capture on speakers, on an unidentified output not marked as headphones and when own sounds are not excluded, stop playback with its reason, and publish `playback:state` whole with a version.

**Implements**:
- `cpt-noter-flow-core-live-transcript-replay`
- `cpt-noter-algo-core-live-transcript-replay-route`
- `cpt-noter-state-core-live-transcript-playback`

**Touches**:
- API: `audio_play`, `audio_stop`, `playback:state`
- Entities: `PlaybackState`

## 6. Acceptance Criteria

- [ ] E2E against the real core with the scripted engine, story `cpt-noter-seq-call-screen-replay-line`: scrolling back keeps the live stream; replay on headphones plays; on speakers it is refused with `replay_needs_headphones`.
- [ ] A WebView reload during a replayed call shows the same transcript with no line lost or doubled (conformance, against the real core).
- [ ] A crash test kills the core between commit and publish: after restart every committed segment is in the snapshot and none appears twice.
- [ ] Each of the five commands succeeds at least once in E2E runs against the real core.
- [ ] `just gate` passes, including the `stream-hub-fanout` scenario.
