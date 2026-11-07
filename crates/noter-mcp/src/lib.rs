//! noter-mcp: MCP over stdio for one runtime run, forwarded to the core over its Unix socket
//! (`cpt-noter-flow-core-mcp-start`, `cpt-noter-flow-core-mcp-read`).
//!
//! Both transports carry one JSON-RPC 2.0 message per line (newline-delimited JSON). The binary
//! reads the Noter-written run config (`socket`, `run_id`, `call_id`, `cloud`, `tools`) and the
//! run's token (`NOTER_MCP_TOKEN`), and sends each `tools/call` as a `CoreSocketRequest`. It
//! holds no database and opens no TCP port; stdout carries MCP messages only, and stderr only
//! fixed words (never a token, path or tool text).

use std::path::PathBuf;

use noter_protocol::mcp::{CoreSocketRequest, CoreSocketResponse, McpRunContext};
use noter_protocol::CallId;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixStream;

/// The exported tool schemas (`contracts/mcp-tools.schema.json`), embedded so `tools/list`
/// serves exactly the contract.
const SCHEMAS: &str = include_str!("../../../contracts/mcp-tools.schema.json");

/// MCP's revision when the client names none.
const PROTOCOL: &str = "2025-06-18";

/// What the core writes to `run/mcp/<run_id>.json`.
#[derive(Deserialize)]
struct Config {
    socket: PathBuf,
    run_id: String,
    call_id: Option<CallId>,
    cloud: bool,
    tools: Vec<String>,
}

fn describe(tool: &str) -> &'static str {
    match tool {
        "search_calls" => "Search the user's calls; cite the returned segment ids as evidence.",
        "search_documents" => "Search the user's indexed documents.",
        "get_transcript_span" => "Read the transcript lines of one call between two offsets.",
        "get_person" => {
            "Look up a person by id or by name or alias, with recent calls and open items."
        }
        "get_decisions" => "List decisions, optionally by topic, text, people or date.",
        "get_open_items" => "List open action items, optionally by people or owner.",
        "get_screen_context" => "Screen context of a call (empty in v1).",
        "pin_item" => "Propose an item for the user to review; nothing changes until they accept.",
        "propose_correction" => "Propose a correction for the user to review; nothing changes yet.",
        _ => "Noter tool.",
    }
}

/// A relayed live-source tool (`live_<source>_search` or `_read`): the core names it in the run's
/// config only when D1 permits it, and answers it after the audit row; its schema is fixed here
/// because the source's own tools are never described to the runtime.
// @cpt-begin:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-name
fn live_tool(name: &str) -> Option<Value> {
    let (description, field) = if name.starts_with("live_") && name.ends_with("_search") {
        ("Search one of the user's connected sources live.", "query")
    } else if name.starts_with("live_") && name.ends_with("_read") {
        ("Read one page of a connected source by its uri.", "uri")
    } else {
        return None;
    };
    Some(json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": { field: { "type": "string" } },
            "required": [field],
        },
    }))
}
// @cpt-end:cpt-noter-flow-core-mcp-live-relay:p1:inst-relay-name

/// Starts the server: reads the config, connects the core socket, then serves `input`/`output`
/// until the client closes it. The error is a fixed word for stderr.
pub async fn run<R, W>(
    config_path: &str,
    token: String,
    input: R,
    output: W,
) -> Result<(), &'static str>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let config: Config = std::fs::read(config_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .ok_or("cannot read the run config")?;
    // @cpt-begin:cpt-noter-flow-core-mcp-start:p1:inst-start-return
    let (read, write) = UnixStream::connect(&config.socket)
        .await
        .map_err(|_| "cannot reach the core socket")?
        .into_split();
    // @cpt-end:cpt-noter-flow-core-mcp-start:p1:inst-start-return
    let mut server = Server {
        context: McpRunContext {
            token,
            llm_run_id: config.run_id,
            call_id: config.call_id,
            cloud: config.cloud,
        },
        tools: config.tools,
        schemas: serde_json::from_str(SCHEMAS).map_err(|_| "bad embedded schemas")?,
        socket: (BufReader::new(read), write),
        next_id: 0,
    };
    let mut lines = BufReader::new(input).lines();
    let mut output = output;
    while let Ok(Some(line)) = lines.next_line().await {
        let Some(reply) = server.handle(&line).await else {
            continue;
        };
        let mut bytes = reply.to_string().into_bytes();
        bytes.push(b'\n');
        if output.write_all(&bytes).await.is_err() || output.flush().await.is_err() {
            break;
        }
    }
    Ok(())
}

