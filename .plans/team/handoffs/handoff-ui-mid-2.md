# Handoff ui-mid-2 r5 — #202 notifications (head 7cb0e4e)
- Rebased onto #183 head c5b53d5: cherry-picked only my 2 notifications commits (git rebase --onto also pulled main's commits that came in through the old merge). Force-pushed with lease; no merge commit. `git log origin/lane/ui/call-page-frame..HEAD` = 4 commits: tests, impl, banner/E2E/ticks, import-order fix.
- Feature: CallBanners offers the prompt only if first_recorded_call && environment.notifications is not_determined (Teamlead decision); unit test added first.
- m1-notifications-ui.spec.ts: 7/7 fake and 7/7 stdio under the lock (world seeded with one call; nav:request via window_navigate on stdio).
- Local gates against NOTER_BASE_REF=origin/lane/ui/call-page-frame: gate-fast, trace, docs pass. Against origin/main trace fails only because #183's base predates #207/#208 markers; not this PR.
- No CI runs on #202 (stacked on a non-main base), so `gh pr checks` has nothing to watch; CI starts after GitHub retargets to main.
- No screenshots in this feature (native), no update-screenshots label, no design message.
- Self-review APPROVE published at 7cb0e4e (cf-sdlc-pr-review + ponytail-review; one import nit fixed). PR kept draft; auto-merge could not be enabled while draft: run `gh pr merge 202 --auto --squash` after marking ready.
- Ticked: inst-banner-flow, inst-nothing-else, inst-if-denied, inst-denied-allowed, inst-allowed-denied, permission state header (+ earlier send-rule, off-line, notasked-*).
- Left open (reason): flow-allow header/inst-return-allow and receive flow steps (core posts/clicks, core lane); item state; both DoDs and ACs (need core posting + XCUITest native tests, M2 for NT-1/NT-2 clicks); featstatus/feature box.
