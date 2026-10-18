# Plan: real-core E2E for M0 (`cpt-noter-feature-core-harness`)

Owner: be-e2e (backend team). Status: plan, no product code yet. Date: 2026-10-18.
Sources: `docs/features/core/core-harness.md`, `docs/HARNESS.md` › noter-core-harness wire format, `docs/TEST-PLAN.md` › The scenario layer, `apps/desktop/tests/support/{core,scenario,stdio-transport,record-setup}.ts`, `scripts/harness/e2e_coverage.py`, `harness/milestones.toml` [M0].

## 1. What counts, and the bar

- `e2e_coverage.py` counts only logs with `target != "fake"`: commands that **succeeded** through the recording transport (`coverage/e2e/commands-*.json`) and story IDs in the titles of **passing** Vitest/Playwright tests. Rust tests in `crates/` that name a story only show up as "named but not proven"; they never count.
- So every M0 command and story must be reached by `pnpm test:conformance` or `pnpm test:e2e` with `NOTER_CORE=stdio` (the `just e2e` recipe already runs both when `NOTER_CORE_CMD` is set).
- M0 is 22 commands (all frozen) and 3 stories. Gate: ≥ 60 %, so at least 14 commands and 2 stories. Target: 22 and 3.
- `harness.toml [milestone].current` is `pre-M0`, so the gate counts nothing yet. But once CI builds the crate and sets `NOTER_CORE_CMD`, **every** conformance and E2E test runs against the real core and must pass. That ordering problem is settled in §8 Q1: P5 merges before P4.

## 2. Crate layout (`crates/noter-core-harness`, core lane)

```
crates/noter-core-harness/
  Cargo.toml          publish = false; deps: noter-core (feature "harness"), noter-protocol, tokio, serde_json
  src/main.rs         flags → harness::run(stdin, stdout, opts) → exit code; nothing else
  src/lib.rs          run(), serve<C: CoreApi>(core, reader, writer) — generic so wire tests use a stub core
  src/wire.rs         Request / out-line types, line parse, one writer task (mpsc) so lines never interleave
  src/dispatch.rs     per-request task: fail_next check → noter_protocol dispatch → result line → held channel lines
  src/controls.rs     harness.world_get / world_set / fail_next / push (TEST-PLAN › Scenario controls)
  src/scripted.rs     scripted engine (in-process duplex), native, model source, updater, shortcuts, clock
  tests/wire.rs       in-process wire tests over tokio::io::duplex (fast, counted by cargo-llvm-cov)
  tests/process.rs    the few that need a real process (exit code, stderr, stdout purity) via CARGO_BIN_EXE
```

- Root `Cargo.toml`: add the member (core lane may edit it).
- Flags, M0 only: `--fixture world` and `--clock fixed`. Not built in M0: `--engine-script <file>` (golden-set replay comes in M1) and the scripted runtime (from M2, per the spec).
- Logs go to stderr through `eprintln!`/`tracing` with a stderr writer. stdout is owned by the writer task alone.
- Markers on the line before the code: `cpt-noter-flow-core-harness-session`, `cpt-noter-algo-core-harness-boot`, `cpt-noter-algo-core-harness-dispatch`, `cpt-noter-algo-core-harness-scripted-engine`, `cpt-noter-state-core-harness-process`, `cpt-noter-dod-core-harness-{wire,fixture,conformance}`.

### Dispatch, ordering and concurrency

1. The reader loop parses each line and spawns one task per request, because the TS transport keeps several requests in flight and streams keep running after their result.
2. Every output goes through one `mpsc<String>` to one writer task. That is the only `stdout` handle.
3. For `channel: true` the task creates a `Sink<Value>` that pushes into a per-request buffer (`Mutex<Option<Vec<Value>>>`). After the result line is queued, the buffer is drained into the writer **and** the sink switched to direct sends under the sink's own lock, so a message sent meanwhile can neither be lost nor overtake the buffered ones. On an error result the buffered messages are dropped. This gives "channel messages after the result, in `seq` order" (AC2) even when the core sends during the call.
4. The core's `EventEmitter` writes `{"event", "payload"}` through the same writer.
5. When stdin reaches EOF: `Core::shutdown()` ends every stream with `shutdown`, the writer drains, and the process exits 0.
6. Unparsable line: reply `{"id": <id or null>, "error": {code: "invalid_input", …}}` and keep reading. Unknown `cmd`: `invalid_input` too. The scope check runs before argument parsing, as the IPC host does.

