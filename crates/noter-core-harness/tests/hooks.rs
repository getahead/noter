//! The app's launch hooks: a debug build of the Tauri host launched with `NOTER_TEST_FIXTURE`
//! boots its core on the harness's scripted seams with its own events and windows, in the
//! scenario the native UI tests name (`NOTER_TEST_SCENARIO`).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use noter_core::EventEmitter;
use noter_core_harness::boot::{Harness, Options};
use noter_core_harness::Controls;
use noter_protocol::ipc::{dispatch_json, event_names, Caller, CommandCtx};
use noter_protocol::model::{CallLayout, DisplayInfo, WindowLabel};
use noter_protocol::DisplayId;
use serde_json::{json, Value};

fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let vars: HashMap<String, String> = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    move |k| vars.get(k).cloned()
}

#[test]
fn without_a_fixture_variable_the_app_boots_on_the_mac() {
    assert!(Options::from_env(env(&[])).unwrap().is_none());
    let others = env(&[
        ("NOTER_TEST_CLOCK", "fixed"),
        ("NOTER_TEST_SCENARIO", "idle"),
    ]);
    assert!(Options::from_env(others).unwrap().is_none());
}

#[test]
fn the_variables_are_the_harness_options() {
    let o = Options::from_env(env(&[
        ("NOTER_TEST_FIXTURE", "world"),
        ("NOTER_TEST_CLOCK", "fixed"),
        ("NOTER_TEST_SCENARIO", "detected"),
    ]))
    .unwrap()
    .unwrap();
    assert!(o.fixture && o.fixed_clock && o.engine_script.is_none());
    assert_eq!(o.scenario.as_deref(), Some("detected"));
    let fresh = Options::from_env(env(&[("NOTER_TEST_FIXTURE", "none")]))
        .unwrap()
        .unwrap();
    assert!(!fresh.fixture && !fresh.fixed_clock && fresh.scenario.is_none());
}

#[test]
fn a_bad_value_is_refused() {
    let bad: [&[(&str, &str)]; 5] = [
        &[("NOTER_TEST_FIXTURE", "moon")],
        &[
            ("NOTER_TEST_FIXTURE", "world"),
            ("NOTER_TEST_CLOCK", "slow"),
        ],
        &[
            ("NOTER_TEST_FIXTURE", "world"),
            ("NOTER_TEST_ENGINE_SCRIPT", "/no/such/script"),
        ],
        &[
            ("NOTER_TEST_FIXTURE", "world"),
            ("NOTER_TEST_SCENARIO", "moon"),
        ],
        // A scenario is a state of the fixture world.
        &[
            ("NOTER_TEST_FIXTURE", "none"),
            ("NOTER_TEST_SCENARIO", "idle"),
        ],
    ];
    for vars in bad {
        assert!(Options::from_env(env(vars)).is_err(), "{vars:?}");
    }
}

#[derive(Default)]
struct Seen(Mutex<Vec<&'static str>>);

impl EventEmitter for Seen {
    fn emit(&self, event: &'static str, _: Value) {
        self.0.lock().unwrap().push(event);
    }
}

async fn boot(scenario: Option<&str>) -> (Arc<Harness>, Arc<Seen>) {
    let seen = Arc::new(Seen::default());
    let options = Options {
        fixture: true,
        scenario: scenario.map(Into::into),
        ..Options::default()
    };
    let harness = Harness::start_with(options, seen.clone(), |deps| deps.with_app_version("9.9.9"))
        .await
        .expect("the hooks boot");
    (harness, seen)
}

async fn snapshot(harness: &Harness) -> Value {
    let main = CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    };
    dispatch_json(&*harness.core(), &main, "app_snapshot", json!({}), None)
        .await
        .unwrap()
}

#[tokio::test]
async fn the_host_keeps_its_own_deps_and_gets_the_events() {
    let (harness, seen) = boot(None).await;
    let app = snapshot(&harness).await;
    assert_eq!(app["app_version"], "9.9.9");
    assert_eq!(
        app["capture"]["phase"], "recording",
        "the fixture's live call"
    );
    harness
        .control("set_free_disk", json!({ "mb": 100 }))
        .await
        .unwrap();
    assert!(seen.0.lock().unwrap().contains(&event_names::ENV_CHANGED));
    harness.shutdown().await;
}

/// What a scenario's app snapshot shows.
type Holds = fn(&Value) -> bool;

#[tokio::test]
async fn each_scenario_boots_the_fixture_in_its_state() {
    let cases: [(&str, Holds); 6] = [
        ("idle", |a| a["capture"]["phase"] == "idle"),
        ("low-disk", |a| {
            a["capture"]["phase"] == "idle" && a["environment"]["disk_free_mb"].as_u64() < Some(500)
        }),
        ("detected", |a| {
            a["capture"]["phase"] == "idle" && a["detection"]["detection"]["app_name"] == "zoom.us"
        }),
        ("new-meeting", |a| {
            a["capture"]["phase"] == "recording" && a["capture"]["notice"]["type"] == "new_meeting"
        }),
        ("call-seems-ended", |a| {
            a["presenting"]["hidden"] == true
                && a["capture"]["notice"]["type"] == "call_seems_ended"
        }),
        ("switched-to-local", |a| {
            a["degraded"]["states"][0]["type"] == "switched_to_local"
                && a["privacy"]["effective"] == "switched_to_local"
        }),
    ];
    for (name, holds) in cases {
        let (harness, _) = boot(Some(name)).await;
        let app = snapshot(&harness).await;
        // The scenario only: the snapshot carries account fields that must not reach a log.
        assert!(holds(&app), "scenario {name}");
        harness.shutdown().await;
    }
}

