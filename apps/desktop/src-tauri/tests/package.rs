//! The macOS package (docs/DELIVERY.md › Packages): `tauri build` bundles the app with
//! release-please's version from apps/desktop/package.json and the UI built into apps/desktop/dist,
//! while development builds (and these tests) serve the Vite dev server and need no dist.

use tauri::utils::config::FrontendDist;

fn package_context() -> tauri::Context<tauri::test::MockRuntime> {
    tauri::generate_context!()
}

#[test]
fn the_bundle_carries_the_package_version_and_the_built_ui() {
    let context = package_context();
    let config = context.config();
    let package: serde_json::Value =
        serde_json::from_str(include_str!("../../package.json")).expect("apps/desktop/package.json");
    assert_eq!(config.version.as_deref(), package["version"].as_str(), "version follows package.json");
    assert!(config.bundle.active, "tauri build must bundle (preview.yml, release.yml)");
    assert_eq!(
        config.build.frontend_dist,
        Some(FrontendDist::Directory("../dist".into())),
        "the bundle embeds the Vite build"
    );
    assert!(config.build.dev_url.is_some(), "development builds do not need dist");
}

#[cfg(target_os = "macos")]
#[test]
fn the_bundle_has_a_mac_icon_for_standard_and_retina_displays() {
    let context = package_context();
    let icons = &context.config().bundle.icon;
    let icon = icons
        .iter()
        .find(|path| path.ends_with(".icns"))
        .expect("bundle.icon needs a macOS icon");
    let output = tempfile::tempdir().unwrap();
    let iconset = output.path().join("Noter.iconset");
    let status = std::process::Command::new("iconutil")
        .args(["-c", "iconset", "-o"])
        .arg(&iconset)
        .arg(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(icon))
        .status()
        .unwrap();
    assert!(
        status.success(),
        "macOS must be able to decode the configured icon"
    );
    for size in [16, 32, 128, 256, 512] {
        for scale in ["", "@2x"] {
            let image = format!("icon_{size}x{size}{scale}.png");
            assert!(iconset.join(&image).is_file(), "missing {image}");
        }
    }
}
