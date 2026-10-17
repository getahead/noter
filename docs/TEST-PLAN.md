# Noter end-to-end test plan

Owner: QA lead. Status: M0 and M1 tests written and passing against the fake core (18 Oct 2026); M2 to M5 planned. This page says which end-to-end test proves which DESIGN.md story and which frozen IPC command, per milestone, and what stays manual. It follows [ADR-0003](ADR/0003-harness-and-quality-gates.md) and [HARNESS.md](HARNESS.md); where they and this page disagree, they win and this page gets fixed.

## How end-to-end coverage is counted

The bar is 60 % of what the delivered milestones (`harness/milestones.toml`, up to `harness.toml [milestone].current`) list, measured twice: frozen commands and DESIGN.md stories. `scripts/harness/e2e_coverage.py` counts:

- **A command** when an E2E run called it **and it succeeded**. Every suite writes the commands its passing work ran to `coverage/e2e/commands-*.json` (XCUITest's app writes `coverage/native/commands-*.json`). A refused call (scope check, typed error, `not_implemented`) never counts.
- **A story** when a test whose title names its ID (`cpt-noter-seq-…`) passed. Playwright and Vitest read the ID from the title path, so the `describe` block carries the ID and each test inside it is one path of the story. XCUITest spells the ID with underscores and may add `__description`: `test_cpt_noter_seq_menu_bar_control_recording__pause_and_resume()`.
- **Only runs against the real core.** A log with `"target": "fake"` is written for insight and skipped by the gate; `--include-fake` shows it locally. The real core is `noter-core-harness` behind `NOTER_CORE=stdio` + `NOTER_CORE_CMD` (conformance and Playwright), or the built app (XCUITest, WebdriverIO).

What each suite writes:

| Suite | Log | Commands from | Stories from |
| --- | --- | --- | --- |
| Conformance (Vitest) | `commands-conformance-<target>-<pid>.json` (`tests/support/record-setup.ts`) | every successful call in the worker | titles of passing tests |
| UI flows (Playwright) | `commands-ui-e2e-flows-<target>-<worker>-<pid>.json` (`tests/e2e/support/fixtures.ts`) | successful calls of **passing** tests only | — |
| UI flows (Playwright) | `commands-ui-e2e-<target>.json` (`tests/support/story-reporter.ts`) | — | titles of passing tests |
| Native (XCUITest) | `coverage/native/commands-native-app-<pid>.json`, `xcuitest-*.json` | the app's core, windows and `Caller::Native` | passing test names |

## Suites

| Suite | Where | Runs against | What it proves |
| --- | --- | --- | --- |
| UI flows | `apps/desktop/tests/e2e/*.spec.ts` (Playwright, project `e2e`) | Fake core by default; the real core through `noter-core-harness` with `NOTER_CORE=stdio` | One test per story path. Until the React screens exist the flows drive the contract through the core bridge (`createCore`) from the windows the screen lives in, and assert what the screen renders from. When a screen lands, its steps gain page actions and assertions on the same test (see *UI steps to add*) |
| Conformance | `apps/desktop/tests/conformance/*.test.ts` (Vitest) | Fake and real core, same assertions | Contract rules: window scopes, typed errors, snapshot then stream, wanted state and `rev`, versioned whole-state events, O1, capture notices |
| Native UI | `apps/desktop/tests/native/` (XCUITest, `just native`, from M1) | The built app with the real core, scripted engine, fixture world | Menu bar extra, tray glyphs, non-activating panels (call window, floating panel, record prompt), notifications, global hotkeys, card keys |
| Real app | WebdriverIO embedded driver on the Mac runner (from M1, DevOps) | The signed app | The three PRD flows through the real WebView: start a call, review outputs, ask the library |
| Core level | `crates/noter-core/tests/` (Rust, from M0 with the core) | `CoreApi` with scripted engine and runtime, injected clock | What no window can observe: timers (10-second call-end countdown, 5-minute Continue window, 60-second new-meeting default), automatic resume of downloads, change-log rows for every write, log scrubbing, late results dropped. Rust tests name a story with underscores when they prove one of its paths |
| Manual | `docs/HARNESS.md` › macOS checklist | The signed build on the development MacBook Pro | Only what automation cannot judge (see the end of this page) |

### The scenario layer

`tests/support/scenario.ts` gives every test its own isolated core and the windows a story uses (`scenario.core("call-screen")`, …), each a typed client exactly as the UI builds it. Commands that succeed are recorded per scenario. A story's preconditions and the outside world's moves (a display unplugged, the call app letting go of the microphone, the disk filling up) go through four controls:

| Control | Fake core | Real core harness (request on the same wire, `window: "main"`) |
| --- | --- | --- |
| `change(mutate)` | `FakeCore.setWorld` | `harness.world_get` → `FakeWorld`; mutate; `harness.world_set { world }`, which must emit a whole-state event with a new version for every slice that changed, as the fake does |
| `failNext(window, cmd, code, detail)` | `FakeCore.failNext` | `harness.fail_next { window, cmd, code, detail }` |
| `push(cmd, body)` | `FakeCore.push` on the newest open Channel | `harness.push { cmd, body }` → `{ seq }`: the scripted engine or runtime emits `body` |
| `reopen(window)` | a new `FakeCore` for the label on the same world | a new transport for the label on the same process (a crashed WebView) |

Control requests are not contract commands and are never recorded. The backend lead owns their implementation in `noter-core-harness`; the exact shape above is a proposal (see *Requests*). Each Playwright test starts its own harness process, so tests never share state; the conformance suite does the same per test in the new file and keeps one process per worker in the existing files.

`tests/support/world-presets.ts` holds the starting states as mutations of the fixture world; `tests/support/results.ts` holds `ok`, `refused`, `until` and `ahead` (a step whose command a later milestone delivers: on the real core `not_implemented` skips just that step until then, any other error fails).

## Test data: the fixture world

All suites use `contracts/fixtures/world.json` (generated from `noter-protocol`, seeded as rows by the harness `--fixture world`, fixture parity from M1). What the stories rely on:

| Entity | Value |
| --- | --- |
| Live call | `call_live`, "Planning: VHI 8.0 drawer redesign", recording on the Studio Display, 5 speakers, 8 segments, transcript `last_seq` 42, a `paused` gap and a mark, headphones output |
| Past call | `call_backend`, "Backend sync", outputs ready, audio kept |
| Displays | `dsp_builtin` (holds the call app) and `dsp_studio` (chosen for the call screen) |
| Setup | complete, both audio permissions granted, self-test passed, detection on, all four model bundles ready (the speech and VAD bundles required for capture) |
| Hotkeys | the nine defaults (`Ctrl+Alt+Super+R`, …), `ask_about_call` in conflict with Raycast |
| Settings | `rev` > 0, retention 30 days, Spotify ignored, Exclude Noter's own sounds on |
| Live script | five transcript events at 1.5 s intervals after subscribing (hypothesis, confirmed, …, mark) |

Presets: `idle` (no call recording), `detect(app, blocked?)` (Microsoft Teams, Zoom, Safari, Slack), `notice(…)`, `degrade(state)` / `recover(type)`, `permission(kind, state)`, `firstRun({ modelsReady })`, `selfTestSkipped`, `laptopOnly`, `morePastCalls(n)`. The golden set (ten hand-corrected calls) is for the transcription metrics and skill evals, not for these flows.

## The five critical stories

DESIGN.md 3.6 marks five stories with a sequence diagram because they cross windows. Each must be proven end to end against the real core before its milestone gate, and on the native side by XCUITest:

| Story | Milestone | Playwright | XCUITest (planned) |
| --- | --- | --- | --- |
| `cpt-noter-seq-record-prompt-start-recording` | M1 | `m1-record-prompt.spec.ts`, 5 paths | `test_cpt_noter_seq_record_prompt_start_recording__record_keeps_call_app_focused`, `…__start_hotkey` |
| `cpt-noter-seq-call-screen-stop-at-call-end` | M1 | `m1-call-screen-capture.spec.ts`, 6 paths | `test_cpt_noter_seq_call_screen_stop_at_call_end__notice_in_record_prompt_panel_when_hidden`, `…__menu_when_presenting` |
| `cpt-noter-seq-floating-panel-display-unplugged` | M1 | `m1-floating-panel.spec.ts`, 4 paths | `test_cpt_noter_seq_floating_panel_display_unplugged__panel_on_laptop_screen`, `…__off_screen_position_clamped` |
| `cpt-noter-seq-call-screen-pin-card` | M4 | planned | `test_cpt_noter_seq_call_screen_pin_card__card_key_without_focus` |
| `cpt-noter-seq-call-page-hand-off-item` | M2 | planned | — (deep links and Automation are checked by the WebdriverIO run and the checklist) |

## M0 — IPC host, app snapshot, settings, first run and permissions

Delivered: 22 frozen commands, 3 stories. **Status: written, 16 Playwright tests and conformance additions, all passing against the fake core.**

| Story | Path → test (`describe` = story ID) | File |
| --- | --- | --- |
| `cpt-noter-seq-first-run-complete-setup` | happy; other — Finish the remaining steps; error — Microphone not allowed; error — System audio not allowed; error — Self-test hears only one stream; empty — Self-test skipped | `tests/e2e/m0-first-run.spec.ts` |
| `cpt-noter-seq-first-run-download-models` | happy; error — No connection; error — Not enough disk space; error — Download failed its check; error — Speech model not downloaded yet | `tests/e2e/m0-first-run.spec.ts` |
| `cpt-noter-seq-settings-set-hotkeys` | happy; error — Shortcut used by VoiceOver; error — Card key used by another app; error — Shortcut without a modifier; empty — No setting matches the search (with Restore Defaults) | `tests/e2e/m0-settings-hotkeys.spec.ts` |

Commands, by the suite that exercises them successfully:

- UI flows: `app_snapshot`, `stream_unsubscribe`, `stream_ack` (the generated client acknowledges after 1 s), `log_ui`, `setup_status`, `models_download`, `permission_request`, `self_test_run`, `setup_set_call_display`, `setup_set_audio_storage`, `setup_set_step`, `settings_get`, `settings_update`, `settings_unignore_app`, `hotkeys_list`, `hotkey_set`, `hotkeys_reset`.
- Conformance (`m0-m1-rules.test.ts`): the above plus `banner_dismiss`, `glossary_list`, `glossary_upsert`, `glossary_remove`, `update_install`. Together: 22 of 22.

UI steps to add when the screens land: the wizard stepper (step marks, **Run Test** dimmed, **Checking…**, **Self-test passed** with the line), the **Models** rows with sizes and percentages, the Settings window's Hotkeys pane (field focus, **Type a shortcut…**, the warnings under rows) and its search field. Native: the macOS permission prompts stay on the checklist; the global hotkey actually firing after a change is XCUITest (`test_cpt_noter_seq_settings_set_hotkeys__new_chord_fires`).

## M1 — Capture, live transcript, call window, menu bar, Library list

Delivered (cumulative with M0): 58 frozen commands, 16 stories. **Status: written, 60 Playwright tests and conformance additions, all passing against the fake core.**

| Story | Paths → tests | File | Native part (XCUITest, planned) |
| --- | --- | --- | --- |
| `cpt-noter-seq-record-prompt-start-recording` | happy; other — Vendor call recorded as sensitive; other — Not a call; error — Not enough disk space; error — System audio access is off | `m1-record-prompt.spec.ts` | prompt is non-activating, ⌃⌥⌘R from the call app |
| `cpt-noter-seq-record-prompt-record-after-missed-prompt` | happy; empty — Prompt closed unanswered; error — Setup incomplete; error — Audio access not granted yet; empty — Hidden for presenting | `m1-record-prompt.spec.ts` | **Call Detected · Start Recording** menu item |
| `cpt-noter-seq-call-screen-recover-capture` | happy (Exclude); other — Keep; error — System audio silent; error — Microphone off; error — Engine stopped; error — Headphones connected; error — Transcription stalled; empty — Nothing heard yet (Keep and Discard); error — Disk nearly full | `m1-call-screen-capture.spec.ts` | NT-3 notification while hidden |
| `cpt-noter-seq-call-screen-stop-at-call-end` | happy (hold, release, Stop Now); error — Next meeting starts straight away; error — Stopped by mistake; empty — No answer to the notice; error — Call window hidden; error — Hidden for presenting | `m1-call-screen-capture.spec.ts` | notice in the small panel; menu line while presenting |
| `cpt-noter-seq-call-screen-replay-line` | happy; error — Recording on speakers; error — Output switches to speakers; error — Output not identified; error — Noter's own sounds not excluded | `m1-call-screen-replay-presenting.spec.ts` | — |
| `cpt-noter-seq-call-screen-hide-for-presenting` | happy; empty — Call detected while hidden; error — Notification while hidden; other — Check the share before presenting; other — Share warning in the floating panel | `m1-call-screen-replay-presenting.spec.ts` | ⌃⌥⌘0 hides every window and restores exactly the open ones; eye-slash tray glyph |
| `cpt-noter-seq-floating-panel-display-unplugged` | happy; empty — Display connected again; error — Panel would land off screen; error — Chosen display not connected | `m1-floating-panel.spec.ts` | panel placement and snapping |
| `cpt-noter-seq-floating-panel-collapse-strip` | happy; other — Pin from the strip; error — Capture notice while collapsed; empty — Copilot muted while collapsed | `m1-floating-panel.spec.ts` | double-click header collapses; strip expands by itself for a notice |
| `cpt-noter-seq-floating-panel-hide-and-reopen` | happy; error — Capture problem while hidden; error — Panel closed by a crash | `m1-floating-panel.spec.ts` | ⌃⌥⌘N, **Open Call Screen** |
| `cpt-noter-seq-menu-bar-control-recording` | happy (Mark, Pause, Resume, Stop); error — Paused for 5 minutes; error — Quit while recording | `m1-menu-bar.spec.ts` | the whole menu, glyph forms, the quit alert with **Cancel** as default |
| `cpt-noter-seq-menu-bar-check-state` | happy; empty — Not recording; error — Switched to local; error — Setup incomplete; other — New meeting while hidden | `m1-menu-bar.spec.ts` | menu header lines and hotkey hints |
| `cpt-noter-seq-dialogs-delete-call` | happy; error — Return pressed by habit; other — Several calls selected | `m1-library-dialogs-notifications.spec.ts` | NSAlert with **Cancel** as default (Return keeps the call) |
| `cpt-noter-seq-notifications-allow-notifications` | happy; error — Notifications not allowed; other — Turn notifications on later | `m1-library-dialogs-notifications.spec.ts` | system prompt on the checklist; **Open Last Summary** menu item |

Commands: the UI flows exercise 33 of the 36 M1 commands; the conformance file adds `call_update`, `call_types_list` and the successful `capture_set_sensitive`. Together: 36 of 36. Four M2 commands (`audio_delete_older`, `share_test_run`) and three draft M4 commands (`cards_subscribe`, `card_pin`, `copilot_mute`) are called where a story step needs them, through `ahead`, and count as "ahead of schedule".

Conformance additions (`tests/conformance/m0-m1-rules.test.ts`, 32 tests): window scope with valid arguments for 15 command/window pairs, each checked to leave capture, setup, calls and hotkeys untouched; typed errors with their detail and `retryable` for `not_found`, `conflict` (`current_rev`), `invalid_input` (validation detail), `already_recording`, `notice_expired`, `continue_window_closed`, `detection_expired`, `not_recording`, `offline`, `not_ready`, `disk_full`, `model_missing`; O1 (a start from main, record prompt and call screen with setup incomplete, permissions denied and no self-test; refused only with `disk_full` and `model_missing`); `capture_hold_notice` from both windows (holding twice is harmless), `capture_keep_recording`, `capture_resume_interrupted` (once, clears its banner, gap `interrupted`), `banner_dismiss`, one-way `capture_set_sensitive`; snapshot then stream for levels (seq from 1, nothing after `stream_unsubscribe`), transcript (two subscribers, each from its own `last_seq`), a past call (snapshot only) and the self-test (ends with `ended`); growing versions on `capture:state`, `setup:changed`, `settings:changed`, `hotkeys:changed`, `window:call` and `app:presenting`, with the command result equal to the event it caused; glossary and `log_ui`.

UI steps to add when the screens land: the record prompt's buttons and the **Not Now** menu; the call screen's status strip (**Recording · 00:12**, **Recording · mic only**, **Not recording**), banners at the top of the transcript, the transcript following live and **Jump to Live**, the playback bar and disabled play controls with their help tags; the floating panel's header controls and the collapsed strip; Settings › General's ignored apps and **Notifications are off for Noter**; Calls in the library with multi-select. The menu bar, the tray, the panels' focus behaviour, notifications and the delete alert are XCUITest's.

## How the M0/M1 tests start counting

Nothing changes in the tests when the real core arrives:

1. The backend lands `noter-core-harness` (M0) with the four control requests above.
2. CI sets `NOTER_CORE_CMD` and runs the conformance suite and the Playwright flows a second time with `NOTER_CORE=stdio` (DevOps; see *Requests*).
3. The owner moves `harness.toml [milestone].current` to `M0`, then `M1`. Every passing stdio run then counts.

If every test passes against the real core: M0 22/22 commands and 3/3 stories; M0+M1 58/58 commands and 16/16 stories, well above the 60 % bar, with the margin to absorb a few paths the real core gets right differently. Two tests take a target-specific branch on purpose and are the first to look at when the real core runs: *No connection* (the fake has no download scheduler, so the test sends the resume the core does by itself) and *Output switches to speakers* (on the real core the playback must stop with `output_switched_to_speakers`; the fake's playback just ends).

The support layer was checked over the wire before this change: with a throw-away stdio wrapper around the fake core implementing the four controls (not committed, so it can never be mistaken for the real core), 74 of 76 flows and all 32 new conformance tests passed over JSON Lines; the two that did not were exactly the two branches above.

## M2 — Speakers, post-call outputs, items, handoff, Today, undo (planned)

Each story gets one Playwright test per path in `tests/e2e/m2-*.spec.ts`, against the M2 commands, plus conformance additions for `rev` conflicts on items and outputs, undo/redo by target and asynchronous handoff generation (`entity:changed` after `handoff_generate`).

| Story | Paths | Approach and main commands | Native / other |
| --- | --- | --- | --- |
| `cpt-noter-seq-today-review-before-call` | happy; other — Return to a live call; empty — Calendar not allowed yet; error — Calendar access denied; error — Calendar read failed; empty — No calls today; error — Noter quit during a recording | `today_get`, `items_list`, `item_get`; calendar states through `change` (permission, `calendar_unavailable` via `failNext`); quit banner with `capture_resume_interrupted` and `banner_dismiss` | Calendar prompt on the checklist |
| `cpt-noter-seq-today-tick-item` | happy; error — Item has an open handoff; error — Ticked by mistake; empty — Nothing open yet | `item_set_done` (wanted state, stale `rev`), `item_reopen`, `change_undo` | — |
| `cpt-noter-seq-call-screen-name-speaker` | happy; empty — No matching person | `transcript_rename_speaker`, `speakers_updated` on the live stream | — |
| `cpt-noter-seq-call-page-review-outputs` | happy; empty — Outputs still being written; error — A section failed; error — Written by the local model; empty — Nothing in a section; empty — No changes yet; other — Regenerate with a different model; other — Compare versions; other — Export the call's change log | `outputs_get`, `output_edit`, `outputs_regenerate`, `output_versions`, `output_version_get`, `history_export`; `outputs:progress` events | — |
| `cpt-noter-seq-call-page-review-suggested-items` | happy; error — Rejected by mistake; empty — Nothing to review; error — Regenerated after review; other — Accept everything at once; other — Review in the Item inspector | `item_review`, `items_review_all`, `item_edit`, `change_undo` | — |
| `cpt-noter-seq-call-page-name-speakers` | happy; empty — Speaker skipped; empty — Audio no longer kept; other — Name a skipped speaker later; other — Hide the panel | `transcript_name_speakers`, `audio_play` refused with `audio_deleted` | — |
| `cpt-noter-seq-call-page-share-outputs` | happy; other — Share a sensitive call; empty — Nothing to share yet; error — Suggested items not reviewed; other — Export to a folder; other — Share one section | `share_copy`, `calls_export`, `unreviewed_in_scope`, `outputs_not_ready` | Save panel on the checklist |
| `cpt-noter-seq-call-page-hand-off-item` (critical) | happy; error — No Claude Code link handler; error — Automation denied; error — No repository mapped; empty — Item owned by someone else; error — Prompt not written; other — Check the prompt against the generated version; other — Hand off to Codex or a suggested item | `handoff_get`, `handoff_generate`, `handoff_cancel`, `handoff_edit`, `handoff_set_target`, `handoff_open`, `handoff_copy`, `repos_list`, `repo_upsert`, `item_answer_handoff_landed` | WebdriverIO: the deep link opens; Automation prompt on the checklist |
| `cpt-noter-seq-call-page-check-evidence` | happy; error — Audio deleted by retention; error — Transcript upgraded by the archive pass; error — Archive transcript pending; other — Edit an item in the Item inspector | `transcript_span` (`upgraded_by_archive`), `audio_play`, `item_edit` | — |
| `cpt-noter-seq-notifications-open-outputs` | happy; error — Outputs failed; empty — Main window already shows the call; empty — Next call already recording | `window_report_view`, `window_navigate`; the notification itself | XCUITest: **Summary ready** posted, clicked, not posted while the call page is frontmost |

Also in M2: `audio_delete`, `audio_delete_older` (Delete Old Audio… sheet), `item_create`, `history_list`, `change_redo`, `call_tags_set`, `tags_list`, `repo_remove`, `share_test_run` — through the stories above and the conformance suite.

## M3 — Search, Ask, topics, people, knowledge sources, credentials, own accounts (planned)

| Story | Paths | Approach and main commands | Native / other |
| --- | --- | --- | --- |
| `cpt-noter-seq-first-run-connect-assistant` | happy; error — API key rejected; other — Sign in with your own account; empty — No key and no local runtime | `api_key_set` (`key_rejected`), `account_signin_prepare/start`, `accounts_get`, `account_test` | Browser sign-in on the checklist |
| `cpt-noter-seq-library-search-calls` | happy; error — Index rebuilding; empty — No matches; error — Only weak matches; error — Search failed | `search` (`index_rebuilding`, `search_failed` retryable) | — |
| `cpt-noter-seq-library-filter-calls` | happy; empty — No calls match the filters; empty — No calls yet; empty — No tags yet; other — Tag several calls at once | `calls_list` filters, `tags_list`, `call_tags_set`, `calls_export` | — |
| `cpt-noter-seq-library-follow-topic` | happy; empty — No topics yet; error — Merge suggested; other — Rename a topic; empty — Nothing left in this topic | `topics_list`, `topic_get`, `topic_rename`, `topics_merge`, `topics_keep_separate` | — |
| `cpt-noter-seq-ask-cited-answer` | happy; empty — Not found in your calls; error — Claude Code unreachable; error — Sensitive sources skipped; error — Keyword-only index; error — Only weak evidence | `ask_start` stream (snapshot then stream), `ask_stop`, `ask_scope_presets`; runtime failures via the scripted runtime | — |
| `cpt-noter-seq-ask-follow-up-and-copy` | happy; empty — First question; error — Cited source deleted | `ask_threads_list`, `ask_thread_get`, `ask_thread_delete` | — |
| `cpt-noter-seq-people-prepare-one-on-one` | happy; empty — No calls with this person yet; empty — No people yet | `people_list`, `person_get` | — |
| `cpt-noter-seq-people-name-unnamed-speaker` | happy; empty — New person; error — Wrong person chosen; other — Rename a person; other — Merge two entries for one person | `person_create`, `person_update`, `people_merge`, `person_delete`, `change_undo` | — |
| `cpt-noter-seq-dialogs-set-up-voice-profile` | happy; other — Delete the profile | `voice_profile_create`, `voice_profile_delete` | — |
| `cpt-noter-seq-settings-replace-api-key` | happy; error — Key rejected; error — Keychain locked; error — Local model not ready; other — Use your Claude account while the key is rejected | `api_key_set`, `api_key_remove`, `account_bind_agents` | Keychain prompt on the checklist |
| `cpt-noter-seq-settings-sign-in-account` | happy and its 11 named paths | `account_signin_*`, `account_use_existing`, `cli_install`, `account_sign_out`, `signin:progress` events | Browser and CLI installs on the checklist |
| `cpt-noter-seq-settings-check-privacy` | happy; empty — Nothing has left this Mac; other — Screen share test; error — Screen Recording not allowed; error — Capture test failed; error — Storage folder in iCloud Drive; other — Install an update | `audit_list`, `audit_export`, `share_test_run`, `storage_move` (`storage_in_cloud_folder`), `update_install` | Screen Recording prompt on the checklist; the network-monitor privacy test is CI's |
| `cpt-noter-seq-settings-add-knowledge-source` | happy; error — Sync failed; error — Sign-in expired; other — Remove the source | `sources_list`, `source_add_folder`, `source_add_mcp`, `source_update`, `source_reindex`, `source_remove`, `source_revoke_token` | Folder picker on the checklist |

## M4 — Copilot loop and council (planned)

Copilot surfaces are draft until the M4 gate, then frozen; the tests are written against the draft and kept green.

| Story | Paths | Approach and main commands | Native / other |
| --- | --- | --- | --- |
| `cpt-noter-seq-call-screen-pin-card` (critical) | happy; error — Card key used by another app; empty — No card with that number; other — Check what is pinned | `cards_subscribe` (snapshot then stream), `card_pin`, `card_unpin`, `card_undo_last` (30 s, `undo_expired`), `card_shown` | XCUITest: card keys ⌃⌥⌘1–3 pin without stealing focus from the call app |
| `cpt-noter-seq-call-screen-catch-up` | happy; error — Catch-up still being written; other — Ask about this call | `copilot_catch_up`, `copilot_ask_about_call` (solicited cards) | — |
| `cpt-noter-seq-call-screen-read-copilot-state` | happy; empty — No card yet; error — Card too late; error — Switched to local; error — Copilot paused by budget; error — Copilot off for a sensitive call; other — Make the call sensitive during the call | `copilot:status`, `copilot_raise_budget`, `capture_set_sensitive`, `card_set_held`, `card_rate` | — |
| `cpt-noter-seq-menu-bar-mute-copilot` | happy; error — Card keys stop while muted; empty — Muted copilot in the collapsed strip | `copilot_mute`, `copilot_mute_agent` | XCUITest: Mute Copilot submenu, muted tray glyph, card keys unregistered |
| `cpt-noter-seq-agents-add-agent` | happy; error — Budget shares over 100 %; error — Runtime unavailable; other — New agent on your own account; other — Fix with your signed-in account | `agents_get`, `agent_create`, `agent_update`, `agents_reorder`, `agent_remove` | — |
| `cpt-noter-seq-agents-tune-council` | happy; error — Agent switched itself off; error — Skill file missing; other — During a live call | `council_set_mode`, `agent_skill_get/save/reset` | — |

The M1 floating-panel tests already carry their card steps through `ahead`; at M4 those steps become plain `ok`.

## M5 — Jobs and evidence, proposals, Activity, metrics and Performance (planned)

| Story | Paths | Approach and main commands |
| --- | --- | --- |
| `cpt-noter-seq-activity-review-proposals` | happy; empty — Nothing waiting; error — Couldn't apply; error — Item changed since; error — Job failed; error — Evidence tool missing; other — Always for this term | `proposals_list`, `proposal_decide`, `proposal_always_for_term`, `activity_get`, `jobs_list`, `job_run_now` (`job_blocked` during a call, except post-call analysis) |
| `cpt-noter-seq-activity-undo-batch` | happy; error — Undo strip already gone; error — Item closed by mistake; error — Some changes edited later; error — Change log unreadable; empty — Nothing has changed yet; empty — Filter shows nothing | `change_undo` / `change_redo` by batch, `edited_later`, `change_log_unreadable` (retryable), `history_list` |
| `cpt-noter-seq-performance-find-bottleneck` | happy; empty — No calls yet; empty — Not enough data; error — Roll-up failed; empty — No late ticks in a call | `perf_overview`, `perf_call`, `roll_up_failed` banner |
| `cpt-noter-seq-performance-export-brief` | happy; error — Noter repository not mapped; error — Brief does not open | `perf_brief`, `repo_upsert` |

Also in M5: `job_cancel`, `job_update`. The corruption and disk-full drills run nightly as core-level tests (PRD › Success metrics: recovery ≤ 10 min, no lost calls).

## What stays on the macOS checklist

Run by hand before each milestone gate and each release (docs/HARNESS.md): system permission dialogs and TCC prompts attributed to Noter (microphone, system audio including **Quit & Reopen**, Calendar, notifications, Screen Recording, Apple Events); capture with real call apps (Teams, Zoom, Meet in a browser), across an AirPods switch, dock and undock, pause and a 90-minute call; the look of Liquid Glass materials and Increase Contrast; the signed and notarized build launching from the DMG. Everything else in the stories above is automated.

## Requests

For DevOps (justfile, CI, configs; I have not changed them):

1. `just e2e`: after `pnpm --dir apps/desktop test:e2e`, add `if [ -n "${NOTER_CORE_CMD:-}" ]; then NOTER_CORE=stdio pnpm --dir apps/desktop test:e2e; fi`, as already done for the conformance suite. Without it the Playwright flows never run against the real core and the M0/M1 stories cannot count.
2. CI's `NOTER_CORE_CMD` must include the fixture flag: `target/debug/noter-core-harness --fixture world`.
3. Harness scripts need Python ≥ 3.11 (`tomllib`); on the Mac `/usr/bin/python3` is older, so recipes should call `python3` with Homebrew's first on `PATH`, or `python3.12`.

For the backend lead (`noter-core-harness`):

4. Implement the four control requests of *The scenario layer* (`harness.world_get`, `harness.world_set`, `harness.fail_next`, `harness.push`) or tell me the shape you prefer; `tests/support/scenario.ts` is the only place to change.
5. Starting a capture must create the call row: `call_get` and `transcript_subscribe` for a call just started must answer (the M1 flows avoid them for new calls because the fake answers `not_found`).

For the contract lane (fake core, protocol):

6. `src/core/fake/fake-core.ts` imports `world.json` without `with { type: "json" }`, which Node's ESM loader (Playwright) refuses; `tests/support/json-modules.ts` works around it with a load hook. With the attribute the hook can go.
7. Gaps found while mapping stories to commands: the record prompt may not call `open_external` (its **Open System Settings…** on *System audio access is off* has no command from that window); **Got It** on the floating panel's share warning has no command, and the fake never sets `show_share_warning` or `chosen_display_missing`; the fake does not re-evaluate the call layout when displays change (the flows re-send the saved preference), does not stop playback on a switch to speakers, does not check disk space in `models_download`, and its self-test ignores the speech model's state.
