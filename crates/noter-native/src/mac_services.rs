//! The macOS half of `services`: Launch Services, the terminal Apple Events, NSPasteboard, the
//! save and folder panels and the window server's sharing state.

use std::path::PathBuf;
use std::sync::{mpsc, Mutex};

use block2::RcBlock;
use noter_protocol::PermissionState;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{msg_send, AnyThread, ClassType, MainThreadMarker};
use objc2_app_kit::{
    NSModalResponse, NSModalResponseOK, NSOpenPanel, NSPasteboard, NSPasteboardItem, NSSavePanel,
    NSWindow, NSWorkspace,
};
use objc2_core_foundation::{CFArray, CFString};
use objc2_core_graphics::{
    kCGWindowIsOnscreen, kCGWindowNumber, kCGWindowSharingState, CGWindowListCopyWindowInfo,
    CGWindowListOption,
};
use objc2_foundation::{
    NSAppleEventDescriptor, NSAppleScript, NSAppleScriptErrorNumber, NSArray, NSDictionary,
    NSNumber, NSOperationQueue, NSString, NSURL,
};

use crate::services::{
    pasteboard_entries, ClipboardText, LaunchSystem, PanelRequest, WindowState, ITERM_APP,
};

/// Runs `f` on the main thread and waits for its answer: inline when already there, else on
/// the main queue. Never call it from a tokio worker: the main thread may itself be waiting
/// on the runtime (#233). None if the main queue dropped the job.
fn on_main<R: Send + 'static>(f: impl FnOnce(MainThreadMarker) -> R + Send + 'static) -> Option<R> {
    if let Some(mtm) = MainThreadMarker::new() {
        return Some(f(mtm));
    }
    let (tx, rx) = mpsc::channel();
    let job = Mutex::new(Some(f));
    let block = RcBlock::new(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        if let Some(f) = job.lock().ok().and_then(|mut j| j.take()) {
            let _ = tx.send(f(mtm));
        }
    });
    // SAFETY: the block owns Send data only and runs once on the main queue.
    unsafe { NSOperationQueue::mainQueue().addOperationWithBlock(&block) };
    drop(block);
    rx.recv().ok()
}

// ── launch ─────────────────────────────────────────────────────────────────

pub struct MacLaunch;

/// Noter's terminal scripts: fixed source; the command arrives as the handler's argument.
const TERMINAL_SCRIPT: &str = r#"on noter_open(command_line)
	tell application id "com.apple.Terminal"
		activate
		do script command_line
	end tell
end noter_open"#;

const ITERM_SCRIPT: &str = r#"on noter_open(command_line)
	tell application id "com.googlecode.iterm2"
		activate
		set w to (create window with default profile)
		tell current session of w to write text command_line
	end tell
end noter_open"#;

const fn four(code: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*code)
}

impl LaunchSystem for MacLaunch {
    fn has_handler(&self, scheme: &str) -> bool {
        let Some(url) = NSURL::URLWithString(&NSString::from_str(&format!("{scheme}://"))) else {
            return false;
        };
        NSWorkspace::sharedWorkspace()
            .URLForApplicationToOpenURL(&url)
            .is_some()
    }

    fn has_app(&self, bundle_id: &str) -> bool {
        NSWorkspace::sharedWorkspace()
            .URLForApplicationWithBundleIdentifier(&NSString::from_str(bundle_id))
            .is_some()
    }

    fn automation(&self, bundle_id: &str) -> PermissionState {
        crate::mac::automation(bundle_id, false)
    }

    fn open_url(&self, url: &str) -> bool {
        NSURL::URLWithString(&NSString::from_str(url))
            .is_some_and(|url| NSWorkspace::sharedWorkspace().openURL(&url))
    }

    fn run_in_terminal(&self, bundle_id: &str, command: &str) -> Result<(), i32> {
        let source = if bundle_id == ITERM_APP {
            ITERM_SCRIPT
        } else {
            TERMINAL_SCRIPT
        };
        let command = command.to_string();
        // errAEEventFailed when the main queue never ran it.
        on_main(move |_| run_script(source, &command)).unwrap_or(Err(-10000))
    }
}

/// Calls the script's `noter_open(command)` handler with `command` as an Apple Event string
/// parameter. Main thread only (NSAppleScript is not thread-safe).
fn run_script(source: &str, command: &str) -> Result<(), i32> {
    let script = NSAppleScript::initWithSource(NSAppleScript::alloc(), &NSString::from_str(source))
        .ok_or(-2741)?;
    let target = NSAppleEventDescriptor::currentProcessDescriptor();
    // kASAppleScriptSuite, kASSubroutineEvent, kAutoGenerateReturnID, kAnyTransactionID; the
    // typed constructor needs objc2-core-services, a dependency for four integers.
    let event: Retained<NSAppleEventDescriptor> = unsafe {
        msg_send![
            NSAppleEventDescriptor::class(),
            appleEventWithEventClass: four(b"ascr"),
            eventID: four(b"psbr"),
            targetDescriptor: &*target,
            returnID: -1i16,
            transactionID: 0i32
        ]
    };
    let name = NSAppleEventDescriptor::descriptorWithString(&NSString::from_str("noter_open"));
    let args = NSAppleEventDescriptor::listDescriptor();
    args.insertDescriptor_atIndex(
        &NSAppleEventDescriptor::descriptorWithString(&NSString::from_str(command)),
        1,
    );
    // keyASSubroutineName, keyDirectObject.
    unsafe {
        let _: () = msg_send![&*event, setParamDescriptor: &*name, forKeyword: four(b"snam")];
        let _: () = msg_send![&*event, setParamDescriptor: &*args, forKeyword: four(b"----")];
    }
    let mut error: Option<Retained<NSDictionary<NSString, AnyObject>>> = None;
    // SAFETY: a well-formed subroutine event for a script this process compiled.
    unsafe { script.executeAppleEvent_error(&event, Some(&mut error)) };
    match error {
        None => Ok(()),
        Some(info) => Err(info
            .objectForKey(unsafe { NSAppleScriptErrorNumber })
            .and_then(|n| n.downcast::<NSNumber>().ok())
            .map_or(-10000, |n| n.intValue())),
    }
}

