//! The harness on the real core (`.plans/core-harness.md` P4): `--fixture world` seeds a fresh
//! `noter_core::Core` through its own write path, behind scripted platform seams, and the
//! scenario controls of docs/TEST-PLAN.md (W12–W15) work against it.

use std::time::Duration;

use noter_core_harness::boot::{Harness, Options};
use noter_core_harness::{serve_with, Output};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, Lines as LineReader};
use tokio::task::JoinHandle;

struct Runner {
    input: DuplexStream,
    output: LineReader<BufReader<DuplexStream>>,
    served: JoinHandle<std::io::Result<()>>,
    next: u64,
}

async fn start() -> Runner {
    let (input, core_in) = tokio::io::duplex(1 << 20);
    let (core_out, output) = tokio::io::duplex(1 << 20);
    let out = Output::new(core_out);
    let harness = Harness::start(
        Options {
            fixture: true,
            fixed_clock: true,
        },
        out.lines(),
    )
    .await
    .expect("the harness boots on the fixture world");
    let served = tokio::spawn(serve_with(harness.core(), harness, core_in, out));
    Runner {
        input,
        output: BufReader::new(output).lines(),
        served,
        next: 1,
    }
}

impl Runner {
    async fn line(&mut self) -> Value {
        let line = tokio::time::timeout(Duration::from_secs(5), self.output.next_line())
            .await
            .expect("a line within 5 s")
            .unwrap()
            .expect("the harness is still writing");
        serde_json::from_str(&line).unwrap()
    }

    /// Sends one request and returns its answer, with the event lines written before it.
    async fn call(&mut self, window: &str, cmd: &str, args: Value) -> (Value, Vec<Value>) {
        let id = self.next;
        self.next += 1;
        let req = json!({ "id": id, "window": window, "cmd": cmd, "args": args });
        self.input
            .write_all(format!("{req}\n").as_bytes())
            .await
            .unwrap();
        let mut events = vec![];
        loop {
            let line = self.line().await;
            if line.get("event").is_some() {
                events.push(line);
            } else if line["id"] == id {
                return (line, events);
            }
        }
    }

    async fn ok(&mut self, window: &str, cmd: &str, args: Value) -> Value {
        let (line, _) = self.call(window, cmd, args).await;
        assert!(line.get("ok").is_some(), "{cmd}: {line}");
        line["ok"].clone()
    }

    async fn code(&mut self, window: &str, cmd: &str, args: Value) -> String {
        let (line, _) = self.call(window, cmd, args).await;
        line["error"]["code"]
            .as_str()
            .unwrap_or_else(|| panic!("{cmd} succeeded: {line}"))
            .to_string()
    }

    async fn finish(mut self) {
        self.input.shutdown().await.unwrap();
        drop(self.input);
        while self.output.next_line().await.unwrap().is_some() {}
        self.served.await.unwrap().unwrap();
    }
}

#[tokio::test]
async fn real_core_answers_app_snapshot_from_main_and_refuses_a_settings_command_from_call_screen()
{
    let mut r = start().await;
    assert_eq!(
        r.ok("main", "app_snapshot", json!({})).await["window"],
        "main"
    );
    assert_eq!(
        r.code("call-screen", "settings_get", json!({})).await,
        "window_not_allowed"
    );
    r.finish().await;
}

#[tokio::test]
async fn fixture_world_is_seeded_through_the_core() {
    let mut r = start().await;
    let settings = r.ok("settings", "settings_get", json!({})).await;
    assert_eq!(
        settings["general"]["ignored_apps"][0]["bundle_id"],
        "com.spotify.client"
    );
    let glossary = r.ok("settings", "glossary_list", json!({})).await;
    let fixture = serde_json::to_value(noter_protocol::fixtures::world().glossary).unwrap();
    assert_eq!(
        glossary["terms"].as_array().unwrap().len(),
        fixture["terms"].as_array().unwrap().len()
    );
    let setup = r.ok("first-run", "setup_status", json!({})).await;
    assert!(
        setup["models"]["bundles"]
            .as_array()
            .unwrap()
            .iter()
            .all(|b| b["state"] == "ready"),
        "{setup}"
    );
    assert_eq!(setup["call_display"], "dsp_studio");
    r.finish().await;
}

