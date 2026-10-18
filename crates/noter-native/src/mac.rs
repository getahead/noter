//! The macOS calls behind the crate's API. Reads never prompt; `request_permission` does.

use std::ffi::c_void;
use std::path::Path;
use std::ptr::NonNull;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use noter_protocol::model::{DisplayInfo, NotificationAuth, OutputDeviceInfo, OutputRoute};
use noter_protocol::{DisplayId, PermissionKind, PermissionState};
use objc2::runtime::Bool;
use objc2_av_foundation::{AVCaptureDevice, AVMediaTypeAudio};
use objc2_core_audio::{
    kAudioDevicePropertyDataSource, kAudioDevicePropertyDeviceUID,
    kAudioDevicePropertyTransportType, kAudioHardwarePropertyDefaultOutputDevice,
    kAudioObjectPropertyElementMain, kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyScopeOutput, kAudioObjectSystemObject, AudioObjectGetPropertyData,
    AudioObjectID, AudioObjectPropertyAddress,
};
use objc2_core_foundation::{CFRetained, CFString, CFUUID};
use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayBounds, CGDisplayIsBuiltin, CGGetActiveDisplayList,
    CGMainDisplayID, CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess,
};
use objc2_event_kit::{EKEntityType, EKEventStore};
use objc2_foundation::{NSBundle, NSError};
use objc2_service_management::SMAppService;
use objc2_user_notifications::{
    UNAuthorizationOptions, UNNotificationSettings, UNUserNotificationCenter,
};
use system_configuration::network_reachability::{ReachabilityFlags, SCNetworkReachability};

use crate::{
    classify_route, disk_free_mb, map_av_status, map_calendar_status, map_login_status,
    map_notification_status, notification_permission, LoginItem, Reading,
};

/// How long a prompt may stay open before the answer counts as not given.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(300);

// ── permissions ────────────────────────────────────────────────────────────

pub fn permission(kind: PermissionKind) -> PermissionState {
    match kind {
        PermissionKind::Microphone => microphone(),
        PermissionKind::Calendar => map_calendar_status(
            unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) }.0,
        ),
        PermissionKind::Notifications => notification_permission(notifications()),
        // CGPreflight cannot tell "not asked" from "denied".
        PermissionKind::ScreenRecording if CGPreflightScreenCaptureAccess() => {
            PermissionState::Granted
        }
        PermissionKind::ScreenRecording => PermissionState::NotAsked,
        PermissionKind::AutomationTerminal => automation("com.apple.Terminal", false),
        PermissionKind::AutomationBrowser => {
            default_browser().map_or(PermissionState::NotAsked, |b| automation(&b, false))
        }
        PermissionKind::SystemAudio => PermissionState::NotAsked,
    }
}

pub fn request_permission(kind: PermissionKind) -> PermissionState {
    match kind {
        PermissionKind::Microphone => {
            if let Some(audio) = unsafe { AVMediaTypeAudio } {
                wait_for(|done| unsafe {
                    let block = RcBlock::new(move |_: Bool| done());
                    AVCaptureDevice::requestAccessForMediaType_completionHandler(audio, &block)
                });
            }
        }
        PermissionKind::Calendar => wait_for(|done| unsafe {
            let block = RcBlock::new(move |_: Bool, _: *mut NSError| done());
            EKEventStore::new().requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&block))
        }),
        PermissionKind::Notifications => {
            if let Some(center) = notification_center() {
                let options = UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound;
                wait_for(|done| {
                    let block = RcBlock::new(move |_: Bool, _: *mut NSError| done());
                    center.requestAuthorizationWithOptions_completionHandler(options, &block)
                });
            }
        }
        // Granted only after a relaunch; until then preflight stays false.
        PermissionKind::ScreenRecording if !CGRequestScreenCaptureAccess() => {
            return PermissionState::NeedsRelaunch
        }
        PermissionKind::AutomationTerminal => return automation("com.apple.Terminal", true),
        PermissionKind::AutomationBrowser => {
            return default_browser().map_or(PermissionState::NotAsked, |b| automation(&b, true))
        }
        PermissionKind::ScreenRecording | PermissionKind::SystemAudio => {}
    }
    permission(kind)
}

/// Starts a completion-handler API with a `done` callback and waits until it is called (or
/// the prompt has been left open for `PROMPT_TIMEOUT`).
fn wait_for(start: impl FnOnce(Box<dyn Fn() + Send>)) {
    let (tx, rx) = mpsc::channel();
    start(Box::new(move || {
        let _ = tx.send(());
    }));
    let _ = rx.recv_timeout(PROMPT_TIMEOUT);
}

