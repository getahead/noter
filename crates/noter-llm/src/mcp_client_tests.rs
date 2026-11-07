//! The indexed-MCP client against local stub servers: listing in pages, reading (JSON and SSE
//! answers), the seed search, 401 → refresh → retry, expiry, offline, the audit before every
//! request, the gate on destinations, and the OAuth 2.1 sign-in with PKCE and the loopback
//! redirect.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use base64::Engine;
use reqwest::Url;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::mcp_client::{Call, McpClient, McpClientError};
use crate::mcp_stub::{StubRequest, StubResponse, StubServer};
use crate::runtime::lock;

/// What an MCP endpoint at `/mcp` answers: `initialize` (a session id; resources only when
/// `resources`), `notifications/initialized`, everything else from `answer` (`None`: method
/// not found).
fn mcp_answer(
    resources: bool,
    r: &StubRequest,
    answer: &(dyn Fn(&str, &Value, &StubRequest) -> Option<StubResponse> + Send + Sync),
) -> StubResponse {
    if r.path != "/mcp" {
        return StubResponse::status(404);
    }
    let body = r.json();
    let id = body["id"].clone();
    match body["method"].as_str().unwrap_or_default() {
        "initialize" => {
            let caps = if resources {
                json!({"resources": {}, "tools": {}})
            } else {
                json!({"tools": {}})
            };
            let result = json!({"protocolVersion": "2025-06-18", "capabilities": caps,
                "serverInfo": {"name": "stub", "version": "1"}});
            rpc(id, result).header("Mcp-Session-Id", "sess-1")
        }
        "notifications/initialized" => StubResponse::status(202),
        m => answer(m, &body["params"], r).unwrap_or_else(|| {
            StubResponse::json(
                200,
                json!({"jsonrpc": "2.0", "id": id,
                    "error": {"code": -32601, "message": "Method not found"}}),
            )
        }),
    }
}

fn mcp(
    resources: bool,
    answer: impl Fn(&str, &Value, &StubRequest) -> Option<StubResponse> + Send + Sync + 'static,
) -> StubServer {
    StubServer::start(move |r| mcp_answer(resources, r, &answer))
}

fn rpc(id: Value, result: Value) -> StubResponse {
    StubResponse::json(200, json!({"jsonrpc": "2.0", "id": id, "result": result}))
}

fn id(r: &StubRequest) -> Value {
    r.json()["id"].clone()
}

/// Records each audit with the number of requests the stubs had seen when it ran.
struct Audits {
    rows: Mutex<Vec<(String, usize, usize)>>,
    allow: bool,
}

impl Audits {
    fn new(allow: bool) -> Self {
        Self {
            rows: Mutex::default(),
            allow,
        }
    }

    fn rows(&self) -> Vec<(String, usize, usize)> {
        lock(&self.rows).clone()
    }
}

fn audit_of<'a>(
    audits: &'a Audits,
    servers: &'a [&'a StubServer],
) -> impl Fn(&str, &[u8]) -> bool + Send + Sync + 'a {
    move |destination, bytes| {
        let seen = servers.iter().map(|s| s.requests().len()).sum();
        lock(&audits.rows).push((destination.to_owned(), seen, bytes.len()));
        audits.allow
    }
}

fn client() -> McpClient {
    McpClient::new(Arc::new(|_: &str| {}))
}

fn no_renewal() -> impl Fn(String) + Send + Sync {
    |_| panic!("no refresh expected")
}

/// Every request had its own audit row first, to the server's host.
fn audited_before_each(audits: &Audits, servers: &[&StubServer]) {
    let rows = audits.rows();
    let total: usize = servers.iter().map(|s| s.requests().len()).sum();
    assert_eq!(rows.len(), total, "one audit row per request");
    for (n, (destination, seen, bytes)) in rows.iter().enumerate() {
        assert_eq!(destination, "127.0.0.1");
        assert_eq!(*seen, n, "audit {n} ran before its request left");
        assert!(*bytes > 0);
    }
}

