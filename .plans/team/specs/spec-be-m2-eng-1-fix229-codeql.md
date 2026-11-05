# be-eng-1 (Opus 5.5) — fix PR #229: CodeQL alert 99 (rust/cleartext-logging, high) blocks the merge

Worktree `~/orca/workspaces/noter/be-eng-1`, branch `lane/core/llm-gate-runtime` (your PR #229, auto-merge on; the lock-file fix `ccd39067` is in). Shell start: `export PATH=/opt/homebrew/bin:/usr/bin:$PATH NOTER_E2E_LOCK=$HOME/projects/noter-wt/.e2e.lock`. No reading list beyond this file and the repo's `CLAUDE.md` PR rules.

**Why blocked:** the PR's CodeQL check reports one new high-severity alert, #99 `rust/cleartext-logging`, at `crates/noter-llm/src/runtime_tests.rs:694`: "This operation writes secret to a log file". CodeQL posts it as a review thread on the PR and an unresolved thread blocks auto-merge; only the owner may dismiss, so the code must change (`gh api repos/getahead/noter/code-scanning/alerts/99` shows the flow). A test file counts.

**Change:**
1. Read the alert's source and sink (the value CodeQL treats as a secret: a key, token or password-like string that reaches a `log`/`tracing`/`println!`/file write, possibly through your log-capture test helper). Fix at the root: the test must prove "no credential in the logs" without feeding the credential into a logging call; assert on the captured log text not containing a sentinel instead of writing the secret through the logger, or derive the sentinel from a non-secret-typed value, or make the capture sink an in-memory `Vec<String>` the test reads and never writes to a file. Do not suppress the query, do not add a `// codeql` or `lgtm` comment, do not move the code to dodge the scanner.
2. Check the same pattern elsewhere in `crates/noter-llm` (the gate's redaction tests, the audit tests) so the next scan is clean; `cargo test -p noter-llm` green; `just gate-fast` green.
3. Commit `fix(llm): keep the secret out of the log-capture test`; push. The CodeQL check re-runs on the push; the diff changed, so review again: `/cf-sdlc-pr-review 229` (with `/ponytail-review` merged in), then `just review-publish 229`. Loop on REQUEST CHANGES.
4. After the push, `gh pr checks 229 --watch` until CodeQL reports (it is the slowest job): if the alert is still open, iterate; if the E2E job fails on a UI spec your diff does not touch (`m0-a11y-l10n-screens.spec.ts`, `m0-first-run-ui.spec.ts`, `m1-call-page-frame-ui.spec.ts`), say so in `worker_done`; the Teamlead re-runs it.
5. `worker_done` with one line (what changed, CodeQL state, review verdict); stop.

**Acceptance:** alert 99 closed by a code change on the PR, no suppression; review republished; auto-merge still on.
