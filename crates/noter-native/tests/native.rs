//! noter-native: the pure mappings on every system, and the macOS readings that never prompt.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_native::*;
use noter_protocol::model::{NotificationAuth, OutputRoute};
use noter_protocol::{PermissionKind, PermissionState};

#[test]
fn authorization_statuses_map_to_permission_states() {
    // AVAuthorizationStatus: not determined, restricted, denied, authorized.
    assert_eq!(
        [0, 1, 2, 3, 9].map(map_av_status),
        [
            PermissionState::NotAsked,
            PermissionState::Denied,
            PermissionState::Denied,
            PermissionState::Granted,
            PermissionState::NotAsked
        ]
    );
    // EKAuthorizationStatus: write-only access cannot read the calendar.
    assert_eq!(
        [0, 1, 2, 3, 4].map(map_calendar_status),
        [
            PermissionState::NotAsked,
            PermissionState::Denied,
            PermissionState::Denied,
            PermissionState::Granted,
            PermissionState::Denied
        ]
    );
    // UNAuthorizationStatus: provisional and ephemeral deliver too.
    assert_eq!(
        [0, 1, 2, 3, 4].map(map_notification_status),
        [
            NotificationAuth::NotDetermined,
            NotificationAuth::Denied,
            NotificationAuth::Authorized,
            NotificationAuth::Authorized,
            NotificationAuth::Authorized
        ]
    );
    assert_eq!(
        [
            NotificationAuth::NotDetermined,
            NotificationAuth::Denied,
            NotificationAuth::Authorized
        ]
        .map(notification_permission),
        [
            PermissionState::NotAsked,
            PermissionState::Denied,
            PermissionState::Granted
        ]
    );
}

#[test]
fn the_output_route_is_headphones_or_speakers_only_when_core_audio_says_so() {
    let built_in = u32::from_be_bytes(*b"bltn");
    assert_eq!(
        classify_route(built_in, Some(u32::from_be_bytes(*b"hdpn"))),
        OutputRoute::Headphones
    );
    assert_eq!(
        classify_route(built_in, Some(u32::from_be_bytes(*b"ispk"))),
        OutputRoute::Speakers
    );
    assert_eq!(classify_route(built_in, None), OutputRoute::Unknown);
    // AirPods and a Bluetooth speaker look the same: the user marks headphones.
    assert_eq!(
        classify_route(u32::from_be_bytes(*b"blue"), None),
        OutputRoute::Unknown
    );
}

#[test]
fn login_item_statuses_map() {
    assert_eq!(
        [0, 1, 2, 3].map(map_login_status),
        [
            LoginItem::Disabled,
            LoginItem::Enabled,
            LoginItem::RequiresApproval,
            LoginItem::NotFound
        ]
    );
}

#[test]
fn the_app_group_is_the_entitled_team_ai_noter_group() {
    let entitled = |ids: &[&str]| ids.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(
        app_group_id(&entitled(&["ABCDE12345.ai.other", "ABCDE12345.ai.noter"])),
        Some("ABCDE12345.ai.noter")
    );
    assert_eq!(app_group_id(&entitled(&[".ai.noter", "ai.noter"])), None);
    assert_eq!(app_group_id(&[]), None);
}

#[test]
fn an_unsigned_process_has_no_app_group_container() {
    // A test binary carries no application-groups entitlement: dev runs use the data dir.
    assert_eq!(app_group_container(), None);
}

#[test]
fn a_login_item_awaiting_approval_keeps_the_setting_on() {
    assert_eq!(
        login_outcome(Err("needs approval".into()), LoginItem::RequiresApproval),
        Ok(LoginItem::RequiresApproval)
    );
    assert_eq!(
        login_outcome(Ok(()), LoginItem::RequiresApproval),
        Ok(LoginItem::RequiresApproval)
    );
    assert_eq!(
        login_outcome(Ok(()), LoginItem::Enabled),
        Ok(LoginItem::Enabled)
    );
    assert_eq!(
        login_outcome(Err("denied".into()), LoginItem::Disabled),
        Err("denied".to_string())
    );
}

#[test]
fn free_disk_is_read_from_the_storage_volume() {
    assert!(disk_free_mb(Path::new("/")) > 0);
    assert_eq!(disk_free_mb(Path::new("/nonexistent/noter")), 0);
}

#[test]
fn system_audio_is_never_queried_or_asked_here() {
    // It cannot be queried; the core infers it from the self-test and asks through the engine.
    assert_eq!(
        permission(PermissionKind::SystemAudio),
        PermissionState::NotAsked
    );
    assert_eq!(
        request_permission(PermissionKind::SystemAudio),
        PermissionState::NotAsked
    );
}

#[test]
fn reading_every_permission_never_prompts_and_answers_a_state() {
    for kind in [
        PermissionKind::Microphone,
        PermissionKind::Calendar,
        PermissionKind::Notifications,
        PermissionKind::ScreenRecording,
        PermissionKind::AutomationTerminal,
        PermissionKind::AutomationBrowser,
    ] {
        let state = permission(kind);
        assert_ne!(state, PermissionState::NeedsRelaunch, "{kind:?}");
    }
}

#[test]
fn the_environment_reports_displays_route_and_disk() {
    let r = environment(Path::new("/"));
    assert!(r.disk_free_mb > 0);
    if cfg!(target_os = "macos") {
        assert!(r.displays.iter().filter(|d| d.is_main).count() <= 1);
        assert!(r
            .displays
            .iter()
            .all(|d| d.width_pt > 0 && !d.name.is_empty()));
    }
    let _ = (r.output_route, r.online, r.notifications, login_item());
}

#[test]
fn watch_reports_a_change_and_stops_when_dropped() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let s = seen.clone();
    let mut readings = vec![
        Reading::default(),
        Reading::default(),
        Reading {
            disk_free_mb: 7,
            ..Reading::default()
        },
    ]
    .into_iter();
    let w = watch_with(
        move || readings.next().unwrap_or_default(),
        Duration::from_millis(5),
        move |r| s.lock().unwrap().push(r.disk_free_mb),
    );
    std::thread::sleep(Duration::from_millis(100));
    drop(w);
    let after = seen.lock().unwrap().clone();
    // The first reading is the baseline; then 7 arrives, then the default again.
    assert_eq!(after, vec![7, 0]);
    std::thread::sleep(Duration::from_millis(30));
    assert_eq!(*seen.lock().unwrap(), after, "no callback after drop");
}

#[test]
fn the_environment_watcher_runs_and_stops() {
    let w = watch(std::env::temp_dir(), Duration::from_millis(5), |_| {});
    std::thread::sleep(Duration::from_millis(20));
    drop(w);
}

#[test]
fn turning_the_login_item_off_never_registers_anything() {
    // A test binary is not an app bundle: SMAppService answers an error or "not found".
    match set_login_item(false) {
        Ok(state) => assert_ne!(state, LoginItem::Enabled),
        Err(message) => assert!(!message.is_empty()),
    }
}
