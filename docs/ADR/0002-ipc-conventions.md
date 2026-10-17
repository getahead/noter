---
status: accepted
date: 2026-10-17
description: "The IPC rules every command, Channel and event follows: wanted state with revisions, snapshot then stream with seq, whole-state events, one typed error."
decision-makers: Mikhail Petrov (product owner)
status-history:
  - "2026-10-17: PROPOSED -> ACCEPTED (owner approved the harness proposal, ADR-0003)"
---

# IPC conventions: intent commands with revisions, Channels with sequence numbers, whole-state events, typed errors

**ID**: `cpt-noter-adr-0002-ipc-conventions`

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Intent commands, Channels with seq, whole-state events, typed errors](#intent-commands-channels-with-seq-whole-state-events-typed-errors)
  - [A reactive store synchronised by patches](#a-reactive-store-synchronised-by-patches)
  - [Events for everything](#events-for-everything)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

## Context and Problem Statement

DESIGN.md requires that the UI holds no state the core does not have, that a window can reload or crash and come back exactly as it was, that commands send wanted state and never toggles, and that every error maps to a named state. Several windows show the same records, background jobs change records while the user edits them, and live streams run at up to ten messages a second. Which conventions make all of this hold for every command?

## Decision Drivers

* Reload and crash recovery without losing or doubling a message (PM-46).
* Two writers on the same record (a job and the user, or two windows) must not silently overwrite each other.
* A missed event must not leave a stale banner.
* Every failure must be a closed, typed code the UI maps once.
* Tauri guidance: events are not for high-rate streams; Channels are ordered and bound to one call.

## Considered Options

* Intent commands, Channels with seq, whole-state events, typed errors
* A reactive store synchronised by patches (JSON Patch over one event stream)
* Events for everything

## Decision Outcome

Chosen option: "Intent commands, Channels with seq, whole-state events, typed errors", because each DESIGN.md rule maps to one mechanism: snapshot with `last_seq` then a Channel for reload and replay; `rev` on every editable record and `conflict` for concurrent edits; whole-state events for app-level state; `entity:changed` with whole records for everything else; one `CoreError` with a closed `ErrorCode` list.

### Consequences

* Good, because the UI's store logic is uniform: replace records by id, append stream messages in `seq` order, resubscribe on a gap.
* Good, because "Item changed since" and **Undo** have exact mechanisms (`conflict`, `change_id`).
* Bad, because whole records on `entity:changed` cost more bytes than patches; acceptable for a local app at human edit rates.
* Bad, because every editable table carries `rev`, and every edit command carries it.

### Confirmation

Contract tests check names, scopes and the error list; the fake core enforces window scoping, `rev` conflicts and `seq` continuity and the smoke test asserts them; from M1 the same assertions run against the real core.

## Pros and Cons of the Options

### Intent commands, Channels with seq, whole-state events, typed errors

* Good, because it matches Tauri's transports to their intended use.
* Good, because each rule is testable in isolation.
* Neutral, because subscribing commands return a snapshot, so they are larger than a plain subscribe.

### A reactive store synchronised by patches

* Good, because one mechanism for all state.
* Bad, because a lost patch corrupts the client silently; recovery needs the same snapshot logic anyway.
* Bad, because patches leak the core's storage shape into the UI.

### Events for everything

* Good, because simplest to start.
* Bad, because events are broadcast and unordered relative to command results, and unsuitable for a 100 ms transcript stream.

## More Information

Details and the full error table are in DESIGN-core 3.3; the rules are encoded in `crates/noter-protocol/src/ipc/mod.rs` and `crates/noter-protocol/src/error.rs`.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN-core.md](../DESIGN-core.md), [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-noter-interface-core-ipc` — wire conventions
* `cpt-noter-principle-core-snapshot-stream` — snapshot, then stream
* `cpt-noter-principle-core-intent-commands` — wanted state, revisions, undo handles
* `cpt-noter-component-core-stream-hub` — implements Channels with seq
* `cpt-noter-component-core-changelog` — implements undo handles
