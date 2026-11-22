//! The account seam against what the real CLIs print (`tests/fixtures/cli-auth`, recorded from
//! Claude Code 2.1.325 and codex-cli 0.171.0): a fake binary replays each recorded output on the
//! stream and with the exit code the real one used.

use std::path::{Path, PathBuf};
use std::time::Duration;

use noter_llm::{AccountCli, CliAccounts, LoginOutcome};
use noter_protocol::model::{AccountProvider, CliTool};

#[path = "common/exec.rs"]
mod exec;

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/cli-auth");

/// A fake `claude` and `codex` in a temp dir. `auth status` / `login status` replay the fixture
/// the `state` file names (`signed-in` or `signed-out`); a login prints its recorded start, then
/// waits for a `release` file and signs in; every call appends its argv and `CODEX_HOME` to
/// `calls`.
struct Fake {
    dir: tempfile::TempDir,
}

impl Fake {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path().display();
        let f = FIXTURES;
        let claude = format!(
            r#"#!/bin/sh
echo "claude $* CODEX_HOME=$CODEX_HOME" >> {d}/calls
case "$*" in
  --version) echo '2.1.325 (Claude Code)' ;;
  'auth status') state=$(cat {d}/state); cat {f}/claude-2.1.325/auth-status-$state.stdout
    [ "$state" = signed-in ] ;;
  'auth login --claudeai') echo $$ > {d}/pid; cat {f}/claude-2.1.325/auth-login.stdout
    while [ ! -e {d}/release ]; do sleep 0.05; done; echo signed-in > {d}/state ;;
  'auth logout') echo signed-out > {d}/state; echo 'Successfully logged out from your Anthropic account.' ;;
  *) exit 2 ;;
esac
"#
        );
        let codex = format!(
            r#"#!/bin/sh
echo "codex $* CODEX_HOME=$CODEX_HOME" >> {d}/calls
case "$*" in
  --version) echo 'codex-cli 0.171.0' ;;
  'login status') state=$(cat {d}/state); cat {f}/codex-0.171.0/login-status-$state.stderr >&2
    [ "$state" = signed-in ] ;;
  'login --device-auth') echo $$ > {d}/pid; cat {f}/codex-0.171.0/login-device-auth.stdout
    while [ ! -e {d}/release ]; do sleep 0.05; done
    echo signed-in > {d}/state ;;
  app-server) [ -e {d}/no-app-server ] && exit 1; state=$(cat {d}/state)
    while read -r line; do case "$line" in
      *'"id":1'*) echo '{{"id":1,"result":{{"codexHome":"'$CODEX_HOME'"}}}}' ;;
      *'"id":2'*) cat {f}/codex-0.171.0/app-server-account-$state.jsonl ;;
    esac; done ;;
  logout) echo signed-out > {d}/state; echo 'Successfully logged out' ;;
  *) exit 2 ;;
esac
"#
        );
        for (name, script) in [("claude", claude), ("codex", codex)] {
            let path = dir.path().join(name);
            exec::write_executable(&path, &script);
        }
        std::fs::create_dir(dir.path().join("codex-home")).unwrap();
        let fake = Self { dir };
        fake.set("signed-out");
        fake
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.path().join(name)
    }

    fn set(&self, state: &str) {
        std::fs::write(self.path("state"), state).unwrap();
    }

    fn codex_home(&self) -> PathBuf {
        self.path("codex-home")
    }

    fn accounts(&self) -> CliAccounts {
        CliAccounts {
            claude: self.path("claude"),
            codex: self.path("codex"),
            ollama: self.path("ollama"),
            codex_home: self.codex_home(),
        }
    }

    fn calls(&self) -> String {
        std::fs::read_to_string(self.path("calls")).unwrap_or_default()
    }
}

fn alive(pid_file: &Path) -> bool {
    let pid = std::fs::read_to_string(pid_file).unwrap();
    std::process::Command::new("/bin/kill")
        .args(["-0", pid.trim()])
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap()
        .success()
}

#[tokio::test]
async fn claude_2_1_325_status_signed_in_reads_the_email_and_plan() {
    let fake = Fake::new();
    fake.set("signed-in");
    let status = fake.accounts().status(CliTool::ClaudeCode).await;
    assert!(status.installed && status.supported && status.auth_known);
    let who = status.identity.expect("signed in");
    assert_eq!(
        (who.email.as_str(), who.plan.as_str()),
        ("user@example.com", "team")
    );
}

/// The real `claude auth status` exits 1 when signed out: that is an answer, not a failed probe.
#[tokio::test]
async fn claude_2_1_325_status_signed_out_exits_1_and_is_an_explicit_sign_out() {
    let fake = Fake::new();
    let status = fake.accounts().status(CliTool::ClaudeCode).await;
    assert!(
        status.auth_known,
        "exit 1 with loggedIn:false is signed out, not unknown"
    );
    assert!(status.identity.is_none());
}

