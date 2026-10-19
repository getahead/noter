// @cpt-component:cpt-noter-component-core-native:p1
//! # noter-native — macOS services for the core
//!
//! Plain functions over `noter-protocol` types that the IPC host wraps into the core's
//! `NativeServices` seam (`docs/features/core/core-first-run.md`):
//!
//! * [`permission`] reads a permission without prompting; [`request_permission`] shows the
//!   macOS prompt (only `permission_request` calls it). System Audio Recording cannot be
//!   queried: the core infers it from the self-test and asks through the engine.
//! * [`environment`] reads displays, the output device and route, notification
//!   authorization, reachability and free disk; [`watch`] reports changes.
//! * [`set_login_item`] / [`login_item`] use SMAppService.
//! * [`app_group_container`] finds the App Group container shared with the engine (D14).
//!
//! The request functions block until macOS answers: call them off the async runtime. On other
//! systems nothing is granted and the environment is empty, so the workspace builds and tests
//! everywhere.

#[cfg(target_os = "macos")]
mod mac;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use noter_protocol::model::{DisplayInfo, NotificationAuth, OutputDeviceInfo, OutputRoute};
use noter_protocol::{PermissionKind, PermissionState};

/// The login item as SMAppService reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginItem {
    Disabled,
    Enabled,
    /// Registered, but the user must approve it in System Settings › Login Items.
    RequiresApproval,
    /// The app bundle is not where SMAppService looks (development builds).
    NotFound,
}

/// What `noter-native` reads for `EnvironmentState`; the core adds permissions and the update.
#[derive(Debug, Clone, PartialEq)]
pub struct Reading {
    pub displays: Vec<DisplayInfo>,
    pub output_device: Option<OutputDeviceInfo>,
    pub output_route: OutputRoute,
    pub notifications: NotificationAuth,
    pub online: bool,
    pub disk_free_mb: u32,
}

impl Default for Reading {
    /// Nothing known: no displays, an unknown route, notifications not determined, offline.
    fn default() -> Self {
        Self {
            displays: Vec::new(),
            output_device: None,
            output_route: OutputRoute::Unknown,
            notifications: NotificationAuth::NotDetermined,
            online: false,
            disk_free_mb: 0,
        }
    }
}

/// `AVAuthorizationStatus` (microphone).
pub fn map_av_status(status: isize) -> PermissionState {
    match status {
        1 | 2 => PermissionState::Denied,
        3 => PermissionState::Granted,
        _ => PermissionState::NotAsked,
    }
}

/// `EKAuthorizationStatus` (calendar); write-only access cannot read events.
pub fn map_calendar_status(status: isize) -> PermissionState {
    match status {
        1 | 2 | 4 => PermissionState::Denied,
        3 => PermissionState::Granted,
        _ => PermissionState::NotAsked,
    }
}

/// `UNAuthorizationStatus`; provisional and ephemeral authorization deliver too.
pub fn map_notification_status(status: isize) -> NotificationAuth {
    match status {
        1 => NotificationAuth::Denied,
        2..=4 => NotificationAuth::Authorized,
        _ => NotificationAuth::NotDetermined,
    }
}

pub fn notification_permission(auth: NotificationAuth) -> PermissionState {
    match auth {
        NotificationAuth::NotDetermined => PermissionState::NotAsked,
        NotificationAuth::Denied => PermissionState::Denied,
        NotificationAuth::Authorized => PermissionState::Granted,
    }
}

/// `SMAppServiceStatus`.
pub fn map_login_status(status: isize) -> LoginItem {
    match status {
        1 => LoginItem::Enabled,
        2 => LoginItem::RequiresApproval,
        3 => LoginItem::NotFound,
        _ => LoginItem::Disabled,
    }
}

/// The output route from Core Audio's transport type and data source. Only the built-in
/// output tells headphones from speakers; anything else is unknown until the user marks it.
pub fn classify_route(transport: u32, data_source: Option<u32>) -> OutputRoute {
    const BUILT_IN: u32 = u32::from_be_bytes(*b"bltn");
    const HEADPHONES: u32 = u32::from_be_bytes(*b"hdpn");
    const SPEAKERS: u32 = u32::from_be_bytes(*b"ispk");
    match (transport, data_source) {
        (BUILT_IN, Some(HEADPHONES)) => OutputRoute::Headphones,
        (BUILT_IN, Some(SPEAKERS)) => OutputRoute::Speakers,
        _ => OutputRoute::Unknown,
    }
}

/// Free space for an unprivileged user on the volume holding `path`; 0 if it cannot be read.
pub fn disk_free_mb(path: &Path) -> u32 {
    let Ok(c) = std::ffi::CString::new(path.as_os_str().as_encoded_bytes()) else {
        return 0;
    };
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `c` is a valid C string and `s` a writable statvfs.
    if unsafe { libc::statvfs(c.as_ptr(), &mut s) } != 0 {
        return 0;
    }
    let bytes = s.f_bavail as u64 * s.f_frsize as u64;
    u32::try_from(bytes / (1024 * 1024)).unwrap_or(u32::MAX)
}

