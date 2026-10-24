//! FEATURE cpt-noter-feature-core-native-surfaces (host half): where the call window and the
//! record prompt go, what each menu bar item runs as a native caller, and the windows the host
//! creates for the core.

use std::sync::Arc;

use noter_core::{Core, CoreDeps, EventEmitter, Surfaces, SystemClock, TrayAction, TrayGlyph};
use noter_desktop::surfaces::{
    action_of, call_frame, screen_of, settings_url, tray_command, tray_label, tray_title, Screen,
    TauriSurfaces,
};
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi, NativeSurface};
use noter_protocol::model::{CallLayout, DisplayInfo, WindowLabel};
use noter_protocol::{CallId, DisplayId, NoArgs, PermissionKind};
use serde_json::{json, Value};
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

struct NoEvents;

impl EventEmitter for NoEvents {
    fn emit(&self, _: &'static str, _: Value) {}
}

fn screens() -> Vec<Screen> {
    vec![
        Screen {
            x: 0.0,
            y: 0.0,
            width: 1512.0,
            height: 982.0,
            primary: true,
        },
        Screen {
            x: 1512.0,
            y: -200.0,
            width: 2560.0,
            height: 1440.0,
            primary: false,
        },
    ]
}

fn display(main: bool, width_pt: u32, height_pt: u32) -> DisplayInfo {
    DisplayInfo {
        id: DisplayId::new("dsp_x".to_string()),
        name: "Display 2".into(),
        is_main: main,
        holds_call_app: false,
        width_pt,
        height_pt,
    }
}

#[test]
fn the_call_display_is_found_by_main_or_size_and_falls_back_to_the_primary() {
    let s = screens();
    assert_eq!(screen_of(None, &s), Some(&s[0]));
    assert_eq!(screen_of(Some(&display(true, 1512, 982)), &s), Some(&s[0]));
    assert_eq!(
        screen_of(Some(&display(false, 2560, 1440)), &s),
        Some(&s[1])
    );
    assert_eq!(
        screen_of(Some(&display(false, 1920, 1080)), &s),
        Some(&s[0]),
        "unplugged"
    );
    assert_eq!(screen_of(None, &[]), None);
}

#[test]
fn the_call_window_fills_a_dedicated_display_or_floats_in_its_top_right_corner() {
    let studio = &screens()[1];
    assert_eq!(
        call_frame(CallLayout::Dedicated, false, studio),
        (1512.0, -168.0, 2560.0, 1408.0)
    );
    let (x, y, w, h) = call_frame(CallLayout::Floating, false, studio);
    assert_eq!((w, h), (380.0, 600.0));
    assert_eq!(x + w, 1512.0 + 2560.0 - 16.0);
    assert_eq!(y, -200.0 + 32.0 + 16.0);
    assert_eq!(
        call_frame(CallLayout::Floating, true, studio).3,
        56.0,
        "the strip"
    );
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
