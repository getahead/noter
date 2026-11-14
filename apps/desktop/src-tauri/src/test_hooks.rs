//! The native UI tests' launch hooks, compiled into debug builds with `test-hooks` only: launched with
//! `NOTER_TEST_FIXTURE` (`noter_core_harness::boot::Options::from_env`), the app's core runs on
//! the harness's scripted Mac, engine and models, seeded with the fixture world and put in the
//! scenario the test names, behind the app's real windows, menu bar and notifications.

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use noter_core::{EventEmitter, ShortcutRegistrar};
use noter_core_harness::boot::{Harness, Options};
use tauri::{AppHandle, Manager, Runtime, Webview};

use crate::native::{MacOps, Windows};
use crate::surfaces::TauriSurfaces;
use crate::Booted;

/// Kept for the app's lifetime: it feeds the scripted engine's meters.
static HARNESS: OnceLock<Arc<Harness>> = OnceLock::new();

/// `None` without the hooks; otherwise the core they booted, or why they could not.
pub fn boot<R: Runtime>(
    events: Arc<dyn EventEmitter>,
    shortcuts: Arc<dyn ShortcutRegistrar>,
    surfaces: &Arc<TauriSurfaces<R>>,
) -> Option<Booted> {
    let started = match Options::from_env(|k| std::env::var(k).ok()) {
        Ok(options) => {
            let host = surfaces.clone();
            // The windows are real, so the displays they are placed on are the Mac's own.
            let options = Options {
                displays: Some(noter_native::environment(&std::env::temp_dir()).displays),
                ..options?
            };
            tauri::async_runtime::block_on(Harness::start_with(options, events, move |deps| {
                let deps = deps
                    .with_app_version(env!("CARGO_PKG_VERSION"))
                    .with_shortcuts(shortcuts)
                    .with_surfaces(host.clone());
                if std::env::var_os("NOTER_TEST_NATIVE_FOLDER_PANEL").as_deref()
                    == Some(std::ffi::OsStr::new("1"))
                {
                    let windows: Arc<dyn Windows> = host;
                    deps.with_native_ops(Arc::new(MacOps::new(windows)))
                } else {
                    deps
                }
            }))
        }
        Err(e) => Err(e),
    };
    Some(Booted(match started {
        Ok(harness) => {
            let core = harness.core();
            surfaces.attach(&core);
            let _ = HARNESS.set(harness);
            Ok(core)
        }
        Err(e) => {
            eprintln!("noter: test hooks: {e}");
            Err(format!("test hooks: {e}"))
        }
    }))
}

/// The chord a test asked to press, once: the file is removed as it is read.
fn take_trigger(path: &Path) -> Option<String> {
    let chord = std::fs::read_to_string(path).ok()?;
    std::fs::remove_file(path).ok()?;
    Some(chord.trim().to_string())
}

/// Presses the chords a native test writes, e.g. `Ctrl+Alt+Super+0`, to the file it names in
/// `NOTER_TEST_HOTKEY_FILE`, through the same path a registered global shortcut takes
/// (`hotkey_pressed`). Typing the chord on the runner goes through Finder and is slow and flaky;
/// the registration and the delivery of a typed chord have their own tests. The path is given
/// whole, not under the app's temp folder: on the CI runner a trigger there was never taken (#536).
pub fn watch_hotkey_trigger<R: Runtime>(app: AppHandle<R>) {
    let Some(path) = std::env::var_os("NOTER_TEST_HOTKEY_FILE").map(PathBuf::from) else {
        return;
    };
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(50));
        if let Some(chord) = take_trigger(&path) {
            crate::hotkey_pressed(&app, &chord);
        }
    });
}

/// How long a debug app waits for a test to ask for the stall.
const STALL_ASK_WINDOW: std::time::Duration = std::time::Duration::from_secs(120);

