---
title: "Feature: Copilot loop and cards"
description: "One live tick at a time, privacy-filtered context, fused or parallel council, path-specific degrade rules and the persistent card lifecycle behind the M4 flag."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M4
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Copilot loop and cards

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Follow cards and status](#follow-cards-and-status)
  - [Hold, pin, dismiss and undo](#hold-pin-dismiss-and-undo)
  - [Request Catch-up or an answer](#request-catch-up-or-an-answer)
  - [Mute, resume and raise the budget](#mute-resume-and-raise-the-budget)
  - [Record card feedback](#record-card-feedback)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Detect signals and build topic facts](#detect-signals-and-build-topic-facts)
  - [Run one tick at a time](#run-one-tick-at-a-time)
  - [Validate, merge, rank and admit cards](#validate-merge-rank-and-admit-cards)
  - [Maintain the stack and feedback](#maintain-the-stack-and-feedback)
  - [Degrade and publish runtime state](#degrade-and-publish-runtime-state)
- [4. States (CDSL)](#4-states-cdsl)
  - [Card lifecycle](#card-lifecycle)
  - [Tick scheduling](#tick-scheduling)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Signals, council ticks and privacy](#signals-council-ticks-and-privacy)
  - [Cards, pins and snapshot then stream](#cards-pins-and-snapshot-then-stream)
  - [Solicited help, controls and feedback](#solicited-help-controls-and-feedback)
  - [Prove the M4 gate](#prove-the-m4-gate)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p5` - **ID**: `cpt-noter-featstatus-core-copilot`

- [ ] `p5` - `cpt-noter-feature-core-copilot`

## 1. Feature Context

### 1.1 Overview

One `noter-copilot` task per live call turns transcript signals into cards. It retrieves facts before the tick, sends a small delta through the router and egress gate, then validates, merges and ranks candidates. It owns the card machine, stream, budget and mute state. Capture and transcription continue through every copilot failure. The flag stays off until the M4 latency gate.

### 1.2 Purpose

Give the user a useful question, answer or past decision while it still matters, with provenance, without interrupting the call. A user-requested Catch-up or Ask About This Call remains available when unsolicited answers would be too late.

**Requirements**: PRD › Live copilot; PRD › Live copilot loop; PRD › Success metrics › Copilot, Council; owner decision D4 and open runtime question Q3.

**Principles**: `cpt-noter-principle-core-degrade`; the existing snapshot-then-stream and egress rules apply at their owning boundaries.

**Delivers**:
- Commands frozen at the M4 gate (draft today): `cards_subscribe`, `card_pin`, `card_dismiss`, `card_unpin`, `card_undo_last`, `card_set_held`, `card_rate`, `card_shown`, `copilot_catch_up`, `copilot_ask_about_call`, `copilot_mute`, `copilot_mute_agent`, `copilot_raise_budget`, `context_chip_set`.
- Channel: `CardMsg`; whole-state event: `copilot:status`.
- DESIGN.md stories (M4): `cpt-noter-seq-call-screen-pin-card`, `cpt-noter-seq-call-screen-catch-up`, `cpt-noter-seq-call-screen-read-copilot-state`, `cpt-noter-seq-menu-bar-mute-copilot`.
- The tick half of DESIGN-core `cpt-noter-seq-core-live-tick`; the transcript half is M1.
- M4 performance entries `copilot-tick` and `council-merge`.

**Boundaries**: Screen chips and OCR are v1.x; `context_chip_set` returns `feature_disabled` in v1 and the packet has no screen context. The engine captures, transcribes and embeds; it never runs cloud requests. Items owns pin-created accepted items. The post-call pipeline owns D4 self-switch-off. M5 owns Performance read models and roll-ups; M4 records tick stages and feedback for them.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Reads, holds, pins, dismisses and rates cards; asks for help, mutes and raises the cap |
| Call-screen window | Subscribes, reports painting and sends card intents |
| Native menu bar and hotkeys | Invoke the same core functions while the call app keeps focus |
| Transcript service | Supplies confirmed segments and speculative question hypotheses |
| Retrieval, router and egress gate | Supply scoped facts and validated model output under privacy and cost policy |
| Capture session | Starts and stops the loop, or changes sensitive and pause state |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md), Live copilot, Live copilot loop and Success metrics
- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-copilot`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md), `cpt-noter-component-core-copilot`, `cpt-noter-seq-core-live-tick`, `cpt-noter-dbtable-cards`, card transitions in 3.1, router and retrieval responsibilities in 3.2
- **Stories**: [DESIGN.md](../../DESIGN.md), the four M4 call-screen and menu-bar stories above
- **Contract**: `crates/noter-protocol/src/model/copilot.rs`, `common.rs`, `skills.rs`, `error.rs`, `ipc/mod.rs`; `contracts/ipc.manifest.json`
- **Dependencies**: `cpt-noter-feature-core-agents`, `cpt-noter-feature-core-retrieval-ask`, `cpt-noter-feature-core-live-transcript`, `cpt-noter-feature-core-items-today`
- **Harness**: [HARNESS.md](../../HARNESS.md), `harness/milestones.toml` M4, `harness/perf.toml`

Q3 remains an upstream runtime question: per-turn structured output must be proved in a long-lived session. If unavailable, use the already declared `emit_card` fallback through noter-mcp, with the same validation and deadline checks; it grants no live lookup tools. Do not freeze or enable the flag before that path passes the M4 latency gate. No new IPC command or design ID is introduced here. Numerical speculative-match and used-match thresholds are not fixed by the designs: keep them configurable, test both sides of their boundary, and tune them on recorded calls and ratings before the M4 gate.

The card type's comment suggests removal on late completion, but DESIGN-core 3.1 and the PRD explicitly protect a card once its first line is shown; that rule governs this spec. `removed` is a stream action, not an extra `CardState` variant. The draft status lacks explicit fallback retry-time and off-reason fields; use the existing app degraded-state payloads alongside `CopilotStatus`, and review presentation parity at freeze.

Backend presentation tests use scripted engine and runtime seams; native focus, key registration and announcements use the existing native service. Visual layout and contrast are not applicable here because the UI specs own them. New authentication, server scaling and regulatory reporting are not applicable because this feature uses the existing local core and credential boundaries.

## 2. Actor Flows (CDSL)

### Follow cards and status

- [ ] `p5` - **ID**: `cpt-noter-flow-core-copilot-subscribe`

**Actor**: Call-screen window

**Success Scenarios**:
- Reload returns the same visible cards, earlier outcomes, accepted pins and current status, then only later stream messages.
- Before any card, `listening` and the effective mode explain the quiet stack; flag-off call surfaces still work.

**Error Scenarios**:
- Unknown call: `not_found`; wrong window: `window_not_allowed`.
- A lagged subscription ends with its reason and can be opened again.

**Steps**:
1. [ ] - `p1` - API: `cards_subscribe { call_id }` with a Channel; check the call and manifest window scope - `inst-subscribe-call`
2. [ ] - `p1` - Under the stream hub lock read the writer's committed cards, pins and current status together with the current sequence - `inst-subscribe-snapshot`
3. [ ] - `p1` - **RETURN** `CardsSnapshot { subscription_id, call_id, visible, earlier, pinned, status, last_seq }`; visible holds at most three cards - `inst-subscribe-return`
4. [ ] - `p1` - Deliver `CardMsg` consecutively after `last_seq`, without batching cards; the generated transport buffers messages until the snapshot resolves - `inst-subscribe-stream`
5. [ ] - `p1` - Send whole `CopilotStatus` with the same monotonic version through `copilot:status`, stream `Status` and the matching snapshot - `inst-subscribe-status`
6. [ ] - `p1` - End on stop, discard, unsubscribe, webview reload, shutdown or lag with the canonical stream reason; on lag the window resubscribes - `inst-subscribe-end`

### Hold, pin, dismiss and undo

- [ ] `p5` - **ID**: `cpt-noter-flow-core-copilot-card-actions`

**Actor**: Primary user (call screen, native card keys)

**Success Scenarios**:
- Pin card 2 while Teams keeps focus: one accepted item is created and the stream confirms the key outcome.
- Hold a card past its deadline, dismiss it, undo within 30 s, and unpin a pinned item.

**Error Scenarios**:
- A key has no visible card: `KeyFeedback { outcome: no_card }`; no item changes.
- A direct action addresses an expired or removed card: `card_gone`; an unknown id: `not_found`.
- Undo after 30 s: `undo_expired`; a later item edit prevents destructive undo through the History rules.

**Steps**:
1. [ ] - `p1` - API: `card_set_held { card_id, held }` on hover, focus or expansion; preserve held cards and queue new arrivals while any card is held - `inst-action-hold`
2. [ ] - `p1` - **IF** a native pin or dismiss key arrives, resolve its number against the visible stack atomically; **IF** no card has that number publish `KeyFeedback` with `no_card` and finish without a mutation - `inst-action-resolve-key`
3. [ ] - `p1` - API: `card_pin { card_id }` or the equivalent native intent; through Items create one accepted item with the card's evidence and set the card pinned in the logged transaction - `inst-action-pin`
4. [ ] - `p1` - Remove the pinned card from the visible stack, publish its state and pin result, and for a key publish `KeyFeedback { outcome: pinned }`; the native surface announces Pinned card N - `inst-action-pin-feedback`
5. [ ] - `p1` - API: `card_dismiss { card_id }` or native dismiss; log the dismissed outcome, move it to earlier cards, publish `Removed`, and for a key publish dismissed feedback - `inst-action-dismiss`
6. [ ] - `p1` - API: `card_undo_last { call_id }` checks the last pin or dismiss action and its 30 s window, reverses its logged changes through History, and restores the card to shown without overwriting later item edits - `inst-action-undo`
7. [ ] - `p1` - API: `card_unpin { card_id }` removes the pin-created item through Items and the change log, restoring the card to shown; no duplicate pin may create another item - `inst-action-unpin`
8. [ ] - `p1` - **RETURN** `CardMutation { card, item, change_id }` for a mutation, or `Ack` for hold; retain stable numbers of cards that remain visible - `inst-action-result`

### Request Catch-up or an answer

- [ ] `p5` - **ID**: `cpt-noter-flow-core-copilot-solicited`

**Actor**: Primary user (call screen or native hotkey)

**Success Scenarios**:
- Catch Me Up first shows recent confirmed lines while the summary is written, then the summary and what is being asked now.
- Ask About This Call shows a solicited Answer with the user's question and this call's evidence.

**Error Scenarios**:
- Flag off: `feature_disabled`; muted or sensitive without local: `copilot_off`; cap reached: `budget_paused`; no live capture for this call: `not_recording`.
- A slow solicited card completes even after 12 s; a failed runtime follows the fallback rule without stopping the transcript.

**Steps**:
1. [ ] - `p1` - API: `copilot_catch_up { call_id }` or `copilot_ask_about_call { call_id, question }`; validate live call, nonempty question, flag, effective mode, mute and budget - `inst-request-validate`
2. [ ] - `p1` - Mark the request solicited and add it to the single-tick scheduler; **RETURN** `Ack` at once - `inst-request-ack`
3. [ ] - `p1` - **IF** Catch-up, prepare a Catch-up card from the last confirmed lines while the summary is pending; use the last minute for its short summary and the current question - `inst-request-placeholder`
4. [ ] - `p1` - Build scoped context and run the tick with the user's trigger; a solicited request bypasses the unsolicited 45 s rate and 12 s drop rules - `inst-request-tick`
5. [ ] - `p1` - Stream the first line and later complete body and provenance as Added then Updated; Ask includes the question first and resolves cited segment ids to this call's spans - `inst-request-stream`
6. [ ] - `p1` - **IF** the stack is held, queue the result until release; never remove the held card to make room - `inst-request-held`

### Mute, resume and raise the budget

- [ ] `p5` - **ID**: `cpt-noter-flow-core-copilot-controls`

**Actor**: Primary user (call screen, main or native menu bar)

**Success Scenarios**:
- Mute for 10 minutes, this call or all calls of the current type; Unmute or the timer restores the council without changing capture.
- Raise the call cap from $1 to $2 and resume after budget pause; mute one agent without disabling it globally.

**Error Scenarios**:
- Invalid duration, mismatched call type or a non-finite, non-increasing cap: `invalid_input`.
- A conflicting global card key is omitted from the registered set and reported; other keys continue to work.

**Steps**:
1. [ ] - `p1` - API: `copilot_mute { call_id?, scope }`; resolve the live call for a native menu action and apply wanted scope: for_minutes, this_call, call_type or off - `inst-control-mute`
2. [ ] - `p1` - Store a deadline for a timed mute, keep a call mute only for that call and persist a call-type mute as a logged preference; suppress new card emission while muted - `inst-control-scope`
3. [ ] - `p1` - Release card keys and publish whole status; recording and transcript continue, and app hotkeys remain registered - `inst-control-muted-status`
4. [ ] - `p1` - On timer expiry or scope off, recompute effective mode, budget and eligible agents, then restore allowed card keys and listening state - `inst-control-unmute`
5. [ ] - `p1` - API: `copilot_mute_agent { call_id, agent_id, muted }` updates this call's agent mute and recomputes the council without editing registry membership - `inst-control-agent`
6. [ ] - `p1` - API: `copilot_raise_budget { call_id, cap_usd }` validates the higher cap, records it for this call and resumes ticks if no other guard blocks them - `inst-control-budget`
7. [ ] - `p1` - **RETURN** the complete new `CopilotStatus` with its version, also published through the event and cards stream - `inst-control-return`

### Record card feedback

- [ ] `p5` - **ID**: `cpt-noter-flow-core-copilot-feedback`

**Actor**: Call-screen window, Primary user (call screen or main)

**Success Scenarios**:
- The window reports the first actual paint; a user rates a card up, down or clears its rating.

**Error Scenarios**:
- Unknown card: `not_found`; malformed timestamp or rating: `invalid_input`.

**Steps**:
1. [ ] - `p1` - API: `card_shown { card_id, shown_at }`; record the first valid paint once and finish its latency timeline, without double-counting repeated reports or reloads - `inst-feedback-shown`
2. [ ] - `p1` - **IF** the UI cannot paint because the card is menu-bar-only, hidden for presenting or released from the held queue, stamp the shown time in the core - `inst-feedback-core-shown`
3. [ ] - `p1` - API: `card_rate { card_id, rating? }`; store up, down or no rating through the writer and change log - `inst-feedback-rate`
4. [ ] - `p1` - **RETURN** `Ack` for shown or `CardMutation` for rating; publish the updated card for subscribers - `inst-feedback-return`

## 3. Processes / Business Logic (CDSL)

### Detect signals and build topic facts

- [ ] `p5` - **ID**: `cpt-noter-algo-core-copilot-signals`

**Input**: Confirmed segments, question hypotheses, current call type, people, last three minutes and topic facts.

**Output**: Typed triggers with confidence and utterance-end time; current topic's scoped facts.

**Steps**:
1. [ ] - `p1` - At call start read the shared carry-forward query: open accepted items from the last two calls with the same people, suggested items marked Not reviewed, and Today's items for people present - `inst-signal-initial`
2. [ ] - `p1` - **FOR EACH** confirmed segment, run rules for question cues in EN, RU and DE, speaker changes, people, dates, Jira keys and commitment phrases; use the local classifier only for ambiguous cases, rules alone if unavailable - `inst-signal-confirmed`
3. [ ] - `p1` - Produce typed signals with confidence within 300 ms; hypotheses run question detection only and may start a high-confidence speculative tick - `inst-signal-speculative`
4. [ ] - `p1` - Every 20–30 s embed the rolling three-minute window through the local engine and compare with the preceding topic; cosine below 0.75 is a topic shift - `inst-signal-topic`
5. [ ] - `p1` - **IF** the topic shifted, use shared retrieval to over-fetch then filter in SQL by people, source scope and privacy; retain the top eight allowed related decisions, open items and document chunks - `inst-signal-retrieve`
6. [ ] - `p1` - Expire unheld shown cards from the old topic; keep held cards, and invalidate pending unsolicited Ask candidates from that topic - `inst-signal-topic-change`
7. [ ] - `p1` - **RETURN** triggers and topic facts with stable source ids for the next tick; no source filtered out here may re-enter through a model tool - `inst-signal-return`

### Run one tick at a time

- [ ] `p5` - **ID**: `cpt-noter-algo-core-copilot-tick`

**Input**: Signal, topic shift, periodic or solicited trigger; registry snapshot; delta and topic facts; privacy, mute and budget state.

**Output**: Validated candidate stream with tick and run ids, or a typed degraded outcome.

**Steps**:
1. [ ] - `p1` - **IF** the flag is off, the call stopped, capture is paused, the council is off or muted, budget is exhausted, or a sensitive call has no local runtime, do not start a model run - `inst-tick-guards`
2. [ ] - `p1` - **IF** a tick is already in flight, coalesce new triggers for the next tick, retaining solicited questions and each trigger's time; **RETURN** without a second concurrent tick - `inst-tick-coalesce`
3. [ ] - `p1` - Claim the call's single tick slot; load the latest committed effective council and skill revisions; include periodic work no more often than every 45 s - `inst-tick-claim`
4. [ ] - `p1` - Build a packet with new segments since the last tick, current topic facts, call type, participants, shown cards and trigger; screen context is empty in v1 - `inst-tick-packet`
5. [ ] - `p1` - **IF** the warm session was reset, include the three-minute carry-over summary; reset every 15 ticks, keeping the delta cursor tied to the session that consumed it - `inst-tick-session`
6. [ ] - `p1` - Route through the M2 router and egress gate: fused sends all eligible skills in one request with a shared model and effort; parallel sends the same packet to one session per eligible agent - `inst-tick-run`
7. [ ] - `p1` - Never expose live lookup tools, user hooks or MCP servers; even the Q3 emit fallback only delivers candidates, not retrieved data - `inst-tick-no-tools`
8. [ ] - `p1` - In parallel collect arriving candidates without waiting beyond 8 s for a missing agent; apply router fallback to fused when parallel cannot meet policy - `inst-tick-parallel-window`
9. [ ] - `p1` - Validate `CouncilTickOutput` and candidate agent ids, evidence ids and plain text against the packet; the router retries invalid output once with its failure, then uses its simpler schema fallback - `inst-tick-schema`
10. [ ] - `p1` - **IF** speculative, retain candidates only when confirmed text matches the hypothesis within the configured small edit-distance threshold; otherwise discard that speculation and process confirmed triggers - `inst-tick-confirm`
11. [ ] - `p1` - Pass validated candidates to `cpt-noter-algo-core-copilot-rank`; account for run cost and check the privacy epoch again before display, suppressing stale cloud output after Make Sensitive - `inst-tick-candidates`
12. [ ] - `p1` - Release the slot on success, failure or cancellation; process coalesced triggers against current guards, topic and deadlines; **RETURN** the tick outcome - `inst-tick-release`

### Validate, merge, rank and admit cards

- [ ] `p5` - **ID**: `cpt-noter-algo-core-copilot-rank`

**Input**: Validated candidates tagged by agent, trigger and topic, recent cards, held stack and current time.

**Output**: Persisted queued or streamed cards, merge records and dropped outcomes.

**Steps**:
1. [ ] - `p1` - **FOR EACH** candidate, require a known eligible agent, title at most 120 characters, body at most two sentences and confidence from 0 to 1; reject malformed candidates - `inst-rank-validate`
2. [ ] - `p1` - Drop confidence below 0.6 and duplicates of cards shown in the last 10 minutes - `inst-rank-filter`
3. [ ] - `p1` - Resolve source ids to provenance: Ask and Pin cite this call, Context cites a past call and span, Catch-up cites this call; factual Answer cites a retrieved source or is explicitly Model guess, unverified - `inst-rank-provenance`
4. [ ] - `p1` - Merge cross-agent near-duplicates above 0.85 embedding similarity; keep the earliest agent's badge, list other agents as text, and record the merge - `inst-rank-merge`
5. [ ] - `p1` - Rank cited cards before unverified cards; use configured agent order as the tie-break - `inst-rank-order`
6. [ ] - `p1` - Before emitting the first line apply the path rule: drop unsolicited Answer older than 12 s with `DroppedLate`; Context uses the raw past decision if phrasing is late; Ask is skipped if its topic moved; Catch-up retains confirmed lines while waiting - `inst-rank-path`
7. [ ] - `p1` - Apply the same rule again after any held-queue wait; never apply the 12 s drop to solicited cards and never drop on lateness after a first line has been shown - `inst-rank-recheck`
8. [ ] - `p1` - Admit at most one unsolicited card per 45 s across all agents; solicited cards do not consume or wait for that limit - `inst-rank-rate`
9. [ ] - `p1` - **IF** any visible card is held, persist accepted candidates as queued in rank order without displacing the held stack - `inst-rank-queue`
10. [ ] - `p1` - **ELSE** take the lowest free number from 1–3, inserting at the top; when full, move the oldest unheld card to earlier cards with Removed and its current state, reuse only its freed number and do not renumber survivors - `inst-rank-slot`
11. [ ] - `p1` - Write card, outcome and change-log records through the writer before publishing Added, Updated or Merged; complete body and provenance after the first line, never batching card events - `inst-rank-publish`
12. [ ] - `p1` - **RETURN** admitted cards and recorded drops with `tick_id` and `llm_run_id`; once a first line is shown finish it even if its deadline passes - `inst-rank-return`

### Maintain the stack and feedback

- [ ] `p5` - **ID**: `cpt-noter-algo-core-copilot-stack`

**Input**: Card actions, hold changes, timer, topic change, paint reports and microphone transcript.

**Output**: Durable card outcomes, accepted pins, stable visible numbers, feedback and ordered events.

**Steps**:
1. [ ] - `p1` - Serialise stack intents with the owning call task; reject gone targets before making item changes and treat repeated wanted-state hold, pin and unpin requests without duplicate side effects - `inst-stack-serialise`
2. [ ] - `p1` - Give each shown card a 90 s display deadline; while held expose no expiry deadline and never remove it due to timeout or topic shift - `inst-stack-deadline`
3. [ ] - `p1` - **IF** a hold ends, recompute its remaining display time and topic validity; expire an already due card, then release queued cards in rank order with path checks - `inst-stack-release`
4. [ ] - `p1` - On timeout or topic change, record expiry reason and time, publish `Expired`, move the card to earlier and free only its number - `inst-stack-expire`
5. [ ] - `p1` - Pin and unpin through Items in the writer transaction with card changes; remember the last undoable pin or dismiss and its action time, delegating reversal and later-edit protection to History - `inst-stack-items`
6. [ ] - `p1` - Keep the first valid shown timestamp, whether reported by the UI or stamped by the core, and record rating, pin, dismissal, expiry and held interactions - `inst-stack-feedback`
7. [ ] - `p1` - Compare the user's own mic transcript with shown questions or answers for two minutes after display; a match above the rating-tuned threshold marks `used` once; other participants' speech does not - `inst-stack-used`
8. [ ] - `p1` - Associate outcomes with card kind, agent and call type; expose data for seven-day counts, last-20-call useful shares and the post-call last-10-call D4 rule without applying D4 here - `inst-stack-stats`
9. [ ] - `p1` - **RETURN** committed state and publish it after commit so a reload cannot lose a pin or replay an action twice - `inst-stack-return`

### Degrade and publish runtime state

- [ ] `p5` - **ID**: `cpt-noter-algo-core-copilot-degrade`

**Input**: Runtime failures, account status, privacy changes, cost, call lifecycle, mute, presenting and hotkey availability.

**Output**: Whole versioned `CopilotStatus`, degraded-state facts, key registration and guarded model work.

**Steps**:
1. [ ] - `p1` - Derive effective mode and eligible agents from privacy first; a sensitive or offline call uses local Teamlead and Architect or off, never cloud - `inst-degrade-privacy`
2. [ ] - `p1` - **IF** a key is rejected, rate limited or out of quota, switch live work to local, publish Switched to local and offer a cloud retry after 10 minutes; no automatic retry may bypass current privacy - `inst-degrade-auth`
3. [ ] - `p1` - **IF** a model process dies once, restart a fresh session with the last three minutes; on a second death switch to local and report it - `inst-degrade-process`
4. [ ] - `p1` - **IF** an agent's account signed out or its runtime is missing, keep that configured agent paused with its reason and Settings fix; allow the other eligible agents or the router's local fallback to continue - `inst-degrade-agent`
5. [ ] - `p1` - Track API-key dollar cost against this call's cap and agent shares; set budget near above 90 %, paused at the cap; reserve the remaining allowance before parallel runs so they cannot each spend it in full - `inst-degrade-cost`
6. [ ] - `p1` - Treat own-account runs as plan usage with `on_account`, not measured dollars; never invent a dollar charge for an account run - `inst-degrade-account`
7. [ ] - `p1` - Register configured card keys only while capture runs, the flag and council are on, not muted, settings enable them and Noter is not hidden for presenting; report conflicts and retain working keys - `inst-degrade-keys`
8. [ ] - `p1` - Keep global Mute, Catch-up and app hotkeys registered by the native service; card-key actions call the same core intent as panel actions with `Caller::Native` - `inst-degrade-native`
9. [ ] - `p1` - On Make Sensitive invalidate outbound cloud work and results; on pause stop consuming new speech; on stop or discard cancel pending ticks, close warm sessions, log their ids and end card streams - `inst-degrade-lifecycle`
10. [ ] - `p1` - Record stages from utterance end through signals, retrieval, runtime first token, validation, merge, emission and shown with tick and run ids; record skipped, failed and dropped stages as outcomes, never transcript text in diagnostic logs - `inst-degrade-timeline`
11. [ ] - `p1` - Publish whole status with a new monotonic version after each relevant change; **RETURN** without blocking capture or transcript work - `inst-degrade-return`

## 4. States (CDSL)

### Card lifecycle

- [ ] `p5` - **ID**: `cpt-noter-state-core-copilot-card`

**States**: queued, streaming, shown, held, pinned, dismissed, expired

**Initial State**: queued when held; otherwise streaming when the first line is admitted.

**Transitions**:
1. [ ] - `p1` - **FROM** queued **TO** streaming **WHEN** the stack is released, a slot is available and the path's first-line rule still allows display - `inst-st-queued`
2. [ ] - `p1` - **FROM** streaming **TO** shown **WHEN** body and provenance finish; once shown, the first line's lateness cannot cancel completion - `inst-st-complete`
3. [ ] - `p1` - **FROM** shown **TO** held **WHEN** hover, focus or expansion requests held true - `inst-st-hold`
4. [ ] - `p1` - **FROM** held **TO** shown **WHEN** held false; recheck its topic and elapsed deadline before queue release - `inst-st-release`
5. [ ] - `p1` - **FROM** shown or held **TO** pinned **WHEN** pin commits an accepted item - `inst-st-pin`
6. [ ] - `p1` - **FROM** shown or held **TO** dismissed **WHEN** dismiss commits its outcome - `inst-st-dismiss`
7. [ ] - `p1` - **FROM** shown **TO** expired **WHEN** its 90 s deadline passed or its topic changed - `inst-st-expire`
8. [ ] - `p1` - **FROM** pinned **TO** shown **WHEN** unpin removes the pin-created item through the change log - `inst-st-unpin`
9. [ ] - `p1` - **FROM** pinned or dismissed **TO** shown **WHEN** the last action is undone within 30 s and History permits reversal - `inst-st-undo`

Moving the oldest card to earlier when the unheld stack is full does not invent an expiry reason or change its stored state. Held cards never expire. Before a first line is painted, a late unsolicited Answer is removed with a dropped-late outcome; `Removed` carries an existing state, not a new removed enum value. Dismissed and expired cards remain in earlier cards; only the last eligible pin or dismissal can be restored by card Undo. Direct operations on a gone card return `card_gone`. Card outcomes and pin links survive reload through the writer; timers and holds are owned by the core, not the WebView.

### Tick scheduling

- [ ] `p5` - **ID**: `cpt-noter-state-core-copilot-tick`

**States**: idle, running, pending, blocked, stopped

**Initial State**: idle after a live call starts with the flag on and guards satisfied; otherwise blocked.

**Transitions**:
1. [ ] - `p1` - **FROM** idle **TO** running **WHEN** an allowed signal, topic shift, periodic or solicited trigger claims the slot - `inst-st-tick-start`
2. [ ] - `p1` - **FROM** running **TO** pending **WHEN** another trigger arrives; keep the one running tick and coalesce pending work - `inst-st-tick-pending`
3. [ ] - `p1` - **FROM** pending **TO** pending **WHEN** further triggers arrive; preserve solicited requests and original deadlines - `inst-st-tick-coalesce`
4. [ ] - `p1` - **FROM** running **TO** idle **WHEN** success or failure releases the slot with no pending work - `inst-st-tick-idle`
5. [ ] - `p1` - **FROM** pending **TO** running **WHEN** the current tick ends and still-valid pending work passes current guards - `inst-st-tick-next`
6. [ ] - `p1` - **FROM** idle, running or pending **TO** blocked **WHEN** mute, pause, budget, council off or privacy prevents runs; suppress ineligible pending output - `inst-st-tick-blocked`
7. [ ] - `p1` - **FROM** blocked **TO** idle **WHEN** Unmute, resume, a higher cap or runtime repair clears all blocking guards - `inst-st-tick-resume`
8. [ ] - `p1` - **FROM** idle, running, pending or blocked **TO** stopped **WHEN** capture stops, discards or the core shuts down; close sessions and streams - `inst-st-tick-stop`

These are internal scheduler states, not new protocol variants. At most one tick, including parallel fan-out as one tick, owns the call's slot. A stopped task cannot accept more triggers; Continue Recording starts a new task for the same call with its durable cards and pins.

## 5. Definitions of Done

### Signals, council ticks and privacy

- [ ] `p5` - **ID**: `cpt-noter-dod-core-copilot-loop`

The system **MUST** build initial carry-forward context, detect signals, retrieve scoped topic facts, coalesce triggers into one tick, use current agent configuration, validate speculative results against confirmation and reset warm sessions every 15 ticks. Fused and parallel runs **MUST** pass the router and gate without live lookup tools; parallel agents missing 8 s are skipped for that tick. Sensitive and flag-off calls **MUST** start no forbidden sessions, and `context_chip_set` **MUST** return `feature_disabled` in v1.

**Implements**:
- `cpt-noter-algo-core-copilot-signals`
- `cpt-noter-algo-core-copilot-tick`
- `cpt-noter-state-core-copilot-tick`

**Constraints**: `cpt-noter-constraint-core-copilot-flag`

**Touches**:
- API: `context_chip_set`
- Entities: `CouncilTickOutput`, `CardCandidate`, `CopilotStatus`
- Components: copilot, retrieval, router, egress gate and engine embedding service

### Cards, pins and snapshot then stream

- [ ] `p5` - **ID**: `cpt-noter-dod-core-copilot-cards`

The system **MUST** enforce confidence, provenance, duplicate, merge, rate and path-specific deadline rules; stream the first line without waiting for body completion; keep at most three stable visible numbers; protect held cards and release queued cards in rank order. Pin creates one accepted item; unpin and 30 s Undo go through Items and History. Snapshots and later events **MUST** agree after a WebView reload.

**Implements**:
- `cpt-noter-flow-core-copilot-subscribe`
- `cpt-noter-flow-core-copilot-card-actions`
- `cpt-noter-algo-core-copilot-rank`
- `cpt-noter-algo-core-copilot-stack`
- `cpt-noter-state-core-copilot-card`

**Touches**:
- API: `cards_subscribe`, `card_pin`, `card_dismiss`, `card_unpin`, `card_undo_last`, `card_set_held`, `CardMsg`
- DB: `cards`, pin-created `items`, `changes`
- Entities: `CardsSnapshot`, `CardView`, `CardMutation`, `ItemView`

### Solicited help, controls and feedback

- [ ] `p5` - **ID**: `cpt-noter-dod-core-copilot-controls`

The system **MUST** deliver solicited Catch-up and Ask cards without the unsolicited time or rate drop, show confirmed lines while Catch-up is written, apply mute scopes and call budgets as wanted state, preserve capture through every degraded case, and release or restore native card keys with current eligibility. It **MUST** store first shown time, ratings, outcomes, merges and microphone-only used matches, with complete correlated tick timelines for later Performance views.

**Implements**:
- `cpt-noter-flow-core-copilot-solicited`
- `cpt-noter-flow-core-copilot-controls`
- `cpt-noter-flow-core-copilot-feedback`
- `cpt-noter-algo-core-copilot-degrade`

**Touches**:
- API: `copilot_catch_up`, `copilot_ask_about_call`, `copilot_mute`, `copilot_mute_agent`, `copilot_raise_budget`, `card_rate`, `card_shown`, `copilot:status`
- DB: `cards`, `llm_runs`, `metrics`, logged mute preferences
- Entities: `CopilotStatus`, `BudgetState`, `CardKeysState`

### Prove the M4 gate

- [ ] `p5` - **ID**: `cpt-noter-dod-core-copilot-validation`

The system **MUST** pass unit tests for signals, coalescing, ranking, all card transitions and controls; conformance for snapshots, sequences, versions, scopes and errors; real-core E2E for its four M4 stories; native key and menu tests; and the `copilot_tick_scripted` and `copilot_merge_rank` scenarios. The latency gate **MUST** measure Answer p50 at most 5 s, p95 at most 9 s; Context and Ask p50 at most 6 s, p95 at most 10 s; Catch-up p50 at most 5 s, p95 at most 8 s. Q3's selected output path **MUST** pass those checks before enabling the flag and freezing the draft surface. `just gate` passes.

**Implements**:
- `cpt-noter-flow-core-copilot-subscribe`
- `cpt-noter-flow-core-copilot-card-actions`
- `cpt-noter-flow-core-copilot-solicited`
- `cpt-noter-flow-core-copilot-controls`
- `cpt-noter-flow-core-copilot-feedback`

**Covers (DESIGN)**:
- [ ] `p5` - `cpt-noter-component-core-copilot`
- [ ] `p5` - `cpt-noter-principle-core-degrade`
- [ ] `p5` - `cpt-noter-constraint-core-copilot-flag`
- `cpt-noter-seq-core-live-tick`
- `cpt-noter-seq-call-screen-pin-card`
- `cpt-noter-seq-call-screen-catch-up`
- `cpt-noter-seq-call-screen-read-copilot-state`
- `cpt-noter-seq-menu-bar-mute-copilot`
- `cpt-noter-dbtable-cards`

## 6. Acceptance Criteria

- [ ] Unit tests start with failing cases and a fake clock: confidence 0.6 boundary, topic cosine 0.75 boundary, merge above 0.85, last-10-minute duplicate rejection, one unsolicited card per 45 s and a stable 1–3 mapping across arrivals and actions.
- [ ] Unit tests cover one tick in flight under bursts, parallel 8 s misses, reset at 15 ticks, hypothesis mismatch, invalid evidence, configured edit-distance boundary, stopped-call cancellation and no stale cloud output after Make Sensitive.
- [ ] Deadline tests drop an unsolicited Answer whose first line is over 12 s late, retain one first shown before that deadline through body completion, retain solicited cards past 12 s, use raw Context on delay and skip an obsolete Ask.
- [ ] Stack tests hold past 90 s and through a topic shift without removal, release queued cards with deadline rechecks, pin once, unpin, undo at 30 s or refuse after it, and protect an item edited later. Reload restores cards, earlier outcomes and accepted pins without duplication.
- [ ] Conformance against the real core verifies snapshot-plus-stream ordering, whole-status versions, acknowledgment and lag termination, manifest scopes and all fourteen command results. Thirteen commands succeed in real-core E2E; `context_chip_set` is tested for the required `feature_disabled` refusal and cannot count as a successful delivered command in v1.
- [ ] E2E `cpt-noter-seq-call-screen-pin-card`: native pin keeps Teams focus, creates an accepted item, returns KeyFeedback and supports Unpin and Undo; no-card and conflicting-key paths leave other cards and keys intact. XCUITest uses `test_cpt_noter_seq_call_screen_pin_card` in its name.
- [ ] E2E `cpt-noter-seq-call-screen-catch-up`: show confirmed lines while Catch-up is written, complete it, dismiss to Earlier and ask a cited question about this call; both solicited paths survive a slow runtime.
- [ ] E2E `cpt-noter-seq-call-screen-read-copilot-state`: listening and mode are visible before the first card, late answers stay absent, local fallback is explicit, cap exhaustion pauses only the copilot, Raise Cap resumes it and sensitive-without-local stays off while the transcript continues.
- [ ] E2E `cpt-noter-seq-menu-bar-mute-copilot`: timed, call and call-type mutes, timer expiry and Unmute work from native callers; card keys are released while muted or hidden, then restored, including in the collapsed strip. XCUITest uses `test_cpt_noter_seq_menu_bar_mute_copilot` in its name; app hotkeys remain registered.
- [ ] Feedback tests prove one shown timestamp per card, core timestamps for hidden, menu-bar-only and queue-release cases, rating clear, mic-only used matches within two minutes, and complete stage outcomes with tick and run ids. No text enters diagnostic logs and no sensitive packet leaves the Mac.
- [ ] Performance scenarios cover scripted end-to-end ticks and six-agent merge/rank without more than 10 % instruction-count regression. Recorded-call latency meets the path budgets; the 60-minute default API-key council costs at most $1. Useful-or-used share, unhelpful share, per-agent useful share and merge share are measurable against the PRD targets (30 %, 10 %, 25 % and 15 % respectively).
- [ ] `just gate` passes.
