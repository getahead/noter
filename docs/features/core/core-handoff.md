---
title: "Feature: Handoff launcher and repositories"
description: "On-demand versioned prompts, repository mappings and native launch with pre-filled text and no automatic send."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M2
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Handoff launcher and repositories

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Generate, edit or cancel a prompt](#generate-edit-or-cancel-a-prompt)
  - [Choose target and maintain repository mappings](#choose-target-and-maintain-repository-mappings)
  - [Open or copy the reviewed prompt](#open-or-copy-the-reviewed-prompt)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Build and cache the prompt](#build-and-cache-the-prompt)
  - [Resolve and execute a launch plan](#resolve-and-execute-a-launch-plan)
- [4. States (CDSL)](#4-states-cdsl)
  - [Prompt generation](#prompt-generation)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Prompt versions and cancellation](#prompt-versions-and-cancellation)
  - [Repository and safe launch](#repository-and-safe-launch)
  - [Tests and gate](#tests-and-gate)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p3` - **ID**: `cpt-noter-featstatus-core-handoff`

- [ ] `p3` - `cpt-noter-feature-core-handoff`

## 1. Feature Context

### 1.1 Overview

`noter-handoff` generates and caches an engineering item's prompt on demand, retains generated versions and edits, resolves repository mappings and exposes the launch plan before opening anything. Opening or copying records the version used and updates the item through the logged item service. Improvement briefs remain M5; repository work itself runs only when the user proceeds in the target tool.

> **M2 decisions (Backend Teamlead, 1 Nov 2026).** `NativeOps` is a trait on `CoreDeps` (save panel, rich clipboard, launch, share test); the harness answers it scripted (a path under its data dir, a recorded clipboard, recorded launches, a fixed `ShareTestResult`), and the real implementations come with 2.21 native-services (TL-15). `handoff_open` and `handoff_copy` code against it from day one. Story tests are story-named files in `apps/desktop/tests/conformance/m2-stories-*.test.ts` that drive the real core over `StdioCore` with the scripted runtime, secret store, native ops and engine, and assert the core-visible steps (rows, events, state); the UI E2E takes over when the UI M2 lands (TL-18, D-26).

### 1.2 Purpose

An item becomes a prompt with its evidence, decisions, acceptance criteria and scope guardrails, ready in Claude Code or Codex in the intended repository. The user reviews it before anything is sent.

**Requirements**: PRD › Feature specification › 9. Handoff to Claude Code and Codex; PRD › LLM orchestration › Handoff prompts and improvement briefs.

**Principles**: No additional principle assigned in the decomposition; model calls use the shared egress gate and mutations use the shared writer.

**Delivers**:
- Frozen commands (M2): `handoff_get`, `handoff_generate`, `handoff_edit`, `handoff_set_target`, `handoff_open`, `handoff_copy`, `handoff_cancel`, `repos_list`, `repo_upsert`, `repo_remove`.
- Events: `entity:changed` for handoff and affected item records.
- DESIGN.md story (M2): `cpt-noter-seq-call-page-hand-off-item`.
- DESIGN-core sequence: `cpt-noter-seq-core-handoff`.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user (main window) | Generates, edits, changes target, opens or copies a prompt |
| Settings window | Reads, adds, edits and removes repository mappings |
| LLM router | Generates the fixed-schema prompt under privacy policy |
| Native launch and clipboard services | Resolve handlers, open a pre-filled prompt or copy Markdown |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-handoff`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-handoff`, `cpt-noter-seq-core-handoff`, `cpt-noter-dbtable-prompt-versions`, `cpt-noter-interface-skill-outputs`
- **Story**: [DESIGN.md](../../DESIGN.md), `cpt-noter-seq-call-page-hand-off-item`
- **Contract**: `model/handoff.rs`, `model/settings.rs`, `skills.rs`, `ipc/mod.rs` in `crates/noter-protocol/src`; `contracts/ipc.manifest.json`
- **Dependencies**: `cpt-noter-feature-core-items-today`, `cpt-noter-feature-core-llm-gate`, `cpt-noter-feature-core-native-services`

## 2. Actor Flows (CDSL)

### Generate, edit or cancel a prompt

- [ ] `p1` - **ID**: `cpt-noter-flow-core-handoff-prompt`

**Actor**: Primary user (main window)

**Success Scenarios**:
- Opening the drawer reads cached state and launch plan; generation returns immediately as generating and completes through an entity event.
- Editing saves a user version; forced regeneration retains earlier versions and edits; cancel restores the previous usable state.

**Error Scenarios**:
- Deleted item: `not_found`; stale edit revision: `conflict`; unavailable runtime or generation failure yields the typed failed prompt state and Try Again.

**Steps**:
1. [ ] - `p1` - API: `handoff_get { item_id }`; assemble item, prompt state, generated and edited bodies, version metadata, target, repo, default action and `LaunchPlan` - `inst-prompt-get`
2. [ ] - `p1` - API: `handoff_generate { item_id, regenerate }`; reuse a valid cached prompt unless forced, and coalesce an already active generation - `inst-prompt-cache`
3. [ ] - `p1` - For new work retain the previous state, allocate a generation identity and return `HandoffView` as generating before waiting for the model - `inst-prompt-start`
4. [ ] - `p1` - Run `cpt-noter-algo-core-handoff-build` asynchronously, then append the generated version and publish the complete ready view - `inst-prompt-complete`
5. [ ] - `p1` - API: `handoff_edit { item_id, rev, prompt_md }`; validate the current revision and Markdown, append a user-edit version with a logged change and preserve the generated body for the diff - `inst-prompt-edit`
6. [ ] - `p1` - API: `handoff_cancel { item_id }`; cancel the router request, invalidate that generation and restore the previous ready or not-generated state - `inst-prompt-cancel`
7. [ ] - `p1` - Discard cancelled, superseded or deleted-item completions; a failed attempt preserves earlier prompt versions - `inst-prompt-late`
8. [ ] - `p1` - **RETURN** complete `HandoffView` values; prompt edits never rewrite the item's own text - `inst-prompt-return`

### Choose target and maintain repository mappings

- [ ] `p1` - **ID**: `cpt-noter-flow-core-handoff-repositories`

**Actor**: Primary user (main or Settings window, within command scope)

**Success Scenarios**:
- The drawer adds a mapping with the project key prefilled, or Settings changes/removes one; switching the target recomputes its launch line.

**Error Scenarios**:
- No mapping: `repo_not_mapped` on open; missing mapped folder: `repo_path_missing`; closing the native folder panel: `cancelled`.

**Steps**:
1. [ ] - `p1` - API: `repos_list {}` returns mappings with `path_exists` derived from the filesystem - `inst-repo-list`
2. [ ] - `p1` - API: `repo_upsert { id, key, local_path, default_tool }`; when path is absent, show the core-owned open panel; cancellation changes nothing - `inst-repo-upsert`
3. [ ] - `p1` - Validate key and local directory, save the mapping through the settings/change-log writer and return `RepoList` - `inst-repo-save`
4. [ ] - `p1` - API: `repo_remove { id }` from Settings removes the mapping through the same write path - `inst-repo-remove`
5. [ ] - `p1` - API: `handoff_set_target { item_id, target }` stores the wanted target and recomputes launch availability without generating or opening a prompt - `inst-repo-target`
6. [ ] - `p1` - Resolve the item's project or component against its configured mapping; expose `unmapped_key` when no mapping fits and keep Copy available - `inst-repo-resolve`
7. [ ] - `p1` - **RETURN** current mappings or the updated handoff view; emit changed settings or entities after commit - `inst-repo-return`

### Open or copy the reviewed prompt

- [ ] `p1` - **ID**: `cpt-noter-flow-core-handoff-use`

**Actor**: Primary user (main window)

**Success Scenarios**:
- Open uses the advertised native launch plan and pre-fills the full saved prompt by a short read-file instruction; Copy works even without a repository or Automation.
- Default action is Open for the user's own items and Copy Prompt for other owners.

**Error Scenarios**:
- Prompt missing or writing: `prompt_not_ready`; failed mapping, missing path, no handler or denied Automation returns the matching typed error and keeps Copy usable.

**Steps**:
1. [ ] - `p1` - API: `handoff_open { item_id }` or `handoff_copy { item_id }`; require a usable prompt and capture the exact current version and edited flag - `inst-use-request`
2. [ ] - `p1` - For open, revalidate the repository and write the full selected prompt to `handoffs/<item>.md` before any launch - `inst-use-file`
3. [ ] - `p1` - Execute `cpt-noter-algo-core-handoff-launch`; **IF** launch fails, return its error without recording a successful handoff - `inst-use-open`
4. [ ] - `p1` - For copy, write the selected prompt as Markdown through the native clipboard service; only a successful write counts as used - `inst-use-copy`
5. [ ] - `p1` - Through the item writer record target, timestamp, directory where applicable, `prompt_versions.id` used and whether edited; set handed_off and accept a suggested item atomically with its change - `inst-use-record`
6. [ ] - `p1` - Publish changed handoff and item entities; do not send a Return key, execute repository commands or collect evidence - `inst-use-publish`
7. [ ] - `p1` - **RETURN** `HandoffOpenResult` with actual `path_used` and file or `HandoffCopyResult` with character count and item - `inst-use-return`

The story's other-owner path says the item stays open after Copy; the frozen `HandoffCopyResult` and DESIGN-core 3.1/3.2 record it as handed_off and accepted. This spec follows that contract, keeps the owner unchanged and treats handed_off as awaiting completion. It does not silently mark it done.

## 3. Processes / Business Logic (CDSL)

### Build and cache the prompt

- [ ] `p1` - **ID**: `cpt-noter-algo-core-handoff-build`

**Input**: Item, evidence spans, related decisions/constraints, repository mapping, target and current privacy context.

**Output**: Validated `HandoffPromptOutput`, Markdown and a new prompt version, or typed failure.

**Steps**:
1. [ ] - `p1` - Resolve current evidence spans to transcript words with speakers and times, linked issue keys and supported topic decisions - `inst-build-evidence`
2. [ ] - `p1` - Build the handoff skill packet with goal, context, constraints, acceptance, links, repo and guardrails; include only actually available knowledge, with indexed documents deferred to M3 - `inst-build-packet`
3. [ ] - `p1` - Route to the handoff target's available model or local fallback; sensitive work remains local - `inst-build-route`
4. [ ] - `p1` - Validate against the existing handoff schema and permitted references; render Markdown with a closing instruction to ask before touching work outside the scope - `inst-build-render`
5. [ ] - `p1` - On the writer, verify generation identity and item existence, append `prompt_versions` and the logged change, preserving the user's earlier edit and generated base - `inst-build-store`
6. [ ] - `p1` - Keep a current user edit as the usable prompt when regeneration completes; expose the new generated candidate separately for comparison rather than replacing the edit - `inst-build-keep-edit`
7. [ ] - `p1` - **RETURN** complete ready view with increasing version metadata; do not generate prompts for every item at call end - `inst-build-return`

### Resolve and execute a launch plan

- [ ] `p1` - **ID**: `cpt-noter-algo-core-handoff-launch`

**Input**: Target tool, existing local repository path, saved prompt file and current native handler/Automation facts.

**Output**: Actual `LaunchPath` used or the existing typed launch error.

**Steps**:
1. [ ] - `p1` - Ask Launch Services which handlers exist; for Claude prefer `claude-cli://open`, then `claude://code/new`; for Codex prefer `codex://new` - `inst-launch-handlers`
2. [ ] - `p1` - Put only the encoded cwd and short instruction to read the saved file in the link; keep Claude's query under 5000 characters regardless of prompt length - `inst-launch-short`
3. [ ] - `p1` - **IF** the supported handler opens, **RETURN** its path without submitting the prompt - `inst-launch-link`
4. [ ] - `p1` - Otherwise choose the available Terminal or iTerm fallback and report whether Automation is needed or already denied in `LaunchPlan` - `inst-launch-terminal`
5. [ ] - `p1` - **IF** Automation is denied, **RETURN** `automation_denied`; if no path can open, **RETURN** `no_link_handler` - `inst-launch-refused`
6. [ ] - `p1` - Launch the tool with the intended cwd and short read-file instruction using native argument-safe transport; prompt and path text cannot become shell syntax - `inst-launch-safe`
7. [ ] - `p1` - **RETURN** terminal path used, pre-filled and never sent; no command is run in the repository by Noter - `inst-launch-return`

## 4. States (CDSL)

### Prompt generation

- [ ] `p1` - **ID**: `cpt-noter-state-core-handoff-prompt`

**States**: not_generated, generating, ready, failed

**Initial State**: not_generated

**Transitions**:
1. [ ] - `p1` - **FROM** not_generated **TO** generating **WHEN** generation is requested - `inst-st-generate`
2. [ ] - `p1` - **FROM** generating **TO** ready **WHEN** validated current-generation output commits - `inst-st-ready`
3. [ ] - `p1` - **FROM** generating **TO** failed **WHEN** the current request fails; previous usable versions remain retained - `inst-st-failed`
4. [ ] - `p1` - **FROM** failed **TO** generating **WHEN** Try Again requests a new generation - `inst-st-retry`
5. [ ] - `p1` - **FROM** ready **TO** generating **WHEN** forced regeneration starts with the previous state saved - `inst-st-regenerate`
6. [ ] - `p1` - **FROM** generating **TO** ready **WHEN** cancellation restores a previous ready prompt - `inst-st-cancel-ready`
7. [ ] - `p1` - **FROM** generating **TO** not_generated **WHEN** cancellation restores an initial not-generated state - `inst-st-cancel-empty`
8. [ ] - `p1` - **FROM** generating **TO** failed **WHEN** cancellation restores a previous failed state - `inst-st-cancel-failed`
9. [ ] - `p1` - **FROM** ready **TO** ready **WHEN** a revision-guarded edit, copy, open or target change succeeds - `inst-st-use`

Prompt versions and edits persist; in-flight generation identity is invalidated on cancellation or restart. Late results cannot revive a cancelled generation. Item lifecycle remains owned by items-today.

## 5. Definitions of Done

### Prompt versions and cancellation

- [ ] `p1` - **ID**: `cpt-noter-dod-core-handoff-prompts`

The system **MUST** generate only on demand through the router, return generating immediately, cache successful prompts and keep all generated and edited versions. Edits require current revisions, cancellation restores previous state and late results are discarded. The prompt contains only supported evidence and fixed-schema fields with scope guardrails.

**Implements**:
- `cpt-noter-flow-core-handoff-prompt`
- `cpt-noter-algo-core-handoff-build`
- `cpt-noter-state-core-handoff-prompt`

**Touches**:
- API: `handoff_get`, `handoff_generate`, `handoff_edit`, `handoff_cancel`, `entity:changed`
- DB: `prompt_versions`, `changes`
- Entities: `HandoffView`, `HandoffPromptOutput`

### Repository and safe launch

- [ ] `p1` - **ID**: `cpt-noter-dod-core-handoff-launch`

The system **MUST** resolve mappings, expose missing paths and the actual launch plan, honor target switches, save the full prompt to a file and try the designed link/terminal order with a pre-filled prompt. Copy remains available when opening cannot work. Successful use accepts suggestions and logs the exact prompt version and edited flag for the later Handoff metric; failure must not claim successful use.

**Implements**:
- `cpt-noter-flow-core-handoff-repositories`
- `cpt-noter-flow-core-handoff-use`
- `cpt-noter-algo-core-handoff-launch`

**Touches**:
- API: `handoff_set_target`, `handoff_open`, `handoff_copy`, `repos_list`, `repo_upsert`, `repo_remove`
- DB: `items`, `prompt_versions`, settings repository mappings, `changes`
- Entities: `LaunchPlan`, `HandoffOpenResult`, `HandoffCopyResult`, `RepoMapping`

### Tests and gate

- [ ] `p1` - **ID**: `cpt-noter-dod-core-handoff-tests`

The system **MUST** pass unit tests for caching, cancel/result races, retained edits, missing repos, handler ordering, query length and safe transport of Unicode, quotes and shell-like strings; conformance for all ten commands; handoff skill schema/citation/rubric evaluations; and real-core E2E for the handoff story, with native launch and clipboard assertions on macOS. `just gate` passes.

**Implements**:
- `cpt-noter-flow-core-handoff-prompt`
- `cpt-noter-flow-core-handoff-use`
- `cpt-noter-algo-core-handoff-launch`

**Touches**:
- Entities: handoff skill evaluations, native launch test evidence

## 6. Acceptance Criteria

- [ ] Real-core E2E `cpt-noter-seq-call-page-hand-off-item` generates, edits, compares, switches target, opens and copies; prompt text is pre-filled and no message is sent.
- [ ] Both tools follow their link/fallback order; missing mapping disables open without disabling copy, and a newly added mapping enables it.
- [ ] Automation denial returns the typed error without claiming a successful handoff; Copy succeeds and records the used version and acceptance.
- [ ] Forced regeneration keeps user edits; cancelled or superseded work cannot publish ready or overwrite the current prompt.
- [ ] All ten commands succeed against the real core; fake/real conformance verifies command scopes, revisions, async generation events and errors.
- [ ] Native tests prove paths and prompt text cannot execute shell syntax, and long prompts use a short file instruction below the query cap.
- [ ] `just gate` passes.
