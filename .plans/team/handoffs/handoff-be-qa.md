# Handoff: be-qa (Backend QA) — 2026-10-18

## Role
Read-only QA for the backend team (core, contract and engine lanes). For every PR the Backend Teamlead dispatches, check it and report
**PASS or FAIL with evidence** (commands, exit codes, coverage numbers, failing file:line) in one `worker_done`. FAIL items must be
concrete and actionable (file:line plus the exact fix). Never push, never commit to a branch, never comment on GitHub, never merge.
Finish every task with the worktree clean and detached at `origin/main`.

## Worktree
`~/orca/workspaces/noter/be-qa`, left detached at `origin/main` (86b0f3c at handoff), clean.
- Every shell command starts with `export PATH=/opt/homebrew/bin:/usr/bin:$PATH` (Orca's PATH puts the old CommandLineTools `ld`
  first, which fails with `tapi error: unknown architecture arm64e.x1-macos`).
- `just setup` again whenever main changes the lockfiles. Example: after #36, `tsc` failed with `TS2688 vite/client` until
  `just setup` reinstalled node_modules.

## Checklist per PR
1. **Fetch without branches:** `git fetch origin +pull/<N>/head:refs/qa/pr<N>`. `gh pr checkout` fails when another worktree holds
   the branch, and has no `-q` flag.
