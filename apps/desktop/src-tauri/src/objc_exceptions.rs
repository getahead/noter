//! Objective-C exceptions are logged with their name and reason when thrown (#1083). One thrown
//! inside a run-loop observer reaches tao's `catch_unwind`, and Rust aborts at once ("Rust cannot
//! catch foreign exceptions") before AppKit's uncaught-exception handler could say what it was.
use std::sync::Mutex;

use objc2::ffi::objc_setExceptionPreprocessor;
use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_foundation::NSString;

type Preprocessor = unsafe extern "C" fn(*mut AnyObject) -> *mut AnyObject;

static NEXT: Mutex<Option<Preprocessor>> = Mutex::new(None);
static LAST: Mutex<Option<String>> = Mutex::new(None);

/// Installs the logging preprocessor once, before the event loop runs; an earlier one still runs.
pub fn install() {
    let mut next = NEXT.lock().unwrap_or_else(|e| e.into_inner());
    // SAFETY: `log_thrown` matches the preprocessor signature and returns the exception it got.
    let previous = unsafe { objc_setExceptionPreprocessor(log_thrown) };
    if previous as *const () != log_thrown as *const () {
        *next = Some(previous);
    }
}

/// The last exception logged, `name: reason`.
#[cfg(test)]
fn last() -> Option<String> {
    LAST.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

fn text(s: Option<Retained<NSString>>) -> String {
    s.map_or_else(|| "(none)".into(), |s| s.to_string())
}

unsafe extern "C" fn log_thrown(exception: *mut AnyObject) -> *mut AnyObject {
    // SAFETY: the runtime hands the thrown object; `name` and `reason` are asked of NSExceptions only.
    if let Some(e) = unsafe { exception.as_ref() } {
        let is_exception: bool = unsafe { msg_send![e, isKindOfClass: objc2::class!(NSException)] };
        if is_exception {
            let name: Option<Retained<NSString>> = unsafe { msg_send![e, name] };
            let reason: Option<Retained<NSString>> = unsafe { msg_send![e, reason] };
            let line = format!("{}: {}", text(name), text(reason));
            eprintln!("noter: an Objective-C exception was thrown: {line}");
            *LAST.lock().unwrap_or_else(|e| e.into_inner()) = Some(line);
        }
    }
    let next = *NEXT.lock().unwrap_or_else(|e| e.into_inner());
    match next {
        // SAFETY: the preprocessor installed before ours, called as the runtime would.
        Some(next) => unsafe { next(exception) },
        None => exception,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_thrown_exception_is_logged_with_its_name_and_reason() {
        install();
        install(); // a second install keeps one preprocessor
        let name = NSString::from_str("NSInternalInconsistencyException");
        let reason = NSString::from_str("panel closed while its delegate refused");
        // SAFETY: NSException's designated initialiser, on a fresh allocation.
        let exception: Retained<AnyObject> = unsafe {
            let alloc: *mut AnyObject = msg_send![objc2::class!(NSException), alloc];
            Retained::from_raw(msg_send![alloc, initWithName: &*name, reason: &*reason, userInfo: std::ptr::null::<AnyObject>()]).unwrap()
        };
        let raw = Retained::as_ptr(&exception).cast_mut();
        // SAFETY: the runtime would call the preprocessor with this object before throwing it.
        let returned = unsafe { log_thrown(raw) };
        assert_eq!(
            returned, raw,
            "the preprocessor hands the exception on unchanged"
        );
        assert_eq!(
            last().as_deref(),
            Some("NSInternalInconsistencyException: panel closed while its delegate refused")
        );
    }
}
