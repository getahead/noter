# UI M1 round 2 (25 Oct, LOW-COST MODE) — read with spec-ui-common.md; this file overrides it where they differ

Main now has #182 (dialogs host), #192 (fake fixes), #198 (contract: `NavTarget::DeleteOldAudio`, `window_share_warning_seen`, `CallDetail.folder`, harness items 11–12), #200 (tauri-plugin-dialog), #193 (harness items 3, 8, 9, 10). Rebuild the harness after you merge main: `cargo build -p noter-core-harness`.

- One task per dispatch; finish it, write `_team/handoff-ui-<name>.md` (≤ 20 lines), send `worker_done`, stop. No idle loops, no polling CI: run the checks, read results once, act.
- Conflicts: GitHub reports your PR DIRTY, so ONE `git merge origin/main` (or rebase) now is allowed; resolve, run `just gate-fast`, push. Never update a PR again unless GitHub reports a conflict again.
- One test job at a time on this Mac: every E2E/gate run under `NOTER_E2E_LOCK=$HOME/projects/noter-wt/.e2e.lock` (the justfile takes it). If the lock is held, wait for it, do not start a second run.
- QA is on demand: when your PR is ready (gate green, CI green or only visuals pending), `send --type status --subject "ready #N @<sha>" --body "<one line: what changed>"` to the Teamlead; the Teamlead dispatches QA; the QA report lands in `_team/ui/qa/<N>*.md` and as a PR comment.
- Publish rule (self-serve): once the PR carries QA PASS (+ `visual-change-approved` from the designer when it has screenshots) and `/cf-sdlc-pr-review <N>` (with `/ponytail-review`) is APPROVE or COMMENT → `just review-publish <N>` yourself; no "go" needed. Any push after the review needs a new review before publish.
- Visuals: add the `update-screenshots` label yourself when your PR needs baselines (CI writes them); the designer then reviews and adds `visual-change-approved`. Ask the Teamlead for the designer with `send --type status --subject "design #N"`.
- Ticks: tick the DECOMPOSITION box and the FEATURE `featstatus`/feature line in your own PR when every CDSL item of the feature is `[x]` with markers and `just gate` is green (as #182 did). `docs/DESIGN.md` is outside the ui lane: list DESIGN component defs that must be ticked in your handoff; the Teamlead lands them in one docs PR.
- Messages: one line each. heartbeat every 5 min while working. `check` before you start, after each test run and before `worker_done`.
