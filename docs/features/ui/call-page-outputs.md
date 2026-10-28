---
title: "Feature — Call page outputs and sharing"
description: "Read outputs as they arrive, preserve edits across regeneration, compare versions and share a visible scope."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-call-page-outputs
milestone: M2
---

# Feature: Call page outputs and sharing

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Read and correct outputs](#read-and-correct-outputs)
  - [Regenerate and compare versions](#regenerate-and-compare-versions)
  - [Copy or export a visible scope](#copy-or-export-a-visible-scope)
  - [Maintain tags and stored audio](#maintain-tags-and-stored-audio)
  - [Open ready or failed outputs from a notification](#open-ready-or-failed-outputs-from-a-notification)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Project section progress and sharing scope](#project-section-progress-and-sharing-scope)
- [4. States (CDSL)](#4-states-cdsl)
  - [Output section](#output-section)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Sections, edits, regeneration and versions](#sections-edits-regeneration-and-versions)
  - [Sharing, tags, audio and notification routing](#sharing-tags-audio-and-notification-routing)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p3` - **ID**: `cpt-noter-featstatus-ui-call-page-outputs`

## 1. Feature Context

- [ ] `p3` - `cpt-noter-feature-ui-call-page-outputs`

### 1.1 Overview

Add Summary and its output sections to the M1 Call page, with inline edits, regeneration, versions, diffs and scoped copy/export. Call info gains tags and audio deletion. NT-1 and NT-2 can now open useful outputs; notification permission and send rules remain with the M1 notifications feature. Agent Reviews content ships in M4, and the frame still owns routing and stored playback.

### 1.2 Purpose

It implements `cpt-noter-component-ui-output-section`, `cpt-noter-component-ui-output-item-row`, `cpt-noter-component-ui-share-menu`, `cpt-noter-component-ui-version-switcher` and `cpt-noter-component-ui-diff-view`.

**Requirements**: PRD › Feature specification › 4. Post-call outputs, 6. Integrations and 11. Versions; Security, privacy and permissions › Deletion. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-core-owns-state`, `cpt-noter-principle-evidence-one-click`, `cpt-noter-principle-degrade-visibly`, `cpt-noter-principle-undo-over-confirm`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Reads, edits, regenerates, compares, copies, exports, tags and deletes audio |
| Noter core (system) | Writes and versions outputs, formats clipboard text, exports files and deletes audio |
| macOS (system) | Shows notifications, delete alerts and save panels |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 4 and 6
- **Design**: [DESIGN.md](../../DESIGN.md) › Call page PC-R2/PC-R3; Output section; Output item row; Share menu; Version switcher; Diff view; Dialogs; Notifications
- **Decomposition**: [DECOMPOSITION.md](../../DECOMPOSITION.md) › 2.18, M2, NOT_STARTED
- **Design elements**: the five components above; integrates `cpt-noter-component-screen-call-page`
- **Stories**: `cpt-noter-seq-call-page-review-outputs`, `cpt-noter-seq-call-page-share-outputs`, `cpt-noter-seq-notifications-open-outputs` (M2, every path); History owns the log subflows of review-outputs
- **Frozen commands it delivers (M2)**: `outputs_get`, `output_edit`, `outputs_regenerate`, `output_versions`, `output_version_get`, `share_copy`, `calls_export`, `call_tags_set`, `tags_list`, `audio_delete`, `audio_delete_older`
- **Other commands it calls**: `open_external` for Show in Finder; `item_create` and review commands through Items; History commands through History
- **Events**: `outputs:progress`, `entity:changed`, `nav:request`, `capture:state`
- **Contract**: `apps/desktop/src/core/bindings.ts` › CallOutputs, OutputSection, SectionState, RegenerateArgs, ShareScope, VersionBody, ExportResult; `apps/desktop/src/core/fake/handlers.ts` and `fake-core.ts`
- **Prototype modules**: `src/js/30-c-0-components.js`, `src/js/30-c-callpage.js`, `src/js/30-c-dialogs.js` › `dlg-export`, `dlg-regenerate`, `dlg-delete-old-audio`; `src/js/10-a-surfaces.js` › `NT_STATES`; `.pc-sec*`, `.pc-share*`, `.pc-ver*`, `.pc-diff*`, `.dlg-*`
- **Dependencies**: `cpt-noter-feature-ui-call-page-frame`, `cpt-noter-feature-ui-items`, `cpt-noter-feature-ui-history-undo`; notification delivery reuses `cpt-noter-feature-ui-notifications`

## 2. Actor Flows (CDSL)

### Read and correct outputs

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-page-outputs-read-edit`

**Actor**: Primary user

**Success Scenarios**:
- Summary shows **Summary · English · Claude Code · 1 min 40 s after the call**, then Decisions, Action items, Open questions and Per participant.
- Edit → ⌘Return saves the correction, **Edited** and **Your Edit · 11:20**.

**Error Scenarios**:
- Writing: **Writing summary… 1 min 10 s**, then **Waiting for the summary**; Read Transcript remains available.
- A failed section keeps other sections usable and offers **Try Again** and **Use Local Model**.
- Empty Decisions, Action items and Open questions name their emptiness; Add Action Item delegates to Items; Risks is omitted when empty.

**Steps**:
1. [ ] - `p1` - User opens Summary; API: `outputs_get` with call id; mount sections from typed states and refresh on matching progress events - `inst-get`
2. [ ] - `p1` - While writing, show **Writing the outputs · the transcript is ready to read** with **Read Transcript**; local writing says **Writing with the local model · up to 10 min · role reviews follow in the background** - `inst-writing`
3. [ ] - `p1` - Render ready sections immediately in PRD order, preserving failed or waiting neighbours; mount action and output rows with the shared Items review actions - `inst-sections`
4. [ ] - `p1` - User chooses Edit on prose; keep a draft with base summary id and rev; show **⌘Return saves · Esc cancels**, Cancel and Save - `inst-edit`
5. [ ] - `p1` - **IF** Esc or Cancel: discard only the draft and **RETURN** the persisted text - `inst-cancel`
6. [ ] - `p1` - Save or ⌘Return calls `output_edit` with call id, summary id, base rev and Markdown; raw HTML is never rendered - `inst-save`
7. [ ] - `p1` - **IF** conflict or validation error: keep the draft, refresh current output and show the error; require an explicit new save - `inst-error`
8. [ ] - `p1` - **ELSE** render the returned section, Edited badge, refreshed version list and **Saved** for 2 s - `inst-saved`
9. [ ] - `p1` - **RETURN** readable outputs with each item's evidence one action away - `inst-return`

### Regenerate and compare versions

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-page-outputs-regenerate`

**Actor**: Primary user

**Success Scenarios**:
- Regenerate with current settings, a different model or the local model; old text stays readable under **Regenerating…**.
- **Regenerated · your 2 edits kept · Show Diff**; Compare toggles **v1 → Your Edit** without replacing the saved edit.

**Error Scenarios**:
- `job_blocked` during capture: explain regeneration waits for the call to end; no timer retry.
- A failed runtime leaves old output and offers explicit retry/local fallback.

**Steps**:
1. [ ] - `p1` - User chooses **Regenerate Outputs…**, **With a Different Model…** or **Regenerate with Claude Code…**; dialog host shows Runtime and model, Skill, Sections and **Your edits are kept and shown as a diff.** - `inst-sheet`
2. [ ] - `p1` - User selects at least one section; API: `outputs_regenerate` with selected SectionKind values, runtime/model, call-type skill and local flag; **With Current Settings** sends current defaults - `inst-call`
3. [ ] - `p1` - A section's Try Again requests that section only; Use Local Model sets local true and later shows **Written by the local model after Claude Code timed out** - `inst-section`
4. [ ] - `p1` - Accept the job id as scheduled work, not completion; keep previous content while matching `outputs:progress` updates it; refetch `outputs_get` for final bodies - `inst-job`
5. [ ] - `p1` - Core keeps user prose edits and accepted/edited items, replaces only remaining suggestions and preserves rejected suppression; UI renders the returned notices and counts - `inst-preserve`
6. [ ] - `p1` - User opens the version menu; `output_versions` lists generated and user versions with writer/time; hide the switcher with only one version - `inst-versions`
7. [ ] - `p1` - User selects a version; `output_version_get` returns its body for read-only inspection; selecting it never writes it over the current edit - `inst-version`
8. [ ] - `p1` - User toggles Compare or Show Diff; fetch the two required bodies, show word changes with insertions underlined and deletions struck through, fold long unchanged stretches - `inst-diff`
9. [ ] - `p1` - **IF** version read fails: keep current prose and the chosen edit; show retry beside the version control - `inst-error`
10. [ ] - `p1` - **RETURN** plain text again on Compare or Hide Diff; History opens the reusable timeline and Export Log flow - `inst-return`

### Copy or export a visible scope

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-page-outputs-share`

**Actor**: Primary user

**Success Scenarios**:
- Share → Copy for Slack, Copy for Jira or Copy as Markdown uses the visible Whole call, section, selected-items or row scope.
- Export offers Summary and items checked, Transcript unchecked, Audio only while kept; the core save panel writes the chosen folder.

**Error Scenarios**:
- Nothing ready: **Nothing to share yet: outputs are being written**, copy actions disabled.
- Suggestions: **Includes 3 suggested items not reviewed yet**; rejected items are never included.
- Sensitive call: **Sensitive call · copying puts the text on your clipboard**; Slack/Jira success reads **Copied**.

**Steps**:
1. [ ] - `p1` - User opens Share or invokes ⌘⇧C, ⌥⌘C, ⌥⇧⌘C or ⌘E; resolve scope from the invoking control and current row selection - `inst-scope`
2. [ ] - `p1` - Show the scope first, then unreviewed/sensitive notices, three copy formats and Export; keep normal ⌘C as standard text copy - `inst-menu`
3. [ ] - `p1` - User copies; API: `share_copy` with call id, scope and format; set include_unreviewed only when the shown scope notice makes their inclusion explicit - `inst-copy`
4. [ ] - `p1` - **IF** `unreviewed_in_scope`: keep the scope, show its notice and offer Start Review through Items; never silently change the requested inclusion - `inst-review`
5. [ ] - `p1` - **IF** copy succeeds: core writes rich and plain clipboard formats; show **Copied for Slack**, **Copied for Jira** or **Copied as Markdown** on the invoking control for 2 s, announced politely - `inst-copied`
6. [ ] - `p1` - User exports; open Export with its scope, require at least one content checkbox; call `calls_export` with call_ids, include options and scope, or null scope for whole call - `inst-export`
7. [ ] - `p1` - **IF** save panel is cancelled: **RETURN** no exported status; **IF** export fails: retain options and show retry - `inst-cancel`
8. [ ] - `p1` - **RETURN** **Exported to** the returned Finder-style path with **Show in Finder** for 8 s; `open_external` reveals that path - `inst-return`

### Maintain tags and stored audio

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-page-outputs-tags-audio`

**Actor**: Primary user

**Success Scenarios**:
- Tags add with Return or comma, remove with × or Backspace at the start, with **Added “release” · Undo** for 10 s.
- Delete Audio Now removes only audio; Delete Old Audio frees older calls' audio while capture continues.

**Error Scenarios**:
- Duplicate or over-32-character tags are rejected inline. Deletion failure leaves audio controls tied to core availability.
- Both destructive actions require their designed alert/sheet; neither offers Undo.

**Steps**:
1. [ ] - `p1` - Read `tags_list` for suggestions from tags in use; trim additions, reject empty, duplicate ignoring case and overlong values and keep each tag's script - `inst-tags`
2. [ ] - `p1` - Submit `call_tags_set` with selected call ids and the typed add/remove lists; show returned change or batch target, then refresh Call info - `inst-set`
3. [ ] - `p1` - User chooses **Delete Audio Now…**; native alert **Delete the audio of this call?** explains transcript, summary and items stay, replay stops, and it cannot be undone; Cancel is default - `inst-alert`
4. [ ] - `p1` - **IF** Delete Audio is confirmed: `audio_delete` with the call id; use core audio state to stop playback and remove play, sample and export-audio controls - `inst-delete`
5. [ ] - `p1` - User opens **Delete Old Audio…** from the capture/disk warning; main-window dialog host shows the 30-day choice and **Recording goes on while this runs.** - `inst-old`
6. [ ] - `p1` - **IF** Delete Audio is confirmed: `audio_delete_older` with older_than_days 30; show returned call count and freed MB, never prototype fixture totals - `inst-delete-old`
7. [ ] - `p1` - User fills the sheet and presses the primary button; the dialogs host keeps the button busy with its label while the command runs (from `cpt-noter-flow-ui-dialogs-host-sheet`, owner decision A, 28 Oct 2026) - `inst-sheet-submit`
8. [ ] - `p1` - **IF** the command fails with invalid input: focus moves to the first invalid field with its message under it; a resubmit runs the command again - `inst-sheet-invalid`
9. [ ] - `p1` - **RETURN** the sheet closed on success with the result shown where it applies; other errors show as a sheet banner - `inst-sheet-return`
10. [ ] - `p1` - **RETURN** refreshed audio retention/deletion text with transcripts and outputs still usable; cancelled alerts send no deletion command - `inst-return`

### Open ready or failed outputs from a notification

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-call-page-outputs-notification`

**Actor**: Primary user

**Success Scenarios**:
- Summary ready click opens that call's Summary; failure click opens the failed section with Try Again.

**Error Scenarios**:
- Frontmost page already shows the call: no notification, one polite **Summary ready** announcement.
- Next call recording: ready/failed notifications wait until stop, one thread per call; presenting rules remain with Notifications.

**Steps**:
1. [ ] - `p1` - Core applies the existing notification send rules and posts NT-1 or NT-2 after outputs settle - `inst-send`
2. [ ] - `p1` - User clicks it; consume `nav:request` for call_page and Summary through the shell; `outputs_get` loads that call - `inst-route`
3. [ ] - `p1` - **IF** failed: show the failed section and invoke the section retry flow only when the user clicks Try Again - `inst-failed`
4. [ ] - `p1` - **IF** the page is already visible when outputs finish: announce Summary ready once, without duplicate toast or notification - `inst-visible`
5. [ ] - `p1` - **RETURN** the requested outputs, or the frame's not-found state if the call was deleted - `inst-return`

## 3. Processes / Business Logic (CDSL)

### Project section progress and sharing scope

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-call-page-outputs-project`

**Input**: CallOutputs, matching progress events, selected ids, invocation origin and readiness

**Output**: Ordered sections, counts, notices and ShareScope

**Steps**:
1. [ ] - `p1` - Keep Summary, Decisions, Action items, Open questions, Per participant, optional Risks, call-type extras and Marked moments in their defined order; role reviews use the separate M4 view - `inst-order`
2. [ ] - `p1` - Apply progress only to its call and section; hydrate bodies with outputs_get and ignore reads superseded by navigation or newer state - `inst-progress`
3. [ ] - `p1` - Count only visible non-rejected rows; review counts include suggestions only; hide review controls while still writing or when none remain - `inst-count`
4. [ ] - `p1` - Resolve invocation scope: section means its SectionKind; row means its id or the selection containing it; toolbar means selected ids or Whole call - `inst-scope`
5. [ ] - `p1` - Remove stale/deleted/rejected ids from the selection and name the remaining scope; do not silently broaden an emptied selection to Whole call - `inst-selection`
6. [ ] - `p1` - **RETURN** the scope and current readiness; core remains responsible for filtering rejected items and formatting the clipboard - `inst-return`

## 4. States (CDSL)

### Output section

- [ ] `p1` - **ID**: `cpt-noter-state-ui-call-page-outputs-section`

**States**: WAITING, WRITING, STREAMING, READY, EMPTY, EDITING, SAVING, REGENERATING, COMPARING, FAILED

**Initial State**: The core section state, or WAITING before its first read

**Transitions**:
1. [ ] - `p1` - **FROM** WAITING **TO** WRITING **WHEN** matching progress starts that section - `inst-start`
2. [ ] - `p1` - **FROM** WRITING **TO** STREAMING **WHEN** partial text becomes available - `inst-stream`
3. [ ] - `p1` - **FROM** WRITING, STREAMING, REGENERATING **TO** READY, EMPTY **WHEN** the core completes with content or no items - `inst-ready`
4. [ ] - `p1` - **FROM** WRITING, STREAMING, REGENERATING **TO** FAILED **WHEN** the section fails; retain prior text - `inst-failed`
5. [ ] - `p1` - **FROM** READY **TO** EDITING **WHEN** Edit starts a draft - `inst-edit`
6. [ ] - `p1` - **FROM** EDITING **TO** READY **WHEN** Cancel or Esc discards it - `inst-cancel`
7. [ ] - `p1` - **FROM** EDITING **TO** SAVING **WHEN** Save submits the draft - `inst-save`
8. [ ] - `p1` - **FROM** SAVING **TO** READY **WHEN** save succeeds with a new rev and Edited badge - `inst-saved`
9. [ ] - `p1` - **FROM** SAVING **TO** EDITING **WHEN** save fails or conflicts; keep the draft - `inst-save-error`
10. [ ] - `p1` - **FROM** READY, EMPTY, FAILED **TO** REGENERATING **WHEN** a regeneration request is accepted - `inst-regen`
11. [ ] - `p1` - **FROM** READY **TO** COMPARING **WHEN** both comparison bodies load - `inst-compare`
12. [ ] - `p1` - **FROM** COMPARING **TO** READY **WHEN** Compare or Hide Diff is chosen again - `inst-hide`

## 5. Definitions of Done

### Sections, edits, regeneration and versions

- [ ] `p3` - **ID**: `cpt-noter-dod-ui-call-page-outputs-content`

The system **MUST** render ordered sections and output rows from typed core views, preserve independent section failures and readable old content, save drafts with revision checks and compare versions without overwriting edits. Shared diff rendering handles no differences, folded unchanged stretches, transcript marks and before/after sheets.

**Implements**:
- `cpt-noter-flow-ui-call-page-outputs-read-edit`
- `cpt-noter-flow-ui-call-page-outputs-regenerate`
- `cpt-noter-algo-ui-call-page-outputs-project`
- `cpt-noter-state-ui-call-page-outputs-section`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `outputs_get`, `output_edit`, `outputs_regenerate`, `output_versions`, `output_version_get`
- Tests: unit ordering, stale progress, draft/conflict, version and diff-fold cases; conformance each command, job_blocked and edit/suppression preservation; real-core E2E `cpt-noter-seq-call-page-review-outputs` (all paths, History delegated); screenshots writing, local, failed, empty, edited, regenerating and comparing

### Sharing, tags, audio and notification routing

- [ ] `p3` - **ID**: `cpt-noter-dod-ui-call-page-outputs-actions`

The system **MUST** show the exact copy/export scope and review/privacy notice, format through the core, use native save/delete surfaces, retain text evidence after audio deletion, and open ready/failed Summary from native notifications.

**Implements**:
- `cpt-noter-flow-ui-call-page-outputs-share`
- `cpt-noter-flow-ui-call-page-outputs-tags-audio`
- `cpt-noter-flow-ui-call-page-outputs-notification`

**Constraints**: `cpt-noter-constraint-local-only-ui`, `cpt-noter-constraint-notification-limits`

**Touches**:
- Commands: `share_copy`, `calls_export`, `tags_list`, `call_tags_set`, `audio_delete`, `audio_delete_older`, `open_external`
- Tests: unit scope, selection, tag validation and feedback timers; conformance rejection filtering, partial readiness, formats, cancellation and retained transcripts; E2E `cpt-noter-seq-call-page-share-outputs` (every path), `cpt-noter-seq-notifications-open-outputs` (every path); XCUITest `test_cpt_noter_seq_notifications_open_outputs` and native save/delete paths; M2 extension of disk-full paths in `cpt-noter-seq-record-prompt-start-recording` and `cpt-noter-seq-call-screen-recover-capture`

**Completion gate.** Write failing tests first; unit and changed-line coverage meet 80% per side. Conformance runs fake and real; E2E counts only successful frozen commands and named stories against real core toward 60%. Screenshots meet 98%; due performance scenarios meet 60% coverage and stay within 10% of base instruction counts. Trace never falls. `just gate-fast` stays green; `just gate` passes.

## 6. Acceptance Criteria

- [ ] Ready sections remain usable when another fails; old prose stays readable during regeneration
- [ ] Save retains user edits as a version; regeneration and naming preserve them and rejected suppression
- [ ] Copy and export act only on the displayed scope, exclude rejected items and show unreviewed/sensitive notices
- [ ] No success feedback follows a failed or cancelled copy/export/delete
- [ ] Audio deletion preserves transcript, summary and items, removes replay and reports real freed-space totals
- [ ] Notification clicks open Summary, visible pages announce readiness once, and live-call notifications wait

## 7. Additional Context

**Prototype reuse.** Rewrite `C.outputSection`, `C.outputItemRow`, `C.shareMenu`, `C.versionSwitcher` and `C.diffView` as matching React components, plus the Summary view and tag field in `30-c-callpage.js`. Port Group C styles and shared tokens unchanged except prototype plumbing. Keep all stable `data-*` selectors; omit `data-proto-*`, demo State controls and sample records. `dlg-export` and `dlg-regenerate` become dialog-host sheets; macOS draws alerts and save panels. `NT_STATES` is notification content reference only. The reading column is at most 760 pt, Transcript 960 pt; Narrow uses view pop-up and toolbar overflow, with Share retained. Per participant collapses at Narrow. German +30% wraps actions and notices; each paragraph/quote retains its language. Diffs expose inserted/deleted words beyond colour, sections are labelled regions, statuses are polite and Reduce motion removes fades; skeletons never shimmer.

**States coverage.** Call-page prototype states `writing` (including local writing), `section-failed`, `local-model`, `empty-section`, `regenerated`, `transcript-upgraded`, `archive-pending`, `sensitive`, `history-empty` and `audio-gone` are presentation fixtures, not core statuses. Edited, comparing, regenerating, copied/exported and tag feedback are interaction states. Items and speakers own review/naming state. The notification feature retains window-front, held and failed routing rules.

**DESIGN versus prototype.** `share.copy` writes sample text and `hd`/version helpers use in-memory fixture bodies; production always calls the core. The Export prototype always draws Audio, while DESIGN limits it to kept audio: omit it when unavailable. The prototype uses a short prefix/suffix diff rather than complete word changes/folding; implement the specified diff view from actual returned before/after text. Prototype single-key shortcuts and row selection need production wiring. DESIGN lists all outputs as editable; prototype exposes prose Edit on Summary only, with other prose bodies as the visual source until their controls are specified. Do not invent per-section APIs.

**Contract limits.** `ShareScope.include_unreviewed` supports explicit inclusion, so the warning is not an automatic ban; the false path handles `unreviewed_in_scope`. The fake refuses share while any output is writing, unlike DESIGN's independent ready sections, and its formatter can include rejected or unselected rows: real-core tests must enforce the designed scope and partial readiness. OutputSection carries no rejected-suppression count, per-section fallback reason or kept-edit count; those exact notices need owner contract work. RegenerateArgs.skill is a CallTypeId, while the prototype menu lists skill files/versions; use real call types and writer metadata, not filenames as ids. Delete Old Audio has no preview command for its sample freed-space estimate; never present the prototype’s 6.2 GB as a measurement. Archive diff bodies and metadata must come from the transcript/core views; unavailable details are blockers, not fabricated strings.

**Milestone notes.** The Call page frame shipped in M1 for delete/notification-permission stories. M2 completes Summary-ready/failed clicks and old-audio deletion opened by M1 capture errors. `share_test_run` is the remaining M2 command, already specified by `cpt-noter-feature-ui-settings`; its real-core conformance/E2E binding is not a new output-sharing API. Role-review controls remain M4; no draft card command counts here.

**Data.** Core-owned `cpt-noter-dbtable-summaries`, `cpt-noter-dbtable-summary-versions`, `cpt-noter-dbtable-call-tags`; UI reads through core only. No migration, direct filesystem write, network push, Slack/Jira credential or deployment belongs here. Bridge logs contain ids and error codes, never copied text or transcript content.
