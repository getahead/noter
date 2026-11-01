# Handoff — be-eng-1 (core lane: storage M1, capture session manager, native-surfaces host), 24 Oct 2026 (late)

## State

| Item | PR | State |
|---|---|---|
| PR 1 noter-db M1 tables, insert_batch, delete | #131 | merged |
| Conformance fixes (O1 stops instead of discard; resume test waits for transcript_subscribe) | #136 (contract) | merged |
| Slices 2+3: capture machine, detection (D-24 two lists), notices, timers, `Surfaces` seam, timer race fix, Start as New Call title | #141 | merged |
| UI test seed: system_audio_silent confidence 0.9 (unblocked #141) | #143 (ui) | merged |
| Scenario seam for story tests: engineFact, engineKill, surfaces, setOutputRoute, setFreeDisk | #147 (ui) | merged |
| Slice 4: recovery, Try Again via supervisor, engine gaps + degraded rows, notification rule, `report_view` seam, detection at launch fix, paused Try Again fix | #151 | merged |
| Slice 5: story tests `m1-stories-capture.test.ts` (5 stories, 11 tests) | #152 (contract) | merged |
| Machine DoD table tests + `inst-return-sensitive` (entity:changed) | #158 | merged |
| Session ↔ transcript wiring | — | done by be-mid-1's #164 through `on_capture_event` (stories 18/18 green) |
| Native-surfaces Tauri host: `TauriSurfaces` (windows, placement, presenting, tray as Caller::Native, open_external) | #170 | merged |
| Host over noter-native (#165): display_frame placement, notifications post + click → nav:request, announce, calendar_event_near; D-33 asserted | #175 | merged |
| 2.11 audit: saved call-window frames (inst-frame) + native E2E command log (e2e-log algo); DoDs menu-bar, presenting, navigation | #177 | merged |
| 2.11 NSPanel conversion (tauri-nspanel pinned rev ef6e309, macos-private-api): inst-convert, inst-return-panels, DoD -panels | #189 | merged |
| 2.11 tick (DECOMPOSITION-core IMPLEMENTED, featstatus) | #195 | auto-merge |

## Seams others build on

- `noter_core::Surfaces` (on `CoreDeps::with_surfaces`): `show_record_prompt`, `close_record_prompt`, `open_call_window_inactive`, `call_surface_visible() -> bool`, `post_notification(&Notification)`. be-mid-2 adds the native-surfaces methods to the same trait; `NoSurfaces` and the harness's `ScriptedSurfaces` implement it.
- `noter_core::Notification { call_id, kind: NotificationKind::{CaptureProblem(DegradedState), SummaryReady} }`; `Core::notify(n)` (M2 post-call), `Core::report_view(Option<CallId>)` (wire `window_report_view` to it). Presenting un-hide must call `release_held()` (native-surfaces).
- `Core::on_capture_event` (`CaptureEvent::{Mark, Gap, Stopped}`) for the live transcript (be-mid-1).

## Left / follow-ups

- Host noter-native wiring: done in #175 (display identity, notifications + clicks, announce, calendar).
- 2.11 ticked (#189 + #195). Open: §6 ACs (XCUITest, UI lane, `just native`); tray glyph images from design. Nice-to-have from #189 review: `remove_webview_panel` on Destroyed; `FullScreenAuxiliary` over full-screen call apps (check on the Mac).
- Local gate: NOTER_CORE_CMD must carry `--fixture world` (as CI), else real-core conformance fails 36 tests.
- Flaky UI-lane E2E `m0-first-run-ui.spec.ts` (:134, :154) races the scripted self-test on the real core (3 hits); routed to the Teamlead.

- 2.9 is ticked (#173). Still open there: p2 DoD `sensitive-notify`. D-33 decided: the saved call after a split stays closed (asserted in #175).
- Shortcuts in code: harness `answer_session` answers start/stop until engine scripts template `call_id`; `SetDetection` carries one bundle-id list (split when the Swift detection slice lands, D-24).
