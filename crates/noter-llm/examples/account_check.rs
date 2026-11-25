//! Sends Noter's own-account test request (the sign-in sheet's Check step) to the real Claude
//! Code CLI and prints only the outcome: `ok`, or the failure code. Run it by hand on a Mac
//! where Claude Code is signed in (`scripts/dev/claude-account-check.sh`); it never signs in or
//! out and prints no identity.
//!
//! `account_check <claude> <run-root>`: the user's `HOME` is the one Claude Code is signed in to.
//! `account_check <claude> <run-root> schemas` instead sends one empty request per skill, so
//! each generated output schema goes through the CLI's `--json-schema` check; a line says
//! `accepted` when the CLI ran with it, or how the CLI's run ended.

use std::path::PathBuf;
use std::sync::Arc;

use noter_db::Store;
use noter_llm::{
    Adapters, CliConfig, Failure, Llm, OllamaConfig, Packet, PacketContext, Privacy, RunRequest,
    Skill, TaskKind,
};
use noter_protocol::model::settings::AuditWhat;
use noter_protocol::{PrivacyMode, RuntimeChoice, TimestampMs};
use tokio::sync::watch;

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
    if args.next().is_some() {
        std::process::exit(schemas(&llm, privacy).await);
    }
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

/// One empty request per skill on the own account. An answer the app then finds invalid still
/// means the CLI took the schema.
async fn schemas(llm: &Llm, privacy: Privacy) -> i32 {
    let runtime = RuntimeChoice::ClaudeAccount;
    let (_privacy, rx) = watch::channel(privacy);
    let mut refused = 0;
    for skill in Skill::ALL {
        let packet = Packet {
            what: AuditWhat::CredentialCheck,
            items: Vec::new(),
            people: Vec::new(),
            context: PacketContext::default(),
        };
        let mut req = RunRequest::new(skill, "schema-check", packet, TaskKind::Ask, rx.clone());
        req.settings.configured = Some(runtime);
        let line = match llm.run_once(req).await {
            Ok(_) => "accepted".to_owned(),
            Err(Failure::Invalid { .. }) => "accepted (the answer did not validate)".to_owned(),
            Err(failure) => {
                refused += 1;
                let how = llm.cli_failure(runtime).unwrap_or_default();
                format!("failed: {failure:?} {how}")
            }
        };
        println!("{}: {line}", skill.id());
    }
    refused
}