struct Server {
    context: McpRunContext,
    tools: Vec<String>,
    schemas: Value,
    socket: (BufReader<OwnedReadHalf>, OwnedWriteHalf),
    next_id: u64,
}

fn failure(id: Value, code: i32, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

impl Server {
    /// One MCP message; `None` for a notification. Requests are served one at a time (shortcut:
    /// a slow tool delays the next message; a run's agent calls tools one by one).
    async fn handle(&mut self, line: &str) -> Option<Value> {
        let Ok(msg) = serde_json::from_str::<Value>(line) else {
            return Some(failure(Value::Null, -32700, "parse error"));
        };
        let id = msg.get("id").cloned()?;
        let params = msg.get("params");
        // @cpt-begin:cpt-noter-flow-core-mcp-start:p1:inst-start-tools
        let result = match msg["method"].as_str() {
            Some("initialize") => json!({
                "protocolVersion": params
                    .and_then(|p| p["protocolVersion"].as_str())
                    .unwrap_or(PROTOCOL),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "noter", "version": env!("CARGO_PKG_VERSION") },
            }),
            Some("ping") => json!({}),
            Some("tools/list") => self.list(),
            Some("tools/call") => return Some(self.call(id, params).await),
            _ => return Some(failure(id, -32601, "method not found")),
        };
        // @cpt-end:cpt-noter-flow-core-mcp-start:p1:inst-start-tools
        Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
    }

    fn list(&self) -> Value {
        let tools: Vec<Value> = self
            .tools
            .iter()
            .filter_map(|name| {
                if let Some(live) = live_tool(name) {
                    return Some(live);
                }
                let t = self.schemas.get(name)?;
                Some(json!({
                    "name": name,
                    "description": describe(name),
                    "inputSchema": t["input"],
                    "outputSchema": t["output"],
                }))
            })
            .collect();
        json!({ "tools": tools })
    }

    async fn call(&mut self, id: Value, params: Option<&Value>) -> Value {
        let Some(name) = params.and_then(|p| p["name"].as_str()) else {
            return failure(id, -32602, "tools/call needs a name");
        };
        let args = match params.and_then(|p| p.get("arguments")) {
            None | Some(Value::Null) => json!({}),
            Some(args) => args.clone(),
        };
        // @cpt-begin:cpt-noter-flow-core-mcp-read:p1:inst-read-return
        match self.forward(name, args).await {
            Some(CoreSocketResponse { error: Some(e), .. }) => failure(id, e.code, &e.message),
            Some(CoreSocketResponse {
                result: Some(result),
                ..
            }) => json!({ "jsonrpc": "2.0", "id": id, "result": {
                "content": [{ "type": "text", "text": result.to_string() }],
                "structuredContent": result,
            } }),
            _ => failure(id, -32603, "the core gave no answer"),
        }
        // @cpt-end:cpt-noter-flow-core-mcp-read:p1:inst-read-return
    }

    /// One `CoreSocketRequest` and its response; the evidence ids in `result` pass through
    /// unchanged. `None` when the socket is closed, or answers another request.
    // @cpt-begin:cpt-noter-flow-core-mcp-read:p1:inst-read-forward
    async fn forward(&mut self, method: &str, params: Value) -> Option<CoreSocketResponse> {
        self.next_id += 1;
        let request = CoreSocketRequest {
            jsonrpc: "2.0".into(),
            id: self.next_id,
            method: method.into(),
            context: self.context.clone(),
            params,
        };
        let mut bytes = serde_json::to_vec(&request).ok()?;
        bytes.push(b'\n');
        let (reader, writer) = &mut self.socket;
        writer.write_all(&bytes).await.ok()?;
        let mut line = String::new();
        reader.read_line(&mut line).await.ok()?;
        let response: CoreSocketResponse = serde_json::from_str(&line).ok()?;
        (response.id == request.id).then_some(response)
    }
    // @cpt-end:cpt-noter-flow-core-mcp-read:p1:inst-read-forward
}
