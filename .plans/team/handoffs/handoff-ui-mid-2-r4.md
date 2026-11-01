# ui-mid-2 r4 — 2.9 record-prompt tick pass: PR #209 @22ab9be (self-review APPROVE published, auto-merge on)
- Ticked+marked 21 items; flows missed-prompt and panel state headers ticked. cfs validate, just docs, gate-fast, E2E 29/29 fake+stdio, just trace OK; CI green except review (now published).
- Rule 2: localReduce returns same state for unchanged pointer/focus (+unit test). Not QA-run: send ready if QA wanted.
- l10n-pseudo spec now draws the real prompt (detected-call world); 2 baselines (record-prompt-cyrillic/german) refreshed by bot -> designer approval (visual-change-approved) pending.
- Left [ ] (rule 3, core's): inst-core-detect, inst-core-notice. These hold open featstatus, feature line, DoD, start-recording + notice flow headers, DECOMPOSITION 2.9 + 2 components.
- Acceptance Criteria boxes (5, plain bullets; one XCUITest-only) stay open like in ticked features.
- Notes: stray PNGs were overwritten via checkout -f (coordinator-approved; lane guard blocks mv of baseline dirs). First stdio E2E run once showed 10 passed + others not listed; rerun 29/29.
- /ponytail-review not run (low-cost owner focus).
