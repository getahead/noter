//! The native UI tests' launch hooks, compiled into debug builds only: launched with
//! `NOTER_TEST_FIXTURE` (`noter_core_harness::boot::Options::from_env`), the app's core runs on
//! the harness's scripted Mac, engine and models, seeded with the fixture world and put in the
//! scenario the test names, behind the app's real windows, menu bar and notifications.

use std::sync::{Arc, OnceLock};

use noter_core::{EventEmitter, ShortcutRegistrar};
use noter_core_harness::boot::{Harness, Options};
use tauri::Runtime;

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
