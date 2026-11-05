# Roster — dispatch IDs (send with `orca orchestration send --to dispatch:<id> ...`)

| Role | Dispatch | Run | Notes |
|---|---|---|---|
| Coordinator (owner's agent) | (your preamble's coordinator) | run_ba2441689556 | owner-only actions only |
| Backend Teamlead (Fable 5.1, 23 Oct resume) | ctx_afec29c1727b (terminal term_13506b1e-aa71-4df5-a97c-4d727bf6fbfa) | run_ba2441689556; team Run run_090f17dfae16 | backend M1 |
| Head of Development (Fable) | ctx_b5762e5cba70 (23 Oct) | run_ba2441689556 | product/PRD/behaviour + cross-team decisions |
| UI Teamlead (Fable 5.1, 24 Oct UI M1) | ctx_651740189c13 (terminal term_b7ae1478-3a8d-4a6c-a619-24eb0e5c6024; was ctx_33d16924e3bf, ctx_6049ca66ecf8) | run_ba2441689556; team Run run_61c69336eeac | UI M1, UI review of wire-changing contract PRs |
| PR Babysitter (Haiku 5.5) | ctx_0f8f6195bcf8 (INACTIVE 24 Oct: dispatch failed; restart is the coordinator's) | run_ba2441689556 | open PRs, rebases, conflicts, PR-STATUS.md |
| DevOps (Codex) | ctx_29ce9e25cc13 (COMPLETED, inactive 24 Oct; was ctx_0f81e84c9b80) | run_ba2441689556 | CI health/speed, CI-METRICS.md |
| Full-stack Unblocker (Fable) | ctx_46786b35554f (23 Oct) | run_ba2441689556 | takes the blocker that blocks most teammates, fixes it end to end; UNBLOCKER.md |
| Delivery reviewer (Sonnet 5.5) | ctx_0423a6b5b2c3 (24 Oct) | run_ba2441689556 | Delivery dashboard artifact |

UI team members (added by the UI Teamlead):

## UI team (team Run `run_73fa9420226e`, coordinator = UI Teamlead `ctx_6049ca66ecf8`)

| Name | Dispatch | Agent | Worktree | Role |
|---|---|---|---|---|
| UI Teamlead | ctx_33d16924e3bf (20 Oct; was ctx_6049ca66ecf8) | claude | ~/orca/workspaces/noter/ui-lead | plan, assign, PR flow, DECOMPOSITION ticks |
| ui-eng-1 | ctx_321439cb624c | claude | ~/orca/workspaces/noter/ui-eng-1 | UI engineer (primitives first) |
| ui-eng-2 | ctx_064d2a206aeb | claude | ~/orca/workspaces/noter/ui-eng-2 | UI engineer (accessibility-l10n first) |
| designer | ctx_7f9f284d567c | codex | ~/orca/workspaces/noter/ui-review (shared, read-only) | design fit, motion, baseline approval |
| ui-qa | ctx_8c6943bba089 | claude (sonnet-5-5) | ~/orca/workspaces/noter/ui-qa | per-PR QA, bugs |
| ui-e2e | ctx_0ed67dcb6c47 | claude (sonnet-5-5) | ~/orca/workspaces/noter/ui-e2e | Playwright/XCUITest stories, E2E coverage |
| ui-perf | ctx_7498c4323678 | claude (sonnet-5-5) | ~/orca/workspaces/noter/ui-perf | UI perf scenarios |
| ui-reviewer | ctx_4034cb2c03ef | codex | ~/orca/workspaces/noter/ui-review (shared, read-only) | independent code review |
| ui-mid-1 | ctx_8104c6899f67 | claude (sonnet-5-5) | ~/orca/workspaces/noter/ui-mid-1 | Middle developer (MB-1, first-run logic) |
| ui-mid-2 | ctx_7a50a33ca892 | claude (sonnet-5-5) | ~/orca/workspaces/noter/ui-mid-2 | Middle developer (settings logic #73, shell logic) |

Dispatch IDs change when a teammate's terminal is reused for a new task; the Teamlead updates this table.

## UI team M1 (team Run `run_61c69336eeac` from 24 Oct 16:08 UTC; coordinator = UI Teamlead `ctx_3b56ec9ab260` from 25 Oct 11:3xZ (round 3, specs `spec-ui-*-r3.md`), terminal `term_3d0d9d1a-c426-4bef-9355-bceac3f7f06a`; was `ctx_2b305fe43d12` (r2), `ctx_651740189c13`)

Specs `spec-ui-common.md` + `spec-ui-<name>.md`, plan/status `ui/PLAN.md` › "UI M1", handoffs `handoff-ui-<name>.md`. Send to a teammate's *current* dispatch (it changes per task; the Teamlead updates this table). Old UI terminals (18–21 Oct) are dead; all workers started fresh.

| Name | Current dispatch | Task | Terminal | Agent | Worktree | Role |
|---|---|---|---|---|---|---|
| ui-eng-1 | ctx_fe552e444afc (r8 Opus: 2.14 remaining rows, task_55da4da525ab; r4 ctx_aa032de1c00f #183 merged; r3 ctx_eb6321c053e5 fix list done; r2 ctx_8b378f16fdcd #188 done; was ctx_b70a50617654) | task_5942fce002dc | term_0781323f-3303-45ef-86b8-a6d4e7221199 (r2; was term_640fc8dd) | claude claude-opus-5-5 | ~/orca/workspaces/noter/ui-eng-1 | senior: 2.10 call-window |
| ui-eng-2 | ctx_2605ded9f08d (r8 Opus: 2.8 remaining rows + WIP PR, task_0479d41cdb04; r6 ctx_25f9bfe8ce40 WIP cca4b4c; r5 ctx_bfefa80cb4ca #208 merged; r4 ctx_283d71b91595 done: #206 + #188; r3 ctx_b1b689ee9543 done: #186 + #205; r2 ctx_0dbfde77b372; was ctx_ba6dcda7eba8) | task_7c839296f7bd | term_3f7f9588-d3da-4682-b808-2a56ae7b79a0 (r2; was term_c07ec5d9) | claude claude-opus-5-5 | ~/orca/workspaces/noter/ui-eng-2 | senior: 2.11 live-transcript |
| ui-mid-1 | ctx_36c0738240c5 (r8: 2.13 live status + edit flow, task_ca1a0fc823a5; r4 ctx_33c5458c33dd #207 merged; r3 ctx_e2d4ddbd322a #197 merged; r2 ctx_3619f83c64ae; was ctx_c43103d59940) | task_853f5bfd57ba | term_dcffba13-8d8a-4af8-9c3d-afc8d83e7d89 (r2; was term_36ddba21) | claude claude-sonnet-5-5 | ~/orca/workspaces/noter/ui-mid-1 | middle: 2.8 dialogs-host → 2.13 library-calls → 2.12 menu-bar |
| ui-mid-2 | ctx_8aee713a3bc9 (r8: 2.9 remaining rows, task_bd78255b6882; r5–r7 #202 done (ctx_9a9a68c4cdea, ctx_719be49584d5, ctx_64587a7f7f07); r4 ctx_06e6a01306c6 #209 merged; r3 ctx_f4e5b78e0f34 #191 merged; r2 ctx_083559644126; was ctx_18d9de67239e) | task_1c5ea692f875 | term_d819b1c2-444f-4bc0-bf07-de87d94d859b (r2; was term_df20ffb4) | claude claude-sonnet-5-5 | ~/orca/workspaces/noter/ui-mid-2 | middle: 2.14 call-page-frame → 2.9 record-prompt → 2.15 notifications |
| ui-qa-2 | ctx_2c7d48f106ab (r3: QA #191 @a789bbb, task_f3d53c38ac11; Sonnet, worktree ui-qa-2) | task_f3d53c38ac11 | (see worker-list) | claude claude-sonnet-5-5 | ~/orca/workspaces/noter/ui-qa-2 | second QA queue (#191, #183) |
| ui-qa | ctx_3ba147273b31 (r3: QA #188 @db74e1b, task_270898958c52; was ctx_47c6c18f0a5d; was ctx_17fe2a19edba, settled, terminal not reusable) | task_6797821ad908 | (see worker-list) | claude claude-sonnet-5-5 | ~/orca/workspaces/noter/ui-qa | standing per-PR QA, read-only |
| ui-e2e | ctx_1f2582b8cfa3 (r8: #203 align with M1 specs, task_ecc0c3d47883; r2 ctx_c93b66c6a3c1; was ctx_ac94ef189050) | task_4fe6e40f0ff9 | term_7e71ba6b-a540-4fbd-8ad9-04b7fe986152 | claude claude-sonnet-5-5 | ~/orca/workspaces/noter/ui-e2e | e2e-m1 hand-over, XCUITest suite, M1 coverage |
| designer | ctx_5b8b3d948158 (r8: #202 @92a9afb, task_5e4f039c7428; earlier r3–r5 on #191/#188/#183/#209/#202; was ctx_667e39dce555, claude sonnet; two codex starts ctx_929038ac23c1/ctx_6979e23aa23d failed at agent_readiness: codex sits at an update prompt, released) | task_a1e1a1b93909 | term_0da1e2dd-e787-4415-b70e-49ddc9fbda80 | claude claude-sonnet-5-5 | ~/orca/workspaces/noter/ui-review | design fit, baseline approval (delegated) |
| ui-reviewer | (not started; codex, only when needed) | | | codex | ~/orca/workspaces/noter/ui-review | independent review |
No ui-perf (owner: NO PERFORMANCE TESTS, 24 Oct).

### UI team r11 (28 Oct 21:3xZ; Teamlead dispatch ctx_3ae80e6ed5df, task task_13666c61e47c, terminal term_71c0966b-d064-47b4-9465-74b743e352df; worker Run `run_51bece0b09a8`; specs spec-ui-r11-*.md)

| Name | Dispatch | Task | Agent | Worktree | Task |
|---|---|---|---|---|---|
| ui-eng-2 | ctx_a2c534716ffc | task_9af16bd60b75 | claude-opus-5-5 | ui-eng-2 | 2.12 menu-bar host per D-39 (2 core-lane PRs) + quit alert (2.8 quit flow) |
| ui-e2e | ctx_86f8d8533b3c | task_42c38b82b5ac | claude-opus-5-5 | ui-e2e | built-app test hooks (core lane), then #203 XCUITest green + proof ticks |
| ui-mid-2 | ctx_e52d16737dbd | task_6d354c205427 | claude-sonnet-5-5 | ui-mid-2 | core-side markers 2.9/2.15/2.14 → 2.13 ACs + tick (2.8 sheet rows move to M2 by docs PR, owner A) |
| designer | ctx_5b3a4964372c | task_84549452cf40 | claude-sonnet-5-5 | ui-review | baseline review of #223 (15 library-calls screenshots), label visual-change-approved (delegated) — CHANGES 9/15 |
| ui-mid-2 r12 | ctx_7470010a33fa | task_1fce6237bab0 | claude-sonnet-5-5 | ui-mid-2 | #223 designer fixes only (FINISH-ONLY, 29 Oct) |

Note (29 Oct): worker_done/ask messages from r11 workers did not reach the lead's inbox (only heartbeats did); read handoff-ui-*-r11.md and the worker terminals instead.

## Backend team M2 (team Run `run_494a855b922d` from 31 Oct 22:49Z; coordinator = Backend Teamlead `ctx_6ccd52b3db96`, terminal `term_937aa07c-0697-4960-b4f6-deb75c2bb5a6`, worktree be-lead)

Plan `PLAN-be-m2.md` (TL-12..TL-23), rules `spec-be-m2-common.md`, one task per dispatch with `spec-be-m2-<name>.md`, handoffs `handoff-be-<name>.md`, status `BE-STATUS.md` (writer). Workers started fresh with `worker-start --agent claude --model <id> --worktree path:` (no reusable terminal handles; read them with `worker-read`). Send to a teammate's *current* dispatch; it changes with each task.

| Name | Current dispatch | Task | Agent | Worktree | Task in hand |
|---|---|---|---|---|---|
| be-eng-1 | (idle; r7 ctx_7fb500c161bf no PR needed; r6 ctx_0029596441b6 #259 #267; r5 ctx_c3ecffc79330 #251 #255; r4 ctx_c1783856e21d #241 #246 + #234 fixes; r3 ctx_972292c81878 #234; r2 ctx_2dc4b14aeb02; r1 ctx_021b5a8b7790 #229) | task_070df08cc1c9 | claude claude-opus-5-5 | ~/orca/workspaces/noter/be-eng-1 | senior, core: 2.15 llm-gate slice 1 (runtime, gate, audit); then slices 2-3, then 2.17 postcall |
| be-eng-2 | (idle; r11 ctx_65f22f8cd02c #282; r9/r10 #279 (2.14 clustering); r8 ctx_de90539112c6 #266; r7 ctx_cdaf45c17485 #262; r6 ctx_2f2e917cca40 #254 #257; r5 ctx_3789fa94adf8 rebased #247; r4 ctx_234df1ad2aa6 #247 (2.17 s1); r3 ctx_9696502a4473 #243 (2.21 part A); r2 ctx_d5e2f7a14b2e #236; r1 ctx_ac36159e3fb5 #228 merged) | task_3b50a725d56e | claude claude-opus-5-5 | ~/orca/workspaces/noter/be-eng-2 | senior, engine: 2.14 engine-offline slice 1 (protocol, supervisor); then Swift decode; then 2.21 native-services |
| be-mid-1 | (idle; r8 ctx_e9988513b7c9 #268 DoD markers; r7 ctx_bbf67d614cf9 #258 #264; r6 ctx_b0f11b28f587 #250; r5 ctx_0a87ef64b433 #245; r4 ctx_e8fe16333dea #240; r3 ctx_e4374b608aab; r2 ctx_f209743e4767; r1 ctx_7efbabb722b4 #230) | task_14e457eec8c4 | claude claude-sonnet-5-5 | ~/orca/workspaces/noter/be-mid-1 | engineer, core: 2.16 jobs-scheduler slice 1; then capture triggers; then 2.18 items-today |
| be-mid-2 | (idle; r6 ctx_439f04651830 #276; r5 ctx_70390e4bcaeb #263 #273; r4 ctx_74f3cdf1ab0b #270 (into #263's branch); r3 ctx_c4536bd47fe5 #256 #261 #263; r2 ctx_54d48de92194 #238 #249 #253 (2.20 done); r1 ctx_ff8da664255b #232 merged) | task_dfe15a8b02b3 | claude claude-sonnet-5-5 | ~/orca/workspaces/noter/be-mid-2 | engineer, core: 2.20 history-undo slice 1; then export + NativeOps seam; then 2.13 speakers-audio, 2.19 handoff |
| be-writer | (idle; r6 ctx_16c6067d4ad8 #283 tick 2.14; r5 ctx_6d7dc1d748e7 #271 #272 #274; r4 ctx_91ab72cbd1d6 #265 #269; r3 ctx_2bdbcc2e4b2e #260; r2 ctx_85fdde27ad34 #248 #252; r1 ctx_52208568d57d #242 #244) | task_2f53e2dc9ca6 | claude claude-sonnet-5-5 | ~/orca/workspaces/noter/be-mid-3 | technical writer: TL notes, D-36/D-40 lines, ticks, BE-STATUS.md |
| be-qa | (done; r8 ctx_c7ce2af4f82c #279 #283 PASS; r7 ctx_b6a070c4214d coverage 41/41 10/10; r6 ctx_84c29536abf9 done: PASS, coverage 25/41 3/10 pre-#264; r5 ctx_a639bd2fd814 done: all PASS; r4 ctx_a51d4d6dd8e8 done: all PASS; r3 ctx_6b35fa1293e2 done: 6 PASS, #250 minor; r2 ctx_763bbcdc1add done: #234 #243 #246 PASS, #238 #240 follow-ups; r1 ctx_36b2500f70c3 done: #228 #230 #232 #234 all FAIL on marker/schema/Debug items, reports /tmp/be-qa-m2-r*) | task_6e9f06d5954d | claude claude-sonnet-5-5 | ~/orca/workspaces/noter/be-qa | standing per-PR QA, read-only |

## Backend team M1 (team Run `run_090f17dfae16` from 23 Oct 20:22 UTC; coordinator = Backend Teamlead `ctx_afec29c1727b`, terminal `term_13506b1e-aa71-4df5-a97c-4d727bf6fbfa`; previous M1 Run `run_4292dc3c030a`, 21-22 Oct)

Plan `PLAN-be-m1.md`, specs `spec-be-common.md` + `spec-be-<name>.md`, handoffs `handoff-be-<name>.md`, status `BE-STATUS.md` (writer). Send to a teammate's *current* dispatch; it changes with each new task. Terminals are new (23 Oct); the 21 Oct terminals are dead.

| Name | Current dispatch | Task | Terminal | Agent | Worktree | Role |
|---|---|---|---|---|---|---|
| be-eng-1 | ctx_d50e9ab903b0 (2.11 gaps: inst-frame, native command log; earlier ctx_c2def7e08450, ctx_45e3d3aa7bf0, ctx_a3d58d41e56f (#175)) | task_c36f9ee18b0a | term_687a4990-8056-4e85-b5c6-069afd072ccd | claude claude-opus-5-5 | ~/orca/workspaces/noter/be-eng-1 | senior, core lane: capture session manager (2.9), recovery, story tests |
| be-eng-2 | ctx_4f82e054e866 (engine-capture last steps, QA fixes, noter-native half; was ctx_19cfad0cef5d) | task_a83f005f56c8 | term_a0d7cf87-5172-40c4-b28b-0ace0ae42a33 | claude claude-opus-5-5 | ~/orca/workspaces/noter/be-eng-2 | senior, engine lane: capture pipeline, live ASR (2.8), runbooks |
| be-mid-1 | ctx_ed4ccc026e2f (handoff done, idle; M1 work done; earlier ctx_74136eaaf788, earlier ctx_198a1093c8f0 (2.10 delivered), earlier ctx_b51ee540a26f; ctx_b1d8b3663bf7 and ctx_d6290593a7f4 failed at readiness on the old terminal) | task_d57a612ba926 | term_bf287e1b-eec3-49f6-958f-5ce0f9b5d39e (fresh 24 Oct 11:0xZ; old term_dceb7f48 closed) | claude claude-sonnet-5-5 | ~/orca/workspaces/noter/be-mid-1 | engineer, core lane: harness engine controls, live transcript (2.10) |
| be-mid-2 | ctx_d60937a87d6e (2.12 status-state + parity markers; earlier ctx_195a3c4c2526, ctx_295aed219cff, ctx_10d8fd329652 (#174 #172), earlier ctx_098f379c9f1a, ctx_14cafb377157 (went idle); ctx_553e481473b1 and ctx_baaec8032229 failed at readiness on the old terminal) | task_5dd6317c8433 | term_bacc125d-9925-479d-a7b1-5eddef2b30db (fresh 24 Oct 12:5xZ; old term_980ba9a1 closed) | claude claude-sonnet-5-5 | ~/orca/workspaces/noter/be-mid-2 | engineer, core+contract: library calls (2.12), native surfaces core side (2.11) |
| be-writer | ctx_ea336745a66e (D-34 docs PR for 2.11, 2.12 tick after #176; earlier ctx_67573358b211, earlier ctx_9f91950cbf64 (2.9 tick #173), earlier ctx_611c8cdb0d93 (2.10 tick #167), earlier ctx_c62b97cd4bba, earlier ctx_487ff5cda2ab, earlier ctx_03751f47079a, earlier ctx_f56b55c02a21, ctx_a467fa198861, ctx_c77439bd6497) | task_f18be9df6c8f | term_5f7880f1-c35f-44bb-8619-9ab4d9db411d | claude claude-sonnet-5-5 | ~/orca/workspaces/noter/be-mid-3 | technical writer: spec notes, ticks, BE-STATUS.md |
| be-qa | ctx_ad5e4e499d38 (standby QA: #162 PASS, next transcript/#155/noter-native/TauriSurfaces; earlier ctx_dd51dce6e199, earlier ctx_36eddc0bee0d, earlier ctx_ebd0b965c949, earlier ctx_e169decb41cf, ctx_7668136d612d, ctx_48d151af4784, ctx_4bdb6d171d22, ctx_0d78ddb02438) | task_0769492c981f | term_69a877b3-7f10-406c-8ab6-8dfb595d5561 | claude claude-sonnet-5-5 | ~/orca/workspaces/noter/be-qa | standing per-PR QA, read-only |

## Backend team M1, 21-22 Oct (history; team Run `run_4292dc3c030a` from 21 Oct; coordinator = Backend Teamlead `ctx_004f7725dc9e`, terminal `term_41b00f3e-f2de-47dc-9f54-c2f4a046fbe2`)

Plan `PLAN-be-m1.md`, specs `spec-be-common.md` + `spec-be-<name>.md`, status `BE-STATUS.md` (writer). Send to a teammate's *current* dispatch; it changes with each new task.

| Name | Current dispatch | Terminal | Agent | Worktree | Role |
|---|---|---|---|---|---|
| be-eng-1 | ctx_649f7b830dad | term_e6a46196-e03e-4dbf-885c-0f0f38e0e839 | claude opus-5-5 | ~/orca/workspaces/noter/be-eng-1 | senior, core lane: storage M1, capture session manager |
| be-eng-2 | (stopped 22 Oct 00:45 by the Teamlead: opened PRs against FINISH-ONLY; was ctx_b7800f1c18fa) | term_cff17359-8a6e-4afd-8522-dd6ede3f9810 | claude opus-5-5 | ~/orca/workspaces/noter/be-eng-2 | senior, engine lane: engine capture, scripted engine, restart |
| be-mid-1 | ctx_3419966edad7 | term_009b0c51-6e85-4335-ae63-48f776fb7d2c | claude sonnet-5-5 | ~/orca/workspaces/noter/be-mid-1 | engineer, core lane: harness M1 controls, live transcript |
| be-mid-2 | ctx_aa501a6e876f | term_b8a1e7e1-e2c4-42ce-b6f5-9faf086775b6 | claude sonnet-5-5 | ~/orca/workspaces/noter/be-mid-2 | engineer, core+contract: fixture parity, library calls, native surfaces (core side) |
| be-writer | ctx_49f2e212b5a2 | term_92a6e21f-fadc-43cf-948b-e63a7e11ac81 | claude sonnet-5-5 | ~/orca/workspaces/noter/be-mid-3 | technical writer: spec notes, ticks, BE-STATUS.md (replaces be-pm) |
| be-qa | ctx_a15084e582ab (standing QA; was ctx_113c0f1a5cc6) | term_bb3abd1f-eeb8-49df-a13e-0c15cc5d93f5 | claude sonnet-5-5 | ~/orca/workspaces/noter/be-qa | per-PR QA, read-only |

be-e2e, be-perf, be-reviewer, be-pm, be-mid-3 from the M0 run are not restarted (their rows below are history).

## Backend team (team Run `run_17245d08c391` from 19 Oct; old `run_22488ede95a2`; coordinator = Backend Teamlead `ctx_bf19bb734a82`)

19 Oct: every old dispatch exited; rows not yet restarted are asleep (old handles dead). Send to a teammate's *current* dispatch; it changes with each new task (the Teamlead updates this table). Terminal handles are stable.

| Name | Current dispatch | Terminal | Agent | Worktree | Role |
|---|---|---|---|---|---|
| be-eng-1 | (released 19 Oct; was ctx_4decdcfee356) | term_785cb65a-3be8-4611-8cce-d5c592280b91 | claude | ~/orca/workspaces/noter/be-eng-1 | core lane: storage, IPC host, settings |
| be-eng-2 | (released 19 Oct; was ctx_7eecf6cdb0b8) | term_b81cc989-a1bc-46b7-9d7a-b09ae5403339 | claude | ~/orca/workspaces/noter/be-eng-2 | contract lane first, engine, first-run |
| be-e2e | ctx_14048add69ec | term_5fda3341-60d7-47ab-900a-888b2a534d58 | claude-sonnet-5-5 | ~/orca/workspaces/noter/be-e2e | noter-core-harness, conformance vs real core |
| be-perf | ctx_8b2cd015d18d | term_0989820c-a6a3-4be7-b155-9485220af265 | claude | ~/orca/workspaces/noter/be-perf | perf scenarios |
| be-qa | (released 20 Oct; was ctx_59c0ef85eac1) | term_f48e0fb6-6199-45f3-812a-852302d5c2ba | codex | ~/orca/workspaces/noter/be-qa | per-PR QA, read-only |
| be-pm | ctx_1ca857b9bf3d | term_60a075fd-3cf0-4ed7-ab47-0d6826adbc9d | claude | ~/orca/workspaces/noter/be-ro (shared) | PRD/spec fit, read-only |
| be-reviewer | (released 20 Oct; was ctx_f16c10ff8d6f) | term_e8975197-47bd-426a-81eb-50ca802e9a0c | codex | ~/orca/workspaces/noter/be-ro (shared) | /cf-sdlc-pr-review + review-publish |
| be-mid-1 | ctx_35722184bd20 | term_b76b39af-8b73-448e-a956-8878edc8c48a | claude-sonnet-5-5 | ~/orca/workspaces/noter/be-mid-1 | middle developer |
| be-mid-2 | ctx_91af12b5fc53 | term_e1f7f1a0-d004-4c50-996b-e932c6f12fae | claude-sonnet-5-5 | ~/orca/workspaces/noter/be-mid-2 | middle developer |
| be-mid-3 | ctx_9b0d99e48fe0 | term_d0319112-06a8-4aa8-8cdd-80a6994af4ac | claude-sonnet-5-5 | ~/orca/workspaces/noter/be-mid-3 | middle developer |

UI team 20 Oct (Run run_eab700ab5c38, Teamlead ctx_33d16924e3bf): ui-mid-1 ctx_eff1b92ffcd6 (ticks docs PR), ui-eng-1 ctx_3277d0f628e0 (shell), ui-eng-2 ctx_b2e41752cd69 (first-run), ui-mid-2 ctx_30198f2ac5a1 (settings); all claude sonnet-5-5.
designer ctx_b3d28c7c1583 (codex), ui-reviewer ctx_642115577455 (codex), both in ui-review worktree, Run run_eab700ab5c38 (20 Oct). ui-qa: wake when first PR opens.
ui-qa ctx_3d9bbcd7fd64 (claude sonnet). #113 open (ui-mid-1). Tick plan: all 7 boxes + DESIGN defs in ONE final docs PR (def-done-ref-not-done).
ticks-final: ui-mid-1 ctx_8069b41b1e0e. #113 #114 #115 #117 merged 20-21 Oct.

Codex (24 Oct): Backend M1 Delivery Enforcer ctx_3a5f57c6a4e0 (spec-be-enforcer-codex.md); Backend M1 Reviewer ctx_d7208d892e27 (spec-be-reviewer-codex.md, be-ro worktree).
- Reporter refresh (24 Oct, one pass, succeeded): ctx_defbfcfbd2d8
- UI Teamlead M1 (Fable 5.1, 24 Oct): ctx_651740189c13, spec-ui-lead-m1.md, worktree ui-lead
- 24 Oct 17:0xZ: Reporter refresh ctx_7a8117ea9751; NSPanel engineer (Opus, be-eng-1 worktree) ctx_1a6e890e44e4 replaces the completed Backend Teamlead for 2.11; Unblocker told to ping stuck agents
- 24 Oct 17:2xZ backend workers restarted (no lead): be-mid-1 ctx_51eea249c90b (2.9 sensitive-notify, 2.12 parity), be-eng-2 ctx_78349ba04b74 (2.8 to ticked), NSPanel ctx_1a6e890e44e4 (2.11)
- 24 Oct: ui-qa-2 (Sonnet 5.5) ctx_ef688bc7560e takes QA queue back (#183 #191 #197); build caches cleaned in be-e2e be-ro be-qa be-mid-1 be-mid-2 (disk 98% -> 85%)
- 24 Oct: closed 30 stale terminals of completed dispatches (kept 13 live workers + enforcer)
- 24 Oct: Fable 5.1 engineer ctx_7d1bf1af3f3c (worktree be-q4-fable) owns 2.8 Q4 latency; Opus ctx_1f46284110e8 told to hand off and stop
- 24 Oct 21:5xZ: UI Teamlead resumed ctx_2b305fe43d12 (Fable); UI PRs had stalled after low-cost stop + #198 conflicts
- 24 Oct 22:0xZ: Unblocker restarted (Fable) ctx_6ada68ae2b16: get open UI PRs merged
- 25 Oct 11:3xZ: Q4 PR worker (Sonnet) ctx_8b2eae04dbdc lands lane/engine/q4-latency; UI Teamlead resumed ctx_3b56ec9ab260 (stays until UI PRs merge, waits with gh pr checks --watch). Finding: nothing merged 14 h after leads ended turns under low-cost mode
- 25 Oct 15:2xZ owner: stopped agents not on open PRs: be-enforcer ctx_3a5f57c6a4e0, ui-review ctx_667e39dce555, ui-eng-2 ctx_0dbfde77b372, ui-e2e ctx_ac94ef189050. Kept: UI Teamlead ctx_3b56ec9ab260 (waits on CI), ui-mid-2 ctx_64587a7f7f07 (#202). #186 #188 #183 #191 #197 merged
- 25 Oct 17:3xZ owner: stopped all agents; closed idle terminals; final Reporter pass running
- 28 Oct 21:2xZ: UI Teamlead restarted ctx_3ae80e6ed5df (complete UI M1; max 3 workers at once)
- 29 Oct: Codex ctx_cc20a9b4b564 (#216), ctx_84617098be55 (#203), ctx_66cf2f1f9cdf (pixel flake); Reporter ctx_36e95073fbc1
- 29 Oct: Codex workers ctx_cc20a9b4b564 ctx_84617098be55 ctx_66cf2f1f9cdf had failed at startup (Codex update prompt); skipped it with Esc and sent the tasks directly to terminals (#216 term_ab3e62f5, #203 term_449781ad, pixel-flake term_5dd90378)
- 29 Oct 09:2xZ owner: stopped all agents (UI lead, Reporter, 3 Codex) and closed their terminals. Open PRs unfinished: #224 #223 #216 #203; #221 release is the owner's
- 31 Oct: resumed. UI Teamlead ctx_65e598b0e117 (Fable); Codex #216 ctx_dbaac925987b, #203 ctx_b364871f7dfd, pixel flake ctx_cd42572e945e. #221/#223/#224 merged
- 31 Oct 1x:xxZ UI team r12 (UI Teamlead ctx_65e598b0e117, term_04c669c7): ui-mid-2 Sonnet term_f76b0e34 (spec-ui-r12-reduce-motion.md: 2.9 Reduce-motion AC test). Lead: #225 docs tick 2.13 + artifacts.toml Native UI tests entry.
- 31 Oct 22:2xZ UI team r12 done: ui-mid-2 worker_done (#226 merged); lead #225 merged.
- 31 Oct 22:3xZ: lead ended its turn with work left, Codex #203/Reporter failed: restarted UI Teamlead ctx_494f4b18951e (do not end turn until done) and Reporter ctx_493273c06c77; last published report v79 was 25 Oct
- 31 Oct: Backend Teamlead M2 (Fable 5.1, fresh) ctx_6ccd52b3db96, spec-be-lead-m2.md, worktree be-lead
- 31 Oct 23:0xZ: #203 macOS XCUITest: 1 failing test (dialogs delete return-pressed-by-habit); Opus fixer started (ui-e2e worktree)
- 1 Nov 00:3xZ: speed-up: Opus native-fix A ctx_ff861f11c100, B ctx_352c91ee85bd, C ctx_59981fb14f7c (parallel groups of the 11 native failures; native runs serialized via .native.lock)
- UI E2E master (Fable) ctx_482b53a24cde, task_4c6244e451e9, worktree ui-e2e-master: owns #203 (1 Nov 10:10 UTC)
- Core click-focus agent (Opus) ctx_62c4cfca4050, worktree core-click-focus: 2.9/2.10 click-focus rows (1 Nov 14:2x UTC)
- CI native-flake agent (Opus) ci-native-flake: #281 failure cause + version-bump skip rule (1 Nov 15:4x UTC)
- Core handoff-cwd agent (Opus) core-handoff-cwd: claude://code/new cwd fix (1 Nov 16:xx UTC)
- Designer ui-review-287 (Sonnet): record-prompt baselines of #287 (1 Nov)
- owner-bugs-settings-perm (Opus): Settings window size + Screen Recording prompt (1 Nov evening)
