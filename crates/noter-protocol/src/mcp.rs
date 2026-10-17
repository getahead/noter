// @cpt-interface:cpt-noter-interface-mcp-tools:p1
//! noter-mcp tools and the noter-mcp ↔ core socket protocol
//! (`cpt-noter-interface-mcp-tools`).
//!
//! noter-mcp runs only locally and is never exposed to the network (O2). It is a
//! stdio child of Claude Code or Codex for one run, speaks MCP over stdio to the
//! CLI and JSON-RPC 2.0 over the core's Unix socket with a per-run token; it never
//! opens a TCP port and never opens the database (the core is the only writer).
//! The core's socket handler is part of the egress gate: for a run on a cloud
//! runtime, every tool result is redacted with the run's map and pseudonyms and
//! gets an `audit_log` row (`kind = tool_result`, linked by `llm_run_id`) before
//! it is returned. Each tool's input and output schema
//! is exported from these types into `contracts/mcp-tools.schema.json` and
//! served by noter-mcp in `tools/list`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::common::{
    AudioChannel, CallId, CallTypeId, ChunkId, DocumentId, ItemId, Lang, LocalDate, OffsetMs,
    PersonId, SegmentId, TimestampMs, TopicId,
};
use crate::skills::CardCandidate;

/// Tool names exactly as the CLIs see them (`mcp__noter__<name>`).
///
/// Live MCP sources (the user's own MCP servers) are never put in a run's MCP config. Only in
/// privacy mode "Cloud allowed" (owner decision D1), and only for post-call runs and Ask (never
/// live ticks), noter-mcp also relays their tools as `live_<source>_<tool>`: it starts the
/// server with its own transport and credentials and writes an `audit_log` row of kind `lookup`
/// through the core before forwarding each call. noter-mcp itself still opens no network port.
pub const TOOLS: &[(&str, bool)] = &[
    // (name, writes) — write tools only stage changes for the user.
    ("search_calls", false),
    ("search_documents", false),
    ("get_transcript_span", false),
    ("get_person", false),
    ("get_decisions", false),
    ("get_open_items", false),
    ("get_screen_context", false),
    ("pin_item", true),
    ("propose_correction", true),
    ("emit_card", true),
];

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct McpCallFilter {
    #[serde(default)]
    pub people: Vec<PersonId>,
    #[serde(default)]
    pub call_types: Vec<CallTypeId>,
    #[serde(default)]
    pub from: Option<LocalDate>,
    #[serde(default)]
    pub to: Option<LocalDate>,
    #[serde(default)]
    pub languages: Vec<Lang>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SearchCallsInput {
    pub query: String,
    #[serde(default)]
    pub filter: McpCallFilter,
    /// Default 8, maximum 30.
    pub k: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct CallHit {
    pub call_id: CallId,
    pub call_title: String,
    pub call_date: LocalDate,
    pub t0_ms: OffsetMs,
    pub t1_ms: OffsetMs,
    /// Speaker-prefixed lines ("Anna: …"); cite these ids as evidence.
    pub segment_ids: Vec<SegmentId>,
    pub text: String,
    pub strong: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SearchCallsOutput {
    pub hits: Vec<CallHit>,
    pub keyword_only: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SearchDocumentsInput {
    pub query: String,
    pub k: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct DocumentHit {
    pub document_id: DocumentId,
    pub chunk_id: ChunkId,
    pub title: String,
    pub heading_path: Vec<String>,
    pub source_name: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SearchDocumentsOutput {
    pub hits: Vec<DocumentHit>,
    /// Sensitive sources are never returned to a cloud runtime.
    pub sensitive_skipped: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct GetTranscriptSpanInput {
    pub call_id: CallId,
    pub t0_ms: OffsetMs,
    pub t1_ms: OffsetMs,
    pub channel: Option<AudioChannel>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SpanLine {
    pub segment_id: SegmentId,
    pub t0_ms: OffsetMs,
    pub speaker: String,
    pub lang: Lang,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct GetTranscriptSpanOutput {
    pub lines: Vec<SpanLine>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct GetPersonInput {
    /// Either an id or a name or alias ("Аня" finds Anna).
    pub person_id: Option<PersonId>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct McpItem {
    pub item_id: ItemId,
    pub kind: String,
    pub text: String,
    pub owner: Option<String>,
    pub due: Option<LocalDate>,
    pub status: String,
    pub call_id: CallId,
    pub call_date: LocalDate,
    pub evidence_segment_ids: Vec<SegmentId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct GetPersonOutput {
    pub person_id: PersonId,
    pub display_name: String,
    pub role: Option<String>,
    pub aliases: Vec<String>,
    pub recent_calls: Vec<CallId>,
    pub open_items: Vec<McpItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct GetDecisionsInput {
    pub topic_id: Option<TopicId>,
    pub query: Option<String>,
    #[serde(default)]
    pub people: Vec<PersonId>,
    pub since: Option<LocalDate>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ItemsOutput {
    pub items: Vec<McpItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct GetOpenItemsInput {
    #[serde(default)]
    pub people: Vec<PersonId>,
    pub owner: Option<PersonId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct GetScreenContextInput {
    pub call_id: CallId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ScreenContextOutput {
    pub chips: Vec<ScreenChip>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ScreenChip {
    pub label: String,
    pub app: String,
    pub at: TimestampMs,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct PinItemInput {
    pub call_id: CallId,
    /// decision | action_item | open_question | risk
    pub kind: String,
    pub text: String,
    pub owner_name: Option<String>,
    pub due: Option<LocalDate>,
    pub evidence_segment_ids: Vec<SegmentId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ProposeCorrectionInput {
    /// "segment" | "item" | "speaker" | "glossary"
    pub entity: String,
    pub entity_id: String,
    pub field: String,
    pub before: String,
    pub after: String,
    pub reason: String,
    pub evidence_segment_ids: Vec<SegmentId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct StagedOutput {
    /// Staged for the user's review; nothing changed yet.
    pub staged: bool,
    pub reference: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct EmitCardInput {
    pub card: CardCandidate,
}

// ── noter-mcp ↔ core socket ───────────────────────────────────

/// Context the core binds to a runtime it spawned. noter-mcp reads
/// `NOTER_MCP_TOKEN` from its environment and sends it with every request;
/// the core rejects any other connection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct McpRunContext {
    pub token: String,
    /// The `llm_runs` row this session belongs to.
    pub llm_run_id: String,
    pub call_id: Option<CallId>,
    /// Cloud runtimes never receive sensitive sources or sensitive calls, and every tool
    /// result for them is redacted and audited before it is returned.
    pub cloud: bool,
}

/// JSON-RPC 2.0 request on the Unix socket: `method` is the tool name.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct CoreSocketRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    pub context: McpRunContext,
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct CoreSocketError {
    /// -32602 invalid params, -32001 not allowed for this runtime, -32002 not found, -32603 internal.
    pub code: i32,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct CoreSocketResponse {
    pub jsonrpc: String,
    pub id: u64,
    pub result: Option<serde_json::Value>,
    pub error: Option<CoreSocketError>,
}
