//! Indexed MCP servers over streamable HTTP (TL-42): JSON-RPC 2.0 to the user's own server
//! (`resources/list`, `resources/read`, a `search` tool call when it lists no resources) and the
//! server's OAuth 2.1 sign-in (metadata discovery, dynamic client registration, PKCE S256, the
//! browser and a loopback redirect on 127.0.0.1 for one flow only).
//!
//! The gate on destinations: https, or plain http to this Mac, never credentials in the URL,
//! only the configured server's origin and the authorization server its metadata names (whose
//! endpoints must be on its own origin), no redirects, no proxy. Every request's audit row is
//! written through `audit` first; nothing is sent when it fails. No token, page or document text
//! is ever logged.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE, WWW_AUTHENTICATE,
};
use reqwest::redirect::Policy;
use reqwest::{Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::runtime::lock;

const PROTOCOL: &str = "2025-06-18";
/// `resources/list` pages read before a listing counts as partial.
const PAGES: usize = 100;
const METHOD_NOT_FOUND: i64 = -32601;
/// The largest answer read, as for a folder file; a larger one is refused, never held.
const MAX_BODY: usize = 32 * 1024 * 1024;
const SESSION: HeaderName = HeaderName::from_static("mcp-session-id");
const VERSION: HeaderName = HeaderName::from_static("mcp-protocol-version");

/// Commits the `lookup` audit row of one request (destination host, the bytes that leave);
/// `false` means the request must not leave.
pub type Audit<'a> = &'a (dyn Fn(&str, &[u8]) -> bool + Send + Sync);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpClientError {
    /// The user refused or never finished the sign-in.
    Cancelled,
    /// The server or its authorization server cannot be reached.
    Offline,
    /// The token was rejected and could not be refreshed: sign in again.
    Unauthorized,
    /// Not a usable server, a destination off the gate, or an answer that is not MCP.
    Invalid,
    /// The audit row was not written, so nothing was sent.
    Unaudited,
}

use McpClientError::{Cancelled, Invalid, Offline, Unaudited, Unauthorized};

/// One request to an indexed server, with the token [`McpClient::sign_in`] returned.
pub struct Call<'a> {
    pub server: &'a str,
    pub token: &'a str,
    pub audit: Audit<'a>,
    /// Receives the token that replaces `token` after a refresh, to store in its place.
    pub renewed: &'a (dyn Fn(String) + Send + Sync),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Resource {
    pub uri: String,
    pub title: String,
    /// The server's `lastModified`, when it gives one.
    pub version: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Resources {
    pub items: Vec<Resource>,
    /// False when the listing stopped before its last page.
    pub complete: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Contents {
    pub mime: String,
    pub text: String,
}

/// What the token string holds: the access token and what refreshing it needs. A plain string
/// that is not this JSON is a bearer token without a refresh. No `Debug`: it is a credential.
#[derive(Clone, Default, Serialize, Deserialize)]
struct Grant {
    access: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    refresh: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    token_endpoint: Option<String>,
}

impl Grant {
    fn of(token: &str) -> Self {
        serde_json::from_str(token).unwrap_or_else(|_| Grant {
            access: token.to_owned(),
            ..Grant::default()
        })
    }

    fn token(&self) -> String {
        serde_json::to_string(self).expect("a grant serializes")
    }
}

#[derive(Deserialize)]
struct Tokens {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
}

pub struct McpClient {
    http: reqwest::Client,
    /// Opens a URL in the user's browser.
    open: Arc<dyn Fn(&str) + Send + Sync>,
    sign_in_deadline: Duration,
    next_id: AtomicU64,
    /// Server → its MCP session id (`None`: the server keeps none).
    sessions: Mutex<HashMap<String, Option<String>>>,
    /// A token a refresh replaced → its replacement, for the rest of the run.
    renewed: Mutex<HashMap<String, String>>,
}

impl McpClient {
    pub fn new(open: Arc<dyn Fn(&str) + Send + Sync>) -> Self {
        let http = reqwest::Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .build()
            .expect("a client with rustls and no redirects always builds");
        Self {
            http,
            open,
            sign_in_deadline: Duration::from_secs(300),
            next_id: AtomicU64::new(1),
            sessions: Mutex::default(),
            renewed: Mutex::default(),
        }
    }

    /// How long a sign-in waits for the browser to come back (five minutes by default).
    pub fn sign_in_deadline(mut self, deadline: Duration) -> Self {
        self.sign_in_deadline = deadline;
        self
    }

    /// The server's resources, every page; `None` when it offers none.
    pub async fn list(&self, call: &Call<'_>) -> Result<Option<Resources>, McpClientError> {
        let mut items = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..PAGES {
            let params = cursor
                .as_ref()
                .map_or(json!({}), |c| json!({ "cursor": c }));
            let page = match self.rpc(call, "resources/list", params).await? {
                Ok(page) => page,
                Err(METHOD_NOT_FOUND) if cursor.is_none() => return Ok(None),
                Err(_) => return Err(Invalid),
            };
            let listed = page["resources"].as_array().into_iter().flatten();
            items.extend(listed.filter_map(|r| {
                let uri = r["uri"].as_str()?;
                Some(Resource {
                    uri: uri.to_owned(),
                    title: title(r, uri),
                    version: r["annotations"]["lastModified"].as_str().map(String::from),
                })
            }));
            cursor = page["nextCursor"].as_str().map(String::from);
            if cursor.is_none() {
                return Ok(Some(Resources {
                    items,
                    complete: true,
                }));
            }
        }
        Ok(Some(Resources {
            items,
            complete: false,
        }))
    }

    /// One resource's text contents, joined.
    pub async fn read(&self, call: &Call<'_>, uri: &str) -> Result<Contents, McpClientError> {
        let read = self
            .rpc(call, "resources/read", json!({ "uri": uri }))
            .await?;
        let read = read.map_err(|_| Invalid)?;
        let texts: Vec<&Value> = (read["contents"].as_array().into_iter().flatten())
            .filter(|c| c["text"].is_string())
            .collect();
        let mime = texts.first().and_then(|c| c["mimeType"].as_str());
        Ok(Contents {
            mime: mime.unwrap_or("text/plain").to_owned(),
            text: (texts.iter().filter_map(|c| c["text"].as_str()))
                .collect::<Vec<_>>()
                .join("\n"),
        })
    }

    /// The resources the server's `search` tool links for `query`; none when it has no such
    /// tool or the call fails.
    // shortcut: only `resource_link` and embedded `resource` results count; a server that
    // answers with plain text ids needs its own fetch tool (not in M3).
    pub async fn search(
        &self,
        call: &Call<'_>,
        query: &str,
    ) -> Result<Vec<Resource>, McpClientError> {
        let params = json!({ "name": "search", "arguments": { "query": query } });
        let Ok(result) = self.rpc(call, "tools/call", params).await? else {
            return Ok(Vec::new());
        };
        if result["isError"] == true {
            return Ok(Vec::new());
        }
        let content = result["content"].as_array().into_iter().flatten();
        Ok(content
            .filter_map(|c| {
                let r = match c["type"].as_str()? {
                    "resource_link" => c,
                    "resource" => &c["resource"],
                    _ => return None,
                };
                let uri = r["uri"].as_str()?;
                Some(Resource {
                    uri: uri.to_owned(),
                    title: title(r, uri),
                    version: None,
                })
            })
            .collect())
    }

    /// The server's sign-in: the token string to keep for it. A server that answers without
    /// one gets an empty grant.
    pub async fn sign_in(&self, server: &str, audit: Audit<'_>) -> Result<String, McpClientError> {
        let url = usable(server)?;
        let probe = initialize(0);
        let (status, headers, _) = self
            .post(audit, &url, &Grant::default(), None, &probe)
            .await?;
        if status.is_success() {
            return Ok(Grant::default().token());
        }
        if status != StatusCode::UNAUTHORIZED {
            return Err(failure(status));
        }
        // Discovery: the protected resource names its authorization server; without that
        // metadata the server's own origin is it.
        let named = (headers.get(WWW_AUTHENTICATE))
            .and_then(|v| v.to_str().ok())
            .and_then(resource_metadata);
        let resource = self.resource_metadata(audit, &url, named).await?;
        let issuer = match resource["authorization_servers"][0].as_str() {
            Some(issuer) => usable(issuer)?,
            None => origin(&url),
        };
        let metadata = self.issuer_metadata(audit, &issuer).await?;
        let endpoint = |name: &str| {
            let at = metadata[name].as_str().ok_or(Invalid)?;
            let at = usable(at)?;
            same_origin(&at, &issuer).then_some(at).ok_or(Invalid)
        };
        let authorize = endpoint("authorization_endpoint")?;
        let token = endpoint("token_endpoint")?;
        // shortcut: only servers that offer dynamic client registration; a client id
        // registered per server is the owner's (TL-47).
        let register = endpoint("registration_endpoint")?;
        let methods = metadata["code_challenge_methods_supported"].as_array();
        if methods.is_some_and(|m| !m.iter().any(|m| m == "S256")) {
            return Err(Invalid);
        }
        // The loopback listener lives for this flow only.
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| Invalid)?;
        let port = listener.local_addr().map_err(|_| Invalid)?.port();
        let redirect = format!("http://127.0.0.1:{port}/callback");
        let client_id = self.register(audit, &register, &redirect).await?;
        let verifier = random(32)?;
        let state = random(16)?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut browse = authorize;
        browse
            .query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &client_id)
            .append_pair("redirect_uri", &redirect)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state)
            .append_pair("resource", server);
        (self.open)(browse.as_str());
        let code = tokio::time::timeout(self.sign_in_deadline, redirected(&listener, &state))
            .await
            .map_err(|_| Cancelled)??;
        drop(listener);
        let exchange = form(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect),
            ("client_id", &client_id),
            ("code_verifier", &verifier),
            ("resource", server),
        ]);
        let tokens = self.tokens(audit, &token, exchange).await?;
        Ok(Grant {
            access: tokens.access_token,
            refresh: tokens.refresh_token,
            client_id: Some(client_id),
            token_endpoint: Some(token.into()),
        }
        .token())
    }

    /// One JSON-RPC request: its result, or the server's error code. A rejected token is
    /// refreshed once and the request retried.
    async fn rpc(
        &self,
        call: &Call<'_>,
        method: &str,
        params: Value,
    ) -> Result<Result<Value, i64>, McpClientError> {
        let url = usable(call.server)?;
        let current = lock(&self.renewed).get(call.token).cloned();
        let mut grant = Grant::of(current.as_deref().unwrap_or(call.token));
        match self.attempt(call, &url, &grant, method, &params).await {
            Err(Unauthorized) if grant.refresh.is_some() => {
                grant = self.refresh(call, &grant).await?;
                self.attempt(call, &url, &grant, method, &params).await
            }
            answered => answered,
        }
    }

    async fn attempt(
        &self,
        call: &Call<'_>,
        url: &Url,
        grant: &Grant,
        method: &str,
        params: &Value,
    ) -> Result<Result<Value, i64>, McpClientError> {
        // A session the server forgot (404) is opened again, once.
        for _ in 0..2 {
            let known = lock(&self.sessions).get(call.server).cloned();
            let session = match known {
                Some(session) => session,
                None => self.open_session(call, url, grant).await?,
            };
            let id = self.next_id.fetch_add(1, Ordering::Relaxed);
            let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
            let (status, headers, bytes) =
                (self.post(call.audit, url, grant, session.as_deref(), &message)).await?;
            if status == StatusCode::NOT_FOUND && session.is_some() {
                lock(&self.sessions).remove(call.server);
                continue;
            }
            if !status.is_success() {
                return Err(failure(status));
            }
            let answer = answer(&headers, &bytes, id)?;
            if let Some(code) = answer.get("error").map(|e| e["code"].as_i64()) {
                return Ok(Err(code.unwrap_or_default()));
            }
            return Ok(Ok(answer["result"].clone()));
        }
        Err(Invalid)
    }

    /// `initialize` and its notification; the session id the server gave, if any.
    async fn open_session(
        &self,
        call: &Call<'_>,
        url: &Url,
        grant: &Grant,
    ) -> Result<Option<String>, McpClientError> {
        let (status, headers, bytes) = self
            .post(call.audit, url, grant, None, &initialize(0))
            .await?;
        if !status.is_success() {
            return Err(failure(status));
        }
        if answer(&headers, &bytes, 0)?.get("result").is_none() {
            return Err(Invalid);
        }
        let session = (headers.get(SESSION))
            .and_then(|v| v.to_str().ok())
            .map(String::from);
        let note = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        let (status, _, _) = (self.post(call.audit, url, grant, session.as_deref(), &note)).await?;
        if !status.is_success() {
            return Err(failure(status));
        }
        lock(&self.sessions).insert(call.server.to_owned(), session.clone());
        Ok(session)
    }

    async fn refresh(&self, call: &Call<'_>, grant: &Grant) -> Result<Grant, McpClientError> {
        let (Some(refresh), Some(client_id), Some(endpoint)) =
            (&grant.refresh, &grant.client_id, &grant.token_endpoint)
        else {
            return Err(Unauthorized);
        };
        let endpoint = usable(endpoint)?;
        let body = form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh),
            ("client_id", client_id),
            ("resource", call.server),
        ]);
        let tokens = self.tokens(call.audit, &endpoint, body).await?;
        let renewed = Grant {
            access: tokens.access_token,
            refresh: tokens.refresh_token.or_else(|| grant.refresh.clone()),
            ..grant.clone()
        };
        let token = renewed.token();
        lock(&self.renewed).insert(call.token.to_owned(), token.clone());
        (call.renewed)(token);
        Ok(renewed)
    }

    /// A token request; a refused grant is `Unauthorized`.
    async fn tokens(
        &self,
        audit: Audit<'_>,
        endpoint: &Url,
        body: String,
    ) -> Result<Tokens, McpClientError> {
        let mut headers = HeaderMap::new();
        let form = HeaderValue::from_static("application/x-www-form-urlencoded");
        headers.insert(CONTENT_TYPE, form);
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        let response =
            (self.send(audit, Method::POST, endpoint, headers, body.into_bytes())).await?;
        let status = response.status();
        if matches!(status.as_u16(), 400 | 401) {
            return Err(Unauthorized);
        }
        if !status.is_success() {
            return Err(failure(status));
        }
        let bytes = capped(response).await?;
        serde_json::from_slice(&bytes).map_err(|_| Invalid)
    }

    /// Dynamic client registration (RFC 7591) as a public client of the loopback redirect.
    async fn register(
        &self,
        audit: Audit<'_>,
        endpoint: &Url,
        redirect: &str,
    ) -> Result<String, McpClientError> {
        let body = json!({
            "client_name": "Noter",
            "redirect_uris": [redirect],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        });
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        let body = body.to_string().into_bytes();
        let response = self
            .send(audit, Method::POST, endpoint, headers, body)
            .await?;
        if !response.status().is_success() {
            return Err(failure(response.status()));
        }
        let bytes = capped(response).await?;
        let registered: Value = serde_json::from_slice(&bytes).map_err(|_| Invalid)?;
        registered["client_id"]
            .as_str()
            .map(String::from)
            .ok_or(Invalid)
    }

    /// The protected-resource metadata (RFC 9728) on the server's own origin: where its 401
    /// said, else the well-known places; `Null` when there is none.
    async fn resource_metadata(
        &self,
        audit: Audit<'_>,
        server: &Url,
        named: Option<String>,
    ) -> Result<Value, McpClientError> {
        let path = server.path().trim_end_matches('/');
        let mut places = vec![];
        if let Some(named) = named {
            places.push(usable(&named)?);
        }
        places.push(well_known(server, "oauth-protected-resource", path));
        places.push(well_known(server, "oauth-protected-resource", ""));
        for place in places {
            if !same_origin(&place, server) {
                return Err(Invalid);
            }
            if let Some(found) = self.get_json(audit, &place).await? {
                return Ok(found);
            }
        }
        Ok(Value::Null)
    }

    /// The authorization server's metadata (RFC 8414, then OpenID discovery).
    async fn issuer_metadata(
        &self,
        audit: Audit<'_>,
        issuer: &Url,
    ) -> Result<Value, McpClientError> {
        let path = issuer.path().trim_end_matches('/');
        for kind in ["oauth-authorization-server", "openid-configuration"] {
            let place = well_known(issuer, kind, path);
            if let Some(found) = self.get_json(audit, &place).await? {
                return Ok(found);
            }
        }
        Err(Invalid)
    }

    async fn get_json(&self, audit: Audit<'_>, url: &Url) -> Result<Option<Value>, McpClientError> {
        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        let response = self
            .send(audit, Method::GET, url, headers, Vec::new())
            .await?;
        if !response.status().is_success() {
            return Ok(None);
        }
        let bytes = capped(response).await?;
        Ok(serde_json::from_slice(&bytes).ok())
    }

    async fn post(
        &self,
        audit: Audit<'_>,
        url: &Url,
        grant: &Grant,
        session: Option<&str>,
        message: &Value,
    ) -> Result<(StatusCode, HeaderMap, Vec<u8>), McpClientError> {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        let accept = HeaderValue::from_static("application/json, text/event-stream");
        headers.insert(ACCEPT, accept);
        headers.insert(VERSION, HeaderValue::from_static(PROTOCOL));
        if let Some(session) = session {
            headers.insert(
                SESSION,
                HeaderValue::from_str(session).map_err(|_| Invalid)?,
            );
        }
        if !grant.access.is_empty() {
            let bearer = HeaderValue::from_str(&format!("Bearer {}", grant.access));
            let mut bearer = bearer.map_err(|_| Invalid)?;
            bearer.set_sensitive(true);
            headers.insert(AUTHORIZATION, bearer);
        }
        let body = message.to_string().into_bytes();
        let response = self.send(audit, Method::POST, url, headers, body).await?;
        let (status, headers) = (response.status(), response.headers().clone());
        let bytes = capped(response).await?;
        Ok((status, headers, bytes.to_vec()))
    }

    /// The one way out: the audit row first (the body, or the URL of a GET), then the request.
    async fn send(
        &self,
        audit: Audit<'_>,
        method: Method,
        url: &Url,
        headers: HeaderMap,
        body: Vec<u8>,
    ) -> Result<reqwest::Response, McpClientError> {
        let out = if body.is_empty() {
            url.as_str().as_bytes()
        } else {
            &body
        };
        if !audit(url.host_str().unwrap_or_default(), out) {
            return Err(Unaudited);
        }
        let request = self.http.request(method, url.clone()).headers(headers);
        request.body(body).send().await.map_err(|_| Offline)
    }
}

