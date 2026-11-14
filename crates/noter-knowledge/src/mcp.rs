//! Indexed MCP servers (TL-42): the [`McpSource`] seam the sync reads them through, the scripted
//! servers of tests and noter-core-harness, and the schedule an indexed source syncs on. The real
//! streamable-HTTP transport with the server's OAuth is noter-llm's; nothing here reaches the
//! network.

use noter_db::lock;
use noter_llm::{McpClient, Resource, Resources};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use noter_jobs::BoxFuture;
use noter_protocol::error::ValidationRule;
use noter_protocol::model::{SourceKind, SourceMode, SourceRow, SourceStatus};
use noter_protocol::{CoreError, ErrorCode, ErrorDetail, TimestampMs};
use serde::Deserialize;
use serde_json::json;

pub use noter_llm::{Audit, Call as Remote, Contents as Page, McpClientError as McpError};
pub type RemoteDoc = Resource;
pub type Listing = Resources;

pub(crate) fn mcp_error(error: McpError) -> CoreError {
    match error {
        McpError::Cancelled | McpError::AccessDenied => {
            CoreError::new(ErrorCode::SignInCancelled, "the sign-in was not completed")
        }
        McpError::Offline => CoreError::new(ErrorCode::Offline, "the server is offline"),
        McpError::Unauthorized => {
            CoreError::new(ErrorCode::SourceSignInExpired, "the sign-in has expired")
        }
        McpError::Invalid => CoreError::new(ErrorCode::InvalidInput, "an unknown server")
            .with_detail(ErrorDetail::Validation {
                field: "server".into(),
                rule: ValidationRule::InvalidFormat,
            }),
        McpError::Unaudited => {
            CoreError::new(ErrorCode::Internal, "the request could not be audited")
        }
    }
}

/// What the sync and `source_add_mcp` need from an MCP server.
pub trait McpSource: Send + Sync {
    /// The server's own OAuth sign-in, resolved with the token to keep.
    fn oauth<'a>(
        &'a self,
        server: &'a str,
        audit: Audit<'a>,
    ) -> BoxFuture<'a, Result<String, McpError>>;
    /// Its resources; `None` when the server offers none (the sync crawls seed queries then).
    fn list_resources<'a>(
        &'a self,
        remote: &'a Remote<'a>,
    ) -> BoxFuture<'a, Result<Option<Listing>, McpError>>;
    fn read_resource<'a>(
        &'a self,
        remote: &'a Remote<'a>,
        uri: &'a str,
    ) -> BoxFuture<'a, Result<Page, McpError>>;
    /// The server's search for `query`.
    fn seed_query<'a>(
        &'a self,
        remote: &'a Remote<'a>,
        query: &'a str,
    ) -> BoxFuture<'a, Result<Listing, McpError>>;
}

