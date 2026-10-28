//! FEATURE cpt-noter-feature-core-native-surfaces (host half): where the call window and the
//! record prompt go, what each menu bar item runs as a native caller, and the windows the host
//! creates for the core.

use std::sync::Arc;

use std::sync::Mutex;

use noter_core::{
    Core, CoreDeps, EventEmitter, Notification, NotificationKind, Surfaces, SystemClock,
    TrayAction, TrayEntry, TrayGlyph, TrayItem, TrayModel,
};
use noter_desktop::surfaces::{
    action_of, call_frame, clamp_frame, frame_of, glyph_image, is_panel, notification_clicked,
    posted, quit_alert, running_call, same_shape, settings_url, tray_command, SavedFrames,
    TauriSurfaces,
};
use noter_desktop::Booted;
use noter_native::Frame;
use noter_protocol::ipc::{dispatch_json, event_names, Caller, CommandCtx, CoreApi, NativeSurface};
use noter_protocol::model::{
    CallLayout, CallPageTab, CapturePhase, DegradedState, DisplayInfo, NavTarget, WindowLabel,
};
use noter_protocol::{CallId, DisplayId, ErrorCode, NoArgs, PermissionKind, TimestampMs};
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
        Some((id("dsp_studio"), STUDIO))
    );
    assert_eq!(
        frame_of(None, &displays, frames),
        Some((id("dsp_builtin"), BUILT_IN))
    );
    assert_eq!(
        frame_of(Some(&id("dsp_unplugged")), &displays, frames),
        Some((id("dsp_builtin"), BUILT_IN)),
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
    let sent = posted(&silent);
    assert_eq!(sent.title, "System audio silent");
    assert_eq!(sent.body, "Recording continues with your microphone.");
    assert_eq!(sent.thread, call_id);
    assert_eq!(
        sent.target,
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
    let summary = posted(&ready);
    assert_eq!(summary.title, "Summary ready");
    assert!(matches!(
        summary.target,
        NavTarget::CallPage {
            tab: CallPageTab::Summary,
            ..
        }
    ));
    assert_ne!(
        summary.id,
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
        tab: CallPageTab::Summary,
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
    assert_eq!(tray_command(TrayAction::StopRecording, false, &snap), None);
    assert_eq!(
        tray_command(TrayAction::QuitNoter, false, &snap),
        None,
        "the host's own"
    );
    let start = json!({ "source": "menu_bar", "sensitive": false, "detection_id": null });
    snap.capture.call_id = Some(CallId::new("call_1".to_string()));
    let call = json!("call_1");
    let first_run = json!({ "target": { "type": "first_run", "step": null } });
    for (action, checked, name, args) in [
        (
            TrayAction::StartRecording,
            false,
            "capture_start",
            start.clone(),
        ),
        (TrayAction::StartDetected, false, "capture_start", start),
        (
            TrayAction::StopRecording,
            false,
            "capture_stop",
            json!({ "call_id": call }),
        ),
        (
            TrayAction::Pause,
            false,
            "capture_set_paused",
            json!({ "call_id": call, "paused": true }),
        ),
        (
            TrayAction::Resume,
            false,
            "capture_set_paused",
            json!({ "call_id": call, "paused": false }),
        ),
        (
            TrayAction::MarkMoment,
            false,
            "capture_mark_moment",
            json!({ "call_id": call }),
        ),
        (
            TrayAction::KeepRecording,
            false,
            "capture_answer_call_end",
            json!({ "call_id": call, "choice": "keep_recording" }),
        ),
        (
            TrayAction::StopNow,
            false,
            "capture_answer_call_end",
            json!({ "call_id": call, "choice": "stop_now" }),
        ),
        (
            TrayAction::StartAsNewCall,
            false,
            "capture_answer_new_meeting",
            json!({ "call_id": call, "choice": "start_as_new_call" }),
        ),
        (
            TrayAction::KeepInThisCall,
            false,
            "capture_answer_new_meeting",
            json!({ "call_id": call, "choice": "keep_in_this_call" }),
        ),
        (
            TrayAction::TryAgain,
            false,
            "capture_resume_interrupted",
            json!({ "call_id": call }),
        ),
        (
            TrayAction::ContinueRecording,
            false,
            "capture_continue",
            json!({ "call_id": call }),
        ),
        (
            TrayAction::OpenCallScreen,
            false,
            "window_show_call",
            json!({}),
        ),
        (
            TrayAction::UseFloatingPanel,
            false,
            "window_set_call_layout",
            json!({ "preference": "floating" }),
        ),
        (
            TrayAction::UseFloatingPanel,
            true,
            "window_set_call_layout",
            json!({ "preference": "auto" }),
        ),
        (
            TrayAction::HideForPresenting,
            false,
            "app_set_hidden_for_presenting",
            json!({ "hidden": true }),
        ),
        (
            TrayAction::ShowAfterPresenting,
            false,
            "app_set_hidden_for_presenting",
            json!({ "hidden": false }),
        ),
        (TrayAction::FinishSetup, false, "window_navigate", first_run),
        (
            TrayAction::OpenNoter,
            false,
            "window_navigate",
            json!({ "target": null }),
        ),
        (
            TrayAction::OpenSettings,
            false,
            "window_navigate",
            json!({ "target": { "type": "settings", "pane": "general" } }),
        ),
    ] {
        assert_eq!(
            tray_command(action, checked, &snap),
            Some((name, args.clone())),
            "{action:?}"
        );
        // Each command exists in the contract, is allowed for a native caller and takes the args.
        let spec = noter_protocol::ipc::command(name).unwrap();
        assert!(spec.check_caller(&menu_bar.caller).is_ok(), "{name}");
        let ran = tauri::async_runtime::block_on(dispatch_json(&core, &menu_bar, name, args, None));
        assert!(
            !matches!(&ran, Err(e) if e.code == ErrorCode::InvalidInput),
            "{name}: {ran:?}"
        );
        assert_eq!(action_of(&format!("{action:?}")), Some(action));
    }
}

#[test]
fn every_glyph_has_its_own_template_image_and_hidden_form() {
    let mut seen = Vec::new();
    for glyph in [
        TrayGlyph::Idle,
        TrayGlyph::Recording,
        TrayGlyph::Paused,
        TrayGlyph::CopilotMuted,
    ] {
        for hidden in [false, true] {
            let image = glyph_image(glyph, hidden);
            assert_eq!((image.width(), image.height()), (36, 36));
            // Template: black, the shape in the alpha channel.
            assert!(image.rgba().chunks(4).all(|p| p[..3] == [0, 0, 0]));
            seen.push(image.rgba().to_vec());
        }
    }
    seen.dedup();
    assert_eq!(seen.len(), 8);
}

#[test]
fn a_ticking_clock_updates_the_open_menu_and_a_new_item_rebuilds_it() {
    let line = |t: &str| TrayEntry::Line(t.into());
    let item = |action, key: Option<&str>| {
        TrayEntry::Item(TrayItem {
            action,
            label: format!("{action:?}"),
            enabled: true,
            checked: None,
            key: key.map(str::to_string),
        })
    };
    let model = |first: &str, entries: Vec<TrayEntry>| TrayModel {
        glyph: TrayGlyph::Recording,
        hidden: false,
        title: None,
        label: "Noter, recording, 0 minutes".into(),
        entries: [vec![line(first)], entries].concat(),
    };
    let stop = || item(TrayAction::StopRecording, Some("Ctrl+Alt+Super+R"));
    let a = model("Recording · 00:01", vec![stop()]);
    assert!(same_shape(&a, &model("Recording · 00:02", vec![stop()])));
    let pause = item(TrayAction::Pause, None);
    assert!(!same_shape(
        &a,
        &model("Recording · 00:02", vec![stop(), pause])
    ));
    let unkeyed = item(TrayAction::StopRecording, None);
    assert!(!same_shape(&a, &model("Recording · 00:02", vec![unkeyed])));
}

#[test]
fn the_settings_panes() {
    assert!(settings_url(PermissionKind::Microphone).ends_with("Privacy_Microphone"));
    assert!(settings_url(PermissionKind::SystemAudio).ends_with("Privacy_AudioCapture"));
}

#[test]
fn the_call_window_and_the_record_prompt_are_panels_the_other_windows_stay_windows() {
    assert!(is_panel(WindowLabel::CallScreen));
    assert!(is_panel(WindowLabel::RecordPrompt));
    for label in [
        WindowLabel::Main,
        WindowLabel::Settings,
        WindowLabel::FirstRun,
    ] {
        assert!(!is_panel(label), "{label:?}");
    }
}

#[test]
fn the_host_creates_the_core_windows_on_first_use() {
    // The mock runtime has no monitors: placement is proven by the frame tests above. Without the
    // nspanel plugin (no AppKit window here) the panels stay plain windows.
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
    surfaces.show_record_prompt();
    assert!(app
        .get_webview_window(WindowLabel::RecordPrompt.as_str())
        .is_some());
    surfaces.hide_call_window();
    surfaces.hide_all();
    surfaces.restore_all();
}

#[test]
fn a_saved_frame_is_clamped_to_the_visible_display() {
    // Inside: kept as it was.
    assert_eq!(
        clamp_frame((1600.0, 100.0, 400.0, 500.0), &STUDIO),
        (1600.0, 100.0, 400.0, 500.0)
    );
    // Off the right edge and too tall: moved in and shortened below the menu bar.
    assert_eq!(
        clamp_frame((3900.0, -300.0, 400.0, 2000.0), &STUDIO),
        (1512.0 + 2560.0 - 400.0, -200.0 + 32.0, 400.0, 1440.0 - 32.0)
    );
}

#[test]
fn the_call_window_frame_is_saved_per_display_and_layout_and_survives_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("call-window-frames.json");
    let studio = DisplayId::new("dsp_studio".to_string());
    let frames = SavedFrames::load(&path);
    assert_eq!(frames.get(&studio, CallLayout::Floating), None);
    frames.remember(&studio, CallLayout::Floating, (2000.0, 100.0, 420.0, 640.0));
    frames.remember(
        &studio,
        CallLayout::Dedicated,
        (1512.0, -168.0, 2000.0, 1200.0),
    );
    // A drag reports many frames: nothing is written until the window hides or Noter quits.
    assert_eq!(
        SavedFrames::load(&path).get(&studio, CallLayout::Floating),
        None
    );
    frames.save();
    let again = SavedFrames::load(&path);
    assert_eq!(
        again.get(&studio, CallLayout::Floating),
        Some((2000.0, 100.0, 420.0, 640.0))
    );
    assert_eq!(
        again.get(&studio, CallLayout::Dedicated),
        Some((1512.0, -168.0, 2000.0, 1200.0))
    );
    // A damaged file is no saved frame, not a failure.
    std::fs::write(&path, "not json").unwrap();
    assert_eq!(
        SavedFrames::load(&path).get(&studio, CallLayout::Floating),
        None
    );
}

#[test]
fn a_capture_problem_click_shows_the_call_window_not_the_main_window() {
    let dir = tempfile::tempdir().unwrap();
    let core = Arc::new(
        Core::open(
            dir.path(),
            CoreDeps::new(Arc::new(SystemClock), Arc::new(NoEvents)),
        )
        .unwrap(),
    );
    let app = mock_builder()
        .manage(Booted(Ok(core.clone())))
        .build(mock_context(noop_assets()))
        .unwrap();
    let heard = Arc::new(Mutex::new(0));
    let h = heard.clone();
    app.listen_any(event_names::NAV_REQUEST, move |_| *h.lock().unwrap() += 1);
    let call_id = CallId::new("call_1".to_string());
    let silent = Notification {
        call_id: call_id.clone(),
        kind: NotificationKind::CaptureProblem(DegradedState::SystemAudioSilent {
            call_id,
            since: TimestampMs(0),
            confidence: 0.9,
        }),
    };
    notification_clicked(app.handle(), posted(&silent).target);
    let main = CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    };
    let shown = (0..100).any(|_| {
        std::thread::sleep(std::time::Duration::from_millis(20));
        tauri::async_runtime::block_on(core.window_call_state(&main, NoArgs {}))
            .unwrap()
            .visible
    });
    assert!(shown, "the call window shows in its layout");
    assert_eq!(*heard.lock().unwrap(), 0, "no nav:request");
    assert!(app.get_webview_window(WindowLabel::Main.as_str()).is_none());
}

