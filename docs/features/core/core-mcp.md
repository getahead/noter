---
title: "Feature: noter-mcp and the core socket"
description: "Local MCP stdio tools, authenticated per-run Unix socket dispatch, gated cloud results and live-source relay."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M3
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: noter-mcp and the core socket

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Start a local tool server for one run](#start-a-local-tool-server-for-one-run)
  - [Look up library evidence](#look-up-library-evidence)
  - [Stage a pin or correction](#stage-a-pin-or-correction)
  - [Relay a live source lookup](#relay-a-live-source-lookup)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Authenticate and authorize a socket request](#authenticate-and-authorize-a-socket-request)
  - [Release a result through the egress gate](#release-a-result-through-the-egress-gate)
  - [Stage without applying primary changes](#stage-without-applying-primary-changes)
  - [Close a run and revoke access](#close-a-run-and-revoke-access)
- [4. States (CDSL)](#4-states-cdsl)
  - [Tool session lifecycle](#tool-session-lifecycle)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Local stdio and authenticated socket](#local-stdio-and-authenticated-socket)
  - [Reads and cloud result gating](#reads-and-cloud-result-gating)
  - [Staged writes only](#staged-writes-only)
  - [D1 relay and network evidence](#d1-relay-and-network-evidence)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p4` - **ID**: `cpt-noter-featstatus-core-mcp`

- [ ] `p4` - `cpt-noter-feature-core-mcp`

## 1. Feature Context

### 1.1 Overview

`noter-mcp` is a Rust stdio child of Claude Code or Codex for one run. It serves the protocol crate's tool schemas and forwards calls over the core's local Unix socket with a per-run token. The core owns retrieval, item reads and staged changes; its socket handler filters, redacts and audits cloud tool results before returning them. No TCP listener or database connection exists in the binary.

### 1.2 Purpose

An agent can refine its own library lookup while answering a question or reviewing a call, without bypassing the single writer or the egress gate. Its write tools stage user-reviewable work instead of editing primary records. Live MCP sources are reachable only through the logged D1 relay.

**Requirements**: PRD › LLM orchestration › noter-mcp; PRD › Security, privacy and permissions; PRD › Feature specification › 7. Knowledge sources (live lookup seam).

**Principles**: `cpt-noter-principle-core-egress-gate`

**Delivers**:
- Frozen IPC commands (M3): none. `harness/milestones.toml` assigns no UI command to this feature.
- DESIGN.md stories (M3): none assigned. Its integration supports Ask's stories, owned by `cpt-noter-feature-core-retrieval-ask`.
- Stable MCP tools: `search_calls`, `search_documents`, `get_transcript_span`, `get_person`, `get_decisions`, `get_open_items`, `pin_item`, `propose_correction`.
- Declared unstable tools: `get_screen_context` (empty in v1), `emit_card` (Q3, M4 live path excluded here).
- Socket interface: `cpt-noter-interface-mcp-tools`, JSON-RPC 2.0 requests and responses from `mcp.rs`.

This does not implement M4 card delivery or M5 proposal decision commands. Staging is required now; acceptance of staged work remains with the owning item/proposal feature. Indexed-source sync belongs to knowledge sources.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Claude Code or Codex run | Starts the stdio server and calls allowed tools |
| Router | Creates isolated run config and binds token to trusted run context |
| Core socket handler | Authenticates, authorizes, retrieves and gates each result |
| User-configured live MCP server | Answers permitted relayed lookups through its own transport and credentials |
| Primary user | Later decides whether staged changes are applied |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-mcp`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-mcp`, `cpt-noter-interface-mcp-tools`, `cpt-noter-principle-core-egress-gate`; 3.3 noter-mcp tools and socket, 3.6 Ask, 4.2 O2 and D1
- **PRD**: [PRD.md](../../PRD.md) › LLM orchestration › noter-mcp
- **Contract**: `crates/noter-protocol/src/mcp.rs`, `contracts/mcp-tools.schema.json`, `contracts/egress-hosts.json`
- **Dependencies**: `cpt-noter-feature-core-retrieval-ask`, `cpt-noter-feature-core-items-today`, `cpt-noter-feature-core-llm-gate`

There are no new tables or API schemas here. `McpRunContext` is the protocol type; values supplied by the child do not become authoritative privacy settings. Knowledge configuration is an integration seam for live sources, not an added dependency cycle. The unstable `emit_card` response and live-path decision stay with Q3/M4; this spec must not freeze them.

## 2. Actor Flows (CDSL)

### Start a local tool server for one run

- [ ] `p4` - **ID**: `cpt-noter-flow-core-mcp-start`

**Actor**: Router and the runtime CLI

**Success Scenarios**:
- A configured CLI starts only Noter's MCP child, which serves schemas over stdio and reaches only the authenticated local core socket.

**Error Scenarios**:
- Missing token or socket: no tool can read data; a server failure becomes a runtime tool failure without a direct database fallback.

**Steps**:
1. [ ] - `p1` - Router registers trusted run id, optional call, effective privacy, cloud status, allowed tools and a fresh token in the core - `inst-start-register`
2. [ ] - `p1` - Write the Noter-owned `run/mcp/<run_id>.json` and provide `NOTER_MCP_TOKEN` to the child; restrict config and socket files to the user - `inst-start-config`
3. [ ] - `p1` - CLI starts the signed `noter-mcp` binary as a stdio child under its existing isolated run policy; no user hooks, plugins or unrelated MCP servers are loaded - `inst-start-child`
4. [ ] - `p1` - Serve MCP initialization and `tools/list` from exported protocol schemas; stdout contains only MCP messages and diagnostics use scrubbed stderr - `inst-start-tools`
5. [ ] - `p1` - Connect to `$APP_SUPPORT/run/core.sock` (0600); **RETURN** readiness to the CLI without opening a TCP port - `inst-start-return`

### Look up library evidence

- [ ] `p4` - **ID**: `cpt-noter-flow-core-mcp-read`

**Actor**: Runtime CLI agent

**Success Scenarios**:
- Call and document search return known evidence ids; transcript spans, people, decisions and open items are resolved from current rows.
- Local runs can use sensitive evidence allowed by their context; cloud runs cannot receive sensitive calls or sources through any read tool.

**Error Scenarios**:
- Invalid params: −32602; unauthenticated or forbidden runtime/tool: −32001; missing entity: −32002; internal or audit failure: −32603 without a result payload.

**Steps**:
1. [ ] - `p1` - Receive a typed MCP call; forward `CoreSocketRequest` with method, request id, context and params over the Unix socket - `inst-read-forward`
2. [ ] - `p1` - Run `cpt-noter-algo-core-mcp-authorize`; reject before any data lookup if token or policy is invalid - `inst-read-authorize`
3. [ ] - `p1` - Dispatch `search_calls` or `search_documents` to shared retrieval; call search defaults to eight hits and caps at 30 - `inst-read-search`
4. [ ] - `p1` - Dispatch `get_transcript_span`, `get_person`, `get_decisions` or `get_open_items` to the core's existing read services; resolve person id or normalized name/alias and apply the run's filters to all related rows - `inst-read-entities`
5. [ ] - `p1` - For `get_screen_context`, return empty v1 chips; never capture a screen as a tool side effect - `inst-read-screen`
6. [ ] - `p1` - Run `cpt-noter-algo-core-mcp-release-result` for the entire assembled result, including person recent-call and open-item fields - `inst-read-gate`
7. [ ] - `p1` - **RETURN** `CoreSocketResponse` with the original request id and exactly one result or error; map it back to MCP without changing evidence ids - `inst-read-return`

### Stage a pin or correction

- [ ] `p4` - **ID**: `cpt-noter-flow-core-mcp-stage`

**Actor**: Runtime CLI agent

**Success Scenarios**:
- `pin_item` or `propose_correction` returns a stable staged reference; the user decides whether the primary record changes.

**Error Scenarios**:
- Unknown, out-of-scope or invented evidence is rejected; a staged correction cannot silently overwrite a newer record.

**Steps**:
1. [ ] - `p1` - Receive `pin_item` or `propose_correction` and authorize its token, tool and referenced call/entity - `inst-stage-request`
2. [ ] - `p1` - Validate item kind or correction entity/field, current before value and evidence segment ids against rows permitted to this run - `inst-stage-validate`
3. [ ] - `p1` - Run `cpt-noter-algo-core-mcp-stage-write`; do not mark a primary item accepted or edit a segment, speaker or glossary - `inst-stage-store`
4. [ ] - `p1` - Pass `StagedOutput` through the same result gate; **RETURN** staged true and reference only after successful staging - `inst-stage-return`
5. [ ] - `p1` - Leave user application and Undo to the owning feature; stage replay must not act as approval - `inst-stage-review`

### Relay a live source lookup

- [ ] `p4` - **ID**: `cpt-noter-flow-core-mcp-live-relay`

**Actor**: Agent in an Ask or post-call run

**Success Scenarios**:
- A configured live tool appears under `live_<source>_<tool>` only when D1 permits it; every forwarded lookup has an audit row before it is sent.

**Error Scenarios**:
- Local only, Cloud with redaction, sensitive context, live tick or out-of-scope source: lookup is not allowed; audit failure sends nothing.

**Steps**:
1. [ ] - `p1` - Check the registered run is Ask or post-call, global privacy is Cloud allowed and the configured live source is permitted by scope and sensitivity - `inst-relay-policy`
2. [ ] - `p1` - Expose only the permitted live source's relayed tool name, never add the source server to the runtime's own MCP config - `inst-relay-name`
3. [ ] - `p1` - Before forwarding each call, ask the core egress gate to validate the destination and commit an `audit_log` lookup row with bytes, hash, source and run linkage - `inst-relay-audit`
4. [ ] - `p1` - Start or use the source's own transport and credentials; Noter does not copy a live source's token into its indexed-source Keychain store - `inst-relay-forward`
5. [ ] - `p1` - On return, retain live-lookup provenance and lookup time; cloud results also pass `cpt-noter-algo-core-mcp-release-result` before reaching the CLI - `inst-relay-result`
6. [ ] - `p1` - **RETURN** the permitted result or a scrubbed tool error; stop forwarding when the run is cancelled or its privacy changes - `inst-relay-return`

## 3. Processes / Business Logic (CDSL)

### Authenticate and authorize a socket request

- [ ] `p4` - **ID**: `cpt-noter-algo-core-mcp-authorize`

**Input**: `CoreSocketRequest`, registered active run context, current privacy and source policy.

**Output**: Trusted dispatch context or JSON-RPC error.

**Steps**:
1. [ ] - `p1` - Validate JSON-RPC version, method and typed params; reject malformed fields, invalid spans or limits with −32602 - `inst-auth-params`
2. [ ] - `p1` - Resolve the token against active runs using a comparison that does not disclose token prefixes; reject absent, unknown or expired tokens with −32001 - `inst-auth-token`
3. [ ] - `p1` - Require the request's run and call context to match the registered token; ignore child claims that would weaken cloud, privacy or scope restrictions - `inst-auth-context`
4. [ ] - `p1` - Check the run's tool allow-list and current privacy; disallow live source tools for ticks or any mode other than Cloud allowed - `inst-auth-tool`
5. [ ] - `p1` - Resolve each referenced entity under those restrictions; reject missing references with −32002 and forbidden references with −32001, without disclosing their content - `inst-auth-entity`
6. [ ] - `p1` - **RETURN** trusted context to the core dispatcher; no client-held context can authorize a broader read - `inst-auth-return`

### Release a result through the egress gate

- [ ] `p4` - **ID**: `cpt-noter-algo-core-mcp-release-result`

**Input**: Complete tool result, trusted run context, existing run redaction map and current source/privacy rows.

**Output**: Allowed local result, redacted and audited cloud result, or an error with no released data.

**Steps**:
1. [ ] - `p1` - Recheck run liveness and current privacy; remove sensitive and out-of-scope evidence before returning any nested text or metadata to a cloud run - `inst-release-recheck`
2. [ ] - `p1` - **IF** the run is cloud - `inst-release-cloud`
   1. [ ] - `p1` - Apply the run's existing redaction map and stable pseudonyms under the gate's effective privacy policy; never create inconsistent identities between initial packet and tool result - `inst-release-redact`
   2. [ ] - `p1` - DB: append one `audit_log` row of kind tool_result with `llm_run_id`, destination, byte size, hash and redaction-map reference before releasing the result - `inst-release-audit`
   3. [ ] - `p1` - **IF** redaction or audit persistence fails, **RETURN** −32603 and release no result body - `inst-release-failed`
3. [ ] - `p1` - Keep audio, voice profiles, credential values and raw redaction maps out of every response, including local runs - `inst-release-secrets`
4. [ ] - `p1` - **RETURN** the permitted result; diagnostics contain only ids, timing, sizes and scrubbed errors - `inst-release-return`

### Stage without applying primary changes

- [ ] `p4` - **ID**: `cpt-noter-algo-core-mcp-stage-write`

**Input**: Authorized `PinItemInput` or `ProposeCorrectionInput`, run id and validated evidence.

**Output**: `StagedOutput` referring to reviewable staged work.

**Steps**:
1. [ ] - `p1` - Recheck target existence, allowed field and current before value inside the writer boundary - `inst-staging-recheck`
2. [ ] - `p1` - Record the proposed pin or correction through the owning item/change service with actor llm_run, reason, evidence ids and a stable reference; retain proposed state - `inst-staging-write`
3. [ ] - `p1` - Commit staging and its change record together; rollback means no staged success result - `inst-staging-commit`
4. [ ] - `p1` - Publish only the owning service's staging notification after commit, never an applied primary edit - `inst-staging-publish`
5. [ ] - `p1` - **RETURN** staged true and reference; later user action must revalidate target state before applying - `inst-staging-return`

### Close a run and revoke access

- [ ] `p4` - **ID**: `cpt-noter-algo-core-mcp-close`

**Input**: Run completion, cancellation, timeout, CLI exit, stdio EOF or core shutdown.

**Output**: Closed child/socket resources and an unusable token.

**Steps**:
1. [ ] - `p1` - Revoke the run token before accepting further work and cancel outstanding tool and relay tasks - `inst-close-revoke`
2. [ ] - `p1` - Close sockets and stdio, stop the child and relay transports, and release per-call caches and in-memory redaction references - `inst-close-resources`
3. [ ] - `p1` - Remove secret-bearing per-run config files; do not erase committed audit or staged review records - `inst-close-files`
4. [ ] - `p1` - Reject late results and replayed token requests without returning evidence - `inst-close-late`
5. [ ] - `p1` - **RETURN** closed; startup cleanup discards stale configs whose runs no longer exist - `inst-close-return`

## 4. States (CDSL)

### Tool session lifecycle

- [ ] `p4` - **ID**: `cpt-noter-state-core-mcp-session`

**States**: registered, active, closing, closed

**Initial State**: registered after trusted run/token creation

**Transitions**:
1. [ ] - `p1` - **FROM** registered **TO** active **WHEN** the CLI child initializes and authenticates to the local socket - `inst-session-active`
2. [ ] - `p1` - **FROM** registered **TO** closing **WHEN** child startup fails or the run is cancelled before initialization - `inst-session-start-failed`
3. [ ] - `p1` - **FROM** active **TO** closing **WHEN** the run finishes, times out, is cancelled, loses its CLI or core shutdown begins; revoke the token first - `inst-session-closing`
4. [ ] - `p1` - **FROM** closing **TO** closed **WHEN** child, socket, relay and per-run secret config cleanup completes - `inst-session-closed`

Closed sessions cannot be reopened with their old token. Another run gets a new token and configuration. No persistent authentication or data cache belongs to the child.

## 5. Definitions of Done

### Local stdio and authenticated socket

- [ ] `p4` - **ID**: `cpt-noter-dod-core-mcp-transport`

The system **MUST** ship the signed Rust binary as a stdio child, serve protocol-derived tool schemas, use the 0600 Unix socket and bind every request to a live per-run token. It opens no TCP listener or database connection. Caller-supplied cloud and call fields cannot weaken trusted policy; JSON-RPC errors use exactly the four contract codes and retain the request id.

**Implements**:
- `cpt-noter-flow-core-mcp-start`
- `cpt-noter-algo-core-mcp-authorize`
- `cpt-noter-algo-core-mcp-close`
- `cpt-noter-state-core-mcp-session`

**Touches**:
- API: MCP stdio, `CoreSocketRequest`, `CoreSocketResponse`
- Entities: `McpRunContext`, per-run config and child resources

### Reads and cloud result gating

- [ ] `p4` - **ID**: `cpt-noter-dod-core-mcp-results`

The system **MUST** answer reads from shared retrieval and item/person services, preserve evidence ids, return empty screen chips in v1 and enforce source policy on every nested read. Cloud tool results pass the run's redaction map and commit a tool_result audit row before release. Failed audit writes return no body. Read-only services use the core's read pool; the binary never joins records itself.

**Implements**:
- `cpt-noter-flow-core-mcp-read`
- `cpt-noter-algo-core-mcp-release-result`

**Touches**:
- API: the seven declared read tools
- DB: core read models and `audit_log` through the existing gate
- Entities: call/document hits, span lines, `McpItem`

### Staged writes only

- [ ] `p4` - **ID**: `cpt-noter-dod-core-mcp-staging`

The system **MUST** validate pin and correction evidence and record reviewable proposed work through the existing writer and change-log services. A tool cannot accept its own proposal or apply a primary correction. `emit_card` remains unstable and is not implemented as the M3 staging path.

**Implements**:
- `cpt-noter-flow-core-mcp-stage`
- `cpt-noter-algo-core-mcp-stage-write`

**Touches**:
- API: `pin_item`, `propose_correction`
- DB: owning services' staged changes
- Entities: `StagedOutput`

### D1 relay and network evidence

- [ ] `p4` - **ID**: `cpt-noter-dod-core-mcp-relay`

The system **MUST** relay configured live source tools only for permitted Ask and post-call runs in Cloud allowed, write a lookup row before forwarding and gate each cloud result again. No live tick or isolated CLI config can start the user's server directly. The network-monitor test attributes configured source-host traffic to lookup rows and provider traffic to run rows; cloud tool-result rows link to the same run.

**Implements**:
- `cpt-noter-flow-core-mcp-live-relay`
- `cpt-noter-algo-core-mcp-release-result`

**Touches**:
- API: `live_<source>_<tool>` relay
- DB: existing `audit_log`, source metadata
- Entities: lookup provenance, run audit linkage

## 6. Acceptance Criteria

- [ ] A real core and scripted CLI exercise initialization, tools/list, all stable tools and socket round trips; listed schemas match the exported protocol schemas.
- [ ] Missing, wrong, expired or another run's token is rejected; spoofing cloud false or another call id cannot disclose sensitive evidence. Missing entities and malformed params return the documented JSON-RPC codes.
- [ ] Search defaults to eight call hits and caps at 30; all read tools exclude sensitive calls and sources for cloud runs, including recent calls and items nested under a person.
- [ ] A refined Ask lookup uses the same pseudonyms as its initial packet and writes a linked tool_result audit row before returning; forced audit failure releases no text.
- [ ] Staging a pin or correction returns a reference while the original record is unchanged; fabricated evidence and stale before values cannot apply a mutation.
- [ ] A matrix over privacy mode, sensitive context and task type permits live lookup only for eligible Ask/post-call Cloud allowed runs; every actual forwarding has a preceding lookup row. Network-monitor tests verify this on macOS.
- [ ] End, cancellation, timeout and CLI crash revoke the token, close transports and remove secret configs; replay and late results fail. The binary opens no TCP port and has no SQLite access.
- [ ] M3 adds no IPC command or DESIGN.md story to the milestone denominator for this feature; Ask stories remain counted only by their owning E2E tests against the real core.
- [ ] `just gate-fast` and `just gate` pass.
