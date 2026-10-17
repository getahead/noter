---
description: Five-role review of DESIGN-core v0.3 (17 Oct 2026) and how each finding was resolved; the resolution list every document, the contract and the prototype follow.
---

# DESIGN-core v0.3 review and resolutions (17 Oct 2026)

Five reviewers (PM, Advanced User, Tech Writer, QA, Backend Architect) checked `docs/DESIGN-core.md` v0.3 against PRD.md, DESIGN.md v1.0, the contract crate, the fake core, and what Rust, Tauri 2 and macOS can do. 118 raw findings, about 70 after merging. This file lists the owner decisions and the resolution of every finding. DESIGN-core v0.4, the contract crate, the fake core, PRD.md (and its living copy), DESIGN.md and the clickable prototype were changed to match it on 17 Oct 2026.

Tags: PM, AU (Advanced User), TW (Tech Writer), QA, BA (Backend Architect) with the reviewer's finding number. "DC" = DESIGN-core.md, "UI" = DESIGN.md.

## Owner decisions (17 Oct 2026)

| # | Decision |
|---|---|
| O1 | **Permissions are granted by default; no consent is required.** If Noter is started, everything is agreed between the people on the call. Noter never refuses or gates a start on setup state, audio permissions or the self-test. No start control ever reads **Finish Setup…**. If macOS has not been asked yet, the first capture triggers the system prompt; if access is off, capture still runs and the degraded state says which channel is silent. An unfinished self-test only keeps automatic call detection off. |
| O2 | **noter-mcp runs only locally and is never exposed to the network.** It is a stdio child of the CLI for one run, talks to the core only over the Unix socket with a per-run token, and never opens a TCP port. Because it runs inside the core's trust boundary, its socket handler is part of the egress gate: for a run on a cloud runtime, every tool result is redacted with the run's map and pseudonyms and gets an `audit_log` row before it is returned. |
| D1 | Live MCP lookups (the user's own MCP sources) are **off unless the privacy mode is "Cloud allowed"**; when on, they run only after calls and in Ask, never on live ticks, and noter-mcp relays each one as `live_<source>_<tool>` and writes a `lookup` audit row before forwarding it (PRD › Privacy). |
| D2 | The previous call's **post-call analysis runs during a live call** at low priority. Only the archive (offline) pass, regeneration and maintenance jobs wait for the call to end. |
| D3 | **Today ranking default = PRD order**: owed to people on today's calls, then due date, then age. A Settings › General › Today **Ranking** pop-up offers "Due date, then owed to you" as the alternative. |
| D4 | An agent **switches itself off for a call type** when ≥ 80 % of its cards were dismissed over the last 10 calls of that type; logged in History, undoable, announced once on the Agents page. |
| D5 | Behaviour metrics (talk time) are computed **from the moment they are switched on**; past calls are not back-computed. |
| D6 | **The engine plays replay audio** (it owns the files and is already excluded from the tap). The core asks the engine to play; the tap excludes both the engine PID and the app PID. |

## Resolutions

Each line: ID · finding · resolution. Contract names are exact.

### Blockers

- **R1** (PM2, AU7, TW1, QA2) Manual start refused while setup incomplete → per O1. Remove `ErrorCode::SetupIncomplete`, `StartBlocked::SetupIncomplete`, `StartBlocked::SystemAudioOff`, the `StartControl` enum and `SetupStatus.start_control`. `capture_start` rejects only `already_recording`, `disk_full` (< 500 MB, detail `needed_mb`) and `model_missing` (live model not downloaded). `DegradedState::SetupIncomplete` stays (call detection off). Add `DegradedState::MicrophoneOff { call_id }` (mic access off during capture); `SystemAudioLost` is renamed `SystemAudioSilent { call_id, since, confidence }` (R30). UI: start controls always read **Record**; "Finish Setup…" survives only as a Today/menu-bar link to the first-run window.
- **R2** (PM1, AU12, QA3, BA1) Egress gate sees only the first packet → per O2 and D1:
  - The noter-mcp socket handler redacts and audits each tool result for cloud runs (`audit_log.kind = tool_result`, one row per result, linked to the run's row by `llm_run_id`).
  - Every CLI run is locked down: Claude Code `--strict-mcp-config --mcp-config run/mcp/<run_id>.json --tools <allow-list without WebFetch, WebSearch, Bash> --setting-sources ""` (own-account runs too, since `--bare` cannot use a subscription login) and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`; Codex with an isolated `CODEX_HOME`, `--sandbox read-only` and no user `config.toml`. A CI test proves no user hook, plugin or MCP server starts.
  - Audit unit: one row per run (the packet) plus one per tool result; the CLI's own HTTPS requests for that run are expected to go only to the provider host of its runtime. Allow-list of destinations with no audit row: update feed, model downloads, CLI install, OAuth/sign-in pages. Each has a fixed host list in `contracts/egress-hosts.json`.
  - The release blocker "0 cloud requests without a log entry" is measured by the network-monitor test (R46): every proxy line to a provider host must match a run row by time window and run id header; every other host must be on the allow-list.
- **R3** (QA1, AU10) Redo after the 10 s strip → `RedoArgs { target: UndoTarget }`; `change_redo` works at any time on an undone change or batch whose rows were not edited later, and writes new change rows. `RedoToken`, `UndoResult.redo` and `redo_until` are removed. Change machine gains `undone → applied` (redo). Errors: `already_undone`, `not_undone` (redo of something not undone), `not_undoable`, `edited_later` (every row edited later). `partially_applied` is removed: a partial undo/redo is a success with `UndoResult.skipped_edited_later`. `undo_expired` is kept only for `card_undo_last` (30 s window, R40).

### Capture and session

- **R4** (PM3, QA7) Post-call during a live call → per D2. `JobKind::PostCall` is not blocked by a live call (low priority, after live ASR); `JobKind::ArchivePass`, regeneration and maintenance jobs are. `outputs_regenerate` still returns `job_blocked` during capture.
- **R5** (AU3, QA4) Hold the call-ended countdown → `capture_hold_notice(NoticeHoldArgs { call_id, held: bool }) -> CaptureState` [CaptureControl, Frozen, CallScreen | RecordPrompt]. While held `CaptureNotice::CallEnded.stops_at` is `null`; on release the 10 s countdown restarts.
- **R6** (AU14, QA5) Keep commands → `capture_keep_recording(CallIdArgs) -> CaptureState` (answers nothing heard; resets the 5-minute timer) and `capture_keep_source(KeepSourceArgs { call_id, bundle_id }) -> CaptureState` (keeps the second source; banner not shown again for that app in this call) [CaptureControl, Frozen, CallScreen]. Nothing heard is modelled once, as `CaptureNotice::NothingHeard`; `DegradedState::NothingHeard` is removed.
- **R7** (AU6, QA6) Resume after quit or crash → `capture_resume_interrupted(CallIdArgs) -> CaptureState` [CaptureControl, Frozen, Main | CallScreen] continues the same call with a gap row `GapReason::Interrupted`; allowed while the `RecordingInterruptedByQuit` banner is shown (until dismissed or another capture starts). `banner_dismiss(BannerDismissArgs { banner: BannerKind }) -> BannerSet` [App, Frozen, Main]. Dropout (release blocker "99 % without dropouts") = a gap with reason `interrupted`, `engine_restart`, `device_changed` or `stalled` longer than 2 s; stored per call in `metrics` as `dropout_ms`.
- **R8** (QA8) Transitions → `stopped` lasts until `continue_until` passes or another capture starts, then `idle`. Continue Recording cancels the queued or running post-call job and re-queues it after the next stop (outputs already written are regenerated, edits kept). `capture_start` while `stopped` is allowed and closes the Continue window of the stopped call. Start as New Call splits at the notice's `detected_at`; the saved call is offered Continue for 5 minutes. `CaptureNotice::NewMeeting` gains `expires_at` (60 s) and `default_choice` (`start_as_new_call`).
- **R9** (TW6, QA9) `disk_low` is never a command rejection; it exists only as `DegradedState::DiskLow`. Remove `ErrorCode::DiskLow`. `CaptureState.audio_writing: bool` is false when disk is full mid-call (the transcript continues).
- **R10** (BA8) Crash loses the ring buffer → the engine keeps the capture ring in a memory-mapped file in the App Group container; on an engine crash the supervisor restarts it in capture-first mode (taps before models load) and resumes from the ring's write position; expected gap ≤ 2 s per restart, counted as a dropout. A separate capture process is Open question Q7 (decided by the M1 week-one test).
- **R11** (QA21) `DegradedState::CaptureFailed { call_id, since }` when the engine could not be restarted; UI state "Not recording · engine stopped" with **Try Again**; NT-3 is sent.
- **R12** (AU11) Replay override per output device → replace `OutputMode` in settings with `AudioOutputSettings { headphones_devices: Vec<String> }` (output device UIDs the user marked as headphones). The override lifts only `OutputRoute::Unknown`; a detected speaker route always refuses. `PlaybackState.stopped_reason: Option<PlaybackStopReason>` = `ended | user | output_switched_to_speakers | capture_started`. The speakers-with-echo-cancellation option is removed everywhere (headphones-only decision).
- **R13** (AU23, BA14) Replay process → per D6.

### Hotkeys, notifications, native macOS

- **R14** (AU1, TW4, QA26) App hotkeys are registered at launch and stay registered. Card keys are registered only while capture runs ∧ copilot on ∧ not muted ∧ not hidden for presenting (`CardKeysState` doc).
- **R15** (AU2) `HotkeyAction::MuteCopilot` (⌃⌥⌘K; toggles Unmute while muted).
- **R16** (AU19) Card keys as one setting: `CardKeySettings { enabled: bool, modifiers: Modifiers }` (pin = modifiers + 1–3, dismiss = modifiers + ⇧ + 1–3); remove `PinCard1..3` and `DismissCard1..3` from `HotkeyAction`. `hotkeys_reset(NoArgs) -> HotkeyList` [SettingsAndCredentials, Frozen, Settings].
- **R17** (AU8, QA20) Notifications during capture: everything is held while recording and while hidden for presenting, released one per call after it ends; **NT-3 "System audio lost"/capture failed is sent at once** unless Noter is hidden for presenting (then only the menu bar icon shows it) or a call surface is visible. The core knows which call the main window shows through `window_report_view(ViewReportArgs { call_id: Option<CallId> }) -> Ack` [Windows, Frozen, Main]; no notification is sent for the call the frontmost main window shows.
- **R18** (AU9, BA9) Notifications use `UNUserNotificationCenter` through objc2 in `noter-native` (not `tauri-plugin-notification`): authorization request, settings read into `EnvironmentState.notifications: NotificationAuth` (`not_determined | denied | authorized`), `threadIdentifier` per call, `userInfo` = `NavTarget`, click delegate → `nav:request`.
- **R19** (AU13) `GeneralSettings.launch_at_login: bool` (SMAppService) and `GeneralSettings.offer_to_record: bool`; detection = `offer_to_record` ∧ self-test passed.
- **R20** (BA13) Calendar: `NSCalendarsFullAccessUsageDescription` and `com.apple.security.personal-information.calendars` added to 3.8 and the PRD; CI check of the built Info.plist and entitlements against every `PermissionKind`.

### Packaging and sandbox

- **R21** (BA2) App Group container `<TEAMID>.ai.noter` shared by app and engine holds `audio/`, `models/`, `engine-io/` and the capture ring; every path in `engine.rs` is relative to it. `storage_move` stays draft and is available only if the engine ships unsandboxed (Q4).
- **R22** (BA3, BA17) The engine is signed in the Swift build with its own entitlements and Info.plist, shipped via `bundle.macOS.files` (copied without re-signing), and spawned with `tokio::process` from `noter-engine-client`; no window gets a shell permission; CI checks `codesign -d --entitlements` on both binaries.

### IPC and contract mechanics

- **R23** (BA4) The generated transport buffers Channel messages until the subscribing `invoke` resolves, then drops `seq ≤ last_seq` and delivers the rest in order. The fake sends its first message before the snapshot resolves to exercise this.
- **R24** (BA5) `stream_ack(StreamAckArgs { subscription_id, seq }) -> Ack` [App, Frozen, all windows] every 100 messages or 1 s; the hub ends a subscription with `ended { reason: lagged }` at 2 000 unacknowledged messages, and ends every subscription of a webview on page load or destroy.
- **R25** (BA6) Every whole-state event payload carries `version: u64` (monotonic per payload kind), also in the matching command results and snapshot slices; the UI keeps the highest.
- **R26** (BA7) IPC host: `AppManifest::commands` and one capability per window generated in `build.rs`; handlers take `args: serde_json::Value` and map parse errors to `invalid_input`; Tauri's denial string maps to `window_not_allowed` in the transport; parity tested with `tauri::test::mock_builder`. Contract test: every `Option` field of an argument type has `#[serde(default)]` (BA18).
- **R27** (BA12) Confirmed segments are published after their batch commits; batches ≤ 250 ms, so the confirmed-lag budget holds; snapshot reads use the writer connection under the hub lock.
- **R28** (TW3) Frozen = changes only additively in a minor version; anything else needs a major version both sides sign off (DC 3.3, `ipc/mod.rs`).
- **R29** (BA16) `CommandCtx.caller: Caller` = `window { label }` | `native { surface: menu | menu_bar | hotkey | notification }`; native callers skip the scope check and are recorded as the actor surface.
- **R30** (BA10) System Audio Recording permission cannot be queried; it is inferred: the self-test requires non-zero buffers; capture detects exact digital zeros. Engine event `permission_lost` → `system_audio_silent { confidence }`.

### Items, cards, copilot, product rules

- **R31** (PM4, TW22, QA12) Evidence closes **accepted** items only; suggested items get at most a proposal.
- **R32** (QA12, PM6) Item machine completed: `handed_off → done` (Yes, Landed; Done Another Way; or evidence), `handed_off` kept (Keep Open, asked again), `open → carried` when a call with the same people starts and the item is offered, `carried → open` after the call; new status `answered_in_call` (a question answered in a call, logged, Reopen). `HandoffLandedArgs { item_id, rev, answer: HandoffLandedAnswer }` = `landed | done_another_way | keep_open` (UI labels **Yes, Landed**, **Done Another Way**, **Keep Open**). Opening or copying a handoff accepts a suggested item. Carry-forward: one shared query (last two calls with the same people, open accepted items, "Not reviewed" mark for suggested ones) used by Today and the copilot's initial context.
- **R33** (QA11, PM13, AU4, AU5) Card machine completed (undo within 30 s; held → pinned/dismissed; streaming → removed when dropped late; expiry on topic change; queued while the stack is held). New `CardState::Queued`, `card_unpin(CardArgs) -> CardMutation` [Copilot, Draft, CallScreen], `CardEvent::KeyFeedback { key: u8, outcome: KeyOutcome, card_id: Option<CardId> }` (`pinned | dismissed | no_card`), `CardEvent::Expired { card_id, reason: ExpiryReason }` (`timeout | topic_changed`). Ranking: drop duplicates of cards shown in the last 10 min, cited first, unverified last.
- **R34** (PM9) Degrade per path: Context falls back to the raw past decision, Catch-up shows the last confirmed segments while waiting, Ask is skipped if the topic moved; solicited cards (Catch Me Up, Ask About This Call) are never dropped by the 12 s rule. The 12 s check applies before the first line; once the first line is shown the card is completed (QA30).
- **R35** (PM5) Nightly `JobKind::Retention`: deletes audio past `audio_retention_until` (logged, not undoable), live segments after 7 days, metrics after 365 days. A changed retention setting applies to existing calls from the next run; the Settings row says how many calls' audio the next run deletes.
- **R36** (PM7) per D3: `TodaySettings.ranking: TodayRanking` = `owed_to_todays_people` (default) | `due_then_owed_to_you`; `TodayView.ranking`.
- **R37** (PM8, TW2) Stale scope-cut text replaced: "Full v1 kept (owner decision 17 Oct); the copilot ships behind a flag until the M4 latency gate."
- **R38** (PM11) per D4, owned by the post-call pipeline.
- **R39** (PM12, QA29) "Used" detection in the copilot loop: a card is `used` when the user's mic transcript matches its question or answer within 2 min; thresholds tuned from ratings. `CardView.used: bool`.
- **R40** (AU15) `card_undo_last` has a 30 s window, then `undo_expired`.
- **R41** (PM14) `AgentStats.useful_share` over the last 20 calls.
- **R42** (PM17) per D5.
- **R43** (PM20) Screen context chips are v1.x: `context_chip_set` returns `feature_disabled` in v1; packet chips are empty in v1.
- **R44** (PM10, BA15) `item_reopen` allowed from CallScreen; `account_test` and `account_sign_out` allowed from FirstRun and Main.
- **R45** (QA24, AU22) `job_cancel(JobIdArgs) -> JobList` [SettingsAndCredentials, Frozen, Settings | Main]; `handoff_generate` returns `HandoffView` with state `generating` at once and finishes through `entity:changed`; `handoff_cancel(ItemIdArgs) -> HandoffView` [Handoff, Frozen, Main].

### Storage and measurement

- **R46** (QA17) Network-monitor test: macOS runner, engine in file mode, real CLIs with CI secrets, a recording proxy, checked-in `contracts/egress-hosts.json`, per-process attribution with `nettop`/`NEFilterDataProvider` logs; a release gate.
- **R47** (BA11) `chunk_vec` has no partition key; `call_id` and `started_at` are metadata columns; capacity re-derived (≈ 4.2 KB per chunk at 1024 dims, about 350 MB/year at 2 h of calls a day).
- **R48** (QA13) `metrics` gains `tick_id`, `llm_run_id`, `dropout_ms`; `card_shown` is stamped by the core for cards shown only in the menu bar or while hidden (at the menu-bar update) and for queued cards at release.
- **R49** (QA14, PM15) `handoff_open`/`handoff_copy` record `prompt_versions.id` and whether the prompt was edited; NFR rows added for correction rates, citation and proposal acceptance, memory, CPU and thermal state (sampled every 10 s during capture).

### Testing and the fake core

- **R50** (QA16) E2E as ADR-0003 sets it: Playwright against the real core through `noter-core-harness` over stdio from M0 (runs against the fake core do not count toward the E2E bar); the real-app flows through the WebdriverIO embedded driver on the Mac runner, because `tauri-driver` does not support WKWebView; native surfaces (menu bar, panels, notifications, hotkeys) are tested by XCUITest on the macOS runner, with the manual checklist in `docs/HARNESS.md` only for look and system dialogs (owner decision of 17 Oct 2026, which added the XCUITest layer to ADR-0003). The five critical stories of UI 3.6 are among the real-core flows.
- **R51** (QA15) Fixture parity: fixtures are seeded as database rows; the fake world is generated by running the real read models over them with an injected clock; compared fields are listed.
- **R52** (QA18, QA19, TW7) Fake core: `failNext` uses the generated `DEFAULT_RETRYABLE`; `capture_set_paused(false)` on a stopped call is refused; `job_run_now` blocked while a call is live; `capture_set_sensitive(false)` refused during capture; redo implemented; `fake.push(channel message)` and an event-emitting `setWorld`; handlers for every frozen command. DC L1183 wording for `not_implemented` fixed.

### Doc consistency (Tech Writer and others)

- **R53** egress gate lives in crate `noter-llm` (TW5); **R54** **Return to Call** → **Open Call Screen** (TW8); **R55** `capture_dismiss_detection` = Not Now, × or timed out (TW9); **R56** "Transcript upgraded" banner (TW10); **R57** stale "PRD to be synced" (TW11); **R58** 3.7 change lines completed, glossary `rev`, `speakers.pass` = `live | archive` (TW12–14); **R59** 3.4 crate graph and 1.3 layering aligned, sequences go through router and supervisor (TW15–17); **R60** `LevelsMsg` note, native-panel list, run MCP config name, DegradedState claim (TW18–21); **R61** `cpt-noter-interface-mcp-core-socket` → `cpt-noter-interface-mcp-tools` (TW23); **R62** implementation-order table moved out of DESIGN (TW24); **R63** ADR-0001 "one part-time builder" (TW25); **R64** PRD L100 skill library line removed (PM19); principle ordering: PRD principles outrank design principles (PM18); Integrations driver row (PM16).
- **R65** Remaining minors: `Lang::Other { code }` (AU16); export scope (AU17); the UI may write plain text to the clipboard (Copy with Citations, Copy Code, Copy Link, Copy as Prompt); the core writes rich formats (AU18); new meeting while hidden → menu bar line, menu start maps to `capture_answer_new_meeting(start_as_new_call)` (AU20); Claude plan detection → Open question Q8 (M3 spike) (AU21); account, outputs, hidden-mode notice transitions (QA22, 23, 25); UI states mapped to codes: `calendar_unavailable`, `tracker_unreachable`, `disk_full.needed_mb`, proposal conflict via `rev` on `ProposalDecideArgs` (QA28); contract tests check stability per name and handler parity from every window (QA27); tauri-nspanel pinned to a commit (BA19); the core runs the screen-share test (BA20); lag measured from engine timestamps, cost metric scoped to API-key runs (QA29).

## How it was applied

- **Contract:** `CONTRACT_VERSION` and `ENGINE_PROTOCOL_VERSION` went from 1.0 to 2.0, because frozen surfaces changed. There are 172 commands (145 frozen, 27 draft), 20 events and 66 error codes. The fake core answers all 172 commands.
- **Names that differ from the list above:**
  - `model_not_ready` was renamed `model_missing` rather than added as a second code.
  - `DashboardSettings` became `TodaySettings`, and the settings section `dashboard` became `today`.
  - `NewMeetingChoice::StartNewCall` became `StartAsNewCall`, and the notice gained `detected_at`.
  - `DismissReason::NotACall` became `Closed`.
  - `GapReason::SystemAudioLost` became `SystemAudioSilent`.
  - `AuditKind` is `run`, `tool_result` or `lookup`.
  - `CardKeySettings` lives at `CopilotSettings.card_keys`, next to the existing `dismiss_with_keys` (D70).
  - `AppSnapshot` carries the versioned `DetectionChanged`, `PresentingState`, `DegradedSet` and `BannerSet` instead of bare values.
  - `Lang::Other` is serialised untagged (`"en"` or `{"code":"fr"}`).
- **Engine stopped:** `CapturePhase::Failed`. **Try Again** is `capture_resume_interrupted`, which continues the same call with an `engine_restart` gap.
- **Documents:**
  - DESIGN-core is now v0.4.
  - DESIGN.md is now v1.1, with decision log rows PM-60 to PM-68.
  - PRD.md and its living copy carry the decision log rows of 17 Oct.
  - The clickable prototype was rebuilt.
- **Harness:** later the same day, PRD.md, DESIGN-core and DESIGN.md were aligned with the quality-gate harness (ADR-0003, `docs/HARNESS.md`): `just gate` and `just gate-fast`, the single required check `gate`, the owner's bars (unit coverage ≥ 80 %, E2E ≥ 60 % against the real core, screenshots ≥ 98 %, performance ≤ 10 % instruction-count regression with ≥ 60 % scenario coverage), FULL code traceability and the `just trace` ratchet, and `harness/milestones.toml` as the placement of every command and story. The owner then restored automated tests for native surfaces: XCUITest on the macOS runner (`just native`), counted toward the E2E bar, with the manual checklist only for look and system dialogs.
