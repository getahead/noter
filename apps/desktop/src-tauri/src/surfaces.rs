//! The core's windows, panels and menu bar on the Mac (DESIGN-core › Native surfaces, TL-2): the
//! host carries out what the core decides through `noter_core::Surfaces`, and turns menu bar
//! clicks into core commands as `Caller::Native { surface: menu_bar }`.
//!
//! The record prompt and the call window are non-activating NSPanels (tauri-nspanel, pinned in
//! Cargo.toml): they take clicks without bringing Noter forward over the call app.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use noter_core::{
    Core, Notification, NotificationKind, Placement, Surfaces, TrayAction, TrayEntry, TrayGlyph,
    TrayModel,
};
use noter_native::{Frame, ParentWindow, PostedNotification};
use noter_protocol::ipc::{dispatch_json, event_names, Caller, CommandCtx, CoreApi, NativeSurface};
use noter_protocol::model::{
    AppSnapshot, CallLayout, CallPageTab, CapturePhase, CaptureState, DegradedState, DisplayInfo,
    ExternalTarget, NavTarget, NoterSurface, Politeness, SettingsPane, WindowLabel,
};
use noter_protocol::{CallId, DisplayId, NoArgs, PermissionKind};
use serde_json::{json, Value};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, WebviewUrl, WebviewWindow,
};
use tauri_nspanel::{tauri_panel, ManagerExt, StyleMask, WebviewPanelManager, WebviewWindowExt};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};

use crate::native::{on_main, Windows};

tauri_panel! {
    panel!(CallPanel {
        config: {
            can_become_key_window: true,
            becomes_key_only_if_needed: true,
            is_floating_panel: true,
            hides_on_deactivate: false
        }
    })
}

/// Floating call panel and its collapsed strip, record prompt until its content reports its size
/// (points).
const PANEL: (f64, f64) = (380.0, 600.0);
const STRIP: (f64, f64) = (380.0, 56.0);
const PROMPT: (f64, f64) = (360.0, 132.0);
/// Distance of a panel from the display's top-right corner, below the menu bar.
const MARGIN: f64 = 16.0;
const MENU_BAR: f64 = 32.0;

/// The frame of the call display: the chosen display by identity, else (none chosen, or
/// unplugged) the main display; `frame` is noter-native's `display_frame`.
// @cpt-begin:cpt-noter-flow-core-native-surfaces-display-change:p1:inst-read-displays
pub fn frame_of(
    chosen: Option<&DisplayId>,
    displays: &[DisplayInfo],
    frame: impl Fn(&DisplayId) -> Option<Frame>,
) -> Option<(DisplayId, Frame)> {
    let main = || displays.iter().find(|d| d.is_main).or(displays.first());
    let display = chosen
        .and_then(|id| displays.iter().find(|d| d.id == *id))
        .or_else(main)?;
    Some((display.id.clone(), frame(&display.id)?))
}
// @cpt-end:cpt-noter-flow-core-native-surfaces-display-change:p1:inst-read-displays

/// A frame kept inside the display's visible area, below the menu bar.
pub fn clamp_frame((x, y, w, h): (f64, f64, f64, f64), visible: &Frame) -> (f64, f64, f64, f64) {
    let top = visible.y + MENU_BAR;
    let (w, h) = (w.min(visible.width), h.min(visible.height - MENU_BAR));
    let x = x.clamp(visible.x, visible.x + visible.width - w);
    let y = y.clamp(top, visible.y + visible.height - h);
    (x, y, w, h)
}

/// The call window's frames the user left, per display and layout, in a small JSON file beside
/// the data folder; a missing or damaged file is no saved frame.
pub struct SavedFrames {
    path: PathBuf,
    frames: Mutex<BTreeMap<String, (f64, f64, f64, f64)>>,
    dirty: AtomicBool,
}

fn frame_key(display: &DisplayId, layout: CallLayout) -> String {
    format!("{}/{layout:?}", display.as_str())
}

impl SavedFrames {
    pub fn load(path: &Path) -> Self {
        let read: Option<BTreeMap<String, [f64; 4]>> = std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok());
        let frames = read
            .unwrap_or_default()
            .into_iter()
            .map(|(k, [x, y, w, h])| (k, (x, y, w, h)))
            .collect();
        Self {
            path: path.to_path_buf(),
            frames: Mutex::new(frames),
            dirty: AtomicBool::new(false),
        }
    }

    pub fn get(&self, display: &DisplayId, layout: CallLayout) -> Option<(f64, f64, f64, f64)> {
        let frames = self.frames.lock().unwrap_or_else(|e| e.into_inner());
        frames.get(&frame_key(display, layout)).copied()
    }

    /// In memory only: a drag reports many frames; `save` writes the last one.
    pub fn remember(&self, display: &DisplayId, layout: CallLayout, frame: (f64, f64, f64, f64)) {
        let mut frames = self.frames.lock().unwrap_or_else(|e| e.into_inner());
        if frames.insert(frame_key(display, layout), frame) != Some(frame) {
            self.dirty.store(true, Ordering::Relaxed);
        }
    }

    /// Writes the frames when they changed since the last save.
    pub fn save(&self) {
        if !self.dirty.swap(false, Ordering::Relaxed) {
            return;
        }
        let frames = self.frames.lock().unwrap_or_else(|e| e.into_inner());
        let file: BTreeMap<&String, [f64; 4]> = frames
            .iter()
            .map(|(k, &(x, y, w, h))| (k, [x, y, w, h]))
            .collect();
        // Losing a saved frame only costs the default placement next time.
        let _ = std::fs::write(&self.path, serde_json::to_string(&file).unwrap_or_default());
    }
}

