//! `noter-core-harness [--fixture world]`: serves the core over stdin and stdout until stdin
//! ends (docs/HARNESS.md). Exit 0 at the end of input; 2 when it cannot start, before reading
//! any request, with the reason on stderr.

use std::process::ExitCode;

use noter_core_harness::boot::{Harness, Options};
use noter_core_harness::{serve_with, Output};

/// The command line: `--fixture world` (the fixture world of noter-protocol) and `--clock fixed`.
// @cpt-begin:cpt-noter-flow-core-harness-session:p1:inst-start
fn parse_args(args: &[String]) -> Result<Options, String> {
    let mut options = Options::default();
    let mut rest = args.iter();
    while let Some(flag) = rest.next() {
        match (flag.as_str(), rest.next().map(String::as_str)) {
            ("--fixture", Some("world")) => options.fixture = true,
            ("--fixture", name) => return Err(format!("unknown fixture {name:?}; known: world")),
            ("--clock", Some("fixed")) => options.fixed_clock = true,
            _ => return Err(format!("unknown arguments {args:?}; usage: noter-core-harness [--fixture world] [--clock fixed]")),
        }
    }
    Ok(options)
}
// @cpt-end:cpt-noter-flow-core-harness-session:p1:inst-start

// @cpt-state:cpt-noter-state-core-harness-process:p1
#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let options = match parse_args(&args) {
        Ok(o) => o,
        Err(reason) => {
            eprintln!("noter-core-harness: {reason}");
            return ExitCode::from(2);
        }
    };
    let output = Output::new(tokio::io::stdout());
    // @cpt-begin:cpt-noter-state-core-harness-process:p1:inst-st-boot-fail
    // @cpt-begin:cpt-noter-flow-core-harness-session:p1:inst-boot
    let harness = match Harness::start(options, output.lines()).await {
        Ok(h) => h,
        Err(reason) => {
            eprintln!("noter-core-harness: cannot start: {reason}");
            return ExitCode::from(2);
        }
    };
    // @cpt-end:cpt-noter-state-core-harness-process:p1:inst-st-boot-fail
    // @cpt-end:cpt-noter-flow-core-harness-session:p1:inst-boot
    // @cpt-begin:cpt-noter-state-core-harness-process:p1:inst-st-serving
    eprintln!("noter-core-harness: serving on stdin/stdout");
    let served = serve_with(harness.core(), harness, tokio::io::stdin(), output).await;
    // @cpt-end:cpt-noter-state-core-harness-process:p1:inst-st-serving
    // @cpt-begin:cpt-noter-state-core-harness-process:p1:inst-st-exited
    match served {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("noter-core-harness: {e}");
            ExitCode::FAILURE
        }
    }
    // @cpt-end:cpt-noter-state-core-harness-process:p1:inst-st-exited
}
