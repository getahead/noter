//! DESIGN-core deployment topology (`cpt-noter-topology-core-processes`): WebView windows load
//! no remote content, and their CSP blocks the network. Every source in the policy is the app's
//! own assets or Tauri IPC.

use serde_json::Value;

const LOCAL_SOURCES: [&str; 6] = [
    "'self'",
    "'unsafe-inline'",
    "data:",
    "asset:",
    "ipc:",
    "http://ipc.localhost",
];

#[test]
fn the_windows_csp_allows_only_local_sources() {
    let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let csp = conf["app"]["security"]["csp"]
        .as_str()
        .expect("app.security.csp is set");
    assert!(csp.contains("default-src 'self'"), "{csp}");
    for directive in csp.split(';').map(str::trim).filter(|d| !d.is_empty()) {
        for source in directive.split_whitespace().skip(1) {
            assert!(
                LOCAL_SOURCES.contains(&source),
                "remote source {source} in `{directive}`"
            );
        }
    }
}
