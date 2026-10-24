//! FEATURE cpt-noter-feature-core-native-surfaces (host half): where the call window and the
//! record prompt go, what each menu bar item runs as a native caller, and the windows the host
//! creates for the core.

use std::sync::Arc;

use std::sync::Mutex;

use noter_core::{
    Core, CoreDeps, EventEmitter, Notification, NotificationKind, Surfaces, SystemClock,
    TrayAction, TrayGlyph,
};
use noter_desktop::surfaces::{
    action_of, call_frame, frame_of, notification_clicked, posted, settings_url, tray_command,
    tray_label, tray_title, TauriSurfaces,
};
use noter_native::Frame;
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi, NativeSurface};
use noter_protocol::model::{
    CallLayout, CallPageTab, DegradedState, DisplayInfo, NavTarget, WindowLabel,
};
use noter_protocol::{CallId, DisplayId, NoArgs, PermissionKind, TimestampMs};
use serde_json::{json, Value};
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::{Listener, Manager};

struct NoEvents;

impl EventEmitter for NoEvents {
    fn emit(&self, _: &'static str, _: Value) {}
}

const BUILT_IN: Frame = Frame {
    x: 0.0,
    y: 0.0,
    width: 1512.0,
    height: 982.0,
};
const STUDIO: Frame = Frame {
    x: 1512.0,
    y: -200.0,
    width: 2560.0,
    height: 1440.0,
};

fn display(id: &str, is_main: bool) -> DisplayInfo {
    DisplayInfo {
        id: DisplayId::new(id.to_string()),
        name: "Display".into(),
        is_main,
        holds_call_app: false,
        width_pt: 0,
        height_pt: 0,
    }
}

/// The Mac's frames by display id, as noter-native's `display_frame` answers.
fn frames(id: &DisplayId) -> Option<Frame> {
    match id.as_str() {
        "dsp_builtin" => Some(BUILT_IN),
        "dsp_studio" => Some(STUDIO),
        _ => None,
    }
}

#[test]
fn the_call_display_is_found_by_identity_and_falls_back_to_the_main_display() {
    let displays = [display("dsp_builtin", true), display("dsp_studio", false)];
    let id = |s: &str| DisplayId::new(s.to_string());
    assert_eq!(
        frame_of(Some(&id("dsp_studio")), &displays, frames),
        Some(STUDIO)
    );
    assert_eq!(frame_of(None, &displays, frames), Some(BUILT_IN));
    assert_eq!(
        frame_of(Some(&id("dsp_unplugged")), &displays, frames),
        Some(BUILT_IN),
        "unplugged"
    );
    assert_eq!(frame_of(None, &[], frames), None);
}

#[test]
fn the_call_window_fills_a_dedicated_display_or_floats_in_its_top_right_corner() {
    assert_eq!(
        call_frame(CallLayout::Dedicated, false, &STUDIO),
        (1512.0, -168.0, 2560.0, 1408.0)
    );
    let (x, y, w, h) = call_frame(CallLayout::Floating, false, &STUDIO);
    assert_eq!((w, h), (380.0, 600.0));
    assert_eq!(x + w, 1512.0 + 2560.0 - 16.0);
    assert_eq!(y, -200.0 + 32.0 + 16.0);
    assert_eq!(
        call_frame(CallLayout::Floating, true, &STUDIO).3,
        56.0,
        "the strip"
    );
}

#[test]
fn a_notification_carries_its_call_as_thread_and_where_a_click_goes() {
    let call_id = CallId::new("call_1".to_string());
    let silent = Notification {
        call_id: call_id.clone(),
        kind: NotificationKind::CaptureProblem(DegradedState::SystemAudioSilent {
            call_id: call_id.clone(),
            since: TimestampMs(0),
            confidence: 0.9,
        }),
    };
    let posted = posted(&silent);
    assert_eq!(posted.title, "System audio silent");
    assert_eq!(posted.body, "Recording continues with your microphone.");
    assert_eq!(posted.thread, call_id);
    assert_eq!(
        posted.target,
        NavTarget::CallPage {
            call_id: call_id.clone(),
            tab: CallPageTab::Transcript,
            span: None
        }
    );
    let failed = Notification {
        call_id: call_id.clone(),
        kind: NotificationKind::CaptureProblem(DegradedState::CaptureFailed {
            call_id: call_id.clone(),
            since: TimestampMs(0),
        }),
    };
    assert_eq!(posted(&failed).title, "Not recording · engine stopped");
    let mic = Notification {
        call_id: call_id.clone(),
        kind: NotificationKind::CaptureProblem(DegradedState::MicrophoneOff {
            call_id: call_id.clone(),
        }),
    };
    assert_eq!(posted(&mic).title, "Microphone off");
    let ready = Notification {
        call_id: call_id.clone(),
        kind: NotificationKind::SummaryReady,
    };
    let posted = posted(&ready);
    assert_eq!(posted.title, "Summary ready");
    assert!(matches!(
        posted.target,
        NavTarget::CallPage {
            tab: CallPageTab::Summary,
            ..
        }
    ));
    assert_ne!(
        posted.id,
        posted(&ready).id,
        "every post is its own notification"
    );
}

#[test]
fn a_notification_click_asks_the_main_window_to_navigate() {
    let app = mock_builder().build(mock_context(noop_assets())).unwrap();
    let heard = Arc::new(Mutex::new(Vec::new()));
    let h = heard.clone();
    app.listen_any(event_names::NAV_REQUEST, move |e| {
        h.lock().unwrap().push(e.payload().to_string());
    });
    let target = NavTarget::CallPage {
        call_id: CallId::new("call_1".to_string()),
        tab: CallPageTab::Transcript,
        span: None,
    };
    notification_clicked(app.handle(), target.clone());
    let heard = heard.lock().unwrap().clone();
    assert_eq!(heard.len(), 1);
    assert_eq!(
        serde_json::from_str::<NavTarget>(&heard[0]).unwrap(),
        target
    );
    assert!(app.get_webview_window(WindowLabel::Main.as_str()).is_some());
}

#[test]
fn every_menu_item_runs_its_command_with_the_live_call() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(
        dir.path(),
        CoreDeps::new(Arc::new(SystemClock), Arc::new(NoEvents)),
    )
    .unwrap();
    let menu_bar = CommandCtx {
        caller: Caller::Native {
            surface: NativeSurface::MenuBar,
        },
    };
    let mut snap = tauri::async_runtime::block_on(core.app_snapshot(&menu_bar, NoArgs {})).unwrap();
    // No call: only the items that need none.
    assert_eq!(tray_command(TrayAction::StopRecording, &snap), None);
    assert_eq!(
        tray_command(TrayAction::OpenNoter, &snap),
        None,
        "the host's own"
    );
    assert_eq!(
        tray_command(TrayAction::StartRecording, &snap),
        Some((
            "capture_start",
            json!({ "source": "menu_bar", "sensitive": false, "detection_id": null })
        ))
    );
    snap.capture.call_id = Some(CallId::new("call_1".to_string()));
    let call = json!("call_1");
    for (action, name, args) in [
        (
            TrayAction::StopRecording,
            "capture_stop",
            json!({ "call_id": call }),
        ),
        (
            TrayAction::Pause,
            "capture_set_paused",
            json!({ "call_id": call, "paused": true }),
        ),
        (
            TrayAction::Resume,
            "capture_set_paused",
            json!({ "call_id": call, "paused": false }),
        ),
        (
            TrayAction::MarkMoment,
            "capture_mark_moment",
            json!({ "call_id": call }),
        ),
        (TrayAction::OpenCallScreen, "window_show_call", json!({})),
        (
            TrayAction::HideForPresenting,
            "app_set_hidden_for_presenting",
            json!({ "hidden": true }),
        ),
        (
            TrayAction::ShowAfterPresenting,
            "app_set_hidden_for_presenting",
            json!({ "hidden": false }),
        ),
        (
            TrayAction::StartAsNewCall,
            "capture_answer_new_meeting",
            json!({ "call_id": call, "choice": "start_as_new_call" }),
        ),
    ] {
        assert_eq!(
            tray_command(action, &snap),
            Some((name, args)),
            "{action:?}"
        );
        // Each command exists in the contract and is allowed for a native caller.
        let spec = noter_protocol::ipc::command(name).unwrap();
        assert!(spec.check_caller(&menu_bar.caller).is_ok(), "{name}");
        assert_eq!(action_of(&format!("{action:?}")), Some(action));
        assert!(!tray_label(action).is_empty());
    }
}