// W12
#[tokio::test]
async fn fail_next_fails_the_next_call_once() {
    let mut r = start().await;
    let args = json!({ "window": "settings", "cmd": "settings_get", "code": "storage_busy_retry", "detail": null });
    let (bad, _) = r.call("main", "harness.fail_next", args).await;
    assert_eq!(
        bad["error"]["code"], "invalid_input",
        "an unknown error code is refused"
    );
    r.ok(
        "main",
        "harness.fail_next",
        json!({ "window": "settings", "cmd": "settings_get", "code": "offline" }),
    )
    .await;
    assert_eq!(
        r.code("settings", "settings_get", json!({})).await,
        "offline"
    );
    r.ok("settings", "settings_get", json!({})).await;
    r.finish().await;
}

// W13
#[tokio::test]
async fn world_get_then_set_changes_nothing() {
    let mut r = start().await;
    let world = r.ok("main", "harness.world_get", json!({})).await;
    let (set, events) = r
        .call("main", "harness.world_set", json!({ "world": world }))
        .await;
    assert!(set.get("ok").is_some(), "{set}");
    assert!(events.is_empty(), "{events:?}");
    r.finish().await;
}

// W14
#[tokio::test]
async fn world_set_writes_owned_slices_through_the_core() {
    let mut r = start().await;
    let before = r.ok("settings", "settings_get", json!({})).await;
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    assert_eq!(before["menu_bar"]["title"], "none");
    world["settings"]["menu_bar"]["title"] = json!("elapsed_time");
    world["app"]["environment"]["online"] = json!(false);
    let (set, events) = r
        .call("main", "harness.world_set", json!({ "world": world }))
        .await;
    assert!(set.get("ok").is_some(), "{set}");
    let names: Vec<&str> = events
        .iter()
        .map(|e| e["event"].as_str().unwrap())
        .collect();
    assert!(
        names.contains(&"settings:changed") && names.contains(&"env:changed"),
        "{names:?}"
    );
    let after = r.ok("settings", "settings_get", json!({})).await;
    assert_eq!(after["rev"], before["rev"].as_u64().unwrap() + 1);
    assert_eq!(
        r.ok("main", "app_snapshot", json!({})).await["environment"]["online"],
        false
    );
    r.finish().await;
}

#[tokio::test]
async fn world_set_refuses_a_slice_no_service_owns_yet() {
    let mut r = start().await;
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    world["calls"] = json!([]);
    let (set, events) = r
        .call("main", "harness.world_set", json!({ "world": world }))
        .await;
    assert_eq!(set["error"]["code"], "not_implemented");
    assert!(
        set["error"]["message"].as_str().unwrap().contains("calls"),
        "{set}"
    );
    assert!(
        events.is_empty(),
        "nothing is applied when a slice is refused"
    );
    r.finish().await;
}

#[tokio::test]
async fn update_install_answers_and_the_harness_keeps_serving() {
    let mut r = start().await;
    assert_eq!(
        r.code("settings", "update_install", json!({})).await,
        "not_found"
    );
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    world["app"]["environment"]["update"] =
        json!({ "version": "1.0.1", "notes_md": "Fixes.", "ready": true });
    world["app"]["banners"]["banners"] = json!([{ "type": "update_ready", "version": "1.0.1" }]);
    r.ok("main", "harness.world_set", json!({ "world": world }))
        .await;
    assert_eq!(
        r.ok("main", "app_snapshot", json!({})).await["banners"]["banners"][0]["type"],
        "update_ready"
    );
    r.ok("settings", "update_install", json!({})).await;
    r.ok("main", "app_snapshot", json!({})).await;
    r.finish().await;
}

// W15
#[tokio::test]
async fn push_is_not_implemented_until_the_core_has_a_scripted_stream() {
    let mut r = start().await;
    let (pushed, _) = r
        .call(
            "main",
            "harness.push",
            json!({ "cmd": "self_test_run", "body": {} }),
        )
        .await;
    assert_eq!(pushed["error"]["code"], "not_implemented");
    r.finish().await;
}
