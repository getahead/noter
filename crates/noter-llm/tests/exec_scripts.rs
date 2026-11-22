//! #1102, #1159: the noter-llm tests write mock CLIs while other test threads start children. A
//! mock written by the test process itself could not be run ("Text file busy" on Linux), and the
//! version probe read that as a missing CLI. A test binary of its own, so its children never load
//! the other tests' timing.

#[path = "common/exec.rs"]
mod exec;

#[test]
fn mock_clis_run_while_other_threads_start_children() {
    let dir = tempfile::tempdir().unwrap();
    let threads: Vec<_> = (0..8)
        .map(|t| {
            let dir = dir.path().to_owned();
            std::thread::spawn(move || {
                for i in 0..20 {
                    let program = dir.join(format!("cli-{t}-{i}"));
                    exec::write_executable(&program, "#!/bin/sh\necho ok\n");
                    let out = std::process::Command::new(&program).output();
                    let out = out.unwrap_or_else(|e| panic!("{program:?} does not run: {e}"));
                    assert_eq!(out.stdout, b"ok\n");
                }
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
}
