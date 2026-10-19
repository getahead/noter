# Noter UI team — working rules (read with ../CHARTER.md)

UI Teamlead: dispatch `ctx_6049ca66ecf8`, team Run `run_73fa9420226e`. Your coordinator is the UI Teamlead: blocking questions go through your preamble's `ask`; status and results through `orca orchestration send` / `worker_done`.

## Pipeline per FEATURE (docs/features/ui/<name>.md)
1. Teamlead assigns the feature to ui-eng-1 / ui-eng-2 (plan + task spec in `PLAN.md`).
2. Engineer: worktree from fresh `origin/main`, branch `lane/ui/<feature>`; `/cf-sdlc-implement` on the FEATURE spec; tests first (unit + E2E naming `cpt-noter-seq-…`); `@cpt-*` markers with IDs only from DESIGN*.md / FEATURE `**ID**:` lines; `just gate-fast` green while working.
3. Engineer pushes and opens a **draft** PR (Conventional Commit title, template filled) and tells the Teamlead. Visual change → label `update-screenshots`.
4. In parallel: **ui-qa** (PASS/FAIL with repro, notes in `qa/<PR>.md`), **ui-reviewer** (findings as a PR comment, marks blocking ones `BLOCKING`), **designer** (design fit vs DESIGN.md + prototype; for changed baselines: reviews every image, posts the table; adds `visual-change-approved` only when the Teamlead says 'label #N'), **ui-e2e** (E2E story coverage of that feature), **ui-perf** (perf scenario if due).
5. **Publish only after the Teamlead's go** (he forwards QA PASS + no BLOCKING + designer OK). Engineer fixes until QA PASS + no blocking reviewer finding + designer OK; then the full gate as two commands (see Hard rules; real exit codes), `/cf-sdlc-pr-review <N>` with `/ponytail-review` merged in, `just review-publish <N>`, loop until APPROVE/COMMENT. Auto-merge does the merge; never merge by hand.
6. After merge, engineer ticks the FEATURE box(es) in docs/DECOMPOSITION.md in the next PR only when markers are present and the gate passed (or the Teamlead does it in a docs PR).

## Hard rules
- `export PATH=/opt/homebrew/bin:/usr/bin:$PATH` first in every shell; `just setup` once per new worktree.
- Gate (since #72, 18 Oct 17:20): every shell `export PATH=/opt/homebrew/bin:/usr/bin:$PATH NOTER_E2E_LOCK=$HOME/projects/noter-wt/.e2e.lock`, rebase on main, then plain `just gate` (the justfile locks only e2e/visual/visual-update). Never wrap a gate in lockf; never pkill. Call Orca by full path `/Applications/Orca.app/Contents/Resources/bin/orca`.
- UI lane only: `apps/desktop/**` except `apps/desktop/src-tauri`, `apps/desktop/src/core/fake/**` and `apps/desktop/tests/conformance` (backend's). Harness files (`harness/`, `scripts/`, `.github/`, `justfile`, test configs) → DevOps via the Teamlead.
- Never: hand-edit generated files (`contracts/**`, `bindings.ts`) or baselines/golden data; remove markers; skip tests; lower thresholds; add coverage exclusions; bare `git stash`.
- Need a contract/fake-core change → tell the Teamlead (Backend Teamlead owns it). Spec/behaviour question → Teamlead (routes to HoD). PR plumbing (behind, conflicts) → Babysitter via Teamlead.
- ≤ 2 open PRs per engineer. Do not post to Slack.
- Read-only roles sharing a worktree never switch its branch: use `gh pr diff <N>`, `gh pr view`, `git fetch origin pull/<N>/head:pr-<N>` + `git worktree add /tmp/...` if you must run it.

## Messages to the Teamlead
- Progress / PR opened / ready for QA: `orca orchestration send --from <your preamble handle> --type status --subject "<role>: <short>" --body "<what, PR #, next>" --task-id <your task> --dispatch-id <your dispatch>` (omit --to: it goes to the team Run mailbox the Teamlead reads).
- Blocked on something only the Teamlead/another team can unblock: `--type escalation`. A question you must have answered before continuing: your preamble's `ask`.
- Heartbeat every 5 minutes while working, per your preamble.

## Orca CLI and GitHub posts (lead, 18 Oct 16:50)
- `/usr/local/bin/orca` is broken ("Unable to determine Orca.app path from symlink"). Start every shell with `export PATH=/Applications/Orca.app/Contents/Resources/bin:/opt/homebrew/bin:/usr/bin:$PATH` (or call `/Applications/Orca.app/Contents/Resources/bin/orca` directly).
- The preamble's "don't post to GitHub" does NOT cover the review work of this team: ui-reviewer posts its review as a PR comment, ui-qa posts "QA: PASS|FAIL", the designer posts its review table and adds `visual-change-approved` after the lead's "label #N". Engineers push branches, open PRs and run review-publish as usual. Nothing else goes to GitHub, and nothing to Slack.

## FINISH-FIRST FREEZE (owner, 18 Oct 17:34 — until the owner lifts it)
No new feature branches, PRs or FEATURE work. Work only the existing queue: rebase, fix red checks and BLOCKING/QA findings, QA/design/review loops, publish on the lead's go. Exception: a PR an open PR needs in order to merge (say so in its body). Never publish with an open BLOCKING finding or a QA FAIL.
