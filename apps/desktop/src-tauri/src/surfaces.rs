//! The core's windows, panels and menu bar on the Mac (DESIGN-core › Native surfaces, TL-2): the
//! host carries out what the core decides through `noter_core::Surfaces`, and turns menu bar
//! clicks into core commands as `Caller::Native { surface: menu_bar }`.
//!
//! The record prompt and the call window are non-activating NSPanels (tauri-nspanel, pinned in
//! Cargo.toml): they take clicks without bringing Noter forward over the call app.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use noter_core::{Core, Notification, Placement, Surfaces, TrayModel};
use noter_native::ParentWindow;
use noter_protocol::ipc::{dispatch_json, event_names, Caller, CommandCtx, CoreApi, NativeSurface};
use noter_protocol::model::{
    AppSnapshot, CallLayout, CapturePhase, ExternalTarget, NoterSurface, Politeness, SettingsPane,
    WindowLabel,
};
use noter_protocol::{CoreError, DisplayId, NoArgs};
use serde_json::{json, Value};
use tauri::menu::Menu;
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, WebviewUrl, WebviewWindow,
};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, StyleMask, WebviewPanelManager, WebviewWindowExt,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};

use crate::native::{on_main, Windows};

mod frames;
mod notifications;
mod quit;
mod tray;

pub use frames::*;
pub use notifications::*;
pub use quit::*;
pub use tray::*;

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

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

/// The core, once it opened.
fn core_of<R: Runtime>(app: &AppHandle<R>) -> Option<Arc<Core>> {
    app.try_state::<crate::Booted>()?.0.clone().ok()
}

fn native(surface: NativeSurface) -> CommandCtx {
    CommandCtx {
        caller: Caller::Native { surface },
    }
}

async fn dispatch_and_record(
    core: &Core,
    ctx: &CommandCtx,
    name: &str,
    args: Value,
) -> Result<Value, CoreError> {
    let result = dispatch_json(core, ctx, name, args, None).await;
    if result.is_ok() {
        crate::e2e_log::record(name);
    }
    result
}

/// The windows that are non-activating panels; the others are ordinary windows.
// @cpt-algo:cpt-noter-algo-core-native-surfaces-panels:p1
// @cpt-dod:cpt-noter-dod-core-native-surfaces-panels:p1
pub fn is_panel(label: WindowLabel) -> bool {
    matches!(label, WindowLabel::CallScreen | WindowLabel::RecordPrompt)
}

/// The order Show Noter brings the windows back in: the ordinary windows, then the panels.
fn presenting_order() -> Vec<WindowLabel> {
    let (panels, windows): (Vec<_>, Vec<_>) =
        WindowLabel::ALL.into_iter().partition(|l| is_panel(*l));
    [windows, panels].concat()
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
            panel.set_collection_behavior(
                CollectionBehavior::new()
                    .can_join_all_spaces()
                    .full_screen_auxiliary()
                    .stationary()
                    .into(),
            );
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
    let builder = if is_panel(label) {
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
    // Without a size AppKit opens 800×600 pixels: 400×300 pt on Retina, too small for Settings.
    // @cpt-topology:cpt-noter-topology-ui-windows:p1
    let builder = match label {
        WindowLabel::Main => builder
            .inner_size(1280.0, 820.0)
            .min_inner_size(900.0, 600.0),
        WindowLabel::Settings => builder
            .inner_size(820.0, 620.0)
            .min_inner_size(700.0, 480.0)
            .center(),
        // Fixed width; the height may grow to 640 for German text.
        WindowLabel::FirstRun => builder
            .inner_size(760.0, 560.0)
            .min_inner_size(760.0, 560.0)
            .max_inner_size(760.0, 640.0)
            .center(),
        _ => builder,
    };
    let window = builder.build().ok()?;
    if let Some(watch) = app.try_state::<crate::webview_watch::Watch>() {
        crate::webview_watch::lock(&watch).created(label.as_str(), std::time::Instant::now());
    }
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
    prompt_call_display: Mutex<Option<DisplayId>>,
    this: OnceLock<Weak<TauriSurfaces<R>>>,
}

impl<R: Runtime> TauriSurfaces<R> {
    pub fn new(app: AppHandle<R>, storage: PathBuf) -> Arc<Self> {
        let frame_store = {
            #[cfg(all(debug_assertions, feature = "test-hooks"))]
            {
                std::env::var_os("NOTER_TEST_FRAME_STORE")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| storage.join("call-window-frames.json"))
            }
            #[cfg(not(all(debug_assertions, feature = "test-hooks")))]
            {
                storage.join("call-window-frames.json")
            }
        };
        let frames = SavedFrames::load(&frame_store);
        let surfaces = Arc::new(Self {
            app,
            core: OnceLock::new(),
            tray: Mutex::new(None),
            menu: Mutex::new(None),
            wanted: Mutex::new(None),
            floating: AtomicBool::new(false),
            hidden: Mutex::new(Vec::new()),
            frames,
            placed: Mutex::new(None),
            prompt_size: Mutex::new(PROMPT),
            prompt_call_display: Mutex::new(None),
            this: OnceLock::new(),
        });
        let _ = surfaces.this.set(Arc::downgrade(&surfaces));
        surfaces
    }

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

    /// The windows Show Noter will bring back, in that order.
    pub fn hidden_for_presenting(&self) -> Vec<WindowLabel> {
        lock(&self.hidden).clone()
    }

    /// A surface the core closed while Noter was hidden must not come back on Show Noter.
    fn forget_hidden(&self, label: WindowLabel) {
        let mut hidden = lock(&self.hidden);
        hidden.retain(|l| *l != label);
    }

    fn window(&self, label: WindowLabel) -> Option<WebviewWindow<R>> {
        window(&self.app, label)
    }


}

impl<R: Runtime> Surfaces for TauriSurfaces<R> {
    fn fit_record_prompt(&self, width: u32, height: u32) {
        self.fit_record_prompt_impl(width, height);
    }

    fn show_record_prompt(&self, placement: &Placement) {
        self.show_record_prompt_impl(placement);
    }

    fn show_call_window(&self, placement: &Placement) {
        self.show_call_window_impl(placement);
    }

    fn place_call_window(&self, placement: &Placement, collapsed: bool) {
        self.place_call_window_impl(placement, collapsed);
    }

    fn close_record_prompt(&self) {
        self.forget_hidden(WindowLabel::RecordPrompt);
        if let Some(prompt) = self
            .app
            .get_webview_window(WindowLabel::RecordPrompt.as_str())
        {
            let _ = prompt.hide();
        }
    }

    fn make_call_window_key(&self) {
        if let Some(window) = self.window(WindowLabel::CallScreen) {
            show(&window, true);
        }
    }

    fn hide_call_window(&self) {
        self.forget_hidden(WindowLabel::CallScreen);
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
        let mut hidden = lock(&self.hidden);
        for label in presenting_order() {
            let Some(window) = self.app.get_webview_window(label.as_str()) else {
                continue;
            };
            if window.is_visible().unwrap_or(false) && window.hide().is_ok() {
                hidden.push(label);
            }
        }
    }

    fn restore_all(&self) {
        let hidden = std::mem::take(&mut *lock(&self.hidden));
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
        *lock(&self.wanted) = Some(model.clone());
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
