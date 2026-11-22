---
status: accepted
date: 2026-11-21
description: "Releases are ad-hoc signed, so Noter drops the App Group and the engine's App Sandbox: app, core and engine share ~/Library/Application Support/Noter, and the engine stays offline by code discipline enforced in CI."
decision-makers: Mikhail Petrov (product owner)
---

# Ad-hoc signed releases: no App Group, no engine sandbox, one data folder

**ID**: `cpt-noter-adr-0004-no-app-group-unsandboxed-engine`

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [B: no App Group, no engine sandbox, the Application Support data folder](#b-no-app-group-no-engine-sandbox-the-application-support-data-folder)
  - [Keep the sandboxed engine and hand it folders through security-scoped bookmarks](#keep-the-sandboxed-engine-and-hand-it-folders-through-security-scoped-bookmarks)
  - [Get a Developer ID and keep the App Group](#get-a-developer-id-and-keep-the-app-group)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

## Context and Problem Statement

DESIGN-core (D14, C18, Q4) put audio, models, `engine-io/` and the capture ring in the App Group container `<TEAMID>.ai.noter`, shared by the unsandboxed app and the sandboxed engine. An App Group container is writable only by a process signed by the team that owns the group. Noter's releases are ad-hoc signed, and the owner will never have an Apple Developer ID. Since v0.23 every release build has been denied writes to the group container, so every model download fails (issue #998). Where do the app and the engine keep their files when releases cannot use an App Group?

## Decision Drivers

* Releases are ad-hoc signed, now and later: no team ID, no notarization, no App Group.
* The engine must never reach the network (`cpt-noter-constraint-core-engine-offline`): audio and voice must not leave the machine through it.
* The Microphone and System Audio Recording prompts must keep naming Noter, which the Q4 spike showed holds for an unsandboxed parent and its child.
* The fix should remove code rather than add a new file-handoff mechanism.

## Considered Options

* B: no App Group, no engine sandbox; app, core and engine share `~/Library/Application Support/Noter`.
* Keep the sandboxed engine and hand it its folders through security-scoped bookmarks (PR #1034, closed).
* Get a Developer ID and keep the App Group.

## Decision Outcome

Chosen option: "B", decided by the owner on #998 (https://github.com/getahead/noter/issues/998#issuecomment-7069543645). The app no longer has `com.apple.security.application-groups`. The engine no longer has `com.apple.security.app-sandbox` or the group. It keeps `com.apple.security.device.audio-input` under the hardened runtime. The core passes its data folder (`noter_core::default_data_dir()`, `~/Library/Application Support/Noter`) to the engine as `NOTER_DATA_DIR`. Every engine-protocol path is relative to that folder, which holds `noter.db`, `logs/`, `audio/`, `models/`, `engine-io/` and the capture ring. `noter-native` loses its group-container lookup.

**Existing installs: nothing is migrated.** v0.23 and v0.24 release builds could not create files in the group container. Earlier builds were also ad-hoc signed, so the group container holds nothing Noter wrote. Development runs already used the data folder, because an unsigned process has no group.

### Consequences

* Good, because model downloads, audio and the capture ring work on ad-hoc signed releases.
* Good, because one folder holds all of Noter's data, which makes backup, deletion and the Privacy pane simpler.
* Good, because `storage_move` (Q4) is no longer blocked by the sandbox. It stays a draft until its milestone says otherwise.
* Bad, because "the engine cannot reach the network" is no longer enforced by the OS. It becomes code discipline: no network entitlement (`just arch`), no networking API in `engine/Sources` (the architecture check), WhisperKit always created with `download: false`, and the built-engine signature check in CI.
* Bad, because the engine can now read and write anything the user can, so a bug in its path checks has a wider blast radius. The engine still validates every path against the data folder before opening it.
* Neutral, because the Mac App Store route (DESIGN-core, fallback A) needs the App Sandbox again and would revisit this decision.

### Confirmation

`codesign -d --entitlements -` on a release build shows no `application-groups` on the app or the embedded engine, and no `app-sandbox` on the engine. The CI built-engine signature check requires audio input and the hardened runtime, and rejects network, inherit, sandbox and group entitlements. The architecture check rejects networking APIs in the engine's sources. A clean-VM first run downloads the real models.

## Pros and Cons of the Options

### B: no App Group, no engine sandbox, the Application Support data folder

* Good, because it deletes code (the group lookup, TEAMID substitution) and needs no new mechanism.
* Good, because it works the same in development and release.
* Bad, because the offline guarantee moves from the OS to CI checks.

### Keep the sandboxed engine and hand it folders through security-scoped bookmarks

* Good, because the OS would still enforce "no network" on the engine.
* Bad, because every folder the engine touches needs a bookmark minted by the app, passed over the protocol and resolved by the engine: new code on both sides and new failure modes.
* Bad, because the capture ring and model folders would still need a location both processes can write, which is what the group was for.

### Get a Developer ID and keep the App Group

* Good, because nothing in the design changes.
* Bad, because the owner will not get one, so it is not available.

## More Information

Issue #998 and the owner's decision comment; the Q4 spike evidence (`.plans/backend/spike-q4-evidence.md`) for prompt attribution with an unsandboxed parent.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN-core.md](../DESIGN-core.md)

This decision directly addresses the following requirements or design elements:

* `cpt-noter-constraint-core-engine-offline` — the engine stays offline, now by code discipline
* `cpt-noter-component-engine` — runs unsandboxed with audio input only
* `cpt-noter-component-core-engine-supervisor` — passes the data folder as `NOTER_DATA_DIR`
* `cpt-noter-component-core-native` — no group-container lookup
