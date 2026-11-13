# Issue #482 implementation phase

Execution contract: the user's assigned sequence (prerequisites → failing regression → smallest fix → gates → PR → local self-review → publish).

Source FEATURE: `docs/features/ui/items.md`, `cpt-noter-flow-ui-items-status` and `cpt-noter-dod-ui-items-actions`; DECOMPOSITION §2.17 (M2). Loading behavior comes from `docs/features/ui/core-bridge.md`, `cpt-noter-state-ui-core-bridge-command`; DECOMPOSITION §2.1 (M0). DESIGN: `cpt-noter-component-ui-action-item-row`, `cpt-noter-component-app-core-bridge`, `cpt-noter-seq-today-tick-item`.

1. Reproduce overlapping completion submissions and the enabled waiting checkbox in unit tests.
2. Reuse `commands[item:done:<id>]` to guard duplicate completion submissions and disable the row completion controls until resolution. No new IPC or design IDs.
3. Prove delayed real-core completion blocks repeated mouse/Space activation and permits a later untick. Preserve typed errors, refresh and Undo.
4. Run `just gate-fast` and `just gate` with isolated checkout artifacts and `NOTER_E2E_LOCK=/tmp/noter-issue-agents-e2e.lock`; no harness/config changes.
5. Commit, push, open PR with Closes #482, perform Constructor Studio review and own local ponytail-review on its diff, publish passing review. The user's delivery override on 13 Nov permits publication before the local full gate completes; CI remains authoritative for the full gate.

Relevant files: `apps/desktop/src/features/items/actions.ts` (`setDone`), `ActionItemRow.tsx` (checkbox and Done-list action), their adjacent tests, `apps/desktop/tests/e2e/m2-items-ui.spec.ts` (delayed transport using existing test pattern). Callers of `setDone`: row checkbox, Done-list Reopen, and tests. The shared guard covers all callers; other item commands and bridge API remain compatible.

Phase DoD / acceptance: duplicate pending completion does not issue a second mutation or alter feedback; loading controls expose native disabled semantics; success and failure unlock controls; independent items remain actionable; later untick uses the updated rev; regression runs through the real core. Existing trace markers and quality bars remain. Both gates pass; PR review has no blocking findings before publication.

Local evidence: the regression failed before the fix; final `just gate-fast` passed (1,550 UI tests plus Rust suites). Coverage passed at Rust 95.32%, UI 90.77%, and changed UI lines 100%. The targeted real-core double-click/Space regression passed. The full local gate reached native tests after successfully building the app, then remained inconclusive and was interrupted only in this checkout under the user's publication override. The user reported accidental computer disablement; sleep/lock and concurrent native sessions are possible environmental factors, not established causes. No native-lock or harness changes are included.
