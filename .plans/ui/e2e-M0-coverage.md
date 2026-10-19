# M0 E2E coverage: now vs needed

Owner: ui-e2e · measured 18 Oct 2026 on origin/main (`651d434`, after #29 IPC host) · gate: `scripts/harness/e2e_coverage.py`. Bar (`harness.toml [gates.e2e]`): ≥ 60 % of the frozen commands **and** ≥ 60 % of the stories of the delivered milestones, **counted against the real core only**.

## 1. What the gate computes

| Run | Milestone | Frozen commands | Stories | Gate |
|---|---|---:|---:|---|
| `just e2e` on main, as CI runs it today | **pre-M0** (current) | 0 / 0 = 100 % | 0 / 0 = 100 % | ✅ passes only because nothing is due yet |
| The same logs with `current = "M0"` | M0 | **0 / 22 = 0 %** | **0 / 3 = 0 %** | ❌ no real-core run: `noter-core-harness` is not on main and CI never sets `NOTER_CORE_CMD`. Every log is `target: fake` and does not count. |
| Fake core, `--include-fake` (for insight, never counted) | M0 | 22 / 22 | 3 / 3 | — |
| **Real core from PR #26** (`lane/core/harness-wire` @ `7f1c299`, `--fixture world`): conformance + `tests/e2e/m0-*` with `NOTER_CORE=stdio` | M0 | **19 / 22 = 86.4 %** | **2 / 3 = 66.7 %** | ✅ would pass, with almost no margin on stories |

**Conclusion.** M0's E2E bar does not wait for any UI feature. The contract-level specs already on main name all 3 M0 stories and run all 22 M0 commands. The bar turns green once:

1. #26 (`noter-core-harness`) merges;
2. CI sets `NOTER_CORE_CMD="target/debug/noter-core-harness --fixture world"` (DevOps; the stdio line is already in `just e2e`);
3. the owner moves `[milestone].current` to `M0`.

The UI specs in §3 prove the screens and close the FEATURE DoDs. They add no new story IDs to the count, but they make each story's proof sturdier.

### Real-core run against #26, by spec (`tests/e2e/m0-*`, stdio)

| Spec | Pass | Fail | Why it fails against the real core today |
|---|---:|---:|---|
| `m0-settings-hotkeys.spec.ts` (`settings-set-hotkeys`) | 5 | 0 | — |
| `m0-core-bridge-window.spec.ts` (a DESIGN-core story; not counted) | 10 | 0 | — (the page reaches the real core through #36's `__TAURI_INTERNALS__` stand-in, so D-5 needs no `main.tsx` change) |
| `m0-first-run.spec.ts` › `first-run-complete-setup` | 1 | 5 | `harness.world_set: no M0 service owns app.setup.self_test` (Finish the remaining steps); `harness.push: no scripted stream in the M0 core yet` (Self-test hears only one stream); the self-test never passes (happy path, Self-test skipped); `permission_request(system_audio)` answers ok `not_asked` instead of `permission_denied` when the world says denied. Only *Microphone not allowed* passes. |
| `m0-first-run.spec.ts` › `first-run-download-models` | 0 | 5 | `harness.world_set: no M0 service owns app.setup.models` (every path) |

Conformance over stdio: the core answers all 22 M0 commands; 4 tests fail: the self-test stream (R23/R24, ×2), the `offline`/`not_ready`/`disk_full` refusals, and growing versions on the whole-state events (R25).

Not exercised successfully against the real core: `models_download`, `permission_request`, `setup_set_audio_storage`.

### Needed from the backend (core lane), none of it on main yet

1. #26 merged, with `harness.world_set` owning `app.setup.models` and `app.setup.self_test`. Without that, `first-run-download-models` cannot pass on any path and stories stay at **2 / 3**, one failing path away from 1 / 3 = 33 %.
2. A scripted self-test stream behind `self_test_run`, plus `harness.push` for it (core first-run #43 + the harness): it unblocks 4 of the 6 `complete-setup` paths.
3. `permission_request` refusing with `permission_denied` and detail `{type: permission, kind}` while the permission is denied.
4. `models_download` honouring `offline`, `disk_full` (detail `disk_space`) and `checksum_failed`, and resuming by itself once the Mac is online again.
5. CI's `NOTER_CORE_CMD` (DevOps; docs/TEST-PLAN.md › Requests 1–2).

## 2. M0 inventory

| Story | Contract spec (on main) | UI spec (`lane/ui/e2e-m0`) | FEATURE |
|---|---|---|---|
| `cpt-noter-seq-first-run-complete-setup` | `m0-first-run.spec.ts`, 6 paths | `m0-first-run-ui.spec.ts`, 6 paths; `m0-main-window-shell.spec.ts`, the Self-test skipped banner | first-run, main-window-shell |
| `cpt-noter-seq-first-run-download-models` | `m0-first-run.spec.ts`, 5 paths | `m0-first-run-ui.spec.ts`, 5 paths | first-run |
| `cpt-noter-seq-settings-set-hotkeys` | `m0-settings-hotkeys.spec.ts`, 5 paths | `m0-settings-hotkeys-ui.spec.ts`, 5 paths + a keyboard-only pass | settings |

Commands (22 frozen): `app_snapshot`, `stream_unsubscribe`, `stream_ack`, `banner_dismiss`, `log_ui`, `setup_status`, `models_download`, `permission_request`, `self_test_run`, `setup_set_call_display`, `setup_set_audio_storage`, `setup_set_step`, `settings_get`, `settings_update`, `settings_unignore_app`, `hotkeys_list`, `hotkey_set`, `hotkeys_reset`, `glossary_list`, `glossary_upsert`, `glossary_remove`, `update_install`. The Playwright flows run 17 of them; conformance (`m0-m1-rules.test.ts`) adds `banner_dismiss`, the three glossary commands and `update_install`.

## 3. What each M0 UI feature brings (take the file into the feature's PR)

Branch `lane/ui/e2e-m0` (pushed, no PR). The specs are written tests first, from the FEATURE spec and the prototype markup, and fail until their feature lands. **A spec must travel inside its feature's PR**: alone on main it would turn `just e2e` red.

| # | Feature | Take into the PR | Tests | Notes for the engineer |
|---|---|---|---|---|
| 2.3 | primitives | — (no E2E) | unit + screenshot specs (FEATURE §5) | The specs below assume these roles: buttons, `role=status` for **Self-test passed**, `role=alert` on the error inline banner, `progressbar`, `radio`, `switch`, and `data-component="cpt-noter-component-ui-…"` on DESIGN components, as the prototype marks them. |
| 2.4 | accessibility-l10n | — (no E2E of its own) | unit (announcer, physical keys, focus return) + pseudo-locale screenshots | Its "keyboard-only E2E pass per screen" lives in each screen's spec: the keyboard tests in `m0-settings-hotkeys-ui.spec.ts` and `m0-main-window-shell.spec.ts`. |
| 2.5 | main-window-shell | `apps/desktop/tests/e2e/m0-main-window-shell.spec.ts` | 3 tests: the Self-test skipped banner in MW-R5 (story `first-run-complete-setup`, Empty path), gone once the test passes; ⌘3 and ⌘[ with focus on the page heading and Back disabled at the start; Tab through MW-R2 and MW-R3 | The banner locator also accepts TD-R2 (Today comes in M2). The navigation tests are titled with the flow ID `cpt-noter-flow-ui-main-window-shell-navigate`; the shell has no story. |
| 2.6 | first-run | `apps/desktop/tests/e2e/m0-first-run-ui.spec.ts` | 11 tests: every path of both first-run stories, driven in the first-run window, checking the copy and the commands with their arguments | The **Hearing you** meter and `open_external` are checked on the fake only: `levels_subscribe` and `open_external` are M1. |
| 2.7 | settings | `apps/desktop/tests/e2e/m0-settings-hotkeys-ui.spec.ts` | 6 tests: every path of `settings-set-hotkeys` + a keyboard-only pass (↓ to Hotkeys, Return records, Esc cancels and keeps focus) | `NO_MATCH = "xylophone"` stands in for the word D-2 makes DESIGN.md pick; align it when that PR lands. The Card key path returns early while the real core refuses the copilot slice (M4). After #66 (D-4), switch it to `changeAhead`'s milestone rule. |
| all | — | `apps/desktop/tests/e2e/support/app.ts` (in whichever of the three PRs lands first) | — | `openWindow(page, label, { world })` seeds the story's starting state (`world-presets.ts`) and returns `steer` (`change`, `failNext`, `push`), working against both the fake and the real core. The existing `m0-core-bridge-window.spec.ts` keeps passing with it. |

Locators follow the prototype (`docs/prototype/clickable/src/js/10-a-surfaces.js`, `10-a-components.js`, `50-e-5-settings.js`, `05-shell.js`). If the implementation names a region or role differently, change the locator, never the expected copy, the commands sent or their arguments.

## 4. Related

- PR #66 (D-4/D-5): `ahead()`/`pending()`/`changeAhead()` fail on `not_implemented` once the command's milestone is current. Rebase `lane/ui/e2e-m0` onto it once it merges.
- Run the UI specs: `lockf ~/projects/noter-wt/.e2e.lock pnpm --dir apps/desktop exec playwright test --project=e2e tests/e2e/m0-`; against the real core add `NOTER_CORE=stdio NOTER_CORE_CMD="<harness> --fixture world"`.

## 5. Fake-core run of `lane/ui/e2e-m0`

`lane/ui/e2e-m0` @ `358b61c` on the fake core, `tests/e2e/m0-*`: **27 passed, 20 failed**.

| Spec | Result |
|---|---|
| `m0-core-bridge-window.spec.ts` | 11 / 11 pass (with the extended `support/app.ts`) |
| `m0-first-run.spec.ts`, `m0-settings-hotkeys.spec.ts` | 16 / 16 pass (unchanged) |
| `m0-first-run-ui.spec.ts` | 0 / 11 — fails as intended: no first-run window yet (stepper, rows, buttons not found) |
| `m0-settings-hotkeys-ui.spec.ts` | 0 / 6 — fails as intended: no Settings window yet |
| `m0-main-window-shell.spec.ts` | 0 / 3 — fails as intended: no shell yet (no banner, no Back button, no MW-R2/MW-R3) |

Not checked yet: the world seed and `steer` on a real screen. They are exercised only once a screen renders the state, so the first feature PR is where they are first proven.

## Update 18 Oct (real-core alignment, ui-e2e)
- 'Download failed its check' and 'Speech model not downloaded yet' (core-level `m0-first-run.spec.ts` and UI-level `m0-first-run-ui.spec.ts`) no longer preset `checksum_failed`/`downloading` through `harness.world_set`. They call `harness.corrupt_next_download {}` (`HARNESS_CONTROLS.corruptNextDownload`, `Scenario.corruptNextDownload()`, `openWindow(..., { corruptNextDownload: true })`), then `models_download start` → `checksum_failed`, `retry` → `ready`. 'Speech model not downloaded yet' now starts the download itself instead of presetting 62 %; the "Waiting for the speech model · N %" percentage is whatever the core reports.
- The first-run happy path no longer requires a self_test `line` event (M1 engine); the UI specs only check result lines that come from `stream_arrived`/`passed`.
- No E2E asserts anything after `stream_unsubscribe` (only one `ok(...)` call in `m0-first-run.spec.ts`), so #79's `ended{unsubscribed}` changes nothing here.

### Backend ask (fake core, backend's lane): `corruptNextDownload()`
`FakeCore` (apps/desktop/src/core/fake/fake-core.ts) needs a public `corruptNextDownload(): void`. Exact behaviour, matching `harness.corrupt_next_download` on the real core:
1. Sets a one-shot flag.
2. The next `models_download { action: "start" }` (or `"resume"`) from any window moves the required-for-capture bundle (the speech model) to `state: "checksum_failed"` with `app.setup.models.error = "checksum_failed"`, emitting the usual `setup:changed`/whole-state events, and clears the flag.
3. A following `models_download { action: "retry" }` moves that bundle through `downloading` to `ready` (the fake may jump straight to `ready` after a tick) and clears `models.error`.
Until it exists, `FakeScenario.corruptNextDownload()` and the plan option throw "the fake core has no corruptNextDownload yet", so those two tests fail on the fake target; they pass on the real core once #26 lands.
