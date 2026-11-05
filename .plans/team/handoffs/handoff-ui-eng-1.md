# Handoff — ui-eng-1 (25 Oct, UI M1 r9) — #214 QA blocker fixed

**Task** task_2d65ccdab3fa (ctx_659cdfee22d5). Branch `lane/ui/call-page-finish`, **PR #214** @ **ef1c51d**: self-review APPROVE published @ef1c51d; auto-merge OFF (coordinator: the lead re-enables after QA PASS).
## Done (tests first: 359d4af failing → d657053; unit + E2E fake 33/33 and stdio 33/33; cfs validate, docs, gate-fast, trace green)
- **B1**: rebased on #213 (92c1073). `call-page/slots.ts` is kept; the page calls #213's `slots.deleteCall`; `main-window.tsx` registration stands.
- **M1**: `slots.deleteCall` returns its `DeleteOutcome`. A failed delete shows on the page above PC-R5 as **Couldn’t delete this call.** (or the recording copy for `already_recording`), with Try Again when retryable and ×. The error is cleared when the page closes. E2E fails `calls_delete` on fake and stdio.
- **M2**: ⌘⌫ on the page runs the same delete. It does not fire in text fields (the rename field), on key repeat, or before the call is read. E2E covers it on fake and stdio.
- Markers: dialogs-host `inst-user-delete`, `inst-return-delete-error`; call-page-frame `inst-case-delete`. The spec gains an error scenario for a failed delete.
- No baseline change expected: the banner only appears after a refusal.
## Left [ ] (owner / native), unchanged from r8
- AC "page loads without the main window becoming active" and AC "opening from the menu bar or a notification": native/XCUITest. So featstatus, the feature line and DECOMPOSITION 2.14 stay [ ].
## Notes
- The harness stop hook asks for auto-merge after the review; the coordinator said to keep it off.
- DESIGN defs for the 2.14 tick: cpt-noter-component-screen-call-page, cpt-noter-component-ui-person-chip.
