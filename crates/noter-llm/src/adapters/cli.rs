// @cpt-dod:cpt-noter-dod-core-llm-gate-adapters:p1
//! What the Claude Code and Codex adapters share: the Noter-owned run root, the `--version`
//! probe against the tested range, a per-run directory removed after every outcome, the CLI
//! session behind each session handle, and a child that dies with its future.
//!
//! Run root layout: `work/` (the empty working directory every run starts in), `home/` (a home
//! with nothing of the user's in it), `codex-api/` and `codex-account/` (isolated `CODEX_HOME`s)
//! and `runs/<id>/` (one run's MCP config, schema, instructions and `TMPDIR`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use noter_protocol::error::RuntimeUnavailableReason;
use noter_protocol::{Effort, RuntimeChoice};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use super::{Invocation, Reply};
use crate::runtime::{lock, Availability, BoxFuture, Tested};

/// How Noter runs one CLI. A missing sign-in makes the own-account runtime unavailable; the
/// API-key runtime takes its key from the router's `SecretStore` on each call.
#[derive(Debug, Clone)]
pub struct CliConfig {
    /// The `claude` or `codex` binary.
    pub program: PathBuf,
    /// The user's home: own-account runs reach the sign-in the CLI keeps there.
    pub home: PathBuf,
    /// A Noter-owned directory for run environments (layout above).
    pub run_root: PathBuf,
    /// The user signed in through the CLI itself (own-account runtime).
    pub signed_in: bool,
    /// The models offered, preferred first.
    pub models: Vec<String>,
}

/// Session handle → the CLI's own session id once its first turn answered.
type Sessions = Arc<Mutex<HashMap<String, Option<String>>>>;

pub(crate) struct Cli {
    pub config: CliConfig,
    tested: Tested,
    /// `None` until probed; then the version `--version` printed, `None` when it did not run.
    version: Mutex<Option<Option<String>>>,
    sessions: Sessions,
}

impl Cli {
    pub fn new(config: CliConfig, tested: Tested) -> Self {
        Self {
            config,
            tested,
            version: Mutex::default(),
            sessions: Sessions::default(),
        }
    }

    pub fn refresh(&self) {
        let version = self.probe();
        *lock(&self.version) = Some(version);
    }

    pub fn availability(&self, runtime: RuntimeChoice, api_key: bool) -> Availability {
        let version = lock(&self.version)
            .get_or_insert_with(|| self.probe())
            .clone();
        let unavailable = if version.is_none() {
            Some(RuntimeUnavailableReason::CliMissing)
        } else if api_key {
            None
        } else {
            (!self.config.signed_in).then_some(RuntimeUnavailableReason::AccountSignedOut)
        };
        Availability {
            runtime,
            unavailable,
            path: version
                .as_ref()
                .map(|_| self.config.program.display().to_string()),
            version,
            tested: Some(self.tested),
            models: self.config.models.clone(),
        }
    }

    /// The version token of `<program> --version` ("2.1.296 (Claude Code)", "codex-cli 0.163.0"),
    /// or its whole output when no token parses (refused as outside the range).
    fn probe(&self) -> Option<String> {
        let home = self.dir("home").ok()?;
        let mut probe = std::process::Command::new(&self.config.program);
        probe.arg("--version").env_clear().env("HOME", home);
        if let Some(path) = std::env::var_os("PATH") {
            probe.env("PATH", path);
        }
        let out = probe
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout).trim().to_owned();
        if !out.status.success() || text.is_empty() {
            return None;
        }
        let token = text.split_whitespace().find(|w| Tested::parse(w).is_some());
        Some(token.map_or(text.clone(), String::from))
    }

    /// A Noter-owned directory under the run root, created when missing.
    pub fn dir(&self, name: &str) -> Result<PathBuf, String> {
        let dir = self.config.run_root.join(name);
        std::fs::create_dir_all(&dir).map_err(|_| "run_dir".to_owned())?;
        Ok(dir)
    }

    pub fn open_session(&self, resume: Option<&str>) -> String {
        let handle = format!("cli_{}", ulid::Ulid::generate());
        lock(&self.sessions).insert(handle.clone(), resume.map(String::from));
        handle
    }

    pub fn close_session(&self, handle: &str) {
        lock(&self.sessions).remove(handle);
    }

    /// The CLI session a turn continues: `None` for a run outside a session or a first turn.
    pub fn resume(&self, handle: Option<&str>) -> Result<Option<String>, String> {
        let Some(handle) = handle else {
            return Ok(None);
        };
        let sessions = lock(&self.sessions);
        sessions
            .get(handle)
            .cloned()
            .ok_or_else(|| "session_closed".to_owned())
    }

    /// Runs a prepared child with the packet on stdin and parses its answer. Dropping the future
    /// (timeout, cancel) kills the child; the run directory goes with the future either way.
    pub fn run(
        &self,
        call: &Invocation,
        prepared: Result<(Command, RunDir), String>,
        parse: fn(&[u8]) -> Result<Reply, String>,
    ) -> BoxFuture<'static, Result<Reply, String>> {
        let sessions = self.sessions.clone();
        let handle = call.session.clone();
        let packet = call.packet.clone();
        Box::pin(async move {
            let (command, run) = prepared?;
            let out = output(command, &packet).await;
            drop(run);
            let reply = parse(&out?)?;
            if let (Some(handle), Some(id)) = (handle, &reply.session_id) {
                if let Some(slot) = lock(&sessions).get_mut(&handle) {
                    *slot = Some(id.clone());
                }
            }
            Ok(reply)
        })
    }
}

/// One run's directory under `runs/`, removed when dropped, whatever the outcome.
pub(crate) struct RunDir(PathBuf);

impl RunDir {
    pub fn create(cli: &Cli) -> Result<Self, String> {
        let dir = cli.dir("runs")?.join(ulid::Ulid::generate().to_string());
        std::fs::create_dir(&dir).map_err(|_| "run_dir".to_owned())?;
        Ok(Self(dir))
    }

    pub fn write(&self, name: &str, content: &[u8]) -> Result<PathBuf, String> {
        let path = self.0.join(name);
        std::fs::write(&path, content).map_err(|_| "run_dir".to_owned())?;
        Ok(path)
    }
}

impl Drop for RunDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A child that inherits nothing but `PATH`; the adapter sets `HOME` and the rest.
pub(crate) fn command(cli: &Cli, cwd: &Path, run: &RunDir) -> Command {
    let mut command = Command::new(&cli.config.program);
    command
        .env_clear()
        .env("TMPDIR", &run.0)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        // shortcut: kills the CLI itself, not processes it spawned; M2 runs start no MCP server
        // or tool process. Kill the process group when noter-mcp (M3) runs under the CLI.
        .kill_on_drop(true);
    if let Some(path) = std::env::var_os("PATH") {
        command.env("PATH", path);
    }
    command
}

async fn output(mut command: Command, stdin: &[u8]) -> Result<Vec<u8>, String> {
    let mut child = command.spawn().map_err(|_| "cli_missing".to_owned())?;
    if let Some(mut input) = child.stdin.take() {
        input
            .write_all(stdin)
            .await
            .map_err(|_| "cli_failed".to_owned())?;
    }
    let out = child
        .wait_with_output()
        .await
        .map_err(|_| "cli_failed".to_owned())?;
    if !out.status.success() {
        return Err("cli_failed".into());
    }
    Ok(out.stdout)
}

pub(crate) fn effort(effort: Effort) -> &'static str {
    match effort {
        Effort::Low => "low",
        Effort::Medium => "medium",
        Effort::High => "high",
        Effort::Max => "max",
    }
}