#[test]
fn the_quit_alert_takes_its_words_from_the_ui_catalogue() {
    let [title, message, cancel, confirm] = quit_alert("Planning: VHI 8.0 drawer redesign");
    assert_eq!(
        title,
        "Noter is recording “Planning: VHI 8.0 drawer redesign”"
    );
    assert_eq!(
        message,
        "Quitting stops the recording. The transcript so far is kept."
    );
    assert_eq!(
        (cancel.as_str(), confirm.as_str()),
        ("Cancel", "Stop and Quit")
    );
}

#[test]
fn quit_asks_only_while_a_call_records_or_waits_for_try_again() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(
        dir.path(),
        CoreDeps::new(Arc::new(SystemClock), Arc::new(NoEvents)),
    )
    .unwrap();
    let ctx = CommandCtx {
        caller: Caller::Native {
            surface: NativeSurface::Menu,
        },
    };
    let mut c = tauri::async_runtime::block_on(core.app_snapshot(&ctx, NoArgs {}))
        .unwrap()
        .capture;
    assert_eq!(running_call(&c), None, "idle: Noter quits at once");
    c.call_id = Some(CallId::new("call_1".to_string()));
    for (phase, asks) in [
        (CapturePhase::Starting, true),
        (CapturePhase::Recording, true),
        (CapturePhase::Paused, true),
        (CapturePhase::Failed, true),
        (CapturePhase::Stopping, false),
        (CapturePhase::Stopped, false),
        (CapturePhase::Idle, false),
    ] {
        c.phase = phase;
        assert_eq!(running_call(&c).is_some(), asks, "{phase:?}");
    }
    c.phase = CapturePhase::Recording;
    c.title = Some("Planning".into());
    let (call, title) = running_call(&c).unwrap();
    assert_eq!((call.as_str(), title.as_str()), ("call_1", "Planning"));
}