/// The answer's body, up to [`MAX_BODY`].
async fn capped(mut response: reqwest::Response) -> Result<Vec<u8>, McpClientError> {
    let mut out = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Offline)? {
        if out.len() + chunk.len() > MAX_BODY {
            return Err(Invalid);
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

fn initialize(id: u64) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL,
            "capabilities": {},
            "clientInfo": { "name": "Noter", "version": env!("CARGO_PKG_VERSION") },
        },
    })
}

fn title(resource: &Value, uri: &str) -> String {
    let named = [&resource["title"], &resource["name"]];
    let title = named
        .into_iter()
        .find_map(|t| t.as_str().filter(|t| !t.is_empty()));
    title.unwrap_or(uri).to_owned()
}

/// The answer to request `id`, from a JSON body or an event stream of JSON messages.
// shortcut: one JSON message per `data:` line, as servers send them; multi-line data fields
// and batches are not read.
fn answer(headers: &HeaderMap, bytes: &[u8], id: u64) -> Result<Value, McpClientError> {
    let stream = (headers.get(CONTENT_TYPE).and_then(|v| v.to_str().ok()))
        .is_some_and(|t| t.starts_with("text/event-stream"));
    let messages: Vec<Value> = if stream {
        (String::from_utf8_lossy(bytes).lines())
            .filter_map(|l| l.strip_prefix("data:"))
            .filter_map(|d| serde_json::from_str(d.trim()).ok())
            .collect()
    } else {
        serde_json::from_slice(bytes).ok().into_iter().collect()
    };
    let id = json!(id);
    messages.into_iter().find(|m| m["id"] == id).ok_or(Invalid)
}

