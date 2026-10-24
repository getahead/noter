//! The harness as a process (`.plans/core-harness.md` §4, W9–W11): exit codes, stdout that
//! holds only protocol lines, and a refused start before any request is read.

use std::io::Write;
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

fn harness(args: &[&str]) -> Child {
    Command::new(env!("CARGO_BIN_EXE_noter-core-harness"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}

/// Waits for the process to exit, failing the test after 10 s.
fn exited(mut child: Child) -> Output {
    let end = Instant::now() + Duration::from_secs(10);
    while child.try_wait().unwrap().is_none() {
        assert!(Instant::now() < end, "the harness did not exit");
        std::thread::sleep(Duration::from_millis(20));
    }
    child.wait_with_output().unwrap()
}

fn run(args: &[&str], stdin: &str) -> Output {
    let mut child = harness(args);
    child
        .stdin
        .take()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap(); // dropping it ends stdin
    exited(child)
}

// W9
#[test]
fn eof_answers_every_request_and_exits_zero() {
    let out = run(
        &["--fixture", "world"],
        "{\"id\":1,\"window\":\"main\",\"cmd\":\"app_snapshot\",\"args\":{}}\n{\"id\":2,\"window\":\"main\",\"cmd\":\"settings_get\",\"args\":{}}\n",
    );
    assert_eq!(out.status.code(), Some(0));
    let ids: Vec<Value> = String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str::<Value>(l).unwrap()["id"].clone())
        .filter(|id| !id.is_null()) // the event lines of seeding and shutdown carry no id
        .collect();
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&1.into()) && ids.contains(&2.into()));
}

// W10
#[test]
fn stdout_holds_only_protocol_lines() {
    let out = run(&[], "not json\n{\"id\":1,\"window\":\"call-screen\",\"cmd\":\"hotkeys_list\"}\n\n{\"id\":2,\"window\":\"main\",\"cmd\":\"nope\"}\n");
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8(out.stdout).unwrap();
    let replies = stdout
        .lines()
        .filter(|l| serde_json::from_str::<Value>(l).is_ok_and(|v| v.get("id").is_some()));
    assert_eq!(replies.count(), 3);
    for line in stdout.lines() {
        let v: Value =
            serde_json::from_str(line).unwrap_or_else(|_| panic!("not a protocol line: {line}"));
        let reply = v.get("id").is_some()
            && (v.get("ok").is_some() || v.get("error").is_some() || v.get("message").is_some());
        let event = v.get("event").is_some() && v.get("payload").is_some();
        assert!(reply || event, "not a protocol line: {line}");
    }
    assert!(
        String::from_utf8(out.stderr)
            .unwrap()
            .contains("noter-core-harness"),
        "logs go to stderr"
    );
}

// W11
#[test]
fn bad_fixture_exits_nonzero_before_reading() {
    let out = exited(harness(&["--fixture", "nope"])); // stdin stays open: it must not wait for it
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8(out.stderr).unwrap().contains("nope"));
}

#[test]
fn unknown_flag_exits_nonzero_before_reading() {
    let out = exited(harness(&["--fast"]));
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8(out.stderr).unwrap().contains("--fast"));
}

// W10: the fixture is seeded through the core's commands; its events are not the test's to see
#[test]
fn fixture_seeding_emits_no_events() {
    let out = run(&["--fixture", "world"], "");
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(String::from_utf8(out.stdout).unwrap(), "");
}

#[test]
fn bad_engine_script_exits_two_naming_the_line_before_reading() {
    let dir = std::env::temp_dir().join(format!("engine-script-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("bad.jsonl");
    std::fs::write(
        &file,
        "// ok\n{\"on\": \"stop\", \"after_ms\": 0, \"kill\": true}\nnot json\n",
    )
    .unwrap();
    let out = run(&["--engine-script", file.to_str().unwrap()], "");
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("line 3"));
    std::fs::write(
        &file,
        "{\"on\": \"stop\", \"after_ms\": 0, \"kill\": true}\n",
    )
    .unwrap();
    assert_eq!(
        run(&["--engine-script", file.to_str().unwrap()], "")
            .status
            .code(),
        Some(0)
    );
    let _ = std::fs::remove_dir_all(dir);
}