/// `codex login status` prints no email: the identity comes from Codex's own app-server
/// (`account/read`) against the account home, never from its token file.
#[tokio::test]
async fn codex_0_171_0_status_signed_in_reads_the_email_and_plan_from_the_cli() {
    let fake = Fake::new();
    fake.set("signed-in");
    let status = fake.accounts().status(CliTool::Codex).await;
    assert!(status.installed && status.auth_known);
    let who = status.identity.expect("signed in");
    assert_eq!(
        (who.email.as_str(), who.plan.as_str()),
        ("user@example.com", "self_serve_business_prolite")
    );
    let home = fake.codex_home();
    assert!(fake
        .calls()
        .contains(&format!("app-server CODEX_HOME={}", home.display())));
}

/// An app-server that does not answer (an older or broken CLI): `login status` still says
/// signed out, and a signed-in one stays unknown rather than being marked signed out.
#[tokio::test]
async fn codex_without_an_app_server_answer_falls_back_to_login_status() {
    let fake = Fake::new();
    std::fs::write(fake.path("no-app-server"), "").unwrap();
    let status = fake.accounts().status(CliTool::Codex).await;
    assert!(status.auth_known && status.identity.is_none());
    fake.set("signed-in");
    let status = fake.accounts().status(CliTool::Codex).await;
    assert!(!status.auth_known);
}

#[tokio::test]
async fn codex_0_171_0_status_signed_out_exits_1_and_is_an_explicit_sign_out() {
    let fake = Fake::new();
    let status = fake.accounts().status(CliTool::Codex).await;
    assert!(status.auth_known);
    assert!(status.identity.is_none());
}

#[tokio::test]
async fn claude_login_shows_the_cli_page_and_signs_in_when_the_browser_finishes() {
    let fake = Fake::new();
    let accounts = fake.accounts();
    let start = tokio::time::timeout(
        Duration::from_secs(5),
        accounts.login(AccountProvider::Claude),
    )
    .await
    .expect("the page arrives without waiting for the browser")
    .expect("the login starts");
    assert!(
        start
            .url
            .starts_with("https://claude.com/cai/oauth/authorize?"),
        "{}",
        start.url
    );
    assert!(
        !start.url.contains(['\x07', '\x1b', ' ']),
        "{:?}",
        start.url
    );
    assert_eq!(start.code, None);
    std::fs::write(fake.path("release"), "").unwrap();
    match tokio::time::timeout(Duration::from_secs(5), start.done)
        .await
        .unwrap()
    {
        LoginOutcome::SignedIn(who) => assert_eq!(who.email, "user@example.com"),
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn codex_login_shows_the_device_page_and_code_and_signs_in_to_its_home() {
    let fake = Fake::new();
    let accounts = fake.accounts();
    let start = tokio::time::timeout(
        Duration::from_secs(5),
        accounts.login(AccountProvider::Chatgpt),
    )
    .await
    .unwrap()
    .expect("the login starts");
    assert_eq!(start.url, "https://auth.openai.com/codex/device");
    assert_eq!(start.code.as_deref(), Some("ABCD-11111"));
    std::fs::write(fake.path("release"), "").unwrap();
    match tokio::time::timeout(Duration::from_secs(5), start.done)
        .await
        .unwrap()
    {
        LoginOutcome::SignedIn(who) => assert_eq!(who.plan, "self_serve_business_prolite"),
        other => panic!("{other:?}"),
    }
    let home = fake.codex_home();
    assert!(fake.calls().contains(&format!(
        "login --device-auth CODEX_HOME={}",
        home.display()
    )));
}

/// The core ends a sign-in (cancel, timeout, a new one) by dropping its end: the CLI goes too.
#[tokio::test]
async fn dropping_a_pending_login_stops_the_cli() {
    let fake = Fake::new();
    let accounts = fake.accounts();
    let start = accounts.login(AccountProvider::Chatgpt).await.unwrap();
    let pid = fake.path("pid");
    assert!(alive(&pid));
    drop(start);
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while alive(&pid) {
        assert!(
            std::time::Instant::now() < deadline,
            "the login CLI outlived its sign-in"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn sign_out_in_the_cli_runs_each_tools_own_logout() {
    let fake = Fake::new();
    fake.set("signed-in");
    let accounts = fake.accounts();
    accounts.logout(AccountProvider::Chatgpt).await.unwrap();
    assert!(accounts.status(CliTool::Codex).await.identity.is_none());
    fake.set("signed-in");
    accounts.logout(AccountProvider::Claude).await.unwrap();
    assert!(accounts
        .status(CliTool::ClaudeCode)
        .await
        .identity
        .is_none());
    let calls = fake.calls();
    assert!(calls.contains("claude auth logout"), "{calls}");
    assert!(calls.contains("codex logout"), "{calls}");
}
