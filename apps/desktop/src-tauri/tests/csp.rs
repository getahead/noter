//! DESIGN-core deployment topology (`cpt-noter-topology-core-processes`): WebView windows load
//! no remote content, and their CSP blocks the network. Every source in the policy is the app's
//! own assets or Tauri IPC.

use serde_json::Value;
use std::collections::BTreeMap;

#[test]
fn the_windows_csp_allows_only_local_sources() {
    let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let csp = conf["app"]["security"]["csp"]
        .as_str()
        .expect("app.security.csp is set");
    let parsed: Vec<_> = csp
        .split(';')
        .map(str::split_whitespace)
        .filter_map(|mut parts| {
            Some((
                parts.next()?.to_string(),
                parts.map(str::to_string).collect::<Vec<_>>(),
            ))
        })
        .collect();
    let directives: BTreeMap<_, _> = parsed.iter().cloned().collect();
    assert_eq!(parsed.len(), directives.len(), "CSP directive names are unique: {csp}");
    let expected = BTreeMap::from([
        ("connect-src".to_string(), vec!["ipc:".to_string(), "http://ipc.localhost".to_string()]),
        ("default-src".to_string(), vec!["'self'".to_string()]),
        ("img-src".to_string(), vec!["'self'".to_string(), "asset:".to_string(), "data:".to_string()]),
        ("script-src".to_string(), vec!["'self'".to_string()]),
        ("style-src".to_string(), vec!["'self'".to_string(), "'unsafe-inline'".to_string()]),
    ]);
    assert_eq!(directives, expected, "CSP directives and sources must stay local: {csp}");
}
