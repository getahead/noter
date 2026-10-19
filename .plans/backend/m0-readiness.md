# be-pm — M0 spec readiness review

Reviewed at `origin/main` d3a414c, 2026-10-18. This is a read-only review: nothing was committed or pushed.
Targets: the 7 M0 FEATURE specs in `docs/features/core/` and DECOMPOSITION-core §1–§3. I checked each against `docs/PRD.md`, `docs/DESIGN-core.md`, `docs/HARNESS.md`, `harness/milestones.toml`, `harness/perf.toml`, `contracts/ipc.manifest.json`, `contracts/engine.schema.json` and the `noter-protocol` types.

**Verdict: 4 BLOCKING, 23 NON-BLOCKING.** With B1–B4 open, the M0 E2E gate cannot reach 60% on stories. It needs at least 2 of the 3 M0 stories to pass against the real core over stdio on `ubuntu-24.04`. Today none of the 3 can. The M0 perf-coverage gate also cannot pass: 1 of 3 entries is covered, so 33% against a 60% bar.

---

## 0. BLOCKING items (summary)

| # | Item | Spec line it breaks | Owner of the fix |
|---|------|---------------------|------------------|
| B1 | No platform seam in `noter-core` for what lives in `src-tauri`/`noter-native`: permissions, environment and displays, the global-shortcut registrar, SMAppService, the updater and the model-download source. Without it, `noter-core-harness` cannot serve the M0 first-run and hotkey stories on the Linux E2E job. | core-harness §1.3 and `cpt-noter-algo-core-harness-boot` `inst-inject` (scripted engine, runtime and clock only), against core-first-run §6 AC1/AC2 ("scripted download source in the harness", "permissions requested") and core-settings §6 AC1 (set-hotkeys E2E against the real core) | Teamlead: give the seam to one spec (core-harness is my suggestion) |
| B2 | `harness/perf.toml` has registry entries `core-app-snapshot` and `core-cold-start` (M0) but no `[scenarios.core_app_snapshot]` or `[scenarios.core_cold_start]`. Lanes cannot add them. | `cpt-noter-dod-core-ipc-host-snapshot` ("the `core_app_snapshot` perf scenario is built and measured"), `cpt-noter-dod-core-storage-cold-start`; harness.toml perf coverage ≥ 60% | Owner (harness file) |
| B3 | No spec says where setup state that has no `Settings` section is stored: step states, `SelfTestState`, model bundle states, hotkey bindings. No spec says whether writing it bumps the single settings `rev`. Settings and first-run are built in parallel and both write this table. | DESIGN-core `cpt-noter-dbtable-settings` (key = "section name, plus `rev` and `account.*`"); core-first-run `inst-store-result`, `inst-write-choice`; core-settings `inst-store-binding`, `inst-write-defaults` | Teamlead decision (DESIGN-core wording is owner work) |
| B4 | The scripted engine is needed in M0, but HARNESS.md schedules it for M1. No dependency exists from core-harness to core-engine-foundation, and the seam it plugs into is in `noter-engine-client` (engine lane). The `cpt-noter-seq-first-run-complete-setup` self-test cannot run against the real core without it. | HARNESS.md "What comes next" (M1: "scripted engine and golden-set replay through file mode"); DECOMPOSITION-core §3 (harness ← contract + ipc-host only); `cpt-noter-algo-core-harness-scripted-engine`; core-first-run §6 AC2 ("self-test passes with the scripted engine") | Teamlead (dependency, lane split); owner (HARNESS.md row) |

The details and recommendations for each are in §2.

---

## 1. Delivery map: 22 M0 commands and 3 M0 stories

Source: `harness/milestones.toml [M0]`. All 22 commands are `frozen` in `contracts/ipc.manifest.json`. Each command and each story is placed exactly once.

