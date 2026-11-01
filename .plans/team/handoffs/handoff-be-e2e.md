# Handoff: be-e2e (Opus 5.5 → Sonnet 5.5), 2026-10-18

## Role

be-e2e on the Noter backend team, a supervised worker of the **Backend Teamlead** (Orca coordinator `term_d6d70238-b908-4e31-8459-f73a779fe935`). I own:

- **E2E against the real core:** `crates/noter-core-harness`, which runs `noter_core::Core` without Tauri over the JSON Lines wire of `docs/HARNESS.md` (core lane).
- **The conformance suite:** `apps/desktop/tests/conformance` (contract lane).

The goal is ≥ 60 % of the delivered frozen commands and stories per milestone, counted only from real-core runs (`NOTER_CORE=stdio`). The plan is `.plans/core-harness.md` (merged as #19).

**Worktree:** `/Users/mpetrov/orca/workspaces/noter/be-e2e`.

**Rules that bite:**
- **PATH:** start every shell command with `export PATH=/opt/homebrew/bin:/usr/bin:$PATH`. Orca's PATH puts the old CommandLineTools `ld` first, and Rust links fail against the Xcode 27 SDK. The Stop hook runs `just gate-fast` with the bad PATH and reports that link error; the owner's #24 fixes it.
- **Review is delegated to be-reviewer.** Never run `/cf-sdlc-pr-review` or `just review-publish`. When the Stop hook asks, decline. It blocks at most 5 rounds (`MAX_REVIEW_ROUNDS` in `scripts/harness/stop_gate.py`).
- **Owner directive (in force):** finish existing PRs, no new PRs or feature branches. Merge order: contract #20 #23 #25 #27 → ipc-host #29 → settings #40 → first-run #43 → **harness #26** → docs.
- **Lane guard heuristics:** a shell command that both names a guarded path (`contracts/**`, `bindings.ts`, `harness/`, `scripts/harness/`, `.github/`) and has a write hint (`>`, `cp`, `mv`, `rm`, `git checkout|restore`, …) is blocked even when it only reads. Split such commands. The pre-commit check reads `harness/harness.toml` from the branch itself, so rebase onto main to pick up lane changes such as #59.
- **The GateGuard hook** asks for "facts" before the first write of each file. State them, then retry the same call.
- Never use bare `git stash`; use WIP commits.

## PRs

| PR | Branch | Head | State | Notes |
| --- | --- | --- | --- | --- |
| **#26** `feat(core): noter-core-harness on the real core` | `lane/core/harness-wire` | `7f1c299` | **OPEN, DRAFT** | Base `lane/core/first-run` (#43). #47 (boot) folded in with every commit. Stays draft until #20/#23/#25 and the core stack are on main, and the Teamlead says go. Someone else pushed two sync commits (`5b2c997`, `7f1c299`: sync with the folded first-run base and main); my local is fast-forwarded to them. No CI runs (stacked base). |
| #23 conformance tolerant via `ahead()` + `m0-core.test.ts` | `lane/contract/conformance-ahead` | (merged) | MERGED | |
| #25 not-implemented probe with `example-args.ts` | `lane/contract/conformance-milestones` | (merged) | MERGED | |
| #31 DESIGN-core storage decisions + fake D2 rev clause | `lane/contract/design-core-storage` | (merged) | MERGED | |
| #48 DESIGN-core M1 decisions | `lane/contract/design-core-m1` | (merged) | MERGED | |
| #28 accounts_get/api_key_set to M2 (docs) | `docs/core-m2-credentials-commands` | (merged) | MERGED | |
| #47 harness boot | `lane/core/harness-boot` `ceefc02` | — | CLOSED, "folded into #26" | Branch kept. |
| #56 M1 harness controls | `lane/core/harness-m1-controls` `72c723b` | — | CLOSED, "parked until M0 merges" | Branch kept (see Parked). |

## Parked work (pushed, no PR, owner directive)

- **`lane/contract/fixture-parity`** at `34e1865` (`c226a94` WIP plus `34e1865` regenerated `world.json`), rebased on main, pushed today. It implements M1 fixture parity (NB14, `cpt-noter-dod-core-library-calls-parity`):
  - the past call `call_backend` gets an archive-pass transcript (3 speakers, 4 segments, a mark, a device-changed gap);
  - each call gets one `call_details` entry repeating its row and its transcript's speakers, marks and gaps;
  - `crates/noter-protocol/tests/fixture_library.rs` checks that consistency;
  - `apps/desktop/tests/conformance/library-parity.test.ts` compares `calls_list`, `call_get` and the transcript snapshot with the fixture, through `ahead()`, with the parity algorithm's run/compare/return markers ticked in `docs/features/core/core-library-calls.md`.

  On the fake: fixture test 4/4, conformance 583/583. #59 now lets the contract lane commit regenerated files, so this is ready for a PR when the Teamlead allows new PRs again. Squash the WIP commit message then.
- **`lane/core/harness-m1-controls`** (#56 closed): `harness.set_output_route { route, output_device }` and `harness.set_free_disk { mb }` with tests, plus `.plans/engine-script-format.md`. Rebase it onto #26 after M0 merges.
- **Local scratch branches** (never pushed; safe to delete): `fold-26`, `p4-rebase`, `scratch/p4-tally2`, `scratch/tally3`. The `scratch/*` ones merge #23/#25 into the harness to run the real-core tally.

## Real-core tally (local, on #26's base before the two sync commits)

How to run it: `cargo build -p noter-core-harness`, then:
```
NOTER_CORE=stdio NOTER_CORE_CMD="$PWD/target/debug/noter-core-harness --fixture world" pnpm --dir apps/desktop test:conformance
```
For the stories, the same variables with `pnpm --dir apps/desktop exec playwright test --project=e2e tests/e2e/m0-*.spec.ts`. Count from `coverage/e2e/commands-*-stdio*.json`; delete old ones first.

- **Conformance:** 568 passed, 5 failed, 2 skipped. 20 of 172 commands answer.
- **M0 commands that succeed: 16 of 22.** Missing: `self_test_run` (and with it `stream_ack`/`stream_unsubscribe`), `models_download`, `permission_request`, `setup_set_audio_storage`.
- **M0 Playwright:** 6 of 16 tests pass. Stories `first-run-complete-setup` and `settings-set-hotkeys` count; `first-run-download-models` waits for a models reload in `noter-core`.
- **Remaining failure causes:**
  - `self_test_run` was not in the core on that base. The self-test branch has it, and the sync commits may bring it; re-tally.
  - `harness.world_set` of `app.setup.models`: the core read `models/` only at open. be-eng-2 added `refresh_models` on the self-test branch; call it from `world_set` when it is in #26's base.
  - The R25 version mismatch between `app_snapshot.setup` and `setup:changed`, which I reported, looks fixed by `e0165fe` in #43. Re-tally.
  - `permission_request(system_audio)`: the real core answers `not_asked` where the fake errors. Reported; F1 on the self-test branch changes it.

## Pending notes

- **Drain or drop the events emitted during `--fixture` seeding.** Seeding goes through the core's commands, so `settings:changed`, `setup:changed`, `banners:changed` and others go to stdout before the first request. They are valid protocol lines, and `tests/process.rs` counts only reply lines because of them. A cleaner start would mute the event emitter while seeding, then unmute (a flag in `EventLines`). Do it in #26 if a reviewer asks, or as a polish fix.
- **Engine script format:** `.plans/engine-script-format.md` (on the #56 branch) proposes the JSON Lines script (`on` = `EngineCommand` tag, `after_ms`, `event` | `kill`) and the `ScriptedEngine` API the harness will call (`Script::parse`, `with_script`, `inject`, the existing `kill_current`). be-eng-2 owns that half in `noter-engine-client` (engine lane; the core lane cannot edit it). The harness side (`--engine-script`, `harness.engine_fact`, `harness.engine_kill`) needs that API and `CoreDeps::with_engine` in #26's base.
- **Markers in `docs/features/core/core-harness.md`:**
  - Ticked: `dod-core-harness-wire`, `state-core-harness-process` and its four transitions, and six of the seven boot steps.
  - Open: the boot algorithm (`inst-inject` needs the scripted engine and runtime) and `dod-core-harness-fixture`. They carry block markers only on ticked steps, and `cfs validate` errors on a scope marker whose ID is unticked.
- **Conformance on the real core** needs #23's `ahead()` tolerance and #25's probe (both merged now) plus the harness binary.

- **`just gate-fast` fails on #26's branch today (trace ratchet), and a core-lane agent cannot fix it.** `trace_gate --base origin/main` reports `cpt-noter-algo-core-contract-version-rule`, `cpt-noter-flow-core-contract-conformance`, `cpt-noter-component-core-privacy` and `cpt-noter-state-core-contract-stability` as lost. The cause is that main is 9 commits ahead of `lane/core/harness-wire` (#25, #27, #28, #31, #37, #49, #60, #61), not removed markers. Merging `origin/main` into the branch conflicts only in `Cargo.toml` members (union), `Cargo.lock` (take ours, then `cargo metadata`) and `docs/features/core/core-first-run.md` (keep the ticks, take main's D11 wording). But the core-lane pre-commit guard refuses the merge commit, because it carries `noter-protocol/**`, `DESIGN-core.md` and `DECOMPOSITION-core.md`. Whoever made the earlier "sync harness with main" commits (`5b2c997`, `7f1c299`) has to sync again, or #43 has to move forward to main first. Tell the Teamlead; do not work around the guard.

## What's next

1. Wait for the Teamlead's go on #26. When the base moves: `git fetch origin`, rebase or merge onto the new `lane/core/first-run` or main (force-with-lease only on `lane/core/harness-wire`), `cargo test -p noter-core-harness`, `just gate-fast`, push.
2. Re-run the real-core tally on #26's current head and put the numbers in the #26 body. Wire `refresh_models` into `world_set` and inject the scripted engine (`CoreDeps::with_engine` + `noter_engine_client::scripted::ScriptedEngine`) once they are in the base; then the boot algorithm and the fixture DoD can be ticked.
3. Fix loop: fix whatever be-reviewer, be-qa or be-pm report on #26 (and on the merged PRs' follow-ups) as new tasks on this terminal.
4. After M0 merges, and if the directive allows: open the fixture-parity PR, and rebase and reopen the M1 controls work.