#[tokio::test]
async fn lists_every_page_and_reads_json_and_sse_answers() {
    let stub = mcp(true, |method, params, r| match method {
        "resources/list" if params.get("cursor").is_none() => Some(rpc(
            id(r),
            json!({"resources": [{"uri": "doc://a", "name": "a.md", "title": "Alpha",
                "annotations": {"lastModified": "2026-11-01T00:00:00Z"}}],
                "nextCursor": "p2"}),
        )),
        "resources/list" => Some(rpc(
            id(r),
            json!({"resources": [{"uri": "doc://b", "name": "b.md"}]}),
        )),
        "resources/read" if params["uri"] == "doc://a" => Some(rpc(
            id(r),
            json!({"contents": [{"uri": "doc://a", "mimeType": "text/markdown",
                "text": "# Alpha\nBody"}]}),
        )),
        "resources/read" => {
            let message = json!({"jsonrpc": "2.0", "id": id(r), "result": {"contents": [
                {"uri": "doc://b", "mimeType": "text/plain", "text": "Beta"}]}});
            let body = format!("event: message\ndata: {message}\n\n");
            Some(StubResponse {
                status: 200,
                headers: vec![("Content-Type".into(), "text/event-stream".into())],
                body: body.into_bytes(),
            })
        }
        _ => None,
    });
    let audits = Audits::new(true);
    let servers = [&stub];
    let audit = audit_of(&audits, &servers);
    let renewed = no_renewal();
    let server = stub.url("/mcp");
    let call = Call {
        server: &server,
        token: "bearer-1",
        audit: &audit,
        renewed: &renewed,
    };
    let client = client();
    let listing = client.list(&call).await.unwrap().expect("resources");
    assert!(listing.complete);
    let uris: Vec<&str> = listing.items.iter().map(|i| i.uri.as_str()).collect();
    assert_eq!(uris, ["doc://a", "doc://b"]);
    assert_eq!(listing.items[0].title, "Alpha");
    assert_eq!(listing.items[1].title, "b.md");
    assert_eq!(
        listing.items[0].version.as_deref(),
        Some("2026-11-01T00:00:00Z")
    );
    let a = client.read(&call, "doc://a").await.unwrap();
    assert_eq!(
        (a.mime.as_str(), a.text.as_str()),
        ("text/markdown", "# Alpha\nBody")
    );
    let b = client.read(&call, "doc://b").await.unwrap();
    assert_eq!((b.mime.as_str(), b.text.as_str()), ("text/plain", "Beta"));

    let requests = stub.requests();
    // One session: initialize and its notification once, then the session id on every call.
    let methods: Vec<String> = requests
        .iter()
        .map(|r| r.json()["method"].as_str().unwrap_or_default().to_owned())
        .collect();
    assert_eq!(
        methods,
        [
            "initialize",
            "notifications/initialized",
            "resources/list",
            "resources/list",
            "resources/read",
            "resources/read"
        ]
    );
    for r in &requests {
        assert_eq!(r.method, "POST");
        assert_eq!(r.headers["authorization"], "Bearer bearer-1");
        assert!(r.headers["accept"].contains("text/event-stream"));
    }
    for r in &requests[1..] {
        assert_eq!(r.headers["mcp-session-id"], "sess-1");
        assert_eq!(r.headers["mcp-protocol-version"], "2025-06-18");
    }
    audited_before_each(&audits, &servers);
}