#[tokio::test]
async fn on_the_macs_own_displays_the_live_call_window_floats_on_the_main_one() {
    // The app draws its real windows on the Mac it runs on: a single display, without the
    // fixture's Studio Display that the call screen is set to.
    let builtin = DisplayInfo {
        id: DisplayId::new("1".to_string()),
        name: "Built-in Retina Display".into(),
        is_main: true,
        holds_call_app: false,
        width_pt: 1512,
        height_pt: 982,
    };
    let options = Options {
        fixture: true,
        displays: Some(vec![builtin.clone()]),
        ..Options::default()
    };
    let harness = Harness::start_with(options, Arc::new(Seen::default()), |deps| deps)
        .await
        .expect("the hooks boot");
    let app = snapshot(&harness).await;
    assert_eq!(app["environment"]["displays"], json!([builtin]));
    let main = CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    };
    let call = dispatch_json(
        &*harness.core(),
        &main,
        "window_call_state",
        json!({}),
        None,
    )
    .await
    .unwrap();
    assert_eq!(call["layout"], json!(CallLayout::Floating));
    harness.shutdown().await;
}

#[tokio::test]
async fn first_call_leaves_one_saved_call_and_notifications_not_asked() {
    let (harness, _) = boot(Some("first-call")).await;
    let app = snapshot(&harness).await;
    assert_eq!(app["capture"]["phase"], "idle");
    let world = harness.control("world_get", json!({})).await.unwrap();
    let titles: Vec<&str> = world["calls"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|c| c["title"].as_str())
        .collect();
    assert_eq!(
        titles,
        ["Backend sync"],
        "the library holds the first recorded call only"
    );
    assert_eq!(
        world["app"]["environment"]["notifications"],
        "not_determined"
    );
    harness.shutdown().await;
}

#[test]
fn malformed_native_launch_hooks_are_refused() {
    for (key, value) in [
        ("NOTER_TEST_LAUNCH_WORLD", "{}"),
        ("NOTER_TEST_LAUNCH_WORLD", "null"),
        ("NOTER_TEST_FOLDER_PANELS", "false"),
        ("NOTER_TEST_FOLDER_PANELS", "[42]"),
        ("NOTER_TEST_FOLDER_PANELS", r#"["relative"]"#),
        ("NOTER_TEST_FOLDER_PANELS", r#"[""]"#),
    ] {
        assert!(
            Options::from_env(env(&[("NOTER_TEST_FIXTURE", "world"), (key, value)])).is_err(),
            "{key}={value}"
        );
        assert!(Options::from_env(env(&[(key, value)])).unwrap().is_none());
    }
}

#[tokio::test]
async fn native_folder_hook_cancels_then_chooses_without_creating_paths() {
    let folder = std::env::temp_dir().join(format!("noter-folder-hook-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let missing = folder.as_path().join("does-not-exist");
    let answers = json!([null, folder.as_path(), missing]).to_string();
    let options = Options::from_env(env(&[
        ("NOTER_TEST_FIXTURE", "world"),
        ("NOTER_TEST_SCENARIO", "idle"),
        ("NOTER_TEST_FOLDER_PANELS", &answers),
    ]))
    .unwrap()
    .unwrap();
    let h = Harness::start_with(options, Arc::new(Seen::default()), |d| d)
        .await
        .unwrap();
    let main = CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    };
    let args = json!({"key": "VSTOR", "local_path": null, "default_tool": "claude_code"});
    // Use the same long-lived core as the native app, with no stdio control commands.
    let core = h.core();
    let cancelled = dispatch_json(&*core, &main, "repo_upsert", args.clone(), None)
        .await
        .unwrap_err();
    assert_eq!(cancelled.code, noter_protocol::ErrorCode::Cancelled);
    let before = dispatch_json(&*core, &main, "repos_list", json!({}), None)
        .await
        .unwrap();
    assert_eq!(before["mappings"], json!([]));
    let chosen = dispatch_json(&*core, &main, "repo_upsert", args.clone(), None)
        .await
        .unwrap();
    assert_eq!(chosen["mappings"][0]["local_path"], json!(folder.as_path()));
    let missing_result = dispatch_json(
        &*core,
        &main,
        "repo_upsert",
        json!({"key":"OTHER", "default_tool":"codex"}),
        None,
    )
    .await;
    assert!(missing_result.is_err());
    assert!(
        !missing.exists(),
        "a scripted selection must not create a repository"
    );
    let exhausted = dispatch_json(&*core, &main, "repo_upsert", args, None)
        .await
        .unwrap_err();
    assert_eq!(exhausted.code, noter_protocol::ErrorCode::Cancelled);
    h.shutdown().await;
    std::fs::remove_dir_all(folder).unwrap();
}

#[tokio::test]
async fn handoff_scenario_places_the_engineering_item_in_the_saved_call_outputs() {
    let (h, _) = boot(Some("handoff")).await;
    assert_eq!(snapshot(&h).await["capture"]["phase"], "idle");
    let core = h.core();
    let main = CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    };
    let outputs = dispatch_json(
        &*core,
        &main,
        "outputs_get",
        json!({"call_id":"call_backend"}),
        None,
    )
    .await
    .unwrap();
    let actions = outputs["sections"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["kind"] == "action_items")
        .unwrap();
    let item = actions["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == "itm_replay")
        .unwrap();
    assert_eq!(item["call"]["id"], "call_backend");
    assert_eq!(item["is_engineering"], true);
    assert_eq!(item["status"], "open");
    let view = dispatch_json(
        &*core,
        &main,
        "handoff_get",
        json!({"item_id":"itm_replay"}),
        None,
    )
    .await
    .unwrap();
    assert_eq!(view["unmapped_key"], "VSTOR");
    assert_eq!(view["item"], *item);
    h.shutdown().await;
}
