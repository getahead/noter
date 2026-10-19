//! The core's macOS services over `noter-native`: permissions, the environment and the login
//! item (DESIGN-core › Native surfaces).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use noter_core::{BoxFuture, EnvironmentReading, NativeServices};
use noter_protocol::{CoreError, ErrorCode, PermissionKind, PermissionState};

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
        notifications: r.notifications,
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

    // @cpt-dod:cpt-noter-dod-core-first-run-login-update:p2
    fn set_login_item(&self, on: bool) -> Result<(), CoreError> {
        noter_native::set_login_item(on)
            .map(drop)
            .map_err(|e| CoreError::new(ErrorCode::Internal, e))
    }
}