#[tokio::test]
async fn a_server_without_resources_is_crawled_through_its_search_tool() {
    let stub = mcp(false, |method, params, r| match method {
        "tools/call" if params["name"] == "search" && params["arguments"]["query"] == "notes" => {
            Some(rpc(
                id(r),
                json!({"content": [
                    {"type": "text", "text": "2 results"},
                    {"type": "resource_link", "uri": "doc://n1", "name": "n1", "title": "Note 1"},
                    {"type": "resource", "resource": {"uri": "doc://n2", "text": "x"}}
                ]}),
            ))
        }
        "tools/call" => Some(rpc(id(r), json!({"content": [], "isError": true}))),
        _ => None,
    });
    let audits = Audits::new(true);
    let servers = [&stub];
    let audit = audit_of(&audits, &servers);
    let renewed = no_renewal();
    let server = stub.url("/mcp");
    let call = Call {
        server: &server,
        token: "t",
        audit: &audit,
        renewed: &renewed,
    };
    let client = client();
    assert!(client.list(&call).await.unwrap().is_none());
    let found = client.search(&call, "notes").await.unwrap();
    let uris: Vec<(&str, &str)> = found
        .iter()
        .map(|i| (i.uri.as_str(), i.title.as_str()))
        .collect();
    assert_eq!(uris, [("doc://n1", "Note 1"), ("doc://n2", "doc://n2")]);
    assert!(client.search(&call, "other").await.unwrap().is_empty());
    audited_before_each(&audits, &servers);
}

#[tokio::test]
async fn a_rejected_token_without_a_refresh_is_unauthorized() {
    let stub = StubServer::start(|_| StubResponse::status(401));
    let audits = Audits::new(true);
    let servers = [&stub];
    let audit = audit_of(&audits, &servers);
    let renewed = no_renewal();
    let server = stub.url("/mcp");
    let call = Call {
        server: &server,
        token: "old",
        audit: &audit,
        renewed: &renewed,
    };
    let e = client().list(&call).await.err();
    assert_eq!(e, Some(McpClientError::Unauthorized));
}

/// A grant as the client stores it after a sign-in.
fn grant(access: &str, refresh: &str, token_endpoint: &str) -> String {
    json!({"access": access, "refresh": refresh, "client_id": "cid",
        "token_endpoint": token_endpoint})
    .to_string()
}

#[tokio::test]
async fn an_expired_token_is_refreshed_kept_and_retried_once() {
    let stub = mcp(true, |method, _, r| {
        if r.headers.get("authorization").map(String::as_str) != Some("Bearer new") {
            return Some(StubResponse::status(401));
        }
        (method == "resources/list").then(|| rpc(id(r), json!({"resources": []})))
    });
    let auth = StubServer::start(|r| {
        let ok = r.path == "/token"
            && r.field("grant_type").as_deref() == Some("refresh_token")
            && r.field("refresh_token").as_deref() == Some("r1")
            && r.field("client_id").as_deref() == Some("cid");
        if ok {
            StubResponse::json(
                200,
                json!({"access_token": "new", "refresh_token": "r2", "expires_in": 3600,
                    "token_type": "Bearer"}),
            )
        } else {
            StubResponse::status(400)
        }
    });
    let audits = Audits::new(true);
    let servers = [&stub, &auth];
    let audit = audit_of(&audits, &servers);
    let kept: Mutex<Vec<String>> = Mutex::default();
    let renewed = |g: String| lock(&kept).push(g);
    let server = stub.url("/mcp");
    let token = grant("old", "r1", &auth.url("/token"));
    let call = Call {
        server: &server,
        token: &token,
        audit: &audit,
        renewed: &renewed,
    };
    let client = client();
    let listing = client.list(&call).await.unwrap().unwrap();
    assert!(listing.items.is_empty() && listing.complete);
    let stored = lock(&kept).clone();
    assert_eq!(stored.len(), 1, "the refreshed grant is handed back once");
    let stored: Value = serde_json::from_str(&stored[0]).unwrap();
    assert_eq!(stored["access"], "new");
    assert_eq!(stored["refresh"], "r2");
    // The run goes on with the new grant: no second refresh.
    client.list(&call).await.unwrap();
    assert_eq!(auth.requests().len(), 1);
    audited_before_each(&audits, &servers);
}

#[tokio::test]
async fn a_failed_refresh_is_unauthorized() {
    let stub = StubServer::start(|_| StubResponse::status(401));
    let auth = StubServer::start(|_| StubResponse::json(400, json!({"error": "invalid_grant"})));
    let audits = Audits::new(true);
    let servers = [&stub, &auth];
    let audit = audit_of(&audits, &servers);
    let renewed = no_renewal();
    let server = stub.url("/mcp");
    let token = grant("old", "r1", &auth.url("/token"));
    let call = Call {
        server: &server,
        token: &token,
        audit: &audit,
        renewed: &renewed,
    };
    let e = client().read(&call, "doc://a").await.err();
    assert_eq!(e, Some(McpClientError::Unauthorized));
    assert_eq!(auth.requests().len(), 1);
}

