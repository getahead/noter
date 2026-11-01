# ui-eng-1 (Opus) — task: land 2.10 call-window: #188 rebased, D-18 implemented, QA, published

Worktree `~/orca/workspaces/noter/ui-eng-1`, branch `lane/ui/call-window` = PR #188 (7a78d15, draft, base `lane/ui/live-transcript`, `visual-change-approved`, QA re-test PASS for its own items at 7a78d15). Read `spec-ui-r2-common.md`, your `handoff-ui-eng-1.md`, QA `_team/ui/qa/188.md`. Delete the throwaway `tmp/cw-main`.

**Do, in one push:**
1. GitHub reports #188 CONFLICTING (`i18n/en.ts`, both sides add keys): rebase onto `origin/lane/ui/live-transcript` (28778bf = main + #186; #186 is merging now — if it has merged, rebase onto `origin/main` and retarget the PR base to main with `gh pr edit 188 --base main`). Keep both sides' keys.
2. D-18: Got It calls the frozen command `window_share_warning_seen` (on main via #198; `apps/desktop/src/core/bindings.ts` regenerated there — never edit it); drop the `shortcut:` at `call-window.tsx:527`; tick `inst-share-warning` and its flow `cpt-noter-flow-ui-call-window-hide-for-presenting` (markers on the code). `inst-floating-heights` stays `[ ]` (M4) with its algo parent unticked.
3. Swap the nothing-heard inline discard to #182's `InlineConfirm` (`src/ui/dialogs/inline-confirm.tsx`).
4. D-17: `NavTarget::DeleteOldAudio` exists now (#198): route Delete Old Audio… through it and remove that shortcut too.
5. `just gate` (NOTER_CORE_CMD, lock) exit 0, E2E fake + stdio for `m1-call-window-ui` and `m1-live-transcript-ui` green. Tick DECOMPOSITION 2.10 + call-window.md featstatus/feature line in this PR if every item except the M4 one is `[x]` (an M4 step does not hold the box; say so in the PR body like D-30 did for 2.8).
6. Push, `send --type status --subject "ready #188 @<sha>"` to the Teamlead → QA; on PASS: `/cf-sdlc-pr-review 188` + `/ponytail-review` → `just review-publish 188` (base must be main by then). Handoff + `worker_done`.
