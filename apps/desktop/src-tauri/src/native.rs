//! The core's macOS services over `noter-native`: permissions, the environment and the login
//! item (DESIGN-core › Native surfaces).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{
    BoxFuture, ClipboardText, EnvironmentReading, LaunchRequest, NativeOps, NativeServices,
    SaveKind,
};
use noter_native::{PanelRequest, ParentWindow};
use noter_protocol::model::{
    CalendarEventRef, HandoffTarget, LaunchPath, LaunchPlan, NoterSurface, ShareTestArgs,
    ShareTestResult,
};
use noter_protocol::{CoreError, ErrorCode, PermissionKind, PermissionState, TimestampMs};
use tauri::{AppHandle, Runtime};

/// What `MacOps` needs of the app's windows, read on the main thread: each surface's
/// `CGWindowID` for the Screen Share Test, and the focused window a panel attaches to.
pub trait Windows: Send + Sync {
    fn ids(&self) -> Vec<(NoterSurface, u32)>;
    fn focused(&self) -> Option<ParentWindow>;
}

/// Runs `f` on the main thread and waits for its answer. From a blocking thread only: on a tokio
/// worker the main thread may be waiting on the runtime (#233). None once the event loop is gone.
pub(crate) fn on_main<R: Runtime, T: Send + 'static>(
    app: &AppHandle<R>,
    f: impl FnOnce() -> T + Send + 'static,
) -> Option<T> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .ok()?;
    rx.recv().ok()
}

/// Runs `f` on a blocking thread, off the async runtime: panels and the Automation and Screen
/// Recording prompts wait on the user, and AppKit work reaches the main thread from there.
async fn off_runtime<T: Send + 'static>(
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, ErrorCode> {
    // @cpt-begin:cpt-noter-flow-core-native-services-operation:p1:inst-op-dispatch
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| ErrorCode::Internal)
    // @cpt-end:cpt-noter-flow-core-native-services-operation:p1:inst-op-dispatch
}

/// The native asks of the commands (TL-15) over noter-native: panels, the clipboard, launches
/// and the Screen Share Test. The panel and the pasteboard are seams a test stands in for.
// @cpt-flow:cpt-noter-flow-core-native-services-operation:p1
// @cpt-dod:cpt-noter-dod-core-native-services-mechanisms:p1
pub struct MacOps {
    windows: Arc<dyn Windows>,
    panel: fn(&PanelRequest) -> Option<PathBuf>,
    pasteboard: fn(&noter_native::ClipboardText) -> Result<(), String>,
}

impl MacOps {
    pub fn new(windows: Arc<dyn Windows>) -> Self {
        Self::with(
            windows,
            noter_native::save_panel,
            noter_native::clipboard_write,
        )
    }

    /// With the panel and the pasteboard given (tests).
    pub fn with(
        windows: Arc<dyn Windows>,
        panel: fn(&PanelRequest) -> Option<PathBuf>,
        pasteboard: fn(&noter_native::ClipboardText) -> Result<(), String>,
    ) -> Self {
        Self {
            windows,
            panel,
            pasteboard,
        }
    }
}

impl NativeOps for MacOps {
    /// A sheet on the focused window (the one that asked), else a free panel.
    fn save_panel<'a>(&'a self, name: &'a str, kind: SaveKind) -> BoxFuture<'a, Option<PathBuf>> {
        let windows = self.windows.clone();
        let panel = self.panel;
        let extensions = match kind {
            SaveKind::Markdown => vec!["md".to_string()],
            SaveKind::Json => vec!["json".to_string()],
            SaveKind::Folder => vec![],
        };
        let req = PanelRequest {
            suggested_name: name.to_string(),
            extensions,
            folder: kind == SaveKind::Folder,
            parent: None,
        };
        Box::pin(async move {
            off_runtime(move || {
                let parent = windows.focused();
                panel(&PanelRequest { parent, ..req })
            })
            .await
            .ok()
            .flatten()
        })
    }

    fn launch_plan(&self, target: HandoffTarget) -> LaunchPlan {
        noter_native::launch_plan(target)
    }

