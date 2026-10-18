---
title: "Feature — Privacy audit and knowledge sources"
description: "Plain-word privacy audit with export, source status and management, and core-owned storage moves."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-privacy-sources
milestone: M3
---

# Feature: Privacy audit and knowledge sources

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Inspect and export what left this Mac](#inspect-and-export-what-left-this-mac)
  - [Add a folder or MCP source](#add-a-folder-or-mcp-source)
  - [Update, recover, revoke or remove a source](#update-recover-revoke-or-remove-a-source)
  - [Move local storage](#move-local-storage)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Render plain-word audit rows](#render-plain-word-audit-rows)
  - [Derive source status rows](#derive-source-status-rows)
- [4. States (CDSL)](#4-states-cdsl)
  - [Sources and audit reads](#sources-and-audit-reads)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Privacy audit and storage](#privacy-audit-and-storage)
  - [Source management and shared status rows](#source-management-and-shared-status-rows)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p4` - **ID**: `cpt-noter-featstatus-ui-privacy-sources`

## 1. Feature Context

- [ ] `p4` - `cpt-noter-feature-ui-privacy-sources`

### 1.1 Overview

Privacy explains what left this Mac, when, how much and where it went. Knowledge Sources adds folders or MCP servers and shows indexing, last sync, privacy, scope, failure and the next action in one status row.

### 1.2 Purpose

Fill the Settings Privacy audit frame, Knowledge Sources pane and source sheets/alerts, provide the shared status row, and bind Storage location to the draft storage move command.

**Requirements**: PRD › Security, privacy and permissions › Audit log; Feature specification › 7. Knowledge sources; 14. Settings › Storage location. The PRD has no requirement IDs.

**Principles**: follows Settings and dialogs; `cpt-noter-principle-degrade-visibly`, `cpt-noter-principle-core-owns-state`.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Inspects outbound text, exports the log and controls source access |
| Noter core (system) | Owns audit records, native panels, bookmarks, sync and removal |
| MCP source (external system) | Provides documents or live results under its own sign-in |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Knowledge sources; Audit log; Credentials; privacy modes
- **Design**: [DESIGN.md](../../DESIGN.md) › Settings — Privacy, General and Knowledge Sources; Component — Status row; source dialogs
- **Design elements**: `cpt-noter-component-ui-status-row`; uses `cpt-noter-component-screen-settings`, `cpt-noter-component-screen-dialogs` and the existing mode indicator
- **Stories (M3)**: `cpt-noter-seq-settings-check-privacy`, `cpt-noter-seq-settings-add-knowledge-source`
- **Frozen commands delivered (M3)**: `audit_list`, `audit_export`, `sources_list`, `source_add_folder`, `source_add_mcp`, `source_update`, `source_reindex`, `source_remove`, `source_revoke_token`
- **Draft command in M3**: `storage_move`; it is listed in milestones but is not a frozen command for the E2E denominator
- **Earlier commands reused**: `settings_get`, `permission_request`, `share_test_run` (M2), `open_external`, `update_install`; Settings owns their flows
- **Events**: `entity:changed` for sources; `jobs:progress` for accepted work; `settings:changed`, `privacy:changed`
- **Data**: core-owned `cpt-noter-dbtable-audit-log`, `cpt-noter-dbtable-sources`; no UI tables
- **Prototype modules**: `src/js/50-e-5-settings.js` (`privacy`, `knowledge`, `e-source`), `50-e-1-components.js` (`C.statusRow`), `30-c-dialogs.js` (`dlg-mcp`, `dlg-share-test`); `src/css/50-e.css`, `30-c.css`
- **Contract and test reference**: `apps/desktop/src/core/bindings.ts` and `apps/desktop/src/core/fake/` (read-only); [HARNESS.md](../../HARNESS.md); [DECOMPOSITION.md](../../DECOMPOSITION.md)
- **Dependencies**: `cpt-noter-feature-ui-settings`, `cpt-noter-feature-ui-dialogs-host`

## 2. Actor Flows (CDSL)

### Inspect and export what left this Mac

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-privacy-sources-audit`

**Actor**: Primary user

**Success Scenarios**:
- Call info privacy link opens Settings Privacy focused on that call; user reads rows and exports them through a save panel
- Empty log reads **Nothing has left this Mac.**, without claiming that a changed mode erases earlier requests

**Error Scenarios**:
- Failed page read keeps selected call/date and offers Try Again; cancelled export shows no success
- Selected-call export is not supported by the current export arguments; do not export all calls under a filtered label

**Steps**:
1. [ ] - `p1` - User opens Privacy or the Call info **What left this Mac: 3 requests · 41 KB** link; Settings receives the call id and focuses the audit frame - `inst-open`
2. [ ] - `p1` - API: `audit_list` with date bounds and first page; keep cursor and selected call as view state - `inst-read`
3. [ ] - `p1` - Algorithm: render rows through `cpt-noter-algo-ui-privacy-sources-audit-rows`; load more pages as needed and filter by returned call id, not title - `inst-rows`
4. [ ] - `p1` - **IF** the loaded range is empty - `inst-if-empty`
   1. [ ] - `p1` - UI: **Nothing has left this Mac.** only when the complete all-call range is empty; a selected-call empty range explains that no requests match this call - `inst-empty`
5. [ ] - `p1` - User chooses Export; API: `audit_export` with matching date bounds and supported log format, for the supported all-call range - `inst-export`
6. [ ] - `p1` - Core: show the native save panel; UI reports success from returned export path/files only, never from a cancelled panel - `inst-save-result`
7. [ ] - `p1` - User may open Screen Share Test; delegate to Settings' share-test flow with `share_test_run`, retaining the table and limits line during permission denial or capture failure - `inst-share-test`
8. [ ] - `p1` - **RETURN** Privacy with unchanged mode and filters - `inst-return-audit`

### Add a folder or MCP source

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-privacy-sources-add`

**Actor**: Primary user

**Success Scenarios**:
- Add Folder, choose privacy/scope, observe indexing and the finished document count
- Add an indexed or live MCP source, with the live-only-in-Cloud-allowed consequence visible before confirmation

**Error Scenarios**:
- No sources: **No knowledge sources yet** and Add Folder; cancelled picker adds nothing
- Missing server or duplicate source: field error, draft retained; offline/auth failures stay on the source with their fix

**Steps**:
1. [ ] - `p1` - User opens Knowledge Sources; API: `sources_list`; UI shows source status rows or its first-use empty state - `inst-list`
2. [ ] - `p1` - User chooses + › Add Folder; UI opens the 520-pt source form with Indexed, On change, Normal and all-calls scope defaults - `inst-folder-form`
3. [ ] - `p1` - User sets supported privacy and call scope and chooses Add Source; API: `source_add_folder` with no path so the core grants access through the native folder picker - `inst-add-folder`
4. [ ] - `p1` - **IF** a source is returned - `inst-if-created`
   1. [ ] - `p1` - UI: close the sheet and insert the returned row; indexing progress comes from the core, not the prototype timer - `inst-folder-row`
5. [ ] - `p1` - User instead chooses Add MCP Server; UI opens `dlg-mcp` with Server, Mode, Schedule, Privacy class and Scope - `inst-mcp-form`
6. [ ] - `p1` - UI: Live explains read-after-calls/in-Ask, no copied content, Cloud allowed only and logged lookups; Indexed explains local indexing and browser sign-in - `inst-mode-consequences`
7. [ ] - `p1` - User confirms; API: `source_add_mcp` with server, mode, schedule, privacy and structured source scope - `inst-add-mcp`
8. [ ] - `p1` - UI: use source responses and entity events for progress, count, last sync and failure; display Sensitive as local-model-only - `inst-progress`
9. [ ] - `p1` - **RETURN** the source list; source documents appear in Library and Ask only when the core returns them - `inst-return-add`

### Update, recover, revoke or remove a source

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-privacy-sources-manage`

**Actor**: Primary user

**Success Scenarios**:
- Details changes name, schedule, privacy and scope; re-index runs once and updates the row
- Confirmed Remove drops a source from search/answers while leaving the source system unchanged

**Error Scenarios**:
- Folder missing: Failed, Locate and Try Again; expired indexed sign-in: last sync and Sign In Again
- Revision conflict keeps draft; removal/revocation failure keeps the original source and offers explicit recovery
- Locate and reauthentication lack command support; do not fake a repaired source

**Steps**:
1. [ ] - `p1` - User presses Return or Details on a row; UI opens the source sheet with actual mode, schedule, privacy, scope and token presence - `inst-details`
2. [ ] - `p1` - User changes supported fields; API: `source_update` with source id, `rev` and desired fields; apply the returned row only after success - `inst-update`
3. [ ] - `p1` - **IF** the core reports conflict - `inst-if-conflict`
   1. [ ] - `p1` - Refresh `sources_list`, keep draft for review against the current source, and require an explicit new save - `inst-conflict`
4. [ ] - `p1` - User chooses Re-index or Try Again; API: `source_reindex` with source id; disable duplicate run actions while indexing and consume updated source state - `inst-reindex`
5. [ ] - `p1` - **IF** folder location or sign-in is invalid - `inst-if-recovery`
   1. [ ] - `p1` - UI: show Locate or Sign In Again with its reason and last sync; these actions require the missing core recovery path listed below, never a timer that clears the error - `inst-recovery-gap`
6. [ ] - `p1` - User chooses Revoke Token on a source with `has_token`; native alert explains sync stops until sign-in, Cancel default - `inst-revoke-alert`
7. [ ] - `p1` - On confirmation API: `source_revoke_token`; render returned status/token presence; no token reaches the WebView - `inst-revoke`
8. [ ] - `p1` - User chooses Remove Source; native alert names the source and indexed document count and says nothing in the original system changes - `inst-remove-alert`
9. [ ] - `p1` - On confirmation API: `source_remove`; after success remove the row and close its sheet; library/thread views invalidate removed-source links from core data - `inst-remove`
10. [ ] - `p1` - **RETURN** the source list with the core's result - `inst-return-manage`

### Move local storage

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-privacy-sources-storage`

**Actor**: Primary user

**Success Scenarios**:
- General › Storage location › Change chooses a local folder, starts a move and displays the confirmed path after completion

**Error Scenarios**:
- Cloud folder: **This folder is in iCloud Drive, so your recordings sync off this Mac. Choose a local folder.**; Dropbox uses the matching provider name
- Cancel or failed move keeps the previous path; no UI filesystem operations

**Steps**:
1. [ ] - `p1` - User chooses Change on General Storage location - `inst-change`
2. [ ] - `p1` - API: draft `storage_move` with no path; the core owns the native open panel, location checks and move - `inst-move`
3. [ ] - `p1` - **IF** the core reports `storage_in_cloud_folder` - `inst-if-cloud`
   1. [ ] - `p1` - UI: show the warning under the path and keep Change available; do not show a completed move - `inst-warning`
4. [ ] - `p1` - **ELSE** retain the accepted job id and observe matching job progress; refresh settings after completion, never replacing the path on job acceptance alone - `inst-job`
5. [ ] - `p1` - **RETURN** General with the confirmed location or explicit error - `inst-return-storage`

## 3. Processes / Business Logic (CDSL)

### Render plain-word audit rows

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-privacy-sources-audit-rows`

**Input**: paged AuditEntry records, date bounds, optional call id and interface locale

**Output**: Time, What, Size, Destination rows and truthful counts

**Steps**:
1. [ ] - `p1` - Keep each audit id once across pages; retain order from the core and apply selected-call filtering to every page - `inst-page`
2. [ ] - `p1` - Map `what` to plain text such as transcript, summary text, document excerpts or live lookup; include known call title, localized time, bytes and destination - `inst-words`
3. [ ] - `p1` - Preserve run versus tool-result versus lookup identity; do not count three tool results as one outbound request or sum only visible rows as the total range - `inst-counts`
4. [ ] - `p1` - Show redaction state from the record; the current mode never rewrites historical rows - `inst-redaction`
5. [ ] - `p1` - **RETURN** rows with no request payload, audio, secret or invented provider; incomplete reads cannot assert nothing left the Mac - `inst-return`

### Derive source status rows

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-privacy-sources-status`

**Input**: SourceRow, effective privacy mode and correlated work progress; shared row variant

**Output**: status word/icon, subtitle, progress and allowed actions

**Steps**:
1. [ ] - `p1` - Map idle to Up to date, indexing to Running with returned done/total, failed to Failed with a safe error/fix, sign_in_expired to Sign-in expired - `inst-map`
2. [ ] - `p1` - Keep count and last sync from the core; unknown total uses indeterminate progress, never a fake percentage - `inst-progress`
3. [ ] - `p1` - For Live sources outside Cloud allowed show **Live lookups paused · they run only in Cloud allowed**; Sensitive always explains local-model-only use - `inst-privacy`
4. [ ] - `p1` - Show token revocation only when a token exists; disable duplicate work controls while indexing; do not offer a source mode change as a supported update - `inst-actions`
5. [ ] - `p1` - Announce a visible finish/failure once, not progress increments; status always has both icon and word - `inst-announce`
6. [ ] - `p1` - **RETURN** the status row; shared job, evidence, runtime, model and share-test variants keep their own actions and state rules from DESIGN - `inst-return`

## 4. States (CDSL)

### Sources and audit reads

- [ ] `p1` - **ID**: `cpt-noter-state-ui-privacy-sources-view`

**States**: LOADING, AUDIT_ROWS, AUDIT_EMPTY, SOURCES_EMPTY, SOURCE_IDLE, SOURCE_INDEXING, SOURCE_FAILED, SOURCE_EXPIRED, DETAILS, REMOVE_ASKED, REVOKE_ASKED, ERROR

**Initial State**: LOADING

**Transitions**:
1. [ ] - `p1` - **FROM** LOADING **TO** AUDIT_ROWS **WHEN** a page contains audit rows; complete empty range uses AUDIT_EMPTY - `inst-audit`
2. [ ] - `p1` - **FROM** LOADING **TO** SOURCES_EMPTY **WHEN** sources_list returns no sources - `inst-empty`
3. [ ] - `p1` - **FROM** SOURCES_EMPTY **TO** SOURCE_INDEXING **WHEN** a folder was added and the core reports indexing - `inst-add`
4. [ ] - `p1` - **FROM** SOURCE_INDEXING **TO** SOURCE_IDLE **WHEN** the core confirms sync success - `inst-indexed`
5. [ ] - `p1` - **FROM** SOURCE_INDEXING **TO** SOURCE_FAILED **WHEN** the core reports a failure; explicit retry returns to SOURCE_INDEXING - `inst-failed`
6. [ ] - `p1` - **FROM** SOURCE_IDLE **TO** SOURCE_EXPIRED **WHEN** sign-in expiry or confirmed token revocation is reported - `inst-expired`
7. [ ] - `p1` - **FROM** SOURCE_IDLE **TO** DETAILS **WHEN** the user opens the source; error and expired rows may also open DETAILS - `inst-details`
8. [ ] - `p1` - **FROM** DETAILS **TO** REMOVE_ASKED **WHEN** Remove Source is chosen; Cancel restores DETAILS, confirmed success returns to the list - `inst-remove`
9. [ ] - `p1` - **FROM** DETAILS **TO** REVOKE_ASKED **WHEN** Revoke Token is chosen; success restores DETAILS with no token - `inst-revoke`
10. [ ] - `p1` - **FROM** LOADING **TO** ERROR **WHEN** a read fails; Try Again repeats the same read - `inst-error`

## 5. Definitions of Done

### Privacy audit and storage

- [ ] `p4` - **ID**: `cpt-noter-dod-ui-privacy-sources-audit`

The system **MUST** render plain-word audit pages with honest range/call filtering, supported exports and safe empty states, delegate Screen Share Test and Updates to Settings, and reflect a storage move only after core confirmation.

**Implements**:
- `cpt-noter-flow-ui-privacy-sources-audit`
- `cpt-noter-flow-ui-privacy-sources-storage`
- `cpt-noter-algo-ui-privacy-sources-audit-rows`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-share-exclusion-limits`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `audit_list`, `audit_export`, draft `storage_move`; shared `share_test_run`, `update_install`
- Tests: unit tests for paging, late reads, filter ids, byte formatting and partial-range emptiness; conformance for export cancellation, cloud-folder rejection and move acceptance/completion; E2E `cpt-noter-seq-settings-check-privacy`, including share-test permission/failure and existing Updates paths, with filtered-export gap reported

### Source management and shared status rows

- [ ] `p4` - **ID**: `cpt-noter-dod-ui-privacy-sources-sources`

The system **MUST** provide source add/details, supported updates, re-index, confirmed revocation/removal and all status-row variants from core data, keep privacy consequences visible and surface unsupported recovery operations as contract gaps. Maintenance job management is M5. `just gate` passes.

**Implements**:
- `cpt-noter-flow-ui-privacy-sources-add`
- `cpt-noter-flow-ui-privacy-sources-manage`
- `cpt-noter-algo-ui-privacy-sources-status`
- `cpt-noter-state-ui-privacy-sources-view`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `sources_list`, `source_add_folder`, `source_add_mcp`, `source_update`, `source_reindex`, `source_remove`, `source_revoke_token`
- Tests: unit tests for status precedence, unknown totals, privacy labels, draft conflicts and alert focus; conformance for source revisions, token presence, removal and progress; E2E `cpt-noter-seq-settings-add-knowledge-source` against the real core, with missing recovery paths reported

**Completion gate**: `just gate` passes.

## 6. Acceptance Criteria

- [ ] `nothing-left`, `no-sources`, `source-failed`, `sign-in-expired`, add/indexing, details and remove/revoke states match prototype screenshots
- [ ] All six StatusRow variants keep the prototype's structure, status word/icon, truncation/help tags and wrapped actions below 600-pt pane width
- [ ] Sensitive and Live consequences remain visible in all modes; the UI never reads or stores a source token
- [ ] Failed writes keep drafts and current rows; repeated activation cannot start duplicate indexing or removal
- [ ] Fake-core visuals do not count as E2E proof; frozen successful commands and passing story-named tests against the real core count as HARNESS defines

## 7. Additional Context

**Prototype reuse.** Rewrite `privacy` audit and `knowledge` in `50-e-5-settings.js` as PrivacyAudit and KnowledgeSourcesPane; `e-source` becomes SourceDetailsSheet; `dlg-mcp` in `30-c-dialogs.js` becomes AddMcpSourceSheet. `C.statusRow` in `50-e-1-components.js` becomes StatusRow shared by sources, runtimes, models, jobs, evidence and share results. Port `.st-*` and `.e-status*` in `50-e.css` and required `.dlg-*` in `30-c.css` as-is with component, primitive, variant, size, state and region attributes. Native panels and alerts are platform surfaces; the prototype is their content/behaviour reference. Timers, sample counts, ST local maps and simulated panel messages are not ported.

**DESIGN versus prototype.** Prototype Privacy places Export beside the call filter above the table; the story says below. Follow the prototype. Its Add Folder source sheet offers Live and editable schedules, and its Scope is free text with **All files, Markdown and PDF**; the contract's folder is indexed/watched and scope is structured call types/people. Preserve form styling, but do not send fictional fields. The prototype has source, runtime, model and job examples but no dedicated indexing State-menu entry; the Add Source interaction supplies that visual state. DESIGN's 820-pt Settings frame differs from the renderer's 860-pt width; this feature reuses the Settings shell and records the discrepancy without changing it.

**Contract and fake gaps.** Audit list/export accept time bounds but no call id, and export formats are the contract's log formats, not the prototype's CSV. Filtering all loaded pages can render a selected call, but cannot guarantee a selected-call export: that part of the story needs contract support. `source_add_folder` opens the picker as part of creation, with no read-only preflight returning a path/file count before confirmation; the prototype's picker-then-preview order cannot be reproduced without a contract change. `source_update` cannot change path or mode. No source reauthentication/Locate command, authentication URL or server-specific content scope exists; `source_reindex` must not be treated as a browser sign-in. The MCP picker also has no server-discovery command. These prevent full Locate/Sign In Again and source scope paths. Default fake audit ignores call filtering, source add stays indexing until scripted, and update/revoke effects are limited; use typed scenario overrides and real-core conformance. Draft storage_move returns a job id but no complete move contract; do not count it as frozen coverage or manufacture the final path.

**Milestone notes.** Screen Share Test is M2 though its privacy story is M3; Updates is M0. Activity › Needs attention and maintenance jobs are M5 under `cpt-noter-feature-ui-activity`; M3 supports incoming source deep links and row fixes, not the later Activity page.

**Not applicable.** Outbound request auditing, redaction, OAuth, filesystem moves, security-scoped bookmarks, document parsing, database transactions, indexing and deployment run in the core. UI status changes neither source privacy enforcement nor the audit record; error logging excludes payloads, secrets and document text.
