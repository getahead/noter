//! The macOS calls behind the crate's API. Reads never prompt; `request_permission` does.

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::sync::{mpsc, OnceLock};
use std::time::Duration;

use block2::{DynBlock, RcBlock};
use noter_protocol::model::{
    CalendarEventRef, DisplayInfo, NavTarget, NotificationAuth, OutputDeviceInfo, OutputRoute,
};
use noter_protocol::{CalendarEventId, DisplayId, PermissionKind, PermissionState, TimestampMs};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, ClassType, MainThreadMarker};
use objc2_app_kit::{
    NSAccessibilityAnnouncementKey, NSAccessibilityAnnouncementRequestedNotification,
    NSAccessibilityNotificationUserInfoKey, NSAccessibilityPostNotificationWithUserInfo,
    NSAccessibilityPriorityKey, NSApplication,
};
use objc2_av_foundation::{AVCaptureDevice, AVMediaTypeAudio};
use objc2_core_audio::{
    kAudioDevicePropertyDataSource, kAudioDevicePropertyDeviceUID,
    kAudioDevicePropertyTransportType, kAudioHardwarePropertyDefaultOutputDevice,
    kAudioObjectPropertyElementMain, kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyScopeOutput, kAudioObjectSystemObject, AudioObjectGetPropertyData,
    AudioObjectID, AudioObjectPropertyAddress,
};
use objc2_core_foundation::{CFArray, CFRetained, CFString, CFType, CFUUID};
use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayBounds, CGDisplayIsBuiltin, CGGetActiveDisplayList,
    CGMainDisplayID, CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess,
};
use objc2_event_kit::{EKEntityType, EKEventStore};
use objc2_foundation::{
    NSBundle, NSDate, NSDictionary, NSError, NSFileManager, NSNumber, NSOperationQueue, NSString,
};
use objc2_security::SecTask;
use objc2_service_management::SMAppService;
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
    UNNotificationSettings, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use system_configuration::network_reachability::{ReachabilityFlags, SCNetworkReachability};