/// With `NOTER_TEST_TERMINATE_APP_FILE`, asks AppKit to terminate once the test creates the file.
#[cfg(target_os = "macos")]
pub fn watch_termination_trigger<R: Runtime>(app: AppHandle<R>) {
    let Some(file) = std::env::var_os("NOTER_TEST_TERMINATE_APP_FILE").map(PathBuf::from) else {
        return;
    };
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + STALL_ASK_WINDOW;
        while !file.exists() {
            if std::time::Instant::now() >= deadline {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        if let Err(error) = std::fs::remove_file(&file) {
            eprintln!("noter: test hook could not consume AppKit termination trigger: {error}");
            return;
        }
        if let Err(error) = app.run_on_main_thread(|| {
            use objc2::MainThreadMarker;
            use objc2_app_kit::NSApplication;
            if let Some(mtm) = MainThreadMarker::new() {
                NSApplication::sharedApplication(mtm).terminate(None);
            }
        }) {
            eprintln!("noter: test hook could not request AppKit termination: {error}");
        }
    });
}

/// With `NOTER_TEST_STALL_FILE`, stalls the main window's page once, when the test creates that
/// file (after it has seen the page; a timer was too short on a slow runner, #578): its web process
/// is stopped and the page reloaded, so the load hangs like the CI runner's (#521) until the watch
/// (`webview_watch`) gives the page a new process. "stalled" is written into the file once the page
/// is stalled. The path is given whole, like `NOTER_TEST_HOTKEY_FILE`. Nothing is stalled if the
/// file never appears: the polling stops after `STALL_ASK_WINDOW`.
pub fn stall_after_load<R: Runtime>(webview: &Webview<R>) {
    static STALLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let Some(file) = std::env::var_os("NOTER_TEST_STALL_FILE").map(PathBuf::from) else {
        return;
    };
    if webview.label() != "main" || STALLED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let webview = webview.clone();
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + STALL_ASK_WINDOW;
        while !file.exists() {
            if std::time::Instant::now() >= deadline {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        // The reload never reports its start from a stopped process: it is reported here.
        if let Some(watch) = webview.try_state::<crate::webview_watch::Watch>() {
            crate::webview_watch::lock(&watch).started(webview.label(), std::time::Instant::now());
        }
        let reload = webview.clone();
        let _ = webview.with_webview(move |platform| {
            stop_content_process(platform.inner());
            let _ = reload.reload();
            let _ = std::fs::write(&file, "stalled");
        });
    });
}

/// With `NOTER_TEST_TERMINATE_WEB_PROCESS_FILE`, terminates the loaded call page when the test
/// creates the file. The watcher must then reload the page and restore its snapshot and stream.
// @cpt-flow:cpt-noter-flow-ui-call-window-hide-reopen:p1
pub fn terminate_after_load<R: Runtime>(webview: &Webview<R>) {
    static WAITING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let Some(file) = std::env::var_os("NOTER_TEST_TERMINATE_WEB_PROCESS_FILE").map(PathBuf::from)
    else {
        return;
    };
    if webview.label() != "call-screen" || WAITING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let webview = webview.clone();
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + STALL_ASK_WINDOW;
        while !file.exists() {
            if std::time::Instant::now() >= deadline {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let result = file.clone();
        let _ = webview.with_webview(move |platform| {
            let pid = crate::webview_watch::web_process_id(platform.inner()).unwrap_or_default();
            let killed = pid > 0
                && std::process::Command::new("kill")
                    .args(["-KILL", &pid.to_string()])
                    .status()
                    .is_ok_and(|status| status.success());
            if killed {
                let _ = std::fs::write(result, "terminated");
            }
        });
    });
}

/// shortcut: private WebKit API (WKWebViewPrivate `_webProcessIdentifier`), debug builds only: a
/// test has no other way to find the web view's content process.
fn stop_content_process(webview: *mut std::ffi::c_void) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    // SAFETY: `webview` is the WKWebView Tauri hands to `with_webview`, used on the main thread;
    // `_webProcessIdentifier` takes nothing and returns a pid_t.
    let pid: i32 = match unsafe { (webview as *const AnyObject).as_ref() } {
        Some(webview) => unsafe { msg_send![webview, _webProcessIdentifier] },
        None => 0,
    };
    if pid > 0 {
        let _ = std::process::Command::new("kill")
            .args(["-STOP", &pid.to_string()])
            .status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_trigger_is_taken_once_and_trimmed() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("noter-test-hotkey");
        assert_eq!(take_trigger(&file), None);
        std::fs::write(&file, "Ctrl+Alt+Super+0\n").unwrap();
        assert_eq!(take_trigger(&file).as_deref(), Some("Ctrl+Alt+Super+0"));
        assert_eq!(take_trigger(&file), None);
    }
}
