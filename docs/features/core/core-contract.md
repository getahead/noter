---
title: "Feature: Contract crate and conformance"
description: "noter-protocol as the real core starts to answer it: CoreApi and CommandCtx fit the IPC host and the harness, the contract tests cover what the core relies on, and one conformance suite runs against the fake and the real core."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M0
lane: contract
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Contract crate and conformance

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Change a contract surface](#change-a-contract-surface)
  - [Run conformance against a core](#run-conformance-against-a-core)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Contract tests](#contract-tests)
  - [Version rule](#version-rule)
- [4. States (CDSL)](#4-states-cdsl)
  - [Contract surface stability](#contract-surface-stability)
- [5. Definitions of Done](#5-definitions-of-done)
  - [CoreApi fits the real core](#coreapi-fits-the-real-core)
  - [Contract tests complete](#contract-tests-complete)
  - [One conformance suite, two cores](#one-conformance-suite-two-cores)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-noter-featstatus-core-contract`

- [ ] `p1` - `cpt-noter-feature-core-contract`

## 1. Feature Context

### 1.1 Overview

`crates/noter-protocol` already holds the four contracts (172 commands, 20 events, 66 error codes, the engine protocol, the noter-mcp tools, the skill schemas and the fixture world), and the fake core answers every command. This feature is the M0 work on it: make the declarations the real core consumes (`CoreApi`, `CommandCtx`, `Caller`, `Sink`) fit the IPC host and `noter-core-harness`, extend the contract tests to everything the core relies on, and make the conformance suite run the same assertions against the fake and against the real core.

### 1.2 Purpose

From M0 the UI stops trusting only the fake. A difference between the fake and the real core must show up as a failing conformance test and be fixed in the contract first, not discovered on a screen.

**Requirements**: owner request for UI-first development (17 Oct 2026); PRD › Repository layout › Engine protocol.

**Principles**: `cpt-noter-principle-core-contract-first`

**Delivers**: no command behaviour of its own. It delivers the contract every other feature implements, the contract tests, and the conformance suite in its two modes (`NOTER_CORE=fake`, `NOTER_CORE=stdio`).

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Contract-lane agent | Changes the Rust types and the registry, regenerates, updates the fake and the conformance suite |
| Core and UI owners | Review every contract pull request (one core and one UI review) |
| CI | Runs the export check, the contract tests and the conformance suite in both modes |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-contract`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md) 3.3 and 4.1: `cpt-noter-component-core-protocol`, `cpt-noter-interface-core-ipc`, `cpt-noter-interface-engine-stdio`, `cpt-noter-interface-skill-outputs`
- **ADRs**: `cpt-noter-adr-0001-contract-source-of-truth`, `cpt-noter-adr-0002-ipc-conventions`
- **Dependencies**: None

## 2. Actor Flows (CDSL)

### Change a contract surface

- [ ] `p1` - **ID**: `cpt-noter-flow-core-contract-change-surface`

**Actor**: Contract-lane agent

**Success Scenarios**:
- A new optional field on a frozen type: the minor version goes up, the bindings and manifest are regenerated, the fake fills the field, both reviews pass.
- A draft surface changes shape before its gate: minor version, the other side is notified in the pull request.

**Error Scenarios**:
- A generated file was edited by hand: the lane guard blocks the edit.
- A frozen surface changed in a non-additive way without a major version: the contract tests fail.
- A new command is not placed in `harness/milestones.toml`: the harness self-tests fail.

**Steps**:
1. [ ] - `p1` - Agent changes the Rust types and the registry entry in `noter-protocol` - `inst-edit-types`
2. [ ] - `p1` - Agent runs `just contract-regen`; `bindings.ts`, `contracts/*.json` and the fixtures are regenerated - `inst-regen`
3. [ ] - `p1` - Agent applies `cpt-noter-algo-core-contract-version-rule` and bumps `CONTRACT_VERSION` (or `ENGINE_PROTOCOL_VERSION`) - `inst-bump`
4. [ ] - `p1` - **IF** a frozen surface changed - `inst-if-frozen`
   1. [ ] - `p1` - Agent updates the fake handlers and the conformance assertions in the same pull request - `inst-update-fake`
5. [ ] - `p1` - Agent places every new command in `harness/milestones.toml` - `inst-place-milestone`
6. [ ] - `p1` - CI runs `just gate`; the export check, `cpt-noter-algo-core-contract-tests` and the conformance suite in both modes must pass - `inst-ci`
7. [ ] - `p1` - **RETURN** a pull request with one core and one UI approval - `inst-return-pr`

### Run conformance against a core

- [ ] `p1` - **ID**: `cpt-noter-flow-core-contract-conformance`

**Actor**: CI

**Success Scenarios**:
- The suite passes with `NOTER_CORE=fake`, then with `NOTER_CORE=stdio` against `noter-core-harness`, for every command the real core answers.

**Error Scenarios**:
- The real core and the fake differ on window scope, error typing, snapshot-then-stream or revisions: the stdio run fails and names the command; the fix starts in `noter-protocol`.
- A command the real core does not answer yet returns `not_implemented`: it is listed, not failed, until its milestone is current.

**Steps**:
1. [ ] - `p1` - CI runs `pnpm test:conformance` with `NOTER_CORE=fake` - `inst-run-fake`
2. [ ] - `p1` - CI starts `noter-core-harness --fixture world` and runs the same suite with `NOTER_CORE=stdio` - `inst-run-stdio`
3. [ ] - `p1` - **FOR EACH** assertion group (window scope, typed errors, snapshot then stream with a Channel message before the snapshot resolves, revisions and `conflict`, whole-state versions) - `inst-for-groups`
   1. [ ] - `p1` - Run the group against the core under test with the same fixtures - `inst-run-group`
4. [ ] - `p1` - **IF** a command answers `not_implemented` and its milestone is later than `harness.toml [milestone].current` - `inst-if-later`
   1. [ ] - `p1` - Record it as pending in the run summary - `inst-record-pending`
5. [ ] - `p1` - **ELSE IF** a command answers `not_implemented` or differs from the fake - `inst-if-differs`
   1. [ ] - `p1` - Fail the run naming the command and the assertion - `inst-fail-run`
6. [ ] - `p1` - **RETURN** the pass or fail result and the count of answered commands - `inst-return-conformance`

## 3. Processes / Business Logic (CDSL)

### Contract tests

- [ ] `p1` - **ID**: `cpt-noter-algo-core-contract-tests`

**Input**: The registry (`COMMANDS`, `EVENTS`), the argument and result types, `ErrorCode`, the fixture world.

**Output**: Pass, or the first broken rule with the name it applies to.

**Steps**:
1. [ ] - `p1` - Check command, event and Channel names are unique and every group has at least one command - `inst-check-names`
2. [ ] - `p1` - Check stability per name: the Copilot, Agents and Performance groups, `storage_move` and `copilot:status` are draft; everything else is frozen - `inst-check-stability`
3. [ ] - `p1` - Check window scopes, including that the call window may not delete - `inst-check-scopes`
4. [ ] - `p1` - Check every `Option` field of an argument type has `#[serde(default)]` - `inst-check-serde-default`
5. [ ] - `p1` - Check `ErrorCode` is the closed list of DESIGN-core 3.3 and `DEFAULT_RETRYABLE` matches it - `inst-check-errors`
6. [ ] - `p1` - Check the fixture world and every schema in `contracts/` round-trip through the types - `inst-check-roundtrip`
7. [ ] - `p1` - Check `CoreApi` has one method per command with the command's argument, result and Channel types - `inst-check-coreapi`
8. [ ] - `p1` - **RETURN** pass or the first failure - `inst-return-tests`

### Version rule

- [ ] `p2` - **ID**: `cpt-noter-algo-core-contract-version-rule`

**Input**: The diff of a contract change and the stability of each changed surface.

**Output**: The version bump to apply.

**Steps**:
1. [x] - `p1` - **IF** only draft surfaces changed - `inst-if-draft`
   1. [x] - `p1` - **RETURN** minor - `inst-return-draft-minor`
2. [ ] - `p1` - **IF** every frozen change is additive (new optional field, new command, new enum variant the UI can ignore) - `inst-if-additive`. Enforced so far at the manifest level only (commands, events, windows, error codes); a field change inside an argument or result type is not enforced yet and rests on `noter-contract-export --check` and the two reviews. Follow-up: diff the exported declarations per frozen surface
   1. [ ] - `p1` - **RETURN** minor - `inst-return-additive-minor`
3. [x] - `p1` - **RETURN** major, with sign-off from both sides - `inst-return-major`

## 4. States (CDSL)

### Contract surface stability

- [ ] `p2` - **ID**: `cpt-noter-state-core-contract-stability`

**States**: draft, frozen

**Initial State**: draft for Copilot, Agents, Performance, `storage_move` and `copilot:status`; frozen for everything else

**Transitions**:
1. [x] - `p1` - **FROM** draft **TO** frozen **WHEN** the surface's milestone gate passes (Copilot and Agents at M4, Performance at M5) - `inst-st-freeze`
2. [ ] - `p1` - **FROM** frozen **TO** frozen **WHEN** an additive change lands with a minor version - `inst-st-additive`
3. [x] - `p1` - **FROM** draft **TO** draft **WHEN** any change lands with a minor version - `inst-st-draft-change`

## 5. Definitions of Done

### CoreApi fits the real core

- [ ] `p1` - **ID**: `cpt-noter-dod-core-contract-coreapi`

The system **MUST** declare `CoreApi`, `CommandCtx` (with `Caller::Window { label }` and `Caller::Native { surface }`) and `Sink` so that `noter-core` implements them on a concrete type and both `apps/desktop/src-tauri` and `noter-core-harness` call them without adapters of their own beyond transport.

**Implements**:
- `cpt-noter-algo-core-contract-tests`

**Constraints**: `cpt-noter-constraint-core-contract-tooling`

**Touches**:
- API: every command of `contracts/ipc.manifest.json`
- Entities: `CoreApi`, `CommandCtx`, `Caller`, `Sink`

### Contract tests complete

- [ ] `p1` - **ID**: `cpt-noter-dod-core-contract-tests`

The system **MUST** fail `cargo test -p noter-protocol` on every rule of the contract tests above, and `noter-contract-export --check` on any generated file that differs from the types.

**Implements**:
- `cpt-noter-algo-core-contract-tests`
- `cpt-noter-algo-core-contract-version-rule`
- `cpt-noter-flow-core-contract-change-surface`
- `cpt-noter-state-core-contract-stability`

**Constraints**: `cpt-noter-constraint-core-contract-tooling`

**Touches**:
- API: `contracts/ipc.manifest.json`, `contracts/engine.schema.json`, `contracts/mcp-tools.schema.json`, `contracts/skills/*.schema.json`, `contracts/egress-hosts.json`

### One conformance suite, two cores

- [ ] `p1` - **ID**: `cpt-noter-dod-core-contract-conformance`

The system **MUST** run the conformance suite with `NOTER_CORE=fake` and with `NOTER_CORE=stdio` against `noter-core-harness`, with the same fixtures and assertions, and fail on any difference for a command whose milestone is current.

**Implements**:
- `cpt-noter-flow-core-contract-conformance`

**Touches**:
- API: every command delivered up to the current milestone

## 6. Acceptance Criteria

- [ ] `just contract` passes and fails on a hand-edited generated file.
- [ ] The contract tests fail when a draft surface is marked frozen, an optional argument field lacks `#[serde(default)]`, or an error code is missing from `DEFAULT_RETRYABLE` handling.
- [ ] The conformance suite passes against the fake and, for every M0 command, against the real core through `noter-core-harness`.
- [ ] The run summary lists the commands the real core does not answer yet, by milestone.
- [ ] `just gate` passes.
