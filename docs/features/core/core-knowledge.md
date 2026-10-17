---
title: "Feature: Knowledge sources"
description: "Folder and indexed MCP ingestion, source privacy and scope, sync jobs and source removal."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M3
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Knowledge sources

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Add a watched folder](#add-a-watched-folder)
  - [Add an MCP source](#add-an-mcp-source)
  - [Read, edit and retry sources](#read-edit-and-retry-sources)
  - [Revoke or remove a source](#revoke-or-remove-a-source)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Sync an indexed source](#sync-an-indexed-source)
  - [Enforce source policy on indexed evidence](#enforce-source-policy-on-indexed-evidence)
  - [Remove all indexed data atomically](#remove-all-indexed-data-atomically)
- [4. States (CDSL)](#4-states-cdsl)
  - [Indexed source status](#indexed-source-status)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Folder and indexed MCP ingestion](#folder-and-indexed-mcp-ingestion)
  - [Current policy on every retrieval](#current-policy-on-every-retrieval)
  - [Revoke and remove without leftovers](#revoke-and-remove-without-leftovers)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p4` - **ID**: `cpt-noter-featstatus-core-knowledge`

- [ ] `p4` - `cpt-noter-feature-core-knowledge`

## 1. Feature Context

### 1.1 Overview

`noter-knowledge` indexes folders and remote MCP sources into the same local retrieval store as calls. It extracts text, chunks by heading, embeds locally and schedules sync jobs. Every source has privacy and scope rules that retrieval applies before a model sees its chunks. Live MCP sources are configured here but relayed by noter-mcp, never indexed.

### 1.2 Purpose

Search and answers can cite a document's title and section alongside a call's speaker and time. The user can see indexing progress, retry a failed sync, revoke an indexed source's token and remove its local index without changing the remote source.

**Requirements**: PRD › Feature specification › 7. Knowledge sources; PRD › Data model and storage › Knowledge index; PRD › Search and cross-meeting memory › Knowledge sources in retrieval.

**Principles**: None assigned by the decomposition; indexed remote sync still passes the shared egress gate.

**Delivers**:
- Frozen commands (M3): `sources_list`, `source_add_folder`, `source_add_mcp`, `source_update`, `source_reindex`, `source_remove`, `source_revoke_token`.
- Events: `entity:changed`; scheduled work reports `jobs:progress` through the M2 scheduler.
- DESIGN.md story (M3): `cpt-noter-seq-settings-add-knowledge-source`.

Live lookups belong to `cpt-noter-feature-core-mcp` (D1). Activity's M5 commands do not become M3 commands just because sync jobs already exist.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Adds, edits, retries, revokes or removes a source in Settings |
| macOS open panel and FSEvents | Grant folder access and report changes |
| Indexed MCP server | Lists resources or answers seed queries and supplies documents |
| Job scheduler and local engine | Run syncs and produce bge-m3 embeddings |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-knowledge`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-knowledge`, `cpt-noter-dbtable-sources`; 3.5 evidence and knowledge sources, 3.7 sources, 4.2 D1
- **PRD**: [PRD.md](../../PRD.md) › Feature specification › 7. Knowledge sources
- **Contract**: `crates/noter-protocol/src/model/knowledge.rs`, `contracts/ipc.manifest.json`
- **Dependencies**: `cpt-noter-feature-core-retrieval-ask`, `cpt-noter-feature-core-jobs-scheduler`, `cpt-noter-feature-core-llm-gate`

`SourceMode::Live` has an older comment about direct CLI configuration; DESIGN-core D1 and `mcp.rs` require the noter-mcp relay instead. `SourceUpdateArgs` cannot relocate a folder or initiate OAuth renewal for an existing source. The story's Locate and Sign In Again actions need upstream contract work; the existing commands here cover initial OAuth, retry, revoke and remove without inventing extra fields.

## 2. Actor Flows (CDSL)

### Add a watched folder

- [ ] `p4` - **ID**: `cpt-noter-flow-core-knowledge-folder`

**Actor**: Primary user (Settings › Knowledge Sources)

**Success Scenarios**:
- A picked folder becomes an indexed source with on-change indexing and a security-scoped bookmark.
- Files become document hits whose citations open the original file and heading.

**Error Scenarios**:
- Cancelled picker: no source; unavailable folder or denied access: typed error, no successful source row.

**Steps**:
1. [ ] - `p1` - API: `source_add_folder { path, privacy, scope }`; when path is absent show the native open panel and obtain access to the chosen folder only - `inst-folder-pick`
2. [ ] - `p1` - Resolve and validate the directory and its security-scoped bookmark; do not treat a supplied path as a permission grant - `inst-folder-validate`
3. [ ] - `p1` - DB: INSERT an indexed folder `sources` row with revision, bookmark, privacy and scope through the change-log writer - `inst-folder-store`
4. [ ] - `p1` - Register FSEvents and enqueue an initial sync; emit `entity:changed` after commit and **RETURN** `SourceRow` - `inst-folder-return`
5. [ ] - `p1` - Run `cpt-noter-algo-core-knowledge-sync`; publish per-source progress and then document count and last sync time - `inst-folder-index`

### Add an MCP source

- [ ] `p4` - **ID**: `cpt-noter-flow-core-knowledge-mcp`

**Actor**: Primary user (Settings › Knowledge Sources)

**Success Scenarios**:
- An indexed server completes its own OAuth flow; the Keychain holds its token and scheduled jobs index changed documents.
- A live source is registered for the D1 relay with no indexed documents or Noter-held OAuth token.

**Error Scenarios**:
- OAuth cancelled, offline server or invalid server configuration: typed failure, no leaked token or half-enabled sync.

**Steps**:
1. [ ] - `p1` - API: `source_add_mcp { server, mode, schedule, privacy, scope }`; validate the server and an indexed source's schedule - `inst-mcp-request`
2. [ ] - `p1` - **IF** mode is indexed, complete the server's OAuth through the credentials seam and place the token in the Keychain; persist only its reference - `inst-mcp-oauth`
3. [ ] - `p1` - **ELSE** retain live-server configuration without copying its credentials or adding it to a runtime's own MCP config - `inst-mcp-live`
4. [ ] - `p1` - DB: INSERT the source with privacy, scope and mode through the change-log writer; compensate an orphaned newly created Keychain item if the transaction fails - `inst-mcp-store`
5. [ ] - `p1` - For indexed mode, enqueue sync and register its schedule; for live mode, leave indexing disabled - `inst-mcp-schedule`
6. [ ] - `p1` - Emit `entity:changed`; **RETURN** `SourceRow` with `has_token`, never the token - `inst-mcp-return`

### Read, edit and retry sources

- [ ] `p4` - **ID**: `cpt-noter-flow-core-knowledge-manage`

**Actor**: Primary user (Settings; reindex also from main)

**Success Scenarios**:
- The list shows status, count, last sync, privacy, scope and token presence; retry progresses after a drive reconnects.
- A privacy or scope edit affects retrieval immediately, including already indexed chunks.

**Error Scenarios**:
- Missing source: `not_found`; stale revision: `conflict` with `detail.current_rev`; inaccessible folder, invalid schedule or authentication expiry: typed failure and source status.

**Steps**:
1. [ ] - `p1` - API: `sources_list` from Settings reads complete `SourceList` rows from the read pool - `inst-manage-list`
2. [ ] - `p1` - API: `source_update { source_id, rev, name, schedule, privacy, scope }` validates present values and referenced people and call types - `inst-manage-update`
3. [ ] - `p1` - DB: guard revision and replace supplied source fields with a change row; update inherited privacy and vector partition membership atomically, or exclude affected chunks until rebuilding finishes - `inst-manage-commit`
4. [ ] - `p1` - Invalidate cached retrieval context for the source and update its scheduler registration; pending syncs must recheck the committed policy before publishing - `inst-manage-invalidate`
5. [ ] - `p1` - API: `source_reindex { source_id }` from Settings or main enqueues an indexed source job and returns its `SourceRow`; do not turn a live source into an indexed source - `inst-manage-reindex`
6. [ ] - `p1` - Emit source `entity:changed` after each committed change; **RETURN** the current source row - `inst-manage-return`

### Revoke or remove a source

- [ ] `p4` - **ID**: `cpt-noter-flow-core-knowledge-remove`

**Actor**: Primary user (Settings › source details)

**Success Scenarios**:
- Revoke removes the indexed source's Keychain token and stops authenticated sync.
- Remove deletes local documents, chunks and vectors together; nothing in the folder or remote service changes.

**Error Scenarios**:
- Keychain failure is reported without claiming the token was removed; a database failure leaves the source's local index intact.

**Steps**:
1. [ ] - `p1` - API: `source_revoke_token { source_id }`; stop authenticated work before deleting the indexed source's Keychain token - `inst-remove-revoke`
2. [ ] - `p1` - DB: clear token reference and mark authentication unavailable through the writer; emit a source change and **RETURN** `SourceRow` with `has_token: false` - `inst-remove-revoked`
3. [ ] - `p1` - API: `source_remove { source_id }` after the removal alert; cancel jobs and unregister watchers or schedules - `inst-remove-request`
4. [ ] - `p1` - Run `cpt-noter-algo-core-knowledge-remove-index`; remove the source's token and release bookmark access without touching original files or remote pages - `inst-remove-index`
5. [ ] - `p1` - Emit the removed source id after commit; **RETURN** `DeleteResult`; old Ask citations resolve as deleted through the retrieval service - `inst-remove-return`

## 3. Processes / Business Logic (CDSL)

### Sync an indexed source

- [ ] `p4` - **ID**: `cpt-noter-algo-core-knowledge-sync`

**Input**: Existing indexed source, job id, stored bookmark or Keychain token reference, local engine and current policy.

**Output**: Updated document index, `sync_runs` counts, source progress and last successful sync.

**Steps**:
1. [ ] - `p1` - Read the current source; refuse a removed or live source; record the sync run and indexing status through the writer - `inst-sync-start`
2. [ ] - `p1` - **IF** it is a folder, resolve and enter its bookmark scope, enumerate supported files and coalesce FSEvents by changed file - `inst-sync-folder`
3. [ ] - `p1` - **ELSE** read the token through Keychain, list server resources or crawl seed queries when resources are unavailable; each remote lookup passes the egress gate and is audited before forwarding - `inst-sync-remote`
4. [ ] - `p1` - **FOR EACH** file or page in bounded batches - `inst-sync-each`
   1. [ ] - `p1` - Read its identity, URI, metadata and content hash; skip unchanged content unless a full reindex is required - `inst-sync-hash`
   2. [ ] - `p1` - Extract Markdown, text, PDF, Word, HTML or code text; chunk by heading into 200–400 tokens with title and heading path prepended - `inst-sync-extract`
   3. [ ] - `p1` - Produce bge-m3 embeddings locally through the engine, outside writer transactions - `inst-sync-embed`
   4. [ ] - `p1` - Recheck source existence, revision and privacy; in a writer transaction replace this document's canonical chunks, normalized FTS entries and `doc_vec` rows with a change row - `inst-sync-persist`
   5. [ ] - `p1` - Publish committed source progress without file contents or tokens in logs - `inst-sync-progress`
5. [ ] - `p1` - After a complete enumeration, delete vanished documents and their indexes; never infer mass deletion from a failed or partial remote listing - `inst-sync-deleted`
6. [ ] - `p1` - Store added, changed and removed counts, successful last-sync time and idle status; release bookmark access and **RETURN** success - `inst-sync-return`
7. [ ] - `p1` - **IF** a read, extraction, embedding or remote step fails, finish the run with its typed error, retain previous successful last-sync time and publish failed or sign-in-expired status; cancellation releases resources without publishing late chunks - `inst-sync-failure`

### Enforce source policy on indexed evidence

- [ ] `p4` - **ID**: `cpt-noter-algo-core-knowledge-policy`

**Input**: Current source row, document candidates, call or Ask scope and runtime privacy context.

**Output**: Only chunks allowed by current privacy and scope.

**Steps**:
1. [ ] - `p1` - Join document candidates to existing source rows; reject removed sources and reject documents when the query excludes them - `inst-policy-source`
2. [ ] - `p1` - Apply AllCalls or Limited rules against the request's people and call types before ranking or building a model packet - `inst-policy-scope`
3. [ ] - `p1` - Exclude sensitive sources for every cloud runtime, regardless of the global cloud mode - `inst-policy-sensitive`
4. [ ] - `p1` - Use current source policy even when a cached chunk or an old sync was created under older rules; the egress gate rechecks at release - `inst-policy-current`
5. [ ] - `p1` - **RETURN** permitted chunks with document id, chunk id, source name and heading provenance - `inst-policy-return`

### Remove all indexed data atomically

- [ ] `p4` - **ID**: `cpt-noter-algo-core-knowledge-remove-index`

**Input**: Source id and cancelled work for that source.

**Output**: Source and local index gone, or a rollback with no partial removal.

**Steps**:
1. [ ] - `p1` - Begin the writer transaction and read the source and document ids - `inst-drop-begin`
2. [ ] - `p1` - DB: DELETE its `doc_vec` and FTS entries, `doc_chunks`, `documents`, source-owned sync records and `sources` row; record the removal without copied document content - `inst-drop-delete`
3. [ ] - `p1` - **TRY** commit; **CATCH** failure, roll back and **RETURN** `internal` - `inst-drop-commit`
4. [ ] - `p1` - Invalidate cached hits and reject late workers by source existence; cleanup failures are retried without allowing the source back into retrieval - `inst-drop-invalidate`
5. [ ] - `p1` - **RETURN** removed count - `inst-drop-return`

## 4. States (CDSL)

### Indexed source status

- [ ] `p4` - **ID**: `cpt-noter-state-core-knowledge-source`

**States**: idle, indexing, failed, sign_in_expired

**Initial State**: idle after source creation; first sync is enqueued

**Transitions**:
1. [ ] - `p1` - **FROM** idle **TO** indexing **WHEN** an initial, scheduled, watched or requested sync starts - `inst-status-start`
2. [ ] - `p1` - **FROM** indexing **TO** idle **WHEN** sync succeeds and counts and last-sync time commit - `inst-status-done`
3. [ ] - `p1` - **FROM** indexing **TO** failed **WHEN** extraction, folder access, embedding or transport fails; keep error code and time - `inst-status-failed`
4. [ ] - `p1` - **FROM** indexing **TO** sign_in_expired **WHEN** the server rejects an expired or revoked token - `inst-status-expired`
5. [ ] - `p1` - **FROM** idle **TO** sign_in_expired **WHEN** the user revokes the indexed token; also from failed or indexing - `inst-status-revoked`
6. [ ] - `p1` - **FROM** failed **TO** indexing **WHEN** the cause is resolved and retry starts - `inst-status-retry`
7. [ ] - `p1` - **FROM** indexing **TO** idle **WHEN** a job is cancelled without an error; record cancellation in the scheduler and keep the previous last-sync time - `inst-status-cancel`

Removal ends this lifecycle and deletes the row. OAuth renewal for an existing row is the contract gap noted in 1.4; it is not a new transition API here.

## 5. Definitions of Done

### Folder and indexed MCP ingestion

- [ ] `p4` - **ID**: `cpt-noter-dod-core-knowledge-ingestion`

The system **MUST** add watched folders with bookmarks and indexed MCP sources with Keychain-only OAuth tokens, extract the six supported text formats, chunk by heading, embed locally and skip unchanged hashes. Jobs report counts, errors, progress and last successful sync. Reads use the pool; batch writes use the single writer and log; network and engine work hold no SQLite transaction.

**Implements**:
- `cpt-noter-flow-core-knowledge-folder`
- `cpt-noter-flow-core-knowledge-mcp`
- `cpt-noter-algo-core-knowledge-sync`
- `cpt-noter-state-core-knowledge-source`

**Touches**:
- API: `source_add_folder`, `source_add_mcp`, `entity:changed`, `jobs:progress`
- DB: `sources`, `documents`, `doc_chunks`, `doc_vec`, document FTS, `sync_runs`, `changes`
- Entities: `SourceRow`, document provenance

### Current policy on every retrieval

- [ ] `p4` - **ID**: `cpt-noter-dod-core-knowledge-policy`

The system **MUST** expose complete source rows, revision-guarded edits and retry, enforce privacy and scope before model context assembly, and make a sensitive edit effective even on old chunks and pending work. Live source configuration never starts indexed jobs or exposes the user's servers directly to the CLI.

**Implements**:
- `cpt-noter-flow-core-knowledge-manage`
- `cpt-noter-algo-core-knowledge-policy`

**Touches**:
- API: `sources_list`, `source_update`, `source_reindex`
- DB: `sources`, `doc_vec`, `changes`
- Entities: `SourceList`, `SourceScope`, `SourceStatus`

### Revoke and remove without leftovers

- [ ] `p4` - **ID**: `cpt-noter-dod-core-knowledge-removal`

The system **MUST** revoke indexed tokens, stop authenticated work, and remove a source's documents, chunks and vectors atomically without touching originals. Watchers, schedules, bookmark access and pending results are released. Removed chunks cannot appear in new answers; existing citations resolve as deleted. No token is returned or included in log or export data.

**Implements**:
- `cpt-noter-flow-core-knowledge-remove`
- `cpt-noter-algo-core-knowledge-remove-index`

**Touches**:
- API: `source_revoke_token`, `source_remove`
- DB: `sources` and its local index rows
- Entities: `SourceRow`, `DeleteResult`

## 6. Acceptance Criteria

- [ ] E2E against the real core, `cpt-noter-seq-settings-add-knowledge-source`: a picked folder reports progress, count and last sync, and its heading appears as document evidence in search and Ask; removal stops those hits.
- [ ] Fixtures for Markdown, text, PDF, Word, HTML and code preserve title and heading provenance; changing one file re-embeds only that file, and unchanged remote hashes produce no duplicate chunks.
- [ ] Scripted MCP covers resource listing, seed-query fallback, initial OAuth, expiry, offline retry and revoke; an incomplete listing never deletes previously indexed pages.
- [ ] A sensitive source and an out-of-scope source are excluded before cloud packet creation; edits during a sync or answer cannot publish old-policy chunks.
- [ ] A cancelled picker writes nothing; inaccessible bookmarks and failed jobs retain typed errors and previous last-sync time; reconnect and retry succeed.
- [ ] Removal rolls back on a forced writer failure; after successful removal, no index row remains and late jobs cannot restore the source.
- [ ] Each of the seven commands succeeds at least once in real-core E2E runs; stale `source_update` returns `conflict` without a write or event.
- [ ] `just gate-fast` and `just gate` pass.
