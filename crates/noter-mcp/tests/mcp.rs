//! FEATURE cpt-noter-feature-core-mcp (slice 1): a real core on a temp data folder and the
//! built `noter-mcp` binary speaking MCP over its stdio, plus raw socket requests for what the
//! binary never sends (spoofed context, malformed frames).

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use noter_core::{Clock, Core, CoreDeps, EventEmitter, McpRegistration, McpSession};
use noter_engine_client::scripted::ScriptedEngine;
use noter_llm::{Adapters, Scripted};
use noter_protocol::{CallId, TimestampMs};
use noter_retrieval::Embedder;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

const NOW: i64 = 1_792_137_600_000;
const ALL: [&str; 9] = [
    "search_calls",
    "search_documents",
    "pin_item",
    "propose_correction",
    "get_transcript_span",
    "get_person",
    "get_decisions",
    "get_open_items",
    "get_screen_context",
];

struct Quiet;

impl EventEmitter for Quiet {
    fn emit(&self, _: &'static str, _: Value) {}
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(NOW)
    }
}

/// Three calls (`call_o` older, `call_a` normal, `call_s` sensitive), a person across a Russian
/// and an English name, and items of every state.
const SEED: &str = "
INSERT INTO calls (id, rev, started_at, ended_at, title, call_type, status, mode_used, privacy_class) VALUES
  ('call_o', 1, 1792000000000, 1792000600000, 'Older', 'planning', 'ready', 'cloud', 'normal'),
  ('call_a', 1, 1792130000000, 1792130600000, 'Planning', 'planning', 'ready', 'cloud', 'normal'),
  ('call_s', 1, 1792135000000, 1792135600000, 'Secret', 'planning', 'ready', 'local_only', 'sensitive');
INSERT INTO people (id, rev, display_name, short_name, role) VALUES
  ('person_anna', 1, 'Anna', 'Anna', 'Engineer'),
  ('person_boris', 1, 'Boris', 'Boris', NULL);
INSERT INTO person_aliases (id, person_id, alias, alias_norm) VALUES ('al_1', 'person_anna', 'Аня', 'аня');
INSERT INTO speakers (id, call_id, label, n, channel, person_id, named_by, name, pass) VALUES
  ('sp_o', 'call_o', 'spk_1', 1, 'sys', 'person_anna', 'you', 'Аня', 'live'),
  ('sp_a', 'call_a', 'spk_1', 1, 'sys', 'person_anna', 'you', 'Anna', 'live'),
  ('sp_b', 'call_a', 'spk_2', 2, 'sys', NULL, NULL, NULL, 'live'),
  ('sp_s', 'call_s', 'spk_1', 1, 'sys', 'person_boris', 'you', 'Boris', 'live');
INSERT INTO segments (id, call_id, speaker_id, channel, t0_ms, t1_ms, text, text_norm, lang, pass) VALUES
  ('seg_1', 'call_a', 'sp_a', 'sys', 0, 5000, 'We will ship the importer.', 'we will ship the importer.', 'en', 'live'),
  ('seg_2', 'call_a', 'sp_b', 'sys', 6000, 9000, 'Report by Friday.', 'report by friday.', 'en', 'live'),
  ('seg_s', 'call_s', 'sp_s', 'sys', 0, 5000, 'Hidden words.', 'hidden words.', 'en', 'live');
INSERT INTO items (id, rev, call_id, kind, text, lang, status, review_state, created_by, owner_person_id) VALUES
  ('it_dec', 1, 'call_a', 'decision', 'Ship the importer', 'en', 'open', 'accepted', 'llm', 'person_anna'),
  ('it_act', 1, 'call_a', 'action_item', 'Send the report', 'en', 'open', 'accepted', 'llm', 'person_anna'),
  ('it_done', 1, 'call_a', 'action_item', 'Done thing', 'en', 'done', 'accepted', 'llm', 'person_anna'),
  ('it_rej', 1, 'call_a', 'action_item', 'Rejected thing', 'en', 'open', 'rejected', 'llm', 'person_anna'),
  ('it_sec', 1, 'call_s', 'action_item', 'Secret thing', 'en', 'open', 'accepted', 'llm', 'person_boris'),
  ('it_nob', 1, 'call_a', 'open_question', 'Who owns it?', 'en', 'open', 'suggested', 'llm', NULL);
INSERT INTO item_spans (item_id, call_id, t0_ms, t1_ms) VALUES ('it_dec', 'call_a', 0, 5000);
";

struct Rig {
    core: Arc<Core>,
    scripted: Scripted,
    dir: tempfile::TempDir,
    socket: PathBuf,
}

async fn rig() -> Rig {
    rig_with("").await
}

/// A run that never answers on its own for ten minutes: its tool server stays up.
const HOLD: &str = r#"{"on": "role-review", "after_ms": 600000}"#;

/// A core whose runtimes are the scripted one (`script`) and whose tool server is the built
/// `noter-mcp`.
async fn rig_with(script: &str) -> Rig {
    rig_mcp(script, |_| Arc::new(noter_core::ScriptedMcp::default())).await
}

/// [`rig_with`] whose live and indexed MCP sources are `mcp(data folder)`.
async fn rig_mcp(script: &str, mcp: impl FnOnce(&Path) -> Arc<dyn noter_core::McpSource>) -> Rig {
    rig_all(script, mcp, false).await
}

/// [`rig_mcp`] with the scripted engine embedding queries (`engine`), else no engine.
async fn rig_all(
    script: &str,
    mcp: impl FnOnce(&Path) -> Arc<dyn noter_core::McpSource>,
    engine: bool,
) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let scripted = Scripted::parse(script).unwrap();
    let mut deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(Quiet))
        .with_llm(Adapters::scripted(&scripted))
        .with_mcp_source(mcp(dir.path()))
        .with_mcp_binary(env!("CARGO_BIN_EXE_noter-mcp").into());
    if engine {
        let launcher = ScriptedEngine::new().with_container(dir.path());
        deps = deps.with_engine(Arc::new(launcher));
    }
    let core = Arc::new(Core::open(dir.path(), deps).expect("core opens"));
    noter_db::rusqlite::Connection::open(dir.path().join("noter.db"))
        .unwrap()
        .execute_batch(SEED)
        .unwrap();
    let socket = core.serve_socket().await.expect("socket serves");
    Rig {
        core,
        scripted,
        dir,
        socket,
    }
}

impl Rig {
    fn register(
        &self,
        id: &str,
        call: Option<&str>,
        cloud: bool,
        tools: &[&str],
    ) -> (String, PathBuf) {
        self.core
            .register_mcp_run(McpRegistration {
                llm_run_id: id.into(),
                call_id: call.map(CallId::new),
                cloud,
                tools: tools.iter().map(|t| (*t).to_owned()).collect(),
                live: false,
            })
            .expect("run registers")
    }

    /// A cloud run as the router starts it: a scripted Claude run whose packet names `people`,
    /// held open, with its tool server registered through the host. `(run id, token, config)`.
    async fn cloud(&self, call: Option<&str>, people: &[&str]) -> (String, String, PathBuf) {
        let people = people.iter().map(|p| (*p).to_owned()).collect();
        let tools = ALL.iter().map(|t| (*t).to_owned()).collect();
        let run =
            noter_core::testing::mcp_cloud_run(&self.core, call.map(CallId::new), tools, people)
                .await
                .expect("the run starts");
        (
            run["run_id"].as_str().unwrap().to_owned(),
            run["token"].as_str().unwrap().to_owned(),
            PathBuf::from(run["config"].as_str().unwrap()),
        )
    }