#[tokio::test]
async fn an_unreachable_server_is_offline() {
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let server = format!(
        "http://127.0.0.1:{}/mcp",
        closed.local_addr().unwrap().port()
    );
    drop(closed);
    let audit = |_: &str, _: &[u8]| true;
    let renewed = no_renewal();
    let call = Call {
        server: &server,
        token: "t",
        audit: &audit,
        renewed: &renewed,
    };
    assert_eq!(
        client().list(&call).await.err(),
        Some(McpClientError::Offline)
    );
    assert_eq!(
        client().sign_in(&server, &audit).await.err(),
        Some(McpClientError::Offline)
    );
}

#[tokio::test]
async fn nothing_leaves_without_its_audit_row() {
    let stub = mcp(true, |_, _, _| None);
    let audits = Audits::new(false);
    let servers = [&stub];
    let audit = audit_of(&audits, &servers);
    let renewed = no_renewal();
    let server = stub.url("/mcp");
    let call = Call {
        server: &server,
        token: "t",
        audit: &audit,
        renewed: &renewed,
    };
    let e = client().list(&call).await.err();
    assert_eq!(e, Some(McpClientError::Unaudited));
    let e = client().sign_in(&server, &audit).await.err();
    assert_eq!(e, Some(McpClientError::Unaudited));
    assert!(stub.requests().is_empty());
}

#[tokio::test]
async fn the_gate_refuses_what_is_not_the_configured_server() {
    let audit = |_: &str, _: &[u8]| -> bool { panic!("nothing may be audited or sent") };
    let renewed = no_renewal();
    for server in [
        "ftp://127.0.0.1/mcp",
        "http://user:pw@127.0.0.1/mcp",
        "http://example.com/mcp",
        "not a url",
    ] {
        let call = Call {
            server,
            token: "t",
            audit: &audit,
            renewed: &renewed,
        };
        assert_eq!(
            client().list(&call).await.err(),
            Some(McpClientError::Invalid),
            "{server}"
        );
        assert_eq!(
            client().sign_in(server, &audit).await.err(),
            Some(McpClientError::Invalid),
            "{server}"
        );
    }
}

#[tokio::test]
async fn a_server_that_needs_no_sign_in_gets_an_empty_grant() {
    let stub = mcp(true, |method, _, r| {
        assert!(!r.headers.contains_key("authorization"));
        (method == "resources/list").then(|| rpc(id(r), json!({"resources": []})))
    });
    let audits = Audits::new(true);
    let servers = [&stub];
    let audit = audit_of(&audits, &servers);
    let server = stub.url("/mcp");
    let client = client();
    let token = client.sign_in(&server, &audit).await.unwrap();
    let renewed = no_renewal();
    let call = Call {
        server: &server,
        token: &token,
        audit: &audit,
        renewed: &renewed,
    };
    assert!(client.list(&call).await.unwrap().is_some());
    audited_before_each(&audits, &servers);
}

#[derive(Clone, Copy, PartialEq)]
enum Browser {
    Approve,
    Deny,
    /// Comes back with another flow's state, then never again.
    WrongState,
}

/// An MCP server that requires OAuth, with its protected-resource metadata, and its own
/// authorization server (dynamic registration, PKCE S256). `token_elsewhere` makes the
/// authorization server name a token endpoint on another origin.
struct OAuthWorld {
    resource: StubServer,
    auth: StubServer,
    /// What the browser was asked to open.
    opened: Arc<Mutex<Vec<String>>>,
    challenge: Arc<Mutex<Option<String>>>,
}