| FEATURE spec | Commands it must deliver | Stories it must deliver | Other M0 deliverables |
|---|---|---|---|
| core-contract (contract lane) | none (contract only) | none | `CoreApi`/`CommandCtx`/`Caller`/`Sink` fit; contract tests; conformance with `NOTER_CORE=fake` and `stdio` |
| core-storage (core) | none (under every write) | none | `noter-db`, migrations, change-log write path; perf `core_cold_start` (with ipc-host) |
| core-ipc-host (core) | **5**: `app_snapshot`, `stream_unsubscribe`, `stream_ack`, `banner_dismiss`, `log_ui` | none (all of them run through it) | DESIGN-core seq `cpt-noter-seq-core-window-open`; handler-parity test; log-scrub test; perf `core_app_snapshot` |
| core-harness (core) | none (makes all 22 countable) | none (makes all 3 countable) | binary `noter-core-harness`, wire format, `--fixture world`, scripted seams |
| core-settings (core) | **9**: `settings_get`, `settings_update`, `settings_unignore_app`, `hotkeys_list`, `hotkey_set`, `hotkeys_reset`, `glossary_list`, `glossary_upsert`, `glossary_remove` | **1**: `cpt-noter-seq-settings-set-hotkeys` | events `settings:changed`, `hotkeys:changed` |
| core-engine-foundation (engine) | none (engine half of `self_test_run`) | none (engine half of complete-setup) | week-one spike (Q4, streaming policy); `noter-engine-client`; signed, offline engine |
| core-first-run (core + engine, 2 PRs) | **8**: `setup_status`, `models_download`, `permission_request`, `self_test_run`, `setup_set_call_display`, `setup_set_audio_storage`, `setup_set_step`, `update_install` | **2**: `cpt-noter-seq-first-run-complete-setup`, `cpt-noter-seq-first-run-download-models` | events `setup:changed`, `env:changed` |
| **Total** | **5 + 9 + 8 = 22** ✔ | **1 + 2 = 3** ✔ | |

Gate arithmetic: 60% of 22 means at least 14 commands invoked in passing real-core E2E runs. 60% of 3 stories means at least 2 stories. The specs' acceptance criteria ask for all 22 and all 3, which is above the bar and is fine.

What each story needs from the harness:

- `settings-set-hotkeys` needs a scripted shortcut registrar (B1).
- `first-run-download-models` needs a scripted download source (B1).
- `first-run-complete-setup` needs scripted permissions and displays (B1) and the scripted engine for `self_test` (B4).

**DECOMPOSITION §1 Discrepancy 3:** `levels_subscribe`, `open_external` and `window_navigate` are M1, and QA must not count them in M0. First-run levels come from the `SelfTestMsg` Channel. This matches the specs (core-first-run `inst-map-events`; the `open_external` mention is marked M1).

---

## 2. Findings per spec

### 2.1 core-contract

- **NON-BLOCKING C1 (stale text).** §1.1 says the "fake core answers every command". That is true. The manifest has 172 commands, 20 events and 66 error codes, which matches the spec. Draft surfaces are the copilot, agents and performance groups, `storage_move` and `copilot:status`, which matches `inst-check-stability`. No action.
- **NON-BLOCKING C2.** `cpt-noter-flow-core-contract-conformance` `inst-if-later` records commands as pending "until their milestone is current". `harness.toml [milestone].current = "pre-M0"`, and its own comment says it is "advanced by the owner when a milestone gate passes". So during all of M0 the stdio conformance run treats every M0 `not_implemented` as pending: nothing forces progress until the owner flips the milestone. Recommendation: the Teamlead asks the owner to say when `current` becomes `M0`, at the start of the gate attempt or after it passes. That decides when a missing M0 command starts failing CI.
- **NON-BLOCKING C3.** core-ipc-host `cpt-noter-flow-core-ipc-host-command` maps "Tauri's own capability check denies it" to `window_not_allowed`. Tauri rejects before the handler runs, with its own error string, so only the generated transport (`bindings.ts`, contract lane) can map it. core-contract has no step for this. Recommendation: add it to `cpt-noter-dod-core-contract-coreapi` or the conformance "typed errors" group, so the mapping has an owner.

### 2.2 core-storage

