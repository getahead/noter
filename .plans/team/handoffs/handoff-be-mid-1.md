# Handoff: be-mid-1 (24 Oct, replaces the 22 Oct one)

M1 work of be-mid-1 is complete; nothing of mine is open.

## Merged, by feature
- Harness controls: #125 `set_output_route`/`set_free_disk`, #138 `--engine-script`, `harness.engine_fact`, `harness.engine_kill`.
- Replay and playback (2.10): #146 `audio_play`/`audio_stop`, route rule, `playback:state` (rebased by me after it conflicted).
- Live transcript (2.10): #164 `TranscriptService` (batching 250 ms, speakers, `transcript_subscribe`, `levels_subscribe`, `transcript_span`, `transcript.jsonl`, current-pass snapshot with chips, `named_by`, `sample`); #168 D-27 hook cfg-gated and D-22 zero change rows asserted.
- Harness seeding: #154 the five call tables from the fixture world (lifted from #148; seeding only).
- Contract-lane tests I added: #159 transcript parity narrowed to what M1 owns (each dropped field has its reason in the test), #162 pause story waits 20 ms (a zero-length pause leaves no gap), #166 `m1-stories-transcript` (replay-line + five transcript commands), #171 `m1-stories-surfaces` (hide-for-presenting, collapse-strip, hide-and-reopen, menu-bar-check-state, window commands).
- Core fix found by a story: #169 no record prompt while hidden for presenting.

## Left for others
- `sample` (speaker replay sample): the transcript snapshot serves the speaker's first line, live pass only, none for You. The library's `call_get` still drops `sample` in its parity comparison (`ownedDetail`); be-mid-2 can enable it with the same rule.
- Speaker chips and name `suggestion`: built from the stored name (shortcut, same as the library); the people feature (M2) replaces both; the parity test compares by person id until then.
- `harness.data_dir`: the shortcut #172 uses is not mine; check it against `Harness::start` options if it moves.
- D-27: `fail_after_commit`/`crashed` and `testing::capturing` exist only with feature `harness` (not in release builds). A release build still warns about unused `seed_capture`/`seed_presenting`; pre-existing.
- The harness ticker (`feed_engine` in `crates/noter-core-harness/src/boot.rs`) feeds levels every 100 ms and the fixture live call's hypotheses; no confirmed lines are invented. `levels_subscribe` and a live `transcript_subscribe` start the engine (`ensure_ready`).
- No perf work was done or left (owner order 24 Oct); the old `perf_stream_fanout` example is not in the tree.

## Gotchas
- Lane guard vs merge commits: `git merge origin/main` into a lane branch is refused by the pre-commit guard (it sees every file from main as staged). Use `git rebase origin/main` and resolve conflicts (allowed when GitHub reports one); then `git push --force-with-lease` and re-publish the review.
- Local gate needs `cargo build -p noter-core-harness` and `export NOTER_CORE_CMD="$PWD/target/debug/noter-core-harness --fixture world"`, else e2e coverage reads 0%. Rebuild after switching branches: the binary is the branch's core.
- Gate a branch only after rebasing on current `origin/main` (trace coverage compares with it).
- Tests skipped by `ahead()` until a command exists run the day it exists: expect contract-lane fixes (#159, #162) when a feature lands.
- PR titles: the subject must start lower case ("test(contract): the …", not "M1 …").
- `review-publish` refuses uncommitted changes, untracked files included: move them out first.
- The destructive-command hook asks for facts before `git checkout -- file`, `rm -rf`, `checkout -B`; use `git apply -R` or avoid them.
- First-run flake: `m0-first-run-ui.spec.ts` "Self-test hears only one stream" failed once on the real core in CI on #164 and passed on rerun (passed locally three times). Possibly timing with the harness meter feed; unconfirmed. Rerun the failed job once before digging.

## Local branches to delete (merged; this worktree's repo)
lane/core/harness-seed-calls, lane/core/live-transcript, lane/core/replay-playback, lane/core/transcript-hook-cfg, lane/core/no-prompt-while-hidden, lane/contract/transcript-parity, lane/contract/pause-gap-story, lane/contract/m1-stories-transcript, lane/contract/m1-stories-surfaces. The repo holds many other local branches that belong to other workers; not touched.