impl McpSource for McpClient {
    fn oauth<'a>(
        &'a self,
        server: &'a str,
        audit: Audit<'a>,
    ) -> BoxFuture<'a, Result<String, McpError>> {
        Box::pin(async move { self.sign_in(server, audit).await })
    }

    fn list_resources<'a>(
        &'a self,
        remote: &'a Remote<'a>,
    ) -> BoxFuture<'a, Result<Option<Listing>, McpError>> {
        Box::pin(async move { self.list(remote).await })
    }

    fn read_resource<'a>(
        &'a self,
        remote: &'a Remote<'a>,
        uri: &'a str,
    ) -> BoxFuture<'a, Result<Page, McpError>> {
        Box::pin(async move { self.read(remote, uri).await })
    }

    fn seed_query<'a>(
        &'a self,
        remote: &'a Remote<'a>,
        query: &'a str,
    ) -> BoxFuture<'a, Result<Listing, McpError>> {
        Box::pin(async move {
            self.search(remote, query).await.map(|items| Resources {
                items,
                complete: false,
            })
        })
    }
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptedListing {
    #[default]
    Complete,
    Partial,
    /// No resources: seed queries only.
    None,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptedOauth {
    #[default]
    Granted,
    Cancelled,
    Offline,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ScriptedPage {
    pub uri: String,
    pub title: String,
    #[serde(default)]
    pub hash: Option<String>,
    pub text: String,
    #[serde(default)]
    pub mime: Option<String>,
}

/// One scripted server: its pages, how it lists them, how its sign-in ends, when its tokens
/// expire and whether it is offline.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct ScriptedServer {
    pub pages: Vec<ScriptedPage>,
    pub listing: ScriptedListing,
    pub oauth: ScriptedOauth,
    pub expires_at: Option<TimestampMs>,
    pub offline: bool,
}

/// The MCP servers of tests and noter-core-harness, by name; any other name is an invalid
/// server, so the default answers no server at all.
pub struct ScriptedMcp {
    servers: Mutex<HashMap<String, ScriptedServer>>,
    /// The token each server issued last.
    issued: Mutex<HashMap<String, String>>,
    now: Arc<dyn Fn() -> TimestampMs + Send + Sync>,
}

impl Default for ScriptedMcp {
    fn default() -> Self {
        Self::new(Arc::new(|| TimestampMs(0)))
    }
}

impl ScriptedMcp {
    /// Tokens expire against `now`.
    pub fn new(now: Arc<dyn Fn() -> TimestampMs + Send + Sync>) -> Self {
        Self {
            servers: Mutex::default(),
            issued: Mutex::default(),
            now,
        }
    }

    /// Adds or replaces a server; tokens it issued stay valid.
    pub fn set(&self, name: &str, server: ScriptedServer) {
        lock(&self.servers).insert(name.into(), server);
    }

    /// The server, once the token is checked.
    fn serve(&self, name: &str, token: &str) -> Result<ScriptedServer, McpError> {
        let server = lock(&self.servers)
            .get(name)
            .cloned()
            .ok_or(McpError::Invalid)?;
        if server.offline {
            return Err(McpError::Offline);
        }
        let issued = lock(&self.issued).get(name).map(String::as_str) == Some(token);
        let expired = server.expires_at.is_some_and(|at| (self.now)() >= at);
        if !issued || expired {
            return Err(McpError::Unauthorized);
        }
        Ok(server)
    }
}

/// The scripted servers send nothing: one audit row per request stands for what would leave.
fn audited(remote: &Remote<'_>, server: &str, request: serde_json::Value) -> Result<(), McpError> {
    let bytes = request.to_string();
    (remote.audit)(server, bytes.as_bytes())
        .then_some(())
        .ok_or(McpError::Unaudited)
}

fn doc(p: &ScriptedPage) -> RemoteDoc {
    RemoteDoc {
        uri: p.uri.clone(),
        title: p.title.clone(),
        version: p.hash.clone(),
    }
}

impl McpSource for ScriptedMcp {
    fn oauth<'a>(
        &'a self,
        server: &'a str,
        _: Audit<'a>,
    ) -> BoxFuture<'a, Result<String, McpError>> {
        Box::pin(async move {
            let outcome = lock(&self.servers).get(server).map(|s| s.oauth.clone());
            match outcome.ok_or(McpError::Invalid)? {
                ScriptedOauth::Cancelled => Err(McpError::Cancelled),
                ScriptedOauth::Offline => Err(McpError::Offline),
                ScriptedOauth::Granted => {
                    let token = format!("tok_{}", ulid::Ulid::generate());
                    lock(&self.issued).insert(server.into(), token.clone());
                    Ok(token)
                }
            }
        })
    }

    fn list_resources<'a>(
        &'a self,
        remote: &'a Remote<'a>,
    ) -> BoxFuture<'a, Result<Option<Listing>, McpError>> {
        Box::pin(async move {
            audited(remote, remote.server, json!({ "method": "resources/list" }))?;
            let s = self.serve(remote.server, remote.token)?;
            let complete = match s.listing {
                ScriptedListing::None => return Ok(None),
                listing => listing == ScriptedListing::Complete,
            };
            let items = s.pages.iter().map(doc).collect();
            Ok(Some(Listing { items, complete }))
        })
    }

    fn read_resource<'a>(
        &'a self,
        remote: &'a Remote<'a>,
        uri: &'a str,
    ) -> BoxFuture<'a, Result<Page, McpError>> {
        Box::pin(async move {
            let request = json!({ "method": "resources/read", "params": { "uri": uri } });
            audited(remote, remote.server, request)?;
            let s = self.serve(remote.server, remote.token)?;
            let p = s
                .pages
                .iter()
                .find(|p| p.uri == uri)
                .ok_or(McpError::Invalid)?;
            Ok(Page {
                mime: p.mime.clone().unwrap_or_else(|| "text/markdown".into()),
                text: p.text.clone(),
            })
        })
    }

    fn seed_query<'a>(
        &'a self,
        remote: &'a Remote<'a>,
        query: &'a str,
    ) -> BoxFuture<'a, Result<Listing, McpError>> {
        Box::pin(async move {
            let request = json!({ "method": "seed_query", "params": { "query": query } });
            audited(remote, remote.server, request)?;
            let s = self.serve(remote.server, remote.token)?;
            let q = query.to_lowercase();
            let items = s
                .pages
                .iter()
                .filter(|p| {
                    p.title.to_lowercase().contains(&q) || p.text.to_lowercase().contains(&q)
                })
                .map(doc)
                .collect();
            Ok(Listing {
                items,
                complete: false,
            })
        })
    }
}

const HOUR_MS: i64 = 3_600_000;

/// The schedules an indexed MCP source can sync on, with their intervals.
const SCHEDULES: &[(&str, i64)] = &[
    ("hourly", HOUR_MS),
    ("daily", 24 * HOUR_MS),
    ("weekly", 7 * 24 * HOUR_MS),
];

/// What an indexed MCP source syncs on when the user picks nothing.
pub(crate) const DEFAULT_SCHEDULE: &str = "daily";

pub(crate) fn interval(schedule: &str) -> Option<i64> {
    SCHEDULES
        .iter()
        .find(|(name, _)| *name == schedule)
        .map(|(_, ms)| *ms)
}

/// Whether an indexed MCP source's schedule says it syncs now: never synced, or its interval
/// has passed since the last successful sync. A source without a token or whose sign-in expired
/// waits for the user; folders are watched and live sources are never indexed.
pub fn due(row: &SourceRow, now: TimestampMs) -> bool {
    let indexed_mcp = row.kind == SourceKind::Mcp && row.mode == SourceMode::Indexed;
    if !indexed_mcp || !row.has_token || row.status == SourceStatus::SignInExpired {
        return false;
    }
    let every = row.schedule.as_deref().and_then(interval);
    match (every, row.last_sync_at) {
        (Some(_), None) => true,
        (Some(every), Some(last)) => now.0 - last.0 >= every,
        (None, _) => false,
    }
}