- **NON-BLOCKING S1 (contradiction).** In the contract, `Caller::Native` says "the change log records the surface as the actor's surface". In core-ipc-host, `inst-return-native` says "record the surface as the actor surface". But DESIGN-core `cpt-noter-dbtable-changes` has no column for it: `actor` is `you` / `job:<id>` / `llm_run:<id>`. `cpt-noter-algo-core-storage-change-tx` doesn't list it as an input either. Recommendation: actor `you` plus a nullable `surface` column (menu, menu_bar, hotkey, notification) in the first `noter-db` migration. Ask the owner to add it to DESIGN-core. No contract change is needed.
- **NON-BLOCKING S2 (unverifiable at M0).** `cpt-noter-dod-core-storage-change-log` and AC3 say "a test writes through every write entry point of M0 **and M1**". M1 entry points do not exist when M0 closes. Recommendation: reword to "every M0 entry point; each M1 feature extends the same test". Otherwise the M0 box cannot be honestly checked.
- **NON-BLOCKING S3.** On a failed quick_check, the store is `failed` and "commands answer `internal`". No spec says whether a banner or degraded entry tells the user. M5 owns recovery. Acceptable for M0, but note that `app_snapshot` will also fail, so the UI shows nothing at all. Recommendation: `app_snapshot` still answers, with a default snapshot and a degraded flag, if the contract has a suitable `DegradedReason`. Otherwise leave it as is and say so in the spec.
- Naming is fine: the perf registry id is `core-cold-start` and the scenario is `core_cold_start`. Both names appear in the spec, and both are correct for what they name.

### 2.3 core-ipc-host

- **BLOCKING B2** (above). `core_app_snapshot` and `core_cold_start` exist only as registry entries. Exact change wanted from the owner: add `[scenarios.core_app_snapshot]` and `[scenarios.core_cold_start]` to `harness/perf.toml`, each with `build`, `run` and `modes = ["ir", "wall"]`, in the same form as `[scenarios.protocol_fixtures_roundtrip]`. The core lane supplies the bench binaries it points at, for example `cargo build --release -p noter-core --example perf_app_snapshot` / `perf_cold_start`, and must name them first.
- **NON-BLOCKING I1 (only one Channel in M0).** The only M0 subscribing command is `self_test_run` (Channel `SelfTestMsg`, a one-off stream of about 10 s). AC2 needs a message before the snapshot resolves, against the real core. AC3 needs `lagged` at 2 000. AC4 needs `stream_ack` and `stream_unsubscribe` in E2E. All of these must be done with `self_test_run` and the scripted engine (B4). A 2 000-message lag test does not fit a 10 s self-test. Recommendation: prove lag and reload in hub unit tests with a test stream kind, and prove ordering and ack/unsubscribe in E2E with `self_test_run`. State this in §6 so QA does not expect a lag E2E.
- **NON-BLOCKING I2.** The replay-buffer size is "bounded" with no number, in both the spec and DESIGN-core 3.2 stream hub. Recommendation: pick the same 2 000 as the lag limit and write it down.
- **NON-BLOCKING I3.** `inst-end-resume-offer` (`RecordingInterruptedByQuit`) depends on the M1 session manager. Fine as written ("once it exists, M1"). Make sure the M0 code does not grow a fake resume-offer.

### 2.4 core-harness

- **BLOCKING B1 (missing platform seam).** DESIGN-core puts permissions, `EnvironmentState` readings (displays, output route, notification auth, reachability, disk), the SMAppService login item, notifications and hotkey registration in `src-tauri` + `noter-native` (DESIGN-core 3.2 native component; 3.4 says "`noter-native` … used by `src-tauri`"). The E2E job that counts real-core runs is `ubuntu-24.04` (`.github/workflows/ci.yml`, job at line 121; it builds `noter-core-harness` there). So `noter-core` cannot call `noter-native` directly. It needs a trait that `src-tauri` implements with `noter-native` and the harness implements with a script. The harness spec injects only "the clock, the scripted engine and the scripted runtime" (`inst-inject`), and no spec owns this seam.
  - Effect: `permission_request`, `setup_set_call_display` (displays), `update_install`, `models_download` (network source), `hotkey_set`/`hotkeys_reset` (registrar) and both first-run stories plus set-hotkeys cannot run against the real core.
  - Recommendation: add to core-harness, or to core-first-run as a core-lane piece, a `Platform` seam in `noter-core`. It covers: permission ask and state, environment snapshot and change notices, shortcut register/unregister (returning accepted, conflict with owner, or reserved), login item, the updater (ready, install), and the download fetcher. There is a scripted implementation in the harness and the real one in `src-tauri` (core lane) over `noter-native` (engine lane). Add `inst-inject` steps and a DoD line to core-harness, and a dependency first-run → harness seam.