## 3. `--fixture world`: how the world gets into the core

- Use `noter_protocol::fixtures::world()` directly. `contracts/fixtures/world.json` is exported from that same function, and `just contract` (`noter-contract-export --check`) already fails when the two differ, so no harness test is needed for parity. This also avoids resolving a JSON path from whatever cwd Playwright starts us in.
- Boot (`cpt-noter-algo-core-harness-boot`): make a temp dir (database plus App Group stand-in with `models/`), then `noter_core::Core::open(dir, deps)`, which opens the store and runs migrations. Then `testing::apply_world(&core, &world)`. A failure prints the reason to stderr and exits 1 before reading stdin.
- `apply_world` splits the `FakeWorld` by owner. The same function serves boot and `harness.world_set`:

| FakeWorld slice (M0) | Goes to | Mechanism |
| --- | --- | --- |
| `settings` (all sections, `rev`) | core storage | settings write path (change log) |
| `hotkeys` | core storage + `ScriptedShortcuts` | stored bindings; the scripted registrar learns which chords other apps hold |
| `glossary` | core storage | glossary write path |
| `app.setup` steps, call display, audio storage, self-test result | core storage | setup section write path |
| `app.setup` model bundles | temp `models/` + `ScriptedModelSource` | `ready` writes a file with the right checksum; `pending` removes it; `downloading` starts a fetch held open by the source; `checksum_failed` serves corrupt bytes once |
| `app.setup.permissions` and `app.environment.permissions` (`W.permission` writes both) | `ScriptedNative` | one table per kind; `request(kind)` returns `granted` for `not_asked` and the stored state otherwise (`denied`, `needs_relaunch`); changing a row fires the native change callback, so the core re-reads it and emits `setup:changed` itself |
| rest of `app.environment` (online, disk, displays, output route) | `ScriptedNative` | same change callback, so `env:changed` comes from the core |
| `app.environment.update`, `update_ready` banner | `ScriptedUpdater` | `ready()` returns the update; `install()` records it and returns. The harness process does not exit: restarting is the app's job |
| `app.banners` | core (ipc-host banner set) | banner write path |
| `now` | `Clock` | `--clock fixed` pins `now()` to `world.now` |
| everything else (calls, transcripts, items, copilot, …) | not owned in M0 | see below |

- Derived fields (`setup.complete`, `setup.detection_enabled`, `models.done_mb`) are recomputed by the core, never written. If they disagree with the world after the apply, `world_set` answers `invalid_input` naming the field, so a preset that drifts from the core's rules fails loudly.
- `harness.world_get` returns the real read models for owned slices. For slices that the snapshot exposes but no M0 service writes, it returns what the snapshot says. For every other slice it returns the last value it accepted. `world_set(world_get())` is therefore a no-op that emits nothing.
- Divergence from the fake in M0: the real snapshot has `capture` idle and no `detection`, because nothing in M0 can seed the fixture's live recording of `call_live`. `W.idle` and `W.firstRun` still pass, because the diff compares slices by value and their result equals what the core reports. Tests that need the live call are M1 and tolerate it through `ahead()` (§8 Q1).
- `harness.world_set` diffs against the last world. An owned slice that changed is applied, and its owner emits the whole-state event with a new version. An unowned slice that changed is answered `not_implemented` with the slice name and its milestone in `message`.
- `harness.fail_next`: a `(window, cmd) → CoreError` table checked in `dispatch.rs` before the core is called, used once. It needs no core seam.
- `harness.push { cmd, body }`: routed to the scripted engine. For `self_test_run` it emits the matching engine event, so the message goes through the real supervisor and the real stream hub to the newest open Channel, which returns `{ seq }` (or `{ seq: null }` when no Channel is open).

