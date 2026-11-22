// @cpt-dod:cpt-noter-dod-core-llm-gate-adapters:p1
//! What the Claude Code and Codex adapters share: the Noter-owned run root, the `--version`
//! probe against the tested range, a per-run directory removed after every outcome, the CLI
//! session behind each session handle, and a child that dies with its future.
//!
//! Run root layout: `work/` (the empty working directory every run starts in), `home/` (a home
//! with nothing of the user's in it), `codex-api/` and `codex-account/` (isolated `CODEX_HOME`s)
//! and `runs/<id>/` (one run's MCP config, schema, instructions and `TMPDIR`).

use std::collections::HashMap;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use noter_protocol::error::RuntimeUnavailableReason;
use noter_protocol::model::{AccountIdentity, AccountProvider, CliTool};
use noter_protocol::{Effort, RuntimeChoice};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use super::{Invocation, Reply};
use crate::account_cli::{tool_of, AccountCli, CliError, CliStatus, LoginOutcome, LoginStart};
use crate::runtime::{lock, Availability, BoxFuture, Tested};

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

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
    /// The user signed in through the CLI itself (own-account runtime): the answer until a
    /// CLI with a status probe (Claude Code's `auth status`) has told otherwise.
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
    /// What the CLI's own status last said about the sign-in; `None` until it said anything.
    signed_in: Mutex<Option<bool>>,
    sessions: Sessions,
}

impl Cli {
    pub fn new(config: CliConfig, tested: Tested) -> Self {
        Self {
            config,
            tested,
            version: Mutex::default(),
            signed_in: Mutex::default(),
            sessions: Sessions::default(),
        }
    }

    pub fn refresh(&self) {
        let version = self.probe();
        *lock(&self.version) = Some(version);
    }

    // @cpt-begin:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-clis
    /// Asks the CLI whether the user is signed in (`claude auth status`, `codex login status`
    /// against the home the account runs use). A probe that failed or printed something
    /// unreadable is unknown and keeps the last answer.
    pub async fn observe_sign_in(&self, tool: CliTool) {
        let codex_home = self.config.home.join(".codex");
        let status = auth_state(tool, &self.config.program, &codex_home).await;
        if let Some(identity) = status {
            *lock(&self.signed_in) = Some(identity.is_some());
        }
    }
    // @cpt-end:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-clis

