---
title: "Feature — Live copilot cards"
description: "Numbered council cards in the call window, card keys, catch-up, Ask, mute, budget and degraded states, plus stored cards in Agent Reviews."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-copilot
milestone: M4
---

# Feature: Live copilot cards

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Read and hold council cards](#read-and-hold-council-cards)
  - [Pin, dismiss and undo a card](#pin-dismiss-and-undo-a-card)
  - [Catch up and ask about this call](#catch-up-and-ask-about-this-call)
  - [Mute and read degraded states](#mute-and-read-degraded-states)
  - [Change context chips](#change-context-chips)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Reconcile the card stream](#reconcile-the-card-stream)
  - [Present copilot status](#present-copilot-status)
- [4. States (CDSL)](#4-states-cdsl)
  - [Card lifecycle](#card-lifecycle)
  - [Copilot surface](#copilot-surface)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Cards, sources and outcomes](#cards-sources-and-outcomes)
  - [Card actions and requested help](#card-actions-and-requested-help)
  - [Mute, budget and flag layouts](#mute-budget-and-flag-layouts)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p5` - **ID**: `cpt-noter-featstatus-ui-copilot`

## 1. Feature Context

- [ ] `p5` - `cpt-noter-feature-ui-copilot`

### 1.1 Overview

The council column shows up to three numbered cards, each with its agent and source. The user pins or dismisses them while the call app keeps focus, asks for a catch-up or an answer, and mutes the council without stopping recording. The same cards survive display changes and appear with their outcomes in the Call page's **Agent Reviews** view.

Scope includes CS-R4, FP-R2/FP-R4, the collapsed-strip card line, card keys, menu bar copilot actions, context chips and stored cards. Agent configuration belongs to `cpt-noter-feature-ui-agents`; ranking, generation, expiry, runtime fallback and key registration belong to the core.

### 1.2 Purpose

It implements `cpt-noter-component-ui-copilot-card-stack`, `cpt-noter-component-ui-copilot-card`, `cpt-noter-component-ui-agent-badge` and `cpt-noter-component-ui-context-chip`. A quiet council still shows whether it is listening, muted, at its budget or off.

**Requirements**: PRD › Feature specification › 3. Live copilot; Live copilot › Card types, Guardrails, Role council and Surfaces; Live copilot loop › Degraded states. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-quiet-surface`

Success criteria: at most three numbered cards, no replacement under the pointer or focus, and one pin key creates one accepted item while Microsoft Teams keeps focus. The copilot stays behind `cpt-noter-constraint-copilot-flag` until the M4 latency gate.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Reads, pins, dismisses, rates, asks and mutes during a call |
| Noter core (system) | Generates and numbers cards, owns pins and context, registers keys, reports modes and budget |
| Call app | Keeps keyboard focus during global card actions |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 3; Live copilot; Live copilot loop
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Call screen (CS-R4, CS-R5), Floating panel (FP-R2, FP-R4, FP-C2), Menu bar extra, Call page (PC-R7); components Copilot card stack, Copilot card, Agent badge, Context chip
- **Design elements**: `cpt-noter-component-ui-copilot-card-stack`, `cpt-noter-component-ui-copilot-card`, `cpt-noter-component-ui-agent-badge`, `cpt-noter-component-ui-context-chip`
- **Stories delivered (M4)**: `cpt-noter-seq-call-screen-pin-card`, `cpt-noter-seq-call-screen-catch-up`, `cpt-noter-seq-call-screen-read-copilot-state`, `cpt-noter-seq-menu-bar-mute-copilot`
- **Earlier stories extended**: card steps of `cpt-noter-seq-floating-panel-display-unplugged` and `cpt-noter-seq-floating-panel-collapse-strip` (M1). These stay assigned to M1; DECOMPOSITION discrepancy 4 defers their flag-on proof to M4.
- **Frozen commands delivered at the M4 gate**: `cards_subscribe`, `card_pin`, `card_dismiss`, `card_unpin`, `card_undo_last`, `card_set_held`, `card_rate`, `card_shown`, `copilot_catch_up`, `copilot_ask_about_call`, `copilot_mute`, `copilot_mute_agent`, `copilot_raise_budget`, `context_chip_set`. They are currently draft in the generated contract; M4 is their freeze gate.
- **Shared commands**: `window_announce`, `window_navigate`, `capture_set_sensitive` (M1); item editing, handoff answers and reopen through `cpt-noter-feature-ui-items` (M2); `stream_ack` and `stream_unsubscribe` through the bridge (M0)
- **Contract**: [bindings.ts](../../../apps/desktop/src/core/bindings.ts) › `CardView`, `CardsSnapshot`, `CardMsg`, `CardMutation`, `CopilotStatus`, `ContextChipView`; `apps/desktop/src/core/fake/`
- **Events**: `copilot:status`, `capture:state`, `window:call`, `app:presenting`, `hotkeys:changed`, `entity:changed`; Channel `CardMsg`
- **Data**: `cpt-noter-dbtable-cards` in DESIGN-core, read and changed through the core only; the UI owns no table
- **Prototype modules**: `src/js/20-b-components.js` (`C.copilotCard`, `C.copilotCardStack`, `C.cardLegend`, `C.contextChip`); `src/js/20-b-surface.js` (council header, Ask, mute, pinned popover and card actions); `src/js/04-shared.js` (`C.agentBadge`, provenance); `src/js/10-a-surfaces.js` (menu bar); `src/js/30-c-callpage.js` (`reviewsView`); `src/css/20-b.css`, `00-base.css`, `30-c.css`
- **Dependencies**: `cpt-noter-feature-ui-call-window`, `cpt-noter-feature-ui-items`, `cpt-noter-feature-ui-menu-bar`
- **Harness**: [milestones.toml](../../../harness/milestones.toml) › M4; [HARNESS.md](../../HARNESS.md) › commands and stories count only against the real core

## 2. Actor Flows (CDSL)

### Read and hold council cards

- [ ] `p5` - **ID**: `cpt-noter-flow-ui-copilot-read-cards`

**Actor**: Primary user

**Success Scenarios**:
- A new card shows its number, agent, type, age and source; after 60 s its text becomes secondary, and after core expiry it joins **Earlier cards**
- Hover holds arrivals behind **1 new card ▴**; the same cards and numbers remain after the display is unplugged
- In **Agent Reviews**, stored cards show **Pinned**, **Used**, **Dismissed** or **Expired**, with no number or live actions

**Error Scenarios**:
- No card yet: **Listening. Cards appear when there is something worth asking** and the active mode
- A late unsolicited card: nothing appears, no failure banner; catch-up remains available
- Reload or stream gap: the bridge reads a fresh snapshot rather than making up card positions

**Steps**:
1. [ ] - `p1` - UI: with the copilot flag on and a call id, subscribe through `cards_subscribe`; apply `visible`, `earlier`, `pinned`, `status` and `last_seq` - `inst-subscribe`
2. [ ] - `p1` - Algorithm: reconcile the snapshot and Channel through `cpt-noter-algo-ui-copilot-card-stream` - `inst-reconcile`
3. [ ] - `p1` - UI: render newest first, with stable core numbers; **Council · 6 agents**, or **Copilot** and no agent badges with one agent - `inst-render`
4. [ ] - `p1` - User hovers, focuses or expands a card with click, Return or Space - `inst-user-hold`
5. [ ] - `p1` - API: `card_set_held` with its id and wanted held state; keep it held until hover, focus and expansion have all ended - `inst-hold`
6. [ ] - `p1` - UI: while the stack is hovered or the panel is key, show queued arrivals as a pluralised pill; clicking it or leaving the stack admits waiting, unexpired cards - `inst-queue`
7. [ ] - `p1` - UI: expansion shows the source quote, speaker and time, **Why now:**, merged agents as text, **Useful**, **Not Useful**, and **Copy** on Answer cards - `inst-expand`
8. [ ] - `p1` - User rates the card; API: `card_rate` with useful, not useful or null to clear the rating; show **Thanks · marked useful** or **Marked unhelpful** - `inst-rate`
9. [ ] - `p1` - User copies an Answer; UI: copy plain text and show **Copied** for 2 s; a source opens the existing evidence preview without moving focus to the main window - `inst-copy-source`
10. [ ] - `p1` - User opens the agent badge menu; **Mute Architect for This Call** calls `copilot_mute_agent` with wanted muted true; **Open Agent Settings** navigates to Agents with that agent selected - `inst-agent-menu`
11. [ ] - `p1` - User opens **Earlier cards**; UI: read-only cards with outcomes and a separate **Pin** action, using the pin flow and the contract limitation in section 7 - `inst-earlier`
12. [ ] - `p1` - User opens Call page › **Agent Reviews**; UI: reuse the read-only card and static badge for **Cards from this call**, from core-owned stored data; section 7 records the missing read path - `inst-stored`
13. [ ] - `p1` - **RETURN** a live or stored card surface with its source and outcome - `inst-return-read`

### Pin, dismiss and undo a card

- [ ] `p5` - **ID**: `cpt-noter-flow-ui-copilot-card-action`

**Actor**: Primary user

**Success Scenarios**:
- ⌃⌥⌘2 pins the displayed card 2 while Teams keeps focus; **Pinned card 2: Anna delivers the drawer redesign…** with **Undo** and the higher pinned count
- **2 Pinned** opens a popover with **Edit**, **Unpin**, and **Pinned items reach the Call page as accepted action items.**

**Error Scenarios**:
- Key conflict: once, **Card key ⌃⌥⌘3 is used by another app** · **Change…**; only working keys appear in the legend
- No numbered card: **No card 3** for 2 s; cards 1 and 2 keep their numbers
- `card_gone` or `undo_expired`: show the named status and reconcile; no invented item or automatic retry

**Steps**:
1. [ ] - `p1` - User presses a registered global card key or clicks **Pin**, **Pin as Action Item** or **Dismiss** - `inst-user-action`
2. [ ] - `p1` - **IF** a global key is used: core resolves the number to the card id and sends `key_feedback`; the UI does not send the same action again - `inst-global`
3. [ ] - `p1` - **IF** a button or panel-local key is used: API `card_pin` or `card_dismiss` for the displayed id; Catch-up offers **Dismiss** only - `inst-local`
4. [ ] - `p1` - UI: apply the returned card and item by identity; a pinned card leaves the stack and its accepted item enters the pinned list, never twice when the Channel repeats the update - `inst-apply`
5. [ ] - `p1` - UI: show pin feedback for 3 s, with **Undo** ⌃⌥⌘Z; announce **Pinned card 2** through the native path when the panel is not key - `inst-feedback`
6. [ ] - `p1` - User chooses **Undo**, or ⌘Z while the panel is key; API: `card_undo_last` with the call id within the core's 30-second window; the global undo key is handled by the core - `inst-undo`
7. [ ] - `p1` - User opens the pinned popover; **Edit** delegates to the item editor and **Unpin** calls `card_unpin` with the associated card id - `inst-pinned`
8. [ ] - `p1` - **IF** the card is carry-forward: **Yes, Landed**, **Keep Open** or **Reopen** delegates to the item's handoff-answer or reopen flow; show **Marked as landed**, **Kept open** or **Reopened** only after success - `inst-carry`
9. [ ] - `p1` - **IF** the core reports no card for a number: show **No card 3** for 2 s without changing cards or undo history - `inst-no-card`
10. [ ] - `p1` - **IF** a key conflicts: report it once per capture and open Settings › Hotkeys › **Card keys during calls** from **Change…** - `inst-conflict-key`
11. [ ] - `p1` - **RETURN** the core's cards, pins and accepted items with the call app's focus preserved - `inst-return-action`

### Catch up and ask about this call

- [ ] `p5` - **ID**: `cpt-noter-flow-ui-copilot-catch-up-ask`

**Actor**: Primary user

**Success Scenarios**:
- **Catch Me Up** or ⌃⌥⌘C brings a Catch-up card to the top with **Being asked now**
- **Ask…** or ⌃⌥⌘A opens **Ask about this call…**; Return produces an Answer with the quoted question and **This call · 00:22:41**

**Error Scenarios**:
- Catch-up still writing: last confirmed lines and **Writing catch-up…**, replaced by the completed summary
- `copilot_off`, `not_recording`, `runtime_unavailable` or retryable failure: show the state or inline error and preserve the question; do not send again automatically

**Steps**:
1. [ ] - `p1` - User requests catch-up from the strip, menu bar or global key; the corresponding core path calls `copilot_catch_up` with the call id once - `inst-catch-up`
2. [ ] - `p1` - UI: a solicited Catch-up arrives on top immediately, including while arrivals are held; show the latest confirmed lines while it streams - `inst-partial`
3. [ ] - `p1` - UI: replace the partial text with the short summary, **Being asked now** and this-call source as updates arrive - `inst-complete`
4. [ ] - `p1` - **IF** the floating panel was collapsed: temporarily expand it for the requested card and return to the strip when that card is dismissed - `inst-temporary`
5. [ ] - `p1` - User opens **Ask…**; UI: make the panel key for typing and focus the question field - `inst-ask-field`
6. [ ] - `p1` - User enters a nonblank question and presses Return; API: `copilot_ask_about_call` with call id and question - `inst-ask-send`
7. [ ] - `p1` - UI: show the solicited Answer first, with the question in quotes and its provenance; **Esc** closes the topmost expansion or field, then returns focus to the call app - `inst-answer`
8. [ ] - `p1` - **RETURN** the solicited card, exempt from unsolicited arrival rate and late-drop limits - `inst-return-asked`

### Mute and read degraded states

- [ ] `p5` - **ID**: `cpt-noter-flow-ui-copilot-mute-status`

**Actor**: Primary user

**Success Scenarios**:
- **Mute Copilot** › **For 10 Minutes**, **For This Call**, **For All Planning Calls** changes the native glyph, banner and collapsed strip together; **Unmute** restores the cards
- A reached budget offers **Raise Cap to $2**; capture and transcript continue

**Error Scenarios**:
- Sensitive and no local model: **Copilot off for this sensitive call (no local model)** instead of a listening line
- Runtime fallback: **Switched to local · trying Claude again in 10 min**; no transcript gap

**Steps**:
1. [ ] - `p1` - User chooses a mute scope in the header or native menu, or presses ⌃⌥⌘K; API: `copilot_mute` with the call id and wanted scope, using ten minutes for the timed action - `inst-mute`
2. [ ] - `p1` - UI: apply returned `CopilotStatus` and later higher-version `copilot:status`; hide cards, number badges and legend, and show the mute banner with **Unmute** - `inst-muted`
3. [ ] - `p1` - UI: the collapsed strip reads **Copilot muted**; the menu has **Unmute** above the mute submenu; native card keys are released by the core - `inst-muted-surfaces`
4. [ ] - `p1` - User selects **Unmute**; API: `copilot_mute` with off scope; a timed mute also clears when the core reports its expiry - `inst-unmute`
5. [ ] - `p1` - Algorithm: present mode, budget and key availability with `cpt-noter-algo-ui-copilot-status` - `inst-status`
6. [ ] - `p1` - **IF** the cap is reached: show **Copilot paused: budget** and **Raise Cap to $2**; user action calls `copilot_raise_budget` with call id and the higher cap - `inst-cap`
7. [ ] - `p1` - **IF** the cap change succeeds: show **Cap raised to $2 for this call** and resume listening from returned state - `inst-cap-raised`
8. [ ] - `p1` - User chooses **Make This Call Sensitive** through the call-window feature; `capture_set_sensitive` makes the mode **Sensitive · local** and the strip says **From now on, nothing from this call leaves this Mac.** - `inst-sensitive`
9. [ ] - `p1` - **RETURN** the current copilot state without changing capture or transcript state - `inst-return-status`

### Change context chips

- [ ] `p5` - **ID**: `cpt-noter-flow-ui-copilot-context`

**Actor**: Primary user

**Success Scenarios**:
- **In context:** shows past calls, carried items and document sections; suggested items say **Not reviewed**

**Error Scenarios**:
- `context_chip_set` returns `feature_disabled` in v1; the prototype's local chip edits cannot be reported as persisted

**Steps**:
1. [ ] - `p1` - UI: render supplied context chips with source glyphs, truncated labels with full help tags, and the pin or **Not reviewed** tag - `inst-chips`
2. [ ] - `p1` - User opens a chip menu with click, Return or Space; ← and → move through the group; Delete selects **Drop from Context** - `inst-chip-menu`
3. [ ] - `p1` - API: `context_chip_set` with context item id and pin, unpin or drop action - `inst-chip-set`
4. [ ] - `p1` - **IF** the result is `feature_disabled`: keep the previous chip state and show the feature-unavailable status; screen picking remains v1.x - `inst-chip-disabled`
5. [ ] - `p1` - **IF** the core supports the action: apply its returned chip; drop shows **Dropped · Undo** only when a core-backed restoration path exists, as required by section 7 - `inst-chip-result`
6. [ ] - `p1` - **RETURN** confirmed context or its explicit contract limitation - `inst-return-context`

## 3. Processes / Business Logic (CDSL)

### Reconcile the card stream

- [ ] `p5` - **ID**: `cpt-noter-algo-ui-copilot-card-stream`

**Input**: `CardsSnapshot`, ordered `CardMsg`, command results, panel hover/focus and layout

**Output**: cards by id, visible order and numbers, earlier cards, pins, held count and paint reports

**Steps**:
1. [ ] - `p1` - Bridge: buffer Channel messages around the snapshot, discard duplicate sequence numbers and apply consecutive messages after `last_seq`; a gap starts snapshot recovery - `inst-sequence`
2. [ ] - `p1` - **FOR EACH** accepted message: match its event - `inst-message`
   1. [ ] - `p1` - **IF** added or updated: replace the card by id; respect queued, streaming, held and pinned states and its assigned number - `inst-upsert`
   2. [ ] - `p1` - **IF** removed or expired: remove it from visible order, retain its known content with outcome in earlier cards, and free its number - `inst-remove`
   3. [ ] - `p1` - **IF** merged: replace merged-agent text on the existing card without adding another badge - `inst-merge`
   4. [ ] - `p1` - **IF** dropped late: do not render or announce a card - `inst-late`
   5. [ ] - `p1` - **IF** key feedback or status: apply action feedback or the highest-version copilot state - `inst-other`
3. [ ] - `p1` - UI: queue unsolicited arrivals while stack hover or panel key holds the stack; never evict a hovered, focused or expanded card; solicited cards take the top available place immediately - `inst-held-arrivals`
4. [ ] - `p1` - UI: show at most three active cards, with 1 below 380 pt, 2 at 380–599 pt and 3 from 600 pt in the floating panel; **1 more** reveals the rest without growing on arrival - `inst-capacity`
5. [ ] - `p1` - **FOR EACH** newly painted live card: call `card_shown` with id and actual paint timestamp, once for that presentation; queued and compact-hidden cards are not yet shown - `inst-painted`
6. [ ] - `p1` - UI: announce type, agent and first sentence up to 100 characters politely; while held, announce the waiting count once; use a live region only when key, native announcement otherwise - `inst-announce`
7. [ ] - `p1` - UI: update age text from `created_at`, secondary body colour from 60 s; expiry comes from the core, not the age timer - `inst-age`
8. [ ] - `p1` - **IF** call id changes or the tree unmounts: release holds, unsubscribe and discard old-call messages; a layout change keeps the same store and subscription - `inst-cleanup`
9. [ ] - `p1` - **RETURN** the reconciled view, preserving pins and numbers on reload from a new snapshot - `inst-return-stream`

### Present copilot status

- [ ] `p5` - **ID**: `cpt-noter-algo-ui-copilot-status`

**Input**: current `CopilotStatus`, capture, presenting state, panel-key state and hotkey settings

**Output**: header, banner, listening line, budget, legend and collapsed card line

**Steps**:
1. [ ] - `p1` - **IF** flag off: omit council column, budget, pins and catch-up; transcript fills the window - `inst-flag`
2. [ ] - `p1` - **ELSE IF** muted: hide cards and show the mute banner with **Unmute**, retaining the prototype's listening line; collapsed view says **Copilot muted** - `inst-mute-view`
3. [ ] - `p1` - **ELSE IF** sensitive with no local model: show **Sensitive · local** and the off message in banner and stack, without the listening line - `inst-sensitive-off`
4. [ ] - `p1` - **ELSE**: show current cards or the listening line, with the effective mode; show local-fallback or budget banner when supplied - `inst-running`
5. [ ] - `p1` - UI: format spend and cap in locale currency, warning at near-cap state; an account's usage limits are not invented dollar charges - `inst-budget`
6. [ ] - `p1` - **IF** keys are registered and Noter is visible: derive legend and help tags from Settings, remove conflicting chords, add dismiss chords only when enabled; panel-local chords use ⌘ and ⌘⇧ - `inst-keys`
7. [ ] - `p1` - **ELSE**: hide legend and number badges together - `inst-no-keys`
8. [ ] - `p1` - **RETURN** consistent status across dedicated, floating, collapsed and native menu surfaces - `inst-return-status-view`

## 4. States (CDSL)

### Card lifecycle

- [ ] `p5` - **ID**: `cpt-noter-state-ui-copilot-card`

**States**: QUEUED, STREAMING, SHOWN, HELD, PINNED, DISMISSED, EXPIRED

**Initial State**: supplied by snapshot or added event

**Transitions**:
1. [ ] - `p1` - **FROM** QUEUED **TO** STREAMING **WHEN** the core admits a partial card after the hold ends - `inst-admit-partial`
2. [ ] - `p1` - **FROM** QUEUED **TO** SHOWN **WHEN** a complete waiting card is admitted - `inst-admit-complete`
3. [ ] - `p1` - **FROM** STREAMING **TO** SHOWN **WHEN** its complete update arrives - `inst-streamed`
4. [ ] - `p1` - **FROM** SHOWN **TO** HELD **WHEN** hover, focus or expansion starts - `inst-held`
5. [ ] - `p1` - **FROM** HELD **TO** SHOWN **WHEN** all three hold reasons end and the core releases the card - `inst-release`
6. [ ] - `p1` - **FROM** SHOWN, STREAMING or HELD **TO** PINNED **WHEN** the core accepts pin; Catch-up has no pin action - `inst-pin`
7. [ ] - `p1` - **FROM** SHOWN, STREAMING or HELD **TO** DISMISSED **WHEN** the core accepts dismiss - `inst-dismiss`
8. [ ] - `p1` - **FROM** QUEUED, STREAMING or SHOWN **TO** EXPIRED **WHEN** core expiry, topic change or late removal arrives; a held card stays until released - `inst-expire`
9. [ ] - `p1` - **FROM** PINNED **TO** SHOWN **WHEN** successful unpin returns a shown card - `inst-unpin`
10. [ ] - `p1` - **FROM** PINNED or DISMISSED **TO** SHOWN or HELD **WHEN** the core accepts undo within 30 s and returns that restored state - `inst-undo`

### Copilot surface

- [ ] `p5` - **ID**: `cpt-noter-state-ui-copilot-surface`

**States**: FLAG_OFF, LISTENING, ACTIVE, MUTED, BUDGET_PAUSED, SENSITIVE_OFF, NO_RUNTIME, ENDED

**Initial State**: current snapshot status

**Transitions**:
1. [ ] - `p1` - **FROM** FLAG_OFF **TO** LISTENING **WHEN** the core enables the flag for a running call - `inst-enabled`
2. [ ] - `p1` - **FROM** LISTENING **TO** ACTIVE **WHEN** the first visible card arrives - `inst-first-card`
3. [ ] - `p1` - **FROM** ACTIVE **TO** LISTENING **WHEN** the last visible card leaves - `inst-empty`
4. [ ] - `p1` - **FROM** LISTENING or ACTIVE **TO** MUTED **WHEN** core mute state is set - `inst-muted`
5. [ ] - `p1` - **FROM** MUTED **TO** ACTIVE or LISTENING **WHEN** unmute or timed expiry returns the retained cards or an empty stack - `inst-unmuted`
6. [ ] - `p1` - **FROM** LISTENING or ACTIVE **TO** BUDGET_PAUSED **WHEN** the budget reaches its cap - `inst-cap-reached`
7. [ ] - `p1` - **FROM** BUDGET_PAUSED **TO** LISTENING or ACTIVE **WHEN** the core resumes under a raised cap - `inst-cap-resume`
8. [ ] - `p1` - **FROM** LISTENING, ACTIVE or BUDGET_PAUSED **TO** SENSITIVE_OFF **WHEN** a sensitive call has no local runtime - `inst-local-missing`
9. [ ] - `p1` - **FROM** LISTENING or ACTIVE **TO** NO_RUNTIME **WHEN** the core reports no usable runtime; show the shared degraded-state reason and Settings fix - `inst-no-runtime`
10. [ ] - `p1` - **FROM** SENSITIVE_OFF or NO_RUNTIME **TO** LISTENING **WHEN** a permitted runtime becomes available - `inst-runtime-back`
11. [ ] - `p1` - **FROM** any live state **TO** FLAG_OFF **WHEN** the core disables the flag - `inst-disabled`
12. [ ] - `p1` - **FROM** any live state **TO** ENDED **WHEN** the call stream ends; retain stored outcomes - `inst-ended`

Switched-to-local is a mode of LISTENING or ACTIVE; holds, key availability and presenting are independent of generation state. Status events always determine the final state when mute, budget and privacy conditions overlap.

## 5. Definitions of Done

### Cards, sources and outcomes

- [ ] `p5` - **ID**: `cpt-noter-dod-ui-copilot-cards`

The system **MUST** render all six card kinds, partial provenance (**Finding the source…**), model guesses (**Model guess · unverified**), merged agents, age, evidence, feedback and read-only outcomes with the prototype's data attributes and styles. It must preserve core identity and numbers across layouts and reload, hold cards while read, and report actual paints. Contract gaps listed in section 7 must be resolved through the protocol owner before affected paths can pass M4 acceptance.

**Implements**:
- `cpt-noter-flow-ui-copilot-read-cards`
- `cpt-noter-flow-ui-copilot-context`
- `cpt-noter-algo-ui-copilot-card-stream`
- `cpt-noter-state-ui-copilot-card`

**Constraints**: `cpt-noter-constraint-copilot-flag`

**Touches**:
- Commands: `cards_subscribe`, `card_set_held`, `card_shown`, `card_rate`, `copilot_mute_agent`, `context_chip_set`
- Data: `cpt-noter-dbtable-cards`, through the core only
- Tests: unit cases for duplicate and missing sequences, merged cards, queued expiry, held eviction, compact paint counts and old-call messages; screenshot states listed in section 7

### Card actions and requested help

- [ ] `p5` - **ID**: `cpt-noter-dod-ui-copilot-actions`

The system **MUST** pin exactly one accepted item per successful action, dismiss and undo with core results, show key conflicts and empty-number feedback, provide the pinned popover and carry-forward actions, and bring solicited cards to the top. Global keys and menu actions must leave focus in the call app; typing **Ask…** is the deliberate key-window path.

**Implements**:
- `cpt-noter-flow-ui-copilot-card-action`
- `cpt-noter-flow-ui-copilot-catch-up-ask`

**Constraints**: `cpt-noter-constraint-copilot-flag`

**Touches**:
- Commands: `card_pin`, `card_dismiss`, `card_unpin`, `card_undo_last`, `copilot_catch_up`, `copilot_ask_about_call`; shared item actions
- Tests: every path of `cpt-noter-seq-call-screen-pin-card` and `cpt-noter-seq-call-screen-catch-up` against the real core; XCUITest `test_cpt_noter_seq_call_screen_pin_card__teams_keeps_focus`; card steps of the M1 display-unplugged and collapsed-strip stories

### Mute, budget and flag layouts

- [ ] `p5` - **ID**: `cpt-noter-dod-ui-copilot-status`

The system **MUST** mirror wanted mute scope, per-agent mute, effective mode and budget across the call layouts and native menu, release the legend and badges with the card keys, show local-only or off state for sensitive calls, and keep the transcript usable with the flag off. Muting and budget exhaustion must never pause capture.

**Implements**:
- `cpt-noter-flow-ui-copilot-mute-status`
- `cpt-noter-algo-ui-copilot-status`
- `cpt-noter-state-ui-copilot-surface`

**Constraints**: `cpt-noter-constraint-copilot-flag`

**Touches**:
- Commands: `copilot_mute`, `copilot_raise_budget`; shared `capture_set_sensitive`
- Tests: every path of `cpt-noter-seq-call-screen-read-copilot-state` and `cpt-noter-seq-menu-bar-mute-copilot`; XCUITest `test_cpt_noter_seq_menu_bar_mute_copilot__keys_released`; real-core M4 command proof, including the v1 limitation on `context_chip_set`

## 6. Acceptance Criteria

- [ ] All four M4 stories and deferred card paths of the two M1 stories pass against the real core; fake-core runs do not count
- [ ] No fourth numbered card, number reassignment while visible, duplicate pin, eviction of a held card or announcement of a late-dropped card
- [ ] New cards never grow the floating panel; below 380 pt it shows one card and the more count; from 380 pt two, from 600 pt three
- [ ] Global pin, dismiss and undo keep Teams key; mute, flag off and presenting release the card keys; dismiss keys default off
- [ ] Catch-up streams confirmed lines before its summary; Answer keeps the quoted question; Esc returns focus without discarding the answer
- [ ] Muted, budget-paused, local fallback, sensitive-off, flag-off and single-agent layouts match the prototype; capture continues through copilot failures
- [ ] Keyboard, VoiceOver, Reduce motion, dark appearance, Increase Contrast and mixed Russian/German/English card language match the shared foundations
- [ ] Contract gaps in section 7 have an agreed core path and real-core tests before their affected UI is called delivered; no local simulation is accepted as persistence
- [ ] Write failing tests before implementation; `just gate-fast` and `just gate` pass with the harness thresholds intact

## 7. Additional Context

**Prototype reuse.** Rewrite `C.copilotCard`, `C.copilotCardStack`, `C.cardLegend`, `C.contextChip` and `C.agentBadge` as React components with the same structure, class names, tokens, `data-component`, `data-variant`, `data-state`, `data-layout` and region attributes. Port `.cw-card*`, `.cw-stack*`, `.cw-legend`, `.cw-cchip`, `.cw-num`, `.cw-peek` and `.np-agent*` styles as-is. Integrate the header, Ask field, pinned popover and `reviewsView` card grid into their existing React frames. The prototype's `cw.*`, timers, sample data, `NP.local`, key simulator and harness bar are source-of-truth examples, replaced by typed core calls and native key feedback. The native menu's drawing is reference only.

**States coverage.**

| DESIGN state | Prototype state or interaction |
| --- | --- |
| No card yet; card too late | `listening`; a late drop leaves the current surface unchanged |
| Fresh, aged, expanded, partial, not reviewed | Card age, body expansion, partial provenance and source tags in `C.copilotCard` |
| Cards held | `held`; **1 new card ▴** |
| Pin, dismiss, undo, unpin; no numbered card | `cw.pin`, `cw.cardDismiss`, `cw.undoCard`, pinned popover, simulated card keys |
| Key taken | `key-taken` |
| Catch-up writing; asked about call | `cw.catchUp`, `cw.ask`, `cw.askSend` |
| Local fallback; near cap then paused | `switched-local`, `budget` |
| Sensitive off; made sensitive | `sensitive-off`; header action |
| Muted; collapsed muted | `muted`; collapsed layout with mute |
| Single agent; flag off | `single`, `copilot-off` |
| Carry-forward | `carry`; handoff and evidence-closure actions |
| Display change; compact count; peek | `unplugged`, floating height controls, `collapsed` |
| Read-only outcomes | `reviewsView` and **Earlier cards** |
| Chip menu, pinned, dropped | `C.contextChip`, `cw.chipPin`, `cw.chipDrop`, `cw.chipUndo` |

**DESIGN versus prototype.** The prototype is the visual reference. Its muted stack retains the listening line, following the component state even though the screen table only names the banner. Its card arrival and undo helpers do not enforce held-card safety or the 30-second window; DESIGN's production rules and the core own these. The prototype hardcodes key strings, **Planning**, dollar amounts and mute duration; production renders current contract state and configured chords. These are simulation limits, not new product choices.

**Contract and fake-core gaps before freeze.**

- DESIGN and the prototype allow **Pin** on Earlier cards. The fake rejects pin for dismissed or expired cards with `card_gone`. Stored cards cannot be loaded by the main window: `cards_subscribe` is allowed only in `call-screen`, and the Call/Outputs views do not expose their card list. Do not invoke a forbidden command from main or copy live fixtures into PC-R7; the core owner must supply the stored read path and earlier-pin behaviour.
- Context-chip menus are present for ordinary context in DESIGN and the prototype. The contract labels `context_chip_set` v1.x and the fake always returns `feature_disabled`; there is no context-list snapshot or restore-drop action. The component and refusal path can be specified now, but ordinary chip persistence and **Dropped · Undo** cannot be completed against this contract. A rejected call does not count as a successful frozen command in HARNESS.
- The protocol has a held setter per card but no stack-held or insert-queue command. Queueing can protect the rendered stack locally; the owner must settle how authoritative numbers, expiry and native number keys stay consistent with that queue, especially when the panel is key or all three slots are held. Do not register a second UI-owned global key handler.
- `CardView` has body and provenance but no separate **Why now** or expanded quote field. Render only supplied content, using the existing evidence preview for a source quote; the prototype's fixed quote and rationale cannot become real card content. The owner must agree how the full expanded content is delivered.
- The fake pin leaves the card numbered, and catch-up/Ask insert number 1 without resolving an occupied number or completing streamed text. Its mute has no automatic expiry and held setter has no queue release. Use injected Channel/status scenarios for UI tests, and verify actual numbering, accepted items, timers and stream completion against the real core before freeze.

**Errors and data.** The bridge maps `CoreError.code` and typed detail, never its developer message; retryable errors offer **Try Again** only on user action. A failed mutation leaves the previous confirmed record. Ratings, item edits and undo remain core-owned and auditable; UI logs contain identifiers and timings, never transcript or skill text. Render supplied text safely. Unsubscribe and clear paint/age work on call change; use the bridge's buffered stream rather than per-token renders.

**Not applicable.** Database queries, migrations, cloud authentication, retrieval, model sessions, rate limiting and expiry policy are core responsibilities. Screen picking and OCR are v1.x. New APIs, permissions, infrastructure and regulatory policy are not introduced by this UI feature.
