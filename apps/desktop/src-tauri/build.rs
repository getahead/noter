//! Generates, from the contract (`noter_protocol::ipc::COMMANDS`), the ACL app manifest
//! (`AppManifest::commands`) and one capability per window, so Tauri's own check and the core's
//! scope check allow the same commands.

use std::path::PathBuf;

use noter_protocol::ipc::COMMANDS;
use noter_protocol::model::WindowLabel;

fn main() {
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));

    let caps = out.join("capabilities");
    std::fs::create_dir_all(&caps).expect("capabilities dir");
    for w in WindowLabel::ALL {
        // The alerts (dialogs host) are native message dialogs of the windows that raise them; the
        // call screen never shows one.
        let dialogs = matches!(
            w,
            WindowLabel::Main | WindowLabel::Settings | WindowLabel::FirstRun
        )
        .then(|| "dialog:allow-message".to_string());
        // @cpt-algo:cpt-noter-algo-core-ipc-host-scope-check:p1
        let dragging = matches!(
            w,
            WindowLabel::Main | WindowLabel::Settings | WindowLabel::FirstRun
        )
        .then(|| "core:window:allow-start-dragging".to_string());
        let permissions: Vec<String> = ["core:event:allow-listen", "core:event:allow-unlisten"]
            .into_iter()
            .map(str::to_string)
            .chain(dialogs)
            .chain(dragging)
            .chain(
                COMMANDS
                    .iter()
                    .filter(|c| c.allows(w))
                    .map(|c| format!("allow-{}", c.name.replace('_', "-"))),
            )
            .collect();
        let capability = format!(
            "{{\"identifier\": \"window-{w}\", \"windows\": [\"{w}\"], \"permissions\": {perms}}}",
            w = w.as_str(),
            perms = serde_json_list(&permissions)
        );
        std::fs::write(caps.join(format!("{}.json", w.as_str())), capability).expect("capability");
    }

    let pattern: &'static str = Box::leak(format!("{}/*.json", caps.display()).into_boxed_str());
    let names: &'static [&'static str] = Box::leak(
        COMMANDS
            .iter()
            .map(|c| c.name)
            .collect::<Vec<_>>()
            .into_boxed_slice(),
    );
    let manifest = tauri_build::AppManifest::new().commands(names);
    let attributes = tauri_build::Attributes::new()
        .app_manifest(manifest)
        .capabilities_path_pattern(pattern);
    tauri_build::try_build(attributes).expect("tauri-build");
}

fn serde_json_list(items: &[String]) -> String {
    let quoted: Vec<String> = items.iter().map(|i| format!("\"{i}\"")).collect();
    format!("[{}]", quoted.join(", "))
}