- **BLOCKING B4 (scripted engine timing and ownership).** HARNESS.md "What comes next" puts "scripted engine and golden-set replay through file mode" in **M1**, and DECOMPOSITION §3 makes core-harness depend only on contract and ipc-host. But core-first-run AC2 needs "the self-test passes with the scripted engine" in M0, and `cpt-noter-algo-core-harness-scripted-engine` exists in the M0 harness spec. The supervisor is in `noter-engine-client`, which belongs to the engine lane. For an in-process scripted engine, it must expose a transport seam (for example `EngineClient::with_io(AsyncRead, AsyncWrite)`) or accept a stand-in executable via `NOTER_ENGINE_PATH`.
  - Recommendation: make the scripted engine M0 scope, limited to `ready`/`ack`/`self_test*`; golden-set replay stays M1. Add the dependency `core-harness → core-engine-foundation` (supervisor seam only) to DECOMPOSITION §3. Ask the owner to change the HARNESS.md M0 row to include "scripted engine (self-test)". Have the engine-lane engineer land the transport seam first.
- **NON-BLOCKING H1 (decomposition wording).** DECOMPOSITION 2.4 scope lists "E2E command log for the coverage gate". The command log is written by the TS recording transport into `coverage/e2e/commands-*.json` (`scripts/harness/e2e_coverage.py` docstring), not by the binary, and the FEATURE spec correctly does not mention it. Recommendation: delete that bullet from DECOMPOSITION 2.4, or reword it to "the binary's output feeds the transport's command log".
- **NON-BLOCKING H2 (scope creep).** The scripted runtime (`LlmRuntime` seam) is in the M0 scope, but the spec itself says "used from M2", and `LlmRuntime` belongs to `cpt-noter-feature-core-llm-gate` (M2). Recommendation: move it to llm-gate or postcall, so the M0 harness PR does not invent an LLM seam ahead of its owner.

### 2.5 core-settings

- **BLOCKING B3 (where non-section state is stored, and its `rev`).** `Settings` has 12 sections (general … updates). Hotkey bindings, setup step states, `SelfTestState` and bundle states belong to none of them, yet the specs write them "through the change-log write path" (`inst-store-binding`, `inst-store-result`, `inst-write-choice`). DESIGN-core lists `settings` keys as "section name, plus `rev` and `account.claude`/`account.chatgpt`" only. `hotkey_set`, `setup_set_step`, `setup_set_call_display` and `setup_set_audio_storage` take no `rev`. If they bump the single settings `rev`, a First-run window's next `settings_update` gets `conflict` unless it re-reads first.
  - Recommendation for the Teamlead:
    - (a) Store hotkey bindings under key `hotkeys` and setup state under key `setup` in the `settings` table, and do **not** bump the settings `rev` for them.
    - (b) `setup_set_call_display` (`CallScreenSettings.display_id`) and `setup_set_audio_storage` (`AudioSettings.retention`) **do** change sections. They bump `rev` and emit `settings:changed` as well as `setup:changed`.
    - (c) `hotkeys_reset` writes `Settings.copilot.card_keys`, so it also bumps `rev` and emits `settings:changed`. The spec emits only `hotkeys:changed`.
  - Ask the owner to add the `hotkeys` and `setup` keys to `cpt-noter-dbtable-settings`.
- **NON-BLOCKING ST1.** `HotkeyAction::UndoCardAction` (⌃⌥⌘Z) is a `HotkeyAction` but a card key: the contract doc says so, and PRD Live copilot says it is registered only while capture runs. `cpt-noter-algo-core-settings-register-hotkeys` says "for each app hotkey binding", but `HotkeyList` includes it. Recommendation: say explicitly that `UndoCardAction` is skipped at launch and shows `registered_during_capture`. Also, `HotkeyStatus::ReservedBySystem` exists in the contract, but the state machine has no transition into `reserved_by_system`. Add "FROM registered TO reserved_by_system WHEN the default chord is on the reserved list at launch", or drop the state from the spec.
- **NON-BLOCKING ST2 (dependency cycle).** `cpt-noter-flow-core-settings-update` `inst-side-effects` calls `launch_at_login` (the login item, owned by core-first-run `cpt-noter-algo-core-first-run-login-item`) and `offer_to_record` (the detection rule, owned by core-first-run). But first-run depends on settings, not the other way. Recommendation: settings publishes a section-changed hook, and first-run subscribes to it for the login item and the detection rule. Write that into both specs so neither engineer calls into the other's unbuilt code.
- **NON-BLOCKING ST3.** The glossary table has no `cpt-noter-dbtable-*` ID. DESIGN-core 3.7 references the PRD `glossary` table, which "gains `rev`". The settings FEATURE's Data block lists only `cpt-noter-dbtable-settings`. Recommendation: state that core-settings owns the `glossary` migration in M0. `glossary_upsert` also takes `variants_latin`, but the spec says `variants`; align the spec text with the contract field names.
- **NON-BLOCKING ST4.** No spec gives the default chords. Their source is PRD › 14 Settings › Hotkeys: ⌃⌥⌘K mute, ⌃⌥⌘Z undo card, ⌃⌥⌘0 Hide for Presenting; the others are "configurable". Recommendation: list the defaults (or point to one constant) so that `hotkeys_reset` and the fake core agree. A difference would show up as a conformance failure.

