---
title: "Feature — Library: Calls list"
description: "The Calls page of the Library: every recorded call in a sortable, multi-select table with month groups, its status cell and the Local only tag, opening a call's page and deleting one or several calls after the native alert."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-library-calls
milestone: M1
---

# Feature: Library: Calls list


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Browse and open calls](#browse-and-open-calls)
  - [Select and delete calls](#select-and-delete-calls)
  - [Rename or retype a call from its row](#rename-or-retype-a-call-from-its-row)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Pick the status cell](#pick-the-status-cell)
- [4. States (CDSL)](#4-states-cdsl)
  - [Calls list](#calls-list)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Calls table and call row](#calls-table-and-call-row)
  - [Delete from the list](#delete-from-the-list)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p2` - **ID**: `cpt-noter-featstatus-ui-library-calls`

## 1. Feature Context

- [ ] `p2` - `cpt-noter-feature-ui-library-calls`

### 1.1 Overview

Library › **Calls** (⌘3) lists every recorded call, newest first in month groups, as a macOS table: **When**, **Call** (title, **Local only**, participants, language tags, up to two tags), **Type**, **Length**, **Open**, a status cell and a chevron. Rows select like any macOS table (⌘-click, ⇧-click, ⌘A); Return, a double-click or › opens the call's page; ⌘⌫ or **Delete…** deletes the selection after the native alert. The filter bar, search results, topics and tagging arrive with later features; this feature builds the page they extend.

### 1.2 Purpose

It implements the Calls view of `cpt-noter-component-screen-library` (LC-R1, LC-R3) and `cpt-noter-component-ui-call-row`.

**Requirements**: PRD › Feature specification › 5. Library and search (the call list). The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-keyboard-first`, `cpt-noter-principle-degrade-visibly`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Browses, sorts, selects, opens and deletes calls |
| Noter core (system) | Returns one view-ready page of calls with counts and status; reports changes as entity events |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 5. Library and search
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Screen — Library (LC-R1, LC-R3, Calls wireframe, Elements, Size behaviour, States); Component — Call row
- **Design elements**: `cpt-noter-component-screen-library` (Calls view; Search results, Topics and Topic thread arrive with `cpt-noter-feature-ui-library-search-topics`), `cpt-noter-component-ui-call-row`; uses `cpt-noter-component-ui-language-tag` and `cpt-noter-component-ui-empty-state`
- **Stories**: none of its own in M1; it is the path of `cpt-noter-seq-dialogs-delete-call` (Other — Several calls selected), owned by `cpt-noter-feature-ui-dialogs-host`
- **Frozen commands it calls**: `calls_list`, `call_get`, `call_update`, `call_types_list`; `calls_delete` through the dialog host
- **Events**: `entity:changed`, `outputs:progress`
- **Prototype modules**: `src/js/40-d-2-components.js` (`C.callRow`), `src/js/40-d-3-library.js` (the Calls view, `lib.deleteAsk`, `lib.delete`, the row context menu), `src/css/40-d.css` (`.lb-*`)
- **Dependencies**: `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-dialogs-host`, `cpt-noter-feature-ui-live-transcript`

## 2. Actor Flows (CDSL)

### Browse and open calls

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-library-calls-browse`

**Actor**: Primary user

**Success Scenarios**:
- The table shows **Calls**, **212 calls · 148 hours · since 2 Sep**, month groups and rows; sorting by a column header toggles ascending and descending and is announced
- Return on a row opens the call's page; Back returns to the same scroll position

**Error Scenarios**:
- No calls yet: the empty state **No calls yet** · **Calls you record appear here with their summary, decisions and action items.**, plus **Run Audio Self-Test…** while the self-test has not passed
- The list read is slow: skeleton rows after 300 ms
- The list read fails: the page's inline banner with **Try Again**

**Steps**:
1. [ ] - `p1` - User selects **Calls** in the sidebar or presses ⌘3 - `inst-user-open`
2. [ ] - `p1` - API: `calls_list` (no filter in M1, sort by **When** descending, first page) - `inst-api-list`
3. [ ] - `p1` - **IF** the result has no calls - `inst-if-empty`
   1. [ ] - `p1` - UI: the first-use empty state; with the self-test not passed, its action **Run Audio Self-Test…** opens the self-test sheet - `inst-empty`
4. [ ] - `p1` - UI: render the table with sticky month headers and call rows; the subtitle counts calls and hours with plural rules - `inst-render-table`
5. [ ] - `p1` - User scrolls to the end of the loaded page - `inst-user-scroll`
6. [ ] - `p1` - API: `calls_list` for the next page - `inst-api-next`
7. [ ] - `p1` - User clicks a column header - `inst-user-sort`
8. [ ] - `p1` - API: `calls_list` with the new sort; the sort state is announced ("sorted descending") - `inst-api-sort`
9. [ ] - `p1` - User presses Return, double-clicks or clicks › on a row - `inst-user-row`
10. [ ] - `p1` - UI: push the Call page route for the call (`cpt-noter-feature-ui-call-page-frame`), which reads it with `call_get` - `inst-open-call`
11. [ ] - `p1` - Core: `entity:changed` and `outputs:progress` update a row's status cell (**Writing summary…**) and the sidebar's progress glyph; status changes are not announced - `inst-live-status`
12. [ ] - `p1` - **RETURN** the Calls page - `inst-return-browse`

### Select and delete calls

- [ ] `p1` - **ID**: `cpt-noter-flow-ui-library-calls-delete`

**Actor**: Primary user

**Success Scenarios**:
- Other — Several calls selected of `cpt-noter-seq-dialogs-delete-call`: three rows with ⌘-click, ⌘⌫, **Delete 3 calls?**, **Delete 3 Calls**; the list without them

**Error Scenarios**:
- Return pressed by habit in the alert: **Cancel**; nothing is deleted
- A right-click on an unselected row selects only that row first

**Steps**:
1. [ ] - `p1` - User selects rows with click, ⌘-click, ⇧-click, ⇧↑ and ⇧↓, or ⌘A; the subtitle adds **· 3 selected** - `inst-user-select`
2. [ ] - `p1` - User presses ⌘⌫, or opens the row context menu (**Open**, **Delete…**; **Add Tag…**, **Remove Tag** and **Export…** arrive with M2 and M3 features) and chooses **Delete…** - `inst-user-delete`
3. [ ] - `p1` - Flow: `cpt-noter-flow-ui-dialogs-host-delete-call` with the selected ids - `inst-delete-flow`
4. [ ] - `p1` - Store: rows leave as `entity:changed` reports them deleted; the selection clears - `inst-rows-leave`
5. [ ] - `p1` - **RETURN** the list without the deleted calls - `inst-return-delete`

### Rename or retype a call from its row

- [ ] `p2` - **ID**: `cpt-noter-flow-ui-library-calls-edit`

**Actor**: Primary user

**Success Scenarios**:
- The call's page ⋯ menu renames it or sets its type; the row shows the new title or **Type** at once

**Error Scenarios**:
- `conflict`: the row keeps the core's current values

**Steps**:
1. [ ] - `p2` - User renames or retypes the call (Call page ⋯ › **Rename…**, **Call Type ▸**) - `inst-user-edit`
2. [ ] - `p2` - API: `call_update` (call id, `rev`, title or type); the call types come from `call_types_list` - `inst-api-update`
3. [ ] - `p2` - Store: `entity:changed` updates the row - `inst-row-update`
4. [ ] - `p2` - **RETURN** the row with the new values - `inst-return-edit`

## 3. Processes / Business Logic (CDSL)

### Pick the status cell

- [ ] `p1` - **ID**: `cpt-noter-algo-ui-library-calls-status-cell`

**Input**: the call's status from the core (outputs writing or failed, unnamed speakers, archive pending, audio deleted)

**Output**: one status with icon and text, and the audio-deleted glyph

**Steps**:
1. [ ] - `p1` - Pick the first that applies, in this order: **Couldn't write the summary** (error icon), **Writing summary…** (small spinner), **2 speakers not named** (person icon, a link to the call's page with the naming panel from M2), **Archive pending** - `inst-order`
2. [ ] - `p1` - **IF** the audio is deleted: add the glyph with the help tag **Audio deleted on 15 Nov (kept 30 days)** beside any of them - `inst-audio-glyph`
3. [ ] - `p1` - **IF** the call is sensitive: the **Local only** tag after the title - `inst-local-only`
4. [ ] - `p1` - At Medium width show the icon only with the text in its help tag and for VoiceOver - `inst-medium`
5. [ ] - `p1` - **RETURN** the cell - `inst-return-cell`

## 4. States (CDSL)

### Calls list

- [ ] `p1` - **ID**: `cpt-noter-state-ui-library-calls-list`

**States**: LOADING, EMPTY, LISTED, SELECTED_SEVERAL, ERROR

**Initial State**: LOADING

**Transitions**:
1. [ ] - `p1` - **FROM** LOADING **TO** LISTED **WHEN** the first page arrives with calls - `inst-loading-listed`
2. [ ] - `p1` - **FROM** LOADING **TO** EMPTY **WHEN** the first page has no call (No calls yet) - `inst-loading-empty`
3. [ ] - `p1` - **FROM** LOADING **TO** ERROR **WHEN** the read fails - `inst-loading-error`
4. [ ] - `p1` - **FROM** ERROR **TO** LOADING **WHEN** the user chooses **Try Again** - `inst-error-loading`
5. [ ] - `p1` - **FROM** LISTED **TO** SELECTED_SEVERAL **WHEN** more than one row is selected - `inst-listed-several`
6. [ ] - `p1` - **FROM** SELECTED_SEVERAL **TO** LISTED **WHEN** the selection drops to one or none, or the calls are deleted - `inst-several-listed`
7. [ ] - `p1` - **FROM** LISTED **TO** EMPTY **WHEN** the last call is deleted - `inst-listed-empty`
8. [ ] - `p1` - **FROM** EMPTY **TO** LISTED **WHEN** a recorded call arrives (`entity:changed`) - `inst-empty-listed`

## 5. Definitions of Done

### Calls table and call row

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-library-calls-table`

The system **MUST** render LC-R1 and LC-R3 as the prototype's Calls view does, with `C.callRow` in its table-row variant (and the compact and result-group-header variants for later pages), month groups, sort, multi-select, the status cell order, the **Local only** tag, column hiding at Medium and Narrow, keyboard behaviour and VoiceOver row labels, from `calls_list` pages.

**Implements**:
- `cpt-noter-flow-ui-library-calls-browse`
- `cpt-noter-flow-ui-library-calls-edit`
- `cpt-noter-algo-ui-library-calls-status-cell`
- `cpt-noter-state-ui-library-calls-list`

**Constraints**: `cpt-noter-constraint-three-languages`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Commands: `calls_list`, `call_get`, `call_update`, `call_types_list`
- Events: `entity:changed`, `outputs:progress`
- Tests: screenshot specs `default`, `empty`, `selected`, `statuses`, `loading` at Wide, Medium and Narrow; unit tests for the status order and selection

### Delete from the list

- [ ] `p2` - **ID**: `cpt-noter-dod-ui-library-calls-delete`

The system **MUST** delete one or several selected calls through the dialog host's alert and `calls_delete`, and drop them from the list when the core reports them deleted.

**Implements**:
- `cpt-noter-flow-ui-library-calls-delete`

**Constraints**: `cpt-noter-constraint-local-only-ui`

**Touches**:
- Commands: `calls_delete`
- Tests: E2E `cpt-noter-seq-dialogs-delete-call` (Other — Several calls selected)

## 6. Acceptance Criteria

- [ ] The Calls page renders the prototype's Library states **Normal**, **Calls · No calls yet**, **Calls · Several calls selected**, **Calls · Status cells** and **Loading** identically
- [ ] Rows never truncate the status icon; long titles tail-truncate with the full title in a help tag and for VoiceOver
- [ ] Back from a call's page returns to the same scroll position and selection
- [ ] The list makes one `calls_list` call per page, never one call per row

## 7. Additional Context

**Prototype reuse.** Rewritten in React with the same structure, classes, tokens and data attributes: `C.callRow` (`src/js/40-d-2-components.js`) and the Calls view of `src/js/40-d-3-library.js` (table, month groups, selection, context menu, `lib.deleteAsk`). Styles `.lb-*` (`src/css/40-d.css`) are ported as-is. Not reusable: the sample calls, `L().sel` and `L().deleted` (prototype state), and the filter bar and tag menus, which `cpt-noter-feature-ui-library-search-topics` ports in M3.

**States coverage.** DESIGN's Library states that M1 renders: No calls yet (`empty`), Several calls selected (`selected`), Loading (`loading`), Outputs being written and Outputs failed (`statuses`), Speakers not named, Archive pending and Audio deleted (status cells from the core). The filter, tag, search and topic states belong to `cpt-noter-feature-ui-library-search-topics` (M3); Several calls tagged and No tags yet need the M2 tag commands.

**Not applicable.** Search and filters: M3. Export: M2. Data: the list is one view-ready page from the core.