/// Where the call window goes: the whole display (dedicated) or a panel in its top-right corner.
pub fn call_frame(layout: CallLayout, collapsed: bool, screen: &Frame) -> (f64, f64, f64, f64) {
    match layout {
        CallLayout::Dedicated => (
            screen.x,
            screen.y + MENU_BAR,
            screen.width,
            screen.height - MENU_BAR,
        ),
        CallLayout::Floating => {
            let (w, h) = if collapsed { STRIP } else { PANEL };
            let x = screen.x + screen.width - w - MARGIN;
            (x, screen.y + MENU_BAR + MARGIN, w, h)
        }
    }
}

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
        TrayAction::OpenSettings => navigate(Some(NavTarget::Settings {
            pane: SettingsPane::General,
        })),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-navigate
        TrayAction::QuitNoter => return None,
    })
    // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-match-start
    // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-match-item
}

const ACTIONS: [TrayAction; 20] = [
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

/// What a notification says and where its click goes: NT-3 names the call's transcript, which
/// `notification_clicked` reads as "show the call window".
// @cpt-flow:cpt-noter-flow-ui-notifications-receive:p1
// @cpt-begin:cpt-noter-flow-ui-notifications-receive:p1:inst-post
pub fn posted(n: &Notification) -> PostedNotification {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let (title, body, tab) = match &n.kind {
        NotificationKind::CaptureProblem(DegradedState::SystemAudioSilent { .. }) => (
            "System audio silent",
            "Recording continues with your microphone.",
            CallPageTab::Transcript,
        ),
        NotificationKind::CaptureProblem(DegradedState::MicrophoneOff { .. }) => (
            "Microphone off",
            "Only the other side of the call is recorded.",
            CallPageTab::Transcript,
        ),
        NotificationKind::CaptureProblem(_) => (
            "Not recording · engine stopped",
            "Try Again on the call screen.",
            CallPageTab::Transcript,
        ),
        // @cpt-begin:cpt-noter-algo-core-postcall-notify:p1:inst-notify-release
        // One thread per call; the click opens the call's Summary through `nav:request`.
        NotificationKind::SummaryReady => ("Summary ready", "", CallPageTab::Summary),
        NotificationKind::SummaryFailed => (
            "Summary not written",
            "Open the call to try again.",
            CallPageTab::Summary,
        ),
        // @cpt-end:cpt-noter-algo-core-postcall-notify:p1:inst-notify-release
    };
    PostedNotification {
        id: format!("ntf_{}_{}", n.call_id, NEXT.fetch_add(1, Ordering::Relaxed)),
        title: title.into(),
        body: body.into(),
        thread: n.call_id.clone(),
        target: NavTarget::CallPage {
            call_id: n.call_id.clone(),
            tab,
            span: None,
        },
    }
}
// @cpt-end:cpt-noter-flow-ui-notifications-receive:p1:inst-post

/// The core, once it opened.
fn core_of<R: Runtime>(app: &AppHandle<R>) -> Option<Arc<Core>> {
    app.try_state::<crate::Booted>()?.0.clone().ok()
}

fn native(surface: NativeSurface) -> CommandCtx {
    CommandCtx {
        caller: Caller::Native { surface },
    }
}

/// NT-3 (a capture problem) is the one notification that names the call's transcript.
// shortcut: the posted target carries the kind (noter-native passes back only a `NavTarget`);
// give NT-3 its own target if another notification ever opens the transcript.
fn is_capture_problem(target: &NavTarget) -> bool {
    matches!(
        target,
        NavTarget::CallPage {
            tab: CallPageTab::Transcript,
            ..
        }
    )
}

/// A clicked notification: NT-3 shows the call window in its layout with the degraded banner,
/// without bringing Noter forward; NT-1 and NT-2 bring the main window forward and ask it to
/// navigate to the call's page.
// @cpt-flow:cpt-noter-flow-core-native-surfaces-notifications:p1
// @cpt-dod:cpt-noter-dod-core-native-surfaces-notifications:p1
// @cpt-dod:cpt-noter-dod-ui-notifications-content:p2
// @cpt-begin:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-click
pub fn notification_clicked<R: Runtime>(app: &AppHandle<R>, target: NavTarget) {
    // @cpt-begin:cpt-noter-flow-ui-notifications-receive:p1:inst-user-click
    // @cpt-begin:cpt-noter-state-ui-notifications-item:p1:inst-sent-opened
    // @cpt-begin:cpt-noter-flow-ui-notifications-receive:p1:inst-match-click
    // @cpt-begin:cpt-noter-flow-ui-notifications-receive:p1:inst-case-nt3
    if is_capture_problem(&target) {
        let Some(core) = core_of(app) else {
            return;
        };
        tauri::async_runtime::spawn(async move {
            let ctx = native(NativeSurface::Notification);
            let name = "window_show_call";
            if dispatch_json(core.as_ref(), &ctx, name, json!({}), None)
                .await
                .is_ok()
            {
                crate::e2e_log::record(name);
            }
        });
        return;
    }
    // @cpt-end:cpt-noter-flow-ui-notifications-receive:p1:inst-case-nt3
    if let Some(main) = window(app, WindowLabel::Main) {
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = app.emit(event_names::NAV_REQUEST, target);
    // @cpt-end:cpt-noter-flow-ui-notifications-receive:p1:inst-match-click
    // @cpt-end:cpt-noter-state-ui-notifications-item:p1:inst-sent-opened
    // @cpt-end:cpt-noter-flow-ui-notifications-receive:p1:inst-user-click
    // @cpt-begin:cpt-noter-flow-ui-notifications-receive:p1:inst-return-receive
    // The call window or the call's page: the place the notification names.
    // @cpt-end:cpt-noter-flow-ui-notifications-receive:p1:inst-return-receive
}
// @cpt-end:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-click

/// The UI string catalogue the quit alert's words come from (`apps/desktop/src/i18n/en.ts`).
const CATALOGUE: &str = include_str!("../../src/i18n/en.ts");

/// The catalogue's string for `key`: the first quoted text after `"key":`.
fn catalogue(key: &str) -> String {
    let after = CATALOGUE
        .split(&format!("\"{key}\":"))
        .nth(1)
        .unwrap_or_default();
    after.split('"').nth(1).unwrap_or_default().to_string()
}

/// The quit-while-recording alert: title, message, the default **Cancel** and **Stop and Quit**.
// @cpt-dod:cpt-noter-dod-ui-dialogs-host-delete:p2
pub fn quit_alert(call_title: &str) -> [String; 4] {
    [
        catalogue("dialogs.quit.title").replace("{title}", call_title),
        catalogue("dialogs.quit.message"),
        catalogue("dialogs.cancel"),
        catalogue("dialogs.quit.confirm"),
    ]
}

/// The call a quit would end, with its title: a capture is running or waits for **Try Again**.
pub fn running_call(c: &CaptureState) -> Option<(CallId, String)> {
    let open = matches!(
        c.phase,
        CapturePhase::Starting
            | CapturePhase::Recording
            | CapturePhase::Paused
            | CapturePhase::Failed
    );
    let title = c.title.clone().unwrap_or_else(|| "this call".into());
    Some((c.call_id.clone().filter(|_| open)?, title))
}

/// **Quit Noter** from the menu bar or ⌘Q: Noter quits at once when nothing is recording;
/// otherwise the alert asks, with **Cancel** as the default, and **Stop and Quit** saves first.
// @cpt-flow:cpt-noter-flow-ui-dialogs-host-quit:p1
pub fn quit<R: Runtime>(app: &AppHandle<R>) {
    // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-user-quit
    let Some(core) = core_of(app) else {
        app.exit(0);
        return;
    };
    let app = app.clone();
    // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-user-quit
    tauri::async_runtime::spawn(async move {
        let ctx = native(NativeSurface::Menu);
        let capture = core.app_snapshot(&ctx, NoArgs {}).await.map(|s| s.capture);
        // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-if-idle
        let Some((call_id, title)) = capture.ok().as_ref().and_then(running_call) else {
            // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-return-quit
            app.exit(0);
            return;
            // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-return-quit
        };
        // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-if-idle
        // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-quit-alert
        // NSAlert makes the first button the default: Cancel goes first, so Return keeps recording.
        let [title, message, cancel, confirm] = quit_alert(&title);
        let stop = MessageDialogResult::Custom(confirm.clone());
        let dialog = app
            .dialog()
            .message(message)
            .title(title)
            .buttons(MessageDialogButtons::OkCancelCustom(cancel, confirm));
        // Without a parent rfd posts a system alert from another process instead of Noter's NSAlert:
        // it goes on the main window when it shows, else on the call window.
        let parent = [WindowLabel::Main, WindowLabel::CallScreen]
            .into_iter()
            .filter_map(|label| app.get_webview_window(label.as_str()))
            .find(|w| w.is_visible().unwrap_or(false));
        let dialog = match &parent {
            Some(window) => dialog.parent(window),
            None => dialog,
        };
        // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-quit-alert
        dialog.show_with_result(move |answer| {
            // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-if-stop-quit
            if answer != stop {
                return;
            }
            // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-if-stop-quit
            // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-stop-quit
            tauri::async_runtime::spawn(async move {
                let args = json!({ "call_id": call_id });
                if dispatch_json(core.as_ref(), &ctx, "capture_stop", args, None)
                    .await
                    .is_ok()
                {
                    crate::e2e_log::record("capture_stop");
                }
                app.exit(0);
            });
            // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-stop-quit
        });
        // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-return-quit-done
        // Cancel keeps the recording; Stop and Quit saves it before Noter quits.
        // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-return-quit-done
    });
}

/// The app menu's id for **Quit Noter** ⌘Q.
pub const APP_QUIT: &str = "AppQuit";

/// The default app menu with Noter's own **Quit Noter** ⌘Q in place of the predefined one, which
/// ends the app with no event to stop it (the quit alert could not ask).
pub fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(first)) = menu.items()?.into_iter().next() {
        if let Some(quit) = first.items()?.pop() {
            first.remove(&quit)?;
        }
        let item = MenuItem::with_id(app, APP_QUIT, "Quit Noter", true, Some("CmdOrCtrl+Q"))?;
        first.append(&item)?;
    }
    Ok(menu)
}

