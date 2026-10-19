//! FEATURE cpt-noter-feature-core-first-run, flow cpt-noter-flow-core-first-run-update: the app
//! updater is tauri-plugin-updater behind the core's `Updater`, checked here against a local feed
//! with an update signed by a throwaway key. M0 ships it wired but not released (no feed URL and
//! no signing key in tauri.conf.json, owner decision 19 Oct 2026).

use std::io::{BufRead, BufReader, Cursor, Write};
use std::net::TcpListener;
use std::sync::Arc;

use base64::Engine;
use noter_core::{Core, CoreDeps, EventEmitter, SystemClock, Updater};
use noter_desktop::updater::TauriUpdater;
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi};
use noter_protocol::model::{UpdateInfo, WindowLabel};
use noter_protocol::{ErrorCode, NoArgs};
use serde_json::{json, Value};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};

const BUNDLE: &[u8] = b"Noter.app.tar.gz of the next version";

fn b64(text: String) -> String {
    base64::engine::general_purpose::STANDARD.encode(text)
}

/// Serves the feed at /feed.json and the update at /noter.app.tar.gz until the test ends.
fn feed(signature: String) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let url = format!("http://127.0.0.1:{port}");
    let platform = json!({ "signature": signature, "url": format!("{url}/noter.app.tar.gz") });
    let release = json!({
        "version": "99.0.0",
        "notes": "Fixes.",
        "pub_date": "2026-10-19T00:00:00Z",
        "platforms": { "darwin-aarch64": platform, "darwin-x86_64": platform },
    })
    .to_string();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap() > 0 && line != "\r\n" {
                line.clear();
            }
            let body: &[u8] = if first.contains("/feed.json") {
                release.as_bytes()
            } else {
                BUNDLE
            };
            let mut out = stream;
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = out.write_all(head.as_bytes());
            let _ = out.write_all(body);
        }
    });
    format!("{url}/feed.json")
}

/// A key pair; `(pubkey, signature of BUNDLE)` as tauri-plugin-updater reads them.
fn signed_by_new_key() -> (String, String) {
    let keys = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
    let signature =
        minisign::sign(Some(&keys.pk), &keys.sk, Cursor::new(BUNDLE), None, None).unwrap();
    (
        b64(keys.pk.to_box().unwrap().to_string()),
        b64(signature.to_string()),
    )
}

fn app(updater_config: Value) -> tauri::App<MockRuntime> {
    let mut context = mock_context(noop_assets());
    context
        .config_mut()
        .plugins
        .0
        .insert("updater".into(), updater_config);
    mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap()
}

fn local_feed(pubkey: String, signature: String) -> tauri::App<MockRuntime> {
    app(json!({
        "pubkey": pubkey,
        "endpoints": [feed(signature)],
        "dangerousInsecureTransportProtocol": true,
    }))
}

#[test]
fn a_signed_update_on_the_feed_is_downloaded_verified_and_ready() {
    let (pubkey, signature) = signed_by_new_key();
    let app = local_feed(pubkey, signature);
    let updater = TauriUpdater::new(app.handle().clone());
    assert_eq!(updater.ready(), None);
    assert!(tauri::async_runtime::block_on(updater.check()).unwrap());
    assert_eq!(
        updater.ready(),
        Some(UpdateInfo {
            version: "99.0.0".into(),
            notes_md: "Fixes.".into(),
            ready: true,
        })
    );
}

#[test]
fn an_update_signed_by_another_key_is_never_ready() {
    let (pubkey, _) = signed_by_new_key();
    let (_, other_signature) = signed_by_new_key();
    let app = local_feed(pubkey, other_signature);
    let updater = TauriUpdater::new(app.handle().clone());
    assert!(tauri::async_runtime::block_on(updater.check()).is_err());
    assert_eq!(updater.ready(), None);
}

struct NoEvents;

impl EventEmitter for NoEvents {
    fn emit(&self, _: &'static str, _: Value) {}
}

fn shipped_config() -> Value {
    serde_json::from_str(include_str!("../tauri.conf.json")).unwrap()
}

/// The app as M0 ships it: no feed and no key, so nothing is ever ready to install.
#[test]
fn with_the_shipped_config_nothing_is_ready_and_update_install_answers_not_found() {
    let shipped = shipped_config()["plugins"]["updater"].clone();
    assert_eq!(shipped["endpoints"], json!([]), "no feed in M0");
    let app = app(shipped);
    let updater = Arc::new(TauriUpdater::new(app.handle().clone()));
    assert!(tauri::async_runtime::block_on(updater.check()).is_err());
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(
        dir.path(),
        CoreDeps::new(Arc::new(SystemClock), Arc::new(NoEvents)).with_updater(updater),
    )
    .unwrap();
    let settings = CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Settings,
        },
    };
    let answer = tauri::async_runtime::block_on(core.update_install(&settings, NoArgs {}));
    assert_eq!(answer.unwrap_err().code, ErrorCode::NotFound);
}

/// The engine signed by its own Swift build (engine/scripts/sign.sh) is copied into the bundle
/// as a file, next to the app binary where the host starts it, so the bundler does not re-sign
/// it with the app's entitlements (C18).
#[test]
fn the_bundle_ships_the_swift_signed_engine_next_to_the_app_binary() {
    let files = &shipped_config()["bundle"]["macOS"]["files"];
    assert_eq!(
        files["MacOS/noter-engine"],
        json!("../../../engine/.build/release/noter-engine")
    );
    assert!(shipped_config()["bundle"].get("externalBin").is_none());
}
