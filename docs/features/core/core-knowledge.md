---
title: "Feature: Knowledge sources"
description: "Folder and indexed MCP ingestion, source privacy and scope, sync jobs and source removal."
status: PROPOSED
version: "0.4"
date: "2026-11-13"
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
  - [Remove all indexed data in bounded transactions](#remove-all-indexed-data-in-bounded-transactions)
- [4. States (CDSL)](#4-states-cdsl)
  - [Indexed source status](#indexed-source-status)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Folder and indexed MCP ingestion](#folder-and-indexed-mcp-ingestion)
  - [Current policy on every retrieval](#current-policy-on-every-retrieval)
  - [Revoke and remove without leftovers](#revoke-and-remove-without-leftovers)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Change Log](#7-change-log)

<!-- /toc -->

- [x] `p4` - **ID**: `cpt-noter-featstatus-core-knowledge`

- [x] `p4` - `cpt-noter-feature-core-knowledge`

**Change log**: Version 0.2 isolates unreadable local files, counts skipped attempts and preserves complete-listing pruning; sync algorithm and source state IDs advance to v2. Version 0.3 decodes BOM-marked UTF-8 and UTF-16 Markdown/text/code files before extraction. Version 0.4 distinguishes an OAuth `access_denied` response from a sign-in deadline at the transport seam while preserving cancellation behavior through the knowledge API.

## 1. Feature Context

### 1.1 Overview

`noter-knowledge` indexes folders and remote MCP sources into the same local retrieval store as calls. It extracts text, chunks by heading, embeds locally and schedules sync jobs. Every source has privacy and scope rules that retrieval applies before a model sees its chunks. Live MCP sources are configured here but relayed by noter-mcp, never indexed.

> **M3 decisions (Backend Teamlead, 7 Nov 2026).** `noter-knowledge` is a new crate with its own migration list (`sources`, `documents`, `doc_chunks`, `doc_chunks_fts`, `doc_vec`, `sync_runs`) (TL-28, TL-34). The app is unsandboxed (Q4, TL-29), so a folder source needs no security-scoped bookmark: `sources.bookmark` stays NULL, access is by path and changes arrive through the `notify` watcher; read every "bookmark" step below that way. Indexed MCP tokens live in `SecretStore` accounts `source:<src_id>` (TL-33). Extraction (TL-41): Markdown, text and code are read directly, HTML through a tag-stripping crate (`html2text` or `scraper`), PDF through `pdf-extract`, `.docx` through `zip` and `quick-xml` on `word/document.xml`; every new dependency needs its licence in `deny.toml`'s allow-list and `apps/desktop/src-tauri/Cargo.lock` updated in the same PR; chunks are 200–400 tokens by heading with title and heading path prepended. The `noter_knowledge::McpSource` seam (list resources, read resource, seed query, OAuth start/finish) is answered scripted by the harness through `harness.world_set`; the real streamable-HTTP transport with OAuth 2.1 PKCE (`noter-llm` `mcp_client.rs`) is slice 3 and ships only if it fits M3, otherwise it is an owner-batch open part and the box ticks on the scripted stories; live sources are stored, never indexed (D1) (TL-42). `SourceScope::Limited { call_types, people }` (TL-45): an unscoped request sees Limited sources; a scoped request sees one when any of its call types is in `call_types` or any of its people is in `people`; a request that names a call counts that call's type and participants as its own; sensitive sources are excluded for cloud runs regardless; `include_documents = false` returns none. `noter_knowledge::permitted_chunks` is the policy function core-retrieval-ask calls for documents.

> **Delivered (#331 #351 #362 #371).** The box ticks on the scripted `McpSource` (TL-47): every step is implemented and tested against the seam; the real streamable-HTTP transport with OAuth (slice 3, `noter-llm` `mcp_client.rs`) is a separate PR or an owner-batch item. Notes: (1) TL-29: no bookmark (`sources.bookmark` stays NULL), the app is unsandboxed and changes arrive through the `notify` watcher, so the bookmark wording of AC 5 is met by typed errors on an unreadable path. (2) TL-33: indexed MCP tokens are `SecretStore` account `source:<src_id>`; the row keeps only that name. (3) TL-41: extraction crates as landed: `html2text`, `pdf-extract`, `zip` + `quick-xml`. (4) TL-45: the Limited scope rule above. (5) `doc_chunks_fts` was rebuilt by migration `0002_doc_keywords.sql` in retrieval's trigram word-start form (the first version never matched word-start stems). (6) Delta: the frozen `AuditWhat` has no value for an indexed-sync request, so those `lookup` audit rows use `live_mcp_query` (DESIGN-core / contract delta, owner batch). (7) The seed crawl is one empty query. (8) No contract field carries the OAuth URL to the UI (UI M3 contract gap, owner batch). (9) The 1.4 "Locate / Sign In Again" gap stays.
>
> **Slice 3 landed the real transport (#376).** `noter_llm::McpClient` (`crates/noter-llm/src/mcp_client.rs`) speaks streamable-HTTP JSON-RPC and runs the server's OAuth 2.1 sign-in (discovery, dynamic client registration, PKCE S256, a loopback redirect for one flow, 5-minute deadline); `HttpMcp` in `apps/desktop/src-tauri` adapts it behind `McpSource`, and the harness keeps the scripted seam. Every HTTP request gets its own audit row first. Three owner items remain: no fallback when a server has no dynamic client registration; no contract field carries the OAuth URL to the UI (UI M3 gap); `AuditWhat` has no indexed-sync value (`live_mcp_query` is used; design delta).

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

- [x] `p4` - **ID**: `cpt-noter-flow-core-knowledge-folder`

**Actor**: Primary user (Settings › Knowledge Sources)

**Success Scenarios**:
- A picked folder becomes an indexed source with on-change indexing and a security-scoped bookmark.
- Files become document hits whose citations open the original file and heading.

**Error Scenarios**:
- Cancelled picker: no source; unavailable folder or denied access: typed error, no successful source row.

**Steps**:
1. [x] - `p1` - API: `source_add_folder { path, privacy, scope }`; when path is absent show the native open panel and obtain access to the chosen folder only - `inst-folder-pick`
2. [x] - `p1` - Resolve and validate the directory and its security-scoped bookmark; do not treat a supplied path as a permission grant (TL-29: the app is unsandboxed, so no bookmark; the path is resolved and checked on every add) - `inst-folder-validate`
3. [x] - `p1` - DB: INSERT an indexed folder `sources` row with revision, bookmark, privacy and scope through the change-log writer (TL-29: `bookmark` stays NULL) - `inst-folder-store`
4. [x] - `p1` - Register FSEvents and enqueue an initial sync; emit `entity:changed` after commit and **RETURN** `SourceRow` - `inst-folder-return`
5. [x] - `p1` - Run `cpt-noter-algo-core-knowledge-sync-v2`; publish per-source progress and then document count and last sync time - `inst-folder-index`

### Add an MCP source

- [x] `p4` - **ID**: `cpt-noter-flow-core-knowledge-mcp`

**Actor**: Primary user (Settings › Knowledge Sources)

**Success Scenarios**:
- An indexed server completes its own OAuth flow; the Keychain holds its token and scheduled jobs index changed documents.
- A live source is registered for the D1 relay with no indexed documents or Noter-held OAuth token.

**Error Scenarios**:
- OAuth cancelled, offline server or invalid server configuration: typed failure, no leaked token or half-enabled sync.
- The OAuth redirect's explicit `error=access_denied` is distinct from a sign-in deadline at the transport seam; both map to cancellation for the knowledge API and leave no source or token.

**Steps**:
1. [x] - `p1` - API: `source_add_mcp { server, mode, schedule, privacy, scope }`; validate the server and an indexed source's schedule - `inst-mcp-request`
2. [x] - `p1` - **IF** mode is indexed, complete the server's OAuth through the credentials seam and place the token in the Keychain; persist only its reference - `inst-mcp-oauth`
3. [x] - `p1` - **ELSE** retain live-server configuration without copying its credentials or adding it to a runtime's own MCP config - `inst-mcp-live`
4. [x] - `p1` - DB: INSERT the source with privacy, scope and mode through the change-log writer; compensate an orphaned newly created Keychain item if the transaction fails - `inst-mcp-store`
5. [x] - `p1` - For indexed mode, enqueue sync and register its schedule (the hourly `source_sync` pass queues each source its `hourly`, `daily` or `weekly` schedule makes due); for live mode, leave indexing disabled - `inst-mcp-schedule`
6. [x] - `p1` - Emit `entity:changed`; **RETURN** `SourceRow` with `has_token`, never the token - `inst-mcp-return`

### Read, edit and retry sources

- [x] `p4` - **ID**: `cpt-noter-flow-core-knowledge-manage`

**Actor**: Primary user (Settings; reindex also from main)

**Success Scenarios**:
- The list shows status, count, last sync, privacy, scope and token presence; retry progresses after a drive reconnects.
- A privacy or scope edit affects retrieval immediately, including already indexed chunks.

**Error Scenarios**:
- Missing source: `not_found`; stale revision: `conflict` with `detail.current_rev`; inaccessible folder, invalid schedule or authentication expiry: typed failure and source status.

**Steps**:
1. [x] - `p1` - API: `sources_list` from Settings reads complete `SourceList` rows from the read pool - `inst-manage-list`
2. [x] - `p1` - API: `source_update { source_id, rev, name, schedule, privacy, scope }` validates present values and referenced people and call types (people are checked once 2.23 adds the `people` table) - `inst-manage-update`
3. [x] - `p1` - DB: guard revision and replace supplied source fields with a change row; update inherited privacy and vector partition membership atomically, or exclude affected chunks until rebuilding finishes - `inst-manage-commit`
4. [x] - `p1` - Invalidate cached retrieval context for the source and update its scheduler registration; pending syncs must recheck the committed policy before publishing - `inst-manage-invalidate`
5. [x] - `p1` - API: `source_reindex { source_id }` from Settings or main enqueues an indexed source job and returns its `SourceRow`; do not turn a live source into an indexed source - `inst-manage-reindex`
6. [x] - `p1` - Emit source `entity:changed` after each committed change; **RETURN** the current source row - `inst-manage-return`

### Revoke or remove a source

- [x] `p4` - **ID**: `cpt-noter-flow-core-knowledge-remove`

**Actor**: Primary user (Settings › source details)

**Success Scenarios**:
- Revoke removes the indexed source's Keychain token and stops authenticated sync.
- Remove deletes local documents, chunks and vectors together; nothing in the folder or remote service changes.

**Error Scenarios**:
- Keychain failure is reported without claiming the token was removed; a database failure leaves the source's local index intact.

**Steps**:
1. [x] - `p1` - API: `source_revoke_token { source_id }`; stop authenticated work before deleting the indexed source's Keychain token - `inst-remove-revoke`
2. [x] - `p1` - DB: clear token reference and mark authentication unavailable through the writer; emit a source change and **RETURN** `SourceRow` with `has_token: false` - `inst-remove-revoked`
3. [x] - `p1` - API: `source_remove { source_id }` after the removal alert; cancel jobs and unregister watchers or schedules - `inst-remove-request`
4. [x] - `p1` - Run `cpt-noter-algo-core-knowledge-remove-index`; remove the source's token and release bookmark access without touching original files or remote pages (no bookmark to release, TL-29; an MCP source's Keychain token goes first, and a locked Keychain keeps the source) - `inst-remove-index`
5. [x] - `p1` - Emit the removed source id after commit; **RETURN** `DeleteResult`; old Ask citations resolve as deleted through the retrieval service - `inst-remove-return`

## 3. Processes / Business Logic (CDSL)

### Sync an indexed source

- [x] `p4` - **ID**: `cpt-noter-algo-core-knowledge-sync`

Previous revision, retained as a trace alias for `cpt-noter-algo-core-knowledge-sync-v2`.

- [x] `p4` - **ID**: `cpt-noter-algo-core-knowledge-sync-v2`

**Input**: Existing indexed source, job id, stored bookmark or Keychain token reference, local engine and current policy.

**Output**: Updated document index, `sync_runs` counts, source progress and last successful sync.

**Steps**:
1. [x] - `p1` - Read the current source; refuse a removed or live source; record the sync run and indexing status through the writer - `inst-sync-start`
2. [x] - `p1` - **IF** it is a folder, resolve and enter its bookmark scope, enumerate supported files on a blocking worker and coalesce FSEvents by changed file or containing directory (TL-29: read by path; `notify` events mark the source changed and the run looks again) - `inst-sync-folder`
3. [x] - `p1` - **ELSE** read the token through Keychain, list server resources or crawl seed queries when resources are unavailable; each remote lookup passes the egress gate and is audited before forwarding - `inst-sync-remote`
4. [x] - `p1` - **FOR EACH** file or page in bounded batches - `inst-sync-each`
   1. [x] - `p1` - Read its identity, URI, metadata and content hash; skip unchanged content unless a full reindex is required, and persist the new modification time when the content hash matches - `inst-sync-hash`
   2. [x] - `p1` - Extract Markdown, text, PDF, Word, HTML or code text; decode BOM-marked UTF-8 and UTF-16 for Markdown, text and code; chunk by heading into bounded 200–400 token estimates with title and heading path prepended, splitting long unbroken text at character boundaries - `inst-sync-extract`
   3. [x] - `p1` - Produce bge-m3 embeddings locally through the engine, outside writer transactions - `inst-sync-embed`
   4. [x] - `p1` - Recheck source existence, revision and privacy; in a writer transaction replace this document's canonical chunks, normalized FTS entries and `doc_vec` rows with a change row - `inst-sync-persist`
   5. [x] - `p1` - Publish committed source progress without file contents or tokens in logs - `inst-sync-progress`
5. [x] - `p1` - After a complete enumeration, delete vanished documents and their indexes; never infer mass deletion from a failed or partial remote listing - `inst-sync-deleted`
6. [x] - `p1` - Store added, changed and removed counts, successful last-sync time and idle status; publish skipped local-file attempts in job counts; release bookmark access and **RETURN** success - `inst-sync-return`
7. [x] - `p1` - **IF** a local file cannot be read or extracted, count the skipped attempt and continue with later files; retain any previously indexed version, keep the file present for pruning and retry it on later syncs. Folder enumeration, embedding, store or remote failures finish the run with their typed error, retain previous successful last-sync time and publish failed or sign-in-expired status; cancellation releases resources without publishing late chunks - `inst-sync-failure`

### Enforce source policy on indexed evidence

- [x] `p4` - **ID**: `cpt-noter-algo-core-knowledge-policy`

**Input**: Current source row, document candidates, call or Ask scope and runtime privacy context.

**Output**: Only chunks allowed by current privacy and scope.

**Steps**:
1. [x] - `p1` - Join document candidates to existing source rows; reject removed sources and reject documents when the query excludes them - `inst-policy-source`
2. [x] - `p1` - Apply AllCalls or Limited rules against the request's people and call types before ranking or building a model packet - `inst-policy-scope`
3. [x] - `p1` - Exclude sensitive sources for every cloud runtime, regardless of the global cloud mode - `inst-policy-sensitive`
4. [x] - `p1` - Use current source policy even when a cached chunk or an old sync was created under older rules; exclude a source during bounded privacy repartition, resume only toward its recorded target class, and restore retrieval after commit - `inst-policy-current`
5. [x] - `p1` - **RETURN** permitted chunks with document id, chunk id, source name and heading provenance - `inst-policy-return`

### Remove all indexed data in bounded transactions

- [x] `p4` - **ID**: `cpt-noter-algo-core-knowledge-remove-index`

**Input**: Source id and cancelled work for that source.

**Output**: The source is excluded from retrieval while its index is removed in bounded writer transactions; after interruption it remains excluded and removal can resume.

**Steps**:
1. [x] - `p1` - Mark the source unavailable to indexed retrieval and read its document count - `inst-drop-begin`
2. [x] - `p1` - Delete chunk rows and their keyword/vector indexes in bounded batches, then delete documents in bounded batches - `inst-drop-delete`
3. [x] - `p1` - **IF** any batch fails, retain the retrieval exclusion so a later removal can resume - `inst-drop-commit`
4. [x] - `p1` - Delete the source and its sync records after all batches; reject late workers by source existence and reclaim incremental free pages - `inst-drop-invalidate`
5. [x] - `p1` - **RETURN** removed count - `inst-drop-return`

## 4. States (CDSL)

### Indexed source status

- [x] `p4` - **ID**: `cpt-noter-state-core-knowledge-source`

Previous revision, retained as a trace alias for `cpt-noter-state-core-knowledge-source-v2`.

- [x] `p4` - **ID**: `cpt-noter-state-core-knowledge-source-v2`

**States**: idle, indexing, failed, sign_in_expired

**Initial State**: idle after source creation; first sync is enqueued

**Transitions**:
1. [x] - `p1` - **FROM** idle **TO** indexing **WHEN** an initial, scheduled, watched or requested sync starts - `inst-status-start`
2. [x] - `p1` - **FROM** indexing **TO** idle **WHEN** sync succeeds and counts and last-sync time commit - `inst-status-done`
3. [x] - `p1` - **FROM** indexing **TO** failed **WHEN** folder enumeration, embedding, store or transport fails; keep error code and time - `inst-status-failed`
4. [x] - `p1` - **FROM** indexing **TO** sign_in_expired **WHEN** the server rejects an expired or revoked token - `inst-status-expired`
5. [x] - `p1` - **FROM** idle **TO** sign_in_expired **WHEN** the user revokes the indexed token; also from failed or indexing - `inst-status-revoked`
6. [x] - `p1` - **FROM** failed **TO** indexing **WHEN** the cause is resolved and retry starts - `inst-status-retry`
7. [x] - `p1` - **FROM** indexing **TO** idle **WHEN** a job is cancelled without an error; record cancellation in the scheduler and keep the previous last-sync time - `inst-status-cancel`

Removal ends this lifecycle and deletes the row. OAuth renewal for an existing row is the contract gap noted in 1.4; it is not a new transition API here.

## 5. Definitions of Done

### Folder and indexed MCP ingestion

- [x] `p4` - **ID**: `cpt-noter-dod-core-knowledge-ingestion`

The system **MUST** add watched folders with bookmarks and indexed MCP sources with Keychain-only OAuth tokens, extract the six supported text formats, decode BOM-marked UTF-8 and UTF-16 for Markdown/text/code, chunk by heading, embed locally and skip unchanged hashes. Jobs report counts, errors, progress and last successful sync. Reads use the pool; batch writes use the single writer and log; network and engine work hold no SQLite transaction.

**Implements**:
- `cpt-noter-flow-core-knowledge-folder`
- `cpt-noter-flow-core-knowledge-mcp`
- `cpt-noter-algo-core-knowledge-sync-v2`
- `cpt-noter-state-core-knowledge-source-v2`

**Touches**:
- API: `source_add_folder`, `source_add_mcp`, `entity:changed`, `jobs:progress`
- DB: `sources`, `documents`, `doc_chunks`, `doc_vec`, document FTS, `sync_runs`, `changes`
- Entities: `SourceRow`, document provenance

### Current policy on every retrieval

- [x] `p4` - **ID**: `cpt-noter-dod-core-knowledge-policy`

The system **MUST** expose complete source rows, revision-guarded edits and retry, enforce privacy and scope before model context assembly, and make a sensitive edit effective even on old chunks and pending work. Live source configuration never starts indexed jobs or exposes the user's servers directly to the CLI.

**Implements**:
- `cpt-noter-flow-core-knowledge-manage`
- `cpt-noter-algo-core-knowledge-policy`

**Touches**:
- API: `sources_list`, `source_update`, `source_reindex`
- DB: `sources`, `doc_vec`, `changes`
- Entities: `SourceList`, `SourceScope`, `SourceStatus`

### Revoke and remove without leftovers

- [x] `p4` - **ID**: `cpt-noter-dod-core-knowledge-removal`

The system **MUST** revoke indexed tokens, stop authenticated work, and exclude a source from retrieval while bounded transactions remove its documents, chunks and vectors without touching originals. An interrupted removal remains excluded and can resume. Watchers, schedules, bookmark access and pending results are released. Removed chunks cannot appear in new answers; existing citations resolve as deleted. No token is returned or included in log or export data.

**Implements**:
- `cpt-noter-flow-core-knowledge-remove`
- `cpt-noter-algo-core-knowledge-remove-index`

**Touches**:
- API: `source_revoke_token`, `source_remove`
- DB: `sources` and its local index rows
- Entities: `SourceRow`, `DeleteResult`

## 6. Acceptance Criteria

- [ ] E2E against the real core, `cpt-noter-seq-settings-add-knowledge-source`: a picked folder reports progress, count and last sync, and its heading appears as document evidence in search and Ask; removal stops those hits. Open: the story proves the search half (`apps/desktop/tests/conformance/m3-stories-knowledge.test.ts`, #371); Ask still retrieves with `NoDocuments` (`crates/noter-core/src/ask.rs`), so document evidence in Ask arrives with a later 2.22 change.
- [x] Fixtures for Markdown, text, PDF, Word, HTML and code preserve title and heading provenance; changing one file re-embeds only that file, and unchanged remote hashes produce no duplicate chunks.
- [x] Scripted MCP covers resource listing, seed-query fallback, initial OAuth, expiry, offline retry and revoke; an incomplete listing never deletes previously indexed pages.
- [x] A sensitive source and an out-of-scope source are excluded before cloud packet creation; edits during a sync or answer cannot publish old-policy chunks.
- [x] A cancelled picker writes nothing; inaccessible bookmarks and failed jobs retain typed errors and previous last-sync time; reconnect and retry succeed.
- [x] A forced writer failure during source cleanup leaves the source unavailable to retrieval; retry resumes and removes every index row without touching originals.
- [x] Source cleanup removes chunk indexes in bounded writer transactions and reclaims incremental free pages after removal.
- [x] Each of the seven commands succeeds at least once in real-core E2E runs; stale `source_update` returns `conflict` without a write or event.
- [ ] Real-core regression in `crates/noter-core/tests/knowledge.rs`: a folder containing malformed PDF, empty Word and Word lock files still indexes later valid files, counts skipped attempts, retains the previous index for a newly unreadable file, prunes vanished documents and succeeds on subsequent syncs. The unreadable-folder regression retains fatal enumeration error coverage.
- [x] Unit extraction fixtures remain in `crates/noter-knowledge/src/extract.rs`; real-core command conformance and story E2E remain in `apps/desktop/tests/conformance/m3-stories-knowledge.test.ts` (`cpt-noter-seq-settings-add-knowledge-source`).
- [x] `just gate-fast` and `just gate` pass.

## 7. Change Log

- 2026-11-13: Folder events include directory changes; unchanged local hashes refresh stored modification times; folder enumeration stays off async workers; unbroken text is split into bounded character chunks. Source removal reclaims incremental free pages after its committed deletion.