// ── clipboard ──────────────────────────────────────────────────────────────

fn pasteboard(name: Option<&str>) -> Retained<NSPasteboard> {
    match name {
        Some(name) => NSPasteboard::pasteboardWithName(&NSString::from_str(name)),
        None => NSPasteboard::generalPasteboard(),
    }
}

// @cpt-begin:cpt-noter-flow-core-native-services-operation:p1:inst-op-clipboard
pub fn clipboard_write(name: Option<&str>, text: &ClipboardText) -> Result<(), String> {
    let item = NSPasteboardItem::new();
    for (uti, value) in pasteboard_entries(text) {
        if !item.setString_forType(&NSString::from_str(value), &NSString::from_str(uti)) {
            return Err(format!("the pasteboard item refused {uti}"));
        }
    }
    let board = pasteboard(name);
    board.clearContents();
    // One item with every representation: a reader never gets the plain text without its
    // rich forms.
    let objects = NSArray::from_retained_slice(&[ProtocolObject::from_retained(item)]);
    if board.writeObjects(&objects) {
        Ok(())
    } else {
        Err("the pasteboard refused the write".into())
    }
}
// @cpt-end:cpt-noter-flow-core-native-services-operation:p1:inst-op-clipboard

pub fn clipboard_read(name: &str, uti: &str) -> Option<String> {
    pasteboard(Some(name))
        .stringForType(&NSString::from_str(uti))
        .map(|s| s.to_string())
}

pub fn clipboard_release(name: &str) {
    let board = pasteboard(Some(name));
    let _: () = unsafe { msg_send![&*board, releaseGlobally] };
}

// ── panels ─────────────────────────────────────────────────────────────────

fn chosen(panel: &NSSavePanel, response: NSModalResponse) -> Option<PathBuf> {
    if response != NSModalResponseOK {
        return None;
    }
    panel.URL()?.path().map(|p| PathBuf::from(p.to_string()))
}

/// Shows the save panel (or a folder panel) and waits for the answer: a sheet on
/// `req.parent` when given, else a free panel; app-modal when called on the main thread.
pub fn present_panel(req: &PanelRequest) -> Option<PathBuf> {
    let req = req.clone();
    let (tx, rx) = mpsc::channel();
    let modal = MainThreadMarker::new().is_some();
    on_main(move |mtm| {
        let panel: Retained<NSSavePanel> = if req.folder {
            let open = NSOpenPanel::openPanel(mtm);
            open.setCanChooseDirectories(true);
            open.setCanChooseFiles(false);
            Retained::into_super(open)
        } else {
            let save = NSSavePanel::savePanel(mtm);
            if !req.extensions.is_empty() {
                let types: Vec<Retained<NSString>> = req
                    .extensions
                    .iter()
                    .map(|e| NSString::from_str(e))
                    .collect();
                // allowedContentTypes needs objc2-uniform-type-identifiers, a new dependency.
                #[allow(deprecated)]
                save.setAllowedFileTypes(Some(&NSArray::from_retained_slice(&types)));
            }
            save
        };
        panel.setCanCreateDirectories(true);
        panel.setNameFieldStringValue(&NSString::from_str(&req.suggested_name));
        if modal {
            let _ = tx.send(chosen(&panel, panel.runModal()));
            return;
        }
        let answer = panel.clone();
        let handler = RcBlock::new(move |response: NSModalResponse| {
            let _ = tx.send(chosen(&answer, response));
        });
        match req.parent {
            // SAFETY: `ParentWindow::from_raw` requires a live NSWindow.
            Some(parent) => panel.beginSheetModalForWindow_completionHandler(
                unsafe { &*(parent.as_ptr() as *const NSWindow) },
                &handler,
            ),
            None => panel.beginWithCompletionHandler(&handler),
        }
    })?;
    rx.recv().ok().flatten()
}

// ── window server ──────────────────────────────────────────────────────────

fn ns_key(key: &CFString) -> &NSString {
    // SAFETY: CFString is toll-free bridged to NSString.
    unsafe { &*(key as *const CFString).cast() }
}

fn number(info: &NSDictionary<NSString, AnyObject>, key: &CFString) -> Option<i64> {
    info.objectForKey(ns_key(key))
        .and_then(|v| v.downcast::<NSNumber>().ok())
        .map(|n| n.longLongValue())
}

/// The window's on-screen and sharing state; None when the window server does not know it.
pub fn window_state(id: u32) -> Option<WindowState> {
    let list = CGWindowListCopyWindowInfo(CGWindowListOption::OptionIncludingWindow, id)?;
    // SAFETY: a CFArray of CFDictionary is toll-free bridged to NSArray of NSDictionary.
    let list: &NSArray<NSDictionary<NSString, AnyObject>> =
        unsafe { &*(&*list as *const CFArray).cast() };
    let info = list
        .iter()
        .find(|info| number(info, unsafe { kCGWindowNumber }) == Some(i64::from(id)))?;
    Some(WindowState {
        on_screen: number(&info, unsafe { kCGWindowIsOnscreen }).is_some_and(|v| v != 0),
        // kCGWindowSharingNone is 0.
        shareable: number(&info, unsafe { kCGWindowSharingState }).is_some_and(|v| v != 0),
    })
}