### 2.6 core-engine-foundation

- **NON-BLOCKING E1 (DoD can contradict the spike).** `cpt-noter-dod-core-engine-foundation-offline` requires App Sandbox. The spike flow's own error path says that if attribution fails "the engine ships unsandboxed (Q4) and the CI network-monitor test becomes the guarantee". Recommendation: make the DoD conditional: "App Sandbox, or, if Q4 is decided unsandboxed, no network entitlement and the network-monitor test". The spike must also be done before the offline DoD is built, to avoid redoing the work. PRD › Roadmap puts it in week one.
- **NON-BLOCKING E2.** The `self_test` failure reasons don't match across specs. core-first-run says "permission missing → Channel ends `failed { permission_missing { kind } }`" (`SelfTestFailure::PermissionMissing` exists in the contract). But the engine-foundation self-test flow lists only `OneStreamSilent`, `ZeroBuffers`, `OwnSoundsLeak`, `TimedOut` and `ModelMissing`. Recommendation: the core decides `PermissionMissing` (microphone not granted, read through the platform seam) before sending `self_test`. Say so in first-run, so the engine never infers permissions.
- **NON-BLOCKING E3.** PRD › First run says the self-test "passes as soon as both streams arrive with non-zero audio **and line up**". No spec includes an alignment check. Recommendation: add "both channels on one clock within N ms" to the pass rule, or get the owner to confirm that "on one clock" (`inst-open-taps`) is enough.
- The lane and runner split is fine: the engine is Mac only, and its tests run in the `macos` job.

### 2.7 core-first-run

- **BLOCKING B1** also applies here: permissions, displays, updater, download source.
- **NON-BLOCKING F1 (no engine command for the system-audio prompt).** `inst-system-audio`: "ask the engine to open the tap briefly so macOS shows its prompt". `contracts/engine.schema.json` has no such command, only `self_test`, `start_session`, `set_detection`, `ping` and similar. Recommendation: use `self_test { play_clip: false }` and take the state from its result. That needs no contract change. A new engine command would be a contract change through the contract lane.
- **NON-BLOCKING F2 (contradictory arguments).** `AudioStorageArgs { never_store_audio: bool, retention: AudioRetention }`, and `AudioRetention` already has `NeverStore`. The spec doesn't handle `never_store_audio: false` with `retention: NeverStore`, or `true` with `Days30`. Recommendation: `true` stores `NeverStore` whatever `retention` says, and `false` with `NeverStore` returns `invalid_input`. Write this into `cpt-noter-flow-core-first-run-choices`, and have the contract lane make the fake match.
- **NON-BLOCKING F3.** `update_install`: `inst-if-recording` comes before `inst-if-no-update`, so during a capture with no update it answers `Ack` instead of `not_found`. Recommendation: check for an update first. Also, the `UpdateInfo.ready` doc says "installs on next launch", while DESIGN-core and the spec say "install now (restarts)". These fit together ("now, or at next launch if not pressed"), but one sentence in the spec would settle it. In M0 the updater endpoint and signing keys are DevOps work, so in the harness `update_install` can only reach `not_found` or the scripted path (B1).
- **NON-BLOCKING F4.** Model downloads go out in M0, but the egress gate (`noter-llm`) arrives in M2. `cpt-noter-dod-core-first-run-models` says "reach only hosts listed in `contracts/egress-hosts.json`". Those hosts are listed under `allow_without_audit.model_downloads`. Recommendation: the download task checks its URLs against that list itself, with a unit test, until M2 moves it onto the scheduler and the gate. Otherwise the DoD has no enforcing code in M0.
- **NON-BLOCKING F5.** `permission_request` kinds include screen recording and automation. PRD › Security, privacy and permissions puts those later (Screen Share Test M2, automation for handoff M2). Asking for them is harmless, but it is scope beyond the M0 story. Recommendation: implement all kinds (the enum is frozen) but test only microphone, system audio, calendar and notifications in M0.