### Scripted engine (`cpt-noter-algo-core-harness-scripted-engine`)

It is in-process. `ScriptedLauncher::launch()` returns the two halves of a `tokio::io::duplex`. A task on the other end answers `ready` (current `ENGINE_PROTOCOL_VERSION`), `ack`s every command, and plays a built-in section per command. For M0 that is `self_test`: line events, then `result passed`, and `ping`/`pong`. It also emits whatever `harness.push` injects. The real `noter-engine-client` supervisor (version check, `seq` gaps, ack correlation) stays in the path.

## 4. Wire-format tests I write first (`crates/noter-core-harness/tests/`)

All in-process tests run against a stub `CoreApi` (a handful of methods; everything else is a default `not_implemented`, see S2). That way they can land before `noter-core` exists. Each moves to the real core when §6 P4 lands.

| # | Test (Rust name) | Proves |
| --- | --- | --- |
| W1 | `app_snapshot_from_main_returns_ok_line` | `{id, ok}` with `window: "main"` (AC1) |
| W2 | `settings_only_command_from_call_screen_is_window_not_allowed` | `hotkeys_list` from `call-screen` → `window_not_allowed` (AC1) |
| W3 | `scope_is_checked_before_arguments` | `hotkey_set` with junk args from `call-screen` → `window_not_allowed`, not `invalid_input` |
| W4 | `unparsable_line_is_invalid_input_and_serving_continues` | the error line has `id` or `null`, and the next request is answered |
| W5 | `unknown_command_is_invalid_input` | no crash, typed error |
| W6 | `channel_messages_follow_result_in_seq_order` | the stub sends 3 messages before returning, and they arrive after `{id, ok}` (AC2) |
| W7 | `core_events_become_event_lines` | `{event, payload}` |
| W8 | `concurrent_requests_are_answered_by_id` | two requests in flight; the slow one does not block the fast one |
| W9 | `eof_ends_streams_with_shutdown_and_exits_zero` (process) | AC3 |
| W10 | `stdout_holds_only_protocol_lines` (process) | every stdout line parses as one of the five shapes; logs are on stderr (AC3) |
| W11 | `bad_fixture_exits_nonzero_before_reading` (process) | `--fixture nope` → exit ≠ 0, reason on stderr |
| W12 | `fail_next_fails_once` | control: the next call fails, the one after succeeds |
| W13 | `world_get_then_set_is_a_no_op` | no event lines |
| W14 | `world_set_settings_emits_settings_changed_with_higher_version`, `world_set_unowned_slice_is_not_implemented` | control semantics (real core, P4) |
| W15 | `push_reaches_newest_self_test_channel` | `{seq}`; `{seq: null}` with no Channel open (real core, P4) |

## 5. The 22 M0 commands and 3 M0 stories → covering real-core test

The "Status today" column says whether the test, run with `NOTER_CORE=stdio`, uses only M0 commands and controls (**clean**), or still calls a later command (**blocked**, with the fix).

### Commands

