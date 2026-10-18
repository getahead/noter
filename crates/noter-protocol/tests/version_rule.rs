//! The version rule (DESIGN-core 4.1, Contract governance): a change to the contract since the
//! base branch carries the `CONTRACT_VERSION` bump it needs. Only draft surfaces changed, or
//! every frozen change is additive: minor. Anything else breaks a frozen surface: major, which
//! both the core and the UI team sign off in the pull request.
//!
//! shortcut: judges what `contracts/ipc.manifest.json` records (commands, events, error codes);
//! a field change inside an argument or result type is left to the export check and the two
//! reviews. Upgrade by comparing the exported TypeScript types per frozen surface.

// @cpt-dod:cpt-noter-dod-core-contract-tests:p1
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Command;

use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Bump {
    None,
    Minor,
    Major,
}

fn named(manifest: &Value, key: &str) -> BTreeMap<String, Value> {
    manifest[key]
        .as_array()
        .into_iter()
        .flatten()
        .map(|e| {
            let mut e = e.clone();
            // Documentation is not part of the wire.
            e.as_object_mut().unwrap().remove("doc");
            (e["name"].as_str().unwrap().to_string(), e)
        })
        .collect()
}

fn windows(e: &Value) -> BTreeSet<String> {
    e["windows"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|w| w.as_str().unwrap().to_string())
        .collect()
}

// @cpt-state:cpt-noter-state-core-contract-stability:p2
/// The bump one command or event asks for, from its entry on the base and on the head.
fn surface_bump(old: Option<&Value>, new: Option<&Value>) -> Bump {
    match (old, new) {
        (None, None) => Bump::None,
        // A new command or event is additive.
        (None, Some(_)) => Bump::Minor,
        (Some(o), _) if new == Some(o) => Bump::None,
        // @cpt-begin:cpt-noter-algo-core-contract-version-rule:p2:inst-if-draft
        // @cpt-begin:cpt-noter-state-core-contract-stability:p2:inst-st-draft-change
        // @cpt-begin:cpt-noter-state-core-contract-stability:p2:inst-st-freeze
        // A draft surface changes, freezes at its gate or goes away in a minor version.
        (Some(o), _) if o["stability"] == "draft" => {
            // @cpt-begin:cpt-noter-algo-core-contract-version-rule:p2:inst-return-draft-minor
            Bump::Minor
            // @cpt-end:cpt-noter-algo-core-contract-version-rule:p2:inst-return-draft-minor
        }
        // @cpt-end:cpt-noter-state-core-contract-stability:p2:inst-st-freeze
        // @cpt-end:cpt-noter-state-core-contract-stability:p2:inst-st-draft-change
        // @cpt-end:cpt-noter-algo-core-contract-version-rule:p2:inst-if-draft
        // @cpt-begin:cpt-noter-algo-core-contract-version-rule:p2:inst-if-additive
        // @cpt-begin:cpt-noter-state-core-contract-stability:p2:inst-st-additive
        // A frozen surface may only open to more windows.
        (Some(o), Some(n)) => {
            let mut widened = o.clone();
            widened["windows"] = n["windows"].clone();
            if widened == *n && windows(n).is_superset(&windows(o)) {
                // @cpt-begin:cpt-noter-algo-core-contract-version-rule:p2:inst-return-additive-minor
                return Bump::Minor;
                // @cpt-end:cpt-noter-algo-core-contract-version-rule:p2:inst-return-additive-minor
            }
            Bump::Major
        }
        // @cpt-end:cpt-noter-state-core-contract-stability:p2:inst-st-additive
        // @cpt-end:cpt-noter-algo-core-contract-version-rule:p2:inst-if-additive
        // @cpt-begin:cpt-noter-algo-core-contract-version-rule:p2:inst-return-major
        // A frozen surface removed.
        (Some(_), None) => Bump::Major,
        // @cpt-end:cpt-noter-algo-core-contract-version-rule:p2:inst-return-major
    }
}

fn codes(manifest: &Value, key: &str) -> BTreeSet<String> {
    manifest[key]
        .as_array()
        .into_iter()
        .flatten()
        .map(|c| c.as_str().unwrap().to_string())
        .collect()
}

// @cpt-algo:cpt-noter-algo-core-contract-version-rule:p2
/// The bump the change from `old` to `new` (two `ipc.manifest.json` values) needs.
fn required_bump(old: &Value, new: &Value) -> Bump {
    let mut bump = Bump::None;
    for key in ["commands", "events"] {
        let (o, n) = (named(old, key), named(new, key));
        for name in o.keys().chain(n.keys()).collect::<BTreeSet<_>>() {
            bump = bump.max(surface_bump(o.get(name), n.get(name)));
        }
    }
    let (o, n) = (codes(old, "error_codes"), codes(new, "error_codes"));
    if !n.is_superset(&o) {
        bump = bump.max(Bump::Major);
    } else if n != o || codes(old, "default_retryable") != codes(new, "default_retryable") {
        // A new error code is a variant the UI can ignore.
        bump = bump.max(Bump::Minor);
    }
    bump
}

fn version(v: &str) -> (u32, u32) {
    let (major, minor) = v.split_once('.').expect("major.minor");
    (major.parse().unwrap(), minor.parse().unwrap())
}

/// The bump from version `old` to version `new`.
fn applied_bump(old: &str, new: &str) -> Bump {
    let (o, n) = (version(old), version(new));
    if n.0 > o.0 {
        Bump::Major
    } else if n.0 == o.0 && n.1 > o.1 {
        Bump::Minor
    } else {
        Bump::None
    }
}