/// The windows that are non-activating panels; the others are ordinary windows.
// @cpt-algo:cpt-noter-algo-core-native-surfaces-panels:p1
// @cpt-dod:cpt-noter-dod-core-native-surfaces-panels:p1
pub fn is_panel(label: WindowLabel) -> bool {
    matches!(label, WindowLabel::CallScreen | WindowLabel::RecordPrompt)
}

/// Whether panels exist: only the app registers the nspanel plugin; the tests' mock runtime has
/// no AppKit window to convert, so its panels stay plain windows.
fn panels_on<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<WebviewPanelManager<R>>().is_some()
}

/// The window becomes an NSPanel that takes clicks without activating Noter (on the main
/// thread: AppKit, and tauri-nspanel does not dispatch there itself).
fn make_panel<R: Runtime>(window: &WebviewWindow<R>) {
    if !panels_on(window.app_handle()) {
        return;
    }
    let panel = window.clone();
    let _ = window.run_on_main_thread(move || {
        // @cpt-begin:cpt-noter-algo-core-native-surfaces-panels:p1:inst-convert
        if let Ok(panel) = panel.to_panel::<CallPanel<R>>() {
            let _ = panel.add_style_mask(StyleMask::empty().nonactivating_panel().into());
        }
        // @cpt-end:cpt-noter-algo-core-native-surfaces-panels:p1:inst-convert
    });
}

