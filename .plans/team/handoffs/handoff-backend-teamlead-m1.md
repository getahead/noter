# Handoff — Backend Teamlead (24 Oct 2026, M1 resume; dispatch ctx_afec29c1727b, terminal term_13506b1e-aa71-4df5-a97c-4d727bf6fbfa)

Team Run `run_090f17dfae16` (23 Oct 20:22Z; previous M1 Run `run_4292dc3c030a`). Plan `PLAN-be-m1.md` (TL-1..TL-11; 24 Oct perf order at the end), decisions D-22..D-35 in `DECISIONS.md`, roster `ROSTER.md` › "Backend team M1", status `BE-STATUS.md` (writer), worker handoffs `handoff-be-{eng-1,eng-2,mid-1,mid-2,qa}.md`. The previous handoff (21–22 Oct) is superseded; its lessons still hold.

## State at 15:4xZ, 24 Oct
- **Merged this run (23–24 Oct):** #135 #136 #137(Unblocker) #138 #139 #140 #141 #143 #144 #145 #146 #147 #148 #149 #150 #151 #152 #153 #154 #155 #156 #157 #158 #159 #160 #161 #162 #163→#165 #164 #166 #167 #168 #169 #170 #171 #172 #173 #174 #175 #176 #177 #178. Every PR had a QA report (be-qa r18–r55) except #140 #150 #153 (QA'd post-merge, follow-ups landed in #157).
- **Boxes in `docs/DECOMPOSITION-core.md`:** 2.9 capture-session (#173) and 2.10 live-transcript (#167) ticked; 2.12 library-calls (#180) ticked; 2.11 entry set IN_PROGRESS blocked on NB10 (#179, D-34). Boxes 3/5 on main at 15:26Z.
- **M1 E2E gate (D-30: boxes + E2E, no perf):** 36/36 M1 commands and 11/13 stories on the real core (enforcer-verified from CI artifacts, run 40103084038); the 2 missing stories (display-unplugged, allow-notifications) need native/XCUITest proof (UI lane).
- **2.8 engine-capture:** every code step [x] with markers (#139 #145 #150 #153 #157 #160); box waits on owner-only DoDs: Q7 kill drill (runbook `.plans/backend/m1-week-one-runbook.md` part A), Q4 EN/RU/DE latency (part C), golden set `evals/golden` (DoD -asr); DoD -replay is a perf scenario (out per D-30).
- **2.11 native-surfaces:** code complete (#155 #165 #170 #171 #175 #177) except the NSPanel conversion (inst-convert, inst-return-panels, -panels DoD): blocked on **NB10** (tauri-nspanel git source vs `deny.toml unknown-git = "deny"`). D-34: no tick until the owner allows the source or defers the conversion past M1. Concrete proposal sent to the HoD and the enforcer: repo `https://github.com/ahkohd/tauri-nspanel`, tag v2.1.1 = rev `ef6e3090a6083c653955ca0b6e7f6c6ae1453d40`, MIT OR Apache-2.0, `[sources] allow-git` line in deny.toml (owner file) + pinned `git`/`rev` dependency in `apps/desktop/src-tauri/Cargo.toml` (be-eng-1 does the swap). XCUITest-only ACs are the UI lane's (`just native`).
- **2.12:** inst-st-failed moved to `core-post-call.md` as `inst-st-call-failed` (D-35, #180); p2 DoD -parity unmarked, featstatus stays [ ] (be-mid-2 may add the marker later).

## Owner items (batched; sent to the coordinator 12:1xZ and 15:2xZ)
1. MacBook: runbook A (Q7 kill drill) and C (Q4 latency, EN/RU/DE) → results tick 2.8's DoDs -restart and -latency.
2. Golden set `evals/golden` (+ WhisperKit model cache on the Mac runner) → DoD -asr.
3. NB10 (above) → 2.11.
4. Later: `[milestone].current = "M1"`.
5. Minor: local `just arch` scans gitignored `engine/.build/checkouts` after `swift test` (harness/justfile); the perf.toml follow-ups from D-28 are moot after #142 (perf out of gate/CI).

## Team (all idle at the end; dispatch IDs in ROSTER.md)
be-eng-1 (Opus, core: 2.9, Tauri host half), be-eng-2 (Opus, engine: 2.8, noter-native half), be-mid-1 (Sonnet, core: 2.10, seeding, surfaces stories), be-mid-2 (Sonnet, core+contract: 2.12, native surfaces core side), be-writer (Sonnet, docs: D-31..D-35 notes, ticks, BE-STATUS), be-qa (Sonnet, standing QA). Babysitter and DevOps dispatches were inactive all day (ROSTER marks them); the Enforcer (term_42f6dac5…) audits merges and evidence; HoD ctx_b5762e5cba70; Unblocker term_e4b551fe… (#137, first-run flake fix).

## Lessons (new this run)
- Re-dispatching a worker on a terminal right after its task settles often fails at `agent_readiness`; a terminal whose agent sits at an idle prompt sometimes never accepts input again: close it (`orca terminal close --terminal`) and `worker-start` with `--agent claude --model …` on the same `--worktree path:` (be-mid-1, be-mid-2 today). Messages to a settled dispatch fail with `dispatch_inactive`; queue work in the next `worker-start --spec` instead.
- `check --wait --types …` returns at once with an empty delivery; `loop2.sh` (scratchpad) waits without a type filter, acks heartbeat-only batches and heartbeats the coordinator every 5 min.
- A worker's `worker_done` may arrive before it reads your last message: repeat open items in its next dispatch spec.
- Cross-lane-by-construction changes (a crate dep that needs the src-tauri lock; a core behaviour the fake and the stories must mirror) go on a non-lane branch (#165, #178), QA-first, FYI to the coordinator; the lane guard binds lane branches only.
- QA is one serial worker: give it the whole queue in each `worker-start --spec`, ask for one status line per PR, and prioritise QA-first PRs (authors that hold `review-publish` until PASS) over auto-merge ones.
- Tests-first history waivers were granted for #148 (library.rs), #155 (rebuilt history), #170 (host) after QA verified red-before-green at behaviour level; recorded in the PR bodies.
- Known UI-lane flakes against the real core: `m0-first-run-ui.spec.ts:134/:154` (races the scripted self-test), `m0-a11y-l10n-screens.spec.ts:127/:244`; a re-run passes; root cause handed to the Unblocker.
