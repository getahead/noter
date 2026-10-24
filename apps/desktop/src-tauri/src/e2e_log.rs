//! The native E2E command log (`cpt-noter-algo-core-native-surfaces-e2e-log`): in a debug build
//! started with `NOTER_E2E_LOG_DIR`, the names of every command the core answered, from windows
//! and native callers alike, written on quit for the E2E coverage gate. Names only, no content.

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

// @cpt-algo:cpt-noter-algo-core-native-surfaces-e2e-log:p2
pub struct E2eLog {
    dir: PathBuf,
    names: Mutex<BTreeSet<String>>,
}

impl E2eLog {
    /// The log, or none in a release build or without a directory.
    pub fn from_env(debug: bool, dir: Option<OsString>) -> Option<E2eLog> {
        // @cpt-begin:cpt-noter-algo-core-native-surfaces-e2e-log:p2:inst-log-off
        let dir = dir.filter(|d| debug && !d.is_empty())?;
        // @cpt-end:cpt-noter-algo-core-native-surfaces-e2e-log:p2:inst-log-off
        Some(E2eLog {
            dir: dir.into(),
            names: Mutex::new(BTreeSet::new()),
        })
    }

    pub fn record(&self, name: &str) {
        // @cpt-begin:cpt-noter-algo-core-native-surfaces-e2e-log:p2:inst-log-record
        let mut names = self.names.lock().unwrap_or_else(|e| e.into_inner());
        names.insert(name.to_string());
        // @cpt-end:cpt-noter-algo-core-native-surfaces-e2e-log:p2:inst-log-record
    }

    /// `commands-native-app-<pid>.json` in the log directory.
    pub fn write(&self, pid: u32) -> std::io::Result<PathBuf> {
        // @cpt-begin:cpt-noter-algo-core-native-surfaces-e2e-log:p2:inst-log-write
        let names = self.names.lock().unwrap_or_else(|e| e.into_inner());
        let data = serde_json::json!({
            "suite": "native",
            "target": "app",
            "commands": names.iter().collect::<Vec<_>>(),
            "stories": [],
        });
        std::fs::create_dir_all(&self.dir)?;
        let path = self.dir.join(format!("commands-native-app-{pid}.json"));
        std::fs::write(&path, format!("{data:#}\n"))?;
        // @cpt-end:cpt-noter-algo-core-native-surfaces-e2e-log:p2:inst-log-write
        // @cpt-begin:cpt-noter-algo-core-native-surfaces-e2e-log:p2:inst-log-return
        Ok(path)
        // @cpt-end:cpt-noter-algo-core-native-surfaces-e2e-log:p2:inst-log-return
    }
}

/// The app's log, read from the environment once.
fn log() -> Option<&'static E2eLog> {
    static LOG: OnceLock<Option<E2eLog>> = OnceLock::new();
    LOG.get_or_init(|| {
        E2eLog::from_env(
            cfg!(debug_assertions),
            std::env::var_os("NOTER_E2E_LOG_DIR"),
        )
    })
    .as_ref()
}

/// A command answered: its name goes into the log, when there is one.
pub fn record(name: &str) {
    if let Some(log) = log() {
        log.record(name);
    }
}

/// On quit: the log file, when there is one.
pub fn write_on_quit() {
    if let Some(log) = log() {
        if let Err(e) = log.write(std::process::id()) {
            eprintln!("noter: the E2E command log was not written: {e}");
        }
    }
}