use crate::{
    classify_route, disk_free_mb, login_outcome, map_av_status, map_calendar_status,
    map_login_status, map_notification_status, nav_from_user_info, nav_user_info,
    notification_permission, Frame, LoginItem, PostedNotification, Reading,
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
        PermissionKind::Calendar => {
            // The store must outlive the request: it is kept until the answer arrived.
            let store = unsafe { EKEventStore::new() };
            wait_for(|done| unsafe {
                let block = RcBlock::new(move |_: Bool, _: *mut NSError| done());
                store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&block))
            });
        }
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-request-auth
        PermissionKind::Notifications => {
            if let Some(center) = notification_center() {
                let options = UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound;
                wait_for(|done| {
                    let block = RcBlock::new(move |_: Bool, _: *mut NSError| done());
                    center.requestAuthorizationWithOptions_completionHandler(options, &block)
                });
            }
        }
        // @cpt-end:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-request-auth
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
pub(crate) fn automation(bundle_id: &str, ask: bool) -> PermissionState {
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

/// The connected displays' Core Graphics ids.
fn active_displays() -> Vec<CGDirectDisplayID> {
    let mut ids = [0 as CGDirectDisplayID; 16];
    let mut count = 0u32;
    if unsafe { CGGetActiveDisplayList(ids.len() as u32, ids.as_mut_ptr(), &mut count) }.0 != 0 {
        return vec![];
    }
    ids[..count as usize].to_vec()
}

/// A display's stable id: its UUID, which survives replugging and reordering.
fn display_id(id: CGDirectDisplayID) -> DisplayId {
    let uuid = NonNull::new(unsafe { CGDisplayCreateUUIDFromDisplayID(id) })
        .map(|p| unsafe { CFRetained::from_raw(p) })
        .and_then(|u| CFUUID::new_string(None, Some(&u)))
        .map_or_else(|| id.to_string(), |s| s.to_string());
    DisplayId::new(format!("{}_{uuid}", DisplayId::PREFIX))
}

fn displays() -> Vec<DisplayInfo> {
    let main = CGMainDisplayID();
    active_displays()
        .iter()
        .enumerate()
        .map(|(i, &id)| {
            let bounds = CGDisplayBounds(id);
            // shortcut: NSScreen's localized names need the main thread; these are plain labels.
            let name = if CGDisplayIsBuiltin(id) {
                "Built-in Display".to_string()
            } else {
                format!("Display {}", i + 1)
            };
            DisplayInfo {
                id: display_id(id),
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
    login_outcome(
        result.map_err(|e| e.localizedDescription().to_string()),
        login_item(),
    )
}

// ── App Group container ────────────────────────────────────────────────────

/// The groups in this process's `com.apple.security.application-groups` entitlement.
pub fn entitled_app_groups() -> Vec<String> {
    let Some(task) = (unsafe { SecTask::from_self(None) }) else {
        return Vec::new();
    };
    let key = CFString::from_static_str("com.apple.security.application-groups");
    let value = unsafe { task.value_for_entitlement(&key, std::ptr::null_mut()) };
    let Some(Ok(groups)) = value.map(|v| v.downcast::<CFArray>()) else {
        return Vec::new();
    };
    // SAFETY: every element of a CFArray is a CF object; each is checked to be a string below.
    let groups = unsafe { CFRetained::cast_unchecked::<CFArray<CFType>>(groups) };
    groups
        .iter()
        .filter_map(|g| g.downcast_ref::<CFString>().map(|s| s.to_string()))
        .collect()
}

pub fn group_container(id: &str) -> Option<PathBuf> {
    NSFileManager::defaultManager()
        .containerURLForSecurityApplicationGroupIdentifier(&NSString::from_str(id))?
        .to_file_path()
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

// ── native surfaces ─────────────────────────────────────────────────────────

pub fn display_frame(id: &DisplayId) -> Option<Frame> {
    let display = active_displays()
        .into_iter()
        .find(|&d| display_id(d) == *id)?;
    let b = CGDisplayBounds(display);
    Some(Frame {
        x: b.origin.x,
        y: b.origin.y,
        width: b.size.width,
        height: b.size.height,
    })
}

/// The `userInfo` key that holds the target.
const TARGET_KEY: &str = "noter_target";

pub fn post_notification(n: &PostedNotification) -> Result<(), String> {
    let center = notification_center().ok_or("notifications need the app bundle")?;
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(&n.title));
    content.setBody(&NSString::from_str(&n.body));
    content.setThreadIdentifier(&NSString::from_str(n.thread.as_str()));
    let key = NSString::from_str(TARGET_KEY);
    let target = NSString::from_str(&nav_user_info(&n.target));
    let info: Retained<NSDictionary<NSString, AnyObject>> =
        NSDictionary::from_slices(&[&*key], &[&*target as &AnyObject]);
    // SAFETY: an NSDictionary of NSString to NSString is an NSDictionary of objects.
    let info: Retained<NSDictionary> = unsafe { Retained::cast_unchecked(info) };
    unsafe { content.setUserInfo(&info) };
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &NSString::from_str(&n.id),
        &content,
        None,
    );
    let (tx, rx) = mpsc::channel();
    let block = RcBlock::new(move |error: *mut NSError| {
        let result = match unsafe { error.as_ref() } {
            None => Ok(()),
            Some(e) => Err(e.localizedDescription().to_string()),
        };
        let _ = tx.send(result);
    });
    center.addNotificationRequest_withCompletionHandler(&request, Some(&block));
    rx.recv_timeout(Duration::from_secs(10))
        .unwrap_or_else(|_| Err("Notification Center did not answer".into()))
}

static CLICK: OnceLock<Box<dyn Fn(NavTarget) + Send + Sync>> = OnceLock::new();

define_class!(
    // SAFETY: NSObject has no subclassing requirements; the class has no ivars and no Drop.
    #[unsafe(super(NSObject))]
    #[name = "NoterNotificationDelegate"]
    struct ClickDelegate;

    unsafe impl NSObjectProtocol for ClickDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for ClickDelegate {
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            done: &DynBlock<dyn Fn()>,
        ) {
            let info = response.notification().request().content().userInfo();
            let target = info
                .objectForKey(&NSString::from_str(TARGET_KEY))
                .and_then(|v| v.downcast::<NSString>().ok())
                .and_then(|s| nav_from_user_info(&s.to_string()));
            if let (Some(target), Some(handler)) = (target, CLICK.get()) {
                handler(target);
            }
            done.call(());
        }

        /// Shown while Noter is in front too (the call window is usually in front during a call).
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            done: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            done.call((
                UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List,
            ));
        }
    }
);

pub fn on_notification_click(handler: Box<dyn Fn(NavTarget) + Send + Sync>) {
    if CLICK.set(handler).is_err() {
        return;
    }
    let Some(center) = notification_center() else {
        return;
    };
    let delegate: Retained<ClickDelegate> = unsafe { msg_send![ClickDelegate::class(), new] };
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    // The center holds its delegate weakly; this one lives as long as the app.
    std::mem::forget(delegate);
}

pub fn announce(text: &str, priority: isize) {
    let text = text.to_string();
    // AppKit wants the main thread; outside a running app the queue never runs, which is fine.
    let block = RcBlock::new(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let app = NSApplication::sharedApplication(mtm);
        let message = NSString::from_str(&text);
        let level = NSNumber::new_isize(priority);
        let info: Retained<NSDictionary<NSAccessibilityNotificationUserInfoKey, AnyObject>> = unsafe {
            NSDictionary::from_slices(
                &[NSAccessibilityAnnouncementKey, NSAccessibilityPriorityKey],
                &[&*message as &AnyObject, &*level as &AnyObject],
            )
        };
        unsafe {
            NSAccessibilityPostNotificationWithUserInfo(
                &app,
                NSAccessibilityAnnouncementRequestedNotification,
                Some(&info),
            )
        };
    });
    // SAFETY: the block captures only owned, Send data and runs once on the main queue.
    unsafe { NSOperationQueue::mainQueue().addOperationWithBlock(&block) };
}

// @cpt-begin:cpt-noter-algo-core-native-surfaces-calendar:p1:inst-read-events
/// The events overlapping `from_ms..to_ms` (epoch ms), from every calendar.
pub fn calendar_events(from_ms: i64, to_ms: i64) -> Vec<CalendarEventRef> {
    let store = unsafe { EKEventStore::new() };
    let start = NSDate::dateWithTimeIntervalSince1970(from_ms as f64 / 1000.0);
    let end = NSDate::dateWithTimeIntervalSince1970(to_ms as f64 / 1000.0);
    let predicate =
        unsafe { store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None) };
    let ms = |d: Retained<NSDate>| TimestampMs((d.timeIntervalSince1970() * 1000.0) as i64);
    unsafe { store.eventsMatchingPredicate(&predicate) }
        .iter()
        .filter_map(|e| {
            Some(CalendarEventRef {
                id: CalendarEventId(unsafe { e.eventIdentifier() }?.to_string()),
                title: unsafe { e.title() }.to_string(),
                starts_at: ms(unsafe { e.startDate() }),
                ends_at: ms(unsafe { e.endDate() }),
            })
        })
        .collect()
}
// @cpt-end:cpt-noter-algo-core-native-surfaces-calendar:p1:inst-read-events
