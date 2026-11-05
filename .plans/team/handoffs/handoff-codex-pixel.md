# Visual screenshot flake — ci/visual-flake

Task: task_d30858f2801c, dispatch ctx_cd42572e945e.

Durable evidence: `~/projects/noter-wt/_team/visual-flake-evidence/` preserves the original failed logs, comparison run logs, expected/actual/diff PNGs, red/green tests, repeated state checks, and passing local gate.

## Root cause and evidence

The Calls loading screenshot accepted `aria-busy` immediately after navigation. The feature explicitly delays skeleton rows by 300 ms (`docs/features/ui/library-calls.md:87`, `calls-page.tsx` SLOW_MS/useEffect). Before that delay there is an intentionally blank, busy content area. Playwright can capture two identical blank frames and return a stable screenshot before the skeleton appears. This is a test readiness race; the application behavior matches the FEATURE.

- Original failing job: https://github.com/getahead/noter/actions/runs/40794776261/job/123336799263 (cached original logs in `/tmp/noter-visual-flake/failing.log`; GitHub now serves the successful rerun). Narrow/loading differed by 33,885 pixels, 7%.
- Same release head dfddb2f15a2ae7b93e4a729644f6bfc98d973409 later passed 159/159 on rerun. Main run 40794739308 and feature run 40792807810 also passed 159/159. Every compared log uses Playwright v1.63.0-noble digest eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27 and two workers.
- New main run https://github.com/getahead/noter/actions/runs/41129038702 fails narrow/loading with the exact same 33,885-pixel difference. Full failed log is `/tmp/noter-visual-main-failed.log`; artifacts are `/tmp/noter-visual-main-artifacts`. Expected, actual and diff PNG SHA-256 hashes exactly match the original release failure.
- Downloaded visual-diffs from run 40794776261 to `/tmp/noter-visual-40794776261`; opened expected/actual. Expected contains six skeleton rows; actual is the otherwise identical blank page. This rules out a global font/layout change.
- The retained trace starts screenshot comparison at 62317.502 ms; it takes screenshots at 62320.080 and 62509.090 ms and accepts a stable image at 62654.499 ms. Screenshot stability is not proof the loading delay has elapsed. Animation disabling cannot advance this JavaScript timeout.

## Fix

Only `apps/desktop/tests/visual/library-calls.spec.ts`: install the page clock before navigation, finish shell startup and pause time before selecting Calls, assert zero skeleton rows while busy, advance 300 ms, assert six skeleton rows, then compare the unchanged baseline. The 8-second fake read remains pending while capturing. Apply at all three widths. No retries, thresholds, container, worker count, baselines, generated files or application behavior changed.

## Validation complete

- `just setup`: passed; Docker daemon absent, so the local visual recipe transparently defers pixel comparisons to CI.
- Tests first: recovered `/tmp/noter-visual-flake/red.log` fails with zero skeleton rows when the clock is paused without advancing; recovered green log passes 9/9 after the advance. Both existed alongside the recovered uncommitted patch at dispatch start and are now preserved in the durable evidence folder.
- Fresh macOS WebKit state checks: all three loading widths repeated five times, 15/15 passed (`--ignore-snapshots`; state/timing only, not Linux pixels). Durable log: `visual-flake-evidence/state-repeat-15.log`.
- `just gate-fast`: PASSED (exit 0), log `/tmp/noter-visual-gate-fast.log`.
- The first full gate failed because this shell lacked NOTER_CORE_CMD and therefore counted zero real-core E2E coverage; all 245 fake-core UI flows had passed. Rebuilt the core harness and reran `NOTER_CORE_CMD="$PWD/target/debug/noter-core-harness --fixture world" just gate`: PASSED (exit 0). Rust unit coverage 96.24%, UI 91.61%; real-core M0 command and story coverage 100%. Durable log: `visual-flake-evidence/gate.log`.

## Delivered PR and repeated CI

PR: https://github.com/getahead/noter/pull/227

- Branch: `ci/visual-flake`; commit `dc53b9d4b835d2efa91bcd559b60d827c8cc2787`.
- Fresh `/cf-sdlc-pr-review 227` plus `/ponytail-review`: APPROVE; report `.prs/227/review.md`. Published with `just review-publish 227`, which enabled auto-merge. No manual merge or review status edits.
- Full required PR CI PASSED. PR automatically MERGED at 2026-10-31T22:10:20Z as `e9bad138d1f9e659e94f121cbc77c593ad881bcf`.
- Config guard and owner approvals passed without labels: no harness configuration file changed. Coordinator notified through run_ba2441689556 after gate and self-review passed.
- Watched CI with `gh pr checks 227 --watch --interval 30`; repeated only the visual job twice on the same head. The first check watch immediately following a rerun briefly saw old checks, so each active repeat was confirmed and watched again until completion.

| Attempt | Visual job | Result |
| --- | --- | --- |
| 1 | https://github.com/getahead/noter/actions/runs/41245920434/job/124669266994 | 159/159 passed, 2.8m |
| 2 | https://github.com/getahead/noter/actions/runs/41245920434/job/124672316598 | 159/159 passed, 2.2m |
| 3 | https://github.com/getahead/noter/actions/runs/41245920434/job/124673119295 | 159/159 passed, 2.6m |

Every attempt used digest `eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27` and two workers; every loading width passed each time. Durable logs: `visual-flake-evidence/ci-attempt1.log`, `ci-attempt2.log`, `ci-attempt3.log`; final run metadata (`attempt: 3`, `status: completed`, `conclusion: success`) and PR checks are in `ci-final.json` and `pr-final-checks.txt`. The PR body records all three runs.

Final working tree is clean. No baselines, thresholds, retries, workers, generated files or application behavior changed. No remaining task work or owner-only action; worker stops after reporting completion.
