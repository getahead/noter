//! Route AppKit's Dock and session termination requests through Noter's quit flow.

use std::ffi::{c_void, CStr};
use std::sync::OnceLock;

use objc2::runtime::{AnyClass, AnyObject, Sel};
use objc2::{msg_send, sel, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSApplicationTerminateReply};
use tauri::{AppHandle, Wry};

use crate::surfaces;

static APP: OnceLock<AppHandle<Wry>> = OnceLock::new();

/// Installs the missing optional AppKit delegate selector on tao's existing delegate.
// @cpt-flow:cpt-noter-flow-ui-dialogs-host-quit:p1
pub fn install(app: &AppHandle<Wry>) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let application = NSApplication::sharedApplication(mtm);
    let Some(delegate) = application.delegate() else {
        return;
    };
    let _ = APP.set(app.clone());
    // SAFETY: AppKit returns its live application delegate; `class` is a registered Objective-C class.
    let class: *mut AnyClass = unsafe { msg_send![&*delegate, class] };
    if class.is_null() {
        return;
    }
    let selector = sel!(applicationShouldTerminate:);
    let callback: extern "C" fn(&AnyObject, Sel, &NSApplication) -> NSApplicationTerminateReply =
        should_terminate;
    // The enum is an NSUInteger, which uses the 64-bit `Q` encoding on supported macOS targets.
    let encoding = CStr::from_bytes_with_nul(b"Q@:@\0").expect("static method encoding");
    // SAFETY: the callback uses AppKit's declared `applicationShouldTerminate:` argument and return ABI.
    if !unsafe {
        class_add_method(
            class,
            selector,
            callback as *const () as *const c_void,
            encoding.as_ptr(),
        )
    } {
        eprintln!("noter: could not install applicationShouldTerminate: on tao's delegate");
    }
}

extern "C" fn should_terminate(
    _: &AnyObject,
    _: Sel,
    _: &NSApplication,
) -> NSApplicationTerminateReply {
    if let Some(app) = APP.get() {
        surfaces::quit(app);
        NSApplicationTerminateReply::TerminateCancel
    } else {
        NSApplicationTerminateReply::TerminateNow
    }
}

#[link(name = "objc")]
unsafe extern "C" {
    #[link_name = "class_addMethod"]
    fn class_add_method(
        class: *mut AnyClass,
        selector: Sel,
        implementation: *const c_void,
        types: *const std::ffi::c_char,
    ) -> bool;
}