    pub fn availability(&self, runtime: RuntimeChoice, api_key: bool) -> Availability {
        let signed_in = (*lock(&self.signed_in)).unwrap_or(self.config.signed_in);
        let cached = lock(&self.version).clone();
        let version = match cached {
            Some(version) => version,
            None => {
                let detected = self.probe();
                let mut cached = lock(&self.version);
                cached.get_or_insert(detected).clone()
            }
        };
        let unavailable = if version.is_none() {
            Some(RuntimeUnavailableReason::CliMissing)
        } else if api_key {
            None
        } else {
            (!signed_in).then_some(RuntimeUnavailableReason::AccountSignedOut)
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
        probe
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = probe.spawn().ok()?;
        let started = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if started.elapsed() < PROBE_TIMEOUT => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Ok(None) | Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
            }
        }
        let out = child.wait_with_output().ok()?;
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
        // The run's config may carry its tool token: the user's eyes only.
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "run_dir".to_owned())?;
        Ok(Self(dir))
    }

    pub fn write(&self, name: &str, content: &[u8]) -> Result<PathBuf, String> {
        let path = self.0.join(name);
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .and_then(|mut f| f.write_all(content))
            .map_err(|_| "run_dir".to_owned())?;
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
        // shortcut: kills the CLI itself, not processes it spawned; noter-mcp under it ends on its
        // stdio EOF and its socket token is revoked when the run ends. Kill the process group if
        // a CLI ever keeps its MCP child alive.
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

// ── the account seam over the pinned CLIs (TL-32) ──
// Formats recorded from the real CLIs in `tests/fixtures/cli-auth` (`tests/cli_auth_contract.rs`).

/// How long a login may take to print its page.
const LOGIN_PAGE_TIMEOUT: Duration = Duration::from_secs(20);

/// The official install command of each tool, pinned to the version the adapter was tested with
/// (the lower end of its `TESTED` range), and the hosts it reaches, all in the `cli_install`
/// group of the egress allow-list.
// shortcut: Ollama has no tested range, so its installer takes the latest.
pub(crate) const INSTALLERS: [(CliTool, &str, &[&str]); 3] = [
    (
        CliTool::ClaudeCode,
        "curl -fsSL https://claude.ai/install.sh | bash -s 2.1.0",
        &["claude.ai", "storage.googleapis.com"],
    ),
    (
        CliTool::Codex,
        "npm install -g @openai/codex@0.163.0",
        &["registry.npmjs.org"],
    ),
    (
        CliTool::Ollama,
        "curl -fsSL https://ollama.com/install.sh | sh",
        &["ollama.com", "github.com", "objects.githubusercontent.com"],
    ),
];

/// Claude Code, Codex and Ollama as installed on this Mac.
pub struct CliAccounts {
    pub claude: PathBuf,
    pub codex: PathBuf,
    pub ollama: PathBuf,
    /// The `CODEX_HOME` whose sign-in own-account Codex runs use (`~/.codex`).
    pub codex_home: PathBuf,
}

impl CliAccounts {
    fn program(&self, tool: CliTool) -> &Path {
        match tool {
            CliTool::ClaudeCode => &self.claude,
            CliTool::Codex => &self.codex,
            CliTool::Ollama => &self.ollama,
        }
    }
}

async fn run_text(program: &Path, args: &[&str]) -> Option<String> {
    let out = tokio::time::timeout(
        PROBE_TIMEOUT,
        Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
}

/// One run of a CLI subcommand: whether it exited 0, its stdout and its stderr. `None` when it
/// did not start or did not end within the probe deadline.
async fn run_probe(
    program: &Path,
    args: &[&str],
    codex_home: Option<&Path>,
) -> Option<(bool, String, String)> {
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null()).kill_on_drop(true);
    if let Some(home) = codex_home {
        command.env("CODEX_HOME", home);
    }
    let out = tokio::time::timeout(PROBE_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()?;
    let text = |b: &[u8]| String::from_utf8_lossy(b).trim().to_owned();
    Some((out.status.success(), text(&out.stdout), text(&out.stderr)))
}

// @cpt-begin:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-clis
/// Who the CLI is signed in as: `Some(None)` for an explicit sign-out, `None` when unknown.
/// `claude auth status` prints JSON and exits 1 when signed out; Codex answers through its
/// app-server, or `codex login status` (one line on stderr, exit 1 when signed out) without one.
async fn auth_state(
    tool: CliTool,
    program: &Path,
    codex_home: &Path,
) -> Option<Option<AccountIdentity>> {
    match tool {
        CliTool::ClaudeCode => {
            let (_, stdout, _) = run_probe(program, &["auth", "status"], None).await?;
            claude_auth_status(&stdout)
        }
        CliTool::Codex => match codex_account(program, codex_home).await {
            Some(account) => Some(account),
            // An app-server that did not answer: `login status` can still say signed out.
            None => {
                let (_, stdout, stderr) =
                    run_probe(program, &["login", "status"], Some(codex_home)).await?;
                format!("{stdout}\n{stderr}")
                    .contains("Not logged in")
                    .then_some(None)
            }
        },
        CliTool::Ollama => None,
    }
}
// @cpt-end:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-clis

// @cpt-begin:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-clis
// @cpt-begin:cpt-noter-algo-core-credentials-privacy-secret-boundary:p1:inst-secret-account
/// Asks Codex itself who is signed in: one `account/read` to a one-shot `codex app-server`
/// (JSON lines on stdio), which never refreshes the token. Noter reads no token file.
async fn codex_account(program: &Path, codex_home: &Path) -> Option<Option<AccountIdentity>> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    let mut child = Command::new(program)
        .arg("app-server")
        .env("CODEX_HOME", codex_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .ok()?;
    let mut stdin = child.stdin.take()?;
    let mut lines = BufReader::new(child.stdout.take()?).lines();
    let ask = async {
        for request in [
            r#"{"id":1,"method":"initialize","params":{"clientInfo":{"name":"noter","version":"0"}}}"#,
            r#"{"method":"initialized"}"#,
            r#"{"id":2,"method":"account/read","params":{"refreshToken":false}}"#,
        ] {
            stdin
                .write_all(format!("{request}\n").as_bytes())
                .await
                .ok()?;
        }
        // stdin stays open until the answer: the app-server ends on EOF before answering.
        while let Some(line) = lines.next_line().await.ok()? {
            let reply: serde_json::Value = serde_json::from_str(&line).unwrap_or_default();
            if reply["id"] == 2 {
                return Some(reply);
            }
        }
        None
    };
    let reply = tokio::time::timeout(PROBE_TIMEOUT, ask).await.ok()??;
    let account = &reply["result"]["account"];
    match account["type"].as_str() {
        _ if reply["result"].is_null() => None,
        None | Some("apiKey") => Some(None),
        Some("chatgpt") => Some(Some(AccountIdentity {
            // shortcut: an account without an email shows none; the plan still decides.
            email: account["email"].as_str().unwrap_or_default().to_owned(),
            plan: account["planType"].as_str().unwrap_or_default().to_owned(),
        })),
        Some(_) => Some(None),
    }
}
// @cpt-end:cpt-noter-algo-core-credentials-privacy-secret-boundary:p1:inst-secret-account
// @cpt-end:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-clis

/// The page (and Codex's one-time code) a login printed so far; `None` until complete. Claude
/// prints the page as an OSC 8 link, Codex both in ANSI colour.
fn login_page(provider: AccountProvider, text: &str) -> Option<(String, Option<String>)> {
    // The page is complete once a terminator follows it (a read may end mid-URL).
    let url = regex::Regex::new(r"(https://[^\s\x07\x1b]+)[\s\x07\x1b]").ok()?;
    let url = url.captures(text)?.get(1)?.as_str().to_owned();
    if provider == AccountProvider::Claude {
        return Some((url, None));
    }
    let plain = regex::Regex::new(r"\x1b\[[0-9;]*m")
        .ok()?
        .replace_all(text, "");
    let code = regex::Regex::new(r"\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\s").ok()?;
    let code = code.find(&plain)?.as_str().trim_end().to_owned();
    Some((url, Some(code)))
}

/// The identity `claude auth status` prints (JSON with `email` and `subscriptionType`).
pub(crate) fn claude_identity(text: &str) -> Option<AccountIdentity> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    if v["loggedIn"] != true {
        return None;
    }
    Some(AccountIdentity {
        email: v["email"].as_str()?.to_owned(),
        plan: v["subscriptionType"]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
    })
}

fn claude_auth_status(text: &str) -> Option<Option<AccountIdentity>> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    match v["loggedIn"].as_bool()? {
        false => Some(None),
        true => claude_identity(text).map(Some),
    }
}

