//! The macOS package (docs/DELIVERY.md › Packages): `tauri build` bundles the app with
//! release-please's version from apps/desktop/package.json and the UI built into apps/desktop/dist,
//! while development builds (and these tests) serve the Vite dev server and need no dist.

use tauri::utils::config::FrontendDist;

#[test]
fn the_bundle_carries_the_package_version_and_the_built_ui() {
    let context: tauri::Context<tauri::test::MockRuntime> = tauri::generate_context!();
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
