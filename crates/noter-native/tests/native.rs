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

// ── native surfaces (core-native-surfaces): the pure halves ──────────────────

use noter_protocol::model::{CalendarEventRef, CallPageTab, NavTarget, Politeness};
use noter_protocol::{CalendarEventId, CallId, TimestampMs};

fn event(id: &str, starts_at: i64, ends_at: i64) -> CalendarEventRef {
    CalendarEventRef {
        id: CalendarEventId(id.into()),
        title: id.into(),
        starts_at: TimestampMs(starts_at),
        ends_at: TimestampMs(ends_at),
    }
}

#[test]
fn a_notification_carries_its_target_and_a_click_gives_it_back() {
    let target = NavTarget::CallPage {
        call_id: CallId::new("call_1"),
        tab: CallPageTab::Transcript,
        span: None,
    };
    let info = nav_user_info(&target);
    assert_eq!(nav_from_user_info(&info), Some(target));
    assert_eq!(
        nav_from_user_info("not json"),
        None,
        "a click from elsewhere opens nothing"
    );
}

#[test]
fn an_assertive_announcement_has_the_high_priority() {
    // NSAccessibilityPriorityLevel: medium 50, high 90.
    assert_eq!(announcement_priority(Politeness::Polite), 50);
    assert_eq!(announcement_priority(Politeness::Assertive), 90);
}

#[test]
fn the_calendar_event_near_a_moment_is_the_running_one_or_the_next_within_10_minutes() {
    let at = 1_000_000_000;
    let min = 60_000;
    let running = event("running", at - 30 * min, at + 30 * min);
    let soon = event("soon", at + 5 * min, at + 35 * min);
    let later = event("later", at + 11 * min, at + 40 * min);
    let past = event("past", at - 60 * min, at - 1);
    assert_eq!(
        nearest_event(vec![later.clone(), soon.clone(), running.clone()], at),
        Some(running.clone())
    );
    assert_eq!(
        nearest_event(vec![later.clone(), soon.clone(), past.clone()], at),
        Some(soon)
    );
    assert_eq!(nearest_event(vec![later, past], at), None);
    // Two running: the one that started last is the call now.
    let newer = event("newer", at - 5 * min, at + 25 * min);
    assert_eq!(nearest_event(vec![running, newer.clone()], at), Some(newer));
}

#[cfg(not(target_os = "macos"))]
#[test]
fn off_macos_the_surfaces_do_nothing() {
    let id = noter_protocol::DisplayId::new("display_1");
    assert_eq!(display_frame(&id), None);
    let n = PostedNotification {
        id: "n1".into(),
        title: "t".into(),
        body: "b".into(),
        thread: CallId::new("call_1"),
        target: NavTarget::Today,
    };
    assert_eq!(post_notification(&n), Ok(()));
    on_notification_click(Box::new(|_| {}));
    announce("hello", Politeness::Polite);
    assert_eq!(calendar_event_near(0), None);
}
