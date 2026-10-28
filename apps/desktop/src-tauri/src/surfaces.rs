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
    Core, Notification, NotificationKind, Placement, Surfaces, TrayAction, TrayGlyph, TrayModel,
};
use noter_native::{Frame, PostedNotification};
use noter_protocol::ipc::{dispatch_json, event_names, Caller, CommandCtx, CoreApi, NativeSurface};
use noter_protocol::model::{
    AppSnapshot, CallLayout, CallPageTab, DegradedState, DisplayInfo, ExternalTarget, NavTarget,
    Politeness, WindowLabel,
};
use noter_protocol::{DisplayId, NoArgs, PermissionKind, PrivacyMode};
use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, WebviewUrl, WebviewWindow,
};
use tauri_nspanel::{tauri_panel, ManagerExt, StyleMask, WebviewPanelManager, WebviewWindowExt};

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

/// Floating call panel and its collapsed strip, record prompt (points).
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
/// when the item needs a call that is gone, or is the host's own (Open Noter).
pub fn tray_command(action: TrayAction, snap: &AppSnapshot) -> Option<(&'static str, Value)> {
    let call = || snap.capture.call_id.clone();
    Some(match action {
        TrayAction::StartRecording => {
            let detection_id = snap.detection.detection.as_ref().map(|d| d.id.clone());
            let args =
                json!({ "source": "menu_bar", "sensitive": false, "detection_id": detection_id });
            ("capture_start", args)
        }
        TrayAction::StopRecording => ("capture_stop", json!({ "call_id": call()? })),
        TrayAction::Pause => (
            "capture_set_paused",
            json!({ "call_id": call()?, "paused": true }),
        ),
        TrayAction::Resume => (
            "capture_set_paused",
            json!({ "call_id": call()?, "paused": false }),
        ),
        TrayAction::MarkMoment => ("capture_mark_moment", json!({ "call_id": call()? })),
        TrayAction::OpenCallScreen => ("window_show_call", json!({})),
        TrayAction::HideForPresenting => {
            ("app_set_hidden_for_presenting", json!({ "hidden": true }))
        }
        TrayAction::ShowAfterPresenting => {
            ("app_set_hidden_for_presenting", json!({ "hidden": false }))
        }
        TrayAction::StartAsNewCall => (
            "capture_answer_new_meeting",
            json!({ "call_id": call()?, "choice": "start_as_new_call" }),
        ),
        TrayAction::OpenNoter => return None,
    })
}

pub fn tray_label(action: TrayAction) -> &'static str {
    match action {
        TrayAction::StartRecording => "Start Recording",
        TrayAction::StopRecording => "Stop Recording",
        TrayAction::Pause => "Pause",
        TrayAction::Resume => "Resume",
        TrayAction::MarkMoment => "Mark Moment",
        TrayAction::OpenCallScreen => "Open Call Screen",
        TrayAction::HideForPresenting => "Hide for Presenting",
        TrayAction::ShowAfterPresenting => "Show Noter",
        TrayAction::StartAsNewCall => "Start as New Call",
        TrayAction::OpenNoter => "Open Noter",
    }
}

const ACTIONS: [TrayAction; 10] = [
    TrayAction::StartRecording,
    TrayAction::StopRecording,
    TrayAction::Pause,
    TrayAction::Resume,
    TrayAction::MarkMoment,
    TrayAction::OpenCallScreen,
    TrayAction::HideForPresenting,
    TrayAction::ShowAfterPresenting,
    TrayAction::StartAsNewCall,
    TrayAction::OpenNoter,
];

/// A menu item's id is its action's name.
pub fn action_of(id: &str) -> Option<TrayAction> {
    ACTIONS.into_iter().find(|a| format!("{a:?}") == id)
}

/// The menu bar title next to the icon.
// shortcut: the state as text beside the app icon; template glyph images come with the design
// assets.
pub fn tray_title(glyph: TrayGlyph) -> &'static str {
    match glyph {
        TrayGlyph::Idle => "",
        TrayGlyph::Recording => "●",
        TrayGlyph::Paused => "❙❙",
        TrayGlyph::CopilotMuted => "◌",
    }
}

fn privacy_line(mode: PrivacyMode) -> &'static str {
    match mode {
        PrivacyMode::CloudAllowed => "Cloud allowed",
        PrivacyMode::CloudRedacted => "Cloud, redacted",
        PrivacyMode::LocalOnly => "Local only",
    }
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

/// What a notification says and where its click goes (NT-3 opens the call's transcript).
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
        NotificationKind::SummaryReady => ("Summary ready", "", CallPageTab::Summary),
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

