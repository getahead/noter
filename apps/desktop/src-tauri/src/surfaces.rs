//! The core's windows, panels and menu bar on the Mac (DESIGN-core › Native surfaces, TL-2): the
//! host carries out what the core decides through `noter_core::Surfaces`, and turns menu bar
//! clicks into core commands as `Caller::Native { surface: menu_bar }`.
//!
//! shortcut: the record prompt and the call window are plain Tauri windows (always on top,
//! content-protected, on every Space, not focused when shown), not non-activating NSPanels; swap
//! in tauri-nspanel once deny.toml allows its git source (owner item NB10).

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
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
) -> Option<Frame> {
    let main = || displays.iter().find(|d| d.is_main).or(displays.first());
    chosen
        .and_then(|id| displays.iter().find(|d| d.id == *id))
        .or_else(main)
        .and_then(|d| frame(&d.id))
}
// @cpt-end:cpt-noter-flow-core-native-surfaces-display-change:p1:inst-read-displays

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

/// A clicked notification: the main window comes forward and is asked to navigate.
// @cpt-flow:cpt-noter-flow-core-native-surfaces-notifications:p1
// @cpt-dod:cpt-noter-dod-core-native-surfaces-notifications:p1
// @cpt-begin:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-click
pub fn notification_clicked<R: Runtime>(app: &AppHandle<R>, target: NavTarget) {
    if let Some(main) = window(app, WindowLabel::Main) {
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = app.emit(event_names::NAV_REQUEST, target);
}
// @cpt-end:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-click

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
    builder.build().ok()
}

/// The host's `Surfaces`: Tauri windows, the tray, `open`.
pub struct TauriSurfaces<R: Runtime> {
    app: AppHandle<R>,
    storage: PathBuf,
    core: OnceLock<Weak<Core>>,
    tray: Mutex<Option<TrayIcon<R>>>,
    /// The windows hidden for presenting, shown again on restore.
    hidden: Mutex<Vec<WindowLabel>>,
    this: OnceLock<Weak<TauriSurfaces<R>>>,
}

impl<R: Runtime> TauriSurfaces<R> {
    pub fn new(app: AppHandle<R>, storage: PathBuf) -> Arc<Self> {
        let surfaces = Arc::new(Self {
            app,
            storage,
            core: OnceLock::new(),
            tray: Mutex::new(None),
            hidden: Mutex::new(Vec::new()),
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
    fn frame(&self, chosen: Option<&DisplayId>) -> Option<Frame> {
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
        if let Some(frame) = self.frame(placement.display_id.as_ref()) {
            Self::place(&window, call_frame(placement.layout, collapsed, &frame));
        }
    }

    /// A menu bar click, run as the menu bar surface.
    // @cpt-flow:cpt-noter-flow-core-native-surfaces-menu-bar:p1
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
            let _ = dispatch_json(core.as_ref(), &ctx, name, args, None).await;
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
    fn show_record_prompt(&self) {
        let Some(prompt) = self.window(WindowLabel::RecordPrompt) else {
            return;
        };
        if let Some(screen) = self.frame(None) {
            let x = screen.x + screen.width - PROMPT.0 - MARGIN;
            Self::place(
                &prompt,
                (x, screen.y + MENU_BAR + MARGIN, PROMPT.0, PROMPT.1),
            );
        }
        let _ = prompt.show();
    }

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
            let _ = window.show();
        }
    }

    fn make_call_window_key(&self) {
        if let Some(window) = self.window(WindowLabel::CallScreen) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    fn place_call_window(&self, placement: &Placement, collapsed: bool) {
        self.place_call(placement, collapsed);
    }

    fn hide_call_window(&self) {
        if let Some(window) = self
            .app
            .get_webview_window(WindowLabel::CallScreen.as_str())
        {
            let _ = window.hide();
        }
    }

    // @cpt-begin:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-hide-restore
    fn hide_all(&self) {
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
                let _ = window.show();
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
            let _ = w.show();
            let _ = w.set_focus();
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
