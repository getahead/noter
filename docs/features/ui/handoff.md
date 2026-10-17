---
title: "Feature — Handoff to Claude Code and Codex"
description: "Edit an engineering item's prompt and open or copy it with the target repository and launch path visible."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-handoff
milestone: M2
---

# Feature: Handoff to Claude Code and Codex

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Prepare, edit and compare a prompt](#prepare-edit-and-compare-a-prompt)
  - [Open or copy the handoff](#open-or-copy-the-handoff)
  - [Add, edit or remove a repository mapping](#add-edit-or-remove-a-repository-mapping)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Derive launch controls from the core view](#derive-launch-controls-from-the-core-view)
- [4. States (CDSL)](#4-states-cdsl)
  - [Handoff prompt and action](#handoff-prompt-and-action)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Prompt lifecycle and delivery](#prompt-lifecycle-and-delivery)
  - [Repository mappings](#repository-mappings)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p3` - **ID**: `cpt-noter-featstatus-ui-handoff`

## 1. Feature Context

- [ ] `p3` - `cpt-noter-feature-ui-handoff`

### 1.1 Overview

An engineering action item's Handoff opens a non-modal drawer with an editable, versioned Markdown prompt, target, repository and launch explanation. The core generates, stores, copies and launches; nothing is sent until Return in the target tool. Settings › Repositories and Add Mapping manage the same mappings. This feature owns no terminal process, automation script or cloud client.

### 1.2 Purpose

It implements `cpt-noter-component-ui-handoff-drawer` and `cpt-noter-component-ui-prompt-editor`, with repository mapping controls in Settings.

**Requirements**: PRD › Feature specification › 9. Handoff to Claude Code and Codex; Security, privacy and permissions › Handoff prompts and Automation. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-core-owns-state`, `cpt-noter-principle-evidence-one-click`, `cpt-noter-principle-privacy-visible`, `cpt-noter-principle-keyboard-first`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Edits the prompt, picks the tool, maps a repository and opens or copies the handoff |
| Noter core (system) | Generates and versions prompts, resolves mappings, copies or launches |
| Claude Code or Codex (external system) | Opens the prepared prompt in the repository, waiting for user submission |
| macOS (system) | Draws the folder picker and requests Automation on terminal fallback |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 9
- **Design**: [DESIGN.md](../../DESIGN.md) › Handoff drawer HD-R1–HD-R7; Prompt editor; Call page States; Settings › Repositories; Dialogs › Add Mapping
- **Decomposition**: [DECOMPOSITION.md](../../DECOMPOSITION.md) › 2.21, M2, NOT_STARTED
- **Design elements**: `cpt-noter-component-ui-handoff-drawer`, `cpt-noter-component-ui-prompt-editor`; uses `cpt-noter-component-ui-version-switcher`, `cpt-noter-component-ui-diff-view`
- **Stories**: `cpt-noter-seq-call-page-hand-off-item` (M2, every path)
- **Frozen commands it delivers (M2)**: `handoff_get`, `handoff_generate`, `handoff_edit`, `handoff_set_target`, `handoff_open`, `handoff_copy`, `handoff_cancel`, `repos_list`, `repo_upsert`, `repo_remove`
- **Events**: `entity:changed` (handoff and item); settings mapping refresh through the bridge
- **Contract**: `apps/desktop/src/core/bindings.ts` › HandoffView, PromptState, LaunchPlan, HandoffAction, RepoMapping; `apps/desktop/src/core/fake/handlers.ts` and `fake-core.ts`
- **Prototype modules**: `src/js/30-c-callpage.js` › `inspector('handoff')`; `src/js/30-c-0-components.js` › `C.promptEditor`; `src/js/30-c-dialogs.js` › `dlg-mapping`; `src/js/50-e-5-settings.js` › Repositories; `src/css/30-c.css` › `.hd-*`, `.pc-prompt*`; Settings styles in `50-e.css`
- **Dependencies**: `cpt-noter-feature-ui-items`, `cpt-noter-feature-ui-settings`; version switcher/diff reuse `cpt-noter-feature-ui-call-page-outputs`, dialog attachment uses the existing dialog host

## 2. Actor Flows (CDSL)

### Prepare, edit and compare a prompt

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-handoff-prepare`

**Actor**: Primary user

**Success Scenarios**:
- Handoff opens the drawer; Writing the handoff prompt… resolves to prompt, target, repository and launch line. Editing shows Edited and Your Edit without changing item text.
- Diff shows Showing changes against the generated prompt; Hide Diff restores editing. Regenerate creates a new generated version and drops the prompt edit as the prototype specifies.

**Error Scenarios**:
- Couldn't write the prompt → Try Again. Cancel stops generation and restores the previous prompt or not-generated state.
- An unknown/deleted or non-engineering item cannot open a usable handoff; prompt conflicts retain the draft.

**Steps**:
1. [ ] - `p1` - User clicks Handoff on a non-done engineering item; open the 400-pt drawer in the inspector slot and focus Target - `inst-open`
2. [ ] - `p1` - API: `handoff_get` with item id; render the returned state; if not generated call `handoff_generate` with regenerate false - `inst-get`
3. [ ] - `p1` - While generating show prompt skeleton, spinner, Writing the handoff prompt… and Cancel; disable open/copy until a usable prompt exists - `inst-generating`
4. [ ] - `p1` - Consume `entity:changed` for this handoff only; the immediate generating response is not a finished prompt - `inst-event`
5. [ ] - `p1` - User edits the soft-wrapped Markdown text; retain the base handoff rev and save with `handoff_edit` before a copy/open action - `inst-edit`
6. [ ] - `p1` - **IF** save conflicts: keep the draft separate, refresh handoff_get and require an explicit new save; no launch or copy follows a failed save - `inst-conflict`
7. [ ] - `p1` - User toggles Diff to compare prompt_md and generated_md; show read-only inserted/deleted words, then Hide Diff to return to the same edit - `inst-diff`
8. [ ] - `p1` - **IF** Regenerate is chosen: `handoff_generate` with regenerate true; keep previous versions, replace the prompt draft only after the user's regenerate action - `inst-regenerate`
9. [ ] - `p1` - **IF** Cancel is chosen while generating: `handoff_cancel`; render its previous ready or not_generated result and ignore superseded completion events - `inst-cancel`
10. [ ] - `p1` - **RETURN** ready/edited prompt; Esc closes the drawer outside composition and returns focus to its Handoff row - `inst-return`

### Open or copy the handoff

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-handoff-deliver`

**Actor**: Primary user

**Success Scenarios**:
- Own item: Copy Prompt then Open in Claude Code, with Open default at right; ⌘Return opens the prompt, unsent, in its repository and records Handed off.
- Someone else's item: Open then Copy Prompt, Copy default at right; copy keeps the item open and owned by that person.
- Codex changes Target, launch explanation and Open label; opening or copying accepts a suggestion.

**Error Scenarios**:
- No handler: launch line explains iTerm fallback and its one-time Automation prompt before Open.
- Automation denied: Couldn't open Claude Code · use Copy Prompt; Copy stays usable.
- No mapped or missing repository: Open disabled with reason; Copy remains usable once the prompt is ready.

**Steps**:
1. [ ] - `p1` - Show Target Claude Code/Codex, mapping, prompt and LaunchPlan explanation before the footer; default_action comes from the core - `inst-plan`
2. [ ] - `p1` - User changes Target; API: `handoff_set_target`; update returned target, default action and launch line together - `inst-target`
3. [ ] - `p1` - **IF** sensitive: show **This call is sensitive. The prompt reaches a cloud model when you press Return in the terminal.**; no automatic send - `inst-sensitive`
4. [ ] - `p1` - **IF** suggested: show **Opening or copying accepts this suggested item.** above the footer - `inst-suggested`
5. [ ] - `p1` - User invokes a footer action or ⌘Return; flush any prompt draft with handoff_edit, then run the current core default or clicked action once - `inst-invoke`
6. [ ] - `p1` - **MATCH** action - `inst-action`
   1. [ ] - `p1` - **CASE** Copy Prompt: `handoff_copy`; show Copied for 2 s and apply the returned item as the core sets it: a successful copy marks it `handed_off` and accepts a suggested item (DESIGN-core: handoff opened or copied → handed_off); no tool is launched - `inst-copy`
   2. [ ] - `p1` - **CASE** Open: `handoff_open`; core resolves the launch path and permissions; on success use path_used and the returned item to show Handed off to Claude Code/Codex or Opened in iTerm - `inst-launch`
7. [ ] - `p1` - **IF** automation_denied, no_link_handler or another launch failure: show the matching reason and Copy Prompt; do not mark success or retry automatically - `inst-failure`
8. [ ] - `p1` - **IF** repo_not_mapped or repo_path_missing: refresh mapping/launch state, disable Open with its reason and offer Add Mapping… or repair in Settings - `inst-repo-error`
9. [ ] - `p1` - **IF** prompt_not_ready: return to generation state; copy/open cannot use a stale or absent prompt - `inst-prompt-error`
10. [ ] - `p1` - **RETURN** copied prompt or core handoff record with time and cwd; a successful copy or open marks Handed off, a failed launch does not - `inst-return`

### Add, edit or remove a repository mapping

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-handoff-mapping`

**Actor**: Primary user

**Success Scenarios**:
- No repository mapped for VSTOR → Add Mapping… opens the sheet with From the Handoff drawer and VSTOR prefilled; choose folder, add mapping, Open becomes enabled.
- Settings lists key/component, local folder and default tool; Add, edit and remove persist through the same core repository list.

**Error Scenarios**:
- Duplicate key, empty key, missing path or folder-panel cancellation leaves the draft; cancelled removal changes nothing.
- A mapping removed in Settings invalidates the open drawer's launch plan.

**Steps**:
1. [ ] - `p1` - Read `repos_list` in Settings › Repositories and when a Handoff drawer needs mapping choices - `inst-list`
2. [ ] - `p1` - User chooses Add Mapping…; dialog host opens dlg-mapping, preserves the source window and prefills unmapped_key from HandoffView - `inst-sheet`
3. [ ] - `p1` - Require a non-empty project/component key and default tool; choose the folder through the core-owned folder panel, not a WebView filesystem read - `inst-choose`
4. [ ] - `p1` - Add Mapping calls `repo_upsert` with no id; editing sends the existing mapping id; null local_path asks the core to show the folder panel - `inst-save`
5. [ ] - `p1` - **IF** cancelled or invalid: keep the draft or show the returned field error; no success flash or launch - `inst-error`
6. [ ] - `p1` - After success render returned mappings, refresh handoff_get and its LaunchPlan, then restore focus to the repository control - `inst-refresh`
7. [ ] - `p1` - User removes a mapping from Settings only; `repo_remove` with its id returns the new list; refresh dependent drawer state - `inst-remove`
8. [ ] - `p1` - **RETURN** the core mapping list; never infer a cwd from an issue-key string inside the UI - `inst-return`

## 3. Processes / Business Logic (CDSL)

### Derive launch controls from the core view

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-handoff-controls`

**Input**: HandoffView, unsaved draft, in-flight action and core error

**Output**: Target label, launch explanation, footer order and enabled/default actions

**Steps**:
1. [ ] - `p1` - Use target for Open in Claude Code/Codex and launch path for the explanation; put the actual scheme only in help text and the open button description - `inst-label`
2. [ ] - `p1` - **IF** default_action is open: put Copy left and Open right/default; otherwise put Open left and Copy right/default - `inst-default`
3. [ ] - `p1` - Disable Open while prompt is absent/generating, repository is absent/missing, launch path is none or a mutation is pending; attach the specific reason as its help tag - `inst-open`
4. [ ] - `p1` - Keep Copy enabled for a ready prompt even without a repository or launch handler; serialize draft save before either action and suppress duplicate launches - `inst-copy`
5. [ ] - `p1` - Keep the launch line as the open button's accessible description and announce only returned copied/opened outcomes - `inst-accessible`
6. [ ] - `p1` - **RETURN** controls; never probe schemes, invoke subprocesses or use a direct clipboard API from this drawer - `inst-return`

## 4. States (CDSL)

### Handoff prompt and action

- [ ] `p1` - **ID**: `cpt-noter-state-ui-handoff-drawer`

**States**: LOADING, LOAD_FAILED, NOT_GENERATED, GENERATING, GENERATION_FAILED, READY, EDITED, SAVING, COPYING, OPENING, OPENED, OPEN_FAILED

**Initial State**: LOADING

**Transitions**:
1. [ ] - `p1` - **FROM** LOADING **TO** NOT_GENERATED, GENERATING, READY, GENERATION_FAILED **WHEN** handoff_get returns its state - `inst-load`
2. [ ] - `p1` - **FROM** NOT_GENERATED, READY, EDITED, GENERATION_FAILED **TO** GENERATING **WHEN** generation/regeneration is accepted - `inst-generate`
3. [ ] - `p1` - **FROM** GENERATING **TO** READY **WHEN** the current handoff completion event returns the generated prompt - `inst-ready`
4. [ ] - `p1` - **FROM** GENERATING **TO** GENERATION_FAILED **WHEN** core reports generation failed - `inst-failed`
5. [ ] - `p1` - **FROM** GENERATING **TO** READY, NOT_GENERATED **WHEN** cancel returns the previous state - `inst-cancel`
6. [ ] - `p1` - **FROM** READY, OPENED, OPEN_FAILED **TO** EDITED **WHEN** prompt text changes - `inst-edit`
7. [ ] - `p1` - **FROM** EDITED **TO** SAVING **WHEN** the draft is saved before an action - `inst-save`
8. [ ] - `p1` - **FROM** SAVING **TO** EDITED **WHEN** save succeeds or fails; retain the saved-edit badge or failed draft and error respectively - `inst-saved`
9. [ ] - `p1` - **FROM** READY, EDITED, OPEN_FAILED, OPENED **TO** COPYING, OPENING **WHEN** a valid action starts after any required save - `inst-action`
10. [ ] - `p1` - **FROM** COPYING **TO** READY, EDITED **WHEN** copy succeeds or fails; keep the prior prompt and show Copied only on success - `inst-copied`
11. [ ] - `p1` - **FROM** OPENING **TO** OPENED **WHEN** core confirms the launch and item mutation - `inst-opened`
12. [ ] - `p1` - **FROM** OPENING **TO** OPEN_FAILED **WHEN** launch fails; retain Copy Prompt - `inst-open-error`
13. [ ] - `p1` - **FROM** LOADING **TO** LOAD_FAILED **WHEN** handoff_get fails; show a retryable drawer error or Item not found - `inst-load-error`
14. [ ] - `p1` - **FROM** LOAD_FAILED **TO** LOADING **WHEN** Try Again requests the same existing engineering item - `inst-load-retry`

## 5. Definitions of Done

### Prompt lifecycle and delivery

- [ ] `p3` - **ID**: `cpt-noter-dod-ui-handoff-drawer`

The system **MUST** render HD-R1–HD-R7, generation/cancellation, revision-safe edits, generated/current diff, target choice and the core launch plan. Footer defaults follow the owner; a successful copy or open marks the item Handed off (and accepts a suggested item); copy never launches a tool; a failed launch marks nothing. Failure always leaves a path to Copy Prompt.

**Implements**:
- `cpt-noter-flow-ui-handoff-prepare`
- `cpt-noter-flow-ui-handoff-deliver`
- `cpt-noter-algo-ui-handoff-controls`
- `cpt-noter-state-ui-handoff-drawer`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: all seven handoff commands listed above
- Tests: unit default-action, launch-label, save-before-open, draft/conflict, cancel/late-event and composition cases; fake/real conformance prompt lifecycle, successful acceptance and no mutation on failure; real-core E2E `cpt-noter-seq-call-page-hand-off-item` (all paths); native `test_cpt_noter_seq_call_page_hand_off_item__automation_denied` and launch fallback; screenshots generating/failed/edited/diff, Codex, others, suggested, sensitive, no-handler and open-failed

### Repository mappings

- [ ] `p3` - **ID**: `cpt-noter-dod-ui-handoff-mappings`

The system **MUST** share the repository list between Settings and the drawer, prefill the source project, persist add/edit/remove through the core and refresh launch eligibility after each change. Folder cancellation and invalid keys never invent a mapping.

**Implements**:
- `cpt-noter-flow-ui-handoff-mapping`

**Constraints**: `cpt-noter-constraint-local-only-ui`

**Touches**:
- Commands: `repos_list`, `repo_upsert`, `repo_remove`, `handoff_get`
- Tests: unit prefill, duplicate-key errors, missing path and cross-window refresh; conformance create/edit/remove with folder cancellation; real-core E2E `cpt-noter-seq-call-page-hand-off-item` (No repository mapped) plus Settings mapping command coverage; native folder-panel test; screenshots empty table, missing folder and Add Mapping sheet

**Completion gate.** Write failing tests first; unit and changed-line coverage meet 80% per side. Conformance runs fake and real; only successful frozen commands and named real-core stories count toward 60%. Native story ids use underscores. Screenshots meet 98%; due performance coverage meets 60% and scenarios stay within 10% of base instructions; trace never falls. `just gate-fast` stays green; `just gate` passes.

## 6. Acceptance Criteria

- [ ] Draft edits persist before launch/copy, remain separate from item text and survive conflicts for explicit retry
- [ ] The current target, repository, launch line and default button agree before every action
- [ ] Others' items default to Copy; suggestions accept only after a successful copy/open
- [ ] Automation denial never marks Handed off; a successful launch records target, time and cwd
- [ ] Cancellation stops generation; a stale event cannot replace the restored prompt
- [ ] Mapping changes persist and revalidate the drawer; unavailable prompt versions or repositories are never fabricated

## 7. Additional Context

**Prototype reuse.** Rewrite `inspector('handoff')` as HandoffDrawer and `C.promptEditor` as PromptEditor; reuse the outputs feature's VersionSwitcher and DiffView. Rewrite dlg-mapping and Settings Repositories into the existing dialog/settings hosts. Port `.hd-*`, `.pc-prompt*`, `.dlg-*` and repository table styles; keep component/variant/state/region selectors and shared tokens/icons. The drawer docks at Wide, overlays at Medium/Narrow and returns focus to its opener. The prompt uses monospace 12/18, soft wrap and plain Markdown, no spelling correction. Tab leaves the editor, ⌘F searches it and ⌘Return invokes the default outside composition. Launch text wraps to three lines; footer buttons stack before truncating with German +30%. Statuses are polite; Reduce motion removes the 250-ms slide.

**States coverage.** Prototype call-page fixtures handoff-generating, handoff-failed, handoff-others, handoff-no-mapping, handoff-no-handler, handoff-open-failed and handoff-sensitive cover drawer variants. Ready, edited, showing changes, copied, opened, Codex and suggested are interactions. Settings covers empty mapping list, missing folder and mapping edits; core errors retain form drafts.

**DESIGN versus prototype.** The prototype changes target/repository locally and copies generated v2 even after editing; production copies/opens the persisted current prompt through the core. Its opened state always says iTerm; production uses returned path_used. The prototype's scheme help text says codex://open while the frozen LaunchPath documents codex://new: use the actual core LaunchPlan, without inventing or hardcoding a URL. PromptEditor find and keyboard shortcuts need production wiring. Historical prompt bodies in the prototype are sample generated strings.

**Contract limits.** HandoffView has version metadata, current/generated text, but no command to fetch older prompt bodies. The full version menu can list metadata, while historical-body inspection needs owner contract support; do not misuse output_version_get, which requires a SummaryId. HandoffTargetArgs can change target but carries no repository id, and handoff_open takes only item id: selecting an arbitrary existing mapping in the prototype cannot persist without owner contract work. RepoUpsertArgs with null local_path opens the picker as part of saving; it has no separate Choose/preview response, so the prototype's staged Choose then Add interaction also needs resolution. The fake launches without fully checking prompt readiness and does not write a physical clipboard, preserve historical bodies or simulate real Automation: native/real-core tests must prove those paths. `handoff_get` errors need a retryable drawer state even though LOADING's detailed error presentation is not drawn in the prototype. No contract or generated file is changed by this spec.

**Data.** Core-owned `cpt-noter-dbtable-prompt-versions`; mapping and handoff records are read through the core only. Logs contain ids and error codes, never prompts, quoted transcript text or secrets. Credential storage, cloud calls, process launching, migrations and deployment are not applicable to the React feature; the core owns those boundaries.
