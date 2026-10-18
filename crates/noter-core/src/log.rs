//! The local log (`logs/noter.log`, JSON lines, mode 0600): never transcript, document or model text.

use std::fs::{DirBuilder, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::Path;
use std::sync::Mutex;

use serde_json::{Map, Value};

/// Longest free-text value (characters) a log line keeps.
pub const LOG_MESSAGE_MAX: usize = 200;

/// The only fields a log line may carry.
const ALLOWED: &[&str] = &[
    "level",
    "module",
    "window",
    "screen",
    "command",
    "code",
    "id",
    "duration_ms",
    "count",
    "message",
];

pub(crate) struct Logger(Mutex<File>);

impl Logger {
    pub(crate) fn open(data_dir: &Path) -> std::io::Result<Logger> {
        let dir = data_dir.join("logs");
        DirBuilder::new().recursive(true).mode(0o700).create(&dir)?;
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o600)
            .open(dir.join("noter.log"))?;
        Ok(Logger(Mutex::new(file)))
    }

    /// Scrubs the record, stamps it with `ts` and appends it as one line.
    pub(crate) fn write(&self, record: Map<String, Value>, ts: i64) -> std::io::Result<()> {
        self.append(scrub(record), ts)
    }

    /// Appends a scrubbed record, stamped with `ts`, as one line.
    pub(crate) fn append(&self, mut line: Map<String, Value>, ts: i64) -> std::io::Result<()> {
        line.insert("ts".into(), ts.into());
        let mut text = Value::Object(line).to_string();
        text.push('\n');
        let mut file = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        file.write_all(text.as_bytes())
    }
}

// @cpt-algo:cpt-noter-algo-core-ipc-host-scrub-log:p1
pub(crate) fn scrub(record: Map<String, Value>) -> Map<String, Value> {
    // @cpt-begin:cpt-noter-algo-core-ipc-host-scrub-log:p1:inst-allow-list
    let mut kept: Map<String, Value> = record
        .into_iter()
        .filter(|(k, v)| ALLOWED.contains(&k.as_str()) && !v.is_object() && !v.is_array())
        .collect();
    // @cpt-end:cpt-noter-algo-core-ipc-host-scrub-log:p1:inst-allow-list
    // @cpt-begin:cpt-noter-algo-core-ipc-host-scrub-log:p1:inst-truncate
    for value in kept.values_mut() {
        if let Value::String(text) = value {
            if text.chars().count() > LOG_MESSAGE_MAX {
                *text = text.chars().take(LOG_MESSAGE_MAX).collect();
            }
        }
    }
    // @cpt-end:cpt-noter-algo-core-ipc-host-scrub-log:p1:inst-truncate
    // @cpt-begin:cpt-noter-algo-core-ipc-host-scrub-log:p1:inst-return-scrubbed
    kept
    // @cpt-end:cpt-noter-algo-core-ipc-host-scrub-log:p1:inst-return-scrubbed
}
