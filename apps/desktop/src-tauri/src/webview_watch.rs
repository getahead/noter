//! A window whose page does not finish loading in time gets a new web process (#521). On the
//! macOS 15 CI runner a WebKit content process can hang in its first frame (in Metal's shader
//! cache lock) and never answer again: its window stays blank, and every accessibility query that
//! reaches it waits on it. WebKit does not notice a process that hangs, so the host watches each
//! page load: one still unfinished after `BOUND` has its content process ended and is reloaded.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, Runtime};

/// A page that loads takes a second or two; this is far past any slow but live load.
pub const BOUND: Duration = Duration::from_secs(10);
/// Restarts of one page in a row before the watch gives up on it.
pub const ATTEMPTS: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Load {
    Loading { since: Instant, restarts: u32 },
    Loaded,
}

/// The page loads of the app's webviews, by label.
#[derive(Debug, Default)]
pub struct Loads(HashMap<String, Load>);

impl Loads {
    /// A webview was created: its first page is loading unless a load already reported.
    pub fn created(&mut self, label: &str, now: Instant) {
        self.0.entry(label.into()).or_insert(Load::Loading {
            since: now,
            restarts: 0,
        });
    }

    /// A load started; a restart's reload keeps the count of restarts.
    pub fn started(&mut self, label: &str, now: Instant) {
        let restarts = match self.0.get(label) {
            Some(Load::Loading { restarts, .. }) => *restarts,
            _ => 0,
        };
        self.0.insert(
            label.into(),
            Load::Loading {
                since: now,
                restarts,
            },
        );
    }

    pub fn finished(&mut self, label: &str) {
        self.0.insert(label.into(), Load::Loaded);
    }

    pub fn closed(&mut self, label: &str) {
        self.0.remove(label);
    }

    /// The webviews to restart now: each load older than `BOUND`, at most `ATTEMPTS` times in a
    /// row. A restarted page is loading again from `now`; one out of attempts is left alone.
    pub fn due(&mut self, now: Instant) -> Vec<String> {
        let mut due = Vec::new();
        for (label, load) in self.0.iter_mut() {
            let Load::Loading { since, restarts } = *load else {
                continue;
            };
            if now.duration_since(since) < BOUND {
                continue;
            }
            if restarts >= ATTEMPTS {
                eprintln!("noter: the {label} page still does not load; it is left as it is");
                *load = Load::Loaded;
            } else {
                *load = Load::Loading {
                    since: now,
                    restarts: restarts + 1,
                };
                due.push(label.clone());
            }
        }
        due
    }
}

/// The app's `Loads`, managed state the page-load and window hooks report to.
pub type Watch = Arc<Mutex<Loads>>;

pub fn lock(watch: &Watch) -> std::sync::MutexGuard<'_, Loads> {
    watch.lock().unwrap_or_else(|e| e.into_inner())
}

/// Starts the watch: every webview that exists now is loading, and once a second each overdue
/// page is restarted.
pub fn start<R: Runtime>(app: &AppHandle<R>) -> Watch {
    let watch = Watch::default();
    for label in app.webview_windows().keys() {
        lock(&watch).created(label, Instant::now());
    }
    let (app, polled) = (app.clone(), watch.clone());
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let due = lock(&polled).due(Instant::now());
        for label in due {
            restart(&app, &label);
        }
    });
    watch
}

/// Ends the webview's content process and reloads its page in a new one.
fn restart<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let Some(webview) = app.get_webview_window(label) else {
        return;
    };
    eprintln!("noter: the {label} page did not load in {BOUND:?}; its web process is restarted");
    let reload = webview.clone();
    let _ = webview.with_webview(move |platform| {
        end_content_process(platform.inner());
        let _ = reload.reload();
    });
}

/// shortcut: private WebKit API (WKWebViewPrivate `_webProcessIdentifier` and
/// `_killWebContentProcessAndResetState`, each checked with respondsToSelector:): WebKit has no
/// public call that ends a web view's content process; switch when one appears. WebKit only
/// detaches the process, which a hung one never notices, so it is also killed.
fn end_content_process(webview: *mut std::ffi::c_void) {
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};
    extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    const SIGKILL: i32 = 9;
    // SAFETY: `webview` is the WKWebView Tauri hands to `with_webview`, used on the main thread.
    let Some(webview) = (unsafe { (webview as *const AnyObject).as_ref() }) else {
        return;
    };
    // SAFETY: respondsToSelector: is NSObject API; `_webProcessIdentifier` returns a pid_t and
    // `_killWebContentProcessAndResetState` takes and returns nothing; kill(2) takes a pid.
    unsafe {
        let pid: i32 = if msg_send![webview, respondsToSelector: sel!(_webProcessIdentifier)] {
            msg_send![webview, _webProcessIdentifier]
        } else {
            0
        };
        if msg_send![webview, respondsToSelector: sel!(_killWebContentProcessAndResetState)] {
            let _: () = msg_send![webview, _killWebContentProcessAndResetState];
        }
        if pid > 0 {
            kill(pid, SIGKILL);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(start: Instant, secs: u64) -> Instant {
        start + Duration::from_secs(secs)
    }

    #[test]
    fn a_page_that_loads_in_time_is_never_restarted() {
        let (mut loads, t) = (Loads::default(), Instant::now());
        loads.created("main", t);
        loads.started("main", at(t, 1));
        assert!(loads.due(at(t, 5)).is_empty());
        loads.finished("main");
        assert!(loads.due(at(t, 60)).is_empty());
    }

    #[test]
    fn a_window_created_after_its_page_loaded_stays_loaded() {
        let (mut loads, t) = (Loads::default(), Instant::now());
        loads.finished("main");
        loads.created("main", t);
        assert!(loads.due(at(t, 60)).is_empty());
    }

    #[test]
    fn a_stuck_page_is_restarted_each_bound_until_attempts_run_out() {
        let (mut loads, t) = (Loads::default(), Instant::now());
        // A content process that hangs before its first load reports anything.
        loads.created("call-screen", t);
        assert!(loads.due(at(t, 9)).is_empty());
        let mut restarts = 0;
        for s in (10..200).step_by(10) {
            for label in loads.due(at(t, s)) {
                restarts += 1;
                // The reload starts, and its new process hangs too.
                loads.started(&label, at(t, s + 1));
            }
        }
        assert_eq!(restarts, ATTEMPTS);
        loads.created("call-screen", at(t, 300));
        assert!(loads.due(at(t, 400)).is_empty(), "given up: left alone");
    }

    #[test]
    fn a_restarted_page_that_loads_is_watched_afresh() {
        let (mut loads, t) = (Loads::default(), Instant::now());
        loads.created("main", t);
        assert_eq!(loads.due(at(t, 10)), vec!["main".to_string()]);
        loads.finished("main");
        loads.started("main", at(t, 20));
        for s in [30, 40, 50] {
            assert_eq!(
                loads.due(at(t, s)).len(),
                1,
                "a new load has all its attempts"
            );
        }
    }

    #[test]
    fn a_closed_window_is_forgotten() {
        let (mut loads, t) = (Loads::default(), Instant::now());
        loads.created("settings", t);
        loads.closed("settings");
        assert!(loads.due(at(t, 60)).is_empty());
    }
}
