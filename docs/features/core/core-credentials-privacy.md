---
title: "Feature: Credentials, own accounts and the Privacy pane"
description: "Keychain API keys, CLI-driven account sign-in and binding, audit reads and export, and conditional storage moves."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M3
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Credentials, own accounts and the Privacy pane

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Read availability and store or remove a key](#read-availability-and-store-or-remove-a-key)
  - [Prepare and install an account runtime](#prepare-and-install-an-account-runtime)
  - [Sign in or reuse an existing account](#sign-in-or-reuse-an-existing-account)
  - [Bind agents, test and sign out](#bind-agents-test-and-sign-out)
  - [Read and export the egress audit](#read-and-export-the-egress-audit)
  - [Move storage when Q4 permits it](#move-storage-when-q4-permits-it)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Assemble availability and detect ended sessions](#assemble-availability-and-detect-ended-sessions)
  - [Check account eligibility and the runtime](#check-account-eligibility-and-the-runtime)
  - [Keep secrets outside records and logs](#keep-secrets-outside-records-and-logs)
- [4. States (CDSL)](#4-states-cdsl)
  - [Account connection and sign-in session](#account-connection-and-sign-in-session)
  - [API key verification](#api-key-verification)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Keychain keys and availability](#keychain-keys-and-availability)
  - [CLI sign-in without owning tokens](#cli-sign-in-without-owning-tokens)
  - [Logged binding and sign-out](#logged-binding-and-sign-out)
  - [Readable append-only audit](#readable-append-only-audit)
  - [Conditional storage job](#conditional-storage-job)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p4` - **ID**: `cpt-noter-featstatus-core-credentials-privacy`

- [ ] `p4` - `cpt-noter-feature-core-credentials-privacy`

## 1. Feature Context

### 1.1 Overview

The credentials service verifies API keys into the Keychain, drives separate Claude and ChatGPT sign-ins through their CLIs and reports runtime availability. It binds selected agents with Undo, installs missing CLIs as jobs and serves the Privacy pane over the existing append-only audit log. `storage_move` stays draft and is available only if Q4 results in an unsandboxed engine.

### 1.2 Purpose

The user can connect an assistant during first run or repair it later without interrupting recording. Keys remain the default; own accounts are explicit choices. The Privacy pane makes the existing M2 egress audit readable and exportable in M3.

**Requirements**: PRD › LLM orchestration › Own accounts; PRD › Security, privacy and permissions; PRD › Feature specification › 14. Settings.

**Principles**: `cpt-noter-principle-core-egress-gate`

**Delivers**:
- Frozen commands (M3): `api_key_remove`, `account_signin_prepare`, `cli_install`, `account_signin_start`, `account_signin_cancel`, `account_use_existing`, `account_bind_agents`, `account_test`, `account_sign_out`, `audit_list`, `audit_export`.
- Draft command assigned to M3: `storage_move` (Q4).
- Delivered earlier, in M2, by `cpt-noter-feature-core-llm-gate` (owner decision, 18 Oct): `accounts_get` and `api_key_set` with `accounts:changed`. That covers steps 1 to 5 of `cpt-noter-flow-core-credentials-privacy-keys`, the availability algorithm, the secret boundary for API keys, and the key state except removal. Their IDs and text stay here; this feature completes the flow with `api_key_remove` in M3.
- Events: `accounts:changed`, `signin:progress`; install and move jobs use `jobs:progress`.
- DESIGN.md stories (M3): `cpt-noter-seq-first-run-connect-assistant`, `cpt-noter-seq-settings-replace-api-key`, `cpt-noter-seq-settings-sign-in-account`, `cpt-noter-seq-settings-check-privacy`.

Agent editing belongs to M4; binding existing agents is in scope now. Audit writes and enforcement already belong to the M2 LLM gate. First-run setup completion, updates and the screen-share test reuse earlier features; these commands do not move into M3.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Connects, repairs or signs out assistants and exports the audit |
| Main, Settings and First-run windows | Read availability and drive sign-in according to manifest scopes |
| Claude Code, Codex and Ollama | Report install/version state; account CLIs own browser sign-in and credentials |
| macOS Keychain and native panels | Store API keys and choose export or storage locations |
| Router | Consumes runtime availability and applies unchanged privacy policy |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-credentials-privacy`; overview discrepancies 1 (decided: `accounts_get` and `api_key_set` in M2), 7 and 9
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-credentials`, `cpt-noter-seq-core-account-signin`, `cpt-noter-constraint-core-api-keys`, `cpt-noter-principle-core-egress-gate`; 3.3 scopes and errors, 3.7 audit log, 3.8 storage, 4.3 Q4 and Q8
- **PRD**: [PRD.md](../../PRD.md) › LLM orchestration › Own accounts; Security, privacy and permissions
- **Contract**: `crates/noter-protocol/src/model/accounts.rs`, `model/settings.rs`, `error.rs`, `contracts/ipc.manifest.json`
- **Dependencies**: `cpt-noter-feature-core-llm-gate`, `cpt-noter-feature-core-first-run`

The decomposition assigns no new table here: account metadata uses existing settings, binding uses existing agents and changes, and audit reads the gate's existing table. CLI installation uses the M2 scheduler. These are integration seams, not new command ownership.

Known contract limits: `AuditListArgs` and `AuditExportArgs` accept dates but no call id, so server-filtered call-specific audit/export in the story cannot be expressed. `account_use_existing` accepts only provider, while the Claude reuse story also requires personal-use confirmation; the browser-start command carries it, reuse does not. The existing-account route must not bypass that requirement. Q8 settles Claude plan detection, with the test request as fallback. Q4 settles whether storage moves ship. No new arguments, plan-detection mechanism or storage entitlement decision is defined here.

## 2. Actor Flows (CDSL)

### Read availability and store or remove a key

- [ ] `p4` - **ID**: `cpt-noter-flow-core-credentials-privacy-keys`

**Actor**: Primary user (First run or Settings › Models & Runtimes)

**Success Scenarios**:
- A verified replacement becomes configured; no key value returns to any window.
- With no assistant, first run can still finish and recording and transcription keep working.

**Error Scenarios**:
- Provider rejection: `key_rejected`; locked Keychain: `keychain_locked`; offline verification: `offline`. A failed replacement does not destroy a previously working key.

**Steps**:
1. [ ] - `p1` - API: `accounts_get` from main, Settings or First run runs `cpt-noter-algo-core-credentials-privacy-availability` and returns versioned `AccountsView` (M2, `cpt-noter-feature-core-llm-gate`) - `inst-key-read`
2. [ ] - `p1` - API: `api_key_set { provider, key }` only from Settings or First run; validate the provider and non-empty secret without logging or persisting the submitted arguments (M2, `cpt-noter-feature-core-llm-gate`) - `inst-key-request`
3. [ ] - `p1` - Publish verifying status; verify the candidate using the router and egress gate, without replacing the saved key until verification succeeds (M2, `cpt-noter-feature-core-llm-gate`) - `inst-key-verify`
4. [ ] - `p1` - Store the verified key in Keychain; store only status and verification time in settings through the change-log writer, never secret before/after values (M2, `cpt-noter-feature-core-llm-gate`) - `inst-key-store`
5. [ ] - `p1` - Recompute availability and emit `accounts:changed` with a new version; **RETURN** `AccountsView` with status only (M2, `cpt-noter-feature-core-llm-gate`) - `inst-key-return`
6. [ ] - `p1` - API: `api_key_remove { provider }` only from Settings removes its Keychain item, updates status and router availability, emits `accounts:changed` and **RETURN** `AccountsView` (M3) - `inst-key-remove`

### Prepare and install an account runtime

- [ ] `p4` - **ID**: `cpt-noter-flow-core-credentials-privacy-prepare`

**Actor**: Primary user (sign-in sheet or local-runtime row)

**Success Scenarios**:
- Prepare detects the installed CLI and an existing account; missing Claude Code, Codex or Ollama can be installed as a job.

**Error Scenarios**:
- Missing or unsupported CLI: `cli_missing` or `cli_version_unsupported`, with a one-step fix; install failure leaves the old install intact.

**Steps**:
1. [ ] - `p1` - API: `account_signin_prepare { provider }` from main, Settings or First run checks the provider's CLI path, version and auth status - `inst-prepare-check`
2. [ ] - `p1` - Ask the CLI only for account identity and plan; **RETURN** `SignInPrepare` with existing identity if present and `needs_personal_use_confirmation` for Claude - `inst-prepare-return`
3. [ ] - `p1` - API: `cli_install { tool }` accepts only the contract's Claude Code, Codex or Ollama choices and enqueues an install job; **RETURN** `JobAccepted` - `inst-install-request`
4. [ ] - `p1` - Install through the fixed egress-host allow-list without user transcript or document text; report `jobs:progress`, then check the resulting version - `inst-install-run`
5. [ ] - `p1` - Recompute account and local-runtime availability and emit `accounts:changed`; no sign-in or agent switch occurs merely because installation succeeded - `inst-install-complete`

### Sign in or reuse an existing account

- [ ] `p4` - **ID**: `cpt-noter-flow-core-credentials-privacy-signin`

**Actor**: Primary user (Prepare, Sign in and Check steps)

**Success Scenarios**:
- Claude's personal-use confirmation precedes browser login; ChatGPT signs in independently without that checkbox.
- A qualifying CLI-held sign-in passes account, plan and test checks without exposing a password or token.

**Error Scenarios**:
- `personal_use_not_confirmed`, `sign_in_cancelled`, `sign_in_timed_out`, `plan_not_eligible`, `offline` or a CLI failure leaves agents unchanged.
- Closing the sheet leaves the session running; explicit Cancel stops it.

**Steps**:
1. [ ] - `p1` - API: `account_signin_start { provider, personal_use_confirmed }`; reject Claude without confirmation and reject missing or unsupported CLI before starting login - `inst-signin-validate`
2. [ ] - `p1` - Start the unmodified CLI's browser login and create a provider-specific session; **RETURN** `SignInSession` with URL, optional one-time code and expiry five minutes after start - `inst-signin-start`
3. [ ] - `p1` - Publish `signin:progress` as waiting_for_browser; account status is signing_in; keep the process owned by the core, independent of sheet visibility - `inst-signin-wait`
4. [ ] - `p1` - On CLI success, run `cpt-noter-algo-core-credentials-privacy-check-account` and emit signed_in, checking_plan, sending_test_request and done progress for that session - `inst-signin-check`
5. [ ] - `p1` - **IF** cancellation, timeout or failure wins the session, stop the login task and publish the exact error; ignore late success and do not bind agents - `inst-signin-fail`
6. [ ] - `p1` - API: `account_signin_cancel { session_id }` cancels the matching active session, refreshes availability and **RETURN** `AccountsView` - `inst-signin-cancel`
7. [ ] - `p1` - API: `account_use_existing { provider }` rechecks CLI status and runs the same eligibility and test checks; Claude reuse requires a verifiable personal-use confirmation as noted in 1.4 - `inst-signin-existing`
8. [ ] - `p1` - Save non-secret identity, plan and connection metadata through the writer; emit versioned `accounts:changed`; **RETURN** `AccountsView` for reuse, or complete the browser session through progress - `inst-signin-return`

### Bind agents, test and sign out

- [ ] `p4` - **ID**: `cpt-noter-flow-core-credentials-privacy-bind-signout`

**Actor**: Primary user (Use step, Models & Runtimes or account repair)

**Success Scenarios**:
- Only selected existing agents switch; the returned change id undoes the whole switch.
- Explicit sign-out falls back to the matching API key, or pauses affected agents if it is unavailable.

**Error Scenarios**:
- Unknown agent: `not_found`; unavailable account: `account_signed_out` or `runtime_unavailable`; a provider-ended session pauses agents until reconnection rather than silently rebinding them.

**Steps**:
1. [ ] - `p1` - API: `account_bind_agents { provider, agent_ids, default_for_new_agents }`; validate a checked eligible account and each requested agent - `inst-bind-validate`
2. [ ] - `p1` - DB: in one undoable change batch switch only those agents to claude_account or chatgpt_account and update the requested new-agent preference; retain all before values for Undo - `inst-bind-write`
3. [ ] - `p1` - After commit, recompute availability and publish account and affected agent changes; **RETURN** `AccountBindResult` with `change_id` - `inst-bind-return`
4. [ ] - `p1` - API: `account_test { provider }` sends a short test through the same router and gate; **RETURN** `AccountTestResult` with ok, latency or typed error - `inst-account-test`
5. [ ] - `p1` - API: `account_sign_out { provider, also_in_cli }`; cancel that provider's pending sign-in and remove its Noter connection metadata - `inst-signout-request`
6. [ ] - `p1` - Switch affected agents back to the matching API-key runtime through the logged writer; if no usable key exists mark them unavailable; sign the CLI out only when requested - `inst-signout-apply`
7. [ ] - `p1` - **RETURN** `AccountsView` and emit `accounts:changed`; errors in optional CLI logout must not claim that the CLI is signed out - `inst-signout-return`

### Read and export the egress audit

- [ ] `p4` - **ID**: `cpt-noter-flow-core-credentials-privacy-audit`

**Actor**: Primary user (Settings › Privacy)

**Success Scenarios**:
- Date-filtered rows explain time, what, bytes and destination; an empty range stays empty.
- Markdown or JSON export contains audit metadata and no audio, secrets or raw payloads.

**Error Scenarios**:
- Invalid date range or page cursor: `invalid_input`; cancelled save panel: `cancelled`; file failure: typed error without a success result.

**Steps**:
1. [ ] - `p1` - API: `audit_list { from, to, page }` from Settings validates dates and cursor and reads append-only rows from the pool in stable time/id order - `inst-audit-read`
2. [ ] - `p1` - Assemble `AuditEntry` with kind, run linkage, optional call/runtime, destination, what, bytes and redaction flag; **RETURN** a cursor page - `inst-audit-return`
3. [ ] - `p1` - API: `audit_export { from, to, format }` from Settings uses the same date predicate; the core opens the native save panel - `inst-audit-export`
4. [ ] - `p1` - Stream matching metadata rows to Markdown or JSON in bounded batches; export no packet body, original redaction mapping, key or audio - `inst-audit-write`
5. [ ] - `p1` - Complete the file and **RETURN** `ExportResult`; do not change or erase audit rows as a side effect - `inst-audit-complete`

### Move storage when Q4 permits it

- [ ] `p4` - **ID**: `cpt-noter-flow-core-credentials-privacy-storage`

**Actor**: Primary user (Settings › General › Storage location)

**Success Scenarios**:
- In an unsandboxed-engine build, a selected local destination receives the movable App Group contents as a job, and the effective path changes only after verification.

**Error Scenarios**:
- Sandboxed build: `not_implemented`, no move; cloud-synced destination: `storage_in_cloud_folder`; cancelled panel: `cancelled`; insufficient disk: `disk_full`.

**Steps**:
1. [ ] - `p1` - API: draft `storage_move { path }` from Settings; **IF** Q4 has not enabled an unsandboxed build, **RETURN** `not_implemented` - `inst-storage-guard`
2. [ ] - `p1` - Resolve the supplied local path or native open-panel choice and reject iCloud Drive, Dropbox, invalid or inaccessible destinations - `inst-storage-path`
3. [ ] - `p1` - Wait for capture and engine file users to be idle before moving audio, models and engine I/O; keep the effective source location until work completes - `inst-storage-idle`
4. [ ] - `p1` - Enqueue the move job and **RETURN** `JobAccepted`; copy and verify into the destination without deleting the only valid source copy - `inst-storage-job`
5. [ ] - `p1` - Switch the effective path through the logged settings writer only after verification; reopen engine paths, publish job completion and then clean up the old copy - `inst-storage-switch`
6. [ ] - `p1` - **IF** copy or verification fails, keep the old path effective and report the job error; no partial path switch is reported as success - `inst-storage-failure`

## 3. Processes / Business Logic (CDSL)

### Assemble availability and detect ended sessions

- [ ] `p4` - **ID**: `cpt-noter-algo-core-credentials-privacy-availability`

**Input**: Keychain status, non-secret connection metadata, CLI path/version/auth checks, Ollama status and current agent bindings.

**Output**: `AccountsView` and router runtime availability.

**Steps**:
1. [ ] - `p1` - Query key presence and verification state without returning values; report not_set, configured, rejected or keychain_locked - `inst-availability-keys`
2. [ ] - `p1` - Detect each CLI's installed path, tested version support and provider-reported identity; detect Ollama readiness and available local models - `inst-availability-clis`
3. [ ] - `p1` - **IF** a connected account's provider has ended the session, mark signed_out_by_provider with time, pause its agents and publish the one-step sign-in fix - `inst-availability-ended`
4. [ ] - `p1` - Join agents using each account and apply current runtime availability; account usage does not consume the per-call API budget share - `inst-availability-bindings`
5. [ ] - `p1` - Stamp a monotonic version shared by the command result, snapshot slice and `accounts:changed`; coalesce unchanged observations - `inst-availability-version`
6. [ ] - `p1` - **RETURN** public statuses only; transcript, document, key, CLI token and one-time code never enter diagnostics - `inst-availability-return`

### Check account eligibility and the runtime

- [ ] `p4` - **ID**: `cpt-noter-algo-core-credentials-privacy-check-account`

**Input**: Provider, CLI-held sign-in, personal-use confirmation for Claude, session id and deadline.

**Output**: Checked account metadata or a typed sign-in failure; no agent switch.

**Steps**:
1. [ ] - `p1` - Reject an expired or cancelled session before applying its result; use only provider identity and plan status supplied by the CLI - `inst-check-session`
2. [ ] - `p1` - Require confirmed personal use for Claude and a Pro or Max plan; ChatGPT accepts Plus, Pro, Business or Enterprise independently - `inst-check-plan`
3. [ ] - `p1` - Use the M3 Q8 spike's verified Claude plan signal when available; otherwise use the short test-request fallback rather than reading a stored token or guessing from email - `inst-check-spike`
4. [ ] - `p1` - Run a short test through the router, with the same per-run isolation, tool restrictions and egress audit as other own-account requests - `inst-check-test`
5. [ ] - `p1` - Map cancellation, five-minute timeout, ineligible plan, offline and provider-ended session to the contract errors; failed checks leave agent bindings unchanged - `inst-check-error`
6. [ ] - `p1` - Recheck the session is still current before committing identity, plan and connected time through the writer; **RETURN** success - `inst-check-return`

### Keep secrets outside records and logs

- [ ] `p4` - **ID**: `cpt-noter-algo-core-credentials-privacy-secret-boundary`

**Input**: A credentials command, Keychain operation or CLI auth observation.

**Output**: Secret-free state, changes and diagnostics; secrets remain in the intended credential owner.

**Steps**:
1. [ ] - `p1` - Pass API key values only to candidate verification, Keychain storage and authorized runtime invocation; never serialize them into settings, changes or events - `inst-secret-key`
2. [ ] - `p1` - Let the unmodified CLI own account passwords and tokens; never read its credential files or copy its token into Noter's isolated run configuration - `inst-secret-account`
3. [ ] - `p1` - Persist only identity, plan, connection state, references and revisioned agent preferences - `inst-secret-metadata`
4. [ ] - `p1` - Scrub secret-bearing process output and command arguments; release candidate-key buffers after use - `inst-secret-scrub`
5. [ ] - `p1` - **RETURN** status-only views; no masked key value is reconstructed by reading the saved secret for display - `inst-secret-return`

## 4. States (CDSL)

### Account connection and sign-in session

- [ ] `p4` - **ID**: `cpt-noter-state-core-credentials-privacy-account`

**States**: not_signed_in, signing_in, signed_in, signed_out_by_provider

**Initial State**: not_signed_in

**Transitions**:
1. [ ] - `p1` - **FROM** not_signed_in **TO** signing_in **WHEN** an eligible browser sign-in starts; also from signed_out_by_provider on retry - `inst-account-start`
2. [ ] - `p1` - **FROM** signing_in **TO** signed_in **WHEN** identity, plan and test checks succeed before the five-minute deadline - `inst-account-connected`
3. [ ] - `p1` - **FROM** signing_in **TO** not_signed_in **WHEN** Cancel, timeout, failed eligibility or connectivity ends the attempt; never accept its late success - `inst-account-failed`
4. [ ] - `p1` - **FROM** not_signed_in **TO** signed_in **WHEN** an existing CLI session passes the same checks and required confirmation; also from signed_out_by_provider - `inst-account-existing`
5. [ ] - `p1` - **FROM** signed_in **TO** not_signed_in **WHEN** explicit Noter sign-out moves agents to the matching key or unavailable state - `inst-account-signout`
6. [ ] - `p1` - **FROM** signed_in **TO** signed_out_by_provider **WHEN** provider auth ends; agents stay bound but paused until repaired - `inst-account-provider-ended`

Within signing_in, `SignInStep` progresses through waiting_for_browser, signed_in, checking_plan, sending_test_request and done; session progress is not a whole-state event. A closed sheet does not cancel the session. Provider sessions are independent; restart rechecks CLI state rather than resuming a stale in-memory login process.

### API key verification

- [ ] `p4` - **ID**: `cpt-noter-state-core-credentials-privacy-key`

**States**: not_set, verifying, configured, rejected, keychain_locked

**Initial State**: not_set, or observed Keychain status on restart

**Transitions**:
1. [ ] - `p1` - **FROM** not_set **TO** verifying **WHEN** a candidate is submitted; also from configured or rejected - `inst-key-state-verify`
2. [ ] - `p1` - **FROM** verifying **TO** configured **WHEN** the provider accepts the candidate and Keychain storage succeeds - `inst-key-state-save`
3. [ ] - `p1` - **FROM** verifying **TO** rejected **WHEN** a candidate is rejected and there is no working saved key; otherwise restore the prior saved-key status and return the candidate error - `inst-key-state-reject`
4. [ ] - `p1` - **FROM** configured **TO** rejected **WHEN** the provider rejects the saved key - `inst-key-state-revoked`
5. [ ] - `p1` - **FROM** configured **TO** keychain_locked **WHEN** Keychain access fails; also from verifying or not_set - `inst-key-state-locked`
6. [ ] - `p1` - **FROM** keychain_locked **TO** configured **WHEN** access returns and the saved key is verified; otherwise recompute not_set or rejected - `inst-key-state-unlocked`
7. [ ] - `p1` - **FROM** configured **TO** not_set **WHEN** removal succeeds; also from rejected or keychain_locked after a successful Keychain delete (M3; the other transitions are M2 with `cpt-noter-feature-core-llm-gate`) - `inst-key-state-remove`

## 5. Definitions of Done

### Keychain keys and availability

- [ ] `p4` - **ID**: `cpt-noter-dod-core-credentials-privacy-keys`

The system **MUST** verify and store keys in Keychain, preserve a working key on failed replacement, publish versioned status-only account views and detect local-runtime readiness. Every window obeys manifest scope; removal from main or First run is refused. Keys remain the default and no assistant state ever gates capture.

**Implements**:
- `cpt-noter-flow-core-credentials-privacy-keys`
- `cpt-noter-algo-core-credentials-privacy-availability`
- `cpt-noter-algo-core-credentials-privacy-secret-boundary`
- `cpt-noter-state-core-credentials-privacy-key`

**Constraints**: `cpt-noter-constraint-core-api-keys`

**Touches**:
- API: `accounts_get`, `api_key_set`, `api_key_remove`, `accounts:changed`
- DB: non-secret `settings`, `changes`
- Entities: `AccountsView`, `KeyStatus`

### CLI sign-in without owning tokens

- [ ] `p4` - **ID**: `cpt-noter-dod-core-credentials-privacy-signin`

The system **MUST** prepare, install, sign in, reuse and cancel through the CLIs, with independent providers, explicit Claude personal-use confirmation, a five-minute deadline, eligibility checks and a test request. Complete the Q8 spike before claiming accurate Claude plan detection; retain its documented test fallback. The existing-account confirmation gap in 1.4 must be resolved upstream before that Claude reuse path is accepted.

**Implements**:
- `cpt-noter-flow-core-credentials-privacy-prepare`
- `cpt-noter-flow-core-credentials-privacy-signin`
- `cpt-noter-algo-core-credentials-privacy-check-account`
- `cpt-noter-state-core-credentials-privacy-account`

**Touches**:
- API: `account_signin_prepare`, `cli_install`, `account_signin_start`, `account_signin_cancel`, `account_use_existing`, `signin:progress`
- DB: non-secret connection metadata, install jobs
- Entities: `SignInPrepare`, `SignInSession`, `SignInProgress`

### Logged binding and sign-out

- [ ] `p4` - **ID**: `cpt-noter-dod-core-credentials-privacy-binding`

The system **MUST** bind only selected agents and the requested default preference in one undoable batch, test the connected account through the gate, and distinguish explicit sign-out fallback from provider-ended pause. No account sign-in silently selects agents, changes privacy mode or exposes user hooks and MCP servers to a run.

**Implements**:
- `cpt-noter-flow-core-credentials-privacy-bind-signout`
- `cpt-noter-algo-core-credentials-privacy-check-account`

**Touches**:
- API: `account_bind_agents`, `account_test`, `account_sign_out`, `accounts:changed`
- DB: `agents`, `settings`, `changes`
- Entities: `AccountBindResult`, `AccountTestResult`

### Readable append-only audit

- [ ] `p4` - **ID**: `cpt-noter-dod-core-credentials-privacy-audit`

The system **MUST** page and export run, tool_result and lookup metadata by date without exposing raw payloads or changing the append-only log. Reads and export preserve run linkage and destinations so the gate's network-monitor evidence can be inspected. M3 exposes rows already written in M2; it does not introduce a second audit writer.

**Implements**:
- `cpt-noter-flow-core-credentials-privacy-audit`

**Touches**:
- API: `audit_list`, `audit_export`
- DB: `audit_log` (read only)
- Entities: `AuditEntry`, `ExportResult`

### Conditional storage job

- [ ] `p4` - **ID**: `cpt-noter-dod-core-credentials-privacy-storage`

The system **MUST** keep `storage_move` draft and unavailable with a sandboxed engine. If Q4 enables it, the job accepts only local storage, waits for file users, verifies before switching and retains the old valid location on failure. This is conditional scope, not a decision to ship an unsandboxed engine.

**Implements**:
- `cpt-noter-flow-core-credentials-privacy-storage`

**Touches**:
- API: `storage_move`, `jobs:progress`
- DB: storage settings and job/change records
- Entities: `StorageMoveArgs`, `JobAccepted`

## 6. Acceptance Criteria

- [ ] E2E against the real core, `cpt-noter-seq-first-run-connect-assistant`: a verified key or checked account appears connected; no-assistant Finish still opens Today and capture works.
- [ ] E2E against the real core, `cpt-noter-seq-settings-replace-api-key`: rejection, locked Keychain and corrected replacement report distinct states; secrets occur in no result, event, change row or diagnostic.
- [ ] E2E against the real core, `cpt-noter-seq-settings-sign-in-account`: both providers sign in independently; an injected clock tests timeout and late-success rejection; cancellation, offline and ineligible plans leave bindings untouched.
- [ ] Selected-agent binding returns a change id; M2 Undo restores all selected runtime and default values; explicit sign-out falls back to the matching key or pauses, while provider-ended sessions stay bound and paused.
- [ ] E2E against the real core, `cpt-noter-seq-settings-check-privacy`: date-filtered audit rows and export preserve kind, run, bytes and destination; an empty log is empty; export contains no audio or raw payload. Call-specific server filtering remains the upstream gap in 1.4.
- [ ] Missing and unsupported CLIs are distinguished; install-job progress and failed-install retry work through scripted seams without altering unrelated installs.
- [ ] All thirteen frozen commands succeed at least once in real-core E2E runs; native Keychain, browser and panel integration is checked on macOS. Native story tests use `test_cpt_noter_seq_…` names.
- [ ] Sandboxed `storage_move` returns `not_implemented` and is not counted as a frozen command. If enabled by Q4, test success, cloud-folder rejection and copy-failure rollback.
- [ ] `just gate-fast` and `just gate` pass; Q8 and the confirmation and call-filter contract limits are not represented as completed implementation.
