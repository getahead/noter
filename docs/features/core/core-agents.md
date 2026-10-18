---
title: "Feature: Agents and council configuration"
description: "The agent registry, role skills, runtime availability and council modes per call type, with revision checks and changes applied at the next live tick."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M4
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Agents and council configuration

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Add and configure an agent](#add-and-configure-an-agent)
  - [Tune the council](#tune-the-council)
  - [Edit or restore a role skill](#edit-or-restore-a-role-skill)
  - [Repair an unavailable runtime](#repair-an-unavailable-runtime)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Validate and write the registry](#validate-and-write-the-registry)
  - [Save skill text safely](#save-skill-text-safely)
  - [Build the effective council](#build-the-effective-council)
- [4. States (CDSL)](#4-states-cdsl)
  - [Agent availability](#agent-availability)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Registry and council modes](#registry-and-council-modes)
  - [Versioned skills and runtime status](#versioned-skills-and-runtime-status)
  - [Prove the configuration contract](#prove-the-configuration-contract)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p5` - **ID**: `cpt-noter-featstatus-core-agents`

- [ ] `p5` - `cpt-noter-feature-core-agents`

## 1. Feature Context

### 1.1 Overview

Agents are rows, not code. The registry in `noter-core` serves the six built-in roles and added agents, their runtime, model, effort, tools, call types, budget share, order and skill. It stores live and post-call council modes per call type. Edits apply at the next tick, within a minute; an in-flight tick keeps its configuration. The copilot loop belongs to `cpt-noter-feature-core-copilot`.

### 1.2 Purpose

Let the user add a specialist, choose where it runs and repair an unavailable runtime without losing the other agents. The same registry supplies live ticks and post-call reviews.

**Requirements**: PRD › Feature specification › 8. Role council; PRD › LLM orchestration › Agent registry and role skills; owner decision D4.

**Principles**: None assigned by the decomposition; mutations use the existing single-writer and revision conventions.

**Delivers**:
- Commands frozen at the M4 gate (draft today): `agents_get`, `agent_create`, `agent_update`, `agents_reorder`, `agent_remove`, `agent_skill_get`, `agent_skill_save`, `agent_skill_reset`, `council_set_mode`.
- Events: `entity:changed` for changed agents.
- DESIGN.md stories (M4): `cpt-noter-seq-agents-add-agent`, `cpt-noter-seq-agents-tune-council`.

**Boundaries**: Account sign-in, keys and account binding belong to `cpt-noter-feature-core-credentials-privacy`. The router runs models; the post-call pipeline computes the D4 self-switch-off. This feature reads that result and lets the user turn the call type back on. It does not run the live loop, bypass the copilot flag, or add a new model adapter.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Adds, tunes, reorders and removes agents; edits skills and council modes |
| UI window (main, Settings, First run) | Reads the registry; only main may mutate it |
| Credentials service | Supplies runtime availability and the eligible one-step fix |
| Router and copilot | Read a consistent registry and skill revision at each tick |
| Post-call pipeline | Writes logged self-switch-offs for a call type |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md), Role council and Agent registry and role skills
- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-agents`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md), domain Agent, `cpt-noter-dbtable-agents`, `cpt-noter-constraint-core-copilot-flag`; no separate agents component is defined
- **Stories**: [DESIGN.md](../../DESIGN.md), `cpt-noter-seq-agents-add-agent`, `cpt-noter-seq-agents-tune-council`
- **Contract**: `crates/noter-protocol/src/model/agents.rs`, `common.rs`, `error.rs`, `ipc/mod.rs`; `contracts/ipc.manifest.json`
- **Dependencies**: `cpt-noter-feature-core-credentials-privacy`, `cpt-noter-feature-core-llm-gate`
- **Harness**: [HARNESS.md](../../HARNESS.md), `harness/milestones.toml` M4

The contract is canonical. Skill save/reset return `AgentSkill`, without a change handle; reorder and council mode return `AgentsView`. Their changes still enter History. The current draft does not expose a dedicated one-time self-switch-off notice or Choose File command; use the existing agent status, History and skill save/reset surfaces. Those presentation details need contract review at the M4 gate, not invented fields here.

Visual layout and contrast are not applicable here because the UI owns the editor. Server scaling, network retries and new authentication are not applicable because the registry is local and delegates runtime access to the existing router and credentials service. Configuration reads use one ordered registry snapshot, not one database query per agent; registry edits never wait for a model request. Diagnostic logs contain ids and error codes, not skill bodies or credentials.

## 2. Actor Flows (CDSL)

### Add and configure an agent

- [ ] `p5` - **ID**: `cpt-noter-flow-core-agents-create`

**Actor**: Primary user (main window)

**Success Scenarios**:
- Security reviewer is created from its template, initially off and with no feedback data, then enabled for Incident with a 10 % share.
- A new Finance agent uses the user's account when the M3 preference offers that account first.

**Error Scenarios**:
- A share would take the registry above 100 %: `invalid_input`; the saved shares stay unchanged.
- A runtime is unavailable: the row is paused with a reason and an eligible fix, while other agents remain runnable.
- Another window edited the agent: `conflict` with `detail.current_rev`.

**Steps**:
1. [ ] - `p1` - API: `agents_get {}` returns `AgentsView` with ordered agents, council rows, runtime choices and current live call - `inst-read-agents`
2. [ ] - `p1` - User selects Security reviewer, QA, Customer, Finance or Blank; API: `agent_create { template, name? }` - `inst-create-template`
3. [ ] - `p1` - Run `cpt-noter-algo-core-agents-write` to create the disabled row and its own role skill from the template; use the saved new-agent account preference only when that account is available - `inst-create-row`
4. [ ] - `p1` - **RETURN** `AgentMutation` with the new `AgentView` and `change_id`; no cards means `useful_share` is absent, not zero - `inst-created-result`
5. [ ] - `p1` - API: `agent_update { agent_id, rev, patch }` sets name, runtime, model, effort, tools, call types, share or enabled state - `inst-update-agent`
6. [ ] - `p1` - Validate and commit with `cpt-noter-algo-core-agents-write`; compute availability with `cpt-noter-algo-core-agents-effective` - `inst-validate-update`
7. [ ] - `p1` - Publish the whole agent as `entity:changed`; **RETURN** `AgentMutation` with the new revision and change handle for Undo - `inst-updated-result`

### Tune the council

- [ ] `p5` - **ID**: `cpt-noter-flow-core-agents-council`

**Actor**: Primary user (main window)

**Success Scenarios**:
- Remove Designer from 1:1 calls while retaining it for planning; choose fused live and parallel post-call per call type.
- Turn a self-switched-off agent back on for one type, or undo its logged switch through History.
- A change during a live call affects the next tick within a minute; existing cards remain.

**Error Scenarios**:
- Unknown call type, duplicate or missing agent in an order: `invalid_input`; unknown agent: `not_found`.
- Removing a built-in: `invalid_input`; it can be disabled instead.

**Steps**:
1. [ ] - `p1` - API: `agents_get {}`; show each call type's live and post-call modes and participating agents - `inst-council-read`
2. [ ] - `p1` - API: `agent_update` with the current revision changes `call_types`; turning a type back on clears its self-switch-off exclusion as a logged user change - `inst-council-membership`
3. [ ] - `p1` - API: `council_set_mode { call_type, live, post_call }` selects fused, parallel or off for each phase - `inst-council-mode`
4. [ ] - `p1` - Commit the mode row in `council_modes` through the writer and change log; **RETURN** the complete `AgentsView` - `inst-council-result`
5. [ ] - `p1` - API: `agents_reorder { order }`; validate it contains every current agent exactly once, commit all `ord` changes as one batch, **RETURN** `AgentsView` - `inst-council-order`
6. [ ] - `p1` - **IF** a call is live, make the committed configuration available to its next tick within a minute; keep already raised cards and do not alter the running tick - `inst-council-live`
7. [ ] - `p1` - **IF** the user removes an added agent, API: `agent_remove { agent_id }`; archive its skill directory, remove its active registry membership through the logged write, preserve past card attribution, **RETURN** `DeleteResult` - `inst-council-remove`

### Edit or restore a role skill

- [ ] `p5` - **ID**: `cpt-noter-flow-core-agents-skill`

**Actor**: Primary user (main window)

**Success Scenarios**:
- Save edited role Markdown; restore the built-in skill and use it from the next tick.
- A missing skill is reported explicitly and can be restored.

**Error Scenarios**:
- Missing agent: `not_found`; stale skill revision: `conflict`; disk failure: typed error with the last saved version retained.

**Steps**:
1. [ ] - `p1` - API: `agent_skill_get { agent_id }` returns `AgentSkill { agent_id, rev, body_md, is_default, missing }` - `inst-skill-read`
2. [ ] - `p1` - **IF** the file is missing, return `missing: true`; do not silently replace the user's skill - `inst-skill-missing`
3. [ ] - `p1` - User edits the body; API: `agent_skill_save { agent_id, rev, body_md }` validates the revision and saves through `cpt-noter-algo-core-agents-skill-write` - `inst-skill-save`
4. [ ] - `p1` - **IF** the user chooses Restore from Built-In, API: `agent_skill_reset { agent_id }` restores the shipped role text through the same write process - `inst-skill-reset`
5. [ ] - `p1` - **RETURN** the saved `AgentSkill`; the next tick reads this revision, and History holds the previous body for Undo - `inst-skill-result`

### Repair an unavailable runtime

- [ ] `p5` - **ID**: `cpt-noter-flow-core-agents-runtime-fix`

**Actor**: Primary user (main window)

**Success Scenarios**:
- A missing Codex key offers the signed-in ChatGPT account; switching returns an Undo handle.

**Error Scenarios**:
- The offered account became unavailable: the agent remains paused with the current reason; no credentials enter the view model.

**Steps**:
1. [ ] - `p1` - Compute the agent's `AgentStatus::Paused` and optional fix from the credentials service - `inst-fix-status`
2. [ ] - `p1` - **IF** a matching signed-in account is available, offer that runtime; otherwise offer Settings to repair the key, CLI or account - `inst-fix-offer`
3. [ ] - `p1` - User chooses the fix; API: `agent_update { agent_id, rev, patch }` with the offered runtime - `inst-fix-update`
4. [ ] - `p1` - Recheck availability, commit the choice, and **RETURN** `AgentMutation` with the new status and `change_id`; Undo uses the M2 History command - `inst-fix-return`

## 3. Processes / Business Logic (CDSL)

### Validate and write the registry

- [ ] `p5` - **ID**: `cpt-noter-algo-core-agents-write`

**Input**: Create, update, reorder, remove or council-mode intent; current registry and caller.

**Output**: A committed registry and change-log entry or batch, or `CoreError` with no partial registry change.

**Steps**:
1. [ ] - `p1` - Apply the manifest's window scopes; read and write registry rows only through the core's writer - `inst-write-scope`
2. [ ] - `p1` - **IF** an addressed agent is absent **RETURN** `not_found`; **IF** an edit's revision is stale **RETURN** `conflict` with the current revision - `inst-write-revision`
3. [ ] - `p1` - Validate nonempty names and models, supported runtime and effort values, known call types and permitted tool names; reject unsafe tools rather than enabling a bypass of the router - `inst-write-fields`
4. [ ] - `p1` - Validate each share from 0 to 100 and the resulting sum across the registry at most 100, including disabled agents; account runs still report no dollar cost - `inst-write-shares`
5. [ ] - `p1` - **IF** the order is not a permutation of current ids, or removal targets a built-in, **RETURN** `invalid_input` with the affected field - `inst-write-invariants`
6. [ ] - `p1` - **TRY** stage required skill creation or archival in the Noter-owned role directory, using an internal path rather than a user name as a path - `inst-write-stage`
   1. [ ] - `p1` - DB: INSERT, UPDATE or DELETE `agents`, or UPDATE `council_modes`, and write before, after, actor and reason in the same change-log transaction; bump revisions of changed agent rows - `inst-write-commit`
7. [ ] - `p1` - **CATCH** a file or database failure, roll back the transaction, restore staged files and **RETURN** a typed error; do not publish success - `inst-write-failure`
8. [ ] - `p1` - Invalidate the effective configuration cache, publish whole changed agents after commit, and **RETURN** the command's canonical result - `inst-write-publish`

### Save skill text safely

- [ ] `p5` - **ID**: `cpt-noter-algo-core-agents-skill-write`

**Input**: Agent id, edited Markdown and skill revision, or reset intent and shipped default text.

**Output**: A versioned role skill available to the router, or an error with the previous version usable.

**Steps**:
1. [ ] - `p1` - Resolve the agent-owned `skills/roles/<role>/SKILL.md`; refuse paths outside that owned directory and unknown agent ids - `inst-file-path`
2. [ ] - `p1` - **IF** saving with a stale skill revision **RETURN** `conflict`; a reset is serialised against the current skill at execution - `inst-file-rev`
3. [ ] - `p1` - Preserve the previous body in the change history; stage the new body in a temporary file beside the skill - `inst-file-stage`
4. [ ] - `p1` - **TRY** commit the logged skill version and atomically replace its file, retaining enough prior state to recover an interrupted replacement - `inst-file-commit`
5. [ ] - `p1` - **CATCH** a failure, restore the last committed body and **RETURN** a typed error - `inst-file-failure`
6. [ ] - `p1` - Invalidate cached skill text; **RETURN** `AgentSkill` with its new revision, default and missing flags - `inst-file-return`

### Build the effective council

- [ ] `p5` - **ID**: `cpt-noter-algo-core-agents-effective`

**Input**: Registry snapshot, skills, call type, phase, credentials availability, privacy mode, call mute state and flag.

**Output**: Ordered eligible agents, council mode, resolved runtime settings and view-ready statuses.

**Steps**:
1. [ ] - `p1` - Load `agents` ordered by `ord`, the call type's `council_modes` and current skill revisions as one configuration snapshot - `inst-effective-read`
2. [ ] - `p1` - **FOR EACH** agent, derive disabled, switched-off, paused or ok status from enabled state, D4 exclusions and runtime availability; include the reason and eligible same-tool account fix without secrets - `inst-effective-status`
3. [ ] - `p1` - Select enabled agents assigned to this call type, excluding self-switched-off and call-muted agents; leave unavailable agents paused rather than failing the whole council - `inst-effective-select`
4. [ ] - `p1` - **IF** the flag or selected phase's council mode is off, select no sessions; live capture and all non-copilot call surfaces remain available - `inst-effective-off`
5. [ ] - `p1` - **IF** live privacy requires local, use the router's local two-agent policy (Teamlead and Architect), or off when no local model is ready; never send a sensitive skill packet to cloud - `inst-effective-local`
6. [ ] - `p1` - **IF** fused, give the router the shared council instructions and ordered eligible skills for one model and effort; **ELSE IF** parallel, retain each agent's runtime, model, effort and permitted tools, with no lookup tools live - `inst-effective-mode`
7. [ ] - `p1` - Build stats from stored feedback: seven-day card count, useful-or-used share over the last 20 calls, absent when there is no data; **RETURN** the effective configuration and `AgentsView` - `inst-effective-return`

## 4. States (CDSL)

### Agent availability

- [ ] `p5` - **ID**: `cpt-noter-state-core-agents-availability`

**States**: disabled, ok, paused, switched_off

**Initial State**: disabled for a newly added agent; built-ins use their shipped enabled settings.

**Transitions**:
1. [ ] - `p1` - **FROM** disabled **TO** ok **WHEN** the user enables the agent, its call type is selected and its runtime is available - `inst-st-enable`
2. [ ] - `p1` - **FROM** disabled **TO** paused **WHEN** the user enables it with an unavailable runtime - `inst-st-enable-paused`
3. [ ] - `p1` - **FROM** ok **TO** paused **WHEN** its key, CLI, model or account becomes unavailable - `inst-st-unavailable`
4. [ ] - `p1` - **FROM** paused **TO** ok **WHEN** the credential is repaired or the user selects an available runtime - `inst-st-repair`
5. [ ] - `p1` - **FROM** ok **TO** switched_off **WHEN** the post-call pipeline logs at least 80 % dismissed over the last 10 calls of that type - `inst-st-self-off`
6. [ ] - `p1` - **FROM** switched_off **TO** ok **WHEN** Turn On or History Undo restores that call type and the runtime is available - `inst-st-turn-on`
7. [ ] - `p1` - **FROM** switched_off **TO** paused **WHEN** Turn On restores that call type but its runtime is unavailable - `inst-st-turn-on-paused`
8. [ ] - `p1` - **FROM** ok, paused or switched_off **TO** disabled **WHEN** the user disables the agent - `inst-st-disable`

Switch-off is per call type, not a global disable. Persistent configuration and D4 exclusions live in the registry and History; credential availability is derived again at startup. Only the post-call pipeline applies D4; no live tick self-disables an agent. Deleting an added agent removes it from this machine; built-in deletion is invalid.

## 5. Definitions of Done

### Registry and council modes

- [ ] `p5` - **ID**: `cpt-noter-dod-core-agents-registry`

The system **MUST** seed the six built-in roles, add disabled template agents with their own skills, preserve built-ins on remove, enforce share totals and revisions, store order and phase modes per call type, and log every mutation. Configuration changes **MUST** reach the next live tick within a minute without replacing cards already raised.

**Implements**:
- `cpt-noter-flow-core-agents-create`
- `cpt-noter-flow-core-agents-council`
- `cpt-noter-algo-core-agents-write`

**Constraints**: `cpt-noter-constraint-core-copilot-flag`

**Touches**:
- API: `agents_get`, `agent_create`, `agent_update`, `agents_reorder`, `agent_remove`, `council_set_mode`, `entity:changed`
- DB: `agents`, `council_modes`, `changes`
- Entities: `AgentView`, `AgentMutation`, `AgentsView`

### Versioned skills and runtime status

- [ ] `p5` - **ID**: `cpt-noter-dod-core-agents-skills-status`

The system **MUST** read, save and restore versioned role skills, report missing files, retain the previous version on failure, archive removed agents' directories and derive runtime pauses and eligible fixes without secrets. Fused and parallel configuration **MUST** preserve privacy, call-type exclusions, order and the live no-tools rule.

**Implements**:
- `cpt-noter-flow-core-agents-skill`
- `cpt-noter-flow-core-agents-runtime-fix`
- `cpt-noter-algo-core-agents-skill-write`
- `cpt-noter-algo-core-agents-effective`
- `cpt-noter-state-core-agents-availability`

**Touches**:
- API: `agent_skill_get`, `agent_skill_save`, `agent_skill_reset`, `agent_update`
- DB: `agents`, `changes`
- Entities: `AgentSkill`, `AgentStatus`, `RuntimeAvailability`, `AgentStats`

### Prove the configuration contract

- [ ] `p5` - **ID**: `cpt-noter-dod-core-agents-validation`

The system **MUST** pass unit tests for share totals, revisions, ordering, built-in protection, file recovery, missing skills, effective council selection and runtime fixes; conformance for window scopes and all nine result shapes; and real-core E2E for both assigned M4 stories. The draft contract's unresolved presentation details **MUST** be reviewed at the M4 freeze. `just gate` passes.

**Implements**:
- `cpt-noter-flow-core-agents-create`
- `cpt-noter-flow-core-agents-council`
- `cpt-noter-flow-core-agents-skill`
- `cpt-noter-flow-core-agents-runtime-fix`

**Covers (DESIGN)**:
- `cpt-noter-seq-agents-add-agent`
- `cpt-noter-seq-agents-tune-council`
- `cpt-noter-dbtable-agents`
- [ ] `p5` - `cpt-noter-constraint-core-copilot-flag`

## 6. Acceptance Criteria

- [ ] Unit tests write the failing case first: 100 % total saves, 101 % fails atomically, a stale edit returns `conflict`, a reorder is a full permutation and a built-in cannot be removed.
- [ ] Unit and integration tests cover save/reset and crash recovery of skill files, missing-file reporting, removal archival and historical card attribution after an added agent is removed.
- [ ] Conformance against the real core proves `agents_get` is allowed from main, Settings and First run, mutations only from main, typed errors and canonical result shapes. All nine commands succeed in real-core E2E at least once; a rejected built-in removal does not count as a successful removal.
- [ ] E2E `cpt-noter-seq-agents-add-agent`: create Security reviewer, select Incident, set 10 %, enable it, reject an over-budget edit without changing saved totals, and repair a missing key with a signed-in same-tool account and Undo.
- [ ] E2E `cpt-noter-seq-agents-tune-council`: remove Designer from 1:1 only, reorder, set fused live and parallel post-call, restore a missing built-in skill, turn a logged self-switch-off back on, and apply a live edit by the next tick within a minute while existing cards remain.
- [ ] Fused uses one shared model and effort; parallel preserves each agent's settings; disabled, unavailable and excluded agents cannot run. Flag-off and sensitive-without-local cases start no live sessions and never affect capture.
- [ ] `just gate` passes.
