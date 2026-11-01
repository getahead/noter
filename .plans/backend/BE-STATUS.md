# Backend M2 status (be-writer) — updated 2 Nov 2026 (writer r6: 2.14 tick #283 published, auto-merge on)

M2 gate: the nine boxes in `docs/DECOMPOSITION-core.md` ticked + E2E ≥ 60 % of the 41 M2 commands (≥ 25) and ≥ 6 of the 10 stories against the real core. Boxes on main: 8/9 (2.13 #274, 2.15 #248, 2.16 #244, 2.17 #269, 2.18 #272, 2.19 #260, 2.20 #252, 2.21 #271); 2.14 box in #283 (auto-merge) makes 9/9. Real-core coverage (be-qa r7): 41/41 commands, 10/10 stories.

| Feature | PRs merged | Open / in flight | State | Next |
|---|---|---|---|---|
| spec decisions | #242 | | merged | |
| 2.13 speakers-audio | #256 #261 #263 #273 #274 | | ticked | |
| 2.14 engine-offline | #228 #236 #279 #282 | #283 (featstatus + box) | code-complete under D-32 option 2 (pinned pyannote community-1 + WeSpeaker CoreML, VBx, constraints; CC-BY-4.0) | owner: golden-set ACs (EN/RU/DE calls, archive quality on the Mac runner; DER bar = one of 3 options in #279), attribution placement |
| 2.15 llm-gate | #229 #234 #241 #246 #248 | | ticked; owner-gated: network-monitor release test (runbook `.plans/backend/m2-network-monitor-runbook.md`), "output and handoff E2E" AC (2.17/2.19 now landing) | |
| 2.16 jobs-scheduler | #230 #240 #244 | | ticked; AC 6 (post-call story E2E) waits on 2.17 | |
| 2.17 postcall | #247 #254 #257 #262 #265 #266 #269 | | ticked; open: XCUITest (UI M2), owner evals + Mac timing | |
| 2.18 items-today | #245 #250 #258 #264 #268 #272 | | ticked; six steps moved to core-people / core-evidence-proposals; §6 ACs left as written | |
| 2.19 handoff | #251 #255 #260 | | ticked | open parts: AC 6 launch evidence, golden-set rubric evals, URL-parameter check (owner) |
| 2.20 history-undo | #232 #238 #249 #252 | | ticked | |
| 2.21 native-services | #243 #259 #267 | #271 (featstatus + box) | ticked (#271); owner-Mac: claude://codex:// parameters, real Screen Recording/Automation prompt, unsent launch | |

Other open PRs: #231 (release 0.14.0, owner's), #203 (UI xcuitest suite).

Owner-gated (unchanged): 2.14 clustering (D-32), golden set `evals/golden` (also the 2.19 handoff rubric evals), network-monitor release test with real pinned CLIs and a runbook, `[milestone].current = "M2"` once the nine boxes and E2E numbers hold. Added: the `claude://code/new` / `codex://new` cwd and q URL-parameter check on the owner's Mac (2.19; AC 6 launch evidence with 2.21 part B).


Owner-gated (writer r4 additions): 2.17 skill evals on the golden set and Mac timing; native XCUITest `cpt-noter-seq-notifications-open-outputs` waits on UI M2; M4-gated steps `inst-write-reviews`, `inst-notify-switch`, `inst-notify-return` now live in `core-agents.md`.


Owner-gated list (2 Nov, writer r6): golden set `evals/golden` (2.14 ACs, 2.17/2.19 evals) and the DER bar for diarization (3 options in #279); attribution placement for the CC-BY-4.0 models (About/Licences or repo NOTICE, text ready in `.plans/backend/m2-diarization-licences.md`); Mac items: network-monitor release test, `claude://`/`codex://` URL parameters, Screen Recording/Automation prompts, XCUITest notification story (UI M2); `[milestone].current = "M2"` once 283 merges. Core follow-ups from #279: span must-links for shared names; refresh an installed wespeaker bundle when the manifest grows.