impl OAuthWorld {
    fn new(token_elsewhere: Option<u16>) -> Self {
        let challenge: Arc<Mutex<Option<String>>> = Arc::default();
        let auth_port: Arc<Mutex<u16>> = Arc::default();
        let port = auth_port.clone();
        let issued = challenge.clone();
        let auth = StubServer::start(move |r| {
            let base = format!("http://127.0.0.1:{}", *lock(&port));
            match r.path.as_str() {
                "/.well-known/oauth-authorization-server" => {
                    let token = token_elsewhere.map_or(format!("{base}/token"), |p| {
                        format!("http://127.0.0.1:{p}/token")
                    });
                    StubResponse::json(
                        200,
                        json!({"issuer": base,
                            "authorization_endpoint": format!("{base}/authorize"),
                            "token_endpoint": token,
                            "registration_endpoint": format!("{base}/register"),
                            "code_challenge_methods_supported": ["S256"]}),
                    )
                }
                "/register" => {
                    let body = r.json();
                    let loopback = body["redirect_uris"][0]
                        .as_str()
                        .is_some_and(|u| u.starts_with("http://127.0.0.1:"));
                    if !loopback || body["token_endpoint_auth_method"] != "none" {
                        return StubResponse::status(400);
                    }
                    StubResponse::json(201, json!({"client_id": "noter-cid"}))
                }
                "/token" => {
                    let verifier = r.field("code_verifier").unwrap_or_default();
                    let hashed = base64::engine::general_purpose::URL_SAFE_NO_PAD
                        .encode(Sha256::digest(verifier.as_bytes()));
                    let ok = r.field("grant_type").as_deref() == Some("authorization_code")
                        && r.field("code").as_deref() == Some("the-code")
                        && r.field("client_id").as_deref() == Some("noter-cid")
                        && r.field("redirect_uri").is_some()
                        && lock(&issued).as_deref() == Some(hashed.as_str());
                    if !ok {
                        return StubResponse::json(400, json!({"error": "invalid_grant"}));
                    }
                    StubResponse::json(
                        200,
                        json!({"access_token": "granted", "refresh_token": "r1",
                            "expires_in": 3600, "token_type": "Bearer"}),
                    )
                }
                _ => StubResponse::status(404),
            }
        });
        *lock(&auth_port) = auth.port;
        let auth_base = auth.url("");
        let resource_port: Arc<Mutex<u16>> = Arc::default();
        let rport = resource_port.clone();
        let resource = StubServer::start(move |r| {
            let base = format!("http://127.0.0.1:{}", *lock(&rport));
            if r.path == "/.well-known/oauth-protected-resource/mcp" {
                return StubResponse::json(
                    200,
                    json!({"resource": format!("{base}/mcp"),
                        "authorization_servers": [auth_base]}),
                );
            }
            if r.headers.get("authorization").map(String::as_str) != Some("Bearer granted") {
                let named = format!(
                    "Bearer resource_metadata=\"{base}/.well-known/oauth-protected-resource/mcp\""
                );
                return StubResponse::status(401).header("WWW-Authenticate", &named);
            }
            mcp_answer(true, r, &|method, _, r| {
                (method == "resources/list").then(|| rpc(id(r), json!({"resources": []})))
            })
        });
        *lock(&resource_port) = resource.port;
        Self {
            resource,
            auth,
            opened: Arc::default(),
            challenge,
        }
    }

    /// A client whose browser answers the authorization URL as `browser` does.
    fn client(&self, browser: Browser) -> McpClient {
        let opened = self.opened.clone();
        let challenge = self.challenge.clone();
        let open = move |url: &str| {
            lock(&opened).push(url.to_owned());
            let url = Url::parse(url).unwrap();
            let param = |name: &str| {
                url.query_pairs()
                    .find(|(k, _)| k == name)
                    .map(|(_, v)| v.into_owned())
                    .unwrap_or_default()
            };
            *lock(&challenge) = Some(param("code_challenge"));
            let redirect = Url::parse(&param("redirect_uri")).unwrap();
            let query = match browser {
                Browser::Approve => format!("code=the-code&state={}", param("state")),
                Browser::Deny => format!("error=access_denied&state={}", param("state")),
                Browser::WrongState => "code=the-code&state=another".to_owned(),
            };
            let target = format!("{}?{query}", redirect.path());
            let addr = format!("127.0.0.1:{}", redirect.port().unwrap());
            thread::spawn(move || {
                let mut stream = TcpStream::connect(addr).unwrap();
                let request = format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
                stream.write_all(request.as_bytes()).unwrap();
                let mut answer = String::new();
                let _ = stream.read_to_string(&mut answer);
            });
        };
        McpClient::new(Arc::new(open)).sign_in_deadline(Duration::from_millis(500))
    }

