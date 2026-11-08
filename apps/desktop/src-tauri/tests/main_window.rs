//! DESIGN 3.8 (`cpt-noter-topology-ui-windows`): the main window opens at 1280×820 and cannot be
//! shrunk below 900×600, the narrowest size the shell's layout rules are designed for.

use serde_json::Value;

#[test]
fn the_main_window_opens_at_1280x820_with_a_900x600_minimum() {
    let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let main = conf["app"]["windows"]
        .as_array()
        .and_then(|ws| ws.iter().find(|w| w["label"] == "main"))
        .expect("the main window is configured");
    let size = |key: &str| main[key].as_u64().unwrap_or_else(|| panic!("{key} is set"));
    assert_eq!((size("width"), size("height")), (1280, 820));
    assert_eq!((size("minWidth"), size("minHeight")), (900, 600));
}