impl AccountCli for CliAccounts {
    fn status(&self, tool: CliTool) -> BoxFuture<'_, CliStatus> {
        Box::pin(async move {
            let program = self.program(tool);
            let Some(text) = run_text(program, &["--version"]).await else {
                return CliStatus::missing();
            };
            let version = text
                .split_whitespace()
                .find(|w| Tested::parse(w).is_some())
                .map_or(text.clone(), String::from);
            let tested = match tool {
                CliTool::ClaudeCode => Some(super::claude_code::TESTED),
                CliTool::Codex => Some(super::codex::TESTED),
                CliTool::Ollama => None,
            };
            let (identity, auth_known) = match auth_state(tool, program, &self.codex_home).await {
                Some(identity) => (identity, true),
                None => (None, false),
            };
            CliStatus {
                installed: true,
                path: Some(program.display().to_string()),
                supported: tested.map_or(true, |t| t.admits(&version)),
                version: Some(version),
                identity,
                auth_known,
            }
        })
    }

    // @cpt-begin:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-start
    // @cpt-begin:cpt-noter-algo-core-credentials-privacy-secret-boundary:p1:inst-secret-account
    /// Runs the CLI's own browser login (`claude auth login`, `codex login --device-auth` into
    /// the account home) and hands back the page it printed; the CLI keeps the sign-in.
    fn login(&self, provider: AccountProvider) -> BoxFuture<'_, Result<LoginStart, CliError>> {
        Box::pin(async move {
            use tokio::io::AsyncReadExt;
            let tool = tool_of(provider);
            let program = self.program(tool).to_path_buf();
            let mut command = Command::new(&program);
            match provider {
                AccountProvider::Claude => command.args(["auth", "login", "--claudeai"]),
                AccountProvider::Chatgpt => command
                    .args(["login", "--device-auth"])
                    .env("CODEX_HOME", &self.codex_home),
            };
            // stdin stays open: Claude Code waits on it for a pasted code.
            command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true);
            let mut child = command.spawn().map_err(|_| CliError::Missing)?;
            let stdin = child.stdin.take();
            let mut stdout = child
                .stdout
                .take()
                .ok_or(CliError::Failed("stdout".into()))?;
            let mut seen = Vec::new();
            let read_page = async {
                let mut buf = [0u8; 4096];
                loop {
                    let n = stdout.read(&mut buf).await.ok()?;
                    if n == 0 {
                        return None;
                    }
                    seen.extend_from_slice(&buf[..n]);
                    if let Some(page) = login_page(provider, &String::from_utf8_lossy(&seen)) {
                        return Some(page);
                    }
                }
            };
            let Ok(Some((url, code))) = tokio::time::timeout(LOGIN_PAGE_TIMEOUT, read_page).await
            else {
                return Err(CliError::Failed("the login printed no page".into()));
            };
            let codex_home = self.codex_home.clone();
            // Dropping `done` (cancel, timeout, a new sign-in) kills the CLI.
            let done: BoxFuture<'static, LoginOutcome> = Box::pin(async move {
                let _stdin = stdin;
                let mut sink = tokio::io::sink();
                let drain = tokio::io::copy(&mut stdout, &mut sink);
                let (exit, _) = tokio::join!(child.wait(), drain);
                match exit {
                    Ok(exit) if exit.success() => {
                        match auth_state(tool, &program, &codex_home).await {
                            Some(Some(identity)) => LoginOutcome::SignedIn(identity),
                            _ => LoginOutcome::Failed("not signed in after the login".into()),
                        }
                    }
                    Ok(exit) => LoginOutcome::Failed(format!("login exit {:?}", exit.code())),
                    Err(_) => LoginOutcome::Failed("login wait".into()),
                }
            });
            Ok(LoginStart { url, code, done })
        })
    }
    // @cpt-end:cpt-noter-algo-core-credentials-privacy-secret-boundary:p1:inst-secret-account
    // @cpt-end:cpt-noter-flow-core-credentials-privacy-signin:p1:inst-signin-start

    /// Nothing to do: the core ends a pending sign-in by dropping its `done`, which kills the CLI.
    fn cancel(&self, _: AccountProvider) {}

    // @cpt-begin:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-signout-apply
    fn logout(&self, provider: AccountProvider) -> BoxFuture<'_, Result<(), CliError>> {
        Box::pin(async move {
            let program = self.program(tool_of(provider));
            let ran = match provider {
                AccountProvider::Claude => run_probe(program, &["auth", "logout"], None).await,
                AccountProvider::Chatgpt => {
                    run_probe(program, &["logout"], Some(&self.codex_home)).await
                }
            };
            match ran {
                Some((true, _, _)) => Ok(()),
                _ => Err(CliError::Failed("the CLI's logout failed".into())),
            }
        })
    }
    // @cpt-end:cpt-noter-flow-core-credentials-privacy-bind-signout:p1:inst-signout-apply

    fn install(&self, tool: CliTool) -> BoxFuture<'_, Result<CliStatus, CliError>> {
        Box::pin(async move {
            let (_, command, _) = INSTALLERS
                .iter()
                .find(|(t, _, _)| *t == tool)
                .ok_or(CliError::Failed("no installer".into()))?;
            let done = Command::new("/bin/sh")
                .args(["-c", command])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .status()
                .await
                .map_err(|_| CliError::Failed("sh".into()))?;
            if !done.success() {
                return Err(CliError::Failed(format!(
                    "installer exit {:?}",
                    done.code()
                )));
            }
            Ok(self.status(tool).await)
        })
    }
}

