---
title: "Feature — Performance"
description: "Period and call-type targets, stage timelines, bottlenecks, Call performance and the improvement brief for Claude Code or Codex."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-performance
milestone: M5
---

# Feature: Performance


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Find a bottleneck](#find-a-bottleneck)
  - [Inspect Call performance](#inspect-call-performance)
  - [Recover a failed roll-up](#recover-a-failed-roll-up)
  - [Export or open an improvement brief](#export-or-open-an-improvement-brief)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Present metrics without recomputing them](#present-metrics-without-recomputing-them)
  - [Filter bottlenecks](#filter-bottlenecks)
- [4. States (CDSL)](#4-states-cdsl)
  - [Performance scope](#performance-scope)
  - [Improvement brief](#improvement-brief)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Targets and bottlenecks](#targets-and-bottlenecks)
  - [Call performance](#call-performance)
  - [Improvement brief and verification](#improvement-brief-and-verification)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p6` - **ID**: `cpt-noter-featstatus-ui-performance`

## 1. Feature Context

- [ ] `p6` - `cpt-noter-feature-ui-performance`

### 1.1 Overview

Performance (⌘8) shows six target tiles, the copilot stage timeline, ranked bottlenecks, quality, cost and a read-only improvement brief. Period and call type select the data; a metric or stage narrows the bottleneck list; an example opens Call performance with its ticks and card outcomes. The brief can be copied, saved or opened in Claude Code or Codex in the mapped Noter repository, with its first prompt filled in and not sent.

### 1.2 Purpose

It implements `cpt-noter-component-screen-performance` (including Call performance), `cpt-noter-component-ui-metric-tile`, `cpt-noter-component-ui-stage-timeline` and `cpt-noter-component-ui-bottleneck-row`. The core measures and aggregates; the UI renders the returned values and states. Targets come only from the PRD, never from fixture literals or a UI calculation. Wall-clock measurement and the performance harness are outside this feature.

**Requirements**: PRD › Feature specification › 12. Performance and continuous improvement; Success metrics and quality bars; Live copilot › Latency budget; Live copilot loop › Where the time goes. The PRD has no requirement IDs.

**Principles**: none newly allocated in DECOMPOSITION; follows `cpt-noter-principle-core-owns-state` and `cpt-noter-principle-accessible-multilingual` through its dependencies.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Inspects missed targets, opens a call's timings and hands off an improvement brief |
| Noter core (system) | Reads local metrics, rolls them up, generates the brief and runs the shared handoff launcher |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 12; Success metrics and quality bars; Live copilot loop; Handoff prompts and improvement briefs
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Screen — Performance (PF-R1 to PF-R5, Call performance, States); Components — Metric tile, Stage timeline, Bottleneck row; Screen — Dialogs (Export Improvement Brief); Screen — Settings window (Performance and Repositories)
- **Design elements**: `cpt-noter-component-screen-performance`, `cpt-noter-component-ui-metric-tile`, `cpt-noter-component-ui-stage-timeline`, `cpt-noter-component-ui-bottleneck-row`; reuses `cpt-noter-component-ui-prompt-editor`, `cpt-noter-component-ui-empty-state`, `cpt-noter-component-ui-inline-banner`, `cpt-noter-component-ui-inline-status`, `cpt-noter-component-screen-dialogs`
- **Stories delivered (M5)**: `cpt-noter-seq-performance-find-bottleneck`, `cpt-noter-seq-performance-export-brief` (all paths)
- **Commands delivered (M5)**: `perf_overview`, `perf_call`, `perf_brief`. All three are **draft** in bindings.ts, pending the M5 gate; no currently frozen Performance command is assigned here
- **Earlier commands reused**: `call_types_list`, repository reads and mapping through Settings, `settings_get`, `settings_set`, `window_navigate`; the M5 Activity feature's `jobs_list` and `job_run_now` serve **Run Now** for a failed roll-up, not a second Performance-owned command set
- **Events**: `settings:changed`, `jobs:progress`, `banners:changed`, `entity:changed`; navigation through the shell and the existing bridge
- **Data**: read through the core only; `cpt-noter-dbtable-metrics`, `cpt-noter-dbtable-llm-runs` belong to [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md). Metric, roll-up and model-run records use generated types; the UI writes no database
- **Prototype modules**: `src/js/50-e-3-performance.js` (`screen('performance')`, Call performance), `src/js/50-e-1-components.js` (`C.metricTile`, `C.stageTimeline`, `C.bottleneckRow`), `src/js/30-c-dialogs.js` (`dlg-brief`), `src/css/50-e.css` (`.pf-*`, `.e-tile*`, `.e-stl*`, `.e-mini*`, `.e-bn*`)
- **Dependencies**: `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-handoff`, `cpt-noter-feature-ui-settings`
- **Manifest**: [DECOMPOSITION.md](../../DECOMPOSITION.md) › 2.30; [milestones.toml](../../../harness/milestones.toml) › M5

## 2. Actor Flows (CDSL)

### Find a bottleneck

- [ ] `p6` - **ID**: `cpt-noter-flow-ui-performance-bottleneck`

**Actor**: Primary user

**Success Scenarios**:
- `cpt-noter-seq-performance-find-bottleneck`: **7 Days**, **Answer card** at **9.8 s** against **≤ 9 s**, the **Claude first token** stage at **4.4 s / 1.5**, then the session-reset bottleneck's example call
- A second click or **Clear** removes the tile filter; a stage click toggles its stage filter with **Show All** on Bottlenecks

**Error Scenarios**:
- No calls: **Performance appears after your first call.** with the machine subtitle kept
- Insufficient data: **Not enough data** · **Needs 3 more calls** replaces the value and trend on those tiles; **Last Call** uses only that call's values without a trend
- No matching bottleneck: **No bottleneck for this filter.**; **Clear** or **Show All** recovers the list

**Steps**:
1. [ ] - `p6` - User opens Performance through the sidebar, ⌘8 or **Show in Performance** from Settings - `inst-open`
2. [ ] - `p6` - API: `perf_overview` with period `days7` and no call_type; read call types through `call_types_list` and repository readiness through the existing Settings bridge - `inst-read`
3. [ ] - `p6` - UI: show the machine profile in PF-R1; map **Last Call**, **7 Days**, **30 Days** to `last_call`, `days7`, `days30`; **All calls** uses a null call_type - `inst-toolbar`
4. [ ] - `p6` - **IF** the overview is pending for 300 ms: show six skeleton tiles; **IF** it fails, keep the selected scope and show a section-level error with **Try Again**, never automatic retry - `inst-loading-error`
5. [ ] - `p6` - **IF** no calls are measured - `inst-if-empty`
   1. [ ] - `p6` - UI: replace PF-R2 to PF-R5 with **Performance appears after your first call.** and **Noter measures every stage of each call on this Mac and compares it with the targets in the PRD.** - `inst-empty`
   2. [ ] - `p6` - **RETURN** the empty page until a new read reports measurements - `inst-return-empty`
6. [ ] - `p6` - UI: render tiles, stages, ranked bottlenecks, Quality, Cost and the brief from the core's scope result; use `cpt-noter-algo-ui-performance-metric-presentation` - `inst-render`
7. [ ] - `p6` - User changes period or call type; API: `perf_overview` for that exact pair; refresh every block and the brief, ignoring older scope responses - `inst-scope`
8. [ ] - `p6` - User chooses **Answer card**; UI: toggle its selection, clear any stage selection and add **· filtered to Answer card** with **Clear** beside **Targets · p95 over the period** - `inst-tile`
9. [ ] - `p6` - User chooses a stage; UI: toggle its selection and **Show All**, then apply `cpt-noter-algo-ui-performance-filter-bottlenecks` - `inst-stage`
10. [ ] - `p6` - User opens an example link; push Call performance for that call, retaining the overview's scope, filters and scroll for Back - `inst-example`
11. [ ] - `p6` - **RETURN** the selected scope and bottleneck or the pushed call view - `inst-return`

### Inspect Call performance

- [ ] `p6` - **ID**: `cpt-noter-flow-ui-performance-call`

**Actor**: Primary user

**Success Scenarios**:
- An example call or Call page ⋯ › **Show Performance** opens its tick table; **Over budget only** leaves late ticks, each with a mini stage timeline and card outcome
- **Open Call** opens that call's page; Back returns to the caller's view

**Error Scenarios**:
- No matching tick: **No ticks over budget in this call** · **Show All Ticks**
- The call was deleted (`not_found`): a safe page-level error and Back, with no stale call data shown as current

**Steps**:
1. [ ] - `p6` - User opens Call performance with a call id; API: `perf_call` with that id - `inst-read`
2. [ ] - `p6` - UI: show the call title, date, length and **Call performance** subtitle, **Open Call**, and the **Over budget only** checkbox above the table - `inst-head`
3. [ ] - `p6` - **FOR EACH** tick returned for this call - `inst-ticks`
   1. [ ] - `p6` - UI: show its number, time, trigger, total, mini stage timeline and card outcome; mark late ticks **over budget**, and distinguish dropped from shown cards - `inst-row`
4. [ ] - `p6` - User checks **Over budget only**; UI: filter by the returned late state, preserving the full tick set and its order - `inst-filter`
5. [ ] - `p6` - **IF** no ticks remain: show **No ticks over budget in this call** and **Show All Ticks**, which unchecks the filter - `inst-empty`
6. [ ] - `p6` - UI: show the call/date/length footnote and the returned count of ticks with a card or a drop; no guessed totals or missing-stage timing values - `inst-footnote`
7. [ ] - `p6` - User chooses **Open Call**; push the existing Call page route for the same id - `inst-open-call`
8. [ ] - `p6` - **IF** the read fails: show the named error and retry that read only on **Try Again**; ignore results after leaving this call - `inst-error`
9. [ ] - `p6` - **RETURN** the full or late-only tick table - `inst-return`

### Recover a failed roll-up

- [ ] `p6` - **ID**: `cpt-noter-flow-ui-performance-rollup`

**Actor**: Primary user

**Success Scenarios**:
- **Last night's roll-up failed** · **Run Now** shows progress, then refreshes all blocks with yesterday's calls and removes the banner

**Error Scenarios**:
- `job_blocked`: the run waits until capture ends; the failure banner stays until a successful roll-up read
- The run fails again: retain the failed state and **Run Now**; no success flash merely because the command was accepted

**Steps**:
1. [ ] - `p6` - UI: when roll_up_failed or the matching core banner is set, show one **Last night's roll-up failed** banner with **Run Now** in MW-R5 - `inst-banner`
2. [ ] - `p6` - User chooses **Run Now**; API: `jobs_list` to resolve the job whose kind is `metrics_roll_up`, then `job_run_now` with its opaque job id - `inst-run`
3. [ ] - `p6` - UI: follow that accepted run id through `jobs:progress`; retain existing metrics as the last available data, with progress in the banner - `inst-progress`
4. [ ] - `p6` - **IF** the job is blocked by capture: show the shared **Jobs wait until the call ends** state; do not queue a retry in the WebView - `inst-blocked`
5. [ ] - `p6` - **IF** the run succeeds - `inst-if-success`
   1. [ ] - `p6` - API: reread `perf_overview` for the current period and call type; refresh all blocks together and clear the banner only when core state confirms the failure resolved - `inst-refresh`
6. [ ] - `p6` - **ELSE IF** starting or running fails: keep the banner with its safe error and explicit retry - `inst-failure`
7. [ ] - `p6` - **RETURN** current metrics and the confirmed roll-up state - `inst-return`

### Export or open an improvement brief

- [ ] `p6` - **ID**: `cpt-noter-flow-ui-performance-brief`

**Actor**: Primary user

**Success Scenarios**:
- `cpt-noter-seq-performance-export-brief`: **Export Improvement Brief…** shows the period, included metrics and Markdown preview, then **Open in Claude Code** opens the Noter repository with the prompt filled in, awaiting Return
- **Copy as Prompt** copies Markdown and shows **Copied** for 2 s; **Save as Markdown…** uses the core's native save panel; Codex uses the same launcher boundary

**Error Scenarios**:
- **No repository mapped for Noter** disables both Open buttons and offers **Add Mapping…**; Copy and Save remain usable
- **Couldn't open Claude Code** keeps the preview and **Copy as Prompt** in the sheet; cancellation changes nothing

**Steps**:
1. [ ] - `p6` - User chooses **Export Improvement Brief…** in PF-R1 or **Preview** in PF-R5 - `inst-open`
2. [ ] - `p6` - UI: attach the 640-pt Export Improvement Brief sheet under the toolbar; show Period, Metrics, a read-only Markdown preview, Cancel, **Copy as Prompt**, **Save as Markdown…**, **Open in Codex** and **Open in Claude Code** - `inst-sheet`
3. [ ] - `p6` - Core: provide the selected scope's brief with each off-target metric's target, actual, trend, component/stage bottleneck, evidence samples and proposed change; preview/copy and sheet-scope gaps are listed below - `inst-preview`
4. [ ] - `p6` - User changes the supported period or included metrics; regenerate the core preview for that selection before enabling export, never reuse a preview from a different scope - `inst-selection`
5. [ ] - `p6` - **IF** the user chooses **Copy as Prompt** - `inst-if-copy`
   1. [ ] - `p6` - UI: copy the complete core-generated Markdown through the existing plain-text clipboard facility; show **Copied** and announce it politely only after the copy succeeds - `inst-copy`
6. [ ] - `p6` - **ELSE IF** the user chooses **Save as Markdown…** - `inst-if-save`
   1. [ ] - `p6` - API: `perf_brief` with the supported period, call_type and action `save_file`; the core presents the save panel and returns the written path; cancellation leaves the sheet open - `inst-save`
7. [ ] - `p6` - **ELSE IF** the user chooses an Open action - `inst-if-open`
   1. [ ] - `p6` - **IF** Noter's repository mapping is absent: disable both Open actions and show **No repository mapped for Noter** · **Add Mapping…** - `inst-no-map`
   2. [ ] - `p6` - User chooses **Add Mapping…**; open Settings › Repositories with its Add Mapping sheet prefilled for Noter; after the core saves it, reread mapping readiness and enable Open in the original brief sheet - `inst-mapping`
   3. [ ] - `p6` - API: `perf_brief` with period, call_type and action `open_in` for `claude_code` or `codex`; the core writes the prompt and launches through the shared handoff launcher - `inst-launch`
   4. [ ] - `p6` - **IF** `repo_not_mapped` or `repo_path_missing`: keep the brief and offer the existing mapping repair path, without a launch - `inst-map-error`
   5. [ ] - `p6` - **IF** `no_link_handler`, `automation_denied` or launch failure: keep **Couldn't open Claude Code** (or Codex) with **Copy as Prompt**; no retry without a user action - `inst-launch-error`
8. [ ] - `p6` - **IF** generation or copy fails: keep the selected scope and readable preview if still valid, show the error inline and allow explicit retry of only the failed action - `inst-error`
9. [ ] - `p6` - **RETURN** saved Markdown, copied prompt or a confirmed launch; closing the sheet restores focus to its opener - `inst-return`

## 3. Processes / Business Logic (CDSL)

### Present metrics without recomputing them

- [ ] `p6` - **ID**: `cpt-noter-algo-ui-performance-metric-presentation`

**Input**: the core's MetricTile, stage and scope records, configured thresholds, locale and selected tile/stage

**Output**: tile grid and aggregate/mini timeline with text and accessible states

**Steps**:
1. [ ] - `p6` - Render **Hypothesis lag**, **Answer card**, **Confirmed text lag**, **Outputs ready, cloud**, **Calls without dropouts**, **Cloud requests logged** in the prototype's order; use returned target and state, with no fixture fallback - `inst-tiles`
2. [ ] - `p6` - **FOR EACH** tile - `inst-each-tile`
   1. [ ] - `p6` - Map `ok`, `near`, `over`, `not_enough_data` to **On budget**, **Near**, **Over**, **Not enough data**, with icon and word as well as colour - `inst-status`
   2. [ ] - `p6` - Format units, decimal separators and target direction for timing/rate metrics; rate tiles have no p50; timing tiles show the returned p50 when provided - `inst-values`
   3. [ ] - `p6` - **IF** data is insufficient: show the core's needed-call count instead of value/trend; absent timing stays unavailable rather than becoming zero - `inst-no-data`
   4. [ ] - `p6` - **ELSE**: draw the returned last-20-call trend as a decorative sparkline and expose the trend word; omit the trend for **Last Call** - `inst-trend`
   5. [ ] - `p6` - **IF** blocker is true: show ◆ **Release blocker**; the shell's warning follows capture/privacy failure, never an unrelated latency overrun - `inst-blocker`
3. [ ] - `p6` - Render the six aggregate stages in order: **Confirmed text**, **Signals**, **Retrieval**, **Claude first token**, **Cards streamed and validated**, **Merge across agents** - `inst-stages`
4. [ ] - `p6` - **FOR EACH** returned stage - `inst-each-stage`
   1. [ ] - `p6` - Draw the value fill and budget marker on a common scale large enough for both; missing data draws an empty track and an en dash; never divide by a zero or absent budget - `inst-scale`
   2. [ ] - `p6` - Use the core's status to hatch over-budget fills and show an error icon; near uses the warning icon; help text gives p50, p95, budget and units - `inst-bar`
5. [ ] - `p6` - For a mini per-tick timeline, render only that tick's stages with a budget marker and accessible value text; do not fill absent stages from the overview - `inst-mini`
6. [ ] - `p6` - **RETURN** display values and selected states; p95, ranking and thresholds are not calculated by the UI - `inst-return`

### Filter bottlenecks

- [ ] `p6` - **ID**: `cpt-noter-algo-ui-performance-filter-bottlenecks`

**Input**: core-ranked bottlenecks, the selected metric and its stage associations, selected stage, period and call type

**Output**: an ordered subset, selection captions and the filter-empty state

**Steps**:
1. [ ] - `p6` - Start with the bottlenecks returned for the selected period/call type, preserving core ranking and counts - `inst-start`
2. [ ] - `p6` - **IF** a metric is selected: keep rows associated with that metric or one of its stages; do not infer associations from display text - `inst-metric`
3. [ ] - `p6` - **IF** a stage is selected: keep only rows with that stage, within the selected metric subset if present - `inst-stage`
4. [ ] - `p6` - Render each row's status, title, component/stage/count line, explanation, dated example-call links and suggestion - `inst-rows`
5. [ ] - `p6` - **IF** no row remains: show **No bottleneck for this filter.**, retaining **Clear** for the metric and **Show All** for the stage - `inst-empty`
6. [ ] - `p6` - A repeated tile click clears that metric and the stage; a repeated stage click or **Show All** clears only the stage; **Clear** removes the metric and dependent stage - `inst-clear`
7. [ ] - `p6` - **RETURN** the subset and captions, never a new performance measurement - `inst-return`

## 4. States (CDSL)

### Performance scope

- [ ] `p6` - **ID**: `cpt-noter-state-ui-performance-scope`

**States**: LOADING, EMPTY, READY, FILTER_EMPTY, READ_ERROR, ROLLUP_FAILED, ROLLUP_RUNNING

**Initial State**: LOADING

**Transitions**:
1. [ ] - `p6` - **FROM** LOADING **TO** EMPTY **WHEN** the overview reports no measured calls - `inst-empty`
2. [ ] - `p6` - **FROM** LOADING **TO** READY **WHEN** the selected scope arrives with calls and no roll-up failure - `inst-ready`
3. [ ] - `p6` - **FROM** LOADING **TO** READ_ERROR **WHEN** that read fails - `inst-error`
4. [ ] - `p6` - **FROM** READ_ERROR **TO** LOADING **WHEN** the user chooses **Try Again** - `inst-retry`
5. [ ] - `p6` - **FROM** READY **TO** FILTER_EMPTY **WHEN** the selected metric/stage leaves no bottlenecks - `inst-filter-empty`
6. [ ] - `p6` - **FROM** FILTER_EMPTY **TO** READY **WHEN** clearing or changing the filter restores rows - `inst-clear`
7. [ ] - `p6` - **FROM** LOADING, READY or FILTER_EMPTY **TO** ROLLUP_FAILED **WHEN** the core reports a roll-up failure; available metrics remain visible - `inst-rollup-failed`
8. [ ] - `p6` - **FROM** ROLLUP_FAILED **TO** ROLLUP_RUNNING **WHEN** a requested roll-up starts; a blocked start stays failed with the waiting message - `inst-rollup-start`
9. [ ] - `p6` - **FROM** ROLLUP_RUNNING **TO** READY or FILTER_EMPTY **WHEN** a successful run and refreshed overview confirm the failure resolved - `inst-rollup-done`
10. [ ] - `p6` - **FROM** ROLLUP_RUNNING **TO** ROLLUP_FAILED **WHEN** the run fails or is cancelled - `inst-rollup-error`
11. [ ] - `p6` - **FROM** EMPTY, READY, FILTER_EMPTY, ROLLUP_FAILED or ROLLUP_RUNNING **TO** LOADING **WHEN** the selected scope changes or the page is reread after new measurements - `inst-scope`

Tile no-data, near, over and selection states are per record, not a replacement for the entire page. Call performance has its own loading/read-error state; its late-only checkbox can yield an empty subset without altering the returned ticks. Scope and checkbox state live in the window store; data is reread on reload. Ignore late responses from a previous scope or route.

### Improvement brief

- [ ] `p6` - **ID**: `cpt-noter-state-ui-performance-brief`

**States**: CLOSED, PREPARING, READY, NO_MAPPING, SAVING, OPENING, COPIED, FAILED

**Initial State**: CLOSED

**Transitions**:
1. [ ] - `p6` - **FROM** CLOSED **TO** PREPARING **WHEN** Export or Preview opens the sheet - `inst-open`
2. [ ] - `p6` - **FROM** PREPARING **TO** READY or NO_MAPPING **WHEN** the matching scope preview arrives and mapping readiness is known - `inst-ready`
3. [ ] - `p6` - **FROM** READY **TO** NO_MAPPING **WHEN** the core reports a missing or invalid mapping - `inst-no-map`
4. [ ] - `p6` - **FROM** NO_MAPPING **TO** READY **WHEN** Settings confirms a valid Noter mapping - `inst-mapped`
5. [ ] - `p6` - **FROM** READY or NO_MAPPING **TO** COPIED **WHEN** the preview's Markdown is copied successfully - `inst-copy`
6. [ ] - `p6` - **FROM** COPIED **TO** READY or NO_MAPPING **WHEN** the 2-s Copied feedback expires, preserving mapping readiness - `inst-copy-end`
7. [ ] - `p6` - **FROM** READY or NO_MAPPING **TO** SAVING **WHEN** **Save as Markdown…** is chosen - `inst-save`
8. [ ] - `p6` - **FROM** READY **TO** OPENING **WHEN** an enabled tool action is chosen - `inst-launch`
9. [ ] - `p6` - **FROM** PREPARING, SAVING or OPENING **TO** FAILED **WHEN** the action fails; retain a valid preview and its scope - `inst-failed`
10. [ ] - `p6` - **FROM** FAILED **TO** PREPARING, SAVING or OPENING **WHEN** the user explicitly retries that action and its prerequisites hold - `inst-retry`
11. [ ] - `p6` - **FROM** FAILED **TO** COPIED **WHEN** the user copies an available preview instead - `inst-fallback`
12. [ ] - `p6` - **FROM** SAVING **TO** READY or NO_MAPPING **WHEN** the save succeeds or is cancelled; cancellation writes nothing - `inst-saved`
13. [ ] - `p6` - **FROM** OPENING **TO** CLOSED **WHEN** the core confirms the tool opened with an unsent prompt - `inst-opened`
14. [ ] - `p6` - **FROM** READY, NO_MAPPING, COPIED or FAILED **TO** PREPARING **WHEN** the sheet's supported scope changes - `inst-change`
15. [ ] - `p6` - **FROM** PREPARING, READY, NO_MAPPING, COPIED or FAILED **TO** CLOSED **WHEN** Cancel, Escape or close dismisses the sheet; late preview responses are ignored - `inst-close`

Open is never enabled without both a matching preview and a valid mapping. Busy actions cannot be submitted twice. No state transition alone means a file was saved or a tool ran; success requires the core response.

## 5. Definitions of Done

### Targets and bottlenecks

- [ ] `p6` - **ID**: `cpt-noter-dod-ui-performance-overview`

The system **MUST** render PF-R1 to PF-R5 from a consistent period/call-type result, including six tile variants, status words/icons, release blockers, aggregate stage bars, bottleneck filtering, Quality, Cost and a read-only brief. Core targets and Settings thresholds govern statuses; UI fixture values must never become product defaults. Resolve the missing overview data below before counting the full overview story as delivered.

**Implements**:
- `cpt-noter-flow-ui-performance-bottleneck`
- `cpt-noter-flow-ui-performance-rollup`
- `cpt-noter-algo-ui-performance-metric-presentation`
- `cpt-noter-algo-ui-performance-filter-bottlenecks`
- `cpt-noter-state-ui-performance-scope`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `perf_overview`, `call_types_list`; `jobs_list`, `job_run_now` through the Maintenance controller
- Events: `jobs:progress`, `settings:changed`, `banners:changed`
- Tests: unit tests for filter intersection/toggling, latest-scope response wins, rate/timing/no-data variants, missing/zero stage values and roll-up failure retention; conformance for period/type filtering, thresholds and no-data records; E2E `cpt-noter-seq-performance-find-bottleneck` (happy, no calls, not enough data, roll-up failed)

### Call performance

- [ ] `p6` - **ID**: `cpt-noter-dod-ui-performance-call`

The system **MUST** open the same Call performance route from a bottleneck example and from the Call page's **Show Performance**, render each tick's stages and outcome, support **Over budget only** and **Show All Ticks**, and return to the saved overview or Call page. Missing stages must stay missing; the UI must not compute a tick total by summing stages without a contract guarantee that they do not overlap.

**Implements**:
- `cpt-noter-flow-ui-performance-call`

**Constraints**: `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `perf_call`
- Tests: unit tests for late-only filtering, dropped versus late ticks, route preservation and deleted calls; conformance for ordered tick values and missing stages; E2E `cpt-noter-seq-performance-find-bottleneck` (call drill-down and no late ticks in a call)

### Improvement brief and verification

- [ ] `p6` - **ID**: `cpt-noter-dod-ui-performance-brief`

The system **MUST** render the prototype's brief sheet and PF-R5 actions, with core-generated Markdown, matching scope, Copy feedback, native save, mapping repair and both handoff targets. The handoff launcher writes the full prompt and opens the selected tool in Noter's repository; it never submits the prompt or runs work. Missing mapping and launch failure must keep Copy and the valid preview available. The brief contract gaps below must be resolved before the M5 story passes.

**Implements**:
- `cpt-noter-flow-ui-performance-brief`
- `cpt-noter-state-ui-performance-brief`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `perf_brief`; repository mapping through Settings and the shared handoff launcher
- Tests: unit tests for preview scope, mapping disabled states, copy failure/success, 2-s feedback and retained preview on launch error; conformance for save/open actions, both targets and typed mapping/launcher errors; E2E `cpt-noter-seq-performance-export-brief` (every path), plus Codex, save cancellation and clipboard failure
- Native: verify the real save panel and launcher boundary on macOS; if XCUITest proves a story, use `test_cpt_noter_seq_performance_export_brief__…` names
- Visual: all Performance states, selected metric and stage, missing-stage bars, filter-empty, Call performance and brief sheet, in the pinned screenshot container at Wide/Medium/Narrow, light/dark, Increase Contrast and German

Write failing tests before implementation. Run conformance against fake and real core, and story E2E against the real core. Keep the HARNESS coverage, screenshot, performance and trace bars; Performance commands enter the frozen-command denominator only when frozen in the canonical contract. Resolve the listed contract gaps and complete the required checks: `just gate` passes.

## 6. Acceptance Criteria

- [ ] Both M5 Performance stories pass every path against the real core with their exact story IDs in E2E test titles
- [ ] **7 Days** and the call-type pop-up update every block and export scope; Back from a call preserves the overview's selection and scroll
- [ ] The fixture shows **Answer card · 9.8 s · ≤ 9 s · Over**, **Claude first token · 4.4 s / 1.5** with hatch, and the matching bottleneck; a tile/stage filter never changes measurements or core ranking
- [ ] No-data tiles show the supplied needed-call count, never zero; Last Call has no trend; capture and privacy keep ◆ **Release blocker**
- [ ] Tiles use 6, 3 and 2 columns; stages precede bottlenecks at Medium; the bottom row stacks; below 600 pt content width the period becomes a pop-up
- [ ] Values never truncate, metric/stage names wrap in German, sparklines are decorative, and every status has a word and icon; keyboard selection and VoiceOver expose values and selected states
- [ ] Copy produces the full Markdown and **Copied** for 2 s; no mapping disables both Open actions; a failed launch leaves the preview and Copy usable; an opened tool has the prompt filled in and unsent
- [ ] Roll-up progress matches the accepted run id; a blocked or failed run cannot dismiss the failure banner; stale scope responses cannot replace newer data

## 7. Additional Context

**Prototype reuse.** Rewrite `screen('performance')` and its callPerf renderer in `src/js/50-e-3-performance.js` as PerformancePage and CallPerformancePage inside the existing shell. Rewrite `C.metricTile`, `C.stageTimeline` and `C.bottleneckRow` in `src/js/50-e-1-components.js` as MetricTile, StageTimeline (aggregate and mini) and BottleneckRow; preserve their DOM structure and component/primitive/variant/size/state/region attributes. Port `.pf-*`, `.e-tile*`, `.e-stl*`, `.e-mini*`, `.e-bn*` and the shared card/list styles from `src/css/50-e.css`. Rewrite `dlg-brief` in `src/js/30-c-dialogs.js` as ExportImprovementBriefSheet in the dialog host, reusing PromptEditor read-only. Settings' `performancePane` in `src/js/50-e-5-settings.js` is already owned by `cpt-noter-feature-ui-settings`; changes to its thresholds feed the core result rather than a second local classifier. The hardcoded perfTiles, perfStages, perfBottlenecks, perfTicks, brief string, machine subtitle and action flashes are visual fixtures, not production data or launcher code.

**States coverage.**

| DESIGN state | Prototype state or component state |
| --- | --- |
| Normal; Over target | `default`, tile/stage `over` |
| No calls yet; Not enough data; Loading | `no-calls`, `not-enough`, `loading` |
| Roll-up failed | `rollup-failed` |
| Noter repository not mapped; Brief does not open | `no-repo`, `brief-fails` |
| No bottleneck for the filter | metric/stage selection with an empty intersection |
| No tick over budget | `no-late-ticks` and Over budget only |
| Metric on budget/near/over/no data/selected | MetricTile `on-budget`, `near`, `over`, `needs-more-data`, `selected` |
| Stage on budget/near/over/no data/selected | StageTimeline rows `on-budget`, `near`, `over`, `no-data`, `is-sel` |
| Bottleneck over/near/informational | BottleneckRow variants `over`, `near`, `informational` |

**DESIGN versus prototype.**

| Difference | Spec treatment |
| --- | --- |
| dlg-brief offers **Last 7 days**, **Last 30 days**, **This release** and metric checkboxes, unlike the page's Last Call/7/30 scope | Keep the sheet's prototype anatomy and labels. `This release` and metric selection have no current BriefArgs representation; do not silently map them to 30 days. Resolve before the sheet is delivered |
| dlg-brief's sample says 10.8 s against 10 s and retrieval 1,350 ms against 800 ms; the page fixture uses 9.8 s against 9 s and retrieval 0.09 s against 0.1 s | Preserve the sheet's look, not its sample facts. Production preview, target and evidence must come from the selected core scope and PRD budgets |
| DESIGN requires missing-mapping and launch-error states inside the sheet; the prototype implements those states only in PF-R5 and its sheet actions always flash success | Carry the prototype PF-R5 warning/error line styles into the sheet; implement the story's repair and Copy fallback, never a fake success |
| The prototype keeps the same data after changing period/type, shows a trend for Last Call and hardcodes **Cost · 7 days** | These are sample-data limitations. Scope all values through the core and label the chosen period; Last Call has no trend |
| DESIGN describes stage table semantics and a 170-pt label column; the prototype uses a list of buttons and a 110-pt column below 700 px | Keep the prototype responsive column widths and visual button rows. Supply accessible stage/value/budget/status semantics and the documented ↑/↓ and Return/Space behavior |
| The prototype does not implement the period pop-up below 600 pt or all keyboard/size behavior | These are explicit README simplifications; DESIGN's fallbacks apply, using existing primitives |

**Contract and fake-core gaps.** These are owner-facing prerequisites, not new types or commands:

| Gap | Effect and required resolution |
| --- | --- |
| PerfOverview contains only tiles, bottlenecks, calls_measured and roll_up_failed | No aggregate stage p50/p95/budgets, Quality, cost breakdown, machine profile or brief preview. The contract owner must provide view data before PF-R1/PF-R3/PF-R5 can match DESIGN; do not aggregate ticks in React |
| MetricTile lacks p50, target direction, needed-call count and a trend word | No numeric **Needs 3 more calls** or authoritative trend semantics can be rendered from this shape. Obtain those values from the core; null is not zero and rates must not be treated as timings |
| Bottleneck has stage/component/agent, near/over counts and example calls, but no metric associations, title, explanation or suggestion | Metric filtering and the full row cannot be driven by current fields without an agreed mapping. Do not rank again, inspect English labels or hardcode the sample session-reset diagnosis |
| TickTiming has id, offset, trigger, stages, late and dropped only | The table lacks a display number, total and shown/pinned/dismissed outcome; CallRef lacks duration. Do not parse opaque tick ids, sum overlapping stage times or invent outcomes; the owner must supply the missing view data |
| perf_brief returns only path and opened_with; BriefAction permits save_file or open_in | No preview/read/copy action or Markdown content is available. A WebView cannot read a returned local path through this API, and item-specific handoff commands require an ItemId. Do not invent a synthetic item or call a launcher just to obtain a preview |
| BriefArgs has Last Call/7/30 and call type only, not This release or a metric subset | The prototype's sheet selection needs contract reconciliation. Copy, Save and Open must use the same supported scope; unsupported choices cannot be claimed as working |
| perf_overview fake ignores its arguments; perf_call has two simplified ticks and classifies over at 100 % rather than the default 105 %; perf_brief returns a path without generating or saving | Use typed scenario handlers for UI states and add the owning lane's fake/real conformance cases. Fake success is not proof of real filtering, file creation, thresholds or launching |

**Boundaries and verification.** Scope reads are one overview per selection, never a per-tile query loop. The store keeps the selected scope and matching result together; event-driven refreshes ignore obsolete responses and release listeners/timers on route close. Core metrics, roll-ups, thresholds and measured cost remain authoritative; signed-in-account usage is not added to API-key cost. Draw sparklines once, window long tick lists and test rendering with the due M5 performance scenarios; the UI does no wall-clock measurement. The bridge maps unknown errors to a section error with explicit retry and logs only command/code/ids, never brief content, transcripts or evidence excerpts. Brief Markdown is escaped and read-only; external opens and files go through the core. There is no new network service, authentication, secret store, database migration or deployment mechanism: these checklist areas are not applicable because this is a local view over existing core services. Measurement retention and rollback remain the core's responsibility; Settings already exposes the existing options.

**Milestone notes.** The three draft commands and two stories are placed in M5 exactly as milestones.toml states. HARNESS counts successful calls to delivered frozen commands and passing named real-core stories; draft status must not be hidden to inflate coverage. The feature depends on the M5 Maintenance controller only for roll-up recovery, in addition to the three DECOMPOSITION dependencies; no earlier milestone depends on Performance. The overview lists no M5-specific discrepancy. Registering these specs in artifacts.toml and implementing code markers are outside this spec-only change.
