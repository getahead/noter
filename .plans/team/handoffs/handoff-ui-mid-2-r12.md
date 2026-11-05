# ui-mid-2 r12 handoff (31 Oct)
- PR #226 `test(ui): record prompt countdown under Reduce motion (2.9)` merged 22:21Z; test-only, no production code.
- Test: m1-record-prompt-ui.spec.ts, describe cpt-noter-seq-call-screen-stop-at-call-end, "...under Reduce motion the countdown bar is absent, the seconds still update and are never announced".
- Ticked: record-prompt.md §6 row "The countdown bar is absent under Reduce motion...".
- Still [ ]: the XCUITest rows and dod-record-prompt-panel (close with #203, per spec).
- CI: one e2e flake on m1-call-page-frame-ui.spec.ts:121 (heading "Calls" not found); `gh run rerun --failed` once, green. Not in the known-flake list.
- Gates: just gate-fast, gate, docs, cfs validate, trace all exit 0 locally.