fn git(root: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

#[test]
fn the_contract_version_carries_the_bump_the_change_needs() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let head: Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("contracts/ipc.manifest.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(head["contract_version"], noter_protocol::CONTRACT_VERSION);
    let base_ref = std::env::var("NOTER_BASE_REF").unwrap_or_else(|_| "origin/main".into());
    // As the trace gate: without the base ref (a shallow checkout) there is nothing to compare;
    // CI's unit-coverage job has the full history and enforces the rule.
    let Some(base) = git(&root, &["merge-base", "HEAD", &base_ref]).and_then(|sha| {
        git(
            &root,
            &["show", &format!("{sha}:contracts/ipc.manifest.json")],
        )
    }) else {
        eprintln!("version rule: {base_ref} not available, nothing to compare");
        return;
    };
    let base: Value = serde_json::from_str(&base).unwrap();
    let (from, to) = (
        base["contract_version"].as_str().unwrap(),
        head["contract_version"].as_str().unwrap(),
    );
    let needed = required_bump(&base, &head);
    assert!(
        applied_bump(from, to) >= needed,
        "the contract changed since {base_ref} and needs a {needed:?} bump of CONTRACT_VERSION ({from} -> {to})"
    );
}

fn manifest(commands: Value, codes: &[&str]) -> Value {
    json!({ "contract_version": "2.0", "commands": commands, "events": [], "error_codes": codes, "default_retryable": ["internal"] })
}

fn cmd(name: &str, stability: &str, windows: &[&str]) -> Value {
    json!({ "name": name, "args": "NoArgs", "result": "Ack", "channel": null, "group": "app", "stability": stability, "windows": windows, "doc": "" })
}

#[test]
fn the_rule_asks_minor_for_draft_or_additive_changes_and_major_otherwise() {
    let base = manifest(
        json!([
            cmd("frozen_one", "frozen", &["main"]),
            cmd("draft_one", "draft", &["main"])
        ]),
        &["internal", "not_found"],
    );
    let with = |commands: Value, codes: &[&str]| manifest(commands, codes);
    let same = with(base["commands"].clone(), &["internal", "not_found"]);
    assert_eq!(required_bump(&base, &same), Bump::None);

    let mut doc_only = same.clone();
    doc_only["commands"][0]["doc"] = json!("reworded");
    assert_eq!(required_bump(&base, &doc_only), Bump::None);

    let draft_changed = with(
        json!([
            cmd("frozen_one", "frozen", &["main"]),
            cmd("draft_one", "frozen", &["settings"])
        ]),
        &["internal", "not_found"],
    );
    assert_eq!(
        required_bump(&base, &draft_changed),
        Bump::Minor,
        "draft reshaped and frozen at its gate"
    );

    let added = with(
        json!([
            cmd("frozen_one", "frozen", &["main", "settings"]),
            cmd("draft_one", "draft", &["main"]),
            cmd("new_one", "frozen", &["main"])
        ]),
        &["internal", "not_found", "offline"],
    );
    assert_eq!(
        required_bump(&base, &added),
        Bump::Minor,
        "new command, wider scope, new code"
    );

    let narrowed = with(
        json!([
            cmd("frozen_one", "frozen", &["settings"]),
            cmd("draft_one", "draft", &["main"])
        ]),
        &["internal", "not_found"],
    );
    assert_eq!(required_bump(&base, &narrowed), Bump::Major);
    let unfrozen = with(
        json!([
            cmd("frozen_one", "draft", &["main"]),
            cmd("draft_one", "draft", &["main"])
        ]),
        &["internal", "not_found"],
    );
    assert_eq!(required_bump(&base, &unfrozen), Bump::Major);
    let mut retyped = same.clone();
    retyped["commands"][0]["result"] = json!("AppSnapshot");
    assert_eq!(required_bump(&base, &retyped), Bump::Major);
    let removed = with(
        json!([cmd("draft_one", "draft", &["main"])]),
        &["internal", "not_found"],
    );
    assert_eq!(required_bump(&base, &removed), Bump::Major);
    let code_gone = with(base["commands"].clone(), &["internal"]);
    assert_eq!(required_bump(&base, &code_gone), Bump::Major);

    let mut retry = same.clone();
    retry["default_retryable"] = json!(["internal", "not_found"]);
    assert_eq!(required_bump(&base, &retry), Bump::Minor);
    let mut no_longer_retryable = same.clone();
    no_longer_retryable["default_retryable"] = json!([]);
    assert_eq!(
        required_bump(&base, &no_longer_retryable),
        Bump::Major,
        "a code leaving default_retryable changes what the UI offers"
    );
}

#[test]
fn a_missing_base_is_reported_locally_and_in_a_shallow_checkout() {
    assert_eq!(base_or_report(None, "origin/main", false, false), None);
    assert_eq!(base_or_report(None, "origin/main", true, true), None);
    assert_eq!(
        base_or_report(Some("{}".into()), "origin/main", true, false),
        Some("{}".into())
    );
}

#[test]
#[should_panic(expected = "origin/main")]
fn a_missing_base_fails_in_ci_with_the_full_history() {
    base_or_report(None, "origin/main", true, false);
}

#[test]
fn versions_compare_by_major_then_minor() {
    assert_eq!(applied_bump("2.0", "2.0"), Bump::None);
    assert_eq!(applied_bump("2.0", "2.1"), Bump::Minor);
    assert_eq!(applied_bump("2.9", "2.10"), Bump::Minor);
    assert_eq!(applied_bump("2.3", "3.0"), Bump::Major);
    assert_eq!(applied_bump("2.3", "2.2"), Bump::None);
    assert!(Bump::Major > Bump::Minor && Bump::Minor > Bump::None);
}