/// A clicked notification: the main window comes forward and is asked to navigate.
// @cpt-flow:cpt-noter-flow-core-native-surfaces-notifications:p1
// @cpt-dod:cpt-noter-dod-core-native-surfaces-notifications:p1
// @cpt-begin:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-click
pub fn notification_clicked<R: Runtime>(app: &AppHandle<R>, target: NavTarget) {
    // @cpt-begin:cpt-noter-flow-ui-notifications-receive:p1:inst-user-click
    // @cpt-begin:cpt-noter-state-ui-notifications-item:p1:inst-sent-opened
    if let Some(main) = window(app, WindowLabel::Main) {
        let _ = main.show();
        let _ = main.set_focus();
    }
    // @cpt-end:cpt-noter-state-ui-notifications-item:p1:inst-sent-opened
    // @cpt-end:cpt-noter-flow-ui-notifications-receive:p1:inst-user-click
    // @cpt-begin:cpt-noter-flow-ui-notifications-receive:p1:inst-match-click
    let _ = app.emit(event_names::NAV_REQUEST, target);
    // @cpt-end:cpt-noter-flow-ui-notifications-receive:p1:inst-match-click
}
// @cpt-end:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-click

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
    /// The windows hidden for presenting, shown again on restore.
    hidden: Mutex<Vec<WindowLabel>>,
    frames: SavedFrames,
    /// The display and layout the call window was last placed on, uncollapsed: where a move or
    /// resize by the user is saved.
    placed: Mutex<Option<(DisplayId, CallLayout)>>,
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
            hidden: Mutex::new(Vec::new()),
            frames,
            placed: Mutex::new(None),
            this: OnceLock::new(),
        });
        let _ = surfaces.this.set(Arc::downgrade(&surfaces));
        surfaces
    }

    /// The core the menu bar's clicks go to, once it opened.
    pub fn attach(&self, core: &Arc<Core>) {
        let _ = self.core.set(Arc::downgrade(core));
    }

    fn window(&self, label: WindowLabel) -> Option<WebviewWindow<R>> {
        window(&self.app, label)
    }

    /// The call display's frame, or the main display's.
    fn frame(&self, chosen: Option<&DisplayId>) -> Option<(DisplayId, Frame)> {
        let displays = noter_native::environment(&self.storage).displays;
        frame_of(chosen, &displays, noter_native::display_frame)
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
        if action == TrayAction::OpenNoter {
            self.show_window(WindowLabel::Main);
            return;
        }
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
            let Some((name, args)) = tray_command(action, &snap) else {
                return;
            };
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
    }
    // @cpt-end:cpt-noter-flow-core-native-surfaces-menu-bar:p1:inst-return-menu

    fn menu(&self, tray: &TrayModel) -> tauri::Result<Menu<R>> {
        let app = &self.app;
        let status = match &tray.call_title {
            Some(title) => format!("{} · {title}", tray.status),
            None => tray.status.clone(),
        };
        let menu = Menu::new(app)?;
        menu.append(&MenuItem::new(app, status, false, None::<&str>)?)?;
        menu.append(&MenuItem::new(
            app,
            privacy_line(tray.privacy),
            false,
            None::<&str>,
        )?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        for item in &tray.items {
            let id = format!("{:?}", item.action);
            let label = tray_label(item.action);
            menu.append(&MenuItem::with_id(
                app,
                id,
                label,
                item.enabled,
                None::<&str>,
            )?)?;
        }
        Ok(menu)
    }
}

impl<R: Runtime> Surfaces for TauriSurfaces<R> {
    // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-core-detect
    fn show_record_prompt(&self) {
        let Some(prompt) = self.window(WindowLabel::RecordPrompt) else {
            return;
        };
        if let Some((_, screen)) = self.frame(None) {
            let x = screen.x + screen.width - PROMPT.0 - MARGIN;
            Self::place(
                &prompt,
                (x, screen.y + MENU_BAR + MARGIN, PROMPT.0, PROMPT.1),
            );
        }
        show(&prompt, false);
    }
    // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-core-detect

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
        let Ok(menu) = self.menu(model) else {
            return;
        };
        let mut tray = self.tray.lock().unwrap_or_else(|e| e.into_inner());
        if tray.is_none() {
            let this = self.this.get().cloned().unwrap_or_default();
            let mut builder = TrayIconBuilder::with_id("noter")
                .icon_as_template(true)
                .on_menu_event(move |_, event| {
                    let surfaces = this.upgrade();
                    if let (Some(surfaces), Some(action)) =
                        (surfaces, action_of(event.id().as_ref()))
                    {
                        surfaces.menu_clicked(action);
                    }
                });
            if let Some(icon) = self.app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            *tray = builder.build(&self.app).ok();
        }
        if let Some(tray) = tray.as_ref() {
            let _ = tray.set_menu(Some(menu));
            let _ = tray.set_title(Some(tray_title(model.glyph)));
            let _ = tray.set_tooltip(Some(model.status.as_str()));
        }
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
