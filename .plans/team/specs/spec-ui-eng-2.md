# ui-eng-2 (Opus 5.5, senior UI engineer) — 2.11 live-transcript

Worktree `~/orca/workspaces/noter/ui-eng-2`; branch `lane/ui/live-transcript` from fresh `origin/main`. Read `spec-ui-common.md` first.

**Target:** FEATURE `cpt-noter-feature-ui-live-transcript` (`docs/features/ui/live-transcript.md`, DESIGN.md transcript view / segment row / speaker label / language tag / playback bar; prototype `10-a-components.js` transcript parts, `30-c-callpage.js` stored variant) at 100 % with markers; box 2.11 ticked.

**Change:** `cpt-noter-component-ui-transcript-view` (live, tail and stored variants), `transcript-segment-row`, `speaker-label` (display only), `language-tag`, `playback-bar` under `apps/desktop/src/features/transcript/` as reusable components: the transcript Channel (`transcript_subscribe`: snapshot then stream, confirmed rows never move, hypothesis row replaced, 100 ms flush, gap resubscription with `last_seq`), virtualised log that follows live speech without jumping, **Jump to Live**, gap and mark rows, waiting state with the **You**/**Others** meters (`levels_subscribe`), play control per output route (`audio_play`/`audio_stop`, `playback:state`, headphones rule), evidence highlight (`transcript_span`). Decisions: D-32 one live speaker label per side; blocks without a core-carried language render `lang="und"` (Teamlead, 21 Oct); D-13 motion. Consumers: ui-eng-1 (call window: live/tail) and ui-mid-2 (call page: stored) build on your branch, so push the component API within the first hours and keep it stable; tell both (via `send --type status`) when it is pushed. E2E: `m1-live-transcript-ui.spec.ts` (14) from `origin/lane/ui/e2e-m1`; its rows mount the component in the windows that exist on your branch (use `src/ui/testing.tsx` or a test-only route if no window shows a transcript yet), green on fake and stdio.

**Constraints:** UI lane; one PR `feat(ui): live and stored transcript` (≤ 2 open). The rename popover and term fixes are M2.

**Acceptance:** PR merged with QA PASS, designer OK, no blocking finding; spec boxes and DECOMPOSITION 2.11 ticked; `just gate` green. `worker_done` names the PR.
