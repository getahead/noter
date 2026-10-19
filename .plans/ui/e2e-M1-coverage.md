# M1 E2E coverage plan (ui-e2e, 18 Oct 2026)

Branch `lane/ui/e2e-m1` (pushed, no PR), stacked on `lane/ui/e2e-m0` because `openWindow`/`steer` in `tests/e2e/support/app.ts` are not on main yet (PR #66 open). After the first M0 feature PR merges, rebase; the M1 specs then need nothing else.

## Where M1 stands
- Gate bar: E2E >= 60% of M1 commands (35) and stories (13) against the real core. Today `current` is pre-M0 so M1 counts nothing yet; it counts from the M1 gate.
- The 13 M1 stories already have **command-level** specs on main (`m1-*.spec.ts`, #11/#33). They call the core, not a screen, and return early through `ahead()` while a command is not implemented. They are what feeds the gate's command/story count.
- New in this branch: 8 **UI-driven** specs, one per feature (`m1-<feature>-ui.spec.ts`, 112 tests, tests first, no skips). They fail until the screens exist.
- Commands no existing M1 spec calls: `capture_dismiss_detection`, `capture_ignore_app`, `window_announce`, `window_report_view` (only as `ahead`), `open_external` (only as `ahead`), `call_update`, `call_types_list`. The UI specs now exercise them.

## Per feature: spec file, stories, commands, target
| Feature | Spec file | Stories / flows | Commands it exercises | Target |
|---|---|---|---|---|
| 2.8 dialogs-host | m1-dialogs-host-ui (9) + support/native-alert.ts | dialogs-delete-call, flow dialogs-host sheet / inline-confirm / delete | calls_delete, capture_discard, self_test_run | fake ok; alert answered by a stub of `plugin:dialog|*` |
| 2.9 record-prompt | m1-record-prompt-ui (18) | record-prompt-start-recording, record-after-missed-prompt, call-ended / new-meeting variants | capture_start, capture_dismiss_detection, capture_ignore_app, capture_hold_notice, capture_answer_call_end, capture_answer_new_meeting, window_announce, window_navigate, open_external | fake ok; real core needs world_set for disk/models/presenting |
| 2.10 call-window | m1-call-window-ui (31) | call-screen-recover-capture, stop-at-call-end, hide-for-presenting; floating-panel x3; controls flow | capture_* (exclude/keep source, continue, resume, discard, set_sensitive, mark, pause, stop), window_* (set_call_layout, set_collapsed, hide_call, navigate, announce), app_set_hidden_for_presenting, levels_subscribe, open_external | fake; window:call steering is fake-only |
| 2.11 live-transcript | m1-live-transcript-ui (14, loops expand) | call-screen-replay-line; flows follow / stored | transcript_subscribe, levels_subscribe, audio_play, audio_stop | fake; real core needs transcript streams + playback events |
| 2.12 menu-bar | m1-menu-bar-ui (6) | menu-bar-control-recording / check-state (web side only) | none sent by web; checks nav:request, window:call | fake; the menu itself is native |
| 2.13 library-calls | m1-library-calls-ui (11) | flows browse / delete / edit, status-cell algo, dialogs-delete-call | calls_list, call_get, call_update, call_types_list, calls_delete | fake ok |
| 2.14 call-page-frame | m1-call-page-frame-ui (16) | flows open / more-menu / notifications-banner; dialogs-delete-call; notifications-allow | call_get, call_update, call_types_list, capture_set_sensitive, permission_request, window_report_view, open_external, calls_delete | fake ok |
| 2.15 notifications | m1-notifications-ui (7) | notifications-allow-notifications, flow notifications-receive | permission_request, window_report_view, open_external | fake ok; banner/NT-* are native |

## Needs the real core / XCUITest
Real core (`NOTER_CORE=stdio`): capture_* handlers, levels_subscribe, transcript_subscribe (snapshot + stream), audio_play/stop with `playback:state`, window_* with `window:call`, calls_list/call_get/call_update/call_types_list/calls_delete, window_report_view, open_external. Without these the story is only covered through `ahead()`.

XCUITest (`apps/desktop/tests/native`, does not exist yet; names `test_cpt_noter_seq_…`):
- `..._dialogs_delete_call__error_return_pressed_by_habit`, `..._dialogs_delete_call__other_several_calls_selected` (NSAlert, Cancel default)
- `..._menu_bar_control_recording__quit_while_recording` and 13 more menu items/glyph/state checks (list in header of m1-menu-bar-ui.spec.ts)
- `..._record_prompt_start_recording__hotkey_keeps_focus`, `..._record_prompt_record_after_missed_prompt__hotkey_records`
- `..._notifications_allow_notifications__happy_path`
- `..._floating_panel_hide_and_reopen__capture_problem_while_hidden`
- call-window: hotkey show without focus, hide/restore of every surface, hidden-for-presenting menu notice, panel placement on unplug (header of m1-call-window-ui.spec.ts)

## What the backend / contract lane must provide
1. `harness.world_set` coverage for: presenting.hidden, setup.complete, bundle progress, environment.disk_free_mb and notifications, transcripts, call_details, calls, settings.audio. Fake: `call_details` for call_live and stored transcripts; `capture_set_sensitive` must patch call_details and emit entity:changed; `calls_delete` must emit entity:changed removed.
2. A `Steer` event emit (nav:request, playback:state, window:call) usable on stdio, or real-core equivalents. Today these use a fake-only hook (menu-bar, notifications, live-transcript, call-window rows marked in their headers). `Steer` lives in support/app.ts (UI lane); the harness side is backend.
3. Spec conflicts to settle (HoD/Teamlead): Try Again after engine stop is `capture_continue` in call-window.md but `capture_resume_interrupted` in core design (test accepts exactly one of them); notification banner copy "a call's summary" vs "a summary"; no NavTarget for the Delete Old Audio sheet (window_navigate); Got It on the share warning would need `settings_update` from the call-screen window, which that command refuses.

## Locator risk
All locators (regions CS-/FP-/RP-/LC-/PC-, button names, roles) come from the feature specs and prototype, not live markup. Engineers adjust locators to the implementation, never copy, commands or arguments.
