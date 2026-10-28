//! The app's launch hooks: a debug build of the Tauri host launched with `NOTER_TEST_FIXTURE`
//! boots its core on the harness's scripted seams with its own events and windows, in the
//! scenario the native UI tests name (`NOTER_TEST_SCENARIO`).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use noter_core::EventEmitter;
use noter_core_harness::boot::{Harness, Options};
use noter_core_harness::Controls;
use noter_protocol::ipc::{dispatch_json, event_names, Caller, CommandCtx};
use noter_protocol::model::WindowLabel;
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

#[tokio::test]
async fn each_scenario_boots_the_fixture_in_its_state() {
    let cases: [(&str, fn(&Value) -> bool); 6] = [
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
        }),
    ];
    for (name, holds) in cases {
        let (harness, _) = boot(Some(name)).await;
        let app = snapshot(&harness).await;
        assert!(holds(&app), "{name}: {app}");
        harness.shutdown().await;
    }
}
