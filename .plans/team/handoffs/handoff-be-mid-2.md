# Handoff: be-mid-2 (24 Oct, M1 done)

All my M1 work is merged: #127, #140, #144, #148, #155, #172.

## Merged, by feature
- Fixture parity (contract): #127 `feat(contract): fixture parity for the M1 read models`; #140 library parity compares the fields M1 owns; #144 conformance follows the real library commands.
- 2.12 library calls (`cpt-noter-feature-core-library-calls`): #148 `crates/noter-core/src/library.rs` (`calls_list`, `call_get`, `call_update`, `call_types_list`, `calls_delete`), migration 0003 `call_tags`, harness `call_tags` rows plus `world_set` re-seed and the capture slice. The five-table seeding is #154's. Live delete answers `already_recording` (D-31). The call status state-machine boxes stay open on purpose (the capture session owns the transitions).
- 2.12 story test: #172 `m1-stories-library.test.ts` (`cpt-noter-seq-dialogs-delete-call`: list, record and snapshot gone, rows and `audio/<id>/` gone, one `undoable=0` content-free change row, several calls, `already_recording`, `window_not_allowed`, stale rev conflict).
- 2.11 native surfaces, core side: #155 `crates/noter-core/src/surfaces.rs` (call window state and placement, presenting, tray model, the window commands, `open_external` checks), `window_report_view` to `Core::report_view`, `release_held()` on un-hide. The scripted surfaces log in the harness writes `open_call_window_inactive` for the call window opening (the capture stories look for that string).

## Addendum (24 Oct, late): call status and the harness folder
#174 added `harness.data_dir` (and #172 now uses it). #176 put the status markers on the pause/resume/stop/continue writes. #178 (branch `library/status-ready`, cross-lane by construction, no lane prefix) writes `ready` through the change log once `transcript.jsonl` exists (`transcript.rs::mark_ready`, only for a call still `processing`) and its capture stories wait for it. `inst-st-failed` stays `[ ]`: moved to M2 by D-35 (the post-call job; `CapturePhase::Failed` is recoverable and the spec has no failed -> recording transition). The fake core writes no call status, so it needed no change.

## Left for others
- `m1-stories-surfaces.test.ts`: moved to be-mid-1 by the coordinator.
- XCUITest-only items of `core-native-surfaces.md` (hide-for-presenting, floating-panel stories, menu-bar stories, notifications, "never key / not in a screen capture", `just native`): UI lane, macOS runner.
- Host side (PR 5, `apps/desktop/src-tauri`): NSPanel swap for the call window and record prompt (NB10 owner item), tray menu/title/glyph calling the core as `Caller::Native`, frame restore per display (`inst-frame`) and the menu click (`inst-menu-click`): their scope markers and boxes are still open. tauri-nspanel pinned commit vs cargo-deny (sources/bans) is unresolved: needs an owner or DevOps decision before PR 5.
- A `harness.data_dir` control (and a `Scenario.dataDir` seam, `tests/support` is the UI lane's): would replace #172's folder scan (temp folders `noter-core-harness-*`, matched by a UUID marker in the past call's title). Also, the harness re-seed of a changed world leaves its own change rows (summary `harness world_set`); the story filters on `Deleted a call`.
- Leaked `noter-core-harness-*` folders in `$TMPDIR` (hundreds); harmless, they slow the scan slightly.

## Gotchas
- The lane guard (`.githooks/pre-commit`) refuses a merge commit that carries main's files outside your lane (e.g. `scripts/models/*.py`). Don't use `--no-verify`: rebuild the branch as one commit on `origin/main` (put the resolved tree on top of `origin/main`, take main's version of every file you did not change), force-push with `--force-with-lease`. PRs are squash-merged anyway.
- Local gate needs `cargo build -p noter-core-harness` and `export NOTER_CORE_CMD="$PWD/target/debug/noter-core-harness --fixture world"`, else `e2e-coverage` reads 0%. Also `NOTER_E2E_LOCK=$HOME/projects/noter-wt/.e2e.lock` and `PATH=/opt/homebrew/bin:/usr/bin:$PATH`.
- Trace ratchet: a branch behind main fails it. Build the branch directly on current `origin/main` and gate that; a ticked step needs a `@cpt-begin/@cpt-end` block (`cfs validate` says `code-inst-missing` otherwise). A scope marker (`// @cpt-flow:…`) on a flow whose box is `[ ]` is rejected: tick the flow when all its steps are delivered, else delete the marker.
- Re-fetch before every rebuild: main moves (a stale tree silently reverts others' changes, e.g. #168).
- GateGuard hooks ask for facts before destructive git commands and first-time file writes; stating them and retrying the same command passes.
- Never bare `git stash`, never `pkill -f`.

## Branches to delete (local, mine; none are needed)
`backup/native-surfaces-b8d1484`, `backup/library-calls-c077b2c`, `backup/library-calls-resolved`, `tmp-linear`, `tmp2`, and the merged `lane/core/native-surfaces`, `lane/core/library-calls`, `lane/contract/m1-stories-library` once their remotes are gone. The worktree sits on `be-mid-2/idle` at origin/main.
