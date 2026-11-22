//! Executable test scripts without "Text file busy" (#1102, #1159). A script this process writes
//! itself is open for writing in it, and every child another test thread forks meanwhile inherits
//! that descriptor until it execs: on Linux, running the script then fails with ETXTBSY. `sh`
//! writes and marks it in a child process instead, so this process never holds it open.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

/// Writes `body` to `path` as an executable (0755) and returns once it is complete.
pub fn write_executable(path: &Path, body: &str) {
    let mut sh = Command::new("sh")
        .args(["-c", "cat > \"$0\" && chmod 755 \"$0\""])
        .arg(path)
        .stdin(Stdio::piped())
        .spawn()
        .expect("sh starts");
    sh.stdin
        .take()
        .expect("sh stdin")
        .write_all(body.as_bytes())
        .expect("the script reaches sh");
    assert!(sh.wait().expect("sh ends").success(), "sh wrote {path:?}");
}