| # | Command | Owner FEATURE | Covering real-core test | Status today |
| --- | --- | --- | --- | --- |
| 1 | `app_snapshot` | ipc-host | `conformance/snapshot-stream.test.ts` › "%s gets a snapshot for itself…" (5 windows) | clean |
| 2 | `stream_unsubscribe` | ipc-host | **new** `conformance/m0-core.test.ts` › "self-test stream: seq from 1, stream_ack, stream_unsubscribe ends it" | new (the existing uses are on M1 `levels_subscribe`) |
| 3 | `stream_ack` | ipc-host | same new test | new |
| 4 | `banner_dismiss` | ipc-host | `m0-m1-rules.test.ts` › "banner_dismiss removes the interrupted-recording banner without resuming", plus **new** `m0-core` › "update_ready banner dismissed" | clean if `apply_world` writes `app.banners`; the new test is clean either way |
| 5 | `log_ui` | ipc-host | `m0-m1-rules.test.ts` › "log_ui accepts a UI error without transcript text" | clean |
| 6 | `setup_status` | first-run | `e2e/m0-first-run.spec.ts` (all 11), `m0-m1-rules` › "self-test: messages in seq order…" | clean |
| 7 | `models_download` | first-run | `m0-first-run.spec.ts` › download-models (5 tests); `m0-m1-rules` › "environment refusals…" (offline) | clean (needs ScriptedModelSource) |
| 8 | `permission_request` | first-run | `m0-first-run.spec.ts` › complete-setup happy / microphone / system audio | blocked: `levels_subscribe`, `open_external` (M1), see U1 |
| 9 | `self_test_run` | first-run (+engine-foundation) | `m0-m1-rules` › "self-test: messages in seq order…"; `m0-first-run` › "Self-test hears only one stream" (push) | clean (needs the scripted engine) |
| 10 | `setup_set_call_display` | first-run | `m0-first-run.spec.ts` › "other path — Finish the remaining steps…" | clean |
| 11 | `setup_set_audio_storage` | first-run | same | clean |
| 12 | `setup_set_step` | first-run | same; `m0-first-run` › "Self-test skipped" | clean |
| 13 | `settings_get` | settings | `m0-settings-hotkeys.spec.ts`, `m0-m1-rules` glossary/whole-state | clean |
| 14 | `settings_update` | settings | **new** `m0-core` › "settings_update replaces one section with rev; stale rev is conflict; settings:changed grows" | new (the existing whole-state test also calls M1 commands) |
| 15 | `settings_unignore_app` | settings | **new** `m0-core` › "settings_unignore_app removes Spotify from ignored apps" | new (no test today) |
| 16 | `hotkeys_list` | settings | `m0-settings-hotkeys.spec.ts` (all 5) | clean |
| 17 | `hotkey_set` | settings | `m0-settings-hotkeys.spec.ts` › happy path, without modifier | clean |
| 18 | `hotkeys_reset` | settings | **new** `m0-core` › "hotkeys_reset restores the nine defaults; hotkeys:changed grows" | new (the existing use is in the mixed whole-state test) |
| 19 | `glossary_list` | settings | `m0-m1-rules` › "glossary: list, add, rename with rev…" | clean |
| 20 | `glossary_upsert` | settings | same | clean |
| 21 | `glossary_remove` | settings | same | clean |
| 22 | `update_install` | first-run | `m0-m1-rules` › "environment refusals: offline and not_ready…" | clean (needs ScriptedUpdater) |

Wire-level smoke for all 22: `scope-and-errors.test.ts` covers the scope of every command and "typed errors, never crashes". The empty-args calls that succeed (for example `app_snapshot`, `setup_status`, `settings_get`, `hotkeys_list`, `glossary_list`) are recorded there too.

New file `apps/desktop/tests/conformance/m0-core.test.ts` (contract lane, mine) uses **only** M0 commands. Besides the tests above it adds "window scope with valid arguments" for the M0 cases (`hotkey_set` from main, `settings_update` from main, `setup_set_audio_storage` from settings, `banner_dismiss` from call-screen, `models_download` from main). It checks "nothing changes" with `app_snapshot` and `hotkeys_list` only, and adds "whole-state versions grow" for `setup:changed`, `settings:changed` and `hotkeys:changed`.

### Stories

| Story | Covering tests (titles name the ID) | Real-core status | Needs |
| --- | --- | --- | --- |
| `cpt-noter-seq-first-run-complete-setup` | `e2e/m0-first-run.spec.ts` › 6 tests | clean: "other path", "Self-test hears only one stream", "Self-test skipped". Blocked: happy, microphone and system-audio paths (`levels_subscribe`, `open_external`, M1) | **UI team U1** |
| `cpt-noter-seq-first-run-download-models` | `e2e/m0-first-run.spec.ts` › 5 tests | all clean | ScriptedModelSource; "Not enough disk space" uses `failNext` (works, but bypasses the real disk check, see U2) |
| `cpt-noter-seq-settings-set-hotkeys` | `e2e/m0-settings-hotkeys.spec.ts` › 5 tests | clean except "Card key used by another app": it needs the `copilot` slice and the `copilot:status` event, which no M0 service owns | tolerate through `ahead()` (§8 Q2) |

