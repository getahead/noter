//! The core's macOS services over `noter-native`: permissions, the environment and the login
//! item (DESIGN-core › Native surfaces).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use noter_core::{
    BoxFuture, ClipboardText, EnvironmentReading, LaunchRequest, NativeOps, NativeServices,
    SaveKind,
};
use noter_protocol::model::{CalendarEventRef, HandoffTarget, LaunchPath, LaunchPlan};
use noter_protocol::{CoreError, ErrorCode, PermissionKind, PermissionState, TimestampMs};

/// The Mac; `storage` is the folder whose volume's free space counts.
/// The native asks of the commands (TL-15): launches and the clipboard over noter-native.
pub struct MacOps;

impl NativeOps for MacOps {
    // shortcut: every export is cancelled until 2.21 native-services shows the real NSSavePanel.
    fn save_panel<'a>(&'a self, _: &'a str, _: SaveKind) -> BoxFuture<'a, Option<PathBuf>> {
        Box::pin(async { None })
    }

    fn launch_plan(&self, target: HandoffTarget) -> LaunchPlan {
        noter_native::launch_plan(target)
    }

    /// On a blocking thread: macOS may wait on the user's Automation answer.
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
            tauri::async_runtime::spawn_blocking(move || noter_native::launch(path, &req))
                .await
                .map_err(|_| ErrorCode::Internal)?
                .map(drop)
        })
    }

    fn clipboard_write<'a>(&'a self, text: &'a ClipboardText) -> BoxFuture<'a, Result<(), String>> {
        let text = noter_native::ClipboardText {
            plain: text.plain.clone(),
            markdown: text.markdown.clone(),
            html: text.html.clone(),
        };
        Box::pin(async move { noter_native::clipboard_write(&text) })
    }
}

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
