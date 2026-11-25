//! Sends Noter's own-account test request (the sign-in sheet's Check step) to the real Claude
//! Code CLI and prints only the outcome: `ok`, or the failure code. Run it by hand on a Mac
//! where Claude Code is signed in (`scripts/dev/claude-account-check.sh`); it never signs in or
//! out and prints no identity.
//!
//! `account_check <claude> <run-root>`: the user's `HOME` is the one Claude Code is signed in to.

use std::path::PathBuf;
use std::sync::Arc;

use noter_db::Store;
use noter_llm::{Adapters, CliConfig, Llm, OllamaConfig, Privacy};
use noter_protocol::{PrivacyMode, RuntimeChoice, TimestampMs};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let mut args = std::env::args_os().skip(1).map(PathBuf::from);
    let (Some(program), Some(run_root)) = (args.next(), args.next()) else {
        eprintln!("usage: account_check <claude> <run-root>");
        std::process::exit(2);
    };
    let home = PathBuf::from(std::env::var_os("HOME").expect("HOME"));
    std::fs::create_dir_all(&run_root).expect("run root");
    let store = Store::open(&run_root.join("check.db"), &[noter_db::MIGRATIONS]).expect("db");
    let cli = |program: PathBuf| CliConfig {
        program,
        home: home.clone(),
        run_root: run_root.join("runtimes"),
        signed_in: false,
        models: Vec::new(),
    };
    let ollama = OllamaConfig {
        url: "http://127.0.0.1:9".into(),
        models: Vec::new(),
    };
    let adapters = Adapters::real(cli(program), cli(run_root.join("no-codex")), ollama);
    let llm = Llm::new(Arc::new(store), adapters, || TimestampMs(0));
    llm.refresh().await;
    let privacy = Privacy {
        mode: PrivacyMode::CloudAllowed,
        sensitive: false,
        offline: false,
    };
    match llm
        .verify_account(RuntimeChoice::ClaudeAccount, privacy)
        .await
    {
        Ok(()) => println!("ok"),
        Err(failure) => {
            println!("failed: {failure:?}");
            std::process::exit(1);
        }
    }
}
