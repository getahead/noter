# UI M1 round 3 (25 Oct 11:xxZ) — read with spec-ui-r2-common.md and spec-ui-common.md; this file overrides them where they differ

Teamlead: dispatch ctx_3b56ec9ab260, terminal term_3d0d9d1a-c426-4bef-9355-bceac3f7f06a (send `--type status` to the Run as before; I read it with `check`).
- First: `export PATH=/opt/homebrew/bin:/usr/bin:$PATH NOTER_E2E_LOCK=$HOME/projects/noter-wt/.e2e.lock NOTER_CORE_CMD="$PWD/target/debug/noter-core-harness --fixture world"` (rebuild the harness after a merge of main: `cargo build -p noter-core-harness`).
- NEW RULE: do not end your turn while your PR's CI is running. After every push run `gh pr checks <N> --watch` (blocking, costs nothing) and act on the result at once: red → fix, push, watch again; green → continue the task. Never `sleep` loops, never poll.
- The m0 self-test E2E `m0-a11y-l10n-screens.spec.ts:244` (`.fr-st__passed` not visible in 20 s) is a known CI flake on main today; if it is the ONLY red test, `gh run rerun <run-id> --failed` once and watch again. Do not touch that spec.
- Lane guard: no merge commits (rebase only, and only when GitHub reports a conflict). Never edit the justfile, harness/, .github/, contracts/**, screenshot baselines.
- When done: `send --type status --subject "ready #N @<sha>"` (and `"design #N @<sha>"` when baselines changed), then `_team/handoff-ui-<name>.md` (≤ 20 lines), `worker_done`, stop.