#[cfg(test)]
mod account_tests {
    use super::*;

    #[test]
    fn every_installer_reaches_only_cli_install_hosts() {
        let group = noter_protocol::egress::ALLOW_WITHOUT_AUDIT
            .iter()
            .find(|g| g.name == "cli_install")
            .expect("the allow-list has a cli_install group");
        for (tool, command, hosts) in INSTALLERS {
            assert!(hosts.iter().all(|h| group.hosts.contains(h)), "{tool:?}");
            for url in command
                .split_whitespace()
                .filter(|w| w.starts_with("https://"))
            {
                let host = url
                    .trim_start_matches("https://")
                    .split('/')
                    .next()
                    .unwrap();
                assert!(hosts.contains(&host), "{tool:?} {host}");
            }
        }
    }

    #[test]
    fn the_claude_identity_comes_only_from_a_signed_in_status() {
        let who = claude_identity(
            r#"{"loggedIn":true,"email":"ann@example.com","subscriptionType":"max"}"#,
        );
        assert_eq!(
            who.map(|i| (i.email, i.plan)),
            Some(("ann@example.com".into(), "max".into()))
        );
        assert_eq!(claude_identity(r#"{"loggedIn":false}"#), None);
        assert_eq!(claude_identity("not json"), None);
        assert_eq!(claude_auth_status(r#"{"loggedIn":false}"#), Some(None));
        assert_eq!(claude_auth_status("not json"), None);
    }

    /// A mock `claude`: `--version` works, `auth status` prints what the `status` file holds.
    fn mock_claude(dir: &Path) -> Cli {
        use std::os::unix::fs::PermissionsExt;
        let program = dir.join("claude");
        let script = format!(
            "#!/bin/sh\nif [ \"$1\" = auth ]; then cat {}/status; exit $?; fi\necho '2.1.296 (Claude Code)'\n",
            dir.display()
        );
        std::fs::write(&program, script).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        Cli::new(
            CliConfig {
                program,
                home: dir.join("home"),
                run_root: dir.join("runs"),
                signed_in: false,
                models: vec![],
            },
            super::super::claude_code::TESTED,
        )
    }

    #[tokio::test]
    async fn the_account_runtime_follows_the_cli_sign_in_without_a_restart() {
        const SIGNED_IN: &str =
            r#"{"loggedIn":true,"email":"ann@example.com","subscriptionType":"max"}"#;
        let dir = tempfile::tempdir().unwrap();
        let status = dir.path().join("status");
        let cli = mock_claude(dir.path());
        let unavailable = |cli: &Cli| {
            cli.availability(RuntimeChoice::ClaudeAccount, false)
                .unavailable
        };

        // Before anything was observed, the configured answer holds.
        assert_eq!(
            unavailable(&cli),
            Some(RuntimeUnavailableReason::AccountSignedOut)
        );

        std::fs::write(&status, SIGNED_IN).unwrap();
        cli.observe_sign_in(CliTool::ClaudeCode).await;
        assert_eq!(unavailable(&cli), None);

        // An unreadable answer is unknown: the last one stays.
        std::fs::write(&status, "not json").unwrap();
        cli.observe_sign_in(CliTool::ClaudeCode).await;
        assert_eq!(unavailable(&cli), None);

        std::fs::write(&status, r#"{"loggedIn":false}"#).unwrap();
        cli.observe_sign_in(CliTool::ClaudeCode).await;
        assert_eq!(
            unavailable(&cli),
            Some(RuntimeUnavailableReason::AccountSignedOut)
        );

        std::fs::write(&status, SIGNED_IN).unwrap();
        cli.observe_sign_in(CliTool::ClaudeCode).await;
        assert_eq!(unavailable(&cli), None);
        // The API-key runtime never depended on the account.
        std::fs::write(&status, r#"{"loggedIn":false}"#).unwrap();
        cli.observe_sign_in(CliTool::ClaudeCode).await;
        assert_eq!(
            cli.availability(RuntimeChoice::ClaudeApiKey, true)
                .unavailable,
            None
        );
    }

    #[test]
    fn first_availability_probe_releases_the_cache_lock_before_probing() {
        use std::os::unix::fs::PermissionsExt;
        use std::sync::mpsc;
        use std::thread;

        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join("claude");
        std::fs::write(&program, "#!/bin/sh\necho '2.1.296 (Claude Code)'\n").unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        let cli = Arc::new(Cli::new(
            CliConfig {
                program,
                home: dir.path().join("home"),
                run_root: dir.path().join("runs"),
                signed_in: false,
                models: vec![],
            },
            super::super::claude_code::TESTED,
        ));
        let (send, receive) = mpsc::channel();
        thread::spawn(move || {
            let result = cli.availability(RuntimeChoice::ClaudeApiKey, true);
            let _ = send.send(result);
        });
        let result = receive
            .recv_timeout(PROBE_TIMEOUT + Duration::from_secs(1))
            .expect("cold-cache availability must not deadlock while probing");
        assert_eq!(result.version.as_deref(), Some("2.1.296"));
    }

    #[test]
    fn a_hung_version_probe_is_killed_within_its_deadline() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join("claude");
        std::fs::write(&program, "#!/bin/sh\nexec sleep 30\n").unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        let cli = Cli::new(
            CliConfig {
                program,
                home: dir.path().join("home"),
                run_root: dir.path().join("runs"),
                signed_in: false,
                models: vec![],
            },
            super::super::claude_code::TESTED,
        );
        let started = Instant::now();
        assert!(cli.probe().is_none());
        assert!(started.elapsed() < PROBE_TIMEOUT + Duration::from_secs(2));
    }

    #[test]
    fn a_login_page_needs_its_terminator_and_survives_a_multibyte_one() {
        assert_eq!(
            login_page(AccountProvider::Claude, "visit: https://claude.com/a?b=c"),
            None
        );
        assert_eq!(
            login_page(
                AccountProvider::Claude,
                "visit: https://claude.com/a?b=c\u{a0}next"
            ),
            Some(("https://claude.com/a?b=c".into(), None))
        );
    }

    #[tokio::test]
    async fn failed_and_malformed_auth_probes_are_unknown_but_logged_out_is_explicit() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let auth = dir.path().join("auth.json");
        let exit = dir.path().join("exit");
        let program = dir.path().join("claude");
        std::fs::write(
            &program,
            format!(
                "#!/bin/sh\ncase \"$*\" in\n  --version) echo '2.1.296' ;;\n  'auth status') cat {}; exit $(cat {}) ;;\nesac\n",
                auth.display(),
                exit.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        let cli = CliAccounts {
            claude: program.clone(),
            codex: program.clone(),
            ollama: program,
            codex_home: dir.path().join("codex-home"),
        };
        std::fs::write(&auth, "{}").unwrap();
        std::fs::write(&exit, "1").unwrap();
        assert!(!cli.status(CliTool::ClaudeCode).await.auth_known);
        std::fs::write(&auth, "not json").unwrap();
        std::fs::write(&exit, "0").unwrap();
        assert!(!cli.status(CliTool::ClaudeCode).await.auth_known);
        std::fs::write(&auth, r#"{"loggedIn":false}"#).unwrap();
        let status = cli.status(CliTool::ClaudeCode).await;
        assert!(status.auth_known);
        assert!(status.identity.is_none());
    }
}
