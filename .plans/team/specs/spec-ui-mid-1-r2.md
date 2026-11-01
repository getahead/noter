# ui-mid-1 (Sonnet) — task: land 2.13 library-calls: #197 on main, D-36 copy, stdio green, QA, published

Worktree `~/orca/workspaces/noter/ui-mid-1`, branch `lane/ui/library-calls` = PR #197 (4e651cd, draft, CONFLICTING with main). Read `spec-ui-r2-common.md`, QA `_team/ui/qa/197-r2.md`, DECISIONS D-29/D-35/D-36.

**Do, in one push:**
1. Merge `origin/main` once (conflict reported), resolve, `just gate-fast`.
2. QA M-1: D-36 — status copy is exactly "Audio deleted" (no date, no "(kept N days)") in `status-cell.ts`/`i18n/en.ts` + unit tests; update the assertion in your copy of `tests/e2e/m1-library-calls-ui.spec.ts` (~:186) to the new copy (titles, commands and arguments unchanged; ui-e2e aligns `lane/ui/e2e-m1` later: note it in your handoff).
3. Stdio failures (x-1, x-2 in 197-r2.md) are spec-side: in your copy of the spec, line ~93 stop arming `app.setup.detection_enabled` (use a `world_set` field the harness accepts, see `docs/HARNESS.md` and `crates/noter-core-harness/src/boot.rs` world_set keys after #193/#198) and line ~146 seed speaker rows so the core derives `unnamed_speakers` = 2. The spec must pass fake 7/7 and `NOTER_CORE=stdio` 7/7.
4. m-1: check the empty-state/self-test effect for a setState loop ("Maximum update depth exceeded" once on stdio); fix if real.
5. `just gate` exit 0 (NOTER_CORE_CMD, lock). Tick DECOMPOSITION 2.13 + library-calls.md featstatus/feature line in this PR if every CDSL item is `[x]` with markers. Do NOT tick 2.8 (waits on ui-e2e's XCUITest Cancel-default).
6. Push, `send --type status --subject "ready #197 @<sha>"` → QA; on PASS: `/cf-sdlc-pr-review 197` + `/ponytail-review` → `just review-publish 197`. Handoff + `worker_done`.
