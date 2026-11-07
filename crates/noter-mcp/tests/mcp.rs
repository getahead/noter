//! FEATURE cpt-noter-feature-core-mcp (slice 1): a real core on a temp data folder and the
//! built `noter-mcp` binary speaking MCP over its stdio, plus raw socket requests for what the
//! binary never sends (spoofed context, malformed frames).

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use noter_core::{Clock, Core, CoreDeps, EventEmitter, McpRegistration, McpSession};
use noter_protocol::{CallId, TimestampMs};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

const NOW: i64 = 1_792_137_600_000;
const ALL: [&str; 5] = [
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
    dir: tempfile::TempDir,
    socket: PathBuf,
}

async fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(Quiet));
    let core = Arc::new(Core::open(dir.path(), deps).expect("core opens"));
    noter_db::rusqlite::Connection::open(dir.path().join("noter.db"))
        .unwrap()
        .execute_batch(SEED)
        .unwrap();
    let socket = core.serve_socket().await.expect("socket serves");
    Rig { core, dir, socket }
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
            })
            .expect("run registers")
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
    // `search_calls` is a slice-2 tool and `emit_card` is unstable: neither is served or listed.
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
    assert_eq!(names, ["get_person", "get_decisions"]);
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
