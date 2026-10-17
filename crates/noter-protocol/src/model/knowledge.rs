//! Knowledge sources: folders and MCP servers.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Folder,
    Mcp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SourceMode {
    /// The agent queries it at answer time through the CLI's MCP config; Noter holds no token.
    Live,
    /// Synced into the local index on a schedule.
    Indexed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SourceScope {
    AllCalls,
    Limited {
        call_types: Vec<CallTypeId>,
        people: Vec<PersonId>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SourceStatus {
    Idle,
    Indexing {
        done: u32,
        total: Option<u32>,
    },
    Failed {
        code: crate::error::ErrorCode,
        at: TimestampMs,
    },
    SignInExpired,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SourceRow {
    pub id: SourceId,
    pub rev: Rev,
    pub kind: SourceKind,
    pub name: String,
    /// Folder path or MCP server name.
    pub location: String,
    pub mode: SourceMode,
    /// Cron-like, "hourly", "daily"; folders are watched continuously.
    pub schedule: Option<String>,
    pub privacy: PrivacyClass,
    pub scope: SourceScope,
    pub status: SourceStatus,
    pub documents: u32,
    pub last_sync_at: Option<TimestampMs>,
    pub has_token: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SourceList {
    pub sources: Vec<SourceRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SourceAddFolderArgs {
    /// `null` = the core shows the open panel (grants a security-scoped bookmark).
    pub path: Option<String>,
    pub privacy: PrivacyClass,
    pub scope: SourceScope,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SourceAddMcpArgs {
    pub server: String,
    pub mode: SourceMode,
    pub schedule: Option<String>,
    pub privacy: PrivacyClass,
    pub scope: SourceScope,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SourceUpdateArgs {
    pub source_id: SourceId,
    pub rev: Rev,
    pub name: Option<String>,
    pub schedule: Option<String>,
    pub privacy: Option<PrivacyClass>,
    pub scope: Option<SourceScope>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SourceIdArgs {
    pub source_id: SourceId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct OpenDocumentArgs {
    pub document_id: DocumentId,
    pub chunk_id: Option<ChunkId>,
}