/// Shows a window; a panel comes forward without becoming key unless `key` (it still never
/// activates Noter), a plain window takes focus when `key`.
fn show<R: Runtime>(window: &WebviewWindow<R>, key: bool) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    if !(crate::window_label(&label).is_some_and(is_panel) && panels_on(&app)) {
        let _ = window.show();
        if key {
            let _ = window.set_focus();
        }
        return;
    }
    let plain = window.clone();
    let _ = window.run_on_main_thread(move || match app.get_webview_panel(&label) {
        Ok(panel) if key => panel.show_and_make_key(),
        Ok(panel) => panel.show(),
        // The conversion failed: the window still shows.
        Err(_) => {
            let _ = plain.show();
        }
    });
}

/// The window, created hidden on first use at `index.html?window=<label>`.
fn window<R: Runtime>(app: &AppHandle<R>, label: WindowLabel) -> Option<WebviewWindow<R>> {
    if let Some(w) = app.get_webview_window(label.as_str()) {
        return Some(w);
    }
    let url = WebviewUrl::App(format!("index.html?window={}", label.as_str()).into());
    let builder = tauri::WebviewWindowBuilder::new(app, label.as_str(), url)
        .title("Noter")
        .visible(false);
    let builder = if matches!(label, WindowLabel::CallScreen | WindowLabel::RecordPrompt) {
        // @cpt-begin:cpt-noter-algo-core-native-surfaces-panels:p1:inst-content-protect
        // @cpt-begin:cpt-noter-algo-core-native-surfaces-panels:p1:inst-level
        builder
            // @cpt-begin:cpt-noter-algo-core-native-surfaces-panels:p1:inst-first-click
            // The first click on a panel of an inactive app acts, instead of only making it key.
            .accept_first_mouse(true)
            // @cpt-end:cpt-noter-algo-core-native-surfaces-panels:p1:inst-first-click
            .content_protected(true)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .focused(false)
            .skip_taskbar(true)
        // @cpt-end:cpt-noter-algo-core-native-surfaces-panels:p1:inst-level
        // @cpt-end:cpt-noter-algo-core-native-surfaces-panels:p1:inst-content-protect
    } else {
        builder
    };
    // @cpt-begin:cpt-noter-algo-core-native-surfaces-panels:p1:inst-chrome
    let builder = if matches!(label, WindowLabel::RecordPrompt) {
        builder.decorations(false).transparent(true)
    } else {
        builder
    };
    // @cpt-end:cpt-noter-algo-core-native-surfaces-panels:p1:inst-chrome
    let window = builder.build().ok()?;
    if is_panel(label) {
        make_panel(&window);
    }
    // @cpt-begin:cpt-noter-algo-core-native-surfaces-panels:p1:inst-return-panels
    Some(window)
    // @cpt-end:cpt-noter-algo-core-native-surfaces-panels:p1:inst-return-panels
}