fn microphone() -> PermissionState {
    match unsafe { AVMediaTypeAudio } {
        Some(audio) => {
            map_av_status(unsafe { AVCaptureDevice::authorizationStatusForMediaType(audio) }.0)
        }
        None => PermissionState::NotAsked,
    }
}

/// The notification center exists only in a bundled app; elsewhere it raises an exception.
fn notification_center() -> Option<objc2::rc::Retained<UNUserNotificationCenter>> {
    NSBundle::mainBundle()
        .bundleIdentifier()
        .map(|_| UNUserNotificationCenter::currentNotificationCenter())
}

fn notifications() -> NotificationAuth {
    let Some(center) = notification_center() else {
        return NotificationAuth::NotDetermined;
    };
    let (tx, rx) = mpsc::channel();
    let block = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
        let status = unsafe { settings.as_ref() }.authorizationStatus().0;
        let _ = tx.send(status);
    });
    center.getNotificationSettingsWithCompletionHandler(&block);
    rx.recv_timeout(Duration::from_secs(2))
        .map_or(NotificationAuth::NotDetermined, map_notification_status)
}

// Apple Events automation (CoreServices), not covered by the objc2 crates.
#[repr(C)]
struct AEDesc {
    descriptor_type: u32,
    data_handle: *mut c_void,
}

#[link(name = "CoreServices", kind = "framework")]
extern "C" {
    fn AECreateDesc(type_code: u32, data: *const c_void, size: isize, result: *mut AEDesc) -> i16;
    fn AEDisposeDesc(desc: *mut AEDesc) -> i16;
    fn AEDeterminePermissionToAutomateTarget(
        target: *const AEDesc,
        class: u32,
        id: u32,
        ask: u8,
    ) -> i32;
    fn LSCopyDefaultHandlerForURLScheme(scheme: &CFString) -> *mut CFString;
}

/// Whether Noter may send Apple Events to the app `bundle_id` (`ask` shows the prompt).
fn automation(bundle_id: &str, ask: bool) -> PermissionState {
    const TYPE_BUNDLE_ID: u32 = u32::from_be_bytes(*b"bund");
    const WILDCARD: u32 = u32::from_be_bytes(*b"****");
    let mut desc = AEDesc {
        descriptor_type: 0,
        data_handle: std::ptr::null_mut(),
    };
    let bytes = bundle_id.as_bytes();
    // SAFETY: `bytes` outlives the call; `desc` is disposed below.
    if unsafe {
        AECreateDesc(
            TYPE_BUNDLE_ID,
            bytes.as_ptr().cast(),
            bytes.len() as isize,
            &mut desc,
        )
    } != 0
    {
        return PermissionState::NotAsked;
    }
    let status =
        unsafe { AEDeterminePermissionToAutomateTarget(&desc, WILDCARD, WILDCARD, ask as u8) };
    unsafe { AEDisposeDesc(&mut desc) };
    match status {
        0 => PermissionState::Granted,
        -1743 => PermissionState::Denied, // errAEEventNotPermitted
        _ => PermissionState::NotAsked,   // not asked yet, or the app is not running
    }
}

fn default_browser() -> Option<String> {
    let scheme = CFString::from_static_str("https");
    let raw = unsafe { LSCopyDefaultHandlerForURLScheme(&scheme) };
    NonNull::new(raw).map(|p| unsafe { CFRetained::from_raw(p) }.to_string())
}

// ── environment ────────────────────────────────────────────────────────────

pub fn environment(storage: &Path) -> Reading {
    let (output_device, output_route) = output();
    Reading {
        displays: displays(),
        output_device,
        output_route,
        notifications: notifications(),
        online: online(),
        disk_free_mb: disk_free_mb(storage),
    }
}

#[link(name = "ColorSync", kind = "framework")]
extern "C" {
    fn CGDisplayCreateUUIDFromDisplayID(display: CGDirectDisplayID) -> *mut CFUUID;
}

