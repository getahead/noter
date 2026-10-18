---
title: "Feature: LLM router, egress gate and audit"
description: "One runtime boundary for Claude Code, Codex and Ollama, schema validation, CLI lockdown and audit before cloud egress."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M2
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: LLM router, egress gate and audit

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Run a skill through the router](#run-a-skill-through-the-router)
  - [Open, reuse and close a runtime session](#open-reuse-and-close-a-runtime-session)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Route by task and privacy](#route-by-task-and-privacy)
  - [Redact and audit before release](#redact-and-audit-before-release)
  - [Validate output and retry once](#validate-output-and-retry-once)
- [4. States (CDSL)](#4-states-cdsl)
  - [Runtime request](#runtime-request)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Runtime adapters and lockdown](#runtime-adapters-and-lockdown)
  - [One gate and validated results](#one-gate-and-validated-results)
  - [Privacy tests and gate](#privacy-tests-and-gate)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p3` - **ID**: `cpt-noter-featstatus-core-llm-gate`

- [ ] `p3` - `cpt-noter-feature-core-llm-gate`

## 1. Feature Context

### 1.1 Overview

`noter-llm` implements the runtime interface and its three adapters, task routing, schema and citation validation, redaction and the audit-before-send gate. It records model runs and locks down every CLI process. It also answers `accounts_get` and `api_key_set` (owner decision, 18 Oct), so the M2 runtime can be configured from the app: a verified key goes to the Keychain, or local Ollama is used. Key removal, own accounts, CLI install, the Privacy pane and noter-mcp arrive in M3. Deterministic E2E uses the scripted runtime. No tools from a later feature are silently enabled.

### 1.2 Purpose

Post-call and handoff can call a model without creating another path for user text to leave the Mac. A runtime failure must never stop capture.

**Requirements**: PRD › LLM orchestration; PRD › Security, privacy and permissions; PRD › Success metrics › Privacy (release blocker).

**Principles**: `cpt-noter-principle-core-egress-gate`

**Delivers**:
- Frozen IPC commands (M2): `accounts_get`, `api_key_set`, with event `accounts:changed`. Their behaviour is specified in [core-credentials-privacy.md](core-credentials-privacy.md) and delivered here: steps 1 to 5 of `cpt-noter-flow-core-credentials-privacy-keys`, `cpt-noter-algo-core-credentials-privacy-availability`, `cpt-noter-algo-core-credentials-privacy-secret-boundary` for API keys, and `cpt-noter-state-core-credentials-privacy-key` except removal. The IDs stay in that spec. The M2 code carries the block markers (`@cpt-begin`/`@cpt-end`) of the instructions it implements, and ticks those instructions in M2:
  - flow steps 1 to 5 (`inst-key-read`, `inst-key-request`, `inst-key-verify`, `inst-key-store`, `inst-key-return`);
  - the availability steps for keys and runtimes (`inst-availability-keys`, `inst-availability-clis`, `inst-availability-version`, `inst-availability-return`);
  - the API-key steps of the secret boundary (`inst-secret-key`, `inst-secret-scrub`, `inst-secret-return`);
  - the key transitions except removal (`inst-key-state-verify`, `inst-key-state-save`, `inst-key-state-reject`, `inst-key-state-revoked`, `inst-key-state-locked`, `inst-key-state-unlocked`).

  The flow, algorithm and state IDs are ticked when the credentials feature adds the rest in M3: `inst-key-remove`, `inst-availability-ended`, `inst-availability-bindings`, `inst-secret-account`, `inst-secret-metadata` and `inst-key-state-remove`. This follows `.cf-studio/config/kits/sdlc/codebase/rules.md`: a parent is `[x]` only when all its nested steps are.
- DESIGN.md stories (M2): none owned here; used by post-call and handoff stories.
- Interfaces: `cpt-noter-interface-llm-runtime`, `cpt-noter-interface-skill-outputs`; event `privacy:changed` when effective privacy state changes.
- `llm_runs` and `audit_log` from the first cloud run, even before the M3 audit commands exist.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Core model caller | Supplies skill, packet, schema, task, budget and cancellation |
| Runtime adapter | Calls Claude Code, Codex or local Ollama |
| Egress gate | Checks policy, redacts and commits the audit row before releasing cloud text |
| Keychain and CLI account boundary | Supplies availability and credentials without exposing secrets to the UI |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-llm-gate`; overview discrepancies 1 (decided: `accounts_get` and `api_key_set` in M2) and 7
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-llm-router`, `cpt-noter-component-core-privacy`, `cpt-noter-interface-llm-runtime`, `cpt-noter-interface-skill-outputs`, `cpt-noter-dbtable-llm-runs`, `cpt-noter-dbtable-audit-log`
- **Contract**: `crates/noter-protocol/src/skills.rs`, `common.rs`, `error.rs`; `contracts/skills/`, `contracts/egress-hosts.json`
- **Dependencies**: `cpt-noter-feature-core-storage`, `cpt-noter-feature-core-settings`

## 2. Actor Flows (CDSL)

### Run a skill through the router

- [ ] `p1` - **ID**: `cpt-noter-flow-core-llm-gate-run`

**Actor**: Core model caller

**Success Scenarios**:
- Post-call uses the configured runtime and returns validated output and provenance; sensitive or local-only work uses local Ollama.
- Handoff prefers the target tool's runtime and falls back locally when unavailable.

**Error Scenarios**:
- A missing key, unsupported CLI, signed-out account, unavailable local model or exhausted budget produces its typed availability error or permitted fallback.
- Audit persistence fails: no cloud packet is released.

**Steps**:
1. [ ] - `p1` - Receive the skill, version, input packet, output schema, task settings, budget and cancellation handle through `LlmRuntime` - `inst-run-input`
2. [ ] - `p1` - Read runtime availability, privacy mode, call sensitivity and source classes; select with `cpt-noter-algo-core-llm-gate-route` - `inst-run-route`
3. [ ] - `p1` - Allocate an `llm_run_id`, record runtime, task, skill version and prompt hash in `llm_runs`; never store the packet in operational logs - `inst-run-record`
4. [ ] - `p1` - Use `cpt-noter-algo-core-llm-gate-egress` for the selected attempt before invoking an adapter - `inst-run-gate`
5. [ ] - `p1` - Start the locked-down adapter with the same app-owned schema, skill and allowed tools; apply effort, budget and task timeout - `inst-run-adapter`
6. [ ] - `p1` - Validate results through `cpt-noter-algo-core-llm-gate-validate`; map pseudonyms back only after cloud output is inside the core - `inst-run-validate`
7. [ ] - `p1` - Record usage, duration, first token, validation, retry and session id; cost is present for API-key runs and absent for own-account runs - `inst-run-usage`
8. [ ] - `p1` - **IF** timeout or cancellation occurs, terminate the request and child process, invalidate late output and remove its temporary config - `inst-run-cancel`
9. [ ] - `p1` - **RETURN** validated output and provenance or the typed failure; capture remains independent - `inst-run-return`

### Open, reuse and close a runtime session

- [ ] `p1` - **ID**: `cpt-noter-flow-core-llm-gate-session`

**Actor**: Core model caller

**Success Scenarios**:
- The internal interface supports `availability`, `run_once`, `open_session`, `send_turn`, `close_session` and `resume`; warm sessions reset after 15 ticks.

**Error Scenarios**:
- A failed session or changed privacy context cannot carry a cloud turn forward unchecked.

**Steps**:
1. [ ] - `p1` - On open or resume, check the tested CLI version range and the runtime's availability, then create the isolated run environment - `inst-session-open`
2. [ ] - `p1` - Gate every new turn or resumed packet with its current privacy context and audit linkage before the adapter receives it - `inst-session-turn`
3. [ ] - `p1` - Count live ticks and reset the warm session after 15; keep only the caller's current permitted context - `inst-session-reset`
4. [ ] - `p1` - On close, cancellation, provider failure or privacy change, stop the child and release temporary files and per-run capabilities - `inst-session-close`
5. [ ] - `p1` - **RETURN** session state or typed availability error; no M4 IPC surface is delivered here - `inst-session-return`

## 3. Processes / Business Logic (CDSL)

### Route by task and privacy

- [ ] `p1` - **ID**: `cpt-noter-algo-core-llm-gate-route`

**Input**: Task, chosen runtime and model, available runtimes, call privacy, source classes, failure history and budget.

**Output**: An allowed runtime choice or `runtime_unavailable` with its reason and fix.

**Steps**:
1. [ ] - `p1` - Force local for local-only mode, sensitive calls or offline execution; sensitive sources are never admitted to a cloud packet - `inst-route-local`
2. [ ] - `p1` - For post-call, prefer the configured available runtime, then the PRD fallback order Claude Code, Codex, local; handoff prefers its target runtime then local - `inst-route-order`
3. [ ] - `p1` - Keep embeddings and redaction local; if the local redaction model is unavailable, retain regex redaction - `inst-route-redaction`
4. [ ] - `p1` - Refuse unknown CLI majors or versions outside the tested range with `cli_version_unsupported`; never assume a new CLI honors lockdown flags - `inst-route-version`
5. [ ] - `p1` - Apply API-key cost caps and allowed tools; two consecutive runtime failures within a call switch it to local, with effective state published through `privacy:changed` - `inst-route-failover`
6. [ ] - `p1` - **IF** no policy-compliant runtime is available, **RETURN** `runtime_unavailable` with the existing runtime reason; never relax privacy - `inst-route-none`
7. [ ] - `p1` - **RETURN** the choice, model, effort, tools and timeout: post-call 10 minutes, Ask 60 seconds and live agent 8 seconds where those callers later use the interface - `inst-route-return`

### Redact and audit before release

- [ ] `p1` - **ID**: `cpt-noter-algo-core-llm-gate-egress`

**Input**: Run context, packet, destination and effective privacy mode.

**Output**: Permitted packet with a committed audit row, local execution, or refusal.

**Steps**:
1. [ ] - `p1` - Re-check call sensitivity, mode and source scope at release time; reject cloud release if they changed to local-only - `inst-egress-recheck`
2. [ ] - `p1` - **IF** local, return the local packet without cloud egress; no cloud audit row is claimed - `inst-egress-local`
3. [ ] - `p1` - Remove sensitive sources and all audio; in cloud-with-redaction mode replace PII and credential-like strings with local-model plus regex placeholders - `inst-egress-redact`
4. [ ] - `p1` - Apply optional stable person pseudonyms with a run-local reverse map; audit records identify placeholders, never originals - `inst-egress-pseudonyms`
5. [ ] - `p1` - DB: INSERT `audit_log` with kind run, timestamp, destination, runtime, call id, run id, exact outgoing bytes, payload hash and redaction-map id; commit before releasing text - `inst-egress-audit`
6. [ ] - `p1` - **IF** commit fails, refuse release and return a typed storage failure - `inst-egress-no-audit`
7. [ ] - `p1` - Release only the approved packet to the selected adapter; every retry or new cloud payload must cross this boundary and retain attributable audit evidence - `inst-egress-release`
8. [ ] - `p1` - Reserve the same boundary for future tool-result and lookup callers; M3 implements the socket handler and tool-result rows, not an M2 bypass - `inst-egress-future-tools`
9. [ ] - `p1` - **RETURN** the permitted packet and audit linkage - `inst-egress-return`

### Validate output and retry once

- [ ] `p1` - **ID**: `cpt-noter-algo-core-llm-gate-validate`

**Input**: Runtime output, the app-owned schema, supplied evidence ids and run context.

**Output**: Validated output or a typed failure for the owning section.

**Steps**:
1. [ ] - `p1` - Parse structured output and validate against the supplied schema; reject raw HTML in Markdown fields - `inst-validate-schema`
2. [ ] - `p1` - Check every required item or quote cites evidence, and every cited segment or chunk id belongs to the permitted packet - `inst-validate-citations`
3. [ ] - `p1` - **IF** invalid, retry once with the validation failure explained, through the same egress and budget checks - `inst-validate-retry`
4. [ ] - `p1` - **IF** still invalid, use the existing simpler skill/schema path and local fallback where available, applying the same evidence checks; never save unvalidated claims - `inst-validate-simple`
5. [ ] - `p1` - **IF** fallback also fails, record schema failure and return the typed failure to the caller without replacing a ready section - `inst-validate-fail`
6. [ ] - `p1` - **RETURN** validated content with usage and retry provenance - `inst-validate-return`

## 4. States (CDSL)

### Runtime request

- [ ] `p1` - **ID**: `cpt-noter-state-core-llm-gate-request`

**States**: preparing, gated, running, validating, succeeded, failed, cancelled

**Initial State**: preparing

**Transitions**:
1. [ ] - `p1` - **FROM** preparing **TO** gated **WHEN** policy and, for cloud, audit commit succeed - `inst-st-gated`
2. [ ] - `p1` - **FROM** gated **TO** running **WHEN** the isolated adapter starts - `inst-st-running`
3. [ ] - `p1` - **FROM** running **TO** validating **WHEN** structured output arrives - `inst-st-validating`
4. [ ] - `p1` - **FROM** validating **TO** preparing **WHEN** the single repair attempt or validated fallback is required; it is gated again - `inst-st-retry`
5. [ ] - `p1` - **FROM** validating **TO** succeeded **WHEN** schema and evidence checks pass - `inst-st-success`
6. [ ] - `p1` - **FROM** preparing **TO** failed **WHEN** policy, audit or availability fails; running or validating also fails on terminal runtime or validation failure - `inst-st-failure`
7. [ ] - `p1` - **FROM** running **TO** cancelled **WHEN** the caller cancels; cancellation is also accepted during preparation or validation - `inst-st-cancel`

Only committed `llm_runs` metadata survives process exit; no cancelled result may mutate the caller's records.

## 5. Definitions of Done

### Runtime adapters and lockdown

- [ ] `p1` - **ID**: `cpt-noter-dod-core-llm-gate-adapters`

The system **MUST** implement the runtime interface for Claude Code, Codex and Ollama with pinned tested versions. Claude runs in an empty Noter-owned directory with strict per-run MCP config, a tool allow-list excluding WebFetch, WebSearch and Bash, empty setting sources and nonessential traffic disabled. Own-account runs use the same restrictions without `--bare`. Codex uses an isolated `CODEX_HOME` without user config and a read-only sandbox; the pinned-version adapter test proves config and credential use without reading subscription tokens into Noter. Ollama uses localhost `/api/chat` with the schema in `format`. Temporary capabilities and configs are deleted after every outcome. M2 runs permit no unavailable MCP tools.

**Implements**:
- `cpt-noter-flow-core-llm-gate-run`
- `cpt-noter-flow-core-llm-gate-session`
- `cpt-noter-algo-core-llm-gate-route`
- `cpt-noter-state-core-llm-gate-request`

**Constraints**: `cpt-noter-constraint-core-api-keys`

**Touches**:
- API: `cpt-noter-interface-llm-runtime`
- DB: `llm_runs`
- Entities: `RuntimeChoice`, per-run process configuration

### One gate and validated results

- [ ] `p1` - **ID**: `cpt-noter-dod-core-llm-gate-policy`

The system **MUST** reject audio egress, force sensitive processing local, redact where configured, commit audit metadata before each permitted cloud release and validate schema and evidence before accepting output. No caller can reach an adapter around the gate, and no operational log contains transcript, document, model text or credentials.

**Implements**:
- `cpt-noter-algo-core-llm-gate-egress`
- `cpt-noter-algo-core-llm-gate-validate`

**Constraints**: `cpt-noter-constraint-core-api-keys`

**Touches**:
- API: `cpt-noter-interface-skill-outputs`, `privacy:changed`
- DB: `audit_log`, `llm_runs`

### Privacy tests and gate

- [ ] `p1` - **ID**: `cpt-noter-dod-core-llm-gate-tests`

The system **MUST** pass unit tests for routing, redaction, failed-audit refusal, cancellation, retry and unknown citations; adapter/schema conformance; CI lockdown tests with hostile user hooks, plugins and MCP config; and the macOS network-monitor test with real pinned CLIs and a recording proxy. Every provider connection must match a run's audit evidence by run id and time, other hosts must match `contracts/egress-hosts.json`, and the engine must make no connection. Consuming real-core E2E uses the scripted runtime and owns its story ids. `just gate` passes.

**Implements**:
- `cpt-noter-flow-core-llm-gate-run`
- `cpt-noter-algo-core-llm-gate-egress`
- `cpt-noter-algo-core-llm-gate-validate`

**Touches**:
- Entities: run-lockdown and network-monitor test evidence

## 6. Acceptance Criteria

- [ ] Audit-write failure prevents adapter receipt of cloud text; sensitive and local-only calls produce zero provider requests.
- [ ] Unknown majors are refused; hostile user hooks, plugins, repo instructions and MCP servers never start in a runtime run.
- [ ] Redaction replaces PII and optional names consistently; reverse mapping restores attribution without logging originals.
- [ ] Invalid schema and missing or unknown evidence trigger one repair retry and then the simpler fallback; unvalidated output is never committed.
- [ ] Unit tests cover cancellation, two consecutive failures, budget and timeout paths; adapter conformance covers all three runtimes and cleanup.
- [ ] M2 real-core output and handoff E2E passes with the scripted runtime; the network-monitor release test separately proves actual egress behavior.
- [ ] `accounts_get` and `api_key_set` succeed in E2E against the real core with the scripted runtime. `noter-core-harness` provides a Keychain stand-in, a scripted secret store, as part of the Platform seam (Backend Teamlead decision D1, `.plans/core-harness.md`).
- [ ] `just gate` passes.
