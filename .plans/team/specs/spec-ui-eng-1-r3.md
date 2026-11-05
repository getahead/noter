# ui-eng-1 r3 — #183 call page frame: apply the fix list, baselines, then ready (read spec-ui-r3-common.md first)

Worktree ~/orca/workspaces/noter/ui-eng-1. #188 (lane/ui/call-window @db74e1b) is done and pushed: leave it. Switch: `git fetch origin && git checkout lane/ui/call-page-frame` (head 1815081, rebased on main by ui-mid-2; ui-mid-2 is on #191 now). #202 is stacked on this branch with old commits — do not touch #202.
Fix list (QA 183-r2.md, designer review comment on the PR, Unblocker):
1. Designer CHANGES: `features/call-page/call-page.css` is never imported → import it in CallPage.tsx (as shell does shell.css).
2. Visual specs `tests/visual/call-page-frame.spec.ts`: "loading: skeleton rows after 300 ms" — `getByRole('status', { name: 'Loading the call' })` never appears: fix markup or spec; "⋯ menu with Call Type open" — the submenu items are `menuitemcheckbox`, not `menuitem`.
3. stdio :64 subtitle: Teamlead decision — the subtitle shows `date · duration · participants` when the core sends participants. Check what `call_get` returns on stdio for the fixture call: if it carries participants and the page drops them, fix the page; if it carries none, assert only `/52 min/` on stdio (`NOTER_CORE=stdio`).
4. stdio :221/:232/:244 banner: the core computes `first_recorded_call = (calls == 1)` (library.rs:452); `world_set` cannot set the flag, so `quiet(true)` must leave exactly ONE call in `w.calls` and `w.call_details` on stdio.
5. fake :178/:192 Sensitive switch (QA B-1): #192 is on main → re-test; if still red, re-read `call_get` after the ok.
6. Call Type labels case: the UI shows the core's labels as given; note only.
Then: spec fake+stdio under the lock, `just gate-fast`, push, `gh pr edit 183 --add-label update-screenshots`, `gh pr checks 183 --watch`; fix until green (the bot commits baselines; watch again); then `/cf-sdlc-pr-review 183` + `/ponytail-review` on the final head, send `design #183 @<sha>` and `ready #183 @<sha>`, handoff (list the DESIGN component defs for the 2.14 tick), worker_done. Do not publish; QA + designer run next.
