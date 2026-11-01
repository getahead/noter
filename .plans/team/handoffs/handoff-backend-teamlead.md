# Handoff — Backend Teamlead (M2, 31 Oct – 2 Nov 2026; dispatch ctx_6ccd52b3db96, terminal term_937aa07c-0697-4960-b4f6-deb75c2bb5a6, worktree be-lead)

The M1 handoff is kept as `handoff-backend-teamlead-m1.md`; its lessons still hold. Team Run `run_494a855b922d`. Plan `PLAN-be-m2.md` (TL-12..TL-27 and a dated Status log with every PR, entry point and deviation), rules `spec-be-m2-common.md`, one spec per dispatch `spec-be-m2-<name>[-slice].md`, roster `ROSTER.md` › "Backend team M2", status `BE-STATUS.md` (writer), QA reports `/tmp/be-qa-m2-r*/REPORT.md`.

## State at the time of writing
- Boxes ticked on main (9/9): 2.16 (#244), 2.15 (#248), 2.20 (#252), 2.19 (#260), 2.17 (#265 #269), 2.21 (#271), 2.18 (#272), 2.13 (#274), 2.14 (#283, after the owner's D-32 option 2: #279 clustering on pinned pyannote community-1 + WeSpeaker CoreML, VBx, constraints; #282 tests DoD marker); QA follow-ups (two state scope markers, the 2.13 ACs) in #276. be-qa's final recount on main: 41/41 commands, 10/10 stories against the real core, `just gate` exit 0. 2.14 clustering licences: every pinned file CC-BY-4.0, commercial use allowed, attribution required (`.plans/backend/m2-diarization-licences.md`); the golden-set DER threshold is the owner's (three options in #279's body) and the attribution text placement (About or NOTICE) is an owner/UI item.
- M2 E2E gate: all 41 commands and 10 stories have real-core tests on main (be-qa counted 25/41 and 3/10 before #264/#273; #264 added 12 commands + 5 stories, #273 added 5 + 2; be-qa r7 recounts on the final main). The gate itself counts M2 only after the owner sets `[milestone].current = "M2"`.
- Open PRs of ours: none. UI: #203 (not ours), #231 release (owner's).

## Owner items (batched to the coordinator during the run)
1. D-32 is answered (option 2, done). Left: the golden-set DER threshold for 2.14 (pick one of the three options in #279's body) and where the CC-BY-4.0 acknowledgement text goes (About or NOTICE).
2. The owner's Mac: network-monitor release test with real pinned CLIs (`.plans/backend/m2-network-monitor-runbook.md`), real TCC prompts, a real pre-filled unsent launch, the `claude://code/new` / `codex://new` cwd/q parameters, a save panel on a real window; skill evals and timing (2.17); ~5.4 GB optional model download (whisper-large-v3, pyannote-community-1 CoreML CC-BY-4.0, bge-m3 CoreML).
3. Harness: `scripts/harness/trace_gate.py` compares the PR head with the tip of main, not the merge-base: every PR branched before another lane's markers merge fails "trace coverage lost" and must be updated from main (#234 cost one update). Design deltas for DESIGN-core: `job_runs.subject` + `jobs.kind UNIQUE` (TL-24, in #242), the `repos` settings key (#260).
4. `[milestone].current = "M2"` when the owner is satisfied.
5. UI-lane E2E flakes (`m0-a11y-l10n-screens:244`, `m1-call-page-frame-ui:121`, `m0-first-run-ui:154`, `m1-live-transcript-ui:323`) failed main's own CI twice and cost ~15 PR re-runs; escalated for the UI Teamlead.

## Lessons (new this run)
- A PR that adds a crate or dependency must update `apps/desktop/src-tauri/Cargo.lock` (the host runs `cargo test --locked`); migrations are Rust lists per owner crate with explicit versions: renumber on rebase (three collisions this run).
- Every `CoreDeps`/`lib.rs`/`publish_reversed` change conflicts with every open core PR: land small, rebase often; the Teamlead can update a branch from main through GitHub when only the trace gate is red (`gh api -X PUT .../pulls/N/update-branch`), and a title with an upper-case subject start fails the Conventional Commits check (rename with `gh pr edit --title`, no new review needed).
- A stacked PR must be retargeted to main before anything merges into its base branch (#270 squash-merged into #263's branch and had to be re-landed as #273).
- Later-milestone p1 rows inside an M2 feature: option A (D-12, owner 28 Oct): move them to the delivering milestone's spec with a cross-reference (TL-27); DoDs need a `@cpt-dod` marker in code before a box can tick (#266 #268). QA checks steps, not parents, for split flows (TL-26).
- Disk: a full `just gate` writes 20-50 GB per worktree; the machine hit 1.1 GB free once. Delete `target/` of idle worktrees (`rm -rf <wt>/target`, rebuilds on demand); UI worktrees hold ~165 GB and are the UI lead's.
- Workers deliver well with one fresh `worker-start --spec` per slice and stop at publish; the Teamlead watches CI with a `check --wait` loop that acks heartbeat-only batches (`wait.py` in the scratchpad) and re-runs flaky jobs with `gh run rerun <id> --failed`.
