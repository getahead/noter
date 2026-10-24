//! FEATURE cpt-noter-feature-core-first-run: the host's `NativeServices` over `noter-native`.

use noter_core::NativeServices;
use noter_desktop::Mac;
use noter_protocol::{PermissionKind, PermissionState};

#[test]
fn the_mac_reads_the_environment_of_the_storage_volume() {
    let dir = tempfile::tempdir().unwrap();
    let mac = Mac::new(dir.path());
    assert!(mac.environment().disk_free_mb > 0);
}

#[test]
fn system_audio_is_never_asked_through_the_mac() {
    let mac = Mac::new(&std::env::temp_dir());
    assert_eq!(
        mac.permission(PermissionKind::SystemAudio),
        PermissionState::NotAsked
    );
    let asked = tauri::async_runtime::block_on(mac.request_permission(PermissionKind::SystemAudio));
    assert_eq!(asked, PermissionState::NotAsked);
}

#[test]
fn a_login_item_macos_refuses_is_an_error_the_core_logs() {
    // A test binary is not an app bundle: SMAppService answers an error or "not found".
    let mac = Mac::new(&std::env::temp_dir());
    if let Err(e) = mac.set_login_item(false) {
        assert!(!e.message.is_empty());
    }
}

#[test]
fn the_calendar_is_read_only_with_access_and_never_asked_here() {
    // A test binary has no calendar access: no event, and no prompt.
    let mac = Mac::new(&std::env::temp_dir());
    assert_eq!(
        mac.calendar_event_near(noter_protocol::TimestampMs(1_790_000_000_000)),
        None
    );
}