fn displays() -> Vec<DisplayInfo> {
    let mut ids = [0 as CGDirectDisplayID; 16];
    let mut count = 0u32;
    if unsafe { CGGetActiveDisplayList(ids.len() as u32, ids.as_mut_ptr(), &mut count) }.0 != 0 {
        return vec![];
    }
    let main = CGMainDisplayID();
    ids[..count as usize]
        .iter()
        .enumerate()
        .map(|(i, &id)| {
            let bounds = CGDisplayBounds(id);
            let uuid = NonNull::new(unsafe { CGDisplayCreateUUIDFromDisplayID(id) })
                .map(|p| unsafe { CFRetained::from_raw(p) })
                .and_then(|u| CFUUID::new_string(None, Some(&u)))
                .map_or_else(|| id.to_string(), |s| s.to_string());
            // shortcut: NSScreen's localized names need the main thread; these are plain labels.
            let name = if CGDisplayIsBuiltin(id) {
                "Built-in Display".to_string()
            } else {
                format!("Display {}", i + 1)
            };
            DisplayInfo {
                id: DisplayId::new(format!("{}_{uuid}", DisplayId::PREFIX)),
                name,
                is_main: id == main,
                holds_call_app: false,
                width_pt: bounds.size.width as u32,
                height_pt: bounds.size.height as u32,
            }
        })
        .collect()
}

fn property<T: Copy>(object: AudioObjectID, selector: u32, scope: u32) -> Option<T> {
    let address = AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: scope,
        mElement: kAudioObjectPropertyElementMain,
    };
    let mut value = std::mem::MaybeUninit::<T>::uninit();
    let mut size = std::mem::size_of::<T>() as u32;
    // SAFETY: `value` has room for `size` bytes of `T`.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&address),
            0,
            std::ptr::null(),
            NonNull::from(&mut size),
            NonNull::new_unchecked(value.as_mut_ptr().cast()),
        )
    };
    (status == 0).then(|| unsafe { value.assume_init() })
}

fn string_property(object: AudioObjectID, selector: u32) -> Option<String> {
    let raw: *mut CFString = property(object, selector, kAudioObjectPropertyScopeGlobal)?;
    NonNull::new(raw).map(|p| unsafe { CFRetained::from_raw(p) }.to_string())
}

fn output() -> (Option<OutputDeviceInfo>, OutputRoute) {
    let Some(device) = property::<AudioObjectID>(
        kAudioObjectSystemObject as AudioObjectID,
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
    ) else {
        return (None, OutputRoute::Unknown);
    };
    let transport = property::<u32>(
        device,
        kAudioDevicePropertyTransportType,
        kAudioObjectPropertyScopeGlobal,
    )
    .unwrap_or(0);
    let source = property::<u32>(
        device,
        kAudioDevicePropertyDataSource,
        kAudioObjectPropertyScopeOutput,
    );
    let info = string_property(device, kAudioDevicePropertyDeviceUID).map(|uid| OutputDeviceInfo {
        uid,
        name: string_property(device, kAudioObjectPropertyName).unwrap_or_default(),
        // The core fills it from AudioOutputSettings.headphones_devices.
        marked_headphones: false,
    });
    (info, classify_route(transport, source))
}

fn online() -> bool {
    let any = std::net::SocketAddr::from(([0, 0, 0, 0], 0));
    SCNetworkReachability::from(any)
        .reachability()
        .is_ok_and(|f| {
            f.contains(ReachabilityFlags::REACHABLE)
                && !f.contains(ReachabilityFlags::CONNECTION_REQUIRED)
        })
}

// ── login item ─────────────────────────────────────────────────────────────

pub fn set_login_item(on: bool) -> Result<LoginItem, String> {
    let service = unsafe { SMAppService::mainAppService() };
    let result = if on {
        unsafe { service.registerAndReturnError() }
    } else {
        unsafe { service.unregisterAndReturnError() }
    };
    // @cpt-begin:cpt-noter-algo-core-first-run-login-item:p2:inst-login-approval
    // Registered but awaiting approval in System Settings is not a failure: the setting stays on.
    match (result, login_item()) {
        (_, LoginItem::RequiresApproval) => Ok(LoginItem::RequiresApproval),
        (Ok(()), state) => Ok(state),
        (Err(e), _) => Err(e.localizedDescription().to_string()),
    }
    // @cpt-end:cpt-noter-algo-core-first-run-login-item:p2:inst-login-approval
}

pub fn login_item() -> LoginItem {
    map_login_status(unsafe { SMAppService::mainAppService().status() }.0)
}

#[cfg(test)]
mod tests {
    #[test]
    fn wait_for_returns_once_the_completion_handler_ran() {
        let started = std::time::Instant::now();
        super::wait_for(|done| std::thread::spawn(done).join().unwrap());
        assert!(started.elapsed() < super::PROMPT_TIMEOUT);
    }
}