/// The host's `Surfaces`: Tauri windows, the tray, `open`.
pub struct TauriSurfaces<R: Runtime> {
    app: AppHandle<R>,
    storage: PathBuf,
    core: OnceLock<Weak<Core>>,
    tray: Mutex<Option<TrayIcon<R>>>,
    /// The menu on screen and the model it shows.
    menu: Mutex<Option<(TrayModel, Menu<R>)>>,
    /// The model to show next, set from any thread.
    wanted: Mutex<Option<TrayModel>>,
    /// **Use Floating Panel** is checked in the menu on screen.
    floating: AtomicBool,
    /// The windows hidden for presenting, shown again on restore.
    hidden: Mutex<Vec<WindowLabel>>,
    frames: SavedFrames,
    /// The display and layout the call window was last placed on, uncollapsed: where a move or
    /// resize by the user is saved.
    placed: Mutex<Option<(DisplayId, CallLayout)>>,
    /// The record prompt's size: its content's, once reported (`window_fit`).
    prompt_size: Mutex<(f64, f64)>,
    this: OnceLock<Weak<TauriSurfaces<R>>>,
}

impl<R: Runtime> TauriSurfaces<R> {
    pub fn new(app: AppHandle<R>, storage: PathBuf) -> Arc<Self> {
        let frames = SavedFrames::load(&storage.join("call-window-frames.json"));
        let surfaces = Arc::new(Self {
            app,
            storage,
            core: OnceLock::new(),
            tray: Mutex::new(None),
            menu: Mutex::new(None),
            wanted: Mutex::new(None),
            floating: AtomicBool::new(false),
            hidden: Mutex::new(Vec::new()),
            frames,
            placed: Mutex::new(None),
            prompt_size: Mutex::new(PROMPT),
            this: OnceLock::new(),
        });
        let _ = surfaces.this.set(Arc::downgrade(&surfaces));
        surfaces
    }

