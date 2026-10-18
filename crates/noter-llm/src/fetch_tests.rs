//! The range fetcher against a local HTTP server, inside the crate so the test-only
//! allow-list (`for_local_tests`) is never public (no real network): resume, a server that
//! ignores ranges, redirects on and off the allow-list, HTTP errors, offline and stopping early.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::thread;
use std::time::Duration;

use crate::{allowed_download_url, FetchError, RangeFetcher};

/// Serves until the test ends. Routes: /file (honours Range), /norange (ignores Range),
/// /redirect-ok (to /file), /redirect-off (to another host), /missing (404), /done (416),
/// /early (206 from the start, not the asked byte), /late (206 three bytes past it),
/// /stall (sends part of the body, then nothing while keeping the connection open).
fn server(body: &'static [u8]) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let path = line.split_whitespace().nth(1).unwrap_or("/").to_string();
            let mut from = 0usize;
            loop {
                let mut h = String::new();
                if reader.read_line(&mut h).unwrap() == 0 || h == "\r\n" {
                    break;
                }
                if let Some(v) = h.to_ascii_lowercase().strip_prefix("range: bytes=") {
                    from = v.trim().trim_end_matches('-').parse().unwrap();
                }
            }
            let mut out = stream;
            let response = |status: &str, headers: &str, body: &[u8]| {
                let mut r = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n",
                    body.len()
                )
                .into_bytes();
                r.extend_from_slice(body);
                r
            };
            let range = |start: usize| {
                format!(
                    "Content-Range: bytes {start}-{}/{}\r\n",
                    body.len() - 1,
                    body.len()
                )
            };
            if path == "/stall" {
                let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", body.len());
                let _ = out.write_all(head.as_bytes());
                let _ = out.write_all(&body[..5]);
                let _ = out.flush();
                thread::sleep(Duration::from_secs(5));
                continue;
            }
            let reply = match path.as_str() {
                "/file" if from > 0 => response("206 Partial Content", &range(from), &body[from..]),
                "/early" => response("206 Partial Content", &range(0), body),
                "/late" => response("206 Partial Content", &range(from + 3), &body[from + 3..]),
                "/file" | "/norange" => response("200 OK", "", body),
                "/redirect-ok" => response(
                    "302 Found",
                    &format!("Location: http://127.0.0.1:{port}/file\r\n"),
                    b"",
                ),
                "/redirect-off" => response(
                    "302 Found",
                    "Location: http://localhost.example:1/file\r\n",
                    b"",
                ),
                "/done" => response("416 Range Not Satisfiable", "", b""),
                _ => response("404 Not Found", "", b""),
            };
            let _ = out.write_all(&reply);
            let _ = out.flush();
            let _ = reader.read_to_end(&mut Vec::new());
        }
    });
    port
}

const BODY: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";

async fn get(port: u16, path: &str, from: u64) -> (Result<(), FetchError>, Vec<u8>) {
    let fetcher = RangeFetcher::for_local_tests();
    let mut got = Vec::new();
    let r = fetcher
        .fetch(&format!("http://127.0.0.1:{port}{path}"), from, &mut |b| {
            got.extend_from_slice(b);
            true
        })
        .await;
    (r, got)
}

#[tokio::test]
async fn fetches_the_whole_file_and_resumes_from_a_byte() {
    let port = server(BODY);
    assert_eq!(get(port, "/file", 0).await, (Ok(()), BODY.to_vec()));
    assert_eq!(get(port, "/file", 10).await, (Ok(()), BODY[10..].to_vec()));
}

#[tokio::test]
async fn a_server_that_ignores_the_range_still_resumes_correctly() {
    let port = server(BODY);
    assert_eq!(
        get(port, "/norange", 10).await,
        (Ok(()), BODY[10..].to_vec())
    );
}

#[tokio::test]
async fn redirects_are_followed_only_onto_allowed_hosts() {
    let port = server(BODY);
    assert_eq!(get(port, "/redirect-ok", 0).await, (Ok(()), BODY.to_vec()));
    assert_eq!(
        get(port, "/redirect-off", 0).await.0,
        Err(FetchError::NotAllowed)
    );
}

#[tokio::test]
async fn http_errors_offline_and_an_already_complete_file() {
    let port = server(BODY);
    assert_eq!(get(port, "/missing", 0).await.0, Err(FetchError::Http(404)));
    assert_eq!(get(port, "/done", 36).await, (Ok(()), vec![]));
    // Nothing listens on this port any more.
    let closed = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    assert_eq!(get(closed, "/file", 0).await.0, Err(FetchError::Offline));
}

