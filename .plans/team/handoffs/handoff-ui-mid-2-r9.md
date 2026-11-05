# Handoff ui-mid-2 r9 — 2.15 notifications finish (PR #211 @e5688ec)
- Branch lane/ui/notifications-finish from main 634c1a9. Change: marker `inst-return-allow` on the banner's requestNotifications→setAsked line (CallBanners.tsx); ticked inst-return-allow and flow `cpt-noter-flow-ui-notifications-allow`. Markers/ticks only, no QA needed.
- cfs validate, just docs, just gate-fast, just trace pass; CI green (gate, unit, tsc); self-review APPROVE published, auto-merge on. No baselines.
Left `[ ]` (owner items), one line each:
- inst-core-trigger, inst-post, inst-user-click, inst-match-click, inst-case-nt1/nt3, inst-return-receive: core posts/clicks natively (core lane / XCUITest).
- inst-send-rule step of the receive flow: the core applies the rule; the UI copy (`sendRule`) has no production caller by design (QA minor 1) — kept as the spec'd reference, not wired; ticking the receive flow waits on the core.
- Item state (pending-sent/held/held-sent/pending-dropped/sent-opened): state lives in the core's notification queue, UI holds none.
- DoD content: needs core send rule + NT-3 XCUITest; DoD permission: its test is E2E+XCUITest of the allow story (XCUITest = owner).
- 4 acceptance criteria: need core posting/hidden mode; E2E-only proofs cannot carry markers (e2e specs are not a scan root).
- featstatus/feature box: held open by the rows above.
- QA minor 2 (adapted e2e-m1 spec bodies): not changed here; the e2e owner syncs lane/ui/e2e-m1 (call page opened via window_navigate, loosened banner/× names, notAsked trims to one call).
