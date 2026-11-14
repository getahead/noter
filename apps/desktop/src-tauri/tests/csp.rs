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
        .filter_map(|mut parts| Some((parts.next()?.to_string(), parts.collect::<Vec<_>>())))
        .collect();
    let directives: BTreeMap<_, _> = parsed.iter().cloned().collect();
    assert_eq!(
        parsed.len(),
        directives.len(),
        "CSP directive names are unique: {csp}"
    );
    assert_eq!(directives["script-src"], ["'self'"], "{csp}");
    assert_eq!(
        directives["connect-src"],
        ["ipc:", "http://ipc.localhost"],
        "{csp}"
    );
    assert_eq!(
        parsed
            .iter()
            .filter(|(_, sources)| sources.contains(&"'unsafe-inline'"))
            .map(|(name, _)| name.as_str())
            .collect::<Vec<_>>(),
        ["style-src"],
        "inline scripts are forbidden; only inline styles are permitted: {csp}"
    );
    assert_eq!(
        parsed
            .iter()
            .filter(|(_, sources)| sources.contains(&"data:"))
            .map(|(name, _)| name.as_str())
            .collect::<Vec<_>>(),
        ["img-src"],
        "data URLs are permitted only for images: {csp}"
    );
}