    fn sql(&self, sql: &str) -> Vec<Value> {
        let db = noter_db::rusqlite::Connection::open(self.dir.path().join("noter.db")).unwrap();
        let mut stmt = db.prepare(sql).unwrap();
        let names: Vec<String> = stmt.column_names().map(str::to_owned).collect();
        stmt.query_map([], |r| {
            let mut row = serde_json::Map::new();
            for (i, name) in names.iter().enumerate() {
                let value = match r.get_ref(i)? {
                    noter_db::rusqlite::types::ValueRef::Integer(n) => json!(n),
                    noter_db::rusqlite::types::ValueRef::Text(t) => {
                        json!(String::from_utf8_lossy(t))
                    }
                    _ => Value::Null,
                };
                row.insert(name.clone(), value);
            }
            Ok(Value::Object(row))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
    }

    fn local(&self, id: &str) -> (String, PathBuf) {
        self.register(id, None, false, &ALL)
    }
}

/// The binary on a run's config, its stdio as MCP lines.
struct Mcp {
    /// Kept so the process dies with the test (`kill_on_drop`).
    _child: Child,
    stdin: ChildStdin,
    out: BufReader<ChildStdout>,
    next: u64,
}

impl Mcp {
    async fn start(config: &Path, token: &str) -> Mcp {
        let mut child = Command::new(env!("CARGO_BIN_EXE_noter-mcp"))
            .arg(config)
            .env("NOTER_MCP_TOKEN", token)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let out = BufReader::new(child.stdout.take().unwrap());
        Mcp {
            _child: child,
            stdin,
            out,
            next: 0,
        }
    }

    async fn send(&mut self, msg: Value) {
        self.stdin
            .write_all(format!("{msg}\n").as_bytes())
            .await
            .unwrap();
    }

    async fn line(&mut self) -> Value {
        let mut line = String::new();
        self.out.read_line(&mut line).await.unwrap();
        serde_json::from_str(&line).expect("stdout holds only MCP messages")
    }

    /// The response to one request.
    async fn rpc(&mut self, method: &str, params: Value) -> Value {
        self.next += 1;
        let id = self.next;
        self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await;
        let reply = self.line().await;
        assert_eq!(reply["id"], id, "the response keeps the request id");
        reply
    }

    /// A tool's `structuredContent`, or its error code.
    async fn tool(&mut self, name: &str, args: Value) -> Result<Value, i64> {
        let reply = self
            .rpc("tools/call", json!({ "name": name, "arguments": args }))
            .await;
        match reply["error"]["code"].as_i64() {
            Some(code) => Err(code),
            None => {
                let result = &reply["result"];
                let text: Value =
                    serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
                assert_eq!(text, result["structuredContent"]);
                Ok(result["structuredContent"].clone())
            }
        }
    }
}

/// Request lines on one socket connection as the binary would send them, with the context
/// spelled out; the answers in order.
async fn raw(socket: &Path, lines: &[Value]) -> Vec<Value> {
    let (read, mut write) = UnixStream::connect(socket).await.unwrap().into_split();
    let mut read = BufReader::new(read);
    let mut replies = vec![];
    for line in lines {
        let text = line
            .as_str()
            .map_or_else(|| line.to_string(), str::to_owned);
        write
            .write_all(format!("{text}\n").as_bytes())
            .await
            .unwrap();
        let mut reply = String::new();
        read.read_line(&mut reply).await.unwrap();
        replies.push(serde_json::from_str(&reply).unwrap());
    }
    replies
}

fn request(id: u64, method: &str, token: &str, run: &str, cloud: bool, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params,
            "context": { "token": token, "llm_run_id": run, "call_id": null, "cloud": cloud } })
}

fn code(reply: &Value) -> i64 {
    reply["error"]["code"].as_i64().expect("an error answer")
}

fn ids(result: &Value) -> Vec<&str> {
    result["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["item_id"].as_str().unwrap())
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn initialize_lists_exactly_the_exported_schemas() {
    let rig = rig().await;
    // `emit_card` is unstable: it is neither served nor listed.
    let (token, config) = rig.register(
        "run_1",
        None,
        false,
        &[
            "search_calls",
            "emit_card",
            "get_person",
            "get_decisions",
            "get_decisions",
        ],
    );
    assert_eq!(rig.core.mcp_session("run_1"), Some(McpSession::Registered));
    let mut mcp = Mcp::start(&config, &token).await;

    let init = mcp
        .rpc(
            "initialize",
            json!({ "protocolVersion": "2025-06-18", "capabilities": {},
                    "clientInfo": { "name": "t", "version": "1" } }),
        )
        .await;
    assert_eq!(init["result"]["serverInfo"]["name"], "noter");
    assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
    // A notification gets no answer: the next line on stdout is the ping's.
    mcp.send(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
        .await;
    assert_eq!(mcp.rpc("ping", json!({})).await["result"], json!({}));

    let listed = mcp.rpc("tools/list", json!({})).await;
    let schemas: Value = serde_json::from_str(
        &std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../contracts/mcp-tools.schema.json"
        ))
        .unwrap(),
    )
    .unwrap();
    let tools = listed["result"]["tools"].as_array().unwrap();
    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["search_calls", "get_person", "get_decisions"]);
    for tool in tools {
        let name = tool["name"].as_str().unwrap();
        assert_eq!(tool["inputSchema"], schemas[name]["input"]);
        assert_eq!(tool["outputSchema"], schemas[name]["output"]);
    }

    assert_eq!(
        mcp.rpc("resources/list", json!({})).await["error"]["code"],
        -32601
    );
    assert_eq!(
        mcp.rpc("tools/call", json!({})).await["error"]["code"],
        -32602
    );
    mcp.stdin.write_all(b"not json\n").await.unwrap();
    assert_eq!(mcp.line().await["error"]["code"], -32700);

    // The child authenticated with its first tool call: registered → active.
    assert_eq!(rig.core.mcp_session("run_1"), Some(McpSession::Registered));
    mcp.tool("get_person", json!({ "person_id": "person_anna" }))
        .await
        .unwrap();
    assert_eq!(rig.core.mcp_session("run_1"), Some(McpSession::Active));
}

