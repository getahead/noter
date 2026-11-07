//! A local HTTP server for tests of the MCP client (feature `local-tests`, a dev-dependency only:
//! never in the app). One request per connection; every request is recorded before it is
//! answered.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

use crate::runtime::lock;

/// A request as the stub received it; header names are lower case.
#[derive(Debug, Clone)]
pub struct StubRequest {
    pub method: String,
    pub path: String,
    pub query: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

impl StubRequest {
    /// The body as JSON (`Null` when it is not).
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).unwrap_or_default()
    }

    /// A query or form field.
    pub fn field(&self, name: &str) -> Option<String> {
        let form = String::from_utf8_lossy(&self.body);
        let query = format!("{}&{form}", self.query);
        reqwest::Url::parse(&format!("http://stub/?{query}"))
            .ok()?
            .query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
    }
}

pub struct StubResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl StubResponse {
    pub fn json(status: u16, body: serde_json::Value) -> Self {
        Self {
            status,
            headers: vec![("Content-Type".into(), "application/json".into())],
            body: body.to_string().into_bytes(),
        }
    }

    pub fn status(status: u16) -> Self {
        Self {
            status,
            headers: vec![],
            body: vec![],
        }
    }

    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }
}

type Handler = dyn Fn(&StubRequest) -> StubResponse + Send + Sync;

/// Serves `handler` on 127.0.0.1 until the test ends.
pub struct StubServer {
    pub port: u16,
    seen: Arc<Mutex<Vec<StubRequest>>>,
}

impl StubServer {
    pub fn start(handler: impl Fn(&StubRequest) -> StubResponse + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a local port");
        let port = listener.local_addr().expect("a bound address").port();
        let seen: Arc<Mutex<Vec<StubRequest>>> = Arc::default();
        let handler: Arc<Handler> = Arc::new(handler);
        let recorded = seen.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let Some(request) = read(&stream) else {
                    continue;
                };
                lock(&recorded).push(request.clone());
                let response = handler(&request);
                let mut head = format!(
                    "HTTP/1.1 {} STUB\r\nContent-Length: {}\r\nConnection: close\r\n",
                    response.status,
                    response.body.len()
                );
                for (name, value) in &response.headers {
                    head.push_str(&format!("{name}: {value}\r\n"));
                }
                head.push_str("\r\n");
                let mut out = &stream;
                let _ = out.write_all(head.as_bytes());
                let _ = out.write_all(&response.body);
                let _ = out.flush();
            }
        });
        Self { port, seen }
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    /// Every request so far, in order.
    pub fn requests(&self) -> Vec<StubRequest> {
        lock(&self.seen).clone()
    }
}

fn read(stream: &std::net::TcpStream) -> Option<StubRequest> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_owned();
    let target = parts.next()?.to_owned();
    let (path, query) = target.split_once('?').unwrap_or((&target, ""));
    let mut headers = HashMap::new();
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).ok()? == 0 || h == "\r\n" {
            break;
        }
        if let Some((name, value)) = h.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
        }
    }
    let length = headers
        .get("content-length")
        .and_then(|l| l.parse().ok())
        .unwrap_or(0);
    let mut body = vec![0; length];
    reader.read_exact(&mut body).ok()?;
    Some(StubRequest {
        method,
        path: path.to_owned(),
        query: query.to_owned(),
        headers,
        body,
    })
}