---

## 3. DECOMPOSITION-core §1 "Discrepancies": owner decisions that affect M0

| # | Discrepancy | Affects M0? | Recommendation |
|---|-------------|-------------|----------------|
| 1 | `api_key_set` and `accounts_get` are M3, but post-call needs them in M2 | No | Decide before M2 starts. I recommend moving both to M2. |
| 2 | Model download is a job in DESIGN-core, but the scheduler comes in M2 | **Yes**: first-run `inst-start-task` | **Accept** as written: a setup task in M0, moved onto `noter-jobs` in M2 with no contract change. Add F4 (an allow-list check in the task) so M0 still enforces egress. |
| 3 | First run uses `levels_subscribe`, `open_external` and `window_navigate`, which are placed in M1 | **Yes**: QA counting and UI flows | **Accept.** Levels come from `SelfTestMsg`. The UI fake may keep `open_external` for "Open System Settings", but no M0 real-core E2E may call these three (they would answer `not_implemented`). |
| 4 | The Calendar permission is M0 but the PRD says calendar is v1.x | **Yes**: `permission_request { calendar }` | **Accept** the decomposition's reading (EventKit reads are v1; the v1.x calendar is the knowledge-source integration). The owner should confirm it in the PRD changelog, because the PRD wording invites scope disputes. |
| 5 | Two "week one" tests (PRD Q4 spike in M0, DESIGN-core Q7 drill in M1) | **Yes**: engine-foundation | **Accept**, and make the Q4 spike the first engine-lane task. Its outcome changes the offline DoD (E1) and whether `storage_move` ships. The owner must record the Q4 decision in DESIGN-core before engine-capture starts (already in `cpt-noter-dod-core-engine-foundation-spike`). |
| 6 | Footprint and dropout metrics come before the Metrics component | No (M1) | No action for M0. |
| 7 | The audit is visible one milestone late | No (M2/M3) | No action for M0. |
| 8 | Summary notifications | No (M1/M2) | No action for M0. |
| 9 | The Assistants step can only be skipped in M0 | **Yes**: `SetupStatus.complete` | **Accept.** `setup_set_step { assistants, skipped }` must count toward `complete = true`, or AC2 ("complete is true") cannot pass in M0. This is already in first-run `inst-recompute`. |
| 10 | Lanes: native code is split across core and engine | **Yes**: first-run is 2 PRs; the B1 seam | **Accept**, and settle the order: (1) the core lane defines the `Platform` trait in `noter-core` and the harness stub, (2) the engine lane implements it in `noter-native`, (3) the core lane wires it in `src-tauri`. The same pattern applies to the B4 engine transport seam in `noter-engine-client`. |

New discrepancies this review would add to §1, all owner work: B2 (perf scenarios), B4 (HARNESS.md M0 row and §3 dependency), B3 (the DESIGN-core `settings` key list), S1 (a `changes` surface column), H1 (the 2.4 scope wording).

---

## 4. Requests to raise with the owner, through the Teamlead

1. `harness/perf.toml`: add `[scenarios.core_app_snapshot]` and `[scenarios.core_cold_start]` (B2). The core lane names the bench example binaries first.
2. `docs/HARNESS.md` "What comes next", M0 row: add "scripted engine (self-test) and platform stub in `noter-core-harness`" (B4, B1).
3. `docs/DECOMPOSITION-core.md` §3: add core-harness → core-engine-foundation (the supervisor transport seam). §2.4: drop or reword "E2E command log" (H1). §2.4/§2.7: name the owner of the `Platform` seam (B1).
4. `docs/DESIGN-core.md` `cpt-noter-dbtable-settings`: add the `hotkeys` and `setup` keys and the `rev` rule (B3). `cpt-noter-dbtable-changes`: add a nullable `surface` column (S1).
5. `harness.toml [milestone].current`: say when it becomes `M0` (C2).

What I did not check: whether DESIGN.md story steps for the 3 M0 stories match these specs step by step (I used their IDs and the specs' ACs only), and whether `cfs validate` accepts every `inst-*` ID. I did not run `just setup` or any gate, because the review was read-only.