#[tokio::test]
async fn the_sink_can_stop_the_download() {
    let port = server(BODY);
    let fetcher = RangeFetcher::for_local_tests();
    let mut calls = 0;
    let r = fetcher
        .fetch(&format!("http://127.0.0.1:{port}/file"), 0, &mut |_| {
            calls += 1;
            false
        })
        .await;
    assert_eq!((r, calls), (Ok(()), 1));
}

#[tokio::test]
async fn the_real_fetcher_refuses_anything_off_the_allow_list_without_a_request() {
    let fetcher = RangeFetcher::new();
    let mut called = false;
    for url in [
        "http://huggingface.co/x",
        "https://evil.example/x",
        "not a url",
    ] {
        let r = fetcher
            .fetch(url, 0, &mut |_| {
                called = true;
                true
            })
            .await;
        assert_eq!(r, Err(FetchError::NotAllowed), "{url}");
    }
    assert!(!called);
}

#[test]
fn only_https_urls_of_the_model_download_hosts_are_allowed() {
    assert!(allowed_download_url(
        "https://huggingface.co/argmaxinc/whisperkit-coreml/resolve/abc/x"
    ));
    assert!(allowed_download_url("https://cdn-lfs.hf.co/a/b"));
    assert!(!allowed_download_url("http://huggingface.co/x"));
    assert!(!allowed_download_url("https://evil.example/x"));
    assert!(!allowed_download_url(
        "https://huggingface.co.evil.example/x"
    ));
    assert!(!allowed_download_url("https://user@huggingface.co/x"));
    assert!(!allowed_download_url("https://api.anthropic.com/v1"));
    assert!(!allowed_download_url("not a url"));
}

#[test]
fn every_pinned_file_is_on_the_allow_list_with_a_sha256() {
    for f in crate::MANIFEST {
        assert!(allowed_download_url(f.url), "{}", f.url);
        assert!(
            f.sha256.len() == 64 && f.sha256.chars().all(|c| c.is_ascii_hexdigit()),
            "{}",
            f.url
        );
        assert!(f.size_bytes > 0 && !f.bundle.is_empty(), "{}", f.url);
    }
}

#[tokio::test]
async fn a_206_from_an_earlier_byte_is_skipped_to_the_asked_one_and_a_later_one_refused() {
    let port = server(BODY);
    assert_eq!(get(port, "/early", 10).await, (Ok(()), BODY[10..].to_vec()));
    let (r, got) = get(port, "/late", 10).await;
    assert!(matches!(r, Err(FetchError::Io(_))), "{r:?}");
    assert!(got.is_empty());
}

#[tokio::test]
async fn a_transfer_that_stalls_mid_body_ends_offline() {
    let port = server(BODY);
    let (r, got) = get(port, "/stall", 0).await;
    assert_eq!((r, got), (Err(FetchError::Offline), BODY[..5].to_vec()));
}

#[test]
fn the_model_download_hosts_are_the_typed_protocol_list() {
    let group = noter_protocol::egress::ALLOW_WITHOUT_AUDIT
        .iter()
        .find(|g| g.name == "model_downloads")
        .unwrap();
    assert!(!group.hosts.is_empty());
    assert_eq!(crate::model_hosts(), group.hosts);
}

#[test]
fn the_fetcher_reaches_only_the_model_download_hosts() {
    let list: serde_json::Value =
        serde_json::from_str(include_str!("../../../contracts/egress-hosts.json")).unwrap();
    let model = &list["allow_without_audit"]["model_downloads"]["hosts"];
    let model: Vec<&str> = model
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|h| h.as_str())
        .collect();
    assert!(!model.is_empty());
    assert_eq!(crate::model_hosts(), model.as_slice());
    // Every other host the contract names is out of reach.
    let mut others = Vec::new();
    collect_hosts(&list["provider_hosts"], &mut others);
    for (name, group) in list["allow_without_audit"].as_object().unwrap() {
        if name != "model_downloads" {
            collect_hosts(group, &mut others);
        }
    }
    for host in others.iter().filter(|h| !model.contains(h)) {
        assert!(
            !allowed_download_url(&format!("https://{host}/x")),
            "{host}"
        );
    }
    assert!(others.len() > 5);
}

fn collect_hosts<'a>(v: &'a serde_json::Value, out: &mut Vec<&'a str>) {
    match v {
        serde_json::Value::String(s) if !s.contains(' ') => out.push(s),
        serde_json::Value::Array(a) => a.iter().for_each(|x| collect_hosts(x, out)),
        serde_json::Value::Object(o) => o
            .iter()
            .filter(|(k, _)| *k != "$comment" && *k != "note")
            .for_each(|(_, x)| collect_hosts(x, out)),
        _ => {}
    }
}