fn failure(status: StatusCode) -> McpClientError {
    match status.as_u16() {
        401 | 403 => Unauthorized,
        500.. => Offline,
        _ => Invalid,
    }
}

/// A destination the gate lets through: https, or plain http to this Mac, never with
/// credentials in it.
fn usable(url: &str) -> Result<Url, McpClientError> {
    let url = Url::parse(url).map_err(|_| Invalid)?;
    let host = url.host_str().unwrap_or_default();
    let local = matches!(host, "127.0.0.1" | "localhost" | "[::1]");
    let scheme = url.scheme() == "https" || (url.scheme() == "http" && local);
    let bare = url.username().is_empty() && url.password().is_none();
    (scheme && bare && !host.is_empty())
        .then_some(url)
        .ok_or(Invalid)
}

fn origin(url: &Url) -> Url {
    let mut origin = url.clone();
    origin.set_path("/");
    origin.set_query(None);
    origin.set_fragment(None);
    origin
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.origin() == b.origin()
}

fn well_known(base: &Url, kind: &str, path: &str) -> Url {
    let mut url = origin(base);
    url.set_path(&format!("/.well-known/{kind}{path}"));
    url
}

/// `resource_metadata="…"` of a `WWW-Authenticate: Bearer …` challenge.
fn resource_metadata(challenge: &str) -> Option<String> {
    let (_, rest) = challenge.split_once("resource_metadata=")?;
    let rest = rest.trim_start_matches('"');
    Some(rest.split(['"', ',']).next()?.trim().to_owned())
}