    fn opened(&self) -> Vec<String> {
        lock(&self.opened).clone()
    }
}

#[tokio::test]
async fn signs_in_with_pkce_through_the_browser_and_a_loopback_redirect() {
    let world = OAuthWorld::new(None);
    let audits = Audits::new(true);
    let servers = [&world.resource, &world.auth];
    let audit = audit_of(&audits, &servers);
    let server = world.resource.url("/mcp");
    let client = world.client(Browser::Approve);
    let token = client.sign_in(&server, &audit).await.unwrap();

    let opened = world.opened();
    assert_eq!(opened.len(), 1);
    let url = Url::parse(&opened[0]).unwrap();
    assert_eq!(url.path(), "/authorize");
    let params: std::collections::HashMap<String, String> =
        url.query_pairs().into_owned().collect();
    assert_eq!(params["response_type"], "code");
    assert_eq!(params["client_id"], "noter-cid");
    assert_eq!(params["code_challenge_method"], "S256");
    assert_eq!(params["resource"], server);
    assert!(params["state"].len() >= 16);
    assert!(params["code_challenge"].len() >= 43);
    // The loopback listener lived for this flow only.
    let redirect = Url::parse(&params["redirect_uri"]).unwrap();
    assert_eq!(redirect.host_str(), Some("127.0.0.1"));
    assert!(TcpStream::connect(("127.0.0.1", redirect.port().unwrap())).is_err());

    let grant: Value = serde_json::from_str(&token).unwrap();
    assert_eq!(grant["access"], "granted");
    assert_eq!(grant["refresh"], "r1");
    assert_eq!(grant["client_id"], "noter-cid");
    let renewed = no_renewal();
    let call = Call {
        server: &server,
        token: &token,
        audit: &audit,
        renewed: &renewed,
    };
    assert!(client.list(&call).await.unwrap().is_some());
    audited_before_each(&audits, &servers);
}

#[tokio::test]
async fn a_refused_sign_in_is_cancelled() {
    let world = OAuthWorld::new(None);
    let audit = |_: &str, _: &[u8]| true;
    let server = world.resource.url("/mcp");
    let e = world.client(Browser::Deny).sign_in(&server, &audit).await;
    assert_eq!(e.err(), Some(McpClientError::Cancelled));
    assert!(world.auth.requests().iter().all(|r| r.path != "/token"));
}

#[tokio::test]
async fn a_redirect_with_another_state_is_ignored_until_the_deadline() {
    let world = OAuthWorld::new(None);
    let audit = |_: &str, _: &[u8]| true;
    let server = world.resource.url("/mcp");
    let e = world
        .client(Browser::WrongState)
        .sign_in(&server, &audit)
        .await;
    assert_eq!(e.err(), Some(McpClientError::Cancelled));
    assert!(world.auth.requests().iter().all(|r| r.path != "/token"));
}

#[tokio::test]
async fn the_gate_refuses_a_token_endpoint_off_the_authorization_server() {
    let elsewhere = StubServer::start(|_| StubResponse::status(500));
    let world = OAuthWorld::new(Some(elsewhere.port));
    let audit = |_: &str, _: &[u8]| true;
    let server = world.resource.url("/mcp");
    let e = world
        .client(Browser::Approve)
        .sign_in(&server, &audit)
        .await;
    assert_eq!(e.err(), Some(McpClientError::Invalid));
    assert!(elsewhere.requests().is_empty());
    assert!(world.opened().is_empty(), "no browser for a refused flow");
}
