//! The `noter-mcp` binary: argv[1] (or `NOTER_MCP_CONFIG`) is the Noter-written run config,
//! `NOTER_MCP_TOKEN` the run's token. Exits 2 on a start failure; diagnostics are fixed words.

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let path = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("NOTER_MCP_CONFIG").ok());
    let token = std::env::var("NOTER_MCP_TOKEN").ok();
    let (Some(path), Some(token)) = (path, token) else {
        eprintln!("noter-mcp: missing config path or token");
        std::process::exit(2);
    };
    if let Err(what) = noter_mcp::run(&path, token, tokio::io::stdin(), tokio::io::stdout()).await {
        eprintln!("noter-mcp: {what}");
        std::process::exit(2);
    }
}