/// `application/x-www-form-urlencoded`.
fn form(fields: &[(&str, &str)]) -> String {
    // The URL parser's query encoder is that encoding; reqwest's own `form` feature is off.
    let mut url = Url::parse("http://form/").expect("a constant URL parses");
    url.query_pairs_mut().extend_pairs(fields);
    url.query().unwrap_or_default().to_owned()
}

/// `bytes` random bytes from the system, base64url.
fn random(bytes: usize) -> Result<String, McpClientError> {
    let mut buf = vec![0; bytes];
    getrandom::fill(&mut buf).map_err(|_| Invalid)?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

/// Waits on the loopback listener for the redirect of the flow with `state`: its code, or
/// `Cancelled` when the user refused. Anything else (another path, another state) is answered
/// 404 and the wait goes on.
async fn redirected(listener: &TcpListener, state: &str) -> Result<String, McpClientError> {
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|_| Cancelled)?;
        let mut head = vec![0; 8192];
        let n = stream.read(&mut head).await.unwrap_or(0);
        let head = String::from_utf8_lossy(&head[..n]);
        let target = (head.lines().next())
            .and_then(|l| l.split_whitespace().nth(1))
            .unwrap_or_default();
        let url = Url::parse(&format!("http://127.0.0.1{target}")).ok();
        let param = |name: &str| {
            let url = url.as_ref()?;
            let found = url.query_pairs().find(|(k, _)| k == name);
            found.map(|(_, v)| v.into_owned())
        };
        let ours = url.as_ref().is_some_and(|u| u.path() == "/callback")
            && param("state").as_deref() == Some(state);
        let (status, text, outcome) = match (ours, param("code")) {
            (false, _) => ("404 Not Found", "Not found.", None),
            (true, Some(code)) => (
                "200 OK",
                "Signed in. You can close this window and return to Noter.",
                Some(Ok(code)),
            ),
            (true, None) => (
                "200 OK",
                "The sign-in was not completed. You can close this window.",
                Some(Err(Cancelled)),
            ),
        };
        let reply = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\n\
             Content-Length: {}\r\nConnection: close\r\n\r\n{text}",
            text.len()
        );
        let _ = stream.write_all(reply.as_bytes()).await;
        if let Some(outcome) = outcome {
            return outcome;
        }
    }
}