#[tokio::test(flavor = "multi_thread")]
async fn every_slice_one_tool_round_trips() {
    let rig = rig().await;
    let (token, config) = rig.local("run_1");
    let mut mcp = Mcp::start(&config, &token).await;

    let span = mcp
        .tool(
            "get_transcript_span",
            json!({ "call_id": "call_a", "t0_ms": 0, "t1_ms": 6000 }),
        )
        .await
        .unwrap();
    assert_eq!(
        span["lines"],
        json!([{ "segment_id": "seg_1", "t0_ms": 0, "speaker": "Anna", "lang": "en",
                 "text": "We will ship the importer." }])
    );
    let both = mcp
        .tool(
            "get_transcript_span",
            json!({ "call_id": "call_a", "t0_ms": 0, "t1_ms": 9000, "channel": "sys" }),
        )
        .await
        .unwrap();
    assert_eq!(both["lines"][1]["speaker"], "Speaker 2");

    let by_id = mcp
        .tool("get_person", json!({ "person_id": "person_anna" }))
        .await
        .unwrap();
    assert_eq!(by_id["display_name"], "Anna");
    assert_eq!(by_id["aliases"], json!(["Аня"]));
    assert_eq!(by_id["role"], "Engineer");
    assert_eq!(by_id["recent_calls"], json!(["call_a", "call_o"]));
    let open: Vec<&str> = by_id["open_items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["item_id"].as_str().unwrap())
        .collect();
    assert_eq!(
        open,
        ["it_act"],
        "done, rejected and decision items are not open"
    );
    // The Russian name finds the same person, case folded.
    let by_name = mcp
        .tool("get_person", json!({ "name": "аня" }))
        .await
        .unwrap();
    assert_eq!(by_name["person_id"], "person_anna");

    let decisions = mcp.tool("get_decisions", json!({})).await.unwrap();
    assert_eq!(ids(&decisions), ["it_dec"]);
    let d = &decisions["items"][0];
    assert_eq!(d["kind"], "decision");
    assert_eq!(d["owner"], "Anna");
    assert_eq!(d["call_id"], "call_a");
    assert_eq!(d["call_date"], "2026-10-16");
    assert_eq!(d["evidence_segment_ids"], json!(["seg_1"]));
    for filter in [
        json!({ "query": "IMPORTER" }),
        json!({ "people": ["person_anna"] }),
        json!({ "since": "2026-10-16" }),
    ] {
        let found = mcp.tool("get_decisions", filter.clone()).await.unwrap();
        assert_eq!(ids(&found), ["it_dec"], "{filter}");
    }
    for filter in [
        json!({ "query": "nothing like it" }),
        json!({ "people": ["person_x"] }),
        json!({ "since": "2026-10-17" }),
        json!({ "topic_id": "topic_x" }),
    ] {
        let found = mcp.tool("get_decisions", filter.clone()).await.unwrap();
        assert!(ids(&found).is_empty(), "{filter}");
    }

    let all = mcp.tool("get_open_items", json!({})).await.unwrap();
    // Newest item first; a local run sees the sensitive call's items too.
    assert_eq!(ids(&all), ["it_nob", "it_sec", "it_act"]);
    let owned = mcp
        .tool("get_open_items", json!({ "owner": "person_anna" }))
        .await
        .unwrap();
    assert_eq!(ids(&owned), ["it_act"]);
    let people = mcp
        .tool(
            "get_open_items",
            json!({ "people": ["person_boris", "person_anna"] }),
        )
        .await
        .unwrap();
    assert_eq!(ids(&people), ["it_sec", "it_act"]);

    let screen = mcp
        .tool("get_screen_context", json!({ "call_id": "call_a" }))
        .await
        .unwrap();
    assert_eq!(screen, json!({ "chips": [] }));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_token_that_is_missing_wrong_or_another_runs_is_refused() {
    let rig = rig().await;
    let (token_1, config_1) = rig.local("run_1");
    let (token_2, config_2) = rig.local("run_2");
    let ask = json!({ "person_id": "person_anna" });

    let mut wrong = Mcp::start(&config_1, "0".repeat(64).as_str()).await;
    assert_eq!(wrong.tool("get_person", ask.clone()).await, Err(-32001));
    // Run 2's token with run 1's config: the token is live but not that run's.
    let mut other = Mcp::start(&config_1, &token_2).await;
    assert_eq!(other.tool("get_person", ask.clone()).await, Err(-32001));
    let mut right = Mcp::start(&config_2, &token_2).await;
    assert!(right.tool("get_person", ask.clone()).await.is_ok());
    // A token and its own run's id, on a tool the run was not given.
    let (token_3, config_3) = rig.register("run_3", None, false, &["get_person"]);
    let mut narrow = Mcp::start(&config_3, &token_3).await;
    assert_eq!(narrow.tool("get_decisions", json!({})).await, Err(-32001));
    assert_eq!(narrow.tool("pin_item", json!({})).await, Err(-32001));
    assert_eq!(narrow.tool("no_such_tool", json!({})).await, Err(-32001));

    let binary = || {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_noter-mcp"));
        cmd.stdin(Stdio::null()).stderr(Stdio::null());
        cmd
    };
    // No token at all: the binary does not start.
    let status = binary()
        .arg(&config_1)
        .env_remove("NOTER_MCP_TOKEN")
        .status()
        .await
        .unwrap();
    assert_eq!(status.code(), Some(2));
    // Nor without a readable config, or on a socket nobody listens on.
    let status = binary()
        .arg(rig.dir.path().join("none.json"))
        .env("NOTER_MCP_TOKEN", &token_1)
        .status()
        .await
        .unwrap();
    assert_eq!(status.code(), Some(2));
    let stale = rig.dir.path().join("stale.json");
    let body = json!({ "socket": rig.dir.path().join("no.sock"), "run_id": "r",
                       "call_id": null, "cloud": false, "tools": [] });
    std::fs::write(&stale, body.to_string()).unwrap();
    let status = binary()
        .arg(&stale)
        .env("NOTER_MCP_TOKEN", &token_1)
        .status()
        .await
        .unwrap();
    assert_eq!(status.code(), Some(2));
    // The config path may come from the environment; with stdin closed the server just ends.
    let status = binary()
        .env("NOTER_MCP_CONFIG", &config_1)
        .env("NOTER_MCP_TOKEN", &token_1)
        .status()
        .await
        .unwrap();
    assert_eq!(status.code(), Some(0));
}

#[tokio::test(flavor = "multi_thread")]
async fn malformed_params_are_invalid_and_unknown_entities_are_missing() {
    let rig = rig().await;
    let (token, config) = rig.local("run_1");
    let mut mcp = Mcp::start(&config, &token).await;

    let span = |t0: i64, t1: i64| json!({ "call_id": "call_a", "t0_ms": t0, "t1_ms": t1 });
    for (tool, args) in [
        ("get_transcript_span", span(5, 5)),
        ("get_transcript_span", span(6, 5)),
        ("get_transcript_span", span(-1, 5)),
        ("get_transcript_span", json!({ "t0_ms": 0, "t1_ms": 5 })),
        (
            "get_transcript_span",
            json!({ "call_id": 7, "t0_ms": 0, "t1_ms": 5 }),
        ),
        ("get_transcript_span", json!("text")),
        ("get_person", json!({})),
        ("get_person", json!({ "name": "  " })),
        ("get_decisions", json!({ "since": "yesterday" })),
        ("get_decisions", json!({ "people": "anna" })),
        ("get_open_items", json!({ "owner": 3 })),
        ("get_screen_context", json!({})),
    ] {
        assert_eq!(
            mcp.tool(tool, args.clone()).await,
            Err(-32602),
            "{tool} {args}"
        );
    }
    for (tool, args) in [
        (
            "get_transcript_span",
            json!({ "call_id": "call_x", "t0_ms": 0, "t1_ms": 5 }),
        ),
        ("get_person", json!({ "person_id": "person_x" })),
        ("get_person", json!({ "name": "Nobody" })),
        ("get_screen_context", json!({ "call_id": "call_x" })),
    ] {
        assert_eq!(
            mcp.tool(tool, args.clone()).await,
            Err(-32002),
            "{tool} {args}"
        );
    }

    // On the socket itself: a frame that is no request, a wrong version, an id kept anyway.
    let replies = raw(
        &rig.socket,
        &[
            json!("{broken"),
            json!({ "id": 7, "jsonrpc": "1.0" }),
            json!({ "jsonrpc": "1.0", "id": 9, "method": "get_person", "params": {},
                    "context": { "token": token, "llm_run_id": "run_1",
                                 "call_id": null, "cloud": false } }),
        ],
    )
    .await;
    assert_eq!(
        (code(&replies[0]), replies[0]["id"].clone()),
        (-32602, json!(0))
    );
    assert_eq!(
        (code(&replies[1]), replies[1]["id"].clone()),
        (-32602, json!(7))
    );
    assert_eq!(
        (code(&replies[2]), replies[2]["id"].clone()),
        (-32602, json!(9))
    );
    // An over-long frame ends the connection without an answer.
    let (read, mut write) = UnixStream::connect(&rig.socket).await.unwrap().into_split();
    let mut big = "x".repeat((1 << 20) + 10);
    big.push('\n');
    let _ = write.write_all(big.as_bytes()).await;
    let mut rest = String::new();
    let _ = BufReader::new(read).read_line(&mut rest).await;
    assert!(rest.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cloud_run_cannot_widen_its_context_or_read_a_sensitive_call() {
    let rig = rig().await;
    let (token, _) = rig.register("run_c", None, true, &ALL);
    // The child claims cloud false and a call of its own: the registered context rules.
    let claim = |id: u64, method: &str, params: Value| {
        let mut r = request(id, method, &token, "run_c", false, params);
        r["context"]["call_id"] = json!("call_a");
        r
    };
    let replies = raw(
        &rig.socket,
        &[
            claim(
                1,
                "get_transcript_span",
                json!({ "call_id": "call_s", "t0_ms": 0, "t1_ms": 9000 }),
            ),
            claim(2, "get_screen_context", json!({ "call_id": "call_s" })),
            // A normal call is allowed, but until the release gate exists no cloud result leaves.
            claim(
                3,
                "get_transcript_span",
                json!({ "call_id": "call_a", "t0_ms": 0, "t1_ms": 9000 }),
            ),
            claim(4, "get_open_items", json!({})),
            claim(5, "get_person", json!({ "name": "boris" })),
            request(6, "get_open_items", &token, "run_other", false, json!({})),
        ],
    )
    .await;
    let outcome: Vec<(u64, i64)> = replies
        .iter()
        .map(|r| (r["id"].as_u64().unwrap(), code(r)))
        .collect();
    assert_eq!(
        outcome,
        [
            (1, -32001),
            (2, -32001),
            (3, -32603),
            (4, -32603),
            (5, -32002),
            (6, -32001)
        ]
    );
    let text = serde_json::to_string(&replies).unwrap();
    for hidden in ["Hidden words", "Secret thing", "Boris", "person_boris"] {
        assert!(
            !text.contains(hidden),
            "a sensitive record reached a cloud run"
        );
    }

    // The same read on a local run works, for the sensitive call too, whatever it claims.
    let (local, _) = rig.local("run_l");
    let span = json!({ "call_id": "call_s", "t0_ms": 0, "t1_ms": 9000 });
    let replies = raw(
        &rig.socket,
        &[request(
            1,
            "get_transcript_span",
            &local,
            "run_l",
            true,
            span,
        )],
    )
    .await;
    assert_eq!(replies[0]["result"]["lines"][0]["text"], "Hidden words.");
}

#[tokio::test(flavor = "multi_thread")]
async fn closing_a_run_revokes_its_token_and_removes_its_config() {
    let rig = rig().await;
    let (token, config) = rig.local("run_1");
    let (token_2, _) = rig.local("run_2");
    assert!(config.exists());
    let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&config), 0o600);
    assert_eq!(mode(&rig.socket), 0o600);
    let body: Value = serde_json::from_slice(&std::fs::read(&config).unwrap()).unwrap();
    assert_eq!(body["run_id"], "run_1");
    assert_eq!(body["socket"], json!(rig.socket));
    assert!(
        !body.to_string().contains(&token),
        "the token is not in the config"
    );

    let mut mcp = Mcp::start(&config, &token).await;
    let screen = json!({ "call_id": "call_a" });
    assert!(mcp.tool("get_screen_context", screen.clone()).await.is_ok());
    assert!(rig.core.close_mcp_run("run_1"));
    assert!(!config.exists());
    assert_eq!(rig.core.mcp_session("run_1"), None);
    assert!(
        !rig.core.close_mcp_run("run_1"),
        "closing again does nothing"
    );
    // Its connection ended with it: the child's next call gets no answer.
    assert_eq!(
        mcp.tool("get_screen_context", screen.clone()).await,
        Err(-32603)
    );
    // A replay of the old token on a new connection is refused, and run 2 is untouched.
    let replay = raw(
        &rig.socket,
        &[request(
            1,
            "get_screen_context",
            &token,
            "run_1",
            false,
            screen.clone(),
        )],
    )
    .await;
    assert_eq!(code(&replay[0]), -32001);
    let other = raw(
        &rig.socket,
        &[request(
            1,
            "get_screen_context",
            &token_2,
            "run_2",
            false,
            screen.clone(),
        )],
    )
    .await;
    assert!(other[0]["result"].is_object());
    // The ended child cannot start again: its config is gone.
    let status = Command::new(env!("CARGO_BIN_EXE_noter-mcp"))
        .arg(&config)
        .env("NOTER_MCP_TOKEN", &token)
        .stderr(Stdio::null())
        .status()
        .await
        .unwrap();
    assert_eq!(status.code(), Some(2));

    // A run id registers once, and only as a plain file name.
    for bad in ["run_2", "", "../x", "a/b"] {
        let reg = McpRegistration {
            llm_run_id: bad.into(),
            call_id: None,
            cloud: false,
            tools: vec![],
            live: false,
        };
        assert!(rig.core.register_mcp_run(reg).is_err(), "{bad:?}");
    }

    // A connection serves the run it first authenticated; another run's token on it is refused.
    let (token_3, _) = rig.local("run_3");
    let mixed = raw(
        &rig.socket,
        &[
            request(
                1,
                "get_screen_context",
                &token_2,
                "run_2",
                false,
                screen.clone(),
            ),
            request(
                2,
                "get_screen_context",
                &token_3,
                "run_3",
                false,
                screen.clone(),
            ),
        ],
    )
    .await;
    assert!(mixed[0]["result"].is_object());
    assert_eq!(code(&mixed[1]), -32001);

    // Shutdown ends every run and the socket.
    rig.core.shutdown().await;
    assert_eq!(rig.core.mcp_session("run_2"), None);
    assert!(!rig.socket.exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restart_discards_the_configs_of_runs_that_no_longer_exist() {
    let dir = tempfile::tempdir().unwrap();
    let stale = dir.path().join("run/mcp/run_old.json");
    std::fs::create_dir_all(stale.parent().unwrap()).unwrap();
    std::fs::write(&stale, "{}").unwrap();
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(Quiet));
    let _core = Core::open(dir.path(), deps).unwrap();
    assert!(!stale.exists());
}

/// The binary reads a file and a socket and nothing else: its manifest names no database or
/// network crate (`arch_check` enforces the same for every crate; this pins the closure).
#[test]
fn the_binary_depends_on_the_protocol_serde_and_tokio_only() {
    let manifest =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml")).unwrap();
    let deps: Vec<&str> = manifest
        .split("[dependencies]")
        .nth(1)
        .unwrap()
        .split("\n[")
        .next()
        .unwrap()
        .lines()
        .filter_map(|l| l.split_once('=').map(|(name, _)| name.trim()))
        .collect();
    assert_eq!(deps, ["noter-protocol", "serde", "serde_json", "tokio"]);
}

// ── slice 2: the cloud result gate, staging and the router's wiring ─

#[tokio::test(flavor = "multi_thread")]
async fn a_cloud_result_keeps_the_packets_pseudonyms_and_commits_its_audit_row_first() {
    let rig = rig_with(HOLD).await;
    let (run, token, config) = rig.cloud(None, &["Anna"]).await;
    let mut mcp = Mcp::start(&config, &token).await;
    let person = mcp
        .tool("get_person", json!({ "person_id": "person_anna" }))
        .await
        .unwrap();
    // Anna is the initial packet's Person 1; her alias is not released under another name.
    assert_eq!(person["display_name"], "Person 1");
    assert_eq!(person["aliases"], json!([]));
    assert_eq!(person["open_items"][0]["owner"], "Person 1");
    let text = person.to_string();
    assert!(!text.contains("Anna") && !text.contains("Аня"), "{text}");
    // Ids and evidence stay exactly as stored.
    assert_eq!(person["person_id"], "person_anna");
    assert_eq!(person["recent_calls"], json!(["call_a", "call_o"]));

    let rows = rig.sql("SELECT * FROM audit_log WHERE kind = 'tool_result'");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["llm_run_id"], run.as_str());
    assert_eq!(rows[0]["what"], "evidence_lookup");
    assert_eq!(rows[0]["destination"], "api.anthropic.com");
    assert_eq!(rows[0]["bytes_out"], text.len() as i64);
    // Decisions and open items go through the same gate: one more row each, same pseudonyms.
    let decisions = mcp.tool("get_decisions", json!({})).await.unwrap();
    assert_eq!(decisions["items"][0]["owner"], "Person 1");
    assert_eq!(
        rig.sql("SELECT id FROM audit_log WHERE kind = 'tool_result'")
            .len(),
        2
    );
    // The run's own packet row is the one the pseudonyms came from.
    assert_eq!(
        rig.sql("SELECT id FROM audit_log WHERE kind = 'run' AND llm_run_id = 'x'")
            .len(),
        0
    );
    assert_eq!(
        rig.sql("SELECT id FROM audit_log WHERE kind = 'run'").len(),
        1
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cloud_result_whose_audit_row_cannot_commit_releases_nothing() {
    let rig = rig_with(HOLD).await;
    let (_, token, config) = rig.cloud(None, &["Anna"]).await;
    noter_db::rusqlite::Connection::open(rig.dir.path().join("noter.db"))
        .unwrap()
        .execute_batch("CREATE TRIGGER tool_down BEFORE INSERT ON audit_log WHEN NEW.kind = 'tool_result' BEGIN SELECT RAISE(ABORT, 'disk'); END;")
        .unwrap();
    let mut mcp = Mcp::start(&config, &token).await;
    let span = json!({ "call_id": "call_a", "t0_ms": 0, "t1_ms": 9000 });
    assert_eq!(mcp.tool("get_transcript_span", span).await, Err(-32603));
    assert_eq!(mcp.tool("get_decisions", json!({})).await, Err(-32603));
    assert!(rig
        .sql("SELECT id FROM audit_log WHERE kind = 'tool_result'")
        .is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cloud_run_never_receives_a_sensitive_call_or_the_people_only_it_names() {
    let rig = rig_with(HOLD).await;
    let (_, token, config) = rig.cloud(None, &["Anna"]).await;
    let mut mcp = Mcp::start(&config, &token).await;
    let secret = json!({ "call_id": "call_s", "t0_ms": 0, "t1_ms": 9000 });
    assert_eq!(mcp.tool("get_transcript_span", secret).await, Err(-32001));
    assert_eq!(
        mcp.tool("get_person", json!({ "name": "Boris" })).await,
        Err(-32002)
    );
    let items = mcp
        .tool("get_open_items", json!({}))
        .await
        .unwrap()
        .to_string();
    let anna = mcp
        .tool("get_person", json!({ "person_id": "person_anna" }))
        .await
        .unwrap()
        .to_string();
    for hidden in [
        "Secret thing",
        "call_s",
        "Boris",
        "person_boris",
        "Hidden words",
    ] {
        assert!(
            !items.contains(hidden) && !anna.contains(hidden),
            "{hidden}"
        );
    }
    // Nothing sensitive was released, so nothing sensitive is in an audit row's size either.
    assert_eq!(
        rig.sql("SELECT id FROM audit_log WHERE kind = 'tool_result'")
            .len(),
        2
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn pin_item_stages_a_suggested_item_and_leaves_the_records_it_cites_alone() {
    let rig = rig().await;
    let (token, config) = rig.local("run_pin");
    let mut mcp = Mcp::start(&config, &token).await;
    let before = rig.sql("SELECT id, rev, text FROM items ORDER BY id");
    let staged = mcp
        .tool(
            "pin_item",
            json!({ "call_id": "call_a", "kind": "action_item", "text": "Ship the importer docs",
                    "owner_name": "Anna", "due": "2026-10-30",
                    "evidence_segment_ids": ["seg_1", "seg_2"] }),
        )
        .await
        .unwrap();
    assert_eq!(staged["staged"], true);
    let reference = staged["reference"].as_str().unwrap();
    let item = rig.sql(&format!("SELECT * FROM items WHERE id = '{reference}'"));
    assert_eq!(item.len(), 1);
    assert_eq!(item[0]["created_by"], "llm");
    assert_eq!(item[0]["review_state"], "suggested");
    assert_eq!(item[0]["status"], "open");
    assert_eq!(item[0]["owner_person_id"], "person_anna");
    assert_eq!(item[0]["due_date"], "2026-10-30");
    let span = rig.sql(&format!(
        "SELECT call_id, t0_ms, t1_ms FROM item_spans WHERE item_id = '{reference}'"
    ));
    assert_eq!(
        span,
        [json!({ "call_id": "call_a", "t0_ms": 0, "t1_ms": 9000 })]
    );
    let change = rig.sql(&format!(
        "SELECT actor, status, undoable FROM changes WHERE entity_id = '{reference}'"
    ));
    assert_eq!(
        change,
        [json!({ "actor": "llm_run:run_pin", "status": "applied", "undoable": 0 })]
    );
    // Every record that already existed is as it was.
    let mut after = rig.sql("SELECT id, rev, text FROM items ORDER BY id");
    after.retain(|r| r["id"] != reference);
    assert_eq!(before, after);

    // Fabricated or foreign evidence, an unknown kind, an empty text: invalid, nothing staged.
    let count = || rig.sql("SELECT id FROM items").len();
    let n = count();
    let pin = |evidence: Value, kind: &str, text: &str, call: &str| json!({ "call_id": call, "kind": kind, "text": text, "evidence_segment_ids": evidence });
    for args in [
        pin(json!(["seg_nope"]), "decision", "x", "call_a"),
        pin(json!(["seg_s"]), "decision", "x", "call_a"),
        pin(json!([]), "decision", "x", "call_a"),
        pin(json!(["seg_1"]), "wish", "x", "call_a"),
        pin(json!(["seg_1"]), "decision", "  ", "call_a"),
    ] {
        assert_eq!(
            mcp.tool("pin_item", args.clone()).await,
            Err(-32602),
            "{args}"
        );
    }
    assert_eq!(
        mcp.tool(
            "pin_item",
            pin(json!(["seg_1"]), "decision", "x", "call_nope")
        )
        .await,
        Err(-32002)
    );
    assert_eq!(count(), n);
}

#[tokio::test(flavor = "multi_thread")]
async fn propose_correction_records_a_proposed_change_and_never_applies_it() {
    let rig = rig().await;
    let (token, config) = rig.local("run_fix");
    let mut mcp = Mcp::start(&config, &token).await;
    let fix = |field: &str, before: &str, evidence: Value| {
        json!({ "entity": "segment", "entity_id": "seg_1", "field": field, "before": before,
                "after": "We will ship the importer on Monday.", "reason": "Anna said Monday",
                "evidence_segment_ids": evidence })
    };
    let staged = mcp
        .tool(
            "propose_correction",
            fix(
                "text",
                "We will ship the importer.",
                json!(["seg_1", "seg_2"]),
            ),
        )
        .await
        .unwrap();
    assert_eq!(staged["staged"], true);
    let reference = staged["reference"].as_str().unwrap();
    let rows = rig.sql(&format!(
        "SELECT actor, entity_type, entity_id, field, before, after, status, proposal_kind, reason, undoable FROM changes WHERE id = '{reference}'"
    ));
    assert_eq!(
        rows,
        [
            json!({ "actor": "llm_run:run_fix", "entity_type": "segment", "entity_id": "seg_1",
                 "field": "text", "before": "We will ship the importer.",
                 "after": "We will ship the importer on Monday.", "status": "proposed",
                 "proposal_kind": "correction", "reason": "Anna said Monday", "undoable": 0 })
        ]
    );
    // The segment itself is unchanged.
    assert_eq!(
        rig.sql("SELECT text FROM segments WHERE id = 'seg_1'"),
        [json!({ "text": "We will ship the importer." })]
    );
    let n = rig.sql("SELECT id FROM changes").len();
    // A stale before value, a field the tool may not propose, fabricated evidence, a sensitive
    // call's segment (not for a local run, but an unknown one): refused, nothing recorded.
    for args in [
        fix("text", "We shipped it.", json!(["seg_1"])),
        fix("words_path", "x", json!(["seg_1"])),
        fix("text", "We will ship the importer.", json!(["seg_nope"])),
        fix("text", "We will ship the importer.", json!([])),
    ] {
        assert_eq!(
            mcp.tool("propose_correction", args.clone()).await,
            Err(-32602),
            "{args}"
        );
    }
    let mut gone = fix("text", "x", json!(["seg_1"]));
    gone["entity_id"] = json!("seg_nope");
    assert_eq!(mcp.tool("propose_correction", gone).await, Err(-32002));
    let mut other = fix("text", "x", json!(["seg_1"]));
    other["entity"] = json!("call");
    assert_eq!(mcp.tool("propose_correction", other).await, Err(-32602));
    assert_eq!(rig.sql("SELECT id FROM changes").len(), n);
}

#[tokio::test(flavor = "multi_thread")]
async fn staging_by_a_cloud_run_passes_the_gate_and_cannot_touch_a_sensitive_call() {
    let rig = rig_with(HOLD).await;
    let (_, token, config) = rig.cloud(None, &["Anna"]).await;
    let mut mcp = Mcp::start(&config, &token).await;
    let staged = mcp
        .tool(
            "propose_correction",
            json!({ "entity": "item", "entity_id": "it_act", "field": "text", "before": "Send the report",
                    "after": "Send the report by Friday", "reason": "said so",
                    "evidence_segment_ids": ["seg_2"] }),
        )
        .await
        .unwrap();
    assert!(staged["reference"].as_str().unwrap().starts_with("chg_"));
    assert_eq!(
        rig.sql("SELECT id FROM audit_log WHERE kind = 'tool_result'")
            .len(),
        1
    );
    // The sensitive call's segment, item and call are out of reach for a cloud run.
    let sensitive = [
        json!({ "entity": "segment", "entity_id": "seg_s", "field": "text", "before": "Hidden words.",
                "after": "x", "reason": "r", "evidence_segment_ids": ["seg_1"] }),
        json!({ "entity": "item", "entity_id": "it_sec", "field": "text", "before": "Secret thing",
                "after": "x", "reason": "r", "evidence_segment_ids": ["seg_1"] }),
        json!({ "entity": "item", "entity_id": "it_act", "field": "text", "before": "Send the report",
                "after": "x", "reason": "r", "evidence_segment_ids": ["seg_s"] }),
    ];
    for args in sensitive {
        assert_eq!(
            mcp.tool("propose_correction", args.clone()).await,
            Err(-32001),
            "{args}"
        );
    }
    let pin = json!({ "call_id": "call_s", "kind": "decision", "text": "x", "evidence_segment_ids": ["seg_s"] });
    assert_eq!(mcp.tool("pin_item", pin).await, Err(-32001));
    // The model writes in its pseudonyms: what is stored names the real person.
    let named = json!({ "call_id": "call_a", "kind": "action_item", "text": "Person 1 sends the plan",
                        "owner_name": "Person 1", "evidence_segment_ids": ["seg_1"] });
    let staged = mcp.tool("pin_item", named).await.unwrap();
    let reference = staged["reference"].as_str().unwrap();
    assert_eq!(
        rig.sql(&format!(
            "SELECT text, owner_person_id FROM items WHERE id = '{reference}'"
        )),
        [json!({ "text": "Anna sends the plan", "owner_person_id": "person_anna" })]
    );
    assert_eq!(
        rig.sql("SELECT id FROM changes WHERE status = 'proposed'")
            .len(),
        1
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_router_starts_noter_mcp_under_the_run_and_revokes_it_when_the_run_ends() {
    let rig = rig_with(r#"{"on": "role-review", "after_ms": 700}"#).await;
    let (run, token, config) = rig.cloud(Some("call_a"), &["Anna"]).await;
    // The adapter got the built binary, the run's config and token, and the tools it may use.
    let launch = rig.scripted.received()[0].mcp.clone().expect("a launch");
    assert_eq!(launch.binary, Path::new(env!("CARGO_BIN_EXE_noter-mcp")));
    assert_eq!(launch.config, config);
    assert_eq!(launch.token.expose(), token);
    assert!(launch.tools.contains(&"pin_item".to_owned()));
    let mode = std::fs::metadata(&config).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    assert!(rig.core.mcp_session(&run).is_some());
    // The run ends: the token is revoked and the config removed, without anyone closing it.
    for _ in 0..100 {
        if rig.core.mcp_session(&run).is_none() && !config.exists() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert_eq!(rig.core.mcp_session(&run), None);
    assert!(!config.exists());
    let late = raw(
        &rig.socket,
        &[request(
            1,
            "get_screen_context",
            &token,
            &run,
            true,
            json!({ "call_id": "call_a" }),
        )],
    )
    .await;
    assert_eq!(code(&late[0]), -32001);
    // A core with no binary configured starts no tool server for a run that asks for tools.
    let bare = {
        let dir = tempfile::tempdir().unwrap();
        let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(Quiet));
        Arc::new(Core::open(dir.path(), deps).unwrap())
    };
    let _ = bare.serve_socket().await.unwrap();
    assert_eq!(bare.mcp_session("llm_none"), None);
}

// ── slice 2, PR B: the search tools and the D1 live relay ───────────────────────────────────

impl Rig {
    fn exec(&self, sql: &str) {
        noter_db::rusqlite::Connection::open(self.dir.path().join("noter.db"))
            .unwrap()
            .execute_batch(sql)
            .unwrap();
    }
}

/// Forty more segments of `call_a` that all say "gadget", each its own span.
fn gadgets() -> String {
    let rows: Vec<String> = (0..40)
        .map(|i| {
            let t0 = 20_000 + i * 100;
            let text = format!("gadget number {i}");
            format!(
                "('gad_{i}', 'call_a', 'sp_a', 'sys', {t0}, {}, '{text}', '{text}', 'en', 'live')",
                t0 + 50
            )
        })
        .collect();
    format!(
        "INSERT INTO segments (id, call_id, speaker_id, channel, t0_ms, t1_ms, text, text_norm, lang, pass) VALUES {};",
        rows.join(", ")
    )
}

/// The socket path is hybrid like `search`: a query that shares no word with the stored text but
/// whose embedding matches a chunk's returns that chunk as a weak hit.
#[tokio::test(flavor = "multi_thread")]
async fn search_calls_embeds_the_query_and_returns_a_semantic_only_weak_hit() {
    let rig = rig_all("", |_| Arc::new(noter_core::ScriptedMcp::default()), true).await;
    let engine = noter_engine_client::EngineClient::new(
        Arc::new(ScriptedEngine::new().with_container(rig.dir.path())),
        noter_engine_client::Config::default(),
    );
    let vector = engine
        .embed(vec!["zebra orbit".into()])
        .await
        .unwrap()
        .remove(0);
    let blob: Vec<u8> = vector.iter().flat_map(|x| x.to_le_bytes()).collect();
    let db = noter_db::rusqlite::Connection::open(rig.dir.path().join("noter.db")).unwrap();
    db.execute_batch(
        "INSERT INTO chunks (id, call_id, t0_ms, t1_ms, text, text_norm, token_count) VALUES
           ('ch_sem', 'call_a', 0, 5000, 'Quarterly budget review', 'quarterly budget review', 3);",
    )
    .unwrap();
    db.execute(
        "INSERT INTO chunk_vec (chunk_id, embedding, call_id, started_at)
         VALUES ('ch_sem', ?1, 'call_a', 1792130000000)",
        [blob],
    )
    .unwrap();
    let (token, config) = rig.local("run_h");
    let mut mcp = Mcp::start(&config, &token).await;
    let found = mcp
        .tool("search_calls", json!({ "query": "zebra orbit" }))
        .await
        .unwrap();
    let hits = found["hits"].as_array().unwrap();
    assert_eq!(hits.len(), 1, "{found}");
    assert_eq!(hits[0]["call_id"], "call_a");
    assert_eq!(hits[0]["strong"], false);
    assert_eq!(found["keyword_only"], false);
}

#[tokio::test(flavor = "multi_thread")]
async fn search_calls_defaults_to_eight_hits_caps_at_thirty_and_keeps_segment_ids() {
    let rig = rig().await;
    rig.exec(&gadgets());
    let (token, config) = rig.local("run_s");
    let mut mcp = Mcp::start(&config, &token).await;
    let hits = |r: &Value| r["hits"].as_array().unwrap().len();

    let default = mcp
        .tool("search_calls", json!({ "query": "gadget" }))
        .await
        .unwrap();
    assert_eq!(hits(&default), 8);
    let capped = mcp
        .tool("search_calls", json!({ "query": "gadget", "k": 500 }))
        .await
        .unwrap();
    assert_eq!(hits(&capped), 30);
    let three = mcp
        .tool("search_calls", json!({ "query": "gadget", "k": 3 }))
        .await
        .unwrap();
    assert_eq!(hits(&three), 3);
    // Every hit names the call and the stored segment it came from, unchanged.
    for hit in capped["hits"].as_array().unwrap() {
        assert_eq!(hit["call_id"], "call_a");
        let id = hit["segment_ids"][0].as_str().unwrap();
        assert!(id.starts_with("gad_"), "{id}");
        let stored = rig.sql(&format!("SELECT text FROM segments WHERE id = '{id}'"));
        assert_eq!(hit["text"], stored[0]["text"]);
        assert_eq!(hit["strong"], true);
    }
    assert_eq!(capped["keyword_only"], true);
    // The run's filters apply: no call in 2030.
    let none = mcp
        .tool(
            "search_calls",
            json!({ "query": "gadget", "filter": { "from": "2030-01-01" } }),
        )
        .await
        .unwrap();
    assert_eq!(hits(&none), 0);
    // A blank query or a bad date is invalid params.
    assert_eq!(
        mcp.tool("search_calls", json!({ "query": "  " })).await,
        Err(-32602)
    );
    let bad = json!({ "query": "gadget", "filter": { "from": "2030-02-31x" } });
    assert_eq!(mcp.tool("search_calls", bad).await, Err(-32602));
}

/// A normal and a sensitive knowledge source, each with one chunk about "roadmap".
const DOCS: &str = "
INSERT INTO sources (id, rev, kind, mode, name, location, privacy_class, scope, status) VALUES
  ('src_ok', 1, 'folder', 'indexed', 'Handbook', '/h', 'normal', '{\"type\":\"all_calls\"}', '\"ready\"'),
  ('src_hid', 1, 'folder', 'indexed', 'Legal', '/l', 'sensitive', '{\"type\":\"all_calls\"}', '\"ready\"');
INSERT INTO documents (id, source_id, uri, title, mime, content_hash, indexed_at) VALUES
  ('doc_ok', 'src_ok', 'a.md', 'Plan', 'text/markdown', 'h1', 1),
  ('doc_hid', 'src_hid', 'b.md', 'Deal', 'text/markdown', 'h2', 1);
INSERT INTO doc_chunks (id, document_id, heading_path, text, text_norm, token_count) VALUES
  ('chunk_ok', 'doc_ok', '[\"Plan\",\"Q4\"]', 'Plan › Q4

The roadmap ships in Q4.', 'plan q4 the roadmap ships in q4.', 9),
  ('chunk_hid', 'doc_hid', '[\"Deal\"]', 'Deal

The roadmap is under NDA.', 'deal the roadmap is under nda.', 8);
";

#[tokio::test(flavor = "multi_thread")]
async fn a_cloud_run_never_receives_a_sensitive_call_or_source_from_search() {
    let rig = rig_with(HOLD).await;
    rig.exec(DOCS);
    let (local, lconfig) = rig.local("run_l");
    let mut local = Mcp::start(&lconfig, &local).await;
    let (_, token, config) = rig.cloud(None, &["Anna"]).await;
    let mut cloud = Mcp::start(&config, &token).await;

    // Local: the sensitive call and the sensitive source are both there.
    let calls = local
        .tool("search_calls", json!({ "query": "hidden" }))
        .await
        .unwrap();
    assert_eq!(calls["hits"][0]["call_id"], "call_s");
    let docs = local
        .tool("search_documents", json!({ "query": "roadmap" }))
        .await
        .unwrap();
    let titles: Vec<&str> = docs["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["title"].as_str().unwrap())
        .collect();
    assert_eq!(titles.len(), 2, "{docs}");

    // Cloud: neither, and the audit row says a result was released.
    let calls = cloud
        .tool("search_calls", json!({ "query": "hidden" }))
        .await
        .unwrap();
    assert!(calls["hits"].as_array().unwrap().is_empty(), "{calls}");
    let docs = cloud
        .tool("search_documents", json!({ "query": "roadmap" }))
        .await
        .unwrap();
    let hits = docs["hits"].as_array().unwrap();
    assert_eq!(hits.len(), 1, "{docs}");
    assert_eq!(hits[0]["chunk_id"], "chunk_ok");
    assert_eq!(hits[0]["document_id"], "doc_ok");
    assert_eq!(hits[0]["source_name"], "Handbook");
    assert_eq!(hits[0]["heading_path"], json!(["Plan", "Q4"]));
    assert_eq!(docs["sensitive_skipped"], 1);
    assert!(!docs.to_string().contains("NDA"));
    assert!(!rig
        .sql("SELECT id FROM audit_log WHERE kind = 'tool_result'")
        .is_empty());
}

// ── D1: the live-source relay ───────────────────────────────────────────────────────────────

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use noter_core::{BoxFuture, Listing, McpError, McpPage as Page, McpSource};
use noter_llm::{Privacy, TaskKind};
use noter_protocol::PrivacyMode;

/// The scripted MCP servers, noting how many `lookup` audit rows were committed whenever a
/// request reached a server, and holding a request open when asked.
struct Spy {
    inner: noter_core::ScriptedMcp,
    db: PathBuf,
    /// `lookup` rows committed at each request that reached a server.
    seen: Mutex<Vec<i64>>,
    hold: AtomicBool,
    answered: AtomicUsize,
    /// Sign-ins started.
    oauths: AtomicUsize,
}

impl Spy {
    /// The source's audit call, passed on; once the row has committed the request is as good as
    /// sent, so that is when the rows are counted (and a held request waits).
    fn audited(&self, remote: &noter_core::McpRemote<'_>, destination: &str, bytes: &[u8]) -> bool {
        let committed = (remote.audit)(destination, bytes);
        if committed {
            self.note();
        }
        committed
    }

    fn note(&self) {
        let rows = noter_db::rusqlite::Connection::open(&self.db)
            .unwrap()
            .query_row(
                "SELECT count(*) FROM audit_log WHERE kind = 'lookup'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        self.seen.lock().unwrap().push(rows);
    }
}

impl McpSource for Spy {
    fn oauth<'a>(
        &'a self,
        server: &'a str,
        audit: noter_core::McpAudit<'a>,
    ) -> BoxFuture<'a, Result<String, McpError>> {
        self.oauths.fetch_add(1, Ordering::SeqCst);
        self.inner.oauth(server, audit)
    }

    fn list_resources<'a>(
        &'a self,
        server: &'a str,
        token: &'a str,
        remote: &'a noter_core::McpRemote<'a>,
    ) -> BoxFuture<'a, Result<Option<Listing>, McpError>> {
        self.inner.list_resources(server, token, remote)
    }

    fn read_resource<'a>(
        &'a self,
        server: &'a str,
        token: &'a str,
        uri: &'a str,
        remote: &'a noter_core::McpRemote<'a>,
    ) -> BoxFuture<'a, Result<Page, McpError>> {
        Box::pin(async move {
            let audit = |d: &str, b: &[u8]| self.audited(remote, d, b);
            let seen = noter_core::McpRemote {
                audit: &audit,
                renewed: remote.renewed,
            };
            let page = self.inner.read_resource(server, token, uri, &seen).await;
            self.answered.fetch_add(1, Ordering::SeqCst);
            page
        })
    }

    fn seed_query<'a>(
        &'a self,
        server: &'a str,
        token: &'a str,
        query: &'a str,
        remote: &'a noter_core::McpRemote<'a>,
    ) -> BoxFuture<'a, Result<Listing, McpError>> {
        Box::pin(async move {
            let audit = |d: &str, b: &[u8]| self.audited(remote, d, b);
            let seen = noter_core::McpRemote {
                audit: &audit,
                renewed: remote.renewed,
            };
            let found = self.inner.seed_query(server, token, query, &seen).await;
            // The request is out (its row committed); the server is slow to answer.
            if self.hold.load(Ordering::SeqCst) {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
            self.answered.fetch_add(1, Ordering::SeqCst);
            found
        })
    }
}

/// A core whose MCP servers are `tracker.example` (one page), seeded with a live source for
/// it, a sensitive live source, an indexed one, and one limited to stand-ups.
async fn relay_rig() -> (Rig, Arc<Spy>) {
    let spy = Arc::new(std::sync::OnceLock::new());
    let shared = spy.clone();
    let rig = rig_mcp(&[HOLD; 12].join("\n"), move |dir| {
        let inner = noter_core::ScriptedMcp::default();
        inner.set(
            "tracker.example",
            noter_core::ScriptedServer {
                pages: vec![noter_core::ScriptedPage {
                    uri: "tracker://AB-1".into(),
                    title: "AB-1 importer".into(),
                    hash: None,
                    text: "The importer ticket.".into(),
                    mime: None,
                }],
                ..Default::default()
            },
        );
        let made = Arc::new(Spy {
            inner,
            db: dir.join("noter.db"),
            seen: Mutex::default(),
            hold: AtomicBool::new(false),
            answered: AtomicUsize::new(0),
            oauths: AtomicUsize::new(0),
        });
        let _ = shared.set(made.clone());
        made
    })
    .await;
    rig.exec(
        r#"INSERT INTO sources (id, rev, kind, mode, name, location, privacy_class, scope, status) VALUES
  ('src_l', 1, 'mcp', 'live', 'Work Tracker', 'tracker.example', 'normal', '{"type":"all_calls"}', '"ready"'),
  ('src_v', 1, 'mcp', 'live', 'Vault', 'vault.example', 'sensitive', '{"type":"all_calls"}', '"ready"'),
  ('src_i', 1, 'mcp', 'indexed', 'Wiki', 'wiki.example', 'normal', '{"type":"all_calls"}', '"ready"'),
  ('src_s', 1, 'mcp', 'live', 'Standup Notes', 'notes.example', 'normal',
   '{"type":"limited","call_types":["standup"],"people":[]}', '"ready"');"#,
    );
    (rig, spy.get().unwrap().clone())
}

fn ok_privacy() -> Privacy {
    Privacy {
        mode: PrivacyMode::CloudAllowed,
        sensitive: false,
        offline: false,
    }
}

fn tools_of(config: &Path) -> Vec<String> {
    let body: Value = serde_json::from_slice(&std::fs::read(config).unwrap()).unwrap();
    serde_json::from_value(body["tools"].clone()).unwrap()
}

fn live_of(config: &Path) -> Vec<String> {
    tools_of(config)
        .into_iter()
        .filter(|t| t.starts_with("live_"))
        .collect()
}

impl Rig {
    /// A router-started run (`task`, `privacy`) held open; `(run id, token, config, sender)`.
    async fn run_under(
        &self,
        call: Option<&str>,
        task: TaskKind,
        privacy: Privacy,
    ) -> (
        String,
        String,
        PathBuf,
        Arc<tokio::sync::watch::Sender<Privacy>>,
    ) {
        let tools = ALL.iter().map(|t| (*t).to_owned()).collect();
        let (run, tx) = noter_core::testing::mcp_run_under(
            &self.core,
            call.map(CallId::new),
            tools,
            vec!["Anna".into()],
            task,
            privacy,
        )
        .await
        .expect("the run starts");
        (
            run["run_id"].as_str().unwrap().to_owned(),
            run["token"].as_str().unwrap().to_owned(),
            PathBuf::from(run["config"].as_str().unwrap()),
            tx,
        )
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn live_tools_follow_the_policy_matrix_of_task_privacy_and_sensitive_context() {
    let (rig, _) = relay_rig().await;
    let both = ["live_work_tracker_search", "live_work_tracker_read"];
    let rows = [
        (TaskKind::Ask, ok_privacy(), true),
        (TaskKind::PostCall, ok_privacy(), true),
        (TaskKind::Live, ok_privacy(), false),
        (
            TaskKind::Ask,
            Privacy {
                mode: PrivacyMode::CloudRedacted,
                ..ok_privacy()
            },
            false,
        ),
        (
            TaskKind::Ask,
            Privacy {
                mode: PrivacyMode::LocalOnly,
                ..ok_privacy()
            },
            false,
        ),
        (
            TaskKind::Ask,
            Privacy {
                sensitive: true,
                ..ok_privacy()
            },
            false,
        ),
        (
            TaskKind::PostCall,
            Privacy {
                offline: true,
                ..ok_privacy()
            },
            false,
        ),
    ];
    for (i, (task, privacy, listed)) in rows.into_iter().enumerate() {
        let (_, _, config, _tx) = rig.run_under(Some("call_a"), task, privacy).await;
        let live = live_of(&config);
        // Only the normal, in-scope live source: not the sensitive one, the indexed one, or the
        // one limited to another call type.
        let want: Vec<&str> = if listed { both.to_vec() } else { vec![] };
        assert_eq!(live, want, "row {i}: {task:?} {privacy:?}");
    }
    // The runtime's own MCP config names the one noter-mcp server: no source, no address and
    // no credential is in it.
    let (run, token, config, _tx) = rig.run_under(None, TaskKind::Ask, ok_privacy()).await;
    let body = std::fs::read_to_string(&config).unwrap();
    for secret in [
        "tracker.example",
        "vault.example",
        "wiki.example",
        token.as_str(),
    ] {
        assert!(
            !body.contains(secret),
            "a source address or the token is in the run config"
        );
    }
    // Unbound to a call, a source limited to stand-ups is the run's too.
    assert!(live_of(&config).contains(&"live_standup_notes_search".to_owned()));
    // The binary lists them with a fixed schema.
    let mut mcp = Mcp::start(&config, &token).await;
    let listed = mcp.rpc("tools/list", json!({})).await;
    let tool = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "live_work_tracker_search")
        .expect("the relayed tool is listed")
        .clone();
    assert_eq!(tool["inputSchema"]["required"], json!(["query"]));
    let _ = run;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_run_signs_in_to_a_live_source_once() {
    let (rig, spy) = relay_rig().await;
    let (_, token, config, _tx) = rig
        .run_under(Some("call_a"), TaskKind::Ask, ok_privacy())
        .await;
    let mut mcp = Mcp::start(&config, &token).await;
    mcp.tool("live_work_tracker_search", json!({ "query": "importer" }))
        .await
        .unwrap();
    mcp.tool("live_work_tracker_read", json!({ "uri": "tracker://AB-1" }))
        .await
        .unwrap();
    assert_eq!(spy.oauths.load(Ordering::SeqCst), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_relayed_lookup_has_its_audit_row_before_the_request_and_keeps_its_provenance() {
    let (rig, spy) = relay_rig().await;
    let (run, token, config, _tx) = rig
        .run_under(Some("call_a"), TaskKind::Ask, ok_privacy())
        .await;
    let mut mcp = Mcp::start(&config, &token).await;

    let found = mcp
        .tool("live_work_tracker_search", json!({ "query": "importer" }))
        .await
        .unwrap();
    assert_eq!(found["source"], "Work Tracker");
    assert_eq!(found["looked_up_at"], NOW);
    assert_eq!(found["results"][0]["uri"], "tracker://AB-1");
    let page = mcp
        .tool("live_work_tracker_read", json!({ "uri": "tracker://AB-1" }))
        .await
        .unwrap();
    assert_eq!(page["text"], "The importer ticket.");
    assert_eq!(page["looked_up_at"], NOW);

    // One `lookup` row per forwarding, committed before the server saw the request, linked to
    // the run and its call, holding a size and a hash and never the request.
    assert_eq!(*spy.seen.lock().unwrap(), [1, 2]);
    let rows = rig.sql("SELECT * FROM audit_log WHERE kind = 'lookup' ORDER BY ts, rowid");
    assert_eq!(rows.len(), 2);
    for row in &rows {
        assert_eq!(row["destination"], "tracker.example");
        assert_eq!(row["llm_run_id"], run.as_str());
        assert_eq!(row["call_id"], "call_a");
        assert!(row["bytes_out"].as_i64().unwrap() > 0);
        assert_eq!(row["payload_hash"].as_str().unwrap().len(), 64);
        assert!(!row.to_string().contains("importer"), "{row}");
    }
    // The cloud run's results also passed the result gate.
    assert_eq!(
        rig.sql("SELECT id FROM audit_log WHERE kind = 'tool_result'")
            .len(),
        2
    );
    // A source the run was not given is not a tool: sensitive, indexed, unknown.
    for name in [
        "live_vault_search",
        "live_wiki_read",
        "live_standup_notes_search",
        "live_x_read",
    ] {
        assert_eq!(
            mcp.tool(name, json!({ "query": "x", "uri": "x" })).await,
            Err(-32001),
            "{name}"
        );
    }
    assert_eq!(
        mcp.tool("live_work_tracker_search", json!({ "nope": 1 }))
            .await,
        Err(-32602)
    );
    assert_eq!(
        spy.seen.lock().unwrap().len(),
        2,
        "nothing else reached a server"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_lookup_whose_audit_row_cannot_commit_is_never_sent() {
    let (rig, spy) = relay_rig().await;
    let (_, token, config, _tx) = rig.run_under(None, TaskKind::PostCall, ok_privacy()).await;
    rig.exec("CREATE TRIGGER lookup_down BEFORE INSERT ON audit_log WHEN NEW.kind = 'lookup' BEGIN SELECT RAISE(ABORT, 'disk'); END;");
    let mut mcp = Mcp::start(&config, &token).await;
    assert_eq!(
        mcp.tool("live_work_tracker_search", json!({ "query": "importer" }))
            .await,
        Err(-32603)
    );
    assert!(spy.seen.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn forwarding_stops_when_the_runs_privacy_changes() {
    let (rig, spy) = relay_rig().await;
    let (_, token, config, tx) = rig.run_under(None, TaskKind::Ask, ok_privacy()).await;
    let mut mcp = Mcp::start(&config, &token).await;
    mcp.tool("live_work_tracker_search", json!({ "query": "importer" }))
        .await
        .unwrap();
    for changed in [
        Privacy {
            mode: PrivacyMode::LocalOnly,
            ..ok_privacy()
        },
        Privacy {
            mode: PrivacyMode::CloudRedacted,
            ..ok_privacy()
        },
        Privacy {
            sensitive: true,
            ..ok_privacy()
        },
    ] {
        tx.send_replace(changed);
        assert_eq!(
            mcp.tool("live_work_tracker_search", json!({ "query": "importer" }))
                .await,
            Err(-32001),
            "{changed:?}"
        );
        assert_eq!(
            mcp.tool("live_work_tracker_read", json!({ "uri": "tracker://AB-1" }))
                .await,
            Err(-32001)
        );
    }
    assert_eq!(spy.seen.lock().unwrap().len(), 1);
    assert_eq!(
        rig.sql("SELECT id FROM audit_log WHERE kind = 'lookup'")
            .len(),
        1
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_lookup_in_flight_when_the_run_is_cancelled_returns_nothing() {
    let (rig, spy) = relay_rig().await;
    spy.hold.store(true, Ordering::SeqCst);
    let (run, token, config, _tx) = rig.run_under(None, TaskKind::Ask, ok_privacy()).await;
    let mut mcp = Mcp::start(&config, &token).await;
    let call = tokio::spawn(async move {
        mcp.tool("live_work_tracker_search", json!({ "query": "importer" }))
            .await
    });
    for _ in 0..100 {
        if !spy.seen.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert_eq!(spy.seen.lock().unwrap().len(), 1, "the request is out");
    assert!(rig.core.close_mcp_run(&run));
    let answer = tokio::time::timeout(std::time::Duration::from_secs(5), call)
        .await
        .expect("the call ends with the run")
        .unwrap();
    assert!(answer.is_err(), "no result for a cancelled run: {answer:?}");
    assert_eq!(spy.answered.load(Ordering::SeqCst), 0);
}