    /// The core the menu bar's clicks go to, once it opened.
    /// The core the menu bar's clicks go to, once it opened; it rebuilds the menu every second
    /// for the clock and the countdowns while the core lives.
    pub fn attach(&self, core: &Arc<Core>) {
        let _ = self.core.set(Arc::downgrade(core));
        let core = Arc::downgrade(core);
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-build
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let Some(core) = core.upgrade() else { return };
            core.refresh_tray();
        });
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-build
    }

    /// Shows the latest model `set_tray` was given; on the main thread only.
    fn show_tray(&self) {
        let Some(model) = self.wanted.lock().unwrap_or_else(|e| e.into_inner()).take() else {
            return;
        };
        let model = &model;
        let mut shown = self.menu.lock().unwrap_or_else(|e| e.into_inner());
        let glyph = (model.glyph, model.hidden);
        let new_glyph = shown.as_ref().map(|(m, _)| (m.glyph, m.hidden)) != Some(glyph);
        let menu = match shown.take() {
            Some((old, menu)) if same_shape(&old, model) => {
                let _ = Self::update_menu(&menu, model);
                Some(menu)
            }
            _ => None,
        };
        let rebuilt = menu.is_none();
        let Some(menu) = menu.or_else(|| self.menu(model).ok()) else {
            return;
        };
        let mut tray = self.tray.lock().unwrap_or_else(|e| e.into_inner());
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-user-open
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-user-check
        if tray.is_none() {
            let this = self.this.get().cloned().unwrap_or_default();
            let builder = TrayIconBuilder::with_id("noter")
                .icon(glyph_image(model.glyph, model.hidden))
                .icon_as_template(true)
                .on_menu_event(move |_, event| {
                    // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-user-item
                    // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-user-start
                    let surfaces = this.upgrade();
                    if let (Some(surfaces), Some(action)) =
                        (surfaces, action_of(event.id().as_ref()))
                    {
                        surfaces.menu_clicked(action);
                    }
                    // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-user-start
                    // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-user-item
                });
            *tray = builder.build(&self.app).ok();
        }
        // @cpt-end:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-user-check
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-user-open
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-core-show
        if let Some(tray) = tray.as_ref() {
            if rebuilt {
                let _ = tray.set_menu(Some(menu.clone()));
            }
            if new_glyph {
                let _ = tray.set_icon_with_as_template(Some(glyph_image(glyph.0, glyph.1)), true);
            }
            let _ = tray.set_title(model.title.as_deref());
            let _ = tray.set_tooltip(Some(model.label.as_str()));
            Self::set_accessibility_label(tray, &model.label);
        }
        // @cpt-end:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-core-show
        let floating = model
            .item(TrayAction::UseFloatingPanel)
            .and_then(|i| i.checked);
        self.floating
            .store(floating == Some(true), Ordering::Relaxed);
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-return-check
        *shown = Some((model.clone(), menu));
        // @cpt-end:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-return-check
    }

    fn window(&self, label: WindowLabel) -> Option<WebviewWindow<R>> {
        window(&self.app, label)
    }

    /// The call display's frame, or the main display's.
    fn frame(&self, chosen: Option<&DisplayId>) -> Option<(DisplayId, Frame)> {
        let displays = noter_native::environment(&self.storage).displays;
        frame_of(chosen, &displays, noter_native::display_frame)
    }

    /// The record prompt in the main display's top-right corner, at its size.
    fn place_prompt(&self, prompt: &WebviewWindow<R>) {
        let (w, h) = *self.prompt_size.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, screen)) = self.frame(None) {
            let x = screen.x + screen.width - w - MARGIN;
            Self::place(prompt, (x, screen.y + MENU_BAR + MARGIN, w, h));
        }
    }

    fn place(window: &WebviewWindow<R>, (x, y, w, h): (f64, f64, f64, f64)) {
        let _ = window.set_size(LogicalSize::new(w, h));
        let _ = window.set_position(LogicalPosition::new(x, y));
    }

    fn place_call(&self, placement: &Placement, collapsed: bool) {
        let Some(window) = self.window(WindowLabel::CallScreen) else {
            return;
        };
        let Some((display, visible)) = self.frame(placement.display_id.as_ref()) else {
            return;
        };
        let layout = placement.layout;
        // @cpt-begin:cpt-noter-algo-core-native-surfaces-placement:p1:inst-frame
        // The strip keeps its fixed size; an open call window comes back where the user left it.
        let frame = match self.frames.get(&display, layout).filter(|_| !collapsed) {
            Some(saved) => clamp_frame(saved, &visible),
            None => call_frame(layout, collapsed, &visible),
        };
        *self.placed.lock().unwrap_or_else(|e| e.into_inner()) =
            (!collapsed).then_some((display, layout));
        // @cpt-end:cpt-noter-algo-core-native-surfaces-placement:p1:inst-frame
        Self::place(&window, frame);
    }

    /// On quit: the frames the user left are written.
    pub fn save_frames(&self) {
        self.frames.save();
    }

    /// The user moved or resized the call window: its frame is saved for that display and layout.
    // @cpt-begin:cpt-noter-algo-core-native-surfaces-placement:p1:inst-frame
    pub fn call_window_changed(&self, window: &tauri::Window<R>) {
        let Some((display, layout)) = self
            .placed
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        else {
            return;
        };
        let scale = window.scale_factor().unwrap_or(1.0);
        let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) else {
            return;
        };
        let (pos, size) = (pos.to_logical::<f64>(scale), size.to_logical::<f64>(scale));
        self.frames
            .remember(&display, layout, (pos.x, pos.y, size.width, size.height));
    }
    // @cpt-end:cpt-noter-algo-core-native-surfaces-placement:p1:inst-frame

    /// A menu bar click, run as the menu bar surface.
    // @cpt-flow:cpt-noter-flow-core-native-surfaces-menu-bar:p1
    // @cpt-dod:cpt-noter-dod-core-native-surfaces-menu-bar:p1
    fn menu_clicked(&self, action: TrayAction) {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-menu-bar:p1:inst-menu-click
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-quit
        if action == TrayAction::QuitNoter {
            quit(&self.app);
            return;
        }
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-quit
        // Not the menu lock: this runs on the main thread, which `set_tray` waits for under it.
        let checked =
            action == TrayAction::UseFloatingPanel && self.floating.load(Ordering::Relaxed);
        let Some(core) = self.core.get().and_then(Weak::upgrade) else {
            return;
        };
        tauri::async_runtime::spawn(async move {
            let ctx = CommandCtx {
                caller: Caller::Native {
                    surface: NativeSurface::MenuBar,
                },
            };
            let Ok(snap) = core.app_snapshot(&ctx, NoArgs {}).await else {
                return;
            };
            let Some((name, args)) = tray_command(action, checked, &snap) else {
                return;
            };
            // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-open-call
            // Open Call Screen ends hidden mode before it shows the window.
            if action == TrayAction::OpenCallScreen && snap.presenting.hidden {
                let show = json!({ "hidden": false });
                let unhide = "app_set_hidden_for_presenting";
                let _ = dispatch_json(core.as_ref(), &ctx, unhide, show, None).await;
            }
            // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-open-call
            // A refusal (the call ended meanwhile) is an answer, not a failure: the menu
            // shows the item disabled at the next update.
            if dispatch_json(core.as_ref(), &ctx, name, args, None)
                .await
                .is_ok()
            {
                crate::e2e_log::record(name);
            }
        });
        // @cpt-end:cpt-noter-flow-core-native-surfaces-menu-bar:p1:inst-menu-click
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-menu-bar:p1:inst-return-menu
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-return-control
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-return-start
        // Every item runs one command as the menu bar and opens no dialog but the quit alert.
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-return-start
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-return-control
    }
    // @cpt-end:cpt-noter-flow-core-native-surfaces-menu-bar:p1:inst-return-menu

    fn menu(&self, tray: &TrayModel) -> tauri::Result<Menu<R>> {
        let app = &self.app;
        let menu = Menu::new(app)?;
        for entry in &tray.entries {
            match entry {
                TrayEntry::Line(line) => {
                    menu.append(&MenuItem::new(app, line, false, None::<&str>)?)?;
                }
                TrayEntry::Separator => menu.append(&PredefinedMenuItem::separator(app)?)?,
                TrayEntry::Item(item) => {
                    let id = format!("{:?}", item.action);
                    let (label, key) = (&item.label, item.key.as_deref());
                    match item.checked {
                        Some(checked) => menu.append(&CheckMenuItem::with_id(
                            app,
                            id,
                            label,
                            item.enabled,
                            checked,
                            key,
                        )?)?,
                        None => {
                            menu.append(&MenuItem::with_id(app, id, label, item.enabled, key)?)?
                        }
                    }
                }
            }
        }
        Ok(menu)
    }

    /// The new texts, states and checkmarks into the menu on screen, item by item.
    fn update_menu(menu: &Menu<R>, tray: &TrayModel) -> tauri::Result<()> {
        for (entry, kind) in tray.entries.iter().zip(menu.items()?) {
            match (entry, kind) {
                (TrayEntry::Line(line), MenuItemKind::MenuItem(i)) => i.set_text(line)?,
                (TrayEntry::Item(item), MenuItemKind::MenuItem(i)) => {
                    i.set_text(&item.label)?;
                    i.set_enabled(item.enabled)?;
                }
                (TrayEntry::Item(item), MenuItemKind::Check(i)) => {
                    i.set_text(&item.label)?;
                    i.set_enabled(item.enabled)?;
                    i.set_checked(item.checked == Some(true))?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// The VoiceOver label of the status item's button (tray-icon sets only its tooltip).
    fn set_accessibility_label(tray: &TrayIcon<R>, label: &str) {
        let label = label.to_string();
        let _ = tray.with_inner_tray_icon(move |inner| {
            if let Some(item) = inner.ns_status_item() {
                let label = objc2_foundation::NSString::from_str(&label);
                // SAFETY: `button` and `setAccessibilityLabel:` are NSStatusItem and NSView API
                // taking and returning objects; this runs on the main thread (the tray's).
                unsafe {
                    let button: Option<objc2::rc::Retained<objc2::runtime::AnyObject>> =
                        objc2::msg_send![&*item, button];
                    if let Some(button) = button {
                        let _: () = objc2::msg_send![&*button, setAccessibilityLabel: &*label];
                    }
                }
            }
        });
    }
}

impl<R: Runtime> Surfaces for TauriSurfaces<R> {
    // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-core-detect
    fn show_record_prompt(&self) {
        let Some(prompt) = self.window(WindowLabel::RecordPrompt) else {
            return;
        };
        self.place_prompt(&prompt);
        show(&prompt, false);
    }
    // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-core-detect

    // @cpt-begin:cpt-noter-algo-core-native-surfaces-panels:p1:inst-fit
    fn fit_record_prompt(&self, width: u32, height: u32) {
        *self.prompt_size.lock().unwrap_or_else(|e| e.into_inner()) =
            (f64::from(width), f64::from(height));
        if let Some(prompt) = self
            .app
            .get_webview_window(WindowLabel::RecordPrompt.as_str())
        {
            self.place_prompt(&prompt);
        }
    }
    // @cpt-end:cpt-noter-algo-core-native-surfaces-panels:p1:inst-fit

    fn close_record_prompt(&self) {
        if let Some(prompt) = self
            .app
            .get_webview_window(WindowLabel::RecordPrompt.as_str())
        {
            let _ = prompt.hide();
        }
    }

    fn show_call_window(&self, placement: &Placement) {
        self.place_call(placement, false);
        if let Some(window) = self.window(WindowLabel::CallScreen) {
            show(&window, false);
        }
    }

    fn make_call_window_key(&self) {
        if let Some(window) = self.window(WindowLabel::CallScreen) {
            show(&window, true);
        }
    }

    fn place_call_window(&self, placement: &Placement, collapsed: bool) {
        self.place_call(placement, collapsed);
    }

    fn hide_call_window(&self) {
        self.frames.save();
        if let Some(window) = self
            .app
            .get_webview_window(WindowLabel::CallScreen.as_str())
        {
            let _ = window.hide();
        }
    }

    // @cpt-dod:cpt-noter-dod-core-native-surfaces-presenting:p1
    // @cpt-begin:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-hide-restore
    fn hide_all(&self) {
        self.frames.save();
        let mut hidden = self.hidden.lock().unwrap_or_else(|e| e.into_inner());
        for (label, window) in self.app.webview_windows() {
            let Some(label) = crate::window_label(&label) else {
                continue;
            };
            if window.is_visible().unwrap_or(false) && window.hide().is_ok() {
                hidden.push(label);
            }
        }
    }

    fn restore_all(&self) {
        let hidden = std::mem::take(&mut *self.hidden.lock().unwrap_or_else(|e| e.into_inner()));
        for label in hidden {
            if let Some(window) = self.app.get_webview_window(label.as_str()) {
                show(&window, false);
            }
        }
    }
    // @cpt-end:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-hide-restore

    fn set_tray(&self, model: &TrayModel) {
        // Only the main thread touches the tray: Tauri's menu calls from another thread wait for
        // it, a deadlock while it waits for `menu` (the launch hooks seed the core on it). It shows
        // the latest model, never an older update queued behind a newer one.
        *self.wanted.lock().unwrap_or_else(|e| e.into_inner()) = Some(model.clone());
        let Some(this) = self.this.get().and_then(Weak::upgrade) else {
            return;
        };
        let _ = self.app.run_on_main_thread(move || this.show_tray());
    }

    // @cpt-dod:cpt-noter-dod-core-native-surfaces-navigation:p2
    fn announce(&self, text: &str, politeness: Politeness) {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-announce
        noter_native::announce(text, politeness);
        // @cpt-end:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-announce
    }

    fn open_external(&self, target: &ExternalTarget) {
        let args: Vec<String> = match target {
            ExternalTarget::Url { url } => vec![url.clone()],
            ExternalTarget::SystemSettings { permission } => vec![settings_url(*permission).into()],
            ExternalTarget::RevealInFinder { path } => vec!["-R".into(), path.clone()],
            // Documents belong to the sources feature (M3).
            _ => return,
        };
        let _ = std::process::Command::new("open").args(args).spawn();
    }

    fn show_window(&self, window: WindowLabel) {
        if let Some(w) = self.window(window) {
            show(&w, true);
        }
    }

    fn call_surface_visible(&self) -> bool {
        self.app
            .get_webview_window(WindowLabel::CallScreen.as_str())
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false)
    }

    fn post_notification(&self, notification: &Notification) {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-post
        if let Err(e) = noter_native::post_notification(&posted(notification)) {
            eprintln!("noter: a notification was not posted: {e}");
        }
        // @cpt-end:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-post
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-return-notify
        // Delivery is fire-and-forget: a click comes back through `notification_clicked`.
        // @cpt-end:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-return-notify
    }
}

/// The windows the Screen Share Test reports, with the surface each one is.
const SHARED: [(WindowLabel, NoterSurface); 4] = [
    (WindowLabel::CallScreen, NoterSurface::CallWindow),
    (WindowLabel::RecordPrompt, NoterSurface::RecordPrompt),
    (WindowLabel::Main, NoterSurface::MainWindow),
    (WindowLabel::Settings, NoterSurface::SettingsWindow),
];

// The windows' AppKit side on the main thread; `MacOps` calls these from a blocking thread.
impl<R: Runtime> Windows for TauriSurfaces<R> {
    fn ids(&self) -> Vec<(NoterSurface, u32)> {
        let app = self.app.clone();
        on_main(&self.app, move || {
            SHARED
                .iter()
                .filter_map(|&(label, surface)| {
                    // Only windows that exist: `window()` would open a closed one.
                    let ns = app.get_webview_window(label.as_str())?.ns_window().ok()?;
                    // SAFETY: Tauri's live NSWindow, read on the main thread.
                    let number = unsafe { &*(ns as *const objc2_app_kit::NSWindow) }.windowNumber();
                    // No window device yet (never shown): nothing a share could see.
                    Some((surface, u32::try_from(number).ok().filter(|&n| n > 0)?))
                })
                .collect()
        })
        .unwrap_or_default()
    }

    fn focused(&self) -> Option<ParentWindow> {
        let app = self.app.clone();
        on_main(&self.app, move || {
            let window = app
                .webview_windows()
                .into_values()
                .find(|w| w.is_focused().unwrap_or(false))?;
            // SAFETY: a live NSWindow; AppKit ends a sheet with the window it is attached to.
            unsafe { ParentWindow::from_raw(window.ns_window().ok()?) }
        })
        .flatten()
    }
}