2. **Test what will land:** if the PR is behind main, build a local merge and gate that:
   `T=$(git merge-tree --write-tree origin/main refs/qa/prN) && M=$(git commit-tree $T -p origin/main -p refs/qa/prN -m "qa: local merge (not pushed)") && git checkout -q --detach $M`.
   Re-fetch just before the gate. **origin/main moves often**, and a stale base gives false config-guard "loosened" results (e.g.
   #24's milestone move looked like a revert). Before reporting, re-check the PR head: if it moved only by "Merge branch 'main'",
   compare trees (`git rev-parse <merge>^{tree}` against the head's) and range-diff the PR commits.
3. **Gate with the lane:** `NOTER_LANE=<core|contract|engine> just gate`. A detached HEAD has no lane otherwise, and config-guard
   `--lane-check` then judges nothing. Run long gates in the foreground (Bash timeout 600000) or as a tracked background job, and
   don't run anything else in the same worktree meanwhile.
4. **Tests first:** for each test commit, build its tree alone and expect a failure, then expect green at the next commit:
   `W=$(mktemp -d /tmp/be-qa-rN/tf-<sha>.XXXX); git archive <sha> | tar -x -C $W; (cd $W && CARGO_TARGET_DIR=$W-target cargo test --quiet --locked -p <crate>)`.
   - Use **one target dir per tree**. A shared CARGO_TARGET_DIR mixes builds and gives bogus errors (it happened on #20 and #37).
   - If the crate becomes a workspace member only in a later commit, copy that commit's Cargo.toml/Cargo.lock into the exported tree.
   - Bound possibly hanging runs with `perl -e 'alarm 400; exec @ARGV' cargo test ...`; macOS has no `timeout`.
   - Swift: `git archive <sha> engine | tar -x -C $W; (cd $W/engine && swift test)`.
   - For a fix with tests in the same commit, swap the old implementation file in locally, run the new tests (expect FAIL), then
     `git checkout -- <file>`.
   - Also check test edits inside feat/fix commits: they must strengthen tests, never weaken them.
5. **Coverage:** use the `### Unit coverage` table from cov-unit (Rust %, UI %, **changed lines** >= 80%). If changed lines read 0/0 for
   a code PR, look for a coverage exclude in `harness/harness.toml` and measure from `coverage/unit/rust.lcov` directly, e.g.
   `awk -F'[:,]' '/^SF:/{f=$2} /^DA:/{if(f~/noter-native/){t++;if($3>0)c++}} END{print c"/"t}' coverage/unit/rust.lcov`.
6. **Markers:** map every `@cpt-*` in the changed code to its `**ID**:` line or `inst-*` step in docs/features/** or docs/DESIGN*.md.
   - Feature-level markers (flow, algo, state, dod, block) only on `[x]` items. DESIGN component/interface scope markers on `[ ]`
     parents are the accepted convention.
   - Reverse check: every item the PR ticks has a marker in code.
   - The kit rule (`.cf-studio/config/kits/sdlc/codebase/rules.md:110`): add block markers and tick the step together.
   - `cfs validate` does NOT flag these mismatches; only a review catches them.
   - Swift is not a registered codebase, so Swift-only boxes stay `[ ]`.
7. **No skips or pragmas** in added lines (`#[ignore]`, `.skip/.only/.todo`, `skipIf`, coverage off, `LCOV_EXCL`, `istanbul/c8/v8
   ignore`, `@ts-ignore`), no harness edits (harness/, scripts/harness/, .github/, justfile, test configs), no hand edits to generated
   files (contracts/**, apps/desktop/src/core/bindings.ts). `.skip(1)` on an iterator is fine.
8. **Story IDs** in E2E names: `cpt-noter-seq-...` (XCUITest `test_cpt_noter_seq_...`). Conformance rule tests aren't stories.
9. **Conformance:** fake runs in the gate. `NOTER_CORE=stdio` needs `NOTER_CORE_CMD` and the noter-core-harness (#47); until it's on
   main, report it as not runnable.
10. **Tauri host** (`apps/desktop/src-tauri`, own Cargo.lock, not a workspace member, so `just gate` never builds it): run what CI's
    macOS job runs, plus the lint it skips:
    `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo clippy --locked --all-targets --manifest-path ... -- -D warnings`,
    `cargo fmt --manifest-path ... -- --check`. Afterwards, back on a main without src-tauri, delete the untracked
    `apps/desktop/src-tauri/` build output (target/gen/permissions, ~3 GB), but only if `git ls-files apps/desktop/src-tauri` is empty.
11. **Engine (Swift):** `cd engine && swift test`; `just arch` fails on network entitlements. Remove `engine/.build` if main has no
    engine/.gitignore.
12. **CI and review:** `gh pr checks N`; unresolved review threads via GraphQL (`reviewThreads{nodes{isResolved}}`). When `review` FAILS,
    read the self-review comment (`gh pr view N --json comments`, body contains `noter-self-review`) and verify each blocking item in
    the code yourself before repeating it.

## Report convention
- Logs and report under `/tmp/be-qa-rN/` (next free: **r13**). Write the report as `/tmp/be-qa-rN/REPORT.md` and pass it with
  `--report-path`.
- The `worker_done` body starts with PASS or FAIL (per PR when several), then evidence, then what's left.
- Send `worker_done` exactly once. Heartbeat every ~5 minutes. `orca orchestration check` before the start and before `worker_done`.
- Verify `dispatch-show --task <id>` reports `completed`.
- Make sure the worktree is clean BEFORE sending. On #29 I sent "clean" while 3 GB of src-tauri build output was still there, and had
  to clean up afterwards.

## Environment gotchas
- **zsh path modifiers:** `$P:e…`, `$r:h…` and similar are modifiers. Write `"${P}:path"` in `git show` paths.
- **Shell expansion:** in zsh a variable holding a whole command (`D="git diff ..."; $D`) doesn't word-split; use a function. `====` at
  the start of a line is an error (`=` expansion).
- **Lane guard:** it blocks any shell command (even a heredoc or git plumbing) whose text names a generated path such as
  `contracts/egress-hosts.json` or `contracts/ipc.manifest.json`. Use the Write tool for reports that mention them, and don't edit
  generated files even in scratch clones.
- **Fact-Forcing Gate (GateGuard):** it asks for facts before the first Bash, before `rm`/`update-ref -d`/checkout, and before the
  first Write to a new file. State them and retry.
- **Stop hook:** it runs `just gate-fast` in the worktree when a turn ends. Its macOS PATH bug is fixed by #24 (on main). It can still
  collide with a background gate in the same worktree; one gate was SIGTERM-killed that way. Prefer waiting for gates in the
  foreground inside the turn.

## Open notes for the owner
- **Tauri host lint:** clippy/rustfmt for `apps/desktop/src-tauri` run in neither `just gate` nor CI (the macOS job runs only
  `cargo test`). Clean as of #29 (54d0572).
- **noter-native coverage:** `harness.toml:55` excludes `crates/noter-native/**` from unit coverage (whole crate). lib.rs is pure,
  OS-independent mapping logic at 97%; narrowing the exclude to `src/mac.rs` would keep the 80% bar on it. Today the crate measures
  265/315 = 84.1% from lcov.
- `just gate` doesn't run `swift test`, and there's no Swift coverage gate (CI's macOS job runs the engine tests).
- `noter-db` has only `write`/`write_batch`; the `insert_batch` and `delete(entity, ids, meta)` named by #48/M1-D1 are still to build, and
  core-storage has no CDSL step/ID for them.

## Update 22 Oct (M1 run, reports /tmp/be-qa-r13..r17)
- Local gate also needs `cargo build -p noter-core-harness && export NOTER_CORE_CMD="$PWD/target/debug/noter-core-harness --fixture world"` or E2E coverage reads 0%.
- Verdicts: PASS #125 (r13), #126 (r14), #131 (r15). #127: FAIL r16 (fix without test; fake `calls_delete` kept transcripts), re-QA r17: PASS (test 2ca2906 fails on the old handler, fix feafbc2 drops call_details and transcripts, gate contract lane exit 0, rust 96.31%, frozen 22/22). Open after re-QA: CI unit/e2e/perf/macOS still pending; perf +12.2% is parked for the owner (not a QA item).
- Checks added by HoD ratification (D-22..D-27): delete change row (actor, entity_type, entity_id, reason, status=applied, undoable=0, no content, same-tx cascade); capture inserts write no change row; story tests count only with exact story ID and core-visible assertions; `fail_after_commit_once` not in the release binary.
- Open notes: `call_tags` (DESIGN) is not in migration 0002, library-calls must add it; DESIGN-core "every write is a change-log row" carve-out belongs to the writer's docs PR; fixture parity tests pass vacuously on a real core until library-calls answers (`ahead()`).
- zsh: loops over `"a b"` pairs do not split, use a shell function; `$REV:path` is a modifier, write `"${REV}:path"`; a redirect truncates the target before `git show` fails, so restore swapped files from `"HEAD:path"`. GateGuard also blocks `rm` and `git checkout --` (skip cleanup of /tmp scratch dirs).
- Monitor filters: do not grep for "failed" (matches "0 failed"); wait on "All gates passed" or `! pgrep -x just`.

## Status at handoff (all reported)
PASS: #20, #21, #23 (+ post-merge 1bff2f4), #25, #27, #28, #29, #31, #37, #38, #42, #46, #48, #49, #51, #61. None open on be-qa.

## Update 24 Oct (M1 run, reports /tmp/be-qa-r18..r55; next free: r56)
Verdicts per PR (report dir in brackets; each has REPORT.md with commands, exit codes and file:line):
- r18 no open PR. r19 #136 PASS. r20 #138 PASS (static). r21 #139 PASS (swift 34 tests, test first).
- r22 #141 capture machine: FAIL (3 markers on [ ] items; code and gate fine); #140 post-merge PASS; #139 delta PASS.
- r23 #145 one-clock capture: FAIL (@cpt-flow on a [ ] flow, EngineLoop.swift:147). r24 #146 replay route: PASS (test commit did not compile alone). r25 #148 library: FAIL (docs conflict with #149, no red test commit); #147 post-merge PASS (r26); #150 detection facts: FAIL post-merge (r27: 4 flow markers on [ ] flows, no runbook steps, inst-play-excluded on code that excludes nothing).
- r28 #154 harness seeds call tables PASS; r29 #152 capture stories PASS; r30 #153 live ASR FAIL (r27 fixes not carried).
- r31 #157 FAIL then PASS at e92b5e9 (r36); r32 #160 FAIL (restart DoD ticked before Q7) then PASS at 32aa7fd (r36); r33 #159 transcript parity FAIL on one field (suggestion, accepted); r34 #158 PASS; r35 #155 FAIL (4 items), r42 re-check: all fixed, history shape waived.
- r37 #162 PASS; r38 #163 PASS and r40 #165 PASS; r39 #164 live transcript PASS (4 notes); r41 #166 PASS; r43 #168 PASS; r44 #169 PASS; r45 #148 (rebuilt) PASS; r46 #170 Tauri host surfaces PASS (history waiver); r47 #171 PASS; r48 #172 PASS, r52 rework PASS; r49 #158 re-check PASS; r50 #174 PASS; r51 #175 host wiring PASS; r53 #176 PASS (spec gap: ready); r54 #177 PASS; r55 #178 PASS.
Checks added this run:
- D-30: perf skipped (no perf files, perf not in the gate after #142). D-31 live-call delete -> already_recording; D-32 one live label per side (you / spk_1); D-33 the saved call is closed (capture_continue -> ContinueWindowClosed); D-34/D-35 not re-derived here (D-35: inst-st-failed moves to M2, st-ready ticked in #178).
- D-22: capture inserts via insert_batch with no change rows; delete writes one non-undoable content-free row; harness clear_calls does write delete rows (note, harness only). D-24 two bundle-id lists; D-25 eight built-in types; D-27 crash hook (fail_after_commit_once) not in the release binary: check with `cargo build --release -p noter-core` and `strings` on the rlib (0 hits; #168). D-26 story tests: exact cpt-noter-seq IDs, core-visible assertions, IDs in coverage/e2e/commands-*stdio*.json (check with a python walk over `stories` and `commands`).
- Method: local merge with origin/main, `NOTER_LANE=<lane> NOTER_E2E_LOCK=$HOME/projects/noter-wt/.e2e.lock just gate` with NOTER_CORE_CMD set (the default gate prints lock="" and then parallel gates fight over the web server port: 52 false e2e failures once). Non-lane branches (library/status-ready, native/notifications-calendar) must be gated WITHOUT NOTER_LANE or config-guard --lane-check fails. src-tauri: `cargo test/clippy --locked --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml` and `cargo fmt --check` (tests/package.rs is unformatted on main, ignore). Share CARGO_TARGET_DIR=<worktree>/apps/desktop/src-tauri/target for exported trees so the 8.5 GB build is reused. Never move the checkout while a gate runs, and wait on a unique DONE line (a stale `exit` line in a reused log ended one wait early: use a new log name).
- Tests-first for same-commit fixes: export the commit, restore the source files from `$c^` with `"${W:?}"/"${f:?}"` (the rm guard rejects plain `rm -f $W/$f`), run the new tests, expect FAIL. zsh: write `"${R}:path"`, never `$R:path`.
- Markers vs ticks: python script over the spec (steps `[ ]`/`[x]` with `inst-*`) and the code (`@cpt-begin/@cpt-end`, scope `@cpt-flow/algo/state/dod`): begin = end, no marker on an unticked step, no scope marker on a `[ ]` item, every ticked step has a marker, a `[x]` item has no open step, a DoD `[x]` needs its Implements items all `[x]`.
Waivers granted by the Teamlead: #148/#155/#170 history shape (tests and implementation reordered or in one commit, behaviour covered; squash-merge); #159 `speakers[].suggestion` exclusion (M2); #172 data-dir lookup by UUID marker (then replaced by harness.data_dir, #174); no waiver was ever given for markers on unticked items.
Recurring findings: (1) markers or scope markers on [ ] items (#141, #145, #150, #153, #155, #160): the single most common FAIL, `just trace` does not catch it; (2) tests-first history rebuilds that put the implementation into the "failing tests" commit (#155) or feat+tests in one commit (#148, #154, #170); (3) a first test commit that does not compile alone (#146) or intermediate commits that do not compile (#164, rebase brace); (4) fixes without a test that fails first (#155 52ce276); (5) specs that claim more than code does (#176: ready write vs spec step 4, fixed in #178; #160 DoD ahead of Q7).
UI-lane flakes seen: `m1-record-prompt.spec.ts:174` (confidence: null, fixed by #143) and first-run a11y/visual flakes under CPU or port contention (`m0-a11y-l10n-screens.spec.ts:127`, CI `first-run.spec.ts:76 renders passed (light)`); neither is a backend finding, rerun under the e2e lock to confirm.
Open at stand-down: #129 (owner), docs PRs #179/#180 (writer). Worktree: clean, detached at origin/main; src-tauri/target (8.5 GB, ignored) left in place.
