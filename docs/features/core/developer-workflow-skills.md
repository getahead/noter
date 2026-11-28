---
title: "Feature: Developer workflow skills"
description: "Scope macOS and Ponytail skill guidance to Noter code generation and review in Constructor Studio."
status: PROPOSED
version: "0.1"
date: "2026-11-27"
milestone: M3
lane: owner
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Developer workflow skills

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Generate or review a scoped change](#generate-or-review-a-scoped-change)
  - [Self-review a pull request](#self-review-a-pull-request)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Resolve applicable skills before launch](#resolve-applicable-skills-before-launch)
- [4. States (CDSL)](#4-states-cdsl)
  - [Guidance readiness](#guidance-readiness)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Verify generation and review guidance](#verify-generation-and-review-guidance)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p2` - **ID**: `cpt-noter-featstatus-developer-workflow-skills`

- [ ] `p2` - `cpt-noter-feature-developer-workflow-skills`

## 1. Feature Context

### 1.1 Overview

Noter’s Constructor Studio workflows use the development and review guidance that applies to the changed code. The workflow controller resolves skills for the current host and includes the applicable guidance in inline and delegated work.

### 1.2 Purpose

Keep Mac-facing behavior consistent with macOS conventions and use the smallest complete implementation. Review checks those same expectations and preserves the delivering agent’s local Ponytail review and Noter’s quality gates.

**Requirements**: PRD › Developer loop and ADR-0003 › Decision Outcome.

**Scope**: Code generation through `cf-coding-gen` and `cf-sdlc-implement`, standalone semantic code review through `cf-sdlc-code-review`, and code review of a pull request through `cf-sdlc-pr-review`. This is repository tooling. App APIs, product behavior, persisted data, IPC, CI configuration and quality thresholds are outside its scope.

### 1.3 Actors

| Actor | Role in Feature |
|---|---|
| Developer | Starts code generation or review for a scoped change and resolves missing prerequisites. |
| Workflow controller | Resolves local skills and assembles the scoped instructions before starting work. |
| Delivering agent | Reviews the fresh PR diff locally and incorporates the Ponytail result into the Constructor Studio report. |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md#232-developer-workflow-skills---medium), entry `cpt-noter-feature-developer-workflow-skills`.
- **Requirements**: [PRD.md](../../PRD.md), Developer loop.
- **Design and quality policy**: [DESIGN-core.md](../../DESIGN-core.md), Quality bars, and [ADR-0003 › Decision Outcome](../../ADR/0003-harness-and-quality-gates.md#decision-outcome).
- **Delivery procedure**: [HARNESS.md](../../HARNESS.md#the-agent-loop), The agent loop.
- **Dependencies**: The pinned Constructor Studio runtime and local skill sources for each supported host. There are no upstream application FEATURE dependencies.

## 2. Actor Flows (CDSL)

### Generate or review a scoped change

- [ ] `p2` - **ID**: `cpt-noter-flow-developer-workflow-skills-scoped-work`

**Actor**: Developer.

**Success Scenarios**:
- A Swift or Mac-facing UI change receives the applicable macOS guidance and the Ponytail guidance for its workflow.
- A mixed change receives macOS guidance on its relevant surfaces. A platform-neutral change receives the relevant Ponytail guidance.

**Error Scenarios**:
- A required skill is missing or incompatible. The workflow identifies the host and skill before launching affected work.
- The FEATURE route cannot preserve its existing traceability, deterministic gates and semantic review. The workflow reports the exact blocker.

**Steps**:
1. [ ] - `p2` - The developer requests code generation or review and supplies its approved scope - `inst-request-scoped-work`
2. [ ] - `p2` - Resolve applicable guidance using `cpt-noter-algo-developer-workflow-skills-resolve` and return a prerequisite diagnostic when resolution fails - `inst-resolve-guidance`
3. [ ] - `p2` - Pass the same applicable guidance to inline or delegated work before it starts - `inst-provide-guidance`
4. [ ] - `p2` - On the FEATURE route, retain the governing FEATURE, CODE checklist, traceability, deterministic gates and semantic review - `inst-preserve-feature-handoff`

### Self-review a pull request

- [ ] `p2` - **ID**: `cpt-noter-flow-developer-workflow-skills-pr-review`

**Actor**: Delivering agent.

**Success Scenarios**:
- The delivering agent runs the semantic review and Ponytail review locally against the same fresh PR diff, applies relevant Mac guidance, and records a single verdict.
- A Ponytail **Must fix** finding appears as a Minimum finding and the verdict is `REQUEST CHANGES`.

**Error Scenarios**:
- The diff changes or required guidance is unavailable. The earlier result cannot establish review coverage for the current change.

**Steps**:
1. [ ] - `p2` - Obtain the fresh diff through `cf-sdlc-pr-review` and bind the review to it - `inst-bind-fresh-diff`
2. [ ] - `p2` - Resolve applicable guidance and run `ponytail-review` locally in the delivering agent’s session - `inst-run-local-review`
3. [ ] - `p2` - Merge and deduplicate findings, classify Ponytail **Must fix** as Minimum, and report `REQUEST CHANGES` when a Minimum finding exists - `inst-set-verdict`

## 3. Processes / Business Logic (CDSL)

### Resolve applicable skills before launch

- [ ] `p2` - **ID**: `cpt-noter-algo-developer-workflow-skills-resolve`

**Input**: Workflow kind, approved change scope, affected behaviors and current host’s local skill inventory.

**Output**: Applicable guidance for a self-contained controller prompt or a host-specific prerequisite diagnostic.

**Steps**:
1. [ ] - `p2` - Identify Mac-facing interface behavior, native Swift or macOS architecture, and native system integration in the approved scope - `inst-scope-macos-behavior`
2. [ ] - `p2` - Select `macos-design-guidelines` for Mac-facing interface behavior including relevant desktop webview behavior, `macos-development` for Swift and macOS architecture, and `macos-patterns` for native system integration - `inst-select-macos-guidance`
3. [ ] - `p2` - Select `ponytail` for authoring or `ponytail-review` for review. Preserve validation, error handling, security and accessibility - `inst-select-ponytail-guidance`
4. [ ] - `p2` - Resolve the selected skills by portable identifiers on the current host. Verify the project’s Claude Code pin against the installed version and verify Codex availability independently - `inst-resolve-host-skills`
5. [ ] - `p2` - **IF** a required skill fails to resolve or is incompatible, **RETURN** a diagnostic naming the host and skill before any affected inline or delegated launch - `inst-stop-unavailable-skill`
6. [ ] - `p2` - Include the applicable criteria in the controller’s synthesized prompt. Limit macOS criteria to relevant changed behavior - `inst-synthesize-instructions`

## 4. States (CDSL)

### Guidance readiness

- [ ] `p2` - **ID**: `cpt-noter-state-developer-workflow-skills-readiness`

**States**: Resolving, ready, blocked. The decision belongs to the current workflow invocation.

**Initial State**: Resolving.

**Transitions**:
1. [ ] - `p2` - **FROM** Resolving **TO** Ready **WHEN** every applicable required skill is resolved and its guidance is included - `inst-guidance-ready`
2. [ ] - `p2` - **FROM** Resolving **TO** Blocked **WHEN** a required skill is unavailable or incompatible - `inst-guidance-blocked`
3. [ ] - `p2` - **FROM** Blocked **TO** Resolving **WHEN** the developer addresses the diagnostic and retries the invocation - `inst-retry-resolution`

## 5. Definitions of Done

### Verify generation and review guidance

- [ ] `p2` - **ID**: `cpt-noter-dod-developer-workflow-skills-verify`

The workflows **MUST** apply the applicable criteria, report unavailable required guidance before affected work starts, and preserve Noter’s FEATURE validation and local PR review policy.

**Implements**:
- `cpt-noter-flow-developer-workflow-skills-scoped-work`
- `cpt-noter-flow-developer-workflow-skills-pr-review`
- `cpt-noter-algo-developer-workflow-skills-resolve`
- `cpt-noter-state-developer-workflow-skills-readiness`

**Tests**:
- **Unit**: Cover route and scope selection for native Mac, platform-neutral and mixed changes. Verify that a missing or incompatible required skill yields a host-specific diagnostic.
- **Conformance**: Start with a failing check. Retain the exact pre-change inputs, replay commands and expected failure. Verify that inline and delegated prompts carry equivalent scoped criteria and that neither affected path launches when a required skill is unavailable. Check the FEATURE handoff and record the scoped `cfs validate` result independently of the full gate.
- **End to end**: Run write-capable workflow checks in disposable fixtures and verify that the active worktree is identical before and after. Seed a simplification defect in a local PR fixture and verify that the actual Ponytail review produces a Minimum finding and `REQUEST CHANGES` for that same diff. Product UI story IDs do not apply because this feature delivers no DESIGN.md product story.

Record passing `just gate-fast` checkpoints before and after edits and keep the local review independent of CI credentials. Completion requires that `just gate` passes.

## 6. Acceptance Criteria

- [ ] Scoped generation and semantic review include the applicable macOS and Ponytail guidance, with equivalent guidance for inline and delegated work.
- [ ] A platform-neutral change activates no macOS guidance. A mixed change applies it only to its relevant behavior.
- [ ] Missing or incompatible required skills produce a host-specific diagnostic and zero affected launches.
- [ ] The FEATURE implementation route preserves the governing spec, traceability, deterministic gates and semantic review.
- [ ] The delivering agent’s review uses the fresh PR diff and a Ponytail **Must fix** produces a Minimum finding and `REQUEST CHANGES`.
- [ ] Replayed baseline checks, disposable fixture evidence, scoped validation and both Noter gates verify the change.
