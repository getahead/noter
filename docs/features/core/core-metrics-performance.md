---
title: "Feature: Metrics and Performance"
description: "Local stage measurements, footprint and correction rates, nightly roll-ups, Performance read models and the improvement brief."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M5
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Metrics and Performance

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Find a bottleneck](#find-a-bottleneck)
  - [Inspect a call timeline](#inspect-a-call-timeline)
  - [Export or open an improvement brief](#export-or-open-an-improvement-brief)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Record stage and footprint measurements](#record-stage-and-footprint-measurements)
  - [Derive quality and usage rates](#derive-quality-and-usage-rates)
  - [Roll up and assemble the overview](#roll-up-and-assemble-the-overview)
  - [Build the improvement brief](#build-the-improvement-brief)
- [4. States (CDSL)](#4-states-cdsl)
  - [Budget assessment](#budget-assessment)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Local measurements and quality](#local-measurements-and-quality)
  - [Roll-ups and Performance reads](#roll-ups-and-performance-reads)
  - [Brief and proof](#brief-and-proof)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p6` - **ID**: `cpt-noter-featstatus-core-metrics-performance`

- [ ] `p6` - `cpt-noter-feature-core-metrics-performance`

## 1. Feature Context

### 1.1 Overview

The metrics service in `noter-core` records local measurements, rolls them up nightly and serves Performance and its per-call drill-down. It builds an improvement brief and delegates saving and opening it to the existing native and handoff services.

Telemetry is out of scope: there is no endpoint and no automatic upload. Metrics contain no transcript text. As DECOMPOSITION-core discrepancy 6 states, M1 measured footprint in the harness and stored capture gaps; in-app ten-second sampling and roll-ups start here in M5. Talk-time metrics remain opt-in and are never back-computed for older calls (D5).

### 1.2 Purpose

Make missed targets traceable to a stage, component, runtime and example call. The Performance page uses PRD targets, not targets invented by the UI or the brief generator.

**Requirements**: PRD › Feature specification › 12. Performance and continuous improvement; PRD › Success metrics and quality bars; PRD › Live copilot loop › Where the time goes.

**Principles**: None assigned by the decomposition.

**Delivers**:
- Commands assigned to M5: `perf_overview`, `perf_call`, `perf_brief`. All three are draft in `noter-protocol` and `ipc.manifest.json` until the M5 gate; this spec does not claim they are frozen or change their stability. They join the harness's frozen-command denominator when frozen.
- DESIGN.md stories (M5): `cpt-noter-seq-performance-find-bottleneck`, `cpt-noter-seq-performance-export-brief`.
- Supporting commands: M4 `card_shown` supplies display measurements; M5 `job_run_now` retries the nightly roll-up. Their command ownership stays with copilot and maintenance.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Finds a bottleneck, opens a call timeline, saves or opens a brief |
| Main window | Requests the Performance read models and brief action |
| Engine, copilot and model router | Supply timestamps, stage outcomes and run usage |
| Change log and handoff launcher | Supply correction and prompt-use outcomes |
| Scheduler | Runs nightly roll-ups outside live capture |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md), Performance, Success metrics, Live copilot loop, Maintenance jobs
- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-metrics-performance` and overview discrepancy 6
- **Design**: [DESIGN-core.md](../../DESIGN-core.md), 1.2 NFR allocation, 3.2 Metrics, 3.3 Performance commands, 3.7 metrics table; [DESIGN.md](../../DESIGN.md), Performance, Call performance and both M5 stories
- **Component**:
  - [ ] `p6` - `cpt-noter-component-core-metrics`
- **Data**: `cpt-noter-dbtable-metrics`; `metric_rollups` from PRD › Data model and storage; existing `llm_runs`, `changes` and `prompt_versions`
- **Dependencies**: `cpt-noter-feature-core-copilot`, `cpt-noter-feature-core-handoff`, `cpt-noter-feature-core-jobs-scheduler`
- **Contract**: `crates/noter-protocol/src/model/performance.rs`, performance settings, `ipc/mod.rs`, `contracts/ipc.manifest.json`; reuse existing view types without adding fields

## 2. Actor Flows (CDSL)

### Find a bottleneck

- [ ] `p1` - **ID**: `cpt-noter-flow-core-metrics-performance-overview`

**Actor**: Primary user (main window, Performance)

**Success Scenarios**:
- Last Call, 7 Days or 30 Days and a call-type filter return measured-call count, six headline tiles, trends and ranked bottlenecks with example calls.
- A failed nightly run leaves existing data visible with `roll_up_failed` so Run Now can retry it.

**Error Scenarios**:
- An unknown call type returns `invalid_input`; startup before storage is available returns `not_ready`.
- No calls returns zero measured calls; unavailable observations are Not enough data, never zero latency or perfect reliability.

**Steps**:
1. [ ] - `p1` - API: `perf_overview` with period and optional call type from the main window - `inst-overview-call`
2. [ ] - `p1` - Validate the filter and resolve its call set with the injected clock; Last Call means the latest matching call - `inst-overview-filter`
3. [ ] - `p1` - Run `cpt-noter-algo-core-metrics-performance-overview` over that set - `inst-overview-build`
4. [ ] - `p1` - **IF** the nightly roll-up failed, return the last valid measurements with `roll_up_failed` set; do not mark missing data as healthy - `inst-overview-failed`
5. [ ] - `p1` - **IF** the user retries the roll-up, invoke maintenance's `job_run_now`, observe `jobs:progress` and refetch after success; `job_blocked` during a call is preserved - `inst-overview-retry`
6. [ ] - `p1` - **RETURN** `PerfOverview`; the UI may filter returned bottlenecks by metric or stage without a new core command - `inst-overview-return`

### Inspect a call timeline

- [ ] `p1` - **ID**: `cpt-noter-flow-core-metrics-performance-call`

**Actor**: Primary user (main window, example call or Show Performance from a call)

**Success Scenarios**:
- Every recorded tick has a correlated timeline and late/dropped flags; usage, API-key cost and dropout time belong to that call.
- A call without late ticks returns its normal timeline; the UI's Over budget only filter can be empty.

**Error Scenarios**:
- Deleted call: `not_found`; a call recorded before metrics existed has no fabricated historical ticks.

**Steps**:
1. [ ] - `p1` - API: `perf_call` with call id - `inst-call-request`
2. [ ] - `p1` - DB: SELECT the call, metrics, associated runs and tick outcomes in one read snapshot; **RETURN** `not_found` if the call is gone - `inst-call-read`
3. [ ] - `p1` - Group stages by tick id and correlate its optional LLM run; preserve time within the call, trigger, late and dropped outcomes - `inst-call-ticks`
4. [ ] - `p1` - Attach each observed stage duration, PRD budget and computed budget state; absence of an observation must not become an invented zero - `inst-call-stages`
5. [ ] - `p1` - Sum qualifying dropout durations and token usage; price only API-key runs, keeping own-account and local usage unpriced - `inst-call-usage`
6. [ ] - `p1` - **RETURN** `CallPerf` with an empty tick list where nothing was measured - `inst-call-return`

### Export or open an improvement brief

- [ ] `p1` - **ID**: `cpt-noter-flow-core-metrics-performance-brief`

**Actor**: Primary user (main window)

**Success Scenarios**:
- Save as Markdown uses a native save panel and returns the written path.
- Open in Claude Code or Codex uses the Noter repository mapping and the existing launcher, with the prompt prefilled and not sent.

**Error Scenarios**:
- Save panel cancelled: `cancelled`; missing mapping or folder: `repo_not_mapped` or `repo_path_missing`.
- Launch failures retain `no_link_handler`, `automation_denied` or `cli_missing`; write failure returns `prompt_not_ready` or the underlying `disk_full`.

**Steps**:
1. [ ] - `p1` - API: `perf_brief` with period, optional call type and SaveFile or OpenIn action - `inst-brief-call`
2. [ ] - `p1` - Build the Markdown with `cpt-noter-algo-core-metrics-performance-brief` from the same filtered measurements as the overview - `inst-brief-build`
3. [ ] - `p1` - **IF** SaveFile was requested - `inst-brief-save`
   1. [ ] - `p1` - Ask the native service for a save path; **RETURN** `cancelled` without writing if the user cancels - `inst-brief-panel`
   2. [ ] - `p1` - Write the complete Markdown at the chosen path; **RETURN** `BriefResult` with no launch path - `inst-brief-file`
4. [ ] - `p1` - **ELSE** OpenIn was requested - `inst-brief-open`
   1. [ ] - `p1` - Resolve the Noter repository mapping and chosen target through handoff; **RETURN** the typed mapping/path error before launching if absent - `inst-brief-repo`
   2. [ ] - `p1` - Write the full brief under Application Support and delegate opening to the existing handoff launcher with a short read-file instruction under the link length cap - `inst-brief-launch`
   3. [ ] - `p1` - **RETURN** `BriefResult` with the file path and actual `LaunchPath`; do not create an item handoff or mark any item handed off - `inst-brief-return`

## 3. Processes / Business Logic (CDSL)

### Record stage and footprint measurements

- [ ] `p1` - **ID**: `cpt-noter-algo-core-metrics-performance-record`

**Input**: Engine timestamps, tick and LLM run ids, stage boundaries and outcomes, capture state, performance settings and an injected clock.

**Output**: Local metric observations correlated to their call, stage, component and agent.

**Steps**:
1. [ ] - `p1` - Measure hypothesis and confirmed-text lag from engine speech timestamps to their publication; keep elapsed measurements separate from wall-clock observation dates - `inst-record-lag`
2. [ ] - `p1` - Record signals, retrieval, first token, full-card validation and merge stage durations for every tick under the default all-stages setting; share the tick id and attach its LLM run and agent where present - `inst-record-tick`
3. [ ] - `p1` - Preserve stages already measured for failed, late, skipped or dropped results and their outcomes; a stage that never ran is absent, not a zero-duration success - `inst-record-outcome`
4. [ ] - `p1` - Accept display measurements from M4 `card_shown`; use the copilot's core stamps for menu-bar-only cards, hidden-for-presenting cards and released queued cards; do not count both stamps as separate displays - `inst-record-shown`
5. [ ] - `p1` - DB: read gaps with reason interrupted, engine_restart, device_changed or stalled; include a gap in `dropout_ms` only when longer than two seconds and sum the qualifying duration once per call - `inst-record-dropouts`
6. [ ] - `p1` - Sample memory, CPU and thermal state every ten seconds during capture and stop the sampler when capture ends; use the existing engine/native adapters rather than blocking the capture path - `inst-record-footprint`
7. [ ] - `p1` - Record outputs-ready latency, retrieval/search latency, job durations, usage, tokens, runtime failures and API-key costs with their existing call/run correlations - `inst-record-other`
8. [ ] - `p1` - DB: batch INSERT observations through the single writer without transcript text, prompt bodies, credentials or audio; log only ids and safe failure details - `inst-record-persist`
9. [ ] - `p1` - **IF** a metric write fails, report it locally and preserve capture; do not make missing measurements look complete - `inst-record-fail`
10. [ ] - `p1` - **RETURN** persisted observations and completeness information for the local checks; changing sampled stages affects future observations only - `inst-record-return`

### Derive quality and usage rates

- [ ] `p1` - **ID**: `cpt-noter-algo-core-metrics-performance-quality`

**Input**: Change log, cards and feedback, citations, evidence closures, proposal decisions, LLM runs and prompt versions in the selected period.

**Output**: Local quality and usage observations with their actual denominators.

**Steps**:
1. [ ] - `p1` - Count confirmed-text corrections, speaker renames, edits on item acceptance, reopens and undone automated corrections from the change log; preserve actor and batch provenance to avoid counting a propagation as repeated user actions - `inst-quality-corrections`
2. [ ] - `p1` - Compute accepted-without-edit items over reviewed accepted items; compute reopened hand-ticked items only after the one-week observation window; keep missing denominators unavailable - `inst-quality-items`
3. [ ] - `p1` - Compute proposal and citation acceptance from recorded decisions, and evidence closure reopens from closing and reopening changes; absence of a review is not proof a closure was correct - `inst-quality-proposals`
4. [ ] - `p1` - Compute shown-card usefulness, dismissals, pins, use and cross-agent duplicates per agent and call type; use the last twenty calls for the PRD council comparison - `inst-quality-cards`
5. [ ] - `p1` - Join handoff Open/Copy records to `prompt_versions` and count unedited uses over recorded uses; preserve the version and edited flag without copying prompt content into metrics - `inst-quality-handoff`
6. [ ] - `p1` - Aggregate model usage by runtime, agent and call; include own-account tokens and failures but assign API price only to API-key runs - `inst-quality-models`
7. [ ] - `p1` - Do not infer golden-set WER, citation correctness or sampled evidence-closure correctness from a proxy; do not back-compute talk time before behaviour metrics were enabled - `inst-quality-limits`
8. [ ] - `p1` - **RETURN** quality observations for local roll-ups and the brief - `inst-quality-return`

### Roll up and assemble the overview

- [ ] `p1` - **ID**: `cpt-noter-algo-core-metrics-performance-overview`

**Input**: Raw metrics and quality observations, selected period/call type, stage budgets, performance settings and roll-up run status.

**Output**: Daily p50/p95 roll-ups and the contract's `PerfOverview`.

**Steps**:
1. [ ] - `p1` - Run the nightly MetricsRollUp job under scheduler capture and battery policy, in batches of at most 200 rows - `inst-overview-nightly`
2. [ ] - `p1` - DB: group observations by day, stage, component and agent; compute p50 and p95 from observations, never by averaging daily percentiles - `inst-overview-quantiles`
3. [ ] - `p1` - Replace the affected roll-up groups atomically through storage, so retrying the same source window does not double-count; a failed transaction keeps the last valid roll-up - `inst-overview-write`
4. [ ] - `p1` - Resolve matching call ids and apply that set to every tile, bottleneck, usage total and example; count distinct measured calls - `inst-overview-scope`
5. [ ] - `p1` - Build headline tiles for hypothesis lag (2 s), answer card (p95 9 s), confirmed lag (4 s), cloud outputs ready (2 min), calls without dropouts (at least 99%) and cloud requests logged (100%); mark capture and privacy as release blockers - `inst-overview-tiles`
6. [ ] - `p1` - Use elapsed distributions for latency and actual success fractions for reliability/privacy; absence of observations yields `not_enough_data` and no p95 rather than a passing value - `inst-overview-missing`
7. [ ] - `p1` - Compare duration stages with their PRD budgets: confirmed text 2.5 s, signals 0.3 s, retrieval 0.1 s, first token 1.5 s, full cards 1.0 s and merge 0.1 s - `inst-overview-budgets`
8. [ ] - `p1` - Classify measured duration ratios above the configured over threshold as over, otherwise above near as near, otherwise ok; defaults are strictly above 105% and 90%; reliability uses its higher-is-better target and privacy failures never gain tolerance from stage thresholds - `inst-overview-classify`
9. [ ] - `p1` - Rank bottlenecks by over-budget occurrence, then near-budget occurrence, keeping stage, component, agent and matching example calls; use stable ties - `inst-overview-rank`
10. [ ] - `p1` - Build trends from at most the last twenty matching measured calls, oldest first; Last Call has no multi-call trend - `inst-overview-trend`
11. [ ] - `p1` - Read the latest roll-up outcome from job runs and set `roll_up_failed` until a successful retry; **RETURN** the overview from a consistent read snapshot - `inst-overview-return`

### Build the improvement brief

- [ ] `p1` - **ID**: `cpt-noter-algo-core-metrics-performance-brief`

**Input**: Selected period, call type, overview and underlying local observations.

**Output**: Markdown mini-PRD grounded in measured off-target metrics.

**Steps**:
1. [ ] - `p1` - State the selected period, call type and measured-call count; identify missing data and a failed roll-up before making comparisons - `inst-build-scope`
2. [ ] - `p1` - **FOR EACH** metric off its PRD target - `inst-build-metrics`
   1. [ ] - `p1` - Include target, actual, units and trend, naming the stage, component and runtime/agent responsible where measured - `inst-build-values`
   2. [ ] - `p1` - Attach matching local example calls, transcript-span references or safe log excerpts resolved from their source; keep transcript text out of the metrics table - `inst-build-evidence`
   3. [ ] - `p1` - Describe a proposed change tied to that observed bottleneck and its target; distinguish a proposed remedy from a measured result - `inst-build-proposal`
3. [ ] - `p1` - **IF** nothing is off target, state that result and the available data rather than inventing a bottleneck - `inst-build-none`
4. [ ] - `p1` - **RETURN** the Markdown for the requested local save/open action; do not start a model run or send it automatically - `inst-build-return`

## 4. States (CDSL)

### Budget assessment

- [ ] `p1` - **ID**: `cpt-noter-state-core-metrics-performance-budget`

**States**: not_enough_data, ok, near, over

**Initial State**: not_enough_data

**Transitions**:
1. [ ] - `p1` - **FROM** not_enough_data **TO** ok **WHEN** observations become available and the measured duration ratio is at or below near - `inst-state-ok`
2. [ ] - `p1` - **FROM** ok **TO** near **WHEN** refreshed observations or settings put the ratio above near and at or below over; also from not_enough_data or over - `inst-state-near`
3. [ ] - `p1` - **FROM** near **TO** over **WHEN** the ratio exceeds over; also from ok or not_enough_data - `inst-state-over`
4. [ ] - `p1` - **FROM** over **TO** ok **WHEN** the measured ratio returns to at or below near; also from near - `inst-state-recovered`
5. [ ] - `p1` - **FROM** ok **TO** not_enough_data **WHEN** the selected period, call type or retention leaves no usable observations; also from near or over - `inst-state-empty`

These are derived read-model states, recomputed on filter or settings changes, not stored business statuses. Capture/privacy tiles use their success-fraction targets and blocker rules, not the duration ratio transitions. Roll-up job states reuse the scheduler's queued/running/paused/succeeded/failed/cancelled lifecycle.

## 5. Definitions of Done

### Local measurements and quality

- [ ] `p1` - **ID**: `cpt-noter-dod-core-metrics-performance-measure`

The system **MUST** correlate tick stages and LLM runs, measure lag from engine timestamps, sample footprint every ten seconds during capture, compute qualifying dropout totals and derive quality/usage from recorded outcomes. Metrics contain no transcript text and no telemetry is sent.

**Implements**:
- `cpt-noter-algo-core-metrics-performance-record`
- `cpt-noter-algo-core-metrics-performance-quality`

**Covers (DESIGN)**:
- [ ] `p6` - `cpt-noter-component-core-metrics`
- `cpt-noter-dbtable-metrics`

**Touches**:
- API: existing `card_shown`, engine and runtime observations
- DB: `metrics`, `gaps`, `llm_runs`, `changes`, `cards`, `prompt_versions`
- Entities: stage observations, quality rates and footprint samples

### Roll-ups and Performance reads

- [ ] `p1` - **ID**: `cpt-noter-dod-core-metrics-performance-read`

The system **MUST** roll measurements up nightly, keep last valid data on failure, and serve filtered headline tiles, trends, bottlenecks and per-call timelines using PRD targets and settings thresholds. Missing data never appears as healthy zeroes.

**Implements**:
- `cpt-noter-flow-core-metrics-performance-overview`
- `cpt-noter-flow-core-metrics-performance-call`
- `cpt-noter-algo-core-metrics-performance-overview`
- `cpt-noter-state-core-metrics-performance-budget`

**Covers (DESIGN)**:
- `cpt-noter-seq-performance-find-bottleneck`

**Touches**:
- API: `perf_overview`, `perf_call`, supporting `job_run_now`
- DB: `metrics`, `metric_rollups`, `job_runs`, `calls`, `settings`
- Entities: `PerfOverview`, `MetricTile`, `Bottleneck`, `CallPerf`, `TickTiming`, `StageTiming`

### Brief and proof

- [ ] `p1` - **ID**: `cpt-noter-dod-core-metrics-performance-brief-tests`

The system **MUST** build a measured Markdown improvement brief, save it through the native panel or open it through the existing Noter repository mapping and launcher, and prove the read, failure and launch paths with unit, conformance and both real-core M5 Performance stories. `just gate` passes.

**Implements**:
- `cpt-noter-flow-core-metrics-performance-brief`
- `cpt-noter-algo-core-metrics-performance-brief`

**Covers (DESIGN)**:
- `cpt-noter-seq-performance-export-brief`

**Touches**:
- API: `perf_brief`, handoff launcher and native save panel
- Entities: `BriefResult`, `BriefAction`, `LaunchPath`, local brief files

## 6. Acceptance Criteria

- [ ] Unit tests use injected engine and elapsed clocks to prove lag, stage correlation and ten-second sampling with no sampler left after capture. A gap exactly two seconds does not count; qualifying gaps contribute their full duration once.
- [ ] Unit tests prove every tick under default sampling has all executed stage timings, including failed/late/dropped results, and core/UI display stamps do not double-count. Nothing in measurement storage contains transcript text or prompt bodies.
- [ ] Quality tests prove correction, reopen, proposal/citation acceptance and unedited-prompt denominators, preserve the one-week reopen observation window, price API-key runs only and never back-compute opted-out talk time.
- [ ] Roll-up tests cover p50/p95 from raw observations across unequal daily sample sizes, retry without duplication, transaction rollback, period and call-type isolation, twenty-call ordering and exact 90%/105% boundaries; privacy and capture blocker failures never receive duration tolerance.
- [ ] Conformance against the real core verifies main-only scope for all three M5 commands, unknown call types, missing calls, empty periods, result shapes and preserved draft stability until the M5 gate. Each command succeeds at least once in real-core E2E even while draft commands are excluded from the frozen-command denominator.
- [ ] E2E against the real core, story `cpt-noter-seq-performance-find-bottleneck`: show answer-card p95 9.8 s against 9 s, a first-token overrun and matching example call; inspect every tick, show no late ticks and empty/no-data periods, retry a failed roll-up and clear its failure flag.
- [ ] E2E against the real core, story `cpt-noter-seq-performance-export-brief`: save the selected period's brief, open it through the Noter repository mapping in each target with the prompt not sent, and cover missing mapping/path, cancelled save and launch/write failures through scripted native adapters.
- [ ] Contract gaps stay explicit: `PerfOverview` has no p50, overall stage timeline, quality/cost blocks or machine profile; `MetricTile` has no missing-sample count. The designs' exact “Needs 3 more calls” threshold is not defined upstream. `CallPerf` has no card column, and `BriefArgs`/`BriefResult` have no preview, copy or metric-selection operation. Those UI details need an upstream contract decision before they can be delivered; this file defines no replacement fields or commands.
- [ ] In-app collection and read-model performance meet the harness limits; a 90-minute capture checks the PRD footprint targets (4 GB without local LLM, 8 GB with it) and thermal behaviour. Raw retention belongs to maintenance (one year by default).
- [ ] Cross-tenant auth, hosted service deployment and regulatory certification are not applicable to local metrics. Existing handoff/native services own path handling and launching; the UI owns keyboard navigation, chart accessibility and announcements. The brief stays local until the user chooses its handoff.
- [ ] `just gate` passes.
