//! The native UI tests' launch hooks, compiled into debug builds only: launched with
//! `NOTER_TEST_FIXTURE` (`noter_core_harness::boot::Options::from_env`), the app's core runs on
//! the harness's scripted Mac, engine and models, seeded with the fixture world and put in the
//! scenario the test names, behind the app's real windows, menu bar and notifications.

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use noter_core::{EventEmitter, ShortcutRegistrar};
use noter_core_harness::boot::{Harness, Options};
use tauri::{AppHandle, Runtime};

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
                deps.with_app_version(env!("CARGO_PKG_VERSION"))
                    .with_shortcuts(shortcuts)
                    .with_surfaces(host)
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