    /// May wait on the user's Automation answer.
    fn launch<'a>(
        &'a self,
        path: LaunchPath,
        req: &'a LaunchRequest,
    ) -> BoxFuture<'a, Result<(), ErrorCode>> {
        let req = noter_native::LaunchRequest {
            target: req.target,
            cwd: req.cwd.clone(),
            prompt_file: req.prompt_file.clone(),
        };
        Box::pin(async move {
            off_runtime(move || noter_native::launch(path, &req))
                .await?
                .map(drop)
        })
    }

    fn clipboard_write<'a>(&'a self, text: &'a ClipboardText) -> BoxFuture<'a, Result<(), String>> {
        let text = noter_native::ClipboardText {
            plain: text.plain.clone(),
            markdown: text.markdown.clone(),
            html: text.html.clone(),
        };
        // NSPasteboard takes writes from any thread.
        let written = (self.pasteboard)(&text);
        Box::pin(async move { written })
    }

    /// The window server's view of the windows, then the probe; may wait on the Screen
    /// Recording prompt.
    fn share_test<'a>(
        &'a self,
        args: &'a ShareTestArgs,
        call_live: bool,
        menu_bar_title_shown: bool,
        now: TimestampMs,
    ) -> BoxFuture<'a, Result<ShareTestResult, ErrorCode>> {
        let windows = self.windows.clone();
        let args = args.clone();
        Box::pin(async move {
            off_runtime(move || {
                noter_native::share_test(
                    &args,
                    call_live,
                    &windows.ids(),
                    menu_bar_title_shown,
                    now,
                )
            })
            .await
        })
    }
}

/// The Mac; `storage` is the folder whose volume's free space counts.
pub struct Mac {
    storage: PathBuf,
    watch: Mutex<Option<noter_native::Watch>>,
}

impl Mac {
    pub fn new(storage: &Path) -> Self {
        Self {
            storage: storage.to_path_buf(),
            watch: Mutex::new(None),
        }
    }
}

fn reading(r: noter_native::Reading) -> EnvironmentReading {
    EnvironmentReading {
        displays: r.displays,
        output_device: r.output_device,
        output_route: r.output_route,
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-read-auth
        notifications: r.notifications,
        // @cpt-end:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-read-auth
        online: r.online,
        disk_free_mb: r.disk_free_mb,
    }
}

// @cpt-dod:cpt-noter-dod-core-first-run-permissions:p1
impl NativeServices for Mac {
    fn permission(&self, kind: PermissionKind) -> PermissionState {
        noter_native::permission(kind)
    }

    fn request_permission(&self, kind: PermissionKind) -> BoxFuture<'_, PermissionState> {
        // The prompt blocks until macOS answers: off the async runtime.
        Box::pin(async move {
            tauri::async_runtime::spawn_blocking(move || noter_native::request_permission(kind))
                .await
                .unwrap_or(PermissionState::NotAsked)
        })
    }

    fn environment(&self) -> EnvironmentReading {
        reading(noter_native::environment(&self.storage))
    }

    fn on_change(&self, on_change: Box<dyn Fn(EnvironmentReading) + Send + Sync>) {
        let watch = noter_native::watch(self.storage.clone(), Duration::from_secs(2), move |r| {
            on_change(reading(r))
        });
        *self.watch.lock().unwrap_or_else(|e| e.into_inner()) = Some(watch);
    }

    /// The calendar event around `at` (EventKit through noter-native; never asks for access).
    fn calendar_event_near(&self, at: TimestampMs) -> Option<CalendarEventRef> {
        // @cpt-begin:cpt-noter-algo-core-native-surfaces-calendar:p1:inst-read-fail
        // EventKit reports no error: a read that throws is the failure, logged, and no event.
        std::panic::catch_unwind(|| noter_native::calendar_event_near(at.0)).unwrap_or_else(|_| {
            eprintln!("noter: the calendar read failed");
            None
        })
        // @cpt-end:cpt-noter-algo-core-native-surfaces-calendar:p1:inst-read-fail
    }

    // @cpt-dod:cpt-noter-dod-core-first-run-login-update:p2
    fn set_login_item(&self, on: bool) -> Result<(), CoreError> {
        noter_native::set_login_item(on)
            .map(drop)
            .map_err(|e| CoreError::new(ErrorCode::Internal, e))
    }
}
