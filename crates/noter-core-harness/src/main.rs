//! `noter-core-harness [--fixture world]`: serves the core over stdin and stdout until stdin
//! ends (docs/HARNESS.md). Exit 0 at the end of input; 2 when it cannot start, before reading
//! any request, with the reason on stderr.

use std::process::ExitCode;
use std::sync::Arc;

use noter_core_harness::{serve, Output};
use noter_protocol::ipc::CoreApi;

// shortcut: every command answers `not_implemented` until noter-core's composition root
// (`Core::open`) exists; P4 of .plans/core-harness.md boots it on the fixture world instead.
struct Pending;
impl CoreApi for Pending {}

/// The command line: only `--fixture world` (the fixture world of noter-protocol) is known.
fn check_args(args: &[String]) -> Result<(), String> {
    match args {
        [] => Ok(()),
        [flag, name] if flag == "--fixture" && name == "world" => Ok(()),
        [flag, name] if flag == "--fixture" => {
            Err(format!("unknown fixture {name:?}; known: world"))
        }
        _ => Err(format!(
            "unknown arguments {args:?}; usage: noter-core-harness [--fixture world]"
        )),
    }
}

// @cpt-state:cpt-noter-state-core-harness-process:p1
#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Err(reason) = check_args(&args) {
        eprintln!("noter-core-harness: {reason}");
        return ExitCode::from(2);
    }
    eprintln!("noter-core-harness: serving on stdin/stdout");
    match serve(
        Arc::new(Pending),
        tokio::io::stdin(),
        Output::new(tokio::io::stdout()),
    )
    .await
    {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("noter-core-harness: {e}");
            ExitCode::FAILURE
        }
    }
}
