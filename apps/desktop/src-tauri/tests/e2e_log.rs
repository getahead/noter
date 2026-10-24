//! FEATURE cpt-noter-feature-core-native-surfaces, algorithm cpt-noter-algo-core-native-surfaces-e2e-log:
//! the native command log the E2E coverage gate reads (debug builds with NOTER_E2E_LOG_DIR only).

use std::ffi::OsString;

use noter_desktop::e2e_log::E2eLog;

#[test]
fn the_log_is_off_in_release_builds_and_without_the_variable() {
    let dir = tempfile::tempdir().unwrap();
    assert!(
        E2eLog::from_env(false, Some(dir.path().into())).is_none(),
        "release"
    );
    assert!(E2eLog::from_env(true, None).is_none(), "unset");
    assert!(
        E2eLog::from_env(true, Some(OsString::new())).is_none(),
        "empty"
    );
    assert!(E2eLog::from_env(true, Some(dir.path().into())).is_some());
}

#[test]
fn every_command_that_answered_is_written_once_by_name_on_quit() {
    let dir = tempfile::tempdir().unwrap();
    let log = E2eLog::from_env(true, Some(dir.path().into())).unwrap();
    log.record("capture_stop");
    log.record("app_snapshot");
    log.record("capture_stop");
    let path = log.write(4242).unwrap();
    assert_eq!(path, dir.path().join("commands-native-app-4242.json"));
    let written: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(
        written,
        serde_json::json!({
            "suite": "native",
            "target": "app",
            "commands": ["app_snapshot", "capture_stop"],
            "stories": []
        })
    );
}
