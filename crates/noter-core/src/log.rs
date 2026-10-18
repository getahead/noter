//! The local log (`logs/noter.log`, JSON lines, mode 0600): never transcript, document or model
//! text, and no free text at all: a line holds allow-listed fields with identifiers and numbers.

use std::fs::{DirBuilder, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::Path;
use std::sync::Mutex;

use serde_json::{Map, Value};

/// Longest identifier a log line keeps (a screen, a command, an id).
const ID_MAX: usize = 64;

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
    "message_len",
];

pub(crate) struct Logger(Mutex<File>);

impl Logger {
    pub(crate) fn open(data_dir: &Path) -> std::io::Result<Logger> {
        // shortcut: the log has no size bound yet; rotation is M5 maintenance (core-maintenance).
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
    kept.retain(|_, v| v.as_str().map_or(true, is_identifier));
    // @cpt-end:cpt-noter-algo-core-ipc-host-scrub-log:p1:inst-truncate
    // @cpt-begin:cpt-noter-algo-core-ipc-host-scrub-log:p1:inst-return-scrubbed
    kept
    // @cpt-end:cpt-noter-algo-core-ipc-host-scrub-log:p1:inst-return-scrubbed
}

/// Text a log may keep: a short identifier (`call-page`, `transcript_subscribe`, `noter-db:2`).
fn is_identifier(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= ID_MAX
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
}
