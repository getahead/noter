//! FEATURE cpt-noter-feature-core-ipc-host, DoD cpt-noter-dod-core-ipc-host-handlers: the
//! registered handlers are the contract's commands, and every command from every window is
//! answered or refused with `window_not_allowed`.

use std::collections::BTreeSet;
use std::sync::Arc;

use noter_core::{Core, CoreDeps, EventEmitter, SystemClock};
use noter_desktop::{builder, hotkey_pressed, Booted};
use noter_protocol::ipc::COMMANDS;
use noter_protocol::model::WindowLabel;
use noter_protocol::{CoreError, ErrorCode};
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{
    get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY,
};
use tauri::webview::InvokeRequest;
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const WINDOWS: [WindowLabel; 5] = [
    WindowLabel::Main,
    WindowLabel::CallScreen,
    WindowLabel::RecordPrompt,
    WindowLabel::Settings,
    WindowLabel::FirstRun,
];

struct NoEvents;

impl EventEmitter for NoEvents {
    fn emit(&self, _: &'static str, _: Value) {}
}

fn app(dir: &std::path::Path) -> tauri::App<MockRuntime> {
    let core = Core::open(
        dir,
        CoreDeps::new(Arc::new(SystemClock), Arc::new(NoEvents)),
    )
    .unwrap();
    builder(mock_builder())
        .manage(Booted(Ok(Arc::new(core))))
        .build(mock_context(noop_assets()))
        .unwrap()
}

fn window(app: &tauri::App<MockRuntime>, label: &str) -> WebviewWindow<MockRuntime> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .build()
        .unwrap()
}

fn call(webview: &WebviewWindow<MockRuntime>, cmd: &str, body: Value) -> Result<Value, Value> {
    let request = InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "tauri://localhost".parse().unwrap(),
        body: InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    };
    get_ipc_response(webview, request).map(|r| r.deserialize::<Value>().unwrap())
}

fn body(cmd: &str) -> Value {
    let spec = noter_protocol::ipc::command(cmd).unwrap();
    match spec.channel {
        Some(_) => json!({ "args": {}, "channel": "__CHANNEL__:7" }),
        None => json!({ "args": {} }),
    }
}

#[test]
fn every_command_from_every_window_is_answered_or_refused() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path());
    for w in WINDOWS {
        let webview = window(&app, w.as_str());
        for spec in COMMANDS {
            let got = call(&webview, spec.name, body(spec.name));
            let refused = got
                .as_ref()
                .err()
                .and_then(|e| serde_json::from_value::<CoreError>(e.clone()).ok());
            if spec.allows(w) {
                match refused {
                    Some(err) => assert_ne!(
                        err.code,
                        ErrorCode::WindowNotAllowed,
                        "{} from {}",
                        spec.name,
                        w.as_str()
                    ),
                    None => assert!(got.is_ok(), "{} from {}", spec.name, w.as_str()),
                }
            } else {
                let code = refused.map(|e| e.code);
                assert_eq!(
                    code,
                    Some(ErrorCode::WindowNotAllowed),
                    "{} from {}",
                    spec.name,
                    w.as_str()
                );
            }
        }
    }
}

#[test]
fn the_registered_handlers_are_the_contract_commands() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path());
    let webview = window(&app, "main");
    // Every contract command has its handler: the answer is a result or a CoreError,
    // never Tauri's own rejection for a name nobody handles.
    for spec in COMMANDS {
        if let Err(e) = call(&webview, spec.name, body(spec.name)) {
            assert!(
                serde_json::from_value::<CoreError>(e).is_ok(),
                "{}",
                spec.name
            );
        }
    }
    // A name outside the contract has no handler: Tauri's own rejection, not a CoreError.
    let unknown = call(&webview, "drop_database", json!({ "args": {} })).unwrap_err();
    assert!(serde_json::from_value::<CoreError>(unknown).is_err());
}

#[test]
fn answers_and_typed_errors_cross_as_json() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path());
    let main = window(&app, "main");
    let snapshot = call(&main, "app_snapshot", json!({ "args": {} })).unwrap();
    assert_eq!(snapshot["window"], "main");
    let bad = call(&main, "banner_dismiss", json!({ "args": { "banner": 3 } })).unwrap_err();
    assert_eq!(
        serde_json::from_value::<CoreError>(bad).unwrap().code,
        ErrorCode::InvalidInput
    );
    // A webview that is not one of the app's windows may call nothing.
    let stranger = window(&app, "devtools");
    let err = call(&stranger, "app_snapshot", json!({ "args": {} })).unwrap_err();
    assert_eq!(
        serde_json::from_value::<CoreError>(err).unwrap().code,
        ErrorCode::WindowNotAllowed
    );
}

#[test]
fn a_core_that_did_not_boot_answers_internal() {
    let app = builder(mock_builder())
        .manage(Booted(Err("the database failed its quick check".into())))
        .build(mock_context(noop_assets()))
        .unwrap();
    let main = window(&app, "main");
    let err = call(&main, "app_snapshot", json!({ "args": {} })).unwrap_err();
    assert_eq!(
        serde_json::from_value::<CoreError>(err).unwrap().code,
        ErrorCode::Internal
    );
}

#[test]
fn each_window_capability_allows_exactly_its_commands() {
    for w in WINDOWS {
        let path = format!("{}/capabilities/{}.json", env!("OUT_DIR"), w.as_str());
        let cap: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(cap["windows"], json!([w.as_str()]));
        let allowed: BTreeSet<String> = cap["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| {
                p.as_str()?
                    .strip_prefix("allow-")
                    .map(|n| n.replace('-', "_"))
            })
            .collect();
        let expected: BTreeSet<String> = COMMANDS
            .iter()
            .filter(|c| c.allows(w))
            .map(|c| c.name.to_string())
            .collect();
        assert_eq!(allowed, expected, "{}", w.as_str());
    }
}

#[test]
fn commands_before_the_core_started_are_not_ready() {
    let app = builder(mock_builder())
        .build(mock_context(noop_assets()))
        .unwrap();
    let main = window(&app, "main");
    let err = call(&main, "app_snapshot", json!({ "args": {} })).unwrap_err();
    assert_eq!(
        serde_json::from_value::<CoreError>(err).unwrap().code,
        ErrorCode::NotReady
    );
    assert!(hotkey_pressed(app.handle(), "Ctrl+Alt+Super+N").is_none());
}

#[test]
fn a_pressed_hotkey_reaches_the_core_as_a_native_caller() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path());
    let pressed = hotkey_pressed(app.handle(), "Ctrl+Alt+Super+N").expect("the core is up");
    let answer = tauri::async_runtime::block_on(pressed).unwrap();
    // Open Call Screen runs window_show_call, which answers not_implemented until M1.
    let err = answer.unwrap_err();
    assert_eq!(
        (err.code, err.message.as_str()),
        (ErrorCode::NotImplemented, "window_show_call")
    );
    let unbound =
        tauri::async_runtime::block_on(hotkey_pressed(app.handle(), "Ctrl+Alt+Super+Q").unwrap())
            .unwrap();
    assert_eq!(unbound.unwrap_err().code, ErrorCode::NotFound);
}
