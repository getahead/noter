# CI time: where the minutes go, and what to cut next

Measured 1 Nov 2026 from `gh api …/actions/runs/<id>/jobs` (first to last step of each job, skipped jobs left out).
The sample is the last 9 completed `ci.yml` pushes to `main` (10 asked for; the newest was still running) and the last 28 completed pull-request runs.
Volume from 25 Oct to 1 Nov: 117 PR runs, 52 pushes to main and 31 dispatches.
The repository is **public**, so standard hosted runners cost no money. What we pay is wall time and the concurrency limits: 20 jobs at once, and only **5 macOS jobs at once**.

## Per job (minutes)

| Job | main: avg per run | PR: ran / 28 | PR: avg | PR: total | share of PR minutes |
| --- | ---: | ---: | ---: | ---: | ---: |
| End-to-end tests | 11.2 | 16 | 11.4 | 182.9 | 48% |
| macOS (engine, Tauri host, native) | 6.9 | 13 | 7.3 | 94.8 | 25% |
| Unit tests and coverage | 2.7 | 16 | 2.5 | 39.8 | 10% |
| Screenshots | 2.7 | 10 | 3.0 | 30.3 | 8% |
| Rust format and lints | 0.8 | 11 | 0.8 | 8.9 | 2% |
| Contract | 1.1 | 9 | 1.0 | 8.7 | 2% |
| arch, docs, lint-ui, changes, gate, e2e-coverage | ≤ 0.3 each | | | 14.9 | 4% |

A main run costs about 26 job-minutes. Its critical path is the E2E job, about 11–12 minutes.

**What the E2E job spends** (main run 41298309066):

| Part | Minutes |
| --- | ---: |
| Conformance, fake core | 0.2 |
| Conformance, real core | 2.4 (serial: `fileParallelism` is off for stdio) |
| Playwright, fake world | 3.9 (246 tests) |
| Playwright, real core | 4.5 (the same 246 tests) |
| Setup, harness build (cache hit) and `playwright install` | about 1.5 |

**What the macOS job spends:** `cargo test` for `apps/desktop/src-tauri` takes 3.8 minutes. 3.5 of them compile 94 crates from scratch on every run. The engine tests take 1.3 minutes and the signature check 1.0.

## Options, ranked by saving per effort

1. **Split E2E, unit and screenshots by side** (PR `ci/split-backend-frontend`).
   - A UI-only PR runs only the fake-world half, about 5 minutes with no Rust toolchain, instead of 11.4.
   - A Rust-only PR runs only the real-core half, about 8 minutes, and skips the screenshots.
   - A PR that touches both sides runs the halves in parallel, so the wall time drops from 11.4 to about 8 minutes.
2. **Cache the Tauri host build.** `Swatinem/rust-cache` caches only `./target`, but `src-tauri` is its own cargo package with its own `target/`.
   - Fix: add `workspaces: ". -> target\napps/desktop/src-tauri -> target"` to `.github/actions/setup`.
   - Saving: about 3.5 macOS minutes on every macOS run (half of that job), which also eases the 5-job macOS limit. One line; do this next.
3. **More Playwright workers.** No `workers` is set, so CI uses half the CPUs: 2 workers on the 4-vCPU `ubuntu-24.04`.
   - Fix: try `workers: 4` (or `--workers=100%`) in the CI jobs.
   - Saving: likely 30–40% of the 3.9 + 4.5 minutes at no cost. Measure that it is not flaky first.
4. **Parallel real-core conformance.** It runs serially (2.4 minutes) because `fileParallelism` is off for stdio. Each file already starts its own harness process (`scenario.ts`).
   - Fix: allow per-file parallelism with one process per worker.
   - Saving: about 1.5 minutes. Needs a check for state shared between files.
5. **`playwright --shard`** for `e2e-core` and `e2e-ui` (2 shards each). Wall time drops about 2 minutes per half, but each shard pays about 1.5 minutes of setup. Do this after 3 and only if wall time still matters.
6. **Cache Playwright browsers.** Cache `~/.cache/ms-playwright`, keyed by the `@playwright/test` version, and keep `install-deps webkit`. Saves about 20–30 seconds per E2E job. Small.
7. **nextest** (`cargo llvm-cov nextest`) for `unit-rust` and `contract`. Most of their 1–2 minutes is compilation, so the expected gain is small (10–20 seconds). Low priority.
8. **sccache.** It helps only when rust-cache misses (new job ids, `Cargo.lock` bumps). The split jobs start cold on PRs until their first run on main saves a cache. Not worth it while rust-cache hits.
9. **Split and cache the macOS job once XCUITest lands.**
   - `just native` will add a `tauri build --debug` and an `xcodebuild` on every UI PR (the apply_repo rule ties `macos` to every E2E run).
   - Cache `apps/desktop/src-tauri/target` and DerivedData (`-derivedDataPath` keyed by the Xcode project and `Cargo.lock`).
   - Build the app once and upload it as an artifact. Then the XCUITest job and a later WebdriverIO job can run without rebuilding.
10. **Concurrency.** Already done for PRs (`cancel-in-progress` on `pull_request`). Runs on main queue on purpose, so that every merge is checked in full and caches are saved. Keep that.
11. **Skip draft PRs.**
    - Fix: add `ready_for_review` to the `pull_request` types and `if: !github.event.pull_request.draft` on `changes`. `gate` must then treat a draft as pending, not green.
    - Worth it only if agents push often to drafts; count draft runs first. Also, `review.yml` and the Stop hook expect CI on every push.
