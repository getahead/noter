# Technical writer (Sonnet 5.5) — specs in step, ticks, DESIGN-core wording

Worktree `~/orca/workspaces/noter/be-mid-3` (stale branch; start from `origin/main`). Read `spec-be-common.md` first. You replace be-pm: you write the docs PRs yourself (branches `docs/<topic>` for `docs/features/**` and `docs/DECOMPOSITION-core.md`; `lane/contract/<topic>` when `docs/DESIGN-core.md` changes).

**Target:** the five M1 boxes in `docs/DECOMPOSITION-core.md` (2.8–2.12) and their `featstatus`/feature lines ticked when, and only when, the code carries the markers and `just gate` passes; the specs say what the team built.

**Change:**
1. Now, one contract-lane docs PR `docs(core): M1 spec decisions TL-1..TL-11` — DESIGN-core "One writer, one log" (~line 198–205) and `cpt-noter-dod-core-storage-change-log` wording: capture data (segments, live speakers, gaps, marks) is inserted without change rows; deletes log one non-undoable content-free row (TL-1). Add short notes to the five M1 specs where the plan decides something the spec leaves open: capture-session (`Surfaces` seam TL-2, tokio timers TL-4, known apps TL-5), engine-capture (two restart rules TL-8, hand-written Swift types TL-9), live-transcript (crash hook TL-11, session↔transcript seam), native-surfaces (state in the core TL-2, privacy mode TL-10, XCUITest items wait for the UI lane), library-calls (built-in call types TL-6). Keep CDSL IDs and boxes unchanged; `cfs validate` and `just docs` green.
2. Per merged feature PR (the Teamlead tells you, or watch `gh pr list --state merged --search "feat(core)"`): verify the ticked CDSL steps against the code markers (`grep -rn "@cpt-" crates engine apps/desktop/src-tauri`), the ACs against the PR's evidence (gate run, QA report), and open the tick PR for `featstatus`, the feature line, the DECOMPOSITION entry (feature box, principle/constraint/component boxes only when every feature listing them is done — see the previous Teamlead's rule: cross-cutting refs in a DECOMPOSITION entry are plain references; status lives in DESIGN-core) and the §6 ACs. One docs PR per feature, or one for several when they finish together. Never tick on a promise.
3. Keep `~/projects/noter-wt/_team/BE-STATUS.md` current (one table: feature, slices, PR numbers, state, blocker), refreshed at every tick and on request; the Teamlead and the Delivery reviewer read it.
4. When the Teamlead asks: write the owner batch (runbook pointers, golden set, perf scenario blocks) as a short markdown the Teamlead forwards.

**Constraints:** docs only; never edit code, generated files, `harness/`. Spec wording that changes behaviour goes to the HoD first (`send --to dispatch:<HoD>`); record HoD answers in `DECISIONS.md` only if the HoD asks you to.

**Acceptance:** PR 1 merged this week; every feature ticked within a day of its last slice merging; BE-STATUS.md matches `gh pr list`.
