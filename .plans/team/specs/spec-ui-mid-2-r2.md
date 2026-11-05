# ui-mid-2 (Sonnet) — task: resolve #183 and #191 on main, then land 2.9 record-prompt (#191)

Worktree `~/orca/workspaces/noter/ui-mid-2`. PRs: #183 `lane/ui/call-page-frame` (d5f4bd3) and #191 `lane/ui/record-prompt` (556dcb5), both draft and CONFLICTING with main (`i18n/en.ts`); `lane/ui/notifications` (cfa60c6, stacked on #183) has a draft PR now (the Teamlead opened it). Read `spec-ui-r2-common.md`, your `handoff-ui-mid-2.md`, QA `_team/ui/qa/191-r2.md`, `183-r2.md`. Drop your stray stash entry 765d5ac (`git stash list --format='%H %gs'`, drop by its current index).

**Step A — both conflicts now (owner order):** on each branch one `git merge origin/main`, resolve en.ts keeping both sides' keys, `just gate-fast`, push. Report `send --type status --subject "conflicts resolved #183 #191"`. (Leave the designer's CHANGES on #183 and its B-3 for the next task; only push the merge, plus anything you already had locally for #183 that passes gate-fast.)

**Step B — #191 to published:**
1. QA B-1: `record-prompt/actions.test.ts` fixture `det`: `detected_at: Date.now()`, `prompt_until: Date.now() + 30_000` (check the other tests on `det`). m-1: clamp `modelPercent` 0–100 in `logic.ts:62`.
2. D-17: `actions.openDeleteOldAudio` uses `NavTarget::DeleteOldAudio` (on main via #198; bindings regenerated, never edited).
3. Stdio: line ~207 "Setup incomplete" was refused by `world_set`; #193/#198 added harness controls (`app.detection`, see `docs/HARNESS.md`, `boot.rs` world_set keys): make your copy of `m1-record-prompt-ui.spec.ts` pass fake 19/19 and `NOTER_CORE=stdio` 19/19 by seeding what the harness accepts (titles/commands/arguments unchanged). If a harness key is still missing, `send --type escalation` with the exact key and test line, and continue.
4. Visuals: add the `update-screenshots` label, `send --type status --subject "design #191"` for the designer.
5. `just gate` exit 0 (NOTER_CORE_CMD, lock). Tick DECOMPOSITION 2.9 + record-prompt.md featstatus/feature line in this PR if every CDSL item is `[x]` with markers.
6. Push, `send --type status --subject "ready #191 @<sha>"` → QA; on PASS + `visual-change-approved`: `/cf-sdlc-pr-review 191` + `/ponytail-review` → `just review-publish 191`. Handoff (state of #183: what the designer's CHANGES need, B-3 banner facts on the real core) + `worker_done`.
