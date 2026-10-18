---
title: "Feature — Keys and own-account sign-in"
description: "Credential rows, key replacement and separate Claude and ChatGPT sign-in through their CLIs, with explicit runtime binding."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-accounts
milestone: M3
---

# Feature: Keys and own-account sign-in

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Add, replace or remove an API key](#add-replace-or-remove-an-api-key)
  - [Sign in through the user's CLI](#sign-in-through-the-users-cli)
  - [Test, select task runtimes and sign out](#test-select-task-runtimes-and-sign-out)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Reconcile one sign-in session](#reconcile-one-sign-in-session)
- [4. States (CDSL)](#4-states-cdsl)
  - [Account and key surfaces](#account-and-key-surfaces)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Credential rows and keys](#credential-rows-and-keys)
  - [Independent account sessions and explicit binding](#independent-account-sessions-and-explicit-binding)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p4` - **ID**: `cpt-noter-featstatus-ui-accounts`

## 1. Feature Context

- [ ] `p4` - `cpt-noter-feature-ui-accounts`

### 1.1 Overview

Models & Runtimes and first-run Assistants share API-key and account rows. Claude and ChatGPT accounts connect independently through Prepare, Sign in, Check and Use; the core and CLI own sign-in and secret storage.

### 1.2 Purpose

Implement credential row, field and account-login variants, key sheets and removal, the four-step sign-in sheet, account test and sign-out, and runtime choice per task.

**Requirements**: PRD › Feature specification › 14; LLM orchestration › Own accounts; Security, privacy and permissions › Credentials; DESIGN PM-58. The PRD has no requirement IDs.

**Principles**: follows Settings, first-run and dialogs; core state remains authoritative.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Supplies a key or signs in, then chooses which tasks and agents use it |
| Noter core (system) | Stores keys, invokes the CLI and publishes account state |
| Claude Code or Codex (external system) | Runs browser sign-in and keeps its session in the Keychain |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 14; LLM orchestration; Credentials
- **Design**: [DESIGN.md](../../DESIGN.md) › Settings — Models & Runtimes; First-run step 6; Dialogs sign-in and sign-out; Component — Credential row
- **Design elements**: `cpt-noter-component-ui-credential-row`; uses `cpt-noter-component-screen-settings`, `cpt-noter-component-screen-first-run`, `cpt-noter-component-screen-dialogs`, `cpt-noter-component-ui-status-row`
- **Stories (M3)**: `cpt-noter-seq-first-run-connect-assistant`, `cpt-noter-seq-settings-replace-api-key`, `cpt-noter-seq-settings-sign-in-account`
- **Frozen commands delivered (M2, owner decision of 18 Oct)**: `accounts_get`, `api_key_set`
- **Frozen commands delivered (M3)**: `api_key_remove`, `account_signin_prepare`, `cli_install`, `account_signin_start`, `account_signin_cancel`, `account_use_existing`, `account_bind_agents`, `account_test`, `account_sign_out`
- **Earlier commands reused**: `settings_get`, `settings_update` for task runtime, `models_download`, `open_external`, `change_undo` through History
- **Events**: `accounts:changed`, `signin:progress`, `jobs:progress`, `settings:changed`, `privacy:changed`
- **Data**: no UI tables; credentials and CLI sessions stay with the core and tools
- **Prototype modules**: `src/js/60-f-accounts.js`, `50-e-1-components.js` (`C.credentialRow`), `50-e-5-settings.js` (`models`), `30-c-dialogs.js` (`dlg-api-key`); `src/css/50-e.css`, `60-f.css`
- **Contract and test reference**: `apps/desktop/src/core/bindings.ts` and `apps/desktop/src/core/fake/` (read-only); [HARNESS.md](../../HARNESS.md); [DECOMPOSITION.md](../../DECOMPOSITION.md)
- **Dependencies**: `cpt-noter-feature-ui-settings`, `cpt-noter-feature-ui-first-run`, `cpt-noter-feature-ui-dialogs-host`

## 2. Actor Flows (CDSL)

### Add, replace or remove an API key

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-accounts-key`

Delivered in M2 (see Milestone notes). Steps 7, 8 and 9.1 call M3 commands: M2 builds them against the fake core, and they pass against the real core in M3.

**Actor**: Primary user

**Success Scenarios**:
- A rejected key is replaced from Models & Runtimes; Configured and Saved appear after core success
- First-run Verify connects an assistant; Not Now still permits Finish without one

**Error Scenarios**:
- Rejected: **Anthropic rejected this key (invalid key)** under the field; editing permits another attempt
- Keychain locked: pane banner and Try Again; macOS owns any password prompt
- Local runtime missing or model not ready: Install Ollama or Download; recording and transcription remain available

**Steps**:
1. [ ] - `p1` - User opens Models & Runtimes or first-run Assistants; API: `accounts_get`; UI shows keys and two independent account-login rows - `inst-read`
2. [ ] - `p1` - User chooses Add or Replace; UI opens an empty secure field accepting paste, with Verify and Save; the stored key is never filled in - `inst-open-key`
3. [ ] - `p1` - User enters the key; Return runs Verify; disable duplicate submission while verifying - `inst-enter`
4. [ ] - `p1` - API: `api_key_set` with provider and the entered key once; this frozen command verifies and stores, as distinguished from the prototype's separate actions below - `inst-set`
5. [ ] - `p1` - **IF** verification fails - `inst-if-rejected`
   1. [ ] - `p1` - UI: show the provider's safe reason and invalid state, return focus to the secure field and allow a new input; clear the secret draft on close - `inst-invalid`
6. [ ] - `p1` - **ELSE** replace the account slice from the core, clear the draft, show Configured and **•••••••• Stored in the Keychain**; Save closes an already stored result without resending the secret - `inst-saved`
7. [ ] - `p1` - User chooses Remove; native alert explains the runtime becomes unavailable and the key leaves the Keychain; Cancel is default - `inst-remove-alert`
8. [ ] - `p1` - On confirmation API: `api_key_remove`; replace the slice only after success; no local credential deletion - `inst-remove`
9. [ ] - `p1` - **IF** the local runtime is missing - `inst-if-local`
   1. [ ] - `p1` - User chooses Install Ollama; API: `cli_install` for Ollama; model Download has the contract limitation below; job/account updates determine readiness - `inst-install-local`
10. [ ] - `p1` - User may choose Not Now in first run; UI explains **Without an assistant Noter still records and transcribes; summaries wait until one is connected.** and allows Finish - `inst-skip`
11. [ ] - `p1` - **RETURN** the core's credential status; show Saved for 2 s after successful storage - `inst-return-key`

### Sign in through the user's CLI

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-accounts-sign-in`

**Actor**: Primary user

**Success Scenarios**:
- Connect Claude, then ChatGPT; either account works without the other
- Reuse an existing CLI login without a browser; close and reopen a waiting sheet without cancelling

**Error Scenarios**:
- CLI missing or unsupported; install failure; browser cancellation; 5-minute timeout; ineligible plan; offline
- Errors preserve the other provider's state and never change agent runtimes implicitly

**Steps**:
1. [ ] - `p1` - User chooses Sign In with Claude or ChatGPT; API: `account_signin_prepare` with provider - `inst-prepare`
2. [ ] - `p1` - UI: 520-pt sheet at Prepare with CLI/path, facts about password ownership, chosen agents/tasks and privacy; show personal-use confirmation only for Claude - `inst-prepare-ui`
3. [ ] - `p1` - **IF** the CLI is missing - `inst-if-missing`
   1. [ ] - `p1` - User chooses Install; API: `cli_install`; consume matching job progress, then prepare again; Continue stays disabled until the tool is installed and supported - `inst-install`
4. [ ] - `p1` - **IF** prepare reports an existing account - `inst-if-existing`
   1. [ ] - `p1` - UI: Use this account selected and Sign in with another account; Use This Account calls `account_use_existing` after the local personal-use guard - `inst-use-existing`
5. [ ] - `p1` - **ELSE** user confirms personal use where required and chooses Continue in Browser - `inst-browser-choice`
   1. [ ] - `p1` - API: `account_signin_start` with provider and personal-use confirmation; the CLI opens the browser - `inst-start`
   2. [ ] - `p1` - UI: waiting state from returned session id, expiry and optional code; Copy Code/Link use only returned values, Open the Page Again uses returned URL via `open_external` - `inst-wait`
6. [ ] - `p1` - User may press Esc to hide the sheet; row keeps **Finishing in your browser…**, Show and Cancel; Show restores the same session - `inst-hide`
7. [ ] - `p1` - Algorithm: consume matching `signin:progress` and `accounts:changed` through `cpt-noter-algo-ui-accounts-session` - `inst-progress`
8. [ ] - `p1` - **IF** browser cancellation, timeout, plan rejection or network error arrives - `inst-if-error`
   1. [ ] - `p1` - UI: prototype's specific error title and explanation; explicit Try Again/Open the Page Again starts a fresh valid session, Use Another Account prepares another sign-in, Use an API Key Instead opens that provider's key sheet - `inst-error`
9. [ ] - `p1` - **IF** user chooses Cancel in row or sheet - `inst-if-cancel`
   1. [ ] - `p1` - API: `account_signin_cancel` with session id; ignore later progress for it and clear the waiting view - `inst-cancel`
10. [ ] - `p1` - UI: Check steps use returned identity and plan; when signed in show Use with candidate agents, current runtime labels, unavailable agents preselected and **Offer your account first when adding an agent** - `inst-use`
11. [ ] - `p1` - User chooses Use for N Agents; API: `account_bind_agents` with provider, chosen ids and default preference; consume accounts and give its `change_id` to shared Undo - `inst-bind`
12. [ ] - `p1` - User may choose Not Now or Done without moving agents; retain the connected account; first-run Finish opens Today through its existing flow - `inst-finish`
13. [ ] - `p1` - **RETURN** separate signed-in rows with returned identity, plan, tool and agents - `inst-return-sign-in`

### Test, select task runtimes and sign out

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-accounts-manage`

Steps 2 and 3 (Runtime per task) are delivered in M2, with the account runtimes listed as not connected until M3; the other steps are M3 (see Milestone notes).

**Actor**: Primary user

**Success Scenarios**:
- Test shows actual latency; task runtime changes persist; sign-out names affected agents and optionally signs the CLI out

**Error Scenarios**:
- Session ended: **Signed out by Claude** or ChatGPT with Sign In Again; affected agents stay paused
- Failed test or sign-out reports a safe error without falsely changing the account row

**Steps**:
1. [ ] - `p1` - User chooses Test; API: `account_test`; show actual latency only if ok, otherwise its mapped error - `inst-test`
2. [ ] - `p1` - User selects a connected runtime for Live copilot, Post-call analysis or Search answers; UI keeps disconnected choices visible and disabled - `inst-task`
3. [ ] - `p1` - API: `settings_update` with runtimes section and revision through Settings; restore core values on failure - `inst-save-task`
4. [ ] - `p1` - User chooses Sign Out; alert names agents falling back to the matching key or pausing without one, and explains the CLI stays signed in unless **Also sign out of … on this Mac** is chosen - `inst-signout-alert`
5. [ ] - `p1` - User confirms; API: `account_sign_out` with provider and `also_in_cli`; accounts events determine the result - `inst-signout`
6. [ ] - `p1` - On provider-ended state show the expired row and affected-agent count; Sign In Again reuses the sign-in flow; never silently bind agents to another account - `inst-expired`
7. [ ] - `p1` - **RETURN** Models & Runtimes; per-agent editor and quick-fix UI are owned by Agents in M4 - `inst-return-manage`

## 3. Processes / Business Logic (CDSL)

### Reconcile one sign-in session

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-accounts-session`

**Input**: prepare/session responses, provider, matching progress, AccountsView and pending job id

**Output**: one provider's Prepare, Browser, Check, Use or error state

**Steps**:
1. [ ] - `p1` - Keep provider and session ids separate from the other provider; ignore unrelated or replaced-session progress - `inst-correlate`
2. [ ] - `p1` - Disable Continue for missing/unsupported CLI and unticked required personal-use confirmation; never infer eligibility from fixture plan names - `inst-guard`
3. [ ] - `p1` - Derive countdown from `expires_at`; no local countdown authorizes success or binds an agent - `inst-countdown`
4. [ ] - `p1` - Map waiting_for_browser to Sign in, signed_in/checking_plan/sending_test_request to Check, done plus confirmed signed-in accounts state to Use - `inst-map`
5. [ ] - `p1` - Replace whole account state only at the highest version through the bridge; prepare/use-existing results refresh the account row without fabricating Check progress - `inst-version`
6. [ ] - `p1` - Hide a sheet without stopping the core session; on window reload use accounts_get to recover signing-in status; cancel only on the explicit Cancel action - `inst-lifecycle`
7. [ ] - `p1` - Clear code, URL and secure drafts when no longer needed; no password, token, key or sign-in code enters logs, storage or analytics - `inst-clear`
8. [ ] - `p1` - **RETURN** the active provider's view; retry is always user initiated - `inst-return`

## 4. States (CDSL)

### Account and key surfaces

- [ ] `p1` - **ID**: `cpt-noter-state-ui-accounts-credentials`

**States**: SIGNED_OUT, PREPARE, INSTALLING, BROWSER, BROWSER_HIDDEN, CHECK, USE, SIGNED_IN, EXPIRED, SIGNIN_ERROR, KEY_DRAFT, KEY_VERIFYING, KEY_INVALID, KEY_CONFIGURED, KEYCHAIN_LOCKED

**Initial State**: SIGNED_OUT (until accounts_get supplies stored state)

The key transitions 11 to 14 are M2; the account transitions 1 to 10 are M3. The state is ticked in M3.

**Transitions**:
1. [ ] - `p1` - **FROM** SIGNED_OUT **TO** PREPARE **WHEN** Sign In is selected - `inst-prepare`
2. [ ] - `p1` - **FROM** PREPARE **TO** INSTALLING **WHEN** Install is chosen; successful job and prepare return to PREPARE - `inst-install`
3. [ ] - `p1` - **FROM** PREPARE **TO** BROWSER **WHEN** a guarded sign-in starts; use-existing success skips to CHECK or USE according to returned evidence - `inst-browser`
4. [ ] - `p1` - **FROM** BROWSER **TO** BROWSER_HIDDEN **WHEN** Esc hides the sheet; Show returns to BROWSER - `inst-hide`
5. [ ] - `p1` - **FROM** BROWSER **TO** CHECK **WHEN** the matching progress confirms browser sign-in - `inst-check`
6. [ ] - `p1` - **FROM** CHECK **TO** USE **WHEN** checks complete and the account is confirmed signed in - `inst-use`
7. [ ] - `p1` - **FROM** USE **TO** SIGNED_IN **WHEN** Done, Not Now or successful agent binding closes the sheet - `inst-done`
8. [ ] - `p1` - **FROM** BROWSER **TO** SIGNIN_ERROR **WHEN** cancellation, timeout, ineligible plan or offline is reported; retry starts a new guarded session - `inst-error`
9. [ ] - `p1` - **FROM** SIGNED_IN **TO** EXPIRED **WHEN** the provider ends the session; Sign In Again returns to PREPARE - `inst-expired`
10. [ ] - `p1` - **FROM** SIGNED_IN **TO** SIGNED_OUT **WHEN** explicit sign-out succeeds - `inst-signout`
11. [ ] - `p1` - **FROM** KEY_DRAFT **TO** KEY_VERIFYING **WHEN** a nonblank key is submitted once - `inst-key-verify`
12. [ ] - `p1` - **FROM** KEY_VERIFYING **TO** KEY_INVALID **WHEN** the provider rejects it; corrected input returns to KEY_DRAFT - `inst-key-invalid`
13. [ ] - `p1` - **FROM** KEY_VERIFYING **TO** KEY_CONFIGURED **WHEN** api_key_set succeeds - `inst-key-configured`
14. [ ] - `p1` - **FROM** KEY_DRAFT **TO** KEYCHAIN_LOCKED **WHEN** the core reports keychain_locked; explicit recovery refreshes account state - `inst-locked`

## 5. Definitions of Done

### Credential rows and keys

- [ ] `p4` - **ID**: `cpt-noter-dod-ui-accounts-keys`

The system **MUST** share row/field forms between Settings and Assistants, permit paste, mask stored-key presence, report verification and Keychain failures, remove keys only after confirmation and keep setup finishable without an assistant.

**Implements**:
- `cpt-noter-flow-ui-accounts-key`
- `cpt-noter-state-ui-accounts-credentials`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `accounts_get` (M2), `api_key_set` (M2), `api_key_remove` (M3), `cli_install` (M3), `models_download`
- Tests: unit tests for secret-draft clearing, duplicate submission, failed verification and masking; conformance for rejected keys, removal and accounts versions; E2E `cpt-noter-seq-first-run-connect-assistant`, `cpt-noter-seq-settings-replace-api-key`, including rejected, locked, local-not-ready and no-assistant paths. In M2 the real-core E2E covers the key paths; the removal and local-not-ready paths join in M3

### Independent account sessions and explicit binding

- [ ] `p4` - **ID**: `cpt-noter-dod-ui-accounts-sign-in`

The system **MUST** implement all four steps for each provider, correlation, install, existing-account reuse, error recovery, hidden-sheet continuation, explicit agent binding, tests, task runtime settings and sign-out without handling passwords or tokens. Unsupported contract details remain listed below. `just gate` passes.

**Implements**:
- `cpt-noter-flow-ui-accounts-sign-in`
- `cpt-noter-flow-ui-accounts-manage`
- `cpt-noter-algo-ui-accounts-session`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `account_signin_prepare`, `cli_install`, `account_signin_start`, `account_signin_cancel`, `account_use_existing`, `account_bind_agents`, `account_test`, `account_sign_out`; shared settings (Runtime per task through `settings_update` from M2) and Undo
- Tests: unit tests for independent sessions, confirmation guard, expiry and late events; conformance for every account command, cancellation and sign-out flags; E2E `cpt-noter-seq-settings-sign-in-account` with both providers, all errors and M3-owned paths; M4 owns per-agent editor paths

**Completion gate**: `just gate` passes.

## 6. Acceptance Criteria

- [ ] Prototype `key-rejected`, `keychain-locked`, `local-not-ready`, field verification and Saved states match; secure fields never prefill a stored key
- [ ] All seven `ACCOUNT_STATES` render, as do intro, browser, checking, bind and four error sheets; simulated browser controls never enter product UI
- [ ] Claude personal-use confirmation gates both browser and existing-account paths; ChatGPT has no such checkbox
- [ ] Hiding a sheet keeps the session; Cancel stops it; account events in one window update all other open account rows
- [ ] VoiceOver reads provider/state and verification result without reading secure content; focus returns to the triggering row; German actions wrap below text

## 7. Additional Context

**Prototype reuse.** Rewrite `C.credentialRow` as CredentialRow, `C.accountRow` as AccountLoginRow and `sheetBody`/stepper as AccountSignInSheet in the dialog host. Reuse the `models` form from `50-e-5-settings.js` and `dlg-api-key` from `30-c-dialogs.js`. Port `.e-cred*`, `.st-*` from `50-e.css` and `.f-*` from `60-f.css` except `.f-sim*`, retaining component, primitive, variant, size, state, region and provider attributes. `state.auth`, fake paths/plans/codes, agent arrays, demo controls and timers are source of truth only.

**DESIGN versus prototype.** The prototype locks key actions while the Keychain is locked; follow it rather than the story's Replace-and-Save path during the lock. Its missing-model state detects Ollama and offers Download, whereas the story first offers Install Ollama; render each according to actual core state. Sign-out's primary/default action is Sign Out in the prototype, unlike destructive removal alerts whose default is Cancel; preserve the prototype alert variant.

**Contract and fake gaps.** No verify-only command exists: `api_key_set` verifies and stores at once. The Verify/Save separation therefore cannot promise that Cancel after Verify leaves the old key unchanged; the flow above explicitly treats Verify as storage and Save as dismissal. This needs owner resolution before matching that promise. `account_use_existing` carries no personal-use acknowledgment; enforce the UI guard, but core cannot verify it from that request. Recovering a signing-in row after full reload yields only a session id, not its URL/code/expiry; Show must not invent them. The Use sheet lacks a delivered agent-candidate list in AccountsView (it lists existing users only); Agents commands are M4. Preselecting unavailable candidates needs upstream data. `models_download` accepts only start/pause/resume/retry for setup model bundles, not a local runtime model id; the Qwen download action needs a defined core path and must not be presented as implemented by a speech-bundle download. Spend per week and detailed test-request latency in Check are not in AccountsView/progress. Do not copy fixture amounts or durations. The fake does not fully implement default-for-new-agents, sign-out fallback or also_in_cli effects; conformance must prove these against the real core.

**Milestone notes.** `accounts_get` and `api_key_set` are M2 (owner decision of 18 Oct; DECOMPOSITION.md § 1, discrepancy 9), so the API key and Runtime per task part ships in M2 and the post-call runtime can be configured from the app. M2 delivers `cpt-noter-flow-ui-accounts-key`, `cpt-noter-dod-ui-accounts-keys`, the key transitions of `cpt-noter-state-ui-accounts-credentials` and **Runtime per task** (steps 2 and 3 of `cpt-noter-flow-ui-accounts-manage`, `settings_update`) on the real core. In **Runtime per task** the account runtimes stay visible and disabled as not connected until M3. **Remove…** and **Install Ollama…** run on the fake core until their commands arrive in M3. In M2, **Your own accounts** shows its frame and says it arrives in M3, as Settings does for the panes it leaves to later features. The sign-in flow, the rest of the manage flow (Test and sign-out), the session algorithm and the stories stay M3; `cpt-noter-flow-ui-accounts-manage` and `cpt-noter-dod-ui-accounts-sign-in` are ticked in M3. The M3 stories contain agent quick fixes and per-agent runtime/model selection; the editor and `agent_update` are M4 under `cpt-noter-feature-ui-agents`. M3 delivers account rows, task choices and explicit binding, not a claim that those M4 paths passed.

**Not applicable.** OAuth protocol, plan verification, CLI installation implementation, Keychain encryption, network access, schema migrations and deployment are core/tool responsibilities. UI observes safe typed status, never stores the supplied key beyond the live field and never logs credentials or sign-in links.
