---
title: "Feature — Agents and council"
description: "The Agents split view: add, edit, switch and order agents, edit role skills, and choose live and post-call council modes per call type."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-agents
milestone: M4
---

# Feature: Agents and council

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Add and configure an agent](#add-and-configure-an-agent)
  - [Choose or repair an agent runtime](#choose-or-repair-an-agent-runtime)
  - [Tune the council and restore a switched-off role](#tune-the-council-and-restore-a-switched-off-role)
  - [Reorder and remove agents](#reorder-and-remove-agents)
  - [Edit, restore and compare a skill](#edit-restore-and-compare-a-skill)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Validate and save agent fields](#validate-and-save-agent-fields)
  - [Announce an agent switched off by the core](#announce-an-agent-switched-off-by-the-core)
- [4. States (CDSL)](#4-states-cdsl)
  - [Agents page and editor](#agents-page-and-editor)
  - [Agent availability](#agent-availability)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Registry, fields and runtime fixes](#registry-fields-and-runtime-fixes)
  - [Council modes and switched-off notices](#council-modes-and-switched-off-notices)
  - [Skill editor and recovery](#skill-editor-and-recovery)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p5` - **ID**: `cpt-noter-featstatus-ui-agents`

## 1. Feature Context

- [ ] `p5` - `cpt-noter-feature-ui-agents`

### 1.1 Overview

**Agents** (⌘7) has a pinned **Council** row, a list grouped into **Built in** and **Added by you**, and an editor with **Settings** and **Skill** views. The user adds a role from a template, chooses its runtime, model, effort, tools and call types, and sets the council mode for each type. Changes apply at the next update, within a minute during a live call.

Scope includes AG-R1, AG-R0, AG-R2, AG-R3 and AG-R4, agent rows, the editor and council table. Card display belongs to `cpt-noter-feature-ui-copilot`. The core runs the agents, computes hit rates and switches an agent off for a call type; account sign-in and key storage belong to Settings and the accounts feature.

### 1.2 Purpose

It implements `cpt-noter-component-screen-agents`, `cpt-noter-component-ui-agent-list-row`, `cpt-noter-component-ui-agent-editor` and `cpt-noter-component-ui-council-mode-table`. Roles stay useful and affordable without editing application code.

**Requirements**: PRD › Feature specification › 8. Role council; Live copilot › Role council; LLM orchestration › Agent registry and role skills. The PRD has no requirement IDs.

**Principles**: none assigned solely to this feature in DECOMPOSITION; it follows its dependencies and `cpt-noter-principle-undo-over-confirm` for runtime and skill changes.

Success criteria: a newly added Security reviewer is off until enabled, runs only on the chosen call types, and appears with its own badge next call; council choices survive reload and do not stop capture.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Adds, edits, orders, switches and removes roles; tunes council modes and skills |
| Noter core (system) | Owns registry, skills, revisions, runtime availability, ranking order and next-tick application |
| Account and Settings surfaces | Connect accounts, install runtimes and configure keys; report availability back to Agents |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 8; Live copilot › Role council; LLM orchestration
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Screen — Agents; Agent list row; Agent editor; Council mode table; 4.2 council behaviour
- **Design elements**: `cpt-noter-component-screen-agents`, `cpt-noter-component-ui-agent-list-row`, `cpt-noter-component-ui-agent-editor`, `cpt-noter-component-ui-council-mode-table`; uses `cpt-noter-component-ui-agent-badge`, `cpt-noter-component-ui-prompt-editor`, `cpt-noter-component-ui-version-switcher`, `cpt-noter-component-ui-diff-view`, `cpt-noter-component-ui-undo-strip`
- **Stories delivered (M4)**: `cpt-noter-seq-agents-add-agent`, `cpt-noter-seq-agents-tune-council`
- **Frozen commands delivered at the M4 gate**: `agents_get`, `agent_create`, `agent_update`, `agents_reorder`, `agent_remove`, `agent_skill_get`, `agent_skill_save`, `agent_skill_reset`, `council_set_mode`. These commands are currently draft; M4 freezes them.
- **Shared commands**: `settings_get` for the default per-call cap (M0); `settings_update` belongs to Settings/first-run, not the main window; `window_navigate`, `window_announce` (M1); `history_list`, `change_undo`, `change_redo` through the history feature (M2); account sign-in and binding through the accounts feature (M3)
- **Earlier story integration**: Agents portions of `cpt-noter-seq-settings-sign-in-account` and `cpt-noter-seq-settings-replace-api-key` (M3), without moving them into the M4 denominator
- **Contract**: [bindings.ts](../../../apps/desktop/src/core/bindings.ts) › `AgentsView`, `AgentView`, `AgentPatch`, `AgentMutation`, `AgentSkill`, `RuntimeAvailability`, `CouncilModeRow`; `apps/desktop/src/core/fake/`
- **Events**: `entity:changed` for agents and removals, `accounts:changed`, `settings:changed`, `capture:state`; refetch council and availability when invalidated
- **Data**: `cpt-noter-dbtable-agents` in DESIGN-core, through the core only; skill files and their history are core-owned
- **Prototype modules**: `src/js/50-e-4-agents.js` (`screen('agents')`, editor and council panes); `src/js/50-e-1-components.js` (`C.agentListRow`, `C.agentEditor`, `C.councilModeTable`); `src/js/04-shared.js` (`C.agentBadge`); `src/js/60-f-accounts.js` (runtime groups, account states and fixes); `src/css/50-e.css`, `60-f.css`
- **Dependencies**: `cpt-noter-feature-ui-accounts`, `cpt-noter-feature-ui-copilot`; shared history and dialog components are reused for Undo and removal
- **Harness**: [milestones.toml](../../../harness/milestones.toml) › M4; [HARNESS.md](../../HARNESS.md) › frozen commands and named stories count only against the real core

## 2. Actor Flows (CDSL)

### Add and configure an agent

- [ ] `p5` - **ID**: `cpt-noter-flow-ui-agents-add-edit`

**Actor**: Primary user

**Success Scenarios**:
- **Add Agent** › **Security Reviewer** creates a selected, off row with **No data yet** and **Name** focused; Incident, 10 % and the row switch make it run next incident call
- With the account preference set, Finance starts on the user's Claude account and explains that plan usage limits replace per-call budget shares

**Error Scenarios**:
- **Shares add up to 112 %. Lower one to save.** keeps the invalid value while the user reduces Architect's share; both final shares total 100 %
- `conflict` preserves the draft and reads the latest revision; `runtime_unavailable` offers its named fix; a failed create never adds a local row

**Steps**:
1. [ ] - `p1` - User opens **Agents** from the sidebar or ⌘7; API: `agents_get`; after 300 ms show skeleton rows until the read resolves - `inst-open`
2. [ ] - `p1` - UI: render **Council**, grouped rows, order caption and AG-R4 percentages footnote; hide **Added by you** while empty - `inst-list`
3. [ ] - `p1` - User chooses **Security Reviewer**, **QA**, **Customer**, **Finance** or **Blank** from **Add Agent**; API: `agent_create` with that template - `inst-create`
4. [ ] - `p1` - UI: after the core returns the new off agent, select it under **Added by you**, show **No data yet**, open **Settings** and focus **Name**; section 7 records the current fake's wrong default - `inst-select-new`
5. [ ] - `p1` - UI: runtime and model come from the returned agent and availability, including the account-first preference; never infer an account from a remembered email - `inst-runtime-default`
6. [ ] - `p1` - User edits **Name**, **Runtime**, **Model**, **Effort**, **Budget share**, **Tools** or **Runs on**; the skill path and **Stance** remain read-only here - `inst-edit`
7. [ ] - `p1` - Algorithm: validate and save wanted field values through `cpt-noter-algo-ui-agents-save-fields`; preserve unsaved drafts per agent when selection changes - `inst-save-fields`
8. [ ] - `p1` - User enables the row with its switch or Space; API: `agent_update` with id, current rev and wanted enabled true - `inst-enable`
9. [ ] - `p1` - UI: render the returned revision and notify the council summary; during capture show **Changes apply within a minute** - `inst-applied`
10. [ ] - `p1` - **IF** the read or write fails with a retryable error: show an inline **Try Again** action; keep previous confirmed rows and drafts, with no automatic mutation retry - `inst-failure`
11. [ ] - `p1` - **RETURN** the core-owned agent selected in its editor - `inst-return-add`

### Choose or repair an agent runtime

- [ ] `p5` - **ID**: `cpt-noter-flow-ui-agents-runtime`

**Actor**: Primary user

**Success Scenarios**:
- **Use Your ChatGPT Account** repairs an agent whose Codex key is missing, with **Designer now runs on Codex · your ChatGPT account** · **Undo**
- Both accounts connected: either account can be selected for any agent; model choices follow its tool

**Error Scenarios**:
- **Codex key not set** or **Claude signed you out**: show the same reason on the row and editor; disconnected choices remain visible and disabled
- A runtime becomes unavailable during save: keep the confirmed runtime and offer the current fix; do not sign in automatically

**Steps**:
1. [ ] - `p1` - User opens **Runtime**; UI: group choices under **Your accounts**, **API keys**, **On this Mac**, marking unavailable choices **— not connected** - `inst-options`
2. [ ] - `p1` - UI: show Claude Code on Claude account or Anthropic key, Codex on ChatGPT account or Codex key, and Local model on Ollama; model options come from availability - `inst-models`
3. [ ] - `p1` - User selects an available runtime and a supported model, or chooses the supplied one-click account fix - `inst-select-runtime`
4. [ ] - `p1` - API: `agent_update` with id, rev and the wanted runtime and model; apply the returned agent and `change_id` - `inst-update-runtime`
5. [ ] - `p1` - UI: show the runtime change in AG-R0 with **Undo**; on an account, explain the account and plan and **Counts against the plan’s usage limits; the per-call budget share doesn’t apply.** - `inst-runtime-feedback`
6. [ ] - `p1` - User chooses **Undo**; delegate `change_undo` to the history feature and reread the agent, preserving a separate unsaved skill draft - `inst-runtime-undo`
7. [ ] - `p1` - **IF** no account fix is available: **Open Settings** navigates to **Models & Runtimes**; **Sign In with Claude…** or **Sign In with ChatGPT…** opens the accounts feature's sheet - `inst-open-accounts`
8. [ ] - `p1` - Core: sends account, settings or agent changes after connection or sign-out; API: `agents_get` refreshes availability and row warnings - `inst-availability`
9. [ ] - `p1` - **RETURN** a confirmed runtime or a visible paused agent with its fix - `inst-return-runtime`

### Tune the council and restore a switched-off role

- [ ] `p5` - **ID**: `cpt-noter-flow-ui-agents-council`

**Actor**: Primary user

**Success Scenarios**:
- Select **Council**, click the 1:1 agents summary, clear Designer's **1:1**, and see the council summary update while Planning keeps Designer
- A live-mode choice **Parallel (opt-in)** leaves the **Opt-in** tag; a slow agent misses its tick without delaying others

**Error Scenarios**:
- Once after the core's auto-disable: **Designer switched itself off for 1:1 calls** and **Undo**; the row keeps **Turn On**
- During a live call, disabling Designer stops new cards within a minute; old cards remain until they leave normally

**Steps**:
1. [ ] - `p1` - User selects **Council**; UI: one table row per call type, **Live**, **After the call**, agents summary, **Budget per call** and the slow-agent note - `inst-council`
2. [ ] - `p1` - User chooses live **Fused** or **Parallel (opt-in)**, or post-call **Fused** or **Parallel**; API: `council_set_mode` with call type and both wanted mode values - `inst-mode`
3. [ ] - `p1` - UI: apply returned `AgentsView`; preserve the other column when changing one; show **Opt-in** only for live parallel - `inst-mode-result`
4. [ ] - `p1` - User clicks an agents summary; UI: filter AG-R2 under **Agents on 1:1 calls** with **Show All**; clicking the summary again or **Show All** clears the filter - `inst-filter`
5. [ ] - `p1` - User selects Designer and clears **1:1** under **Runs on**; API: `agent_update` with rev and the full wanted call-type list; refresh the council summary - `inst-membership`
6. [ ] - `p1` - User edits **Budget per call**; validate locale currency and retain the draft; persistence from Agents requires resolution of the window-scope gap in section 7, so do not report this draft as saved - `inst-budget`
7. [ ] - `p1` - Algorithm: present a core-reported switched-off role once with `cpt-noter-algo-ui-agents-auto-off-notice` - `inst-auto-notice`
8. [ ] - `p1` - User selects **Turn On** on the row; API: `agent_update` with the affected type restored in `call_types`; preserve global enabled state and all other memberships - `inst-turn-on`
9. [ ] - `p1` - UI: after success show **Turned on for 1:1 calls** for 2.5 s and the checkbox ticked; **Undo** on the original notice instead delegates to the core's recorded History change - `inst-turn-on-feedback`
10. [ ] - `p1` - **IF** a live call is in progress: show **Changes apply within a minute**; the core applies changes at its next update; do not clear old cards - `inst-live`
11. [ ] - `p1` - **RETURN** confirmed council modes, membership and cap, or the field's retained error draft - `inst-return-council`

### Reorder and remove agents

- [ ] `p5` - **ID**: `cpt-noter-flow-ui-agents-order-remove`

**Actor**: Primary user

**Success Scenarios**:
- A drag, **Move Up**, **Move Down**, ⌥⌘↑ or ⌥⌘↓ changes ranking tie order; **Moved Architect to position 3 of 7** is announced
- Remove an added role after **Remove “Security reviewer”?**; past cards and reviews retain its name

**Error Scenarios**:
- A built-in role has **Remove Agent…** disabled with **Built-in agents can be disabled but not removed**
- The list changes during reorder or removal: refetch, retain selection if it still exists, and do not resend stale order automatically

**Steps**:
1. [ ] - `p1` - User selects an agent and drags its grip, chooses **Move Up** or **Move Down**, or presses the reorder chord - `inst-move`
2. [ ] - `p1` - UI: form one complete ordered list of agent ids, each once, keeping **Council** pinned outside the order and preserving group presentation - `inst-full-order`
3. [ ] - `p1` - API: `agents_reorder` with the complete list; apply the returned order before announcing position and restoring focus to the moved row - `inst-reorder`
4. [ ] - `p1` - User chooses **Remove Agent…** for an added agent; show the native destructive alert **Remove “Security reviewer”?** with **Its skill file moves to the Trash. Past cards and reviews keep its name.** - `inst-remove-alert`
5. [ ] - `p1` - **IF** Cancel, Escape or default Return is used: close the alert without mutation - `inst-cancel-remove`
6. [ ] - `p1` - **IF** Remove is chosen: API `agent_remove` with its id; after success remove the row, select **Council** and hide an empty **Added by you** group - `inst-remove`
7. [ ] - `p1` - **IF** a mutation fails: restore confirmed order or row, show its inline error and reread when needed - `inst-remove-error`
8. [ ] - `p1` - **RETURN** the confirmed registry and accessible row focus - `inst-return-order`

### Edit, restore and compare a skill

- [ ] `p5` - **ID**: `cpt-noter-flow-ui-agents-skill`

**Actor**: Primary user

**Success Scenarios**:
- **Skill** shows the role file in the prompt editor, version switcher and diff against built-in; saved edits are used by the core
- **Reset to Built-In** acts at once, preserves the user's edit as a version and shows **Architect skill reset to built-in** · **Undo**

**Error Scenarios**:
- **The skill file is missing** · **Restore from Built-In** · **Choose File…**
- Empty skill or `conflict`: retain typed text and explain the field error; do not overwrite a newer file

**Steps**:
1. [ ] - `p1` - User selects an agent and **Skill**; API: `agent_skill_get` with agent id; show loading and then its body, path and current revision - `inst-get-skill`
2. [ ] - `p1` - **IF** `missing` is true: show the missing-file banner and no fabricated skill text - `inst-missing`
3. [ ] - `p1` - User edits Markdown; the prompt editor provides its existing save and cancel controls, keyboard path and dirty-state handling - `inst-edit-skill`
4. [ ] - `p1` - API: `agent_skill_save` with agent id, skill revision and nonblank body; apply the returned skill revision on success - `inst-save-skill`
5. [ ] - `p1` - **IF** save fails: preserve draft and last saved body; a conflict reads the latest skill for review before another deliberate save - `inst-skill-failure`
6. [ ] - `p1` - User chooses **Restore from Built-In** or, for a built-in agent, **Reset to Built-In**; API: `agent_skill_reset` with the agent id, without a confirmation alert - `inst-reset`
7. [ ] - `p1` - UI: show returned built-in text and reset feedback with **Undo**; retain the previous edit through the core's version history, subject to the contract gap in section 7 - `inst-reset-result`
8. [ ] - `p1` - User chooses a skill version or **Choose File…**; the version, comparison and native file-import paths require the core support described in section 7; never open arbitrary paths from the WebView - `inst-versions-file`
9. [ ] - `p1` - **RETURN** the saved skill or an intact editable draft and visible error - `inst-return-skill`

## 3. Processes / Business Logic (CDSL)

### Validate and save agent fields

- [ ] `p5` - **ID**: `cpt-noter-algo-ui-agents-save-fields`

**Input**: confirmed `AgentsView`, per-agent drafts, current revisions, changed field and runtime availability

**Output**: saved agent revision or retained drafts with labelled errors

**Steps**:
1. [ ] - `p1` - UI: keep each agent's unsaved fields separately from its last confirmed record; bind the slider and percent number field to the same draft - `inst-draft`
2. [ ] - `p1` - Validate nonblank name, supported runtime/model, effort choice and percent from 0 to 100; tools and call types use the supplied option ids - `inst-validate`
3. [ ] - `p1` - Sum budget shares across the current registry using drafts where present; account runtimes explain that a share does not limit plan usage - `inst-total`
4. [ ] - `p1` - **IF** the total exceeds 100: retain all values, associate **Shares add up to 112 %. Lower one to save.** with the percent field, announce it politely and do not persist the invalid shares - `inst-over`
5. [ ] - `p1` - **ELSE**: save valid changed fields through `agent_update` with id and latest confirmed rev; serialise saves per agent so a prior response cannot overwrite a newer draft - `inst-save`
6. [ ] - `p1` - **IF** several shares were edited: save decreases before increases, applying returned revisions and stopping on failure; the lack of an atomic multi-agent save is recorded in section 7 - `inst-share-order`
7. [ ] - `p1` - **IF** `invalid_input`: keep the value and attach the typed validation reason to the field; never display `CoreError.message` - `inst-invalid`
8. [ ] - `p1` - **IF** `conflict`: read `agents_get`, retain the draft for review against the newer value and wait for explicit reapplication - `inst-conflict`
9. [ ] - `p1` - **IF** `runtime_unavailable`: retain the confirmed runtime, show the typed reason and current fix, and refresh availability - `inst-unavailable`
10. [ ] - `p1` - Store: apply higher-revision `entity:changed` records and mutation results by id; do not overwrite another agent's draft - `inst-store`
11. [ ] - `p1` - **RETURN** confirmed fields, remaining drafts and the current validation total - `inst-return-save`

### Announce an agent switched off by the core

- [ ] `p5` - **ID**: `cpt-noter-algo-ui-agents-auto-off-notice`

**Input**: agent status, affected call type, core History change and page-visit notice state

**Output**: one AG-R0 notice, a persistent row warning and Undo/Turn On paths

**Steps**:
1. [ ] - `p1` - **IF** the core reports switched_off: render **Switched itself off for 1:1 calls** · **Turn On** on the row; do not change global enabled state or other call types - `inst-warning`
2. [ ] - `p1` - **IF** the core's auto-disable change has not been announced: show **Designer switched itself off for 1:1 calls** in AG-R0 and its supplied dismissal context, with **Undo** - `inst-once`
3. [ ] - `p1` - UI: keep the AG-R4 explanation of useful-or-used percentages over 20 calls and the 80 % dismissed threshold over the last 10 calls; never calculate the disable decision in React - `inst-rule`
4. [ ] - `p1` - **IF** the user chooses Undo: send the original change id through History's undo flow, then refresh agents and membership - `inst-undo`
5. [ ] - `p1` - **IF** Turn On succeeds: clear the warning from confirmed status, tick the affected **Runs on** field and show the 2.5-second inline status - `inst-restored`
6. [ ] - `p1` - **RETURN** one-time feedback and the still-current row state; missing notice identity and context are a contract gap in section 7 - `inst-return-notice`

## 4. States (CDSL)

### Agents page and editor

- [ ] `p5` - **ID**: `cpt-noter-state-ui-agents-editor`

**States**: LOADING, COUNCIL, SETTINGS, SKILL_LOADING, SKILL_READY, SKILL_MISSING, FIELD_INVALID, SAVING, READ_ERROR

**Initial State**: LOADING

**Transitions**:
1. [ ] - `p1` - **FROM** LOADING **TO** COUNCIL **WHEN** the registry loads with no selected agent - `inst-loaded`
2. [ ] - `p1` - **FROM** LOADING **TO** SETTINGS **WHEN** an agent deep link resolves in the registry - `inst-deep-link`
3. [ ] - `p1` - **FROM** LOADING **TO** READ_ERROR **WHEN** the read fails; Try Again returns to LOADING - `inst-read-error`
4. [ ] - `p1` - **FROM** COUNCIL or SETTINGS **TO** SETTINGS **WHEN** an agent is selected or created successfully - `inst-select`
5. [ ] - `p1` - **FROM** SETTINGS **TO** FIELD_INVALID **WHEN** the current draft fails field or total-share validation - `inst-invalid`
6. [ ] - `p1` - **FROM** SETTINGS or FIELD_INVALID **TO** SAVING **WHEN** valid wanted fields are submitted - `inst-submit`
7. [ ] - `p1` - **FROM** SAVING **TO** SETTINGS **WHEN** the latest save succeeds; invalid or rejected drafts stay FIELD_INVALID with their reason - `inst-save-result`
8. [ ] - `p1` - **FROM** SETTINGS **TO** SKILL_LOADING **WHEN** the user selects Skill - `inst-open-skill`
9. [ ] - `p1` - **FROM** SKILL_LOADING **TO** SKILL_READY **WHEN** a present skill loads - `inst-skill-loaded`
10. [ ] - `p1` - **FROM** SKILL_LOADING **TO** SKILL_MISSING **WHEN** the core reports missing - `inst-skill-missing`
11. [ ] - `p1` - **FROM** SKILL_MISSING **TO** SKILL_READY **WHEN** a core-backed restore succeeds - `inst-skill-restored`
12. [ ] - `p1` - **FROM** SKILL_READY **TO** SKILL_READY **WHEN** save or reset succeeds; failures keep the draft and inline error in the Skill view - `inst-skill-save`
13. [ ] - `p1` - **FROM** SETTINGS, FIELD_INVALID, SKILL_READY or SKILL_MISSING **TO** COUNCIL **WHEN** Council is selected; retain drafts by agent - `inst-select-council`
14. [ ] - `p1` - **FROM** any selected-agent state **TO** COUNCIL **WHEN** the selected agent is removed by a confirmed mutation or event - `inst-removed`

Live-call notice, runtime warnings, council-list filter and narrow push navigation are independent view conditions; changing them does not discard the selected agent's draft.

### Agent availability

- [ ] `p5` - **ID**: `cpt-noter-state-ui-agents-availability`

**States**: ENABLED, DISABLED, RUNTIME_PAUSED, TYPE_SWITCHED_OFF

**Initial State**: supplied `AgentView.status` and enabled value

**Transitions**:
1. [ ] - `p1` - **FROM** DISABLED **TO** ENABLED **WHEN** the user enables the role and the core confirms an available runtime - `inst-enabled`
2. [ ] - `p1` - **FROM** ENABLED **TO** DISABLED **WHEN** the core confirms wanted enabled false - `inst-disabled`
3. [ ] - `p1` - **FROM** ENABLED **TO** RUNTIME_PAUSED **WHEN** its key, account session or runtime becomes unavailable - `inst-paused`
4. [ ] - `p1` - **FROM** RUNTIME_PAUSED **TO** ENABLED **WHEN** reconnect or a successful runtime switch restores availability for an enabled agent - `inst-runtime-restored`
5. [ ] - `p1` - **FROM** ENABLED **TO** TYPE_SWITCHED_OFF **WHEN** the core reports the dismissal threshold reached for a call type; other types keep running - `inst-auto-off`
6. [ ] - `p1` - **FROM** TYPE_SWITCHED_OFF **TO** ENABLED **WHEN** Turn On or Undo restores that membership - `inst-type-restored`
7. [ ] - `p1` - **FROM** RUNTIME_PAUSED or TYPE_SWITCHED_OFF **TO** DISABLED **WHEN** the user disables the role globally and the core confirms - `inst-user-disable`
8. [ ] - `p1` - **FROM** DISABLED **TO** RUNTIME_PAUSED or TYPE_SWITCHED_OFF **WHEN** re-enabling returns that core status; do not hide the reason behind a successful switch animation - `inst-enable-unavailable`

These are displayed availability states, not UI-owned agent lifecycles. Core status takes precedence; type-specific exclusions are not a global off switch.

## 5. Definitions of Done

### Registry, fields and runtime fixes

- [ ] `p5` - **ID**: `cpt-noter-dod-ui-agents-registry`

The system **MUST** render the list and editor from `AgentsView`, create off agents from all five templates, validate and retain drafts, expose runtime groups and fixes, apply revisions and report Undo for runtime changes. It must implement ordering by drag, keyboard and single-pointer controls, and remove only added agents after the native alert. Built-in agents remain switchable and cannot be removed.

**Implements**:
- `cpt-noter-flow-ui-agents-add-edit`
- `cpt-noter-flow-ui-agents-runtime`
- `cpt-noter-flow-ui-agents-order-remove`
- `cpt-noter-algo-ui-agents-save-fields`
- `cpt-noter-state-ui-agents-editor`
- `cpt-noter-state-ui-agents-availability`

**Constraints**: none assigned solely to this feature; shared bridge, accessibility and account rules apply

**Touches**:
- Commands: `agents_get`, `agent_create`, `agent_update`, `agents_reorder`, `agent_remove`; shared account and History commands
- Data: `cpt-noter-dbtable-agents`, through the core only
- Tests: every path of `cpt-noter-seq-agents-add-agent` against the real core; unit cases for stale replies, removed selection, failed create, cross-agent drafts, share decreases before increases and runtime loss during save

### Council modes and switched-off notices

- [ ] `p5` - **ID**: `cpt-noter-dod-ui-agents-council`

The system **MUST** provide live and post-call mode pop-ups per call type, the **Opt-in** tag for live parallel, list filtering, a locale currency cap and the live-call notice. It must show the core's auto-disable reason once, preserve its History identity for Undo and restore only the affected call type with **Turn On**. Existing live cards stay when a role is disabled.

**Implements**:
- `cpt-noter-flow-ui-agents-council`
- `cpt-noter-algo-ui-agents-auto-off-notice`

**Constraints**: none assigned solely to this feature

**Touches**:
- Commands: `council_set_mode`, `agent_update`, `agents_get`; shared Settings and History commands
- Tests: every path of `cpt-noter-seq-agents-tune-council` against the real core; unit cases for filter reset, preserving the unchanged mode column, one-time notice, error during Turn On and membership restoration; screenshots for every council state

### Skill editor and recovery

- [ ] `p5` - **ID**: `cpt-noter-dod-ui-agents-skill`

The system **MUST** load and save the role skill with its own revision, preserve edits on conflict, restore a missing built-in skill, and show versions, comparison and reset Undo using core-owned data. The unsupported version, file-import and reset-history paths in section 7 require protocol-owner resolution before this DoD can be checked.

**Implements**:
- `cpt-noter-flow-ui-agents-skill`
- `cpt-noter-state-ui-agents-editor`

**Constraints**: none assigned solely to this feature

**Touches**:
- Commands: `agent_skill_get`, `agent_skill_save`, `agent_skill_reset`; existing prompt editor and History components
- Tests: real-core successful skill get/save/reset for M4 command proof; the tune-council missing-skill story path; unit cases for empty body, conflict, read failure, restore failure and changing selection with a dirty skill

## 6. Acceptance Criteria

- [ ] Both M4 story IDs pass with every named happy, error and other path against the real core; M3 account integration remains assigned to M3
- [ ] Security reviewer is created off, with no data, Name focused; enabling it for Incident adds its cards only where configured
- [ ] Entering 30 at a total of 112 % retains the value and error; lowering Architect to 6 saves the valid final shares without losing either draft
- [ ] All five runtime choices remain visible, unavailable ones disabled; account quick fixes and Undo use confirmed core changes; session expiry pauses only affected roles
- [ ] Fused live and Parallel after the call are the defaults for new settings; supplied per-type choices remain intact, including the prototype's Interview override
- [ ] Council membership filtering toggles off with the same summary or **Show All**; changing a field preserves the filter and selection until their confirmed target leaves
- [ ] Auto-disable notice appears once for its core change, the row keeps **Turn On**, and restoration does not globally enable an unrelated type or erase other settings
- [ ] Reorder works with drag, **Move Up/Down** and keyboard, with a full-order command and polite announcement; built-in removal is disabled
- [ ] Skill get, save and reset use the correct revision; conflicts preserve text; missing-file restore works; versions, diff, Choose File and reset Undo have resolved core paths before delivery
- [ ] Wide, Medium and Narrow, German +30 %, Cyrillic, dark appearance, Increase Contrast and Reduce motion meet the shared foundations and the prototype's appearance
- [ ] Write failing tests before implementation; `just gate-fast` and `just gate` pass without lowered thresholds or edited screenshot baselines

## 7. Additional Context

**Prototype reuse.** Rewrite `screen('agents')`, its editor and council panes, `C.agentListRow`, `C.agentEditor` and `C.councilModeTable` in React with the same structure, tokens and data attributes. Port `.ag-*`, `.e-agrow*`, `.e-form*` and `.e-council*` from `src/css/50-e.css`; reuse the shared agent badge, prompt editor, version switcher, diff view, undo strip and inline banners. Reuse the runtime field and account-state layouts from `src/js/60-f-accounts.js` as the accounts feature's React components, not a second sign-in flow. `NP.local`, `ag.*`, `NP.undo`, sample skills and fake diff strings are source-of-truth examples only; production calls the typed bridge. The removal alert is drawn natively.

**States coverage.**

| DESIGN state | Prototype state or interaction |
| --- | --- |
| Loading | `loading` |
| Council, agent Settings, Skill with diff | `default`, `agent`, `skill` |
| New agent | `new-agent`; **Add Agent** |
| Shares over 100 % | `budget-over` |
| Runtime unavailable | `runtime` |
| Runtime unavailable, account fix | Account extension in `60-f-accounts.js` |
| Agent on an account; both accounts signed in | Account state selectors and runtime line |
| Account session ended; runtime changed | Account extension warning and AG-R0 Undo |
| Agent switched itself off | `switched-off`, row **Turn On**, 2.5-second status |
| Skill file missing; reset | `skill-missing`, `ag.restore`, `ag.reset`, `ag.undoReset` |
| Live call | `live-call` |
| Filtered list; live parallel | Council summary and **Show All**; **Parallel (opt-in)** |
| Disabled, hover, focus, selected | Agent row and shared controls |

**Size and access.** AG-R2 is 300 pt wide, 240 pt in Medium; its hidden hit-rate badge stays in the accessible row label. Narrow uses list-to-editor push navigation and **Back**, retaining the draft and selected row. The form is at most 760 pt; below a pane width of 600 pt labels move above controls. Effort becomes a pop-up when translated segments do not fit. Agent names tail-truncate with full help tags. Focus follows **Add Agent**, AG-R0, agent list, editor header and fields. ↑/↓ selects, Space switches, ⌥⌘↑/↓ reorders; every drag has **Move Up/Down** equivalents. Controls have labels, field errors are their descriptions, the council has row/column headers, and reorder announces the new position. Under Reduce motion, rows and banners change in place. Percentages, money and counts use locale rules; skill content keeps its language.

**DESIGN versus prototype.** The prototype's `switched-off` state uses Product manager rather than the story's Designer; render the actual affected agent, and test both fixtures. Its sample roster includes QA lead, Scribe and Devil's advocate rather than only the PRD's six built-ins; production uses core registry flags and names, never that hardcoded roster. Its council has an Interview row with Fused after the call; preserve supplied choices rather than forcing defaults. Dragging only shows a grip, and narrow push navigation and form reflow at the pane boundary are not fully built in the prototype (README); DESIGN supplies those missing behaviours. Reset, skill versions and diff are local demonstrations rather than persisted versions.

**Contract and fake-core gaps before freeze.**

- `agent_create` in the fake sets enabled true and copies runtime/call types from the first row. DESIGN and the prototype require off, template defaults and the account-first preference. The UI must not silently present the returned enabled agent as off; fix and verify this core behaviour before M4.
- The multi-agent share story requires retaining an invalid draft while editing another role. `agent_update` edits only one agent; there is no atomic share-set command. Decreases-before-increases can reach the intended final total without submitting an invalid intermediate total, but partial failure leaves the successfully saved decrease visible and the remaining draft intact. The owner must settle whether the story requires atomicity; the fake currently does not validate total shares at all.
- `AgentSkill` exposes only the current body, revision, default flag and missing flag. There is no skill-version list/get, built-in comparison read or native skill-import command; `agent_skill_reset` returns no change id. Existing output-version commands address outputs, not agent skills. Thus true version switching, diff after reload, **Choose File…**, retained reset versions and History-backed reset Undo cannot be completed against this contract. Do not substitute sample strings or a WebView filesystem API.
- `AgentStatus.switched_off` has type and call count but no dismissal percentage, notice/change id or acknowledged flag. History can provide a recorded change for Undo when present; it does not by itself provide a durable notice acknowledgement or typed 82 % context. The owner must supply the one-time identity and evidence before this part of the story is complete; a page-local flag is not durable proof.
- The fake does not model auto-disable, clear switched-off status after a membership update, persist runtime Undo, or publish council/reorder invalidations. Its skill read always says present. Use injected worlds and forced errors to exercise UI states, then prove real events, missing files, auto-disable and next-tick effects against the core.
- The budget cap is not in `AgentsView` or `council_set_mode`; it exists as `settings.copilot.default_cap_usd`. However, `settings_update` is allowed only from settings and first-run, not main, so the inline Agents currency field has no permitted persistence path. Its UI and validation are specified, but saving it requires protocol-owner resolution before freeze. Do not invoke the Settings command from main or invent a cross-window write path. `CouncilMode` also allows off, but DESIGN and the prototype expose Fused and Parallel here; do not add an unapproved Off menu option.

**Data and errors.** Keep only page state, selected ids and drafts locally. The core owns skill paths, files, revisions, history and ranking; removing an agent trashes its skill but preserves historical names. Render Markdown safely and treat file paths as display text, never shell commands. Only main may call registry commands. The bridge handles typed errors, stale replies and safe logging; no automatic write retries, no secret, transcript or skill text in logs. Clear listeners and draft timers on unmount, and reread availability after account changes rather than polling or probing runtimes from React.

**Not applicable.** Credential storage, authentication, agent execution, cloud requests, database queries, migration, rate computation, threshold decisions and model latency are core or accounts responsibilities. This feature adds no API, infrastructure, permission prompt or regulatory policy. It uses the existing local single-user security boundary.