UI team asks (UI lane: `apps/desktop/tests/e2e/**`, `tests/support/**`):

- **U1**: in `m0-first-run.spec.ts`, wrap `levelsSubscribe` and `openExternal` in `ahead()` in the three blocked tests. DECOMPOSITION-core §1 item 3 already says the M0 first-run levels come from the self-test Channel and those commands don't count in M0. The assertions on the meter then apply only when the step ran.
- **U2** (optional): "Not enough disk space" could set `w.app.environment.disk_free_mb` instead of `failNext`, so the real disk check is proven. The test works as is.
- **U3**: `scenario.ts` `StdioScenario.transport` ignores `fresh` (`reopen`). That is fine for M0 (no story reopens a window). For M1 we need a `harness.webview_reset { window }` control that calls the hub's webview reset.

## 6. Order of work (my PRs)

| PR | Branch | Content | Waits for |
| --- | --- | --- | --- |
| P1 | `lane/core/harness-plan` | this plan (docs) | — |
| P2 | `lane/contract/coreapi-dispatch` (**be-eng-2**) | S1, S2 below | — |
| P3 | `lane/core/harness-wire` | crate, `main`, `lib::serve<C>`, wire + process tests W1–W11 on a stub core | P2 |
| P4 | `lane/core/harness-boot` | `Core::open`, `apply_world`, controls, scripted seams, W12–W15 on the real core | be-eng-1: S3–S6, the per-slice write paths, and the S7–S10 traits as each M0 feature lands |
| P5 | `lane/contract/…` (my next task) | existing conformance files tolerant through `ahead()`, plus the new `conformance/m0-core.test.ts` | none; it **merges before P4** |
| P6 | as each M0 feature lands | flip its rows in §5 to green under `NOTER_CORE=stdio` locally: `NOTER_CORE=stdio NOTER_CORE_CMD="target/debug/noter-core-harness --fixture world" pnpm --dir apps/desktop test:conformance` (and `test:e2e`) | the feature, U1 |

## 7. Seams I need

### From the contract lane (`noter-protocol`)

- **S1** A generated JSON dispatcher next to `CoreApi` in `commands!`:
  `pub async fn dispatch_json<C: CoreApi>(core: &C, ctx: &CommandCtx, cmd: &str, args: serde_json::Value, channel: Option<Sink<serde_json::Value>>) -> Result<serde_json::Value, CoreError>`.
  It does the lookup in `COMMANDS` (unknown → `invalid_input`), the scope check for `Caller::Window` (→ `window_not_allowed`), runs before `from_value` (failure → `invalid_input`), adapts `Sink<Value>` to the typed `Sink<T>`, then `to_value`. `src-tauri` and the harness then share one scope check and one parse path, so handler parity holds by construction. It also implements `cpt-noter-algo-core-ipc-host-scope-check` in one place.
- **S2** Default method bodies on `CoreApi` that return `not_implemented`, so `noter-core` writes only what it answers and the harness wire tests use a 5-method stub. The IPC host spec already wants "unanswered ones return `not_implemented` until their milestone".

### From be-eng-1 (`noter-core`, ipc-host + storage + settings + first-run)

