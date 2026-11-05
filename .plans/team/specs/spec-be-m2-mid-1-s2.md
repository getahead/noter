# be-mid-1 (Sonnet 5.5, engineer, core lane) — 2.16 Job scheduler, slice 2: capture triggers, power source, model download

Worktree `~/orca/workspaces/noter/be-mid-1` (start from fresh `origin/main`, which now has your #230). Read `spec-be-m2-common.md`, `PLAN-be-m2.md` (TL-22, TL-23), `docs/features/core/core-jobs-scheduler.md`, your own `noter-jobs` crate and `crates/noter-core/src/jobs.rs`, and the session manager `crates/noter-core/src/capture.rs` (M1: `capture_stop`, `capture_continue`, the `CaptureState` machine; PLAN-be-m1 TL-1..TL-5, D-29).

**Target:** `feat(core): capture triggers, power source and model download on the scheduler`, one PR on `lane/core/jobs-triggers`. Closes 2.16: the steps left `[ ]` in #230 (`inst-interrupt-continue`, `inst-admit-same-call`, battery), the DoDs `cpt-noter-dod-core-jobs-scheduler-scheduling` and `-batches`, the §6 ACs you can prove, `cpt-noter-featstatus-core-jobs-scheduler`; the feature box in DECOMPOSITION-core is the writer's docs PR after this merges.

**Change:**
1. Session manager feeds `Core::capture_guard()`: `live = true` from `capture_start` until the call is stopped/discarded; `resumed_call = Some(id)` on `capture_continue` (the resumed call's queued/running PostCall and ArchivePass generation is cancelled and late results rejected, AC 2); a later stop queues a fresh generation.
2. On `capture_stop` (status `processing`): `scheduler().trigger(Request::for_call(PostCall, AfterCall, &call_id))` then `ArchivePass`; PostCall stays runnable during the next live call, ArchivePass waits (D2, AC 1). The handlers stay no-op seams (2.17 fills them); the run rows and `jobs:progress` events are what the tests assert.
3. Battery: a `PowerSource` seam on `CoreDeps` (`with_power`, default AC) read from the existing `NativeServices` environment reading where the app already reports power; the harness answers scripted (`harness.set_power` control if the M1 harness controls pattern fits, else a `--power battery` flag; core lane either way). AC 3.
4. `models_download` (M0, `crates/noter-core/src/models.rs`) runs as the `ModelDownload` job on the scheduler: same command, same `setup:` events and E2E as today (the M0 conformance and first-run E2E must stay green unchanged), progress through the run row; a live call pauses it.
5. Startup reconcile of unfinished runs is exercised against a real `noter-db` file in a test (AC 5).
6. Document the three deviations from #230 in the FEATURE spec's M2 decisions block (one line each: `job_runs.subject`, lazy job definitions, UTC nightly window) so the writer and QA see them.

**Constraints:** core lane only. No session-machine behaviour change beyond the guard feed and the two triggers. No new IPC command.

**Acceptance:** every remaining 2.16 CDSL item, DoD and AC `[x]` with markers (say in the PR body which AC, if any, cannot be proven until 2.17's handlers exist); M0 model-download E2E unchanged and green; `just gate` green; PR published with the self-review; `worker_done` names the PR and anything left for the writer's tick PR.
