# ui-mid-2 r8 — 2.9 record-prompt remaining rows: no change, all owner items
- Tried inst-core-detect: marker (@cpt-begin/end) in apps/desktop/tests/e2e/m1-record-prompt.spec.ts + box ticked -> `cfs validate` ERROR code-inst-missing (the e2e dir is not in the codebase scan roots of .cf-studio/config/artifacts.toml, harness-owned). Reverted; the validator refuses test-file markers there.
- inst-core-notice: same mechanism, same refusal -> owner item (not tried separately).
- Stays [ ] (owner): inst-core-detect, inst-core-notice (hold featstatus, feature line, DoD, start-recording + notice flow headers, DECOMPOSITION 2.9). Owner options: add apps/desktop/tests/e2e to the artifacts.toml codebase list, or mark in core-side code.
- Speech-model % gap (m1-record-prompt-ui.spec.ts:171): already closed — stdio asserts /still downloading \(\d+ %\)/, fake asserts 62 %. Nothing to add.
- AC boxes: unchanged (plain bullets, one XCUITest-only).
- No commits, no PR. Empty local branch lane/ui/record-prompt-finish left over (git branch -D blocked by the gate); worktree returned to lane/ui/notifications, clean.