- **S3** `noter_core::Core`, the concrete `CoreApi` implementation. Built with `Core::open(data_dir: &Path, deps: CoreDeps) -> Result<Core, BootError>`, the same call `src-tauri` makes. `BootError: Display` (it goes to stderr).
- **S4** `pub struct CoreDeps { clock: Arc<dyn Clock>, events: Arc<dyn EventEmitter>, engine: Arc<dyn EngineLauncher>, native: Arc<dyn NativeServices>, models: Arc<dyn ModelSource>, updater: Arc<dyn Updater>, shortcuts: Arc<dyn ShortcutRegistrar> }`. The runtime is added in M2.
- **S5** `trait Clock: Send + Sync { fn now(&self) -> TimestampMs; }` and `trait EventEmitter: Send + Sync { fn emit(&self, event: &'static str, payload: serde_json::Value); }`, with event names from `EVENTS`.
- **S6** `Core::shutdown(&self) -> impl Future<Output = ()>`: ends every stream with `shutdown` and drains the writer. The same path serves `update_install` and app quit.
- **S7** `trait NativeServices: Send + Sync`:
  - `permission(kind) -> PermissionState`
  - `request_permission(kind) -> impl Future<Output = PermissionState>`
  - `environment() -> EnvironmentReading` (displays, output route, online, `disk_free_mb`, notification authorization)
  - `on_change(Box<dyn Fn(NativeChange) + Send + Sync>)`
  - `set_login_item(bool) -> Result<(), CoreError>`

  `noter-native` (engine lane) implements it for real.
- **S8** `trait ModelSource: Send + Sync { fn manifest(&self) -> Vec<BundleSpec>; fn fetch(&self, bundle: &str, from_byte: u64) -> impl Future<Output = Result<ByteStream, FetchError>>; }`. The manifest must be injectable so the harness serves tiny bundles. Offline and disk come from S7.
- **S9** `trait Updater: Send + Sync { fn ready(&self) -> Option<UpdateInfo>; fn install(&self) -> impl Future<Output = Result<(), CoreError>>; }`. The real one is `tauri-plugin-updater` in `src-tauri`.
- **S10** `trait ShortcutRegistrar: Send + Sync { fn register(&self, chord: &str) -> Result<(), ShortcutTaken /* { owner } */>; fn unregister(&self, chord: &str); }`. The real one is the Tauri global-shortcut plugin. Reserved chords such as VoiceOver's stay core logic.
- **S11** Cargo feature `harness` on `noter-core`, which must never be on in `src-tauri` (I will ask the owner for an arch check that `src-tauri`'s dependency on `noter-core` has no `harness` feature). Behind it I write `noter_core::testing::{apply_world, world_slices}` myself (core lane). What I need from be-eng-1 is the per-slice write functions (settings section, hotkey bindings, glossary term, setup section, banner set) public to the crate, plus their read models.

### From the engine lane (`noter-engine-client`)

- **S12** `trait EngineLauncher: Send + Sync { fn launch(&self) -> impl Future<Output = io::Result<EngineIo>>; }` with `EngineIo { stdin: Box<dyn AsyncWrite + Unpin + Send>, stdout: Box<dyn AsyncRead + Unpin + Send> }`. The real launcher uses `tokio::process`. The scripted one returns a `tokio::io::duplex` pair, so the supervisor itself is under test.

(Traits held as `Arc<dyn …>` need object-safe methods. Where a method returns `impl Future`, the implementer uses a boxed future or `async_trait`. That is be-eng-1's call; the shape above is what the harness needs.)

## 8. Decisions (Backend Teamlead, 2026-10-18)

- **Q1, later-milestone commands under `NOTER_CORE=stdio`**: no runtime skip. Tests use the existing `ahead()` (`apps/desktop/tests/support/results.ts`), which gives `null` on `not_implemented`. I make the conformance files real-core-ready with `ahead()` in my next task (contract lane). The UI team gets the Playwright specs, including U1, through the Teamlead. **The harness crate PR (P4) must not merge before conformance is tolerant**, or CI goes red.
- **Q2, card keys**: they are copilot (M4); there is no scope move. The "Card key used by another app" test must tolerate `not_implemented` and a missing `copilot:status` through `ahead()`. The story still counts through its other four tests. So `harness.world_set` answers `not_implemented` for the `copilot` slice in M0, as §3 says.
- **Q3, contract seams**: S1/S2 belong to be-eng-2 (already on `lane/contract/coreapi-dispatch`); I don't duplicate them. S3–S11 go to be-eng-1 with the ipc-host task. They match the Teamlead's decision D1: a Platform seam split into `NativeServices`, `ModelSource`, `Updater` and `ShortcutRegistrar`, with the scripted implementations in the harness.
