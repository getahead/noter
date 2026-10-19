# be-pm — M1 readiness review

Read-only review at `origin/main` 95600c8, 2026-10-18. Targets: the 5 M1 FEATURE specs (core-engine-capture, core-capture-session, core-live-transcript, core-native-surfaces, core-library-calls), DECOMPOSITION-core §1–§3 (entries 2.8–2.12), `harness/milestones.toml [M1]`, the M1 entries of `harness/perf.toml`, and the M0 code built so far.

**Verdict: 6 BLOCKING, 14 NON-BLOCKING. No IPC contract change is needed. The contract lane has 3 recommended jobs to do first.**

## 0. M0 baseline that M1 builds on (at the time of review)

| Area | State | What M1 needs from it |
|---|---|---|
| `noter-db` (#21) | **merged** | the writer, `Store::write`/`write_batch`, `read_snapshot`, migrations per owner |
| Swift engine (#38, #46) | **merged** | the M0 command loop, self-test, file mode; protocol types are hand-written for the M0 subset |
| CoreApi dispatch (#20), root (#29), stream hub (#32), Tauri host (#35), settings (#40), hotkeys (#41), first-run (#43/#44), native (#42), supervisor (#37), harness (#26/#47) | **open or draft** | everything below. No M1 core work can merge before #20 → #29 → #32 land |

Seams M0 already defines, which M1 extends (D1: each feature adds the methods it needs):
- `CoreDeps { clock: Clock, events: EventEmitter }` (#29).
- `ShortcutRegistrar` (#41).
- `NativeServices`, `ModelSource`, `Updater` (#43).
- `EngineLauncher`/`EngineIo` with `EngineClient` and `ScriptedEngine` (#37).
- noter-db `Mutation`/`ChangeMeta` (#21).

## 1. BLOCKING

| # | Item | Spec line it breaks | Who fixes it |
|---|---|---|---|
| **B1** | **No golden set.** There is no `evals/` directory and no `evals/golden` audio on main. Without it the live-ASR DoD and acceptance criterion, and the perf entries `live-hypothesis-lag`, `live-confirmed-lag` and `call-memory-footprint`, cannot be built or measured. CI also needs the WhisperKit Turbo model on the Mac runner (a cached download). | core-engine-capture `cpt-noter-dod-core-engine-capture-asr` ("on the golden set replayed through file mode"), AC1; `cpt-noter-dod-core-engine-capture-replay` (footprint); HARNESS.md M1 row | Owner (`evals/golden` is protected; three-language call recordings) plus DevOps (model cache on the macos runner) |
| **B2** | **Capture writes vs the change log; noter-db has no bulk insert and no delete.** DESIGN-core (line 202) says "every write that a user, a job or a model makes is a change-log row". It does not say whether the engine's segments (about 10 a second), live speakers and gaps are change-logged, and the actor list `you`/`job:<id>`/`llm_run:<id>` has no engine actor. noter-db (#21) offers only change-row upserts by `id`. It has no batch insert without change rows and no delete, yet `capture_discard` and `calls_delete` must delete rows with a non-undoable change row. Two engineers (session and transcript) would each invent a path. | core-storage `cpt-noter-dod-core-storage-change-log` ("every mutation"); core-live-transcript `inst-commit-batch`; core-capture-session `inst-discard`; core-library-calls `inst-del-tx` | Teamlead decision. My recommendation: (a) segments, live speakers, gaps and marks written by capture are capture data, inserted through a noter-db `insert_batch` with no change row (only user edits are logged); (b) noter-db gains `delete(entity, ids, meta)`, which writes one non-undoable change row per call. Then the owner adjusts DESIGN-core line 202 and the storage DoD wording (contract lane edits DESIGN-core). |
| **B3** | **Where the window and surface state lives, and its seam.** native-surfaces puts panels, placement, the tray and notifications in `src-tauri` + `noter-native`. But 10 M1 commands (`window_*`, `app_set_hidden_for_presenting`, `open_external`) and the session's "show the record prompt" and "open the call window without focus" must also run in `noter-core-harness` on Linux, and in session unit tests. No spec names a core-side seam. If the state machine (`CallWindowState`, `PresentingState`) lives in src-tauri, those commands only count through XCUITest, and the session cannot be tested without AppKit. | core-native-surfaces `cpt-noter-flow-core-native-surfaces-call-window`, `-presenting`; AC "window-free parts through the harness"; core-capture-session `inst-show-prompt`, `inst-phase-recording` | Teamlead decision. My recommendation: the state machines live in `noter-core`; a `Surfaces` seam in `CoreDeps` (show prompt, show/hide/place/make key the call window, hide all for presenting, set tray, post notification, announce, open external) is implemented by src-tauri over `noter-native` and scripted in the harness. Put it into both specs before work starts. |
| **B4** | **The harness cannot drive M1 stories yet.** The M1 stories need the real core to receive engine facts: `call_detected`, `session_started`, segments, levels, `call_audio_released`, `system_audio_silent`, `device_changed`, a killed engine and a failed restart. `ScriptedEngine` (#37) answers only ready/ack/pong/self_test. The harness (#47) has M0 controls only. HARNESS.md lists "scripted engine script and golden-set replay" as M1 harness work, but no M1 FEATURE owns it. Without it, 11 of the 13 M1 stories (all but the menu-bar and native ones counted through XCUITest) cannot pass against the real core, and the story bar is 60%. | core-capture-session §6 (all ACs "with the scripted engine"); core-live-transcript AC1; core-library-calls AC1/AC2; HARNESS.md "What comes next" M1 | Teamlead: assign it. The engine lane extends `ScriptedEngine` with timed capture scripts and a kill switch. The core lane adds harness controls (TEST-PLAN › Scenario controls: inject an engine fact, kill the engine, set the output route, set free disk) and `--engine-script`. |
| **B5** | **No M1 perf scenarios.** `perf.toml` has 4 M1 registry entries (`live-hypothesis-lag`, `live-confirmed-lag`, `stream-hub-fanout`, `call-memory-footprint`) and none of the 3 `[scenarios.*]` they name (`engine_replay_lag`, `core_stream_fanout`, `engine_replay_footprint`). At M1, 7 entries are due and the gate needs at least 5 covered; at most 3 exist after M0 (protocol, `core_cold_start` #45, `core_app_snapshot`). | core-live-transcript `cpt-noter-dod-core-live-transcript-stream`, AC "including the stream-hub-fanout scenario"; core-engine-capture DoD asr/replay; harness.toml perf ≥60% | Owner adds the three `[scenarios.*]` entries once the lanes name their binaries: `core_stream_fanout` (core lane; Linux, ir, can come first), `engine_replay_lag` and `engine_replay_footprint` (engine lane; wall/rss on the Apple Silicon runner, needs B1) |
| **B6** | **Week-one decisions due at the start of M1.** Q7 (whether capture runs in its own minimal process) is decided by the engine-kill drill, but the drill is written as a DoD of engine-capture, at the end. If Q7 says "separate process", the engine-capture design (one process, ring, supervisor) changes after it is built. The Q4 result from the spike (#39, draft) decides the engine entitlements as well. | core-engine-capture `cpt-noter-dod-core-engine-capture-restart` ("the Q7 test"); DESIGN-core Q7, Q4; DECOMPOSITION §1 discrepancy 5 | Owner, through the Teamlead: run the Q7 drill in week one of M1 (it can reuse the spike CLI #39 with a ring file), record Q4 from #39, and decide both before engine-capture's capture pipeline PR |

## 2. Findings per spec

### 2.1 core-engine-capture (engine lane)
Delivers: no IPC command. It is the engine half of every capture command and of story `cpt-noter-seq-call-screen-recover-capture`, plus 3 perf entries.
Seams from M0: the `EngineClient` command and events API (#37), and the capture-first branch of the restart algo (#37 left `inst-if-capture` for M1). Also `ScriptedEngine` (extend it, B4) and the Swift `EngineLoop`/`FileMode` (#38/#46).
- **NB1:** two restart rules. Capture-first restart gives up after "three times within 30 s"; the idle restart (#37) gives up after three in a minute. State in the spec that they are separate rules, and in the supervisor which one applies when.
- **NB2:** no owner for the list of known meeting apps (`set_detection.known_bundle_ids`). No setting, contract constant or spec defines it. Recommendation: a constant list in noter-core (Teams, Zoom, Webex, Slack, FaceTime and the main browsers), with ignored apps subtracted.
- **NB3:** the Swift protocol types are still hand-written for M0. M1 adds about 20 events and commands (`start_session` alone has 11 fields). Generate them from `contracts/engine.schema.json` before M1 grows them; that closes the #38/#46 package-DoD note.
- **NB4:** adding WhisperKit/FluidAudio as SwiftPM dependencies has no supply-chain check like cargo-deny. Ask the owner whether pinning by revision is enough.
- Lane split: Swift `engine/` (taps, ring, AAC, VAD, ASR, detection, playback) and `noter-engine-client` (capture-first restart, the degraded-state translation algo). Both are in the engine lane.

### 2.2 core-capture-session (core lane)
Delivers: 16 capture commands; `capture:state`, `capture:detected`, the capture rows of `degraded:changed`, and the interrupted banner; stories `record-prompt-start-recording`, `record-prompt-record-after-missed-prompt`, `call-screen-recover-capture`, `call-screen-stop-at-call-end`, and the core half of `menu-bar-control-recording`.
Seams from M0:
- `EngineClient` (#37) to start, pause, resume, stop and exclude;
- `NativeServices` (#43), extended with **calendar events** for detection matching (D1: the feature adds the method);
- the new `Surfaces` seam (B3);
- `Clock` (#29), plus a timer source;
- noter-db writes (B2);
- banners and degraded set from #29;
- settings (`offer_to_record`, ignored apps, audio storage) from #40;
- the first-run detection rule and self-test state from #43.
- **NB5:** timers. The notice timers need wake-ups, not just `Clock::now()`, and #29 says "no tokio in the library" while #44 adds tokio `rt`. Decide on tokio time with paused-time tests (the simplest), and say so in the spec, so `cpt-noter-dod-core-capture-session-machine` ("table-driven tests on an injected clock") is built one way.
- **NB6:** the notification rule (`cpt-noter-algo-core-capture-session-notify`) depends on `window_report_view` and on presenting state, both owned by native-surfaces. Make sure both features agree that the rule lives in the session and native-surfaces only delivers.
- **NB7:** discrepancy #8 is fine as written: M1 sends only NT-3; the "Summary ready" notification is M2.

### 2.3 core-live-transcript (core lane)
Delivers: `transcript_subscribe`, `levels_subscribe`, `transcript_span`, `audio_play`, `audio_stop`; `playback:state`; story `cpt-noter-seq-call-screen-replay-line`; perf `stream-hub-fanout`.
Seams from M0: the stream hub (#32): subscribe, publish, coalesced levels, `read_snapshot`; noter-db (B2); `EngineClient` `play`/`stop_playback`; `EnvironmentState.output_route` from `NativeServices` (#43/#42; the route classifier exists in #42); `AudioOutputSettings.headphones_devices`.
- **NB8:** discrepancy #3 resolves in M1: `levels_subscribe`, `open_external` and `window_navigate` now count, so the `ahead()` wraps added for M0 (U1, #33) should go once they are answered.
- **NB9:** the "crash between commit and publish" AC needs a way to kill the core at that point (a test hook in noter-core). Name it in the spec, so it is not done with sleeps.

### 2.4 core-native-surfaces (core lane in src-tauri, engine lane in noter-native; UI lane writes XCUITest)
Delivers: 10 commands (`window_show_call`, `window_hide_call`, `window_call_state`, `window_set_call_layout`, `window_set_collapsed`, `app_set_hidden_for_presenting`, `window_navigate`, `window_announce`, `window_report_view`, `open_external`); `window:call`, `app:presenting`, `nav:request`; stories `call-screen-hide-for-presenting`, `floating-panel-display-unplugged`, `floating-panel-collapse-strip`, `floating-panel-hide-and-reopen`, `menu-bar-check-state`, `notifications-allow-notifications` (XCUITest), plus the native half of `menu-bar-control-recording`; and the app's E2E command log (`NOTER_E2E_LOG_DIR`).
Seams from M0: the Tauri host (#35, still declaring only `main`; the other 4 windows come here), `noter-native` (#42: displays, notifications, permissions), the hotkey registrar (#41: the press calls `Caller::Native { surface: hotkey }`), and `Surfaces` (B3).
- **NB10:** tauri-nspanel "pinned to a commit" is a git dependency. `deny.toml` has `unknown-git = "deny"`, and src-tauri is its own cargo workspace (#35), so cargo-deny may not cover it at all. The owner should either allow this git source explicitly or extend cargo-deny to src-tauri (supply-chain gap).
- **NB11:** the menu bar shows "the privacy mode" from `PrivacyStatus` and `privacy:changed`, but the privacy component and event are M2 (llm-gate). For M1, say it reads `Settings.privacy.mode` and updates on `settings:changed`.
- **NB12:** the stories counted only through XCUITest (5 of them) depend on the macOS job and the UI lane writing tests in `apps/desktop/tests/native`. Plan the UI-lane work in M1, or the M1 story bar (60% of 13, so 8) depends on 8 core stories through the harness (B4).

### 2.5 core-library-calls (core lane)
Delivers: `calls_list`, `call_get`, `call_update`, `call_types_list`, `calls_delete`; `entity:changed`; story `cpt-noter-seq-dialogs-delete-call`; fixture parity from M1.
Seams from M0: noter-db read pool and a delete (B2); `apply_world` of the harness (#47) must now seed calls, segments, speakers, marks and gaps (they become owned slices in M1).
- **NB13:** `call_types_list` reads "the built-in types from the app bundle's `skills/`". `skills/` is the skills lane's and may not exist in M1, and the harness has no app bundle. Define a built-in list in noter-core for M1, or have the skills lane deliver the folders first.
- **NB14:** fixture parity (`cpt-noter-dod-core-library-calls-parity`) says a difference "is fixed in the contract or the fixtures first (contract lane)". Schedule the contract-lane fixture work at the start of M1, so the core lane does not wait.

## 3. Contract changes M1 needs

**IPC contract: none found.** All 36 M1 commands and their events are in `contracts/ipc.manifest.json`. These types already hold every value the specs name:
- `GapReason`: paused, device_changed, system_audio_silent, engine_restart, stalled, interrupted, continued.
- `PlaybackStopReason`: ended, user, output_switched_to_speakers, capture_started.
- `CaptureNotice`: CallEnded with nullable `stops_at`, CallSeemsEnded, NewMeeting, NothingHeard, StoppedAutomatically.
- `DegradedState`: MicrophoneOff, SystemAudioSilent, TranscriptionStalled, DeviceChanged, SecondAudioSource, CaptureFailed, DiskLow, DiskFull, CalendarAccessDenied.
- `AudioOutputSettings.headphones_devices`.
- The engine `start_session` fields.

Recommended contract-lane work, **first in M1**:
1. Generate the Swift engine protocol types from `contracts/engine.schema.json`, with schema-derived example lines and a `--check` (NB3; closes the package-DoD note).
2. Fixture world and fixture-parity infrastructure for calls, segments, speakers, marks and gaps (NB14).
3. A DESIGN-core edit for B2 (change-log scope for capture data, actor, delete) once the Teamlead decides.

## 4. Owner decisions pending for M1

| Item | Recommendation |
|---|---|
| Discrepancy #6 (footprint in M1 via the harness scenario; in-app sampling in M5) | Accept. It needs the `engine_replay_footprint` scenario (B5) and the golden set (B1). |
| Discrepancy #8 (summary notifications are M2) | Accept. M1 delivers authorization and NT-3 only. The allow-notifications story's click test can use an NT-3 notification. |
| Q7 week-one drill | Run it in week one of M1, before the capture pipeline is built (B6). |
| Q4 (from the spike #39) | Record it before engine-capture changes entitlements (B6). |
| Golden set, Mac runner model cache | B1. |
| perf `[scenarios.*]` for M1 | B5. |
| tauri-nspanel git source and cargo-deny coverage of src-tauri | NB10. |
| Milestone advance | M1 work stacks on M0 drafts. Advance to M1 only after #20, #29, #32, #35, #40–#44 and #47 have merged and the M0 perf scenarios are on main. |

## 5. Lane split summary

| Feature | Lanes | PR streams |
|---|---|---|
| engine-capture | engine | Swift `engine/` (taps, ring, AAC, ASR, detection, playback); `noter-engine-client` (capture-first restart, degraded translation, an extended `ScriptedEngine` for B4) |
| capture-session | core | `noter-core` session service; harness controls (B4) |
| live-transcript | core | `noter-core` transcript service and stream wiring |
| native-surfaces | core + engine + ui | `src-tauri` (windows, panels, tray, Surfaces impl, E2E log); `noter-native` (AppKit placement, notifications, EventKit, announcements); UI lane XCUITests |
| library-calls | core | `noter-core` library read models; contract lane for fixture parity |
| (contract) | contract | Swift codegen, fixtures, DESIGN-core B2 edit |

Not checked: each DESIGN.md M1 story's steps against the specs (I used the story IDs and the specs' ACs), and `cfs validate` on the specs. All analysis is from documents and PR descriptions; I built and ran nothing.
