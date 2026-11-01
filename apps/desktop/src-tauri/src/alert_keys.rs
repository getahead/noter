//! Return chooses **Cancel** in Noter's native alerts (dialogs-host: Cancel is the default, Return and Esc).
//!
//! The dialog plugin's NSAlert gets Cancel as its first button, and AppKit then gives that button
//! Escape (it is titled Cancel) and no button Return: Return did nothing. One local key monitor
//! makes Return in a modal window with no default button click the button that holds Escape,
//! AppKit's Cancel; a window whose own default button takes Return (a save panel) is left alone.

use std::ptr::NonNull;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::{MainThreadMarker, Message};
use objc2_app_kit::{NSApplication, NSButton, NSEvent, NSEventMask, NSView};

/// Return and keypad Enter.
const RETURN_KEYS: [u16; 2] = [36, 76];
const ESCAPE: &str = "\u{1b}";

/// The button among `view`'s descendants whose key equivalent is `key`.
fn button_for(view: &NSView, key: &str) -> Option<Retained<NSButton>> {
    for sub in view.subviews().iter() {
        if let Some(button) = sub.downcast_ref::<NSButton>() {
            if button.keyEquivalent().to_string() == key {
                return Some(button.retain());
            }
        }
        if let Some(found) = button_for(&sub, key) {
            return Some(found);
        }
    }
    None
}

/// Installs the monitor; call once on the main thread, before the event loop.
// @cpt-dod:cpt-noter-dod-ui-dialogs-host-delete:p2
pub fn return_chooses_cancel() {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit hands the monitor a live event, on the main thread.
        let e = unsafe { event.as_ref() };
        let modal = NSApplication::sharedApplication(mtm).modalWindow();
        let cancel = modal
            .filter(|m| {
                RETURN_KEYS.contains(&e.keyCode()) && e.window(mtm).as_deref() == Some(&**m)
            })
            // While the window is shown AppKit keeps Return on its default button cell, not a key equivalent.
            .filter(|m| m.defaultButtonCell().is_none())
            .and_then(|m| m.contentView())
            .and_then(|v| button_for(&v, ESCAPE));
        match cancel {
            Some(button) => {
                // SAFETY: a click on an alert button, on the main thread, with no sender.
                unsafe { button.performClick(None) };
                std::ptr::null_mut()
            }
            None => event.as_ptr(),
        }
    });
    // SAFETY: the block keeps no borrowed state; the monitor lives as long as the app.
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &handler)
    };
    std::mem::forget(monitor);
}
