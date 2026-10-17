---
title: "Feature — Today dashboard"
description: "Show calendar calls and their open items, tick work with Undo and return to recording."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-today
milestone: M2
---

# Feature: Today dashboard

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Prepare from today's calls](#prepare-from-todays-calls)
  - [Tick an item and take back a mistake](#tick-an-item-and-take-back-a-mistake)
  - [Record or return to interrupted capture](#record-or-return-to-interrupted-capture)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Project the day without reranking](#project-the-day-without-reranking)
- [4. States (CDSL)](#4-states-cdsl)
  - [Calendar region](#calendar-region)
  - [Call card disclosure](#call-card-disclosure)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Calendar, cards and recovery](#calendar-cards-and-recovery)
  - [Done today and Undo](#done-today-and-undo)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p3` - **ID**: `cpt-noter-featstatus-ui-today`

## 1. Feature Context

- [ ] `p3` - `cpt-noter-feature-ui-today`

### 1.1 Overview

Today is the main window's starting page. It shows calendar calls with what is owed to their participants, this week's calls, due items without a call, proposals waiting and Done today. Ranking and calendar reads belong to the core; Today keeps only disclosures, row focus and selection. Proposal decisions and Activity navigation ship in M5; person pages and Library search ship in M3.

### 1.2 Purpose

It implements `cpt-noter-component-screen-today` and `cpt-noter-component-ui-upcoming-call-card`, with Record, setup/recovery banners and review links.

**Requirements**: PRD › Feature specification › 13. Today dashboard; Problem, users and jobs to be done › Before a call. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-core-owns-state`, `cpt-noter-principle-evidence-one-click`, `cpt-noter-principle-keyboard-first`, `cpt-noter-principle-degrade-visibly`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Prepares for a call, ticks items, opens evidence and resumes recording |
| Noter core (system) | Reads EventKit, orders events and items, reports capture and setup state |
| macOS (system) | Asks for Calendar access after the user's action |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 13
- **Design**: [DESIGN.md](../../DESIGN.md) › Today TD-R1–TD-R8, Upcoming call card, Main window banners and Today stories
- **Decomposition**: [DECOMPOSITION.md](../../DECOMPOSITION.md) › 2.20, M2, NOT_STARTED
- **Design elements**: `cpt-noter-component-screen-today`, `cpt-noter-component-ui-upcoming-call-card`
- **Stories**: `cpt-noter-seq-today-review-before-call`, `cpt-noter-seq-today-tick-item` (M2, every path)
- **Frozen commands it delivers (M2)**: `today_get`; uses M2 `item_set_done`, `item_answer_handoff_landed`, `change_undo` through Items and History
- **Other commands it calls**: `capture_start`, `capture_resume_interrupted`, `window_show_call`, `window_navigate`, `permission_request` (calendar), `open_external`, `banner_dismiss`, `call_update`, `capture_set_sensitive`, `call_types_list`; setup/self-test actions use their existing feature services
- **Events**: `entity:changed`, `capture:state`, `env:changed`, `settings:changed`, `nav:request`; shared setup state
- **Contract**: `apps/desktop/src/core/bindings.ts` › TodayView, CalendarAccess, UpcomingCall, TodayBanner; `apps/desktop/src/core/fake/handlers.ts` and `fake-core.ts`
- **Prototype modules**: `src/js/10-a-today.js` › `screen('today')`, `STATES`; `src/js/10-a-components.js` › `C.upcomingCallCard`, `NP.A.itemRow`; `src/css/10-a.css` › `.td-*`
- **Dependencies**: `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-items`, `cpt-noter-feature-ui-call-window`, `cpt-noter-feature-ui-first-run`; Undo uses History through Items

## 2. Actor Flows (CDSL)

### Prepare from today's calls

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-today-review`

**Actor**: Primary user

**Success Scenarios**:
- **Today · 3 calls** lists calls in calendar order; next expanded, later cards collapsed with open counts. Last time links to the previous Summary.
- ↓ and Return on Anna's row opens the 9 Oct call's Transcript evidence; ⌘[ restores Today and its row position.
- No calls today: the secondary line replaces today's cards; This week, due items and proposals remain usable.

**Error Scenarios**:
- Calendar not asked: **See today's calls here** and **Allow Calendar Access**; no count and no This week.
- Denied: **Calendar access is off · Open System Settings…**; due items and proposals replace calendar regions.
- Failed read: **Couldn't read today's calendar. · Try Again**; retry shows two loading cards.

**Steps**:
1. [ ] - `p1` - User opens Today; API: `today_get` with no args; after 300 ms show two non-shimmering skeleton cards; a command-level calendar_unavailable error uses the same retryable calendar-error region - `inst-get`
2. [ ] - `p1` - **MATCH** CalendarAccess - `inst-calendar`
   1. [ ] - `p1` - **CASE** not_asked: show the empty-state explanation; only Allow Calendar Access calls `permission_request` for calendar, then refresh Today after the answer - `inst-ask`
   2. [ ] - `p1` - **CASE** denied: show the Calendar warning and Open System Settings… through `open_external`; refresh on return to Today - `inst-denied`
   3. [ ] - `p1` - **CASE** read_failed: retain non-calendar regions, show the read error and retry `today_get` only after Try Again - `inst-failed`
   4. [ ] - `p1` - **CASE** granted: render today's events, or No calls today, plus This week - `inst-allowed`
3. [ ] - `p1` - Render core-ranked open actions and questions in each card, at most five before Show More; next call is expanded and later calls can expand/collapse in place - `inst-cards`
4. [ ] - `p1` - Render TD-R5 due_without_call, TD-R6 at most three proposal previews, TD-R7 Done today disclosure and TD-R8 while review is waiting - `inst-regions`
5. [ ] - `p1` - Review links open the corresponding Call page Summary with Start Review applied; evidence and Last time use typed routes, preserving the Today return state - `inst-links`
6. [ ] - `p1` - Card More offers Call Type, Mark as Sensitive and Show Previous Call; apply changes through existing call/capture commands and refresh the card, showing Local only after attendees - `inst-menu`
7. [ ] - `p1` - **RETURN** Today with core order, plural counts and each row's language, or the calendar-specific empty/error state - `inst-return`

### Tick an item and take back a mistake

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-today-tick`

**Actor**: Primary user

**Success Scenarios**:
- Space or checkbox shows strike-through and Done · Undo, then moves the item to Done today and reduces its card's open count.
- A suggested item reads Accepted and done · Undo; Done today retains Undo after the inline message expires.

**Error Scenarios**:
- Handed-off item expands Did the handoff land?; Yes, Landed completes, Done Another Way records that outcome, Keep Open or Esc preserves it.
- First use: **Nothing open yet · Items from your calls appear here. Noter offers to record when a call starts.**

**Steps**:
1. [ ] - `p1` - User moves between compact rows with ↑/↓; Space delegates to the Items completion flow with item id and current rev - `inst-tick`
2. [ ] - `p1` - For an open handoff, wait for the explicit answer through `item_answer_handoff_landed`; show no done outcome for Keep Open - `inst-handoff`
3. [ ] - `p1` - On success show the returned row state and 10-second inline Undo; refresh `today_get` for every card, due list and Done today affected by that item - `inst-refresh`
4. [ ] - `p1` - User chooses Undo on the outcome, in Done today, or ⌘Z; History sends the corresponding change target and refreshes the lists after success - `inst-undo`
5. [ ] - `p1` - **IF** the write fails or conflicts: keep the row where it was, show the error and refresh the current item before an explicit retry - `inst-error`
6. [ ] - `p1` - **RETURN** the item in the core's open or done grouping, with focus on that item or its containing disclosure after it moves - `inst-return`

### Record or return to interrupted capture

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-today-capture`

**Actor**: Primary user

**Success Scenarios**:
- Record starts capture regardless of unfinished setup or self-test; during capture the toolbar indicator and live card open the call window without taking call-app focus.
- After a quit, Open Call opens saved Transcript; Resume Recording appends to the same call with a gap.

**Error Scenarios**:
- Speech model missing or less than 500 MB free dims Record with its reason. Other missing permissions degrade capture visibly.
- Engine stopped banner offers Try Again for the same call; starting another capture or dismissing the interrupted banner ends Resume's offer.

**Steps**:
1. [ ] - `p1` - User chooses Record; call `capture_start` with the existing start arguments; model_missing, disk_full and already_recording use the established capture error states - `inst-start`
2. [ ] - `p1` - While capturing show the live card first, or Recording with app and elapsed time if no calendar match; Open Call Screen and the toolbar indicator invoke `window_show_call` - `inst-live`
3. [ ] - `p1` - While self-test has not passed show Call detection is off until the audio self-test passes, Run Audio Self-Test… and Finish Setup…; these open existing setup surfaces without replacing Record - `inst-setup`
4. [ ] - `p1` - After a quit show the returned call title and saved timestamp with Open Call, Resume Recording and ×; Open Call routes to Transcript - `inst-quit`
5. [ ] - `p1` - Resume Recording calls `capture_resume_interrupted` for that call; render the existing transcript and gap from the core, then show the call window - `inst-resume`
6. [ ] - `p1` - **IF** × is clicked: `banner_dismiss` ends the resume offer; a new capture removes the old offer through core state - `inst-dismiss`
7. [ ] - `p1` - **RETURN** capture state; engine-stopped Try Again uses the same-call recovery service from the call-window feature - `inst-return`

## 3. Processes / Business Logic (CDSL)

### Project the day without reranking

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-today-project`

**Input**: TodayView, current capture/setup state, per-event disclosure state, main-window size class

**Output**: Today regions, card variants and focus order

**Steps**:
1. [ ] - `p1` - Preserve the core's event and ranked-item order; move only the matching live card to the top; create the unmatched-live presentation from live_call when no calendar event matches - `inst-order`
2. [ ] - `p1` - Reconcile disclosures by opaque event id, keeping a user's expanded later card across refreshes; show five combined action/question rows until Show More - `inst-disclosures`
3. [ ] - `p1` - Wide uses full-width review/cards then left This week, due and Done today with proposals right; Medium/Narrow use review, cards, due, proposals, This week, Done today - `inst-layout`
4. [ ] - `p1` - Keep one highest-severity banner and +More via shell service; setup never gates Record except the model/disk blockers - `inst-banner`
5. [ ] - `p1` - Render empty lines Nothing due without a call, Nothing waiting. Noter asks before it changes older records., and Nothing ticked today where their collections are empty - `inst-empty`
6. [ ] - `p1` - Refresh on relevant entity, capture, permission and ranking changes; discard superseded reads and coalesce simultaneous refresh requests through the existing store - `inst-refresh`
7. [ ] - `p1` - **RETURN** the day; do not manufacture counts, participants, speaker-review totals or proposal decisions from sample data - `inst-return`

## 4. States (CDSL)

### Calendar region

- [ ] `p1` - **ID**: `cpt-noter-state-ui-today-calendar`

**States**: LOADING, NOT_ASKED, ASKING, DENIED, READY, NO_CALLS, ERROR

**Initial State**: LOADING

**Transitions**:
1. [ ] - `p1` - **FROM** LOADING **TO** NOT_ASKED, DENIED, READY, NO_CALLS, ERROR **WHEN** today_get returns the corresponding calendar result - `inst-read`
2. [ ] - `p1` - **FROM** NOT_ASKED **TO** ASKING **WHEN** Allow Calendar Access is clicked outside capture - `inst-ask`
3. [ ] - `p1` - **FROM** ASKING **TO** LOADING **WHEN** permission_request settles; re-read the actual permission - `inst-answer`
4. [ ] - `p1` - **FROM** DENIED **TO** LOADING **WHEN** Today is revisited after System Settings changes - `inst-settings`
5. [ ] - `p1` - **FROM** ERROR **TO** LOADING **WHEN** Try Again is chosen - `inst-retry`
6. [ ] - `p1` - **FROM** READY, NO_CALLS **TO** LOADING **WHEN** the date or calendar environment changes - `inst-date`

### Call card disclosure

- [ ] `p1` - **ID**: `cpt-noter-state-ui-today-card`

**States**: COLLAPSED, EXPANDED, ALL_ROWS, LIVE

**Initial State**: EXPANDED for next call; COLLAPSED for later/week calls; LIVE for the recording

**Transitions**:
1. [ ] - `p1` - **FROM** COLLAPSED **TO** EXPANDED **WHEN** its disclosure is invoked - `inst-expand`
2. [ ] - `p1` - **FROM** EXPANDED **TO** COLLAPSED **WHEN** Collapse is invoked on a later/week card - `inst-collapse`
3. [ ] - `p1` - **FROM** EXPANDED **TO** ALL_ROWS **WHEN** Show More is invoked - `inst-more`
4. [ ] - `p1` - **FROM** COLLAPSED, EXPANDED, ALL_ROWS **TO** LIVE **WHEN** capture matches this call; retain disclosure state - `inst-live`
5. [ ] - `p1` - **FROM** LIVE **TO** EXPANDED **WHEN** capture ends and the refreshed calendar still contains the call - `inst-stop`

## 5. Definitions of Done

### Calendar, cards and recovery

- [ ] `p3` - **ID**: `cpt-noter-dod-ui-today-dashboard`

The system **MUST** render TD-R1–TD-R8 from TodayView, preserve ranked order, disclosures and return navigation, ask Calendar permission only on demand outside capture, and keep Record and recovery actions consistent with capture state.

**Implements**:
- `cpt-noter-flow-ui-today-review`
- `cpt-noter-flow-ui-today-capture`
- `cpt-noter-algo-ui-today-project`
- `cpt-noter-state-ui-today-calendar`
- `cpt-noter-state-ui-today-card`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `today_get`, calendar `permission_request`, capture and navigation commands listed above
- Tests: unit ordering/disclosures, permission states, empty regions, banner priority, stale read and responsive layout; conformance TodayView and environment refresh; real-core E2E `cpt-noter-seq-today-review-before-call` (every path); native `test_cpt_noter_seq_today_review_before_call` for calendar prompt and call-window focus; screenshots of every STATES entry

### Done today and Undo

- [ ] `p3` - **ID**: `cpt-noter-dod-ui-today-items`

The system **MUST** reuse the Items completion/answer flow and History Undo, show accurate counts in every instance, keep Done today accessible after feedback expires and retain focus when an item moves.

**Implements**:
- `cpt-noter-flow-ui-today-tick`

**Constraints**: `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `item_set_done`, `item_answer_handoff_landed`, `change_undo`, `today_get`
- Tests: unit suggested tick, three handoff answers, row movement and focus, Done disclosure and 10-second feedback; real-core conformance of regrouping and undo; E2E `cpt-noter-seq-today-tick-item` (every path); screenshots done, handoff question, first use and nothing waiting

**Completion gate.** Write failing tests first; unit and changed-line coverage meet 80% per side. Fake and real conformance must pass; only successful frozen commands and named stories against real core count toward 60%. Screenshots meet 98%; due performance coverage meets 60% and scenarios stay within 10% of base instruction counts. Trace never falls. `just gate-fast` stays green; `just gate` passes.

## 6. Acceptance Criteria

- [ ] Calendar permission is never requested on launch or during capture
- [ ] Next call expands, later/week cards disclose, Show More reveals rows without changing core ranking
- [ ] Calendar failures leave due items and proposals usable; retries show two loading cards
- [ ] Suggested ticks accept and complete; open handoffs wait for an answer; Undo restores the original state
- [ ] Record remains available with unfinished setup; model/disk blockers show their reasons
- [ ] Live and interrupted calls open the right call window or Transcript without stealing call-app focus

## 7. Additional Context

**Prototype reuse.** Rewrite `screen('today')` as TodayPage and `C.upcomingCallCard` as UpcomingCallCard; `NP.A.itemRow` delegates to the shared compact ActionItemRow, with no fallback copy. Port `.td-*` from `10-a.css` and use shared tokens/icons. Keep stable data-component/variant/state/region attributes. `03-data.js`, `STATES` toggles and prototype capture/calendars are source-of-truth examples only. The toolbar date comes from real core date and locale, not Thursday 16 October 2026. Narrow replaces attendees with text; long item text tail-truncates with help tags; buttons retain labels. Search, Record, banner, review links, card menus/rows, week, due, proposals and Done follow DESIGN focus order; rows use one roving focus. Status updates are polite; Reduce motion removes item moves and disclosure animation.

**States coverage.** Prototype `STATES`: default, first-use, calendar-not-asked, calendar-denied, no-calls, loading, calendar-failed, self-test, model-missing, engine-stopped, quit-recording, nothing-to-review, live, unmatched-live, open-handoff, evidence-failed. Empty due/waiting/done regions and sensitive tags are interaction/data variants. Evidence failures retain the shared Item inspector's source state.

**DESIGN versus prototype.** Prototype TD-R8 adds two suggestions and a Backend call and hardcodes two unnamed speakers; production never adds those numbers. Prototype tick mutates fixture items, while today_get returns a static fixture grouping: real-core tests must prove cross-card counts and Done today updates. Prototype proposals include live Accept/Reject and Show All in Activity, but their commands/page are M5; M2 keeps the waiting preview and does not expose a working decision or dead route. Search/person links become active when their M3 routes are delivered. Compact row review and evidence use the shared components, not Group A's simplified fallbacks. Narrow layout and full keyboard behaviour missing from the prototype follow DESIGN.

**Contract limits.** TodayView has a review_waiting count but no per-call review links or unnamed-speaker total; UpcomingCall can supply call references but calendar-only events may not have them. Exact TD-R8 details need core data, not invented fixture counts. Sensitive/type mutations of a future calendar-only event have no event-targeted command; use existing call ids only and leave the unsupported future-event controls as an owner contract gap. This does not add an API. Decomposition discrepancy 8 is resolved by moving the existing self-test banner into Today's shell banner slot in M2.

**Not applicable.** The UI owns no tables, EventKit access, ranking implementation, proposal job, credential, migration or network integration. It reads every record through the bridge and logs no calendar titles or participant names.