#[test]
fn the_menu_bar_title_and_the_settings_panes() {
    assert_eq!(tray_title(TrayGlyph::Idle), "");
    assert_ne!(
        tray_title(TrayGlyph::Recording),
        tray_title(TrayGlyph::Paused)
    );
    assert!(settings_url(PermissionKind::Microphone).ends_with("Privacy_Microphone"));
    assert!(settings_url(PermissionKind::SystemAudio).ends_with("Privacy_AudioCapture"));
}

#[test]
fn the_host_creates_the_core_windows_on_first_use() {
    // The mock runtime has no monitors: placement is proven by the frame tests above.
    let app = mock_builder().build(mock_context(noop_assets())).unwrap();
    let surfaces = TauriSurfaces::new(app.handle().clone(), std::env::temp_dir());
    assert!(!surfaces.call_surface_visible());
    surfaces.make_call_window_key();
    surfaces.show_window(WindowLabel::Settings);
    for label in [WindowLabel::CallScreen, WindowLabel::Settings] {
        assert!(
            app.get_webview_window(label.as_str()).is_some(),
            "{label:?}"
        );
    }
    surfaces.close_record_prompt(); // never shown: nothing to close
    surfaces.hide_call_window();
    surfaces.hide_all();
    surfaces.restore_all();
}
