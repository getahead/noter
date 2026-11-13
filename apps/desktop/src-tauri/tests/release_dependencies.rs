//! Check Cargo's actual shipping dependency graph, not just the host's cfg guards.

use std::process::Command;

fn dependency_graph(test_hooks: bool) -> String {
    let mut command = Command::new(env!("CARGO"));
    command.current_dir(env!("CARGO_MANIFEST_DIR")).args([
        "tree",
        "--locked",
        "--offline",
        "--target",
        "aarch64-apple-darwin",
        "--edges",
        "normal,build",
        "--prefix",
        "none",
        "--no-dedupe",
        "--format",
        "{p}|{f}",
    ]);
    if test_hooks {
        command.args(["--features", "test-hooks"]);
    }
    let output = command
        .output()
        .expect("query the app's Cargo dependency graph");
    assert!(
        output.status.success(),
        "cargo tree: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("Cargo dependency graph is UTF-8")
}

// @cpt-dod:cpt-noter-dod-core-harness-fixture:p1
#[test]
fn the_shipping_app_excludes_the_harness_and_core_test_branches() {
    let graph = dependency_graph(false);
    assert!(
        graph.lines().any(|line| line.starts_with("noter-core ")),
        "real core is present"
    );
    assert!(
        !graph
            .lines()
            .any(|line| line.starts_with("noter-core-harness ")),
        "the shipping app must not depend on noter-core-harness"
    );
    for line in graph.lines().filter(|line| line.starts_with("noter-core ")) {
        let (_, features) = line.split_once('|').expect("package and features");
        assert!(
            !features.split(',').any(|feature| feature == "harness"),
            "{line}"
        );
    }
}

#[test]
fn native_test_hooks_explicitly_enable_the_harness() {
    let graph = dependency_graph(true);
    assert!(graph
        .lines()
        .any(|line| line.starts_with("noter-core-harness ")));
    assert!(graph.lines().any(|line| {
        line.starts_with("noter-core ")
            && line
                .split_once('|')
                .expect("package and features")
                .1
                .split(',')
                .any(|f| f == "harness")
    }));
}
