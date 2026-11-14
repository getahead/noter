// Responsibilities from the core native surfaces feature.
use super::*;
use noter_protocol::model::NavTarget;
use noter_protocol::PermissionKind;
use noter_core::{TrayAction, TrayEntry, TrayGlyph, TrayModel};
use tauri::image::Image;


/// The core command a menu bar item runs, with its arguments from the current snapshot; `None`
/// when the item needs a call that is gone, or is the host's own (Quit Noter). `checked` is the
/// item's checkmark as the menu showed it.
pub fn tray_command(
    action: TrayAction,
    checked: bool,
    snap: &AppSnapshot,
) -> Option<(&'static str, Value)> {
    let call = || snap.capture.call_id.clone();
    let navigate = |target: Option<NavTarget>| ("window_navigate", json!({ "target": target }));
    // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-match-item
    // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-match-start
    Some(match action {
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-start
        TrayAction::StartRecording | TrayAction::StartDetected => {
            let detection_id = snap.detection.detection.as_ref().map(|d| d.id.clone());
            let args =
                json!({ "source": "menu_bar", "sensitive": false, "detection_id": detection_id });
            ("capture_start", args)
        }
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-start
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-stop
        TrayAction::StopRecording => ("capture_stop", json!({ "call_id": call()? })),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-stop
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-pause
        TrayAction::Pause => (
            "capture_set_paused",
            json!({ "call_id": call()?, "paused": true }),
        ),
        TrayAction::Resume => (
            "capture_set_paused",
            json!({ "call_id": call()?, "paused": false }),
        ),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-pause
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-mark
        TrayAction::MarkMoment => ("capture_mark_moment", json!({ "call_id": call()? })),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-mark
        TrayAction::KeepRecording => (
            "capture_answer_call_end",
            json!({ "call_id": call()?, "choice": "keep_recording" }),
        ),
        TrayAction::StopNow => (
            "capture_answer_call_end",
            json!({ "call_id": call()?, "choice": "stop_now" }),
        ),
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-if-new-meeting
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-new-meeting
        TrayAction::StartAsNewCall => (
            "capture_answer_new_meeting",
            json!({ "call_id": call()?, "choice": "start_as_new_call" }),
        ),
        TrayAction::KeepInThisCall => (
            "capture_answer_new_meeting",
            json!({ "call_id": call()?, "choice": "keep_in_this_call" }),
        ),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-new-meeting
        // @cpt-end:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-if-new-meeting
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-try-again
        TrayAction::TryAgain => ("capture_resume_interrupted", json!({ "call_id": call()? })),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-try-again
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-continue
        TrayAction::ContinueRecording => ("capture_continue", json!({ "call_id": call()? })),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-continue
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-open-call
        TrayAction::OpenCallScreen => ("window_show_call", json!({})),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-open-call
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-floating
        TrayAction::UseFloatingPanel => {
            let preference = if checked { "auto" } else { "floating" };
            (
                "window_set_call_layout",
                json!({ "preference": preference }),
            )
        }
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-floating
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-hide
        TrayAction::HideForPresenting => {
            ("app_set_hidden_for_presenting", json!({ "hidden": true }))
        }
        TrayAction::ShowAfterPresenting => {
            ("app_set_hidden_for_presenting", json!({ "hidden": false }))
        }
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-hide
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-if-finish
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-finish-setup
        // The first-run window opens at the step where setup stopped.
        TrayAction::FinishSetup => navigate(Some(NavTarget::FirstRun { step: None })),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-finish-setup
        // @cpt-end:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-if-finish
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-navigate
        TrayAction::OpenNoter => navigate(None),
        TrayAction::OpenLastSummary => navigate(Some(NavTarget::LastSummary)),
        TrayAction::OpenSettings => navigate(Some(NavTarget::Settings {
            pane: SettingsPane::General,
        })),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-navigate
        TrayAction::QuitNoter => return None,
    })
    // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-match-start
    // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-match-item
}

const ACTIONS: [TrayAction; 21] = [
    TrayAction::StartDetected,
    TrayAction::FinishSetup,
    TrayAction::KeepRecording,
    TrayAction::StopNow,
    TrayAction::StartAsNewCall,
    TrayAction::KeepInThisCall,
    TrayAction::TryAgain,
    TrayAction::ContinueRecording,
    TrayAction::StartRecording,
    TrayAction::StopRecording,
    TrayAction::Pause,
    TrayAction::Resume,
    TrayAction::MarkMoment,
    TrayAction::OpenCallScreen,
    TrayAction::UseFloatingPanel,
    TrayAction::OpenLastSummary,
    TrayAction::HideForPresenting,
    TrayAction::ShowAfterPresenting,
    TrayAction::OpenNoter,
    TrayAction::OpenSettings,
    TrayAction::QuitNoter,
];

/// A menu item's id is its action's name.
pub fn action_of(id: &str) -> Option<TrayAction> {
    ACTIONS.into_iter().find(|a| format!("{a:?}") == id)
}

/// The template glyph image: the page, its state mark and, hidden for presenting, the eye-slash
/// badge (docs/prototype `GLYPH` and `EYE`, 36 px for 18 pt).
pub fn glyph_image(glyph: TrayGlyph, hidden: bool) -> Image<'static> {
    match (glyph, hidden) {
        (TrayGlyph::Idle, false) => tauri::include_image!("icons/tray/idle.png"),
        (TrayGlyph::Idle, true) => tauri::include_image!("icons/tray/idle-hidden.png"),
        (TrayGlyph::Recording, false) => tauri::include_image!("icons/tray/recording.png"),
        (TrayGlyph::Recording, true) => tauri::include_image!("icons/tray/recording-hidden.png"),
        (TrayGlyph::Paused, false) => tauri::include_image!("icons/tray/paused.png"),
        (TrayGlyph::Paused, true) => tauri::include_image!("icons/tray/paused-hidden.png"),
        // @cpt-begin:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-case-muted
        // Drawn once the copilot can mute (M4, behind its flag); the core never asks for it yet.
        (TrayGlyph::CopilotMuted, false) => tauri::include_image!("icons/tray/muted.png"),
        (TrayGlyph::CopilotMuted, true) => tauri::include_image!("icons/tray/muted-hidden.png"),
        // @cpt-end:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-case-muted
    }
}

/// Two menus with the same items, keys and separators in the same order: the open menu can take
/// the new texts in place (macOS keeps showing the menu it opened).
pub fn same_shape(a: &TrayModel, b: &TrayModel) -> bool {
    let shape = |m: &TrayModel| -> Vec<String> {
        m.entries
            .iter()
            .map(|e| match e {
                TrayEntry::Line(_) => "line".into(),
                TrayEntry::Separator => "-".into(),
                TrayEntry::Item(i) => {
                    format!("{:?} {:?} {:?}", i.action, i.checked.is_some(), i.key)
                }
            })
            .collect()
    };
    shape(a) == shape(b)
}

/// The System Settings pane a permission's **Open System Settings…** opens.
pub fn settings_url(permission: PermissionKind) -> &'static str {
    match permission {
        PermissionKind::Microphone => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        }
        PermissionKind::SystemAudio => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture"
        }
        PermissionKind::Calendar => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"
        }
        PermissionKind::Notifications => {
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
        }
        PermissionKind::ScreenRecording => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
        PermissionKind::AutomationTerminal | PermissionKind::AutomationBrowser => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
        }
    }
}
