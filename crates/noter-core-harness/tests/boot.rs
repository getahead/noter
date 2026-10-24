//! The harness on the real core (`.plans/core-harness.md` P4): `--fixture world` seeds a fresh
//! `noter_core::Core` through its own write path, behind scripted platform seams, and the
//! scenario controls of docs/TEST-PLAN.md (W12–W15) work against it.

use std::sync::Arc;
use std::time::Duration;

use noter_core::Core;
use noter_core_harness::boot::{Harness, Options};
use noter_core_harness::{serve_with, Output};
use noter_engine_client::scripted::Script;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, Lines as LineReader};
use tokio::task::JoinHandle;

struct Runner {
    input: DuplexStream,
    output: LineReader<BufReader<DuplexStream>>,
    served: JoinHandle<std::io::Result<()>>,
    next: u64,
    core: Arc<Core>,
}

async fn start() -> Runner {
    start_with(Options {
        fixture: true,
        fixed_clock: true,
        ..Options::default()
    })
    .await
}

async fn start_with(options: Options) -> Runner {
    let (input, core_in) = tokio::io::duplex(1 << 20);
    let (core_out, output) = tokio::io::duplex(1 << 20);
    let out = Output::new(core_out);
    let harness = Harness::start(options, out.lines())
        .await
        .expect("the harness boots on the fixture world");
    let core = harness.core();
    let served = tokio::spawn(serve_with(core.clone(), harness, core_in, out));
    Runner {
        input,
        output: BufReader::new(output).lines(),
        served,
        next: 1,
        core,
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

    /// Sends one subscribing request (`channel: true`) and returns its answer; the stream's
    /// messages and event lines before it are skipped.
    async fn channel(&mut self, window: &str, cmd: &str, args: Value) -> Value {
        let id = self.next;
        self.next += 1;
        let req = json!({ "id": id, "window": window, "cmd": cmd, "args": args, "channel": true });
        self.input
            .write_all(format!("{req}\n").as_bytes())
            .await
            .unwrap();
        loop {
            let line = self.line().await;
            if line["id"] == id {
                assert!(line.get("ok").is_some(), "{cmd}: {line}");
                return line["ok"].clone();
            }
        }
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
    world["items"] = json!([]);
    let (set, events) = r
        .call("main", "harness.world_set", json!({ "world": world }))
        .await;
    assert_eq!(set["error"]["code"], "not_implemented");
    assert!(
        set["error"]["message"].as_str().unwrap().contains("items"),
        "{set}"
    );
    assert!(
        events.is_empty(),
        "nothing is applied when a slice is refused"
    );
    r.finish().await;
}

#[tokio::test]
async fn the_fixture_calls_are_rows_the_library_serves_and_world_set_owns_them() {
    let mut r = start().await;
    let world = r.ok("main", "harness.world_get", json!({})).await;
    let ids: Vec<_> = world["calls"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].clone())
        .collect();
    assert_eq!(ids, [json!("call_live"), json!("call_backend")]);
    assert_eq!(
        world["call_details"][0]["speakers"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    assert_eq!(
        world["call_types"]["call_types"].as_array().unwrap().len(),
        8
    );
    let mut empty = world.clone();
    empty["calls"] = json!([]);
    empty["call_details"] = json!([]);
    r.ok("main", "harness.world_set", json!({ "world": empty }))
        .await;
    let after = r.ok("main", "harness.world_get", json!({})).await;
    assert_eq!(after["calls"], json!([]));
    r.finish().await;
}

#[tokio::test]
async fn world_set_rereads_the_models_folder_for_the_bundles_it_changes() {
    let mut r = start().await;
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    let bundles = &mut world["app"]["setup"]["models"]["bundles"];
    bundles[0]["state"] = json!("pending");
    bundles[0]["done_mb"] = json!(0);
    world["app"]["setup"]["models"]["done_mb"] = json!(3);
    let set = r
        .ok("main", "harness.world_set", json!({ "world": world }))
        .await;
    assert_eq!(set, json!({}));
    let setup = r.ok("first-run", "setup_status", json!({})).await;
    assert_eq!(setup["models"]["bundles"][0]["state"], "pending");
    assert_eq!(setup["models"]["bundles"][1]["state"], "ready");
    r.finish().await;
}

#[tokio::test]
async fn the_scripted_engine_lets_the_self_test_pass() {
    let mut r = start().await;
    let id = r.next;
    r.next += 1;
    let req = json!({ "id": id, "window": "settings", "cmd": "self_test_run", "args": { "play_clip": false }, "channel": true });
    r.input
        .write_all(format!("{req}\n").as_bytes())
        .await
        .unwrap();
    let mut seen = vec![];
    loop {
        let line = r.line().await;
        seen.push(
            line["message"]["event"]["type"]
                .as_str()
                .unwrap_or("")
                .to_string(),
        );
        if line["event"] == "setup:changed" && line["payload"]["self_test"]["type"] == "passed" {
            break;
        }
    }
    assert!(seen.iter().any(|t| t == "passed"), "{seen:?}");
    r.finish().await;
}

#[tokio::test]
async fn world_set_seeds_the_self_test_state() {
    let mut r = start().await;
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    world["app"]["setup"]["self_test"] = json!({ "type": "passed", "at": 1_700_000_000_000_u64 });
    world["app"]["setup"]["detection_enabled"] = json!(true); // the detection rule follows a pass
    let set = r
        .ok("main", "harness.world_set", json!({ "world": world }))
        .await;
    assert_eq!(set, json!({}));
    let setup = r.ok("first-run", "setup_status", json!({})).await;
    assert_eq!(setup["self_test"]["type"], "passed");
    r.finish().await;
}

#[tokio::test]
async fn an_external_grant_is_read_again_after_world_set() {
    let mut r = start().await;
    let set_mic = |world: &mut Value, state: &str| {
        for path in ["setup", "environment"] {
            for row in world["app"][path]["permissions"].as_array_mut().unwrap() {
                if row["kind"] == "microphone" {
                    row["state"] = json!(state);
                }
            }
        }
    };
    let mic = |setup: &Value| {
        setup["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["kind"] == "microphone")
            .unwrap()["state"]
            .clone()
    };
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    set_mic(&mut world, "denied");
    r.ok(
        "main",
        "harness.world_set",
        json!({ "world": world.clone() }),
    )
    .await;
    assert_eq!(
        mic(&r.ok("first-run", "setup_status", json!({})).await),
        "denied"
    );
    set_mic(&mut world, "granted");
    r.ok("main", "harness.world_set", json!({ "world": world }))
        .await;
    assert_eq!(
        mic(&r.ok("first-run", "setup_status", json!({})).await),
        "granted"
    );
    r.finish().await;
}

#[tokio::test]
async fn system_audio_the_world_denies_is_refused_without_a_second_prompt() {
    let mut r = start().await;
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    for path in ["setup", "environment"] {
        for row in world["app"][path]["permissions"].as_array_mut().unwrap() {
            if row["kind"] == "system_audio" {
                row["state"] = json!("denied");
            }
        }
    }
    r.ok("main", "harness.world_set", json!({ "world": world }))
        .await;
    for _ in 0..2 {
        assert_eq!(
            r.code(
                "first-run",
                "permission_request",
                json!({ "kind": "system_audio" })
            )
            .await,
            "permission_denied"
        );
    }
    r.finish().await;
}

#[tokio::test]
async fn world_set_models_ignore_sizes_and_progress_the_core_derives() {
    let mut r = start().await;
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    for b in world["app"]["setup"]["models"]["bundles"]
        .as_array_mut()
        .unwrap()
    {
        b["state"] = json!("pending");
        b["size_mb"] = json!(2100); // a preset's real sizes: the harness serves tiny bundles
        b["done_mb"] = json!(0);
    }
    world["app"]["environment"]["online"] = json!(false);
    world["app"]["setup"]["models"]["total_mb"] = json!(8400);
    world["app"]["setup"]["models"]["done_mb"] = json!(0);
    let set = r
        .ok("main", "harness.world_set", json!({ "world": world }))
        .await;
    assert_eq!(set, json!({}));
    let setup = r.ok("first-run", "setup_status", json!({})).await;
    assert!(setup["models"]["bundles"]
        .as_array()
        .unwrap()
        .iter()
        .all(|b| b["state"] == "pending"));
    r.finish().await;
}

#[tokio::test]
async fn a_download_that_resumes_online_is_not_world_set_drift() {
    let mut r = start().await;
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    for b in world["app"]["setup"]["models"]["bundles"]
        .as_array_mut()
        .unwrap()
    {
        b["state"] = json!("pending");
    }
    world["app"]["environment"]["online"] = json!(false);
    r.ok(
        "main",
        "harness.world_set",
        json!({ "world": world.clone() }),
    )
    .await;
    let code = r
        .code("first-run", "models_download", json!({ "action": "start" }))
        .await;
    assert_eq!(code, "offline");
    // back online: the core starts the download itself, the world still says pending
    world["app"]["environment"]["online"] = json!(true);
    let set = r
        .ok("main", "harness.world_set", json!({ "world": world }))
        .await;
    assert_eq!(set, json!({}));
    r.finish().await;
}

/// The world with every bundle pending, the harness serving big enough bundles to show progress.
async fn pending_models(r: &mut Runner) {
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    for b in world["app"]["setup"]["models"]["bundles"]
        .as_array_mut()
        .unwrap()
    {
        b["state"] = json!("pending");
    }
    r.ok("main", "harness.world_set", json!({ "world": world }))
        .await;
}

async fn speech_model(r: &mut Runner) -> Value {
    let setup = r.ok("first-run", "setup_status", json!({})).await;
    setup["models"]["bundles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["required_for_capture"] == true)
        .unwrap()
        .clone()
}

async fn until_speech(r: &mut Runner, ok: impl Fn(&Value) -> bool) -> Value {
    let mut model = json!({});
    for _ in 0..200 {
        model = speech_model(r).await;
        if ok(&model) {
            return model;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the speech model never got there: {model}");
}

#[tokio::test]
async fn hold_next_download_stops_at_the_fraction_until_released() {
    let mut r = start().await;
    pending_models(&mut r).await;
    r.ok(
        "main",
        "harness.hold_next_download",
        json!({ "at_percent": 50 }),
    )
    .await;
    r.ok("first-run", "models_download", json!({ "action": "start" }))
        .await;
    let held = until_speech(&mut r, |m| m["done_mb"].as_u64().unwrap_or(0) >= 1).await;
    assert_eq!(held["state"], "downloading", "{held}");
    assert!(held["done_mb"].as_u64().unwrap() < held["size_mb"].as_u64().unwrap());
    tokio::time::sleep(Duration::from_millis(700)).await;
    assert_eq!(
        speech_model(&mut r).await["state"],
        "downloading",
        "still held"
    );
    r.ok("main", "harness.release_download", json!({})).await;
    let done = until_speech(&mut r, |m| m["state"] == "ready").await;
    assert_eq!(done["done_mb"], done["size_mb"]);
    r.finish().await;
}

#[tokio::test]
async fn a_release_before_the_fetch_starts_is_not_lost() {
    let mut r = start().await;
    pending_models(&mut r).await;
    r.ok(
        "main",
        "harness.hold_next_download",
        json!({ "at_percent": 50 }),
    )
    .await;
    r.ok("main", "harness.release_download", json!({})).await;
    r.ok("first-run", "models_download", json!({ "action": "start" }))
        .await;
    let done = until_speech(&mut r, |m| m["state"] == "ready").await;
    assert_eq!(done["done_mb"], done["size_mb"]);
    r.finish().await;
}

#[tokio::test]
async fn pausing_a_held_download_leaves_it_paused_with_its_progress() {
    let mut r = start().await;
    pending_models(&mut r).await;
    r.ok(
        "main",
        "harness.hold_next_download",
        json!({ "at_percent": 50 }),
    )
    .await;
    r.ok("first-run", "models_download", json!({ "action": "start" }))
        .await;
    until_speech(&mut r, |m| m["done_mb"].as_u64().unwrap_or(0) >= 1).await;
    r.ok("first-run", "models_download", json!({ "action": "pause" }))
        .await;
    let paused = until_speech(&mut r, |m| m["state"] == "paused").await;
    assert!(paused["done_mb"].as_u64().unwrap() >= 1, "{paused}");
    r.finish().await;
}

#[tokio::test]
async fn an_allowed_notifications_prompt_shows_in_the_environment() {
    let mut r = start().await;
    assert_eq!(
        r.ok("main", "app_snapshot", json!({})).await["environment"]["notifications"],
        "not_determined"
    );
    let (reply, events) = r
        .call(
            "main",
            "permission_request",
            json!({ "kind": "notifications" }),
        )
        .await;
    assert_eq!(reply["ok"]["state"], "granted", "{reply}");
    assert!(
        events
            .iter()
            .any(|e| e["event"] == "env:changed" && e["payload"]["notifications"] == "authorized"),
        "{events:?}"
    );
    assert_eq!(
        r.ok("main", "app_snapshot", json!({})).await["environment"]["notifications"],
        "authorized"
    );
    r.finish().await;
}

#[tokio::test]
async fn world_set_changes_the_free_disk_and_the_notifications_state() {
    let mut r = start().await;
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    world["app"]["environment"]["disk_free_mb"] = json!(300);
    world["app"]["environment"]["notifications"] = json!("denied");
    r.ok("main", "harness.world_set", json!({ "world": world }))
        .await;
    let snap = r.ok("main", "app_snapshot", json!({})).await;
    assert_eq!(snap["environment"]["disk_free_mb"], 300);
    assert_eq!(snap["environment"]["notifications"], "denied");
    r.finish().await;
}

#[tokio::test]
async fn corrupt_next_download_fails_one_check_then_the_retry_passes() {
    let mut r = start().await;
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    for b in world["app"]["setup"]["models"]["bundles"]
        .as_array_mut()
        .unwrap()
    {
        b["state"] = json!("pending");
        b["done_mb"] = json!(0);
    }
    world["app"]["setup"]["models"]["done_mb"] = json!(0);
    r.ok("main", "harness.world_set", json!({ "world": world }))
        .await;
    r.ok("main", "harness.corrupt_next_download", json!({}))
        .await;
    r.ok("first-run", "models_download", json!({ "action": "start" }))
        .await;
    let required_state = |setup: &Value| {
        setup["models"]["bundles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["required_for_capture"] == true)
            .unwrap()["state"]
            .clone()
    };
    let mut setup = json!({});
    for _ in 0..100 {
        setup = r.ok("first-run", "setup_status", json!({})).await;
        if required_state(&setup) == "checksum_failed" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(required_state(&setup), "checksum_failed", "{setup}");
    r.ok("first-run", "models_download", json!({ "action": "retry" }))
        .await;
    for _ in 0..100 {
        setup = r.ok("first-run", "setup_status", json!({})).await;
        if required_state(&setup) == "ready" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(required_state(&setup), "ready", "{setup}");
    r.finish().await;
}

#[tokio::test]
async fn world_set_refuses_derived_setup_fields_the_core_would_compute_otherwise() {
    let mut r = start().await;
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    let complete = world["app"]["setup"]["complete"].as_bool().unwrap();
    world["app"]["setup"]["complete"] = json!(!complete);
    let (set, _) = r
        .call("main", "harness.world_set", json!({ "world": world }))
        .await;
    assert_eq!(set["error"]["code"], "invalid_input", "{set}");
    assert!(
        set["error"]["message"]
            .as_str()
            .unwrap()
            .contains("app.setup.complete"),
        "{set}"
    );
    r.finish().await;
}

#[tokio::test]
async fn the_fixture_seeds_every_setup_step_including_assistants() {
    let mut r = start().await;
    let setup = r.ok("first-run", "setup_status", json!({})).await;
    let fixture = serde_json::to_value(noter_protocol::fixtures::world().app.setup.steps).unwrap();
    assert_eq!(
        setup["steps"], fixture,
        "D10: the core accepts every fixture step"
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

// M1-D3: the outside world moves the Mac's output route and its free disk.
#[tokio::test]
async fn set_output_route_switches_the_route_the_core_reports() {
    let mut r = start().await;
    let (set, events) = r
        .call(
            "main",
            "harness.set_output_route",
            json!({ "route": "speakers", "output_device": null }),
        )
        .await;
    assert!(set.get("ok").is_some(), "{set}");
    assert!(
        events.iter().any(|e| e["event"] == "env:changed"),
        "{events:?}"
    );
    let env = r.ok("main", "app_snapshot", json!({})).await["environment"].clone();
    assert_eq!(env["output_route"], "speakers");
    assert_eq!(env["output_device"], json!(null));
    let (bad, _) = r
        .call(
            "main",
            "harness.set_output_route",
            json!({ "route": "radio" }),
        )
        .await;
    assert_eq!(bad["error"]["code"], "invalid_input");
    r.finish().await;
}

#[tokio::test]
async fn set_free_disk_changes_the_free_space_the_core_reports() {
    let mut r = start().await;
    let (set, events) = r
        .call("main", "harness.set_free_disk", json!({ "mb": 300 }))
        .await;
    assert!(set.get("ok").is_some(), "{set}");
    assert!(
        events.iter().any(|e| e["event"] == "env:changed"),
        "{events:?}"
    );
    assert_eq!(
        r.ok("main", "app_snapshot", json!({})).await["environment"]["disk_free_mb"],
        300
    );
    let (bad, _) = r.call("main", "harness.set_free_disk", json!({})).await;
    assert_eq!(bad["error"]["code"], "invalid_input");
    r.finish().await;
}

#[tokio::test]
async fn data_dir_names_the_folder_the_running_core_keeps_its_database_in() {
    let mut r = start().await;
    let shown = r.ok("main", "harness.data_dir", json!({})).await;
    let path = std::path::PathBuf::from(shown["path"].as_str().expect("a path"));
    assert!(path.join("noter.db").is_file(), "{path:?}");
    r.finish().await;
}

// W15
#[tokio::test]
async fn push_reaches_the_running_self_test_as_an_engine_fact() {
    let mut r = start().await;
    let id = r.next;
    r.next += 1;
    let req = json!({ "id": id, "window": "settings", "cmd": "self_test_run", "args": { "play_clip": false }, "channel": true });
    r.input
        .write_all(format!("{req}\n").as_bytes())
        .await
        .unwrap();
    let push = r
        .call(
            "main",
            "harness.push",
            json!({ "cmd": "self_test_run", "body": { "event": { "type": "failed", "reason": { "type": "one_stream_silent", "channel": "sys" } } } }),
        )
        .await;
    assert!(push.0.get("ok").is_some(), "{push:?}");
    let mut failed = None;
    while failed.is_none() {
        let line = r.line().await;
        if line["event"] == "setup:changed" {
            failed = Some(line["payload"]["self_test"].clone());
        }
    }
    let failed = failed.unwrap();
    assert_eq!(failed["type"], "failed", "{failed}");
    assert_eq!(failed["reason"]["type"], "one_stream_silent");
    assert_eq!(failed["reason"]["channel"], "sys");
    r.finish().await;
}

#[tokio::test]
async fn system_audio_the_world_denies_is_denied_by_the_engine() {
    let mut r = start().await;
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    for path in ["setup", "environment"] {
        for row in world["app"][path]["permissions"].as_array_mut().unwrap() {
            if row["kind"] == "system_audio" {
                row["state"] = json!("denied");
            }
        }
    }
    r.ok("main", "harness.world_set", json!({ "world": world }))
        .await;
    let (reply, _) = r
        .call(
            "first-run",
            "permission_request",
            json!({ "kind": "system_audio" }),
        )
        .await;
    assert_eq!(reply["error"]["code"], "permission_denied", "{reply}");
    r.finish().await;
}

#[tokio::test]
async fn engine_fact_reaches_a_running_engine_and_kill_is_accepted() {
    let mut r = start().await;
    let fact =
        json!({ "event": { "type": "levels", "call_id": null, "mic_db": -30.0, "sys_db": -30.0 } });
    // No command has started the engine yet.
    let (idle, _) = r.call("main", "harness.engine_fact", fact.clone()).await;
    assert_eq!(idle["ok"]["delivered"], false, "{idle}");
    let id = r.next;
    r.next += 1;
    let req = json!({ "id": id, "window": "settings", "cmd": "self_test_run", "args": { "play_clip": false }, "channel": true });
    r.input
        .write_all(format!("{req}\n").as_bytes())
        .await
        .unwrap();
    let mut delivered = json!(false);
    for _ in 0..50 {
        let (fact, _) = r.call("main", "harness.engine_fact", fact.clone()).await;
        delivered = fact["ok"]["delivered"].clone();
        if delivered == true {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(delivered, true);
    let (bad, _) = r.call("main", "harness.engine_fact", json!({})).await;
    assert_eq!(bad["error"]["code"], "invalid_input");
    let (kill, _) = r.call("main", "harness.engine_kill", json!({})).await;
    assert!(kill.get("ok").is_some(), "{kill}");
    r.finish().await;
}

#[tokio::test]
async fn capture_runs_on_the_real_core_and_the_scripted_surfaces_record_what_was_shown() {
    let mut r = start().await;
    // The fixture world records its live call; the test starts from idle.
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    world["app"]["capture"]["phase"] = json!("idle");
    world["app"]["capture"]["call_id"] = json!(null);
    r.ok("main", "harness.world_set", json!({ "world": world }))
        .await;
    // Windows only: the tray model is redrawn on every capture change.
    let windows = |shown: Value| -> Vec<String> {
        shown["calls"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|c| c.as_str().filter(|c| !c.starts_with("set_tray")))
            .map(String::from)
            .collect()
    };
    // Boot seeded the fixture's live call with its window up; the idle world took it down.
    let shown = r.ok("main", "harness.surfaces", json!({})).await;
    let before = windows(shown);
    assert_eq!(
        before,
        ["open_call_window_inactive", "hide_call_window"],
        "{before:?}"
    );
    // The scripted engine answers the session: the start records and the call window opens.
    let started = r
        .ok(
            "main",
            "capture_start",
            json!({ "source": "today", "sensitive": false }),
        )
        .await;
    assert_eq!(started["phase"], "recording");
    let call_id = started["call_id"].clone();
    let stopped = r
        .ok("main", "capture_stop", json!({ "call_id": call_id }))
        .await;
    assert_eq!(stopped["phase"], "stopped");
    let shown = r.ok("main", "harness.surfaces", json!({})).await;
    let windows = windows(shown);
    assert_eq!(windows.len(), before.len() + 1, "{windows:?}");
    assert!(windows[2] == "open_call_window_inactive", "{windows:?}");
    r.finish().await;
}

#[tokio::test]
async fn a_capture_seeded_through_world_set_shows_the_call_window() {
    let mut r = start().await;
    // The fixture's live call was seeded at boot: its window is up, as after `capture_start`.
    let state = r.ok("call-screen", "window_call_state", json!({})).await;
    assert_eq!(state["visible"], true, "{state}");
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    world["app"]["capture"]["phase"] = json!("idle");
    world["app"]["capture"]["call_id"] = json!(null);
    let (set, events) = r
        .call("main", "harness.world_set", json!({ "world": world }))
        .await;
    assert!(set.get("ok").is_some(), "{set}");
    assert!(
        events.iter().any(|e| e["event"] == "window:call"),
        "{events:?}"
    );
    let state = r.ok("call-screen", "window_call_state", json!({})).await;
    assert_eq!(state["visible"], false, "{state}");
    r.finish().await;
}

#[tokio::test]
async fn world_set_sets_the_degraded_set() {
    let mut r = start().await;
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    // The core's own states (setup incomplete, refused hotkeys) stay as it computes them.
    let own: Vec<Value> = world["app"]["degraded"]["states"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| {
            matches!(
                s["type"].as_str(),
                Some("setup_incomplete" | "hotkey_not_registered")
            )
        })
        .cloned()
        .collect();
    assert!(!own.is_empty(), "the fixture's setup is incomplete");
    world["app"]["degraded"]["states"] = json!([{ "type": "disk_low", "free_mb": 1024 }]);
    let (set, events) = r
        .call("main", "harness.world_set", json!({ "world": world }))
        .await;
    assert!(set.get("ok").is_some(), "{set}");
    assert!(
        events.iter().any(|e| e["event"] == "degraded:changed"),
        "{events:?}"
    );
    let states = r.ok("main", "app_snapshot", json!({})).await["degraded"]["states"].clone();
    let mut expected = vec![json!({ "type": "disk_low", "free_mb": 1024 })];
    expected.extend(own);
    assert_eq!(states, json!(expected));
    r.finish().await;
}

#[tokio::test]
async fn world_set_accepts_transcripts_and_seeds_their_rows() {
    let mut r = start().await;
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    // The past call's stored transcript, replaced by one archive line of its own.
    let transcripts = world["transcripts"].as_array_mut().unwrap();
    let mut line = transcripts[0]["segments"][0].clone();
    line["id"] = json!("seg_stored_0");
    line["call_id"] = json!("call_backend");
    line["text"] = json!("Stored line 0");
    line["pass"] = json!("archive");
    transcripts.retain(|t| t["call_id"] != "call_backend");
    transcripts.push(json!({
        "subscription_id": null, "call_id": "call_backend", "live": false, "pass": "archive",
        "archive": "done", "segments": [line], "hypotheses": [], "marks": [], "gaps": [],
        "speakers": [], "last_seq": 1, "audio_available": true
    }));
    r.ok("main", "harness.world_set", json!({ "world": world }))
        .await;
    let snapshot = r
        .channel(
            "main",
            "transcript_subscribe",
            json!({ "call_id": "call_backend" }),
        )
        .await;
    assert_eq!(snapshot["live"], false, "{snapshot}");
    assert_eq!(
        snapshot["segments"][0]["text"], "Stored line 0",
        "{snapshot}"
    );
    assert_eq!(snapshot["segments"][0]["pass"], "archive", "{snapshot}");
    r.finish().await;
}

#[tokio::test]
async fn a_pushed_transcript_line_reaches_the_open_channel() {
    let mut r = start().await;
    let world = r.ok("main", "harness.world_get", json!({})).await;
    let mut line = world["transcripts"][0]["segments"][0].clone();
    line["call_id"] = json!("call_live");
    line["text"] = json!("Hello, can you hear me?");
    let snapshot = r
        .channel(
            "call-screen",
            "transcript_subscribe",
            json!({ "call_id": "call_live" }),
        )
        .await;
    assert_eq!(snapshot["live"], true, "{snapshot}");
    let push = r
        .call(
            "main",
            "harness.push",
            json!({ "cmd": "transcript_subscribe", "body": { "event": { "type": "confirmed", "segment": line } } }),
        )
        .await;
    assert!(push.0.get("ok").is_some(), "{push:?}");
    let mut seen = vec![];
    loop {
        let line = r.line().await;
        let event = &line["message"]["event"];
        seen.push(event["type"].as_str().unwrap_or("").to_string());
        if event["type"] == "confirmed" {
            assert_eq!(
                event["segment"]["text"], "Hello, can you hear me?",
                "{line}"
            );
            break;
        }
    }
    assert!(seen.contains(&"confirmed".to_string()), "{seen:?}");
    r.finish().await;
}

#[tokio::test]
async fn the_fixture_live_call_is_seeded_into_the_real_core() {
    let mut r = start().await;
    let capture = r.ok("main", "app_snapshot", json!({})).await["capture"].clone();
    assert_eq!(capture["phase"], "recording");
    assert_eq!(capture["call_id"], "call_live");
    // The seeded call answers capture commands like a recorded one.
    let paused = r
        .ok(
            "call-screen",
            "capture_set_paused",
            json!({ "call_id": "call_live", "paused": true }),
        )
        .await;
    assert_eq!(paused["phase"], "paused");
    let sensitive = r
        .ok(
            "call-screen",
            "capture_set_sensitive",
            json!({ "call_id": "call_live", "sensitive": true }),
        )
        .await;
    assert_eq!(sensitive["sensitive"], true);
    r.finish().await;
}

#[tokio::test]
async fn the_fixture_calls_are_seeded_as_capture_rows() {
    let (_input, _core_in) = tokio::io::duplex(1024);
    let (core_out, _output) = tokio::io::duplex(1 << 20);
    let harness = Harness::start(
        Options {
            fixture: true,
            fixed_clock: true,
            ..Options::default()
        },
        Output::new(core_out).lines(),
    )
    .await
    .unwrap();
    let world = serde_json::to_value(noter_protocol::fixtures::world()).unwrap();
    let count = |table: &str| -> i64 {
        harness
            .core()
            .store()
            .read(|c| c.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)))
            .unwrap()
    };
    let len = |v: &Value| v.as_array().map_or(0, Vec::len) as i64;
    let details = world["call_details"].as_array().unwrap();
    let sum = |key: &str| details.iter().map(|d| len(&d[key])).sum::<i64>();
    assert_eq!(count("calls"), len(&world["calls"]));
    assert_eq!(count("speakers"), sum("speakers"));
    assert_eq!(count("marks"), sum("marks"));
    assert_eq!(count("gaps"), sum("gaps"));
    let segments: i64 = world["transcripts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| len(&t["segments"]))
        .sum();
    assert!(segments > 0);
    assert_eq!(count("segments"), segments);
    let changes: i64 = harness
        .core()
        .store()
        .read(|c| {
            c.query_row(
                "SELECT COUNT(*) FROM changes WHERE entity_type = 'call'",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(changes, 0, "capture rows carry no change rows (D-22)");
}

/// A replayed call: on every `start_session`, the first and each capture-first restart, the
/// engine reports the session, then levels every 200 ms. The supervisor runs one session and
/// does not read these call ids; the harness answers the first `start_session` with the real one.
const REPLAYED_CALL: &str = r#"
{"on": "start_session", "after_ms": 0, "event": {"type": "session_started", "call_id": "call_replayed", "mic_device": "Scripted Microphone", "output_device": "Scripted Speakers"}}
{"on": "start_session", "after_ms": 200, "event": {"type": "levels", "call_id": "call_replayed", "mic_db": -30.0, "sys_db": -30.0}}
{"on": "start_session", "after_ms": 400, "event": {"type": "levels", "call_id": "call_replayed", "mic_db": -30.0, "sys_db": -30.0}}
{"on": "start_session", "after_ms": 600, "event": {"type": "levels", "call_id": "call_replayed", "mic_db": -30.0, "sys_db": -30.0}}
"#;

/// The fixture world with no call recording, on the real clock, the engine playing `script`.
async fn drill(script: &str) -> (Runner, Value) {
    let mut r = start_with(Options {
        fixture: true,
        engine_script: Some(Script::parse(script).unwrap()),
        ..Options::default()
    })
    .await;
    let mut world = r.ok("main", "harness.world_get", json!({})).await;
    world["app"]["capture"]["phase"] = json!("idle");
    world["app"]["capture"]["call_id"] = json!(null);
    r.ok("main", "harness.world_set", json!({ "world": world }))
        .await;
    let started = r
        .ok(
            "main",
            "capture_start",
            json!({ "source": "today", "sensitive": false }),
        )
        .await;
    assert_eq!(started["phase"], "recording", "{started}");
    let call_id = started["call_id"].clone();
    (r, call_id)
}

impl Runner {
    /// `(t0_ms, t1_ms)` of the call's `engine_restart` gap rows.
    fn restart_gaps(&self, call_id: &Value) -> Vec<(i64, i64)> {
        self.core
            .store()
            .read(|c| {
                let mut q = c.prepare(
                    "SELECT t0_ms, t1_ms FROM gaps WHERE call_id = ?1 AND reason = 'engine_restart'",
                )?;
                let rows = q.query_map([call_id.as_str().unwrap()], |r| Ok((r.get(0)?, r.get(1)?)))?;
                rows.collect()
            })
            .unwrap()
    }

    /// Polls `app_snapshot` until `ok` holds, failing after 10 s.
    async fn until(&mut self, what: &str, ok: impl Fn(&Value) -> bool) -> Value {
        for _ in 0..500 {
            let snapshot = self.ok("main", "app_snapshot", json!({})).await;
            if ok(&snapshot) {
                return snapshot;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("{what} within 10 s");
    }
}

/// The capture states of the degraded set.
fn degraded(snapshot: &Value) -> Vec<String> {
    snapshot["degraded"]["states"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["type"].as_str().unwrap().to_string())
        .collect()
}

// Q7 engine-kill drill (DoD cpt-noter-dod-core-engine-capture-restart; feature acceptance
// criterion 2), first half: the engine dies during a replayed call, the capture-first restart
// brings it back on the same call with one `engine_restart` gap of at most 2 s, and the call goes on.
#[tokio::test(flavor = "multi_thread")]
async fn q7_an_engine_killed_during_a_replayed_call_comes_back_with_one_gap_of_at_most_2_s() {
    let (mut r, call_id) = drill(REPLAYED_CALL).await;
    tokio::time::sleep(Duration::from_millis(500)).await; // levels flow
    assert!(r.restart_gaps(&call_id).is_empty());

    let (kill, _) = r.call("main", "harness.engine_kill", json!({})).await;
    assert!(kill.get("ok").is_some(), "{kill}");
    for _ in 0..500 {
        if !r.restart_gaps(&call_id).is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    tokio::time::sleep(Duration::from_millis(700)).await; // the restarted engine replays its levels
    let gaps = r.restart_gaps(&call_id);
    assert_eq!(gaps.len(), 1, "one gap per restart: {gaps:?}");
    let (t0, t1) = gaps[0];
    assert!(
        t0 <= t1 && t1 - t0 <= 2_000,
        "the gap is at most 2 s: {t0}..{t1}"
    );

    let snapshot = r.ok("main", "app_snapshot", json!({})).await;
    assert_eq!(
        snapshot["capture"]["phase"], "recording",
        "the call goes on"
    );
    assert_eq!(snapshot["capture"]["call_id"], call_id, "on the same call");
    assert!(!degraded(&snapshot).contains(&"capture_failed".to_string()));
    let stopped = r
        .ok("main", "capture_stop", json!({ "call_id": call_id }))
        .await;
    assert_eq!(stopped["phase"], "stopped");
    r.finish().await;
}

// Q7 drill, second half: an engine that dies on every restart gives up after three tries in
// 30 s; the call fails with `capture_failed` and is not ended.
#[tokio::test(flavor = "multi_thread")]
async fn q7_an_engine_that_dies_on_every_restart_fails_the_call_with_capture_failed() {
    let script = format!(
        "{REPLAYED_CALL}\n{{\"on\": \"start_session\", \"after_ms\": 300, \"kill\": true}}\n"
    );
    let (mut r, call_id) = drill(&script).await;
    let failed = r
        .until("phase failed", |s| s["capture"]["phase"] == "failed")
        .await;
    assert_eq!(
        failed["capture"]["call_id"], call_id,
        "the call is not ended"
    );
    assert!(
        degraded(&failed).contains(&"capture_failed".to_string()),
        "{failed}"
    );
    r.finish().await;
}