/// The App Group the app shares with the sandboxed engine is `<TEAMID>.ai.noter`.
const APP_GROUP_SUFFIX: &str = ".ai.noter";

/// Decision D14: the App Group container the app shares with the sandboxed engine (audio,
/// `models/`, `engine-io/`, the capture ring). None when this process has no
/// `<TEAMID>.ai.noter` application-groups entitlement (unsigned development runs, which use
/// the data folder) or macOS gives no folder for it.
pub fn app_group_container() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    return app_group_id(&mac::entitled_app_groups()).and_then(mac::group_container);
    #[cfg(not(target_os = "macos"))]
    None
}

/// The app's group among a process's `com.apple.security.application-groups` entitlement.
pub fn app_group_id(entitled: &[String]) -> Option<&str> {
    entitled.iter().map(String::as_str).find(|id| {
        id.strip_suffix(APP_GROUP_SUFFIX)
            .is_some_and(|team| !team.is_empty())
    })
}

// @cpt-begin:cpt-noter-flow-core-first-run-permission:p1:inst-native-ask
/// The permission's state, without prompting.
pub fn permission(kind: PermissionKind) -> PermissionState {
    if kind == PermissionKind::SystemAudio {
        return PermissionState::NotAsked;
    }
    #[cfg(target_os = "macos")]
    return mac::permission(kind);
    #[cfg(not(target_os = "macos"))]
    PermissionState::NotAsked
}

/// Shows the macOS prompt and returns the answer. Blocks until macOS answers.
pub fn request_permission(kind: PermissionKind) -> PermissionState {
    if kind == PermissionKind::SystemAudio {
        return PermissionState::NotAsked;
    }
    #[cfg(target_os = "macos")]
    return mac::request_permission(kind);
    #[cfg(not(target_os = "macos"))]
    PermissionState::NotAsked
}
// @cpt-end:cpt-noter-flow-core-first-run-permission:p1:inst-native-ask

/// The environment as `EnvironmentState` needs it; `storage` is the folder whose volume's
/// free space counts.
pub fn environment(storage: &Path) -> Reading {
    #[cfg(target_os = "macos")]
    return mac::environment(storage);
    #[cfg(not(target_os = "macos"))]
    Reading {
        disk_free_mb: disk_free_mb(storage),
        ..Reading::default()
    }
}

/// Stops its watcher when dropped.
pub struct Watch {
    stop: Arc<AtomicBool>,
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// Calls `on_change` with each new reading of [`environment`] that differs from the last.
/// shortcut: polls every `every` (2 s is plenty for displays, route, reachability, disk and
/// permissions); switch to Core Graphics, Core Audio and Network notifications if it costs.
pub fn watch(
    storage: PathBuf,
    every: Duration,
    on_change: impl Fn(Reading) + Send + 'static,
) -> Watch {
    watch_with(move || environment(&storage), every, on_change)
}

/// [`watch`] over any reading function (for tests and the harness).
pub fn watch_with(
    mut read: impl FnMut() -> Reading + Send + 'static,
    every: Duration,
    on_change: impl Fn(Reading) + Send + 'static,
) -> Watch {
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    std::thread::spawn(move || {
        let mut last = read();
        loop {
            std::thread::sleep(every);
            if stopped.load(Ordering::SeqCst) {
                return;
            }
            let now = read();
            if now != last {
                on_change(now.clone());
                last = now;
            }
        }
    });
    Watch { stop }
}

// @cpt-begin:cpt-noter-algo-core-first-run-login-item:p2:inst-login-apply
/// Registers (`on`) or unregisters the main app as a login item. `RequiresApproval` means the
/// user must allow it in System Settings; the setting stays on.
pub fn set_login_item(on: bool) -> Result<LoginItem, String> {
    #[cfg(target_os = "macos")]
    return mac::set_login_item(on);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = on;
        Err("login items need macOS".into())
    }
}
// @cpt-end:cpt-noter-algo-core-first-run-login-item:p2:inst-login-apply

/// What [`set_login_item`] answers once SMAppService ran (`registered`) and reports `state`.
pub fn login_outcome(
    registered: Result<(), String>,
    state: LoginItem,
) -> Result<LoginItem, String> {
    // @cpt-begin:cpt-noter-algo-core-first-run-login-item:p2:inst-login-approval
    // Awaiting approval in System Settings is not a failure: the setting stays on.
    if state == LoginItem::RequiresApproval {
        return Ok(state);
    }
    // @cpt-end:cpt-noter-algo-core-first-run-login-item:p2:inst-login-approval
    // @cpt-begin:cpt-noter-algo-core-first-run-login-item:p2:inst-login-return
    registered.map(|()| state)
    // @cpt-end:cpt-noter-algo-core-first-run-login-item:p2:inst-login-return
}

pub fn login_item() -> LoginItem {
    #[cfg(target_os = "macos")]
    return mac::login_item();
    #[cfg(not(target_os = "macos"))]
    LoginItem::Disabled
}
