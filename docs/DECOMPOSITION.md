---
title: "Decomposition — Noter UI"
description: "The UI features that implement docs/DESIGN.md, in milestone order, with the DESIGN elements, contract commands, stories and clickable-prototype modules each one covers."
status: DRAFT
version: "1.0"
date: "2026-10-18"
design: docs/DESIGN.md
---

# Decomposition: Noter UI


<!-- toc -->

- [1. Overview](#1-overview)
- [2. Entries](#2-entries)
  - [2.1 Core bridge and window stores — M0 · HIGH](#21-core-bridge-and-window-stores--m0--high)
  - [2.2 Design tokens and theming — M0 · HIGH](#22-design-tokens-and-theming--m0--high)
  - [2.3 Primitives and feedback components — M0 · HIGH](#23-primitives-and-feedback-components--m0--high)
  - [2.4 Accessibility, keyboard and localisation — M0 · HIGH](#24-accessibility-keyboard-and-localisation--m0--high)
  - [2.5 Main window shell and navigation — M0 · HIGH](#25-main-window-shell-and-navigation--m0--high)
  - [2.6 First-run wizard — M0 · HIGH](#26-first-run-wizard--m0--high)
  - [2.7 Settings window — M0 · HIGH](#27-settings-window--m0--high)
  - [2.8 Dialogs, sheets and alerts — M1 · HIGH](#28-dialogs-sheets-and-alerts--m1--high)
  - [2.9 Record prompt — M1 · HIGH](#29-record-prompt--m1--high)
  - [2.10 Call window: call screen and floating panel — M1 · HIGH](#210-call-window-call-screen-and-floating-panel--m1--high)
  - [2.11 Live and stored transcript — M1 · HIGH](#211-live-and-stored-transcript--m1--high)
  - [2.12 Menu bar extra — M1 · HIGH](#212-menu-bar-extra--m1--high)
  - [2.13 Library: Calls list — M1 · MEDIUM](#213-library-calls-list--m1--medium)
  - [2.14 Call page frame and transcript — M1 · MEDIUM](#214-call-page-frame-and-transcript--m1--medium)
  - [2.15 Notifications — M1 · MEDIUM](#215-notifications--m1--medium)
  - [2.16 History, change log and undo — M2 · MEDIUM](#216-history-change-log-and-undo--m2--medium)
  - [2.17 Items, review and evidence — M2 · MEDIUM](#217-items-review-and-evidence--m2--medium)
  - [2.18 Call page outputs and sharing — M2 · MEDIUM](#218-call-page-outputs-and-sharing--m2--medium)
  - [2.19 Speaker naming and transcript corrections — M2 · MEDIUM](#219-speaker-naming-and-transcript-corrections--m2--medium)
  - [2.20 Today dashboard — M2 · MEDIUM](#220-today-dashboard--m2--medium)
  - [2.21 Handoff to Claude Code and Codex — M2 · MEDIUM](#221-handoff-to-claude-code-and-codex--m2--medium)
  - [2.22 Library: search, filters and topics — M3 · MEDIUM](#222-library-search-filters-and-topics--m3--medium)
  - [2.23 Ask — M3 · MEDIUM](#223-ask--m3--medium)
  - [2.24 People and Person pages — M3 · MEDIUM](#224-people-and-person-pages--m3--medium)
  - [2.25 Keys and own-account sign-in — M3 · MEDIUM](#225-keys-and-own-account-sign-in--m3--medium)
  - [2.26 Privacy audit and knowledge sources — M3 · MEDIUM](#226-privacy-audit-and-knowledge-sources--m3--medium)
  - [2.27 Live copilot cards — M4 · LOW](#227-live-copilot-cards--m4--low)
  - [2.28 Agents and council — M4 · LOW](#228-agents-and-council--m4--low)
  - [2.29 Activity, proposals and maintenance — M5 · LOW](#229-activity-proposals-and-maintenance--m5--low)
  - [2.30 Performance — M5 · LOW](#230-performance--m5--low)
- [3. Feature Dependencies](#3-feature-dependencies)

<!-- /toc -->

## 1. Overview

This decomposition splits `docs/DESIGN.md` (v1.1, the UI design, `cpt-noter-design-ui`) into 30 features. The core side of the product is decomposed separately in `docs/DECOMPOSITION-core.md` from `docs/DESIGN-core.md`; this file covers only what the UI builds and the native surfaces whose content the UI design owns.

**Strategy.**

- One feature per screen or surface, plus the cross-cutting foundations every screen needs: the core bridge and window stores, tokens and theming, primitives, accessibility and localisation, the main-window shell and the dialog host.
- Every component, screen and story of DESIGN.md sits in exactly one feature. `cpt-noter-component-ui-primitives` is the one shared entry: its 26 controls belong to `cpt-noter-feature-ui-primitives`, its foundations (tokens, typography, materials, motion) to `cpt-noter-feature-ui-tokens-theming`, and its keyboard, VoiceOver and localisation rules to `cpt-noter-feature-ui-accessibility-l10n`.
- Each feature carries the milestone that delivers it. The milestone follows `harness/milestones.toml`, which places every IPC command and every story; where it differs from PRD › Roadmap and milestones › Parallel UI and core work, milestones.toml wins and the difference is listed below.
- The UI is built against the fake core first (`apps/desktop/src/core/fake`), and each feature switches to the real core when its milestone's commands are delivered. Commands placed in a later milestone than the feature are marked with that milestone.
- FEATURE specs exist for every feature, M0 to M5 (30 files in `docs/features/ui/`); the M2 to M5 specs are revisited before their milestone starts.
- Status: every feature is **NOT_STARTED**; no checkbox is ticked.

**Milestones.**

| Milestone | Features | FEATURE spec |
| --- | --- | --- |
| M0 | `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-tokens-theming`, `cpt-noter-feature-ui-primitives`, `cpt-noter-feature-ui-accessibility-l10n`, `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-first-run`, `cpt-noter-feature-ui-settings` | written |
| M1 | `cpt-noter-feature-ui-dialogs-host`, `cpt-noter-feature-ui-record-prompt`, `cpt-noter-feature-ui-call-window`, `cpt-noter-feature-ui-live-transcript`, `cpt-noter-feature-ui-menu-bar`, `cpt-noter-feature-ui-library-calls`, `cpt-noter-feature-ui-call-page-frame`, `cpt-noter-feature-ui-notifications` | written |
| M2 | `cpt-noter-feature-ui-history-undo`, `cpt-noter-feature-ui-items`, `cpt-noter-feature-ui-call-page-outputs`, `cpt-noter-feature-ui-speakers`, `cpt-noter-feature-ui-today`, `cpt-noter-feature-ui-handoff`; the API key and Runtime per task part of `cpt-noter-feature-ui-accounts` (discrepancy 9) | written |
| M3 | `cpt-noter-feature-ui-library-search-topics`, `cpt-noter-feature-ui-ask`, `cpt-noter-feature-ui-people`, `cpt-noter-feature-ui-accounts` (completed), `cpt-noter-feature-ui-privacy-sources` | written |
| M4 | `cpt-noter-feature-ui-copilot`, `cpt-noter-feature-ui-agents` | written |
| M5 | `cpt-noter-feature-ui-activity`, `cpt-noter-feature-ui-performance` | written |

**Coverage of DESIGN.md.** 77 of 77 components and screens (2 shells, 2 app-layer entries, 16 screens, the primitives inventory and 56 complex components), 49 of 49 stories, 10 of 10 principles and 14 of 14 constraints are assigned; `cpt-noter-interface-ui-core-ipc` and `cpt-noter-tech-ui-stack` sit in `cpt-noter-feature-ui-core-bridge`, and `cpt-noter-topology-ui-windows` is shared by the main-window shell and the call window (one row each). All 172 commands of `contracts/ipc.manifest.json` appear in a feature's API list. The UI owns no tables: the tables of `docs/DESIGN-core.md` appear under **Data** only as what each feature reads through the core; `docs/DECOMPOSITION-core.md` owns them.

**Reuse of the clickable prototype.** `docs/prototype/clickable/` is the UI prototype of record (PM-59). Each entry names the prototype modules it reuses and how:

- **Ported as-is**: the stylesheets (`src/css/00-base.css`, `01-macos27.css`, `02-contrast.css` and the per-group files `10-a.css` to `60-f.css`, minus prototype-only selectors such as `.cw-proto`, `.np-cap` and the harness bar) and the SVG icon set `src/js/01-icons.js`. Class names, custom properties and radii stay as they are.
- **Rewritten in React with the same structure, tokens and data attributes**: the render functions (`C.*`, `P.*`, screens, surfaces and overlays). Every production element keeps `data-component`, `data-primitive`, `data-variant`, `data-size`, `data-state` and `data-region` exactly as the prototype emits them, so screenshot and E2E selectors match the prototype.
- **Source of truth only**: the prototype runtime (`00-core.js`, `99-boot.js`, `build.py`), sample data (`03-data.js`, `40-d-1-data.js`), the harness bar, **State ▾**, **Inspect** and the call window's prototype bar, and the HTML drawings of native surfaces (menu bar, notifications, alerts), which macOS draws in the product. They define look, states and behaviour; they are not ported.

Every state in a screen's or component's States table must match a prototype state. Where DESIGN.md and the prototype differ, the prototype wins (owner decision); the FEATURE specs follow it, and the differences are listed here for the owner. DESIGN.md is not changed by this decomposition.

**Milestone discrepancies (milestones.toml followed).**

1. PRD › Parallel UI and core work puts the Call page in M2, but milestones.toml places `cpt-noter-seq-dialogs-delete-call` and `cpt-noter-seq-notifications-allow-notifications` in M1, and both happy paths start on a call's page (its ⋯ menu and its permission banner). `cpt-noter-feature-ui-call-page-frame` therefore ships the page's frame and stored transcript in M1; the outputs follow in M2.
2. The first-run wizard (M0) needs `levels_subscribe` (microphone meter), `open_external` (**Open System Settings…**) and `window_navigate` (**Finish** opens Today), which milestones.toml places in M1. M0 builds them against the fake core; their E2E proof against the real core counts from M1.
3. `share_test_run` is placed in M2, while the stories that use the Screen Share Test are in M1 (`cpt-noter-seq-call-screen-hide-for-presenting`, Other — Check the share before presenting) and M3 (`cpt-noter-seq-settings-check-privacy`). The sheet is specified in `cpt-noter-feature-ui-settings` and bound to the real core in M2.
4. M1 stories of the call window contain copilot steps: `cpt-noter-seq-floating-panel-display-unplugged` (happy path step 4 pins card 2), `cpt-noter-seq-floating-panel-collapse-strip` (the card line, **Pin** from the strip, Empty — Copilot muted while collapsed). Their commands (`cards_subscribe`, `card_pin`, `copilot_mute`) are draft and in M4, and the copilot ships behind a flag until the M4 gate (`cpt-noter-constraint-copilot-flag`). M1 proves these stories in the **Copilot flag off** layout; `cpt-noter-feature-ui-copilot` proves the card steps in M4.
5. `cpt-noter-seq-record-prompt-start-recording` (Error — Not enough disk space) and `cpt-noter-seq-call-screen-recover-capture` (Error — Disk nearly full) are M1 but open the **Delete Old Audio…** sheet, whose command `audio_delete_older` is M2. M1 opens the sheet; deleting is proven in M2.
6. `cpt-noter-seq-call-screen-stop-at-call-end` and `cpt-noter-seq-call-screen-hide-for-presenting` (M1) end with the **Summary ready** notification, which needs outputs (M2). M1 proves the paths up to the stop and the page loaded in the background.
7. `cpt-noter-seq-call-screen-name-speaker` (M2) uses the person picker and the New person form, whose commands `people_list` and `person_create` are M3. M2 builds them against the fake core.
8. `cpt-noter-seq-first-run-complete-setup` (Empty — Self-test skipped) ends on Today's setup banner; Today is M2. In M0 and M1 the same banner shows in the main window's banner slot MW-R5, as the shell's States table allows.
9. `accounts_get` and `api_key_set` are M2 (owner decision of 18 Oct; `docs/DECOMPOSITION-core.md` § 1, discrepancy 1), so the M2 post-call runtime can be configured from the app, while `cpt-noter-feature-ui-accounts` and its stories are M3. The feature is built in two stages and no ID moves. The owner approved this staging on 18 Oct as an exception to the rule in `.cf-studio/config/AGENTS.md` that keeps each FEATURE inside one milestone: splitting it would add a 31st feature for two commands and change every coverage count, while the backend stages `cpt-noter-feature-core-credentials-privacy` the same way. In M2 it delivers the key part against the real core: `cpt-noter-flow-ui-accounts-key` and `cpt-noter-dod-ui-accounts-keys`, that is the API-key rows of Settings › Models & Runtimes and of first-run step 6, the key sheet, and the states Key rejected, Key being verified, Keychain locked and No key and no local runtime. It also delivers **Runtime per task** (steps 2 and 3 of `cpt-noter-flow-ui-accounts-manage`, through `settings_update`, delivered in M0), where the account runtimes stay listed as not connected until M3. Within the key flow, **Remove…** (`api_key_remove`) and **Install Ollama…** (`cli_install`) are M3 commands: M2 builds them against the fake core. The own-account rows, the sign-in sheet, Test and sign-out stay M3. The stories stay M3 in milestones.toml, so the E2E story bar counts them from M3. In M2 the real-core E2E covers the key paths of `cpt-noter-seq-settings-replace-api-key` (happy path, Key rejected, Keychain locked) and of `cpt-noter-seq-first-run-connect-assistant` (happy path, API key rejected), and these tests already name those stories.

**DESIGN.md versus the prototype (prototype followed).**

1. Record prompt: the screen's States table has no **Speech model not downloaded yet** row, which the prototype shows (`RP_STATES` › `model-missing`) and the component's variants table describes. The FEATURE includes it.
2. Menu bar extra: the screen's States table has no row for the 5 minutes after a stop (**Saved · 48 min · Summary in about 2 minutes** with **Continue Recording**), which the prototype shows (`MB_STATES` › `closing`) and the status item describes. The FEATURE includes it.
3. Menu bar extra, hidden for presenting while recording: the prototype also lists **Call Detected · Start Recording** (`mbMenu`, state `hidden`); DESIGN offers it only while not recording. Resolved by HoD decision D-1 (18 Oct 2026): DESIGN wins, because a second capture cannot start while one runs (`already_recording`); the FEATURE offers the item only while no capture runs, visible or hidden.
4. Menu bar extra, call ended while hidden: DESIGN changes the line to **Stopped at 11:12 · the call had ended** after 10 minutes; the prototype never shows that line. The FEATURE keeps **Call seems to have ended** until the core reports the stop, then shows the closing line the core sends.
5. Call screen: DESIGN's **Device changed** state (marker row **Microphone changed · 2 s lost**) and the gap row **Engine restarted · 2 s lost** do not exist in the prototype. The FEATURE renders the gap rows the core sends with the prototype's gap-row style.
6. Delete alert: the Library entry of DESIGN says **Their audio, transcripts, summaries and items are deleted from this Mac. This can't be undone.** with **Delete** and **Cancel**; the prototype and DESIGN's Dialogs entry say **This removes its audio, transcript, summary, items and cards. You can't undo this.** (plural: **This removes their audio, transcripts, summaries, items and cards. You can't undo this.**) with **Cancel** as the default. The FEATURE uses the prototype's text.
7. Settings search: `cpt-noter-seq-settings-set-hotkeys` (Empty — No setting matches the search) typed “zoom” and expected **No settings match “zoom”**, but the prototype matches pane keywords and “zoom” finds Privacy and Call Screen & Menu Bar; its empty state uses “zoom calls”. Resolved by HoD decision D-2 (18 Oct 2026): the keyword search stays and the story now types “zoom calls”, which matches no pane name or keyword.
8. Increase Contrast: DESIGN makes glass materials opaque; the prototype uses 94 % white (light) and 96 % (dark), and its dark focus ring is #4DA3FF where DESIGN names the accent #0A84FF. The FEATURE follows the prototype's values.
9. Reduce transparency: the prototype has no rule for it; DESIGN makes every material opaque. This is a gap in the prototype, not a conflict, so DESIGN applies.
10. DESIGN itself: the story index of `cpt-noter-seq-menu-bar-check-state` does not list the path **Other — New meeting while hidden**, which the story has and the menu bar's States table cites.

## 2. Entries

**Overall implementation status:**

- [ ] `p1` - **ID**: `cpt-noter-status-overall-ui`

### 2.1 [Core bridge and window stores](features/ui/core-bridge.md) — M0 · HIGH

- [x] `p1` - **ID**: `cpt-noter-feature-ui-core-bridge`

- **Purpose**: Give every WebView window one typed path to the Rust core and one in-memory store, so screens render only what the core sent, typed errors become named states, and the UI can be built against the fake core first and switched to the real core per milestone.

- **Milestone**: M0. **Spec**: [`docs/features/ui/core-bridge.md`](features/ui/core-bridge.md). **Status**: IMPLEMENTED.

- **Depends On**: None

- **Scope**:
  - The bridge per window over the generated client `createCore()` in `apps/desktop/src/core` (`bindings.ts`, `tauri-transport.ts`, the fake core), with the window's command scope (PM-08)
  - Snapshot, then stream: `app_snapshot` on open, reload and crash recovery; Channel gating, `stream_ack`, gap detection and resubscription; `stream_unsubscribe` on close
  - One window store per window (main, call window, record prompt, Settings, first run): entity slices, the 100 ms stream buffer, view state, the app-level copies (presenting, privacy mode, degraded set, banners, accounts) kept by highest `version`
  - The error map: every `ErrorCode` to a named state of the calling screen; unknown codes to the section-level error with **Try Again**; never an automatic retry
  - UI error logging through `log_ui` without transcript text; native announcement requests through `window_announce`; `window_navigate` and `open_external` as shared bridge calls
  - The interface `cpt-noter-interface-ui-core-ipc` and the technology stack `cpt-noter-tech-ui-stack` on the UI side

- **Out of scope**:
  - The contract itself (`crates/noter-protocol`, `just contract-regen`) and the fake core's behaviour (contract lane)
  - Window placement, hotkey registration, native menus and notifications, which the core does

- **Requirements Covered**: PRD › Architecture overview; PRD › Live copilot loop › Surfaces (the PRD has no requirement IDs; DESIGN 1.2 maps its sections).

- **Design Principles Covered**:

  - [x] `p1` - `cpt-noter-principle-core-owns-state`
  - [x] `p1` - `cpt-noter-principle-degrade-visibly`

- **Design Constraints Covered**:

  - [x] `p1` - `cpt-noter-constraint-tauri-webview`
  - [x] `p1` - `cpt-noter-constraint-local-only-ui`

- **Domain Model Entities**:
  - Every entity of DESIGN 3.1, as read-only view models generated from the core's types
  - Setting
  - Change (whole-state versions)

- **Design Components**:

  - [x] `p1` - `cpt-noter-component-app-core-bridge`
  - [x] `p1` - `cpt-noter-component-app-window-store`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `app_snapshot`
  - `stream_unsubscribe`
  - `stream_ack`
  - `log_ui`
  - `window_navigate` (M1)
  - `window_announce` (M1)
  - `open_external` (M1)
  - all 20 events of `contracts/ipc.manifest.json` (whole-state, highest `version` wins)

- **Sequences**:

  - None of its own; it serves the stories of the features that depend on it

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-settings`

- **Prototype reuse**: Source of truth only: `src/js/00-core.js` (render loop, `state`, `act`/`on` plumbing, `local()` view state) shows which view state exists per screen; it is not ported. The production bridge is `apps/desktop/src/core` (generated). `03-data.js` and `40-d-1-data.js` sample records are the content reference for the fake core's fixture world, not code to port.

### 2.2 [Design tokens and theming](features/ui/tokens-theming.md) — M0 · HIGH

- [x] `p1` - **ID**: `cpt-noter-feature-ui-tokens-theming`

- **Purpose**: Set the macOS 27 foundations once: colour tokens with their default, dark and Increase Contrast values, typography, spacing, radii, Liquid Glass materials, Reduce transparency and Reduce motion, so every window looks native and meets WCAG 2.2 AA under Increase Contrast.

- **Milestone**: M0. **Spec**: [`docs/features/ui/tokens-theming.md`](features/ui/tokens-theming.md). **Status**: IMPLEMENTED.

- **Depends On**: None

- **Scope**:
  - Colour tokens (light, dark, Increase Contrast light and dark), status tints, match, evidence and diff tints, the system accent
  - Typography scale (Large title to Call card), tabular figures, SF Mono, minimum sizes; the call-window text scale 85 to 150 %
  - Spacing grid, window and control sizes, the concentric radius scale, elevation
  - Liquid Glass materials (sidebar, control, strong) and their opaque forms under Reduce transparency and Increase Contrast
  - Appearance modes (system light and dark), Increase Contrast, Reduce transparency, Reduce motion and the motion table
  - The automated contrast check of the Increase Contrast columns in light and dark

- **Out of scope**:
  - The 26 controls themselves (`cpt-noter-feature-ui-primitives`)
  - Focus behaviour, announcements and localisation rules (`cpt-noter-feature-ui-accessibility-l10n`)

- **Requirements Covered**: Owner acceptance criterion AC5 (contrast clause PM-57); PRD › UI prototype › Look.

- **Design Principles Covered**:

  - [x] `p1` - `cpt-noter-principle-native-macos`

- **Design Constraints Covered**:

  - [x] `p1` - `cpt-noter-constraint-accessibility-baseline`
  - [x] `p1` - `cpt-noter-constraint-macos-apple-silicon`

- **Domain Model Entities**:
  - None (presentation foundations)

- **Design Components**:

  - [x] `p1` - `cpt-noter-component-ui-primitives`

  `cpt-noter-component-ui-primitives` is shared with `cpt-noter-feature-ui-primitives`: this feature builds its **Anatomy and variants** foundations (tokens, typography, materials, appearance, motion); that feature builds the 26 controls.

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - None

- **Sequences**:

  - None of its own; it serves the stories of the features that depend on it

- **Data**:

  - Not applicable: the UI owns no tables and reads every record through the core

- **Prototype reuse**: Ported as-is: `src/css/00-base.css` (the `:root` token block, light and dark), `src/css/02-contrast.css` (Increase Contrast values) and the material and radius rules of `src/css/01-macos27.css` become the production token stylesheet, with the same custom-property names (`--label`, `--accent-fill`, `--glass-bg`, `--r-card`…). Prototype-only rules (desk wallpaper, harness bar `--chrome-*`, `[data-contrast]` and `[data-theme]` toggles) are dropped; the production file follows `prefers-color-scheme`, `prefers-contrast` and `prefers-reduced-transparency` only.

### 2.3 [Primitives and feedback components](features/ui/primitives.md) — M0 · HIGH

- [x] `p1` - **ID**: `cpt-noter-feature-ui-primitives`

- **Purpose**: Build the 26 primitives and the three feedback components once, as React components that behave like their AppKit counterparts and carry the prototype's data attributes, so every screen is assembled from one tested set.

- **Milestone**: M0. **Spec**: [`docs/features/ui/primitives.md`](features/ui/primitives.md). **Status**: IMPLEMENTED.

- **Depends On**: `cpt-noter-feature-ui-tokens-theming`

- **Scope**:
  - The 26 primitives of DESIGN 3.2 › Primitives inventory with their variants, states, keys and VoiceOver roles: push-button to split-divider
  - `cpt-noter-component-ui-empty-state`, `cpt-noter-component-ui-inline-banner` (one per slot, severity order, **+2 More**) and `cpt-noter-component-ui-inline-status` (2 s, 3 s blind feedback, 10 s row outcome)
  - The 24 by 24 pt hit-area rule, focus rings for keyboard focus only, sizes 20, 24, 28 and 32 pt
  - Text-only rendering of untrusted strings (PM-08); Markdown without raw HTML

- **Out of scope**:
  - Native alerts, menus of the status item, notifications, open and save panels, which macOS draws (`cpt-noter-feature-ui-dialogs-host`, `cpt-noter-feature-ui-menu-bar`)

- **Requirements Covered**: PRD › UI prototype; PRD › Product principles › 6.

- **Design Principles Covered**:

  - [x] `p1` - `cpt-noter-principle-native-macos`
  - [x] `p1` - `cpt-noter-principle-degrade-visibly`

- **Design Constraints Covered**:

  - [x] `p1` - `cpt-noter-constraint-small-team`

- **Domain Model Entities**:
  - None (controls hold no data)

- **Design Components**:

  - [x] `p1` - `cpt-noter-component-ui-primitives`
  - [x] `p1` - `cpt-noter-component-ui-empty-state`
  - [x] `p1` - `cpt-noter-component-ui-inline-banner`
  - [x] `p1` - `cpt-noter-component-ui-inline-status`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - None (primitives call no command; banner actions call the command of the screen that shows them)

- **Sequences**:

  - None of its own; it serves the stories of the features that depend on it

- **Data**:

  - Not applicable: the UI owns no tables and reads every record through the core

- **Prototype reuse**: Rewritten in React with the same structure, classes, tokens and data attributes: `src/js/02-primitives.js` (`button`, `iconButton`, `segmented`, `popup`, `pulldown`, `menu`, `checkbox`, `toggle`, `radioGroup`, `textField`, `searchField`, `slider`, `progress`, `levelMeter`, `badge`, `disclosure`, `link`, `table`, `th`, `splitDivider`, `kbd`, `helpTag`) and, from `src/js/04-shared.js`, `C.emptyState`, `C.inlineBanner`, `C.inlineStatus`; `src/js/01-icons.js` (the SVG icon set) ported as-is as an icon module. Their styles in `src/css/00-base.css` and `src/css/01-macos27.css` (`.np-btn`, `.np-seg`, `.np-field`, `.np-banner`, `.np-empty`…) ported as-is. Each component keeps `data-component="cpt-noter-component-ui-primitives"`, `data-primitive`, `data-variant`, `data-size` and `data-state`.

### 2.4 [Accessibility, keyboard and localisation](features/ui/accessibility-l10n.md) — M0 · HIGH

- [x] `p1` - **ID**: `cpt-noter-feature-ui-accessibility-l10n`

- **Purpose**: Make keyboard-first operation, VoiceOver, the announcement policy and translation-ready text a shared service that every screen uses, and gate them with automated checks, so WCAG 2.2 AA and the three content languages hold on every surface.

- **Milestone**: M0. **Spec**: [`docs/features/ui/accessibility-l10n.md`](features/ui/accessibility-l10n.md). **Status**: IMPLEMENTED.

- **Depends On**: `cpt-noter-feature-ui-primitives`

- **Scope**:
  - The announcement service: live regions in key windows, native announcements through the core for panels that are not key (D55), politeness per event (D56)
  - Focus management: focus order per region, return focus after popovers, sheets and inspectors, never obscured by sticky parts (WCAG 2.4.11)
  - Physical-key matching for single-key and ⌘ shortcuts on Russian and German layouts (D54)
  - String catalogue (English in v1), plural rules, no concatenation, gender-neutral wording, locale dates, times, numbers and US-dollar amounts, the 12- or 24-hour preference from the core
  - A language attribute on every content block; ё/е and ß/ss folding is the core's
  - Checks: axe-style component checks, the pseudo-localisation run (+40 %, Cyrillic) and a German string pass per screen

- **Out of scope**:
  - Colour values and contrast tokens (`cpt-noter-feature-ui-tokens-theming`)
  - Native announcement posting itself (core)

- **Requirements Covered**: Owner acceptance criterion AC5; PRD › Live copilot › Guardrails; REVIEW › F12.

- **Design Principles Covered**:

  - [x] `p1` - `cpt-noter-principle-accessible-multilingual`
  - [x] `p1` - `cpt-noter-principle-keyboard-first`

- **Design Constraints Covered**:

  - [x] `p1` - `cpt-noter-constraint-accessibility-baseline`
  - [x] `p1` - `cpt-noter-constraint-three-languages`

- **Domain Model Entities**:
  - None

- **Design Components**:

  - [x] `p1` - `cpt-noter-component-ui-primitives`

  Shares `cpt-noter-component-ui-primitives` (its **Keyboard and VoiceOver** and **Localisation rules for controls** parts) with `cpt-noter-feature-ui-primitives`; it owns no component of its own because it is a cross-cutting service that every screen calls.

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `window_announce` (M1)
  - `log_ui`

- **Sequences**:

  - None of its own; it serves the stories of the features that depend on it

- **Data**:

  - Not applicable: the UI owns no tables and reads every record through the core

- **Prototype reuse**: Source of truth only: the prototype wires `aria-*` roles, `role="status"` lines and the focus restore in `src/js/00-core.js` (`renderNow` keeps focus and selection) and `src/js/05-shell.js`; behaviour is rewritten as React hooks (`useAnnounce`, `useFocusReturn`, `usePhysicalKey`). Its single-key shortcuts are not wired (README › Not built), so DESIGN's keyboard tables are the reference there.

### 2.5 [Main window shell and navigation](features/ui/main-window-shell.md) — M0 · HIGH

- [x] `p1` - **ID**: `cpt-noter-feature-ui-main-window-shell`

- **Purpose**: Give every main-window page one frame: the Liquid Glass sidebar with the live-call row and badges, the unified toolbar with one Back and Forward history, the banner slot that shows the most severe app-level state, the inspector slot, the app menu and the collapse order.

- **Milestone**: M0. **Spec**: [`docs/features/ui/main-window-shell.md`](features/ui/main-window-shell.md). **Status**: IMPLEMENTED.

- **Depends On**: `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-primitives`, `cpt-noter-feature-ui-accessibility-l10n`

- **Scope**:
  - MW-R1 toolbar, MW-R2 sidebar (sections ⌘1 to ⌘8, badges, status footer), MW-R3 content, MW-R4 inspector slot (280, 320, 400 pt), MW-R5 banner slot with **+2 More**
  - Routing inside the main window: section memory, one Back and Forward history (D17), page registry so later features plug in their pages
  - App-level banners from `banners:changed` (self-test, calendar, update ready, quit during a recording) and `banner_dismiss`; **Restart Now** calls `update_install`
  - The native app menu items and their shortcuts (built by the core from the shell's menu model)
  - Width classes Wide, Medium and Narrow and the one collapse order; zoom to 200 %; hidden for presenting and reload states
  - The window topology rows of `cpt-noter-topology-ui-windows` for the main window
  - `cpt-noter-component-ui-mode-indicator` (all variants and its explanation popover), used from M0 by the sidebar footer and Settings › Privacy and from M1 by the call window and the menu bar

- **Out of scope**:
  - Page content (each screen feature)
  - Placing the window on a display (core)

- **Requirements Covered**: PRD › Architecture overview (UI row); PRD › Feature specification › 11 and 13 (where their app-level states appear).

- **Design Principles Covered**:

  - [x] `p1` - `cpt-noter-principle-keyboard-first`

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Banner set, privacy status, capture state (live-call row), proposal counts

- **Design Components**:

  - [x] `p1` - `cpt-noter-component-shell-main-window`
  - [x] `p1` - `cpt-noter-component-ui-mode-indicator`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `app_snapshot` (through the bridge)
  - `banner_dismiss`
  - `update_install` (Restart Now)
  - `window_navigate` and `nav:request` (M1)

- **Sequences**:

  - None of its own; it serves the stories of the features that depend on it

- **Data**:

  - Not applicable: the UI owns no tables and reads every record through the core

- **Prototype reuse**: Rewritten in React with the same structure, regions and data attributes: `src/js/04-shared.js` › `C.modeIndicator`, `overlay('mode-info')`; `src/js/05-shell.js` › `S.window`, `sidebar()`, `toolbar()`, `bannerSlot()`, `inspectorSlot()`, `SECTIONS`, `S.goSection`; styles `.np-win`, `.np-sidebar`, `.np-srclist`, `.np-tb` in `src/css/00-base.css` and `src/css/01-macos27.css` ported as-is. Not reusable: the harness bar, surface tabs, **State ▾**, **Inspect** and the component panel in the same file (prototype-only), and its `⌃1`–`⌃8` aliases (the product uses ⌘1–⌘8).

### 2.6 [First-run wizard](features/ui/first-run.md) — M0 · HIGH

- [x] `p1` - **ID**: `cpt-noter-feature-ui-first-run`

- **Purpose**: Get the Mac ready before the first call: models downloading in the background, Microphone and System Audio Recording granted, the self-test passed, the call display and audio retention chosen, so call detection is on before the first real meeting and no start control ever waits for setup.

- **Milestone**: M0. **Spec**: [`docs/features/ui/first-run.md`](features/ui/first-run.md). **Status**: IMPLEMENTED.

- **Depends On**: `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-primitives`, `cpt-noter-feature-ui-accessibility-l10n`

- **Scope**:
  - The first-run window FR-R1 to FR-R3 and steps 1 to 5 (Welcome, Models, Permissions with the self-test, Call display, Audio storage), the frame of step 6 and its privacy-mode radio group, **Skip for Now**, **Back**, **Continue**, **Finish**
  - `cpt-noter-component-ui-wizard-stepper`, `cpt-noter-component-ui-permission-check-row`, `cpt-noter-component-ui-self-test-panel` and `cpt-noter-component-ui-display-picker`, reused later by Settings and the self-test sheet
  - Resume at the step where setup stopped; closing mid-setup leaves Noter in the menu bar

- **Out of scope**:
  - Step 6 key fields (`cpt-noter-feature-ui-accounts`, M2, discrepancy 9) and own-account sign-in rows (`cpt-noter-feature-ui-accounts`, M3)
  - The Today banner after a skipped self-test (`cpt-noter-feature-ui-today`, M2); the main window's MW-R5 banner shows it in M0 and M1

- **Requirements Covered**: PRD › Live copilot › Surfaces › First run; PRD › Security, privacy and permissions.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - `cpt-noter-constraint-no-dialog-after-setup` (plain reference: its status lives in DESIGN.md and closes with the last feature that references it, M1)

- **Domain Model Entities**:
  - Setup status, model bundles, permissions, self-test state, display list, setting

- **Design Components**:

  - [x] `p1` - `cpt-noter-component-screen-first-run`
  - [x] `p1` - `cpt-noter-component-ui-wizard-stepper`
  - [x] `p1` - `cpt-noter-component-ui-permission-check-row`
  - [x] `p1` - `cpt-noter-component-ui-self-test-panel`
  - [x] `p1` - `cpt-noter-component-ui-display-picker`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `setup_status`
  - `setup_set_step`
  - `models_download`
  - `permission_request`
  - `self_test_run` (Channel `SelfTestMsg`)
  - `setup_set_call_display`
  - `setup_set_audio_storage`
  - `settings_get`
  - `settings_update` (privacy mode)
  - `levels_subscribe` (M1 in milestones.toml)
  - `open_external` (M1 in milestones.toml)
  - `window_navigate` (Finish, M1 in milestones.toml)
  - events `setup:changed`, `env:changed`, `jobs:progress`

- **Sequences**:

  - `cpt-noter-seq-first-run-complete-setup`
  - `cpt-noter-seq-first-run-download-models`

- **Data**:

  - Not applicable: the UI owns no tables and reads every record through the core

- **Prototype reuse**: Rewritten in React with the same structure and data attributes: `src/js/10-a-surfaces.js` › `surface('firstrun')` and its step renderers, `FR_STATES`; `src/js/10-a-components.js` › `C.wizardStepper`, `C.permissionCheckRow`, `C.selfTestPanel`, `C.displayPicker`. Styles `.fr-*` in `src/css/10-a.css` ported as-is. Source of truth only: the simulated timers that fake downloads and the self-test (`setInterval` in the surface).

### 2.7 [Settings window](features/ui/settings.md) — M0 · HIGH

- [x] `p1` - **ID**: `cpt-noter-feature-ui-settings`

- **Purpose**: Give every setting one home in a separate Settings window with 11 panes and a search field, applied at once, with each failure's fix beside it, and make hotkeys and card keys safe to change before a call.

- **Milestone**: M0. **Spec**: [`docs/features/ui/settings.md`](features/ui/settings.md). **Status**: IMPLEMENTED.

- **Depends On**: `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-primitives`, `cpt-noter-feature-ui-first-run`

- **Scope**:
  - The window, ST-R1 pane list with search, ST-R2 pane, ST-R3 banner slot; deep links to a pane and row
  - Panes General, Audio & Transcription (devices, output routes, transcription, glossary, permissions, self-test sheet, models), Privacy (privacy mode, audio retention, Calendar row, behaviour-metrics switch, voice-profile link), Call Screen & Menu Bar, Hotkeys, Performance and Updates
  - `cpt-noter-component-ui-hotkey-recorder` and the card-key group; test registration when the Hotkeys pane opens
  - The **Screen Share Test…** sheet in Privacy (its command `share_test_run` is placed in M2 by milestones.toml)
  - The empty frames of Models & Runtimes, Repositories, Knowledge Sources and Maintenance, which later features fill

- **Out of scope**:
  - Models & Runtimes content (`cpt-noter-feature-ui-accounts`: the API keys and Runtime per task in M2, discrepancy 9; the rest in M3)
  - What left this Mac and Knowledge Sources (`cpt-noter-feature-ui-privacy-sources`, M3)
  - Repositories (`cpt-noter-feature-ui-handoff`, M2)
  - Maintenance jobs and evidence sources (`cpt-noter-feature-ui-activity`, M5)

- **Requirements Covered**: PRD › Feature specification › 14. Settings; PRD › Security, privacy and permissions › Privacy modes.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - `cpt-noter-constraint-behaviour-metrics-off` (plain reference: its status lives in DESIGN.md and closes with the last feature that references it, M5)

- **Domain Model Entities**:
  - Setting, hotkey, glossary term, display, model bundle, permission

- **Design Components**:

  - [x] `p1` - `cpt-noter-component-screen-settings`
  - [x] `p1` - `cpt-noter-component-ui-hotkey-recorder`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `settings_get`
  - `settings_update`
  - `settings_unignore_app`
  - `hotkeys_list`
  - `hotkey_set`
  - `hotkeys_reset`
  - `glossary_list`
  - `glossary_upsert`
  - `glossary_remove`
  - `update_install`
  - `models_download`
  - `permission_request`
  - `self_test_run`
  - `setup_set_call_display`
  - `share_test_run` (M2)
  - `open_external` (M1)
  - events `settings:changed`, `hotkeys:changed`, `env:changed`

- **Sequences**:

  - `cpt-noter-seq-settings-set-hotkeys`

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-settings`

- **Prototype reuse**: Rewritten in React with the same structure and data attributes: `src/js/50-e-5-settings.js` › `surface('settings')`, `PANES`, the pane renderers `general`, `audio`, `privacy`, `callscreen`, `hotkeys`, `performancePane`, `updates`; `src/js/10-a-components.js` › `C.hotkeyRecorder`; `src/js/30-c-dialogs.js` › `dlg-selftest`, `dlg-share-test`. Styles `.st-*` and `.e-*` in `src/css/50-e.css` and `.hk-*` in `src/css/10-a.css` ported as-is.

### 2.8 [Dialogs, sheets and alerts](features/ui/dialogs-host.md) — M1 · HIGH

- [x] `p2` - **ID**: `cpt-noter-feature-ui-dialogs-host`

- **Purpose**: Show every decision that must come first in one consistent way: native alerts for irreversible actions with the safe button as default, window-modal sheets for forms, anchored popovers, and the call window's inline confirmation, and deliver the M1 alerts (delete calls, quit while recording).

- **Milestone**: M1. **Spec**: [`docs/features/ui/dialogs-host.md`](features/ui/dialogs-host.md). **Status**: IMPLEMENTED.

- **Depends On**: `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-primitives`

- **Scope**:
  - The sheet host (480 to 640 pt, busy state, focus trap), the popover host (anchor, Esc, focus return) and the alert request to the core's dialog plugin
  - The catalogue of `cpt-noter-component-screen-dialogs` as the registry later features add their sheets to
  - M1 dialogs: **Delete Call…**, **Delete…** for several calls, **Quit Noter** while recording, the inline **Discard Recording** confirmation, and the **Delete Old Audio…** sheet frame

- **Out of scope**:
  - Each later sheet's content (its feature): voice profile, regeneration, export, mappings, keys, sign-in, sources, merges

- **Requirements Covered**: PRD › Security, privacy and permissions › Deletion; D37, D38, PM-22.

- **Design Principles Covered**:

  - [x] `p2` - `cpt-noter-principle-undo-over-confirm`

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Call (delete)

- **Design Components**:

  - [x] `p2` - `cpt-noter-component-screen-dialogs`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `calls_delete`
  - `capture_discard` (inline confirm, through `cpt-noter-feature-ui-call-window`)
  - `audio_delete_older` (M2)

- **Sequences**:

  - `cpt-noter-seq-dialogs-delete-call`

- **Data**:

  - Not applicable: the UI owns no tables and reads every record through the core

- **Prototype reuse**: Rewritten in React: `src/js/05-shell.js` › `S.windowOverlays` (sheet and alert layers), `S.floatingLayer` (popovers and menus); `src/js/30-c-dialogs.js` › `dlg.deleteCall`, the `al-*` gallery entries, `dlg-delete-old-audio`; `src/js/40-d-3-library.js` › `lib.deleteAsk`. Styles `.np-sheet`, `.np-alert`, `.np-pop` (`src/css/00-base.css`, `src/css/01-macos27.css`) and `.dlg-*` (`src/css/30-c.css`) ported as-is. Source of truth only: the HTML-drawn alert, because macOS draws the real one through the dialog plugin.

### 2.9 [Record prompt](features/ui/record-prompt.md) — M1 · HIGH

- [x] `p2` - **ID**: `cpt-noter-feature-ui-record-prompt`

- **Purpose**: Let the user start recording a detected call with one click or ⌃⌥⌘R while the call app keeps focus, record it as sensitive, or stop being asked for an app, and carry the call-ended and new-meeting notices while the call window is hidden.

- **Milestone**: M1. **Spec**: [`docs/features/ui/record-prompt.md`](features/ui/record-prompt.md). **Status**: IMPLEMENTED.

- **Depends On**: `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-primitives`, `cpt-noter-feature-ui-call-window`

- **Scope**:
  - The record prompt panel (RP-R1, RP-R3) with its variants Default, Matched event, Disk full, Speech model not downloaded, System audio off, Call ended, New meeting, and the inline **Don't Ask** confirmation
  - The 15-second timeout and the countdown that pause on hover and focus
  - Native announcements on appearance (D55)

- **Out of scope**:
  - Detecting calls and placing the panel (core)
  - The **Delete Old Audio…** sheet content (`cpt-noter-feature-ui-dialogs-host`)

- **Requirements Covered**: PRD › Feature specification › 1. Capture; PRD › Live copilot › Surfaces.

- **Design Principles Covered**:

  - [x] `p2` - `cpt-noter-principle-never-steal-focus`

- **Design Constraints Covered**:

  - [x] `p2` - `cpt-noter-constraint-non-activating-panels`
  - [x] `p2` - `cpt-noter-constraint-no-dialog-after-setup`

- **Domain Model Entities**:
  - Detection, capture state, calendar event

- **Design Components**:

  - [x] `p2` - `cpt-noter-component-screen-record-prompt`
  - [x] `p2` - `cpt-noter-component-ui-record-prompt`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `capture_start`
  - `capture_dismiss_detection`
  - `capture_ignore_app`
  - `capture_answer_call_end`
  - `capture_hold_notice`
  - `capture_answer_new_meeting`
  - `window_announce`
  - `window_fit`
  - `window_navigate` (Delete Old Audio… in the main window)
  - `open_external` (Open System Settings…)
  - events `capture:detected`, `capture:state`, `env:changed`

- **Sequences**:

  - `cpt-noter-seq-record-prompt-start-recording`
  - `cpt-noter-seq-record-prompt-record-after-missed-prompt`

- **Data**:

  - Not applicable: the UI owns no tables and reads every record through the core

- **Prototype reuse**: Rewritten in React with the same structure and data attributes: `src/js/10-a-components.js` › `C.recordPrompt`; `src/js/10-a-surfaces.js` › `surface('record')`, `RP_STATES`. Styles `.rp-*` in `src/css/10-a.css` and the panel material in `src/css/01-macos27.css` ported as-is.

### 2.10 [Call window: call screen and floating panel](features/ui/call-window.md) — M1 · HIGH

- [x] `p2` - **ID**: `cpt-noter-feature-ui-call-window`

- **Purpose**: Show the live call in one non-activating window with a dedicated layout on a second display and a floating layout beside the call app, with its recording state, capture decisions, degraded states and controls, without ever taking focus from the call app.

- **Milestone**: M1. **Spec**: [`docs/features/ui/call-window.md`](features/ui/call-window.md). **Status**: IMPLEMENTED.

- **Depends On**: `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-primitives`, `cpt-noter-feature-ui-accessibility-l10n`, `cpt-noter-feature-ui-live-transcript`

- **Scope**:
  - The call window shell: layouts, layout switch on display changes, notice slot, banner slots, closing state with **Continue Recording**, hide and hide for presenting, crash recovery
  - The call screen (CS-R0 to CS-R5) and floating panel (FP-R0 to FP-R6, FP-C1 to FP-C3) in the **Copilot flag off** layout of M1
  - `capture-notice`, `recording-indicator`, `call-status-strip`, `collapsed-call-strip` and the participant `person-chip`; the mode indicator comes from `cpt-noter-feature-ui-main-window-shell`
  - Capture controls (stop, pause, mark, continue, discard, sensitive, keep or exclude a second source) and window controls (show, hide, layout, collapse, present)
  - The window topology rows of `cpt-noter-topology-ui-windows` for the call window

- **Out of scope**:
  - The council column, cards, card keys, **Catch Me Up** and the budget (`cpt-noter-feature-ui-copilot`, M4)
  - Speaker rename and term fixes (`cpt-noter-feature-ui-speakers`, M2)

- **Requirements Covered**: PRD › Feature specification › 1. Capture and 2. Live transcript; PRD › Live copilot › Surfaces; PRD › Live copilot loop › Degraded states.

- **Design Principles Covered**:

  - [x] `p2` - `cpt-noter-principle-privacy-visible`
  - [x] `p2` - `cpt-noter-principle-never-steal-focus`
  - [x] `p2` - `cpt-noter-principle-quiet-surface`

- **Design Constraints Covered**:

  - [x] `p2` - `cpt-noter-constraint-one-call-window`
  - [x] `p2` - `cpt-noter-constraint-non-activating-panels`
  - [x] `p2` - `cpt-noter-constraint-share-exclusion-limits`
  - [x] `p2` - `cpt-noter-constraint-copilot-flag`

- **Domain Model Entities**:
  - Capture state, capture notice, degraded set, call window state, presenting state, call

- **Design Components**:

  - [x] `p2` - `cpt-noter-component-shell-call-window`
  - [x] `p2` - `cpt-noter-component-screen-call-screen`
  - [x] `p2` - `cpt-noter-component-screen-floating-panel`
  - [x] `p2` - `cpt-noter-component-ui-capture-notice`
  - [x] `p2` - `cpt-noter-component-ui-recording-indicator`
  - [x] `p2` - `cpt-noter-component-ui-call-status-strip`
  - [x] `p2` - `cpt-noter-component-ui-collapsed-call-strip`
  - [x] `p2` - `cpt-noter-component-ui-person-chip`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `capture_stop`
  - `capture_set_paused`
  - `capture_mark_moment`
  - `capture_answer_call_end`
  - `capture_hold_notice`
  - `capture_answer_new_meeting`
  - `capture_continue`
  - `capture_keep_recording`
  - `capture_discard`
  - `capture_set_sensitive`
  - `capture_exclude_source`
  - `capture_keep_source`
  - `capture_resume_interrupted` (from the MW-R5 quit banner)
  - `window_show_call`
  - `window_hide_call`
  - `window_call_state`
  - `window_set_call_layout`
  - `window_set_collapsed`
  - `app_set_hidden_for_presenting`
  - `window_navigate` (Open in Noter)
  - `window_announce`
  - `open_external`
  - events `capture:state`, `degraded:changed`, `window:call`, `app:presenting`, `privacy:changed`

- **Sequences**:

  - `cpt-noter-seq-call-screen-recover-capture`
  - `cpt-noter-seq-call-screen-stop-at-call-end`
  - `cpt-noter-seq-call-screen-hide-for-presenting`
  - `cpt-noter-seq-floating-panel-display-unplugged`
  - `cpt-noter-seq-floating-panel-collapse-strip`
  - `cpt-noter-seq-floating-panel-hide-and-reopen`

- **Data**:

  - Not applicable: the UI owns no tables and reads every record through the core

- **Prototype reuse**: Rewritten in React with the same structure and data attributes: `src/js/20-b-surface.js` › `surface('call')`, the dedicated and floating layouts, the closing state; `src/js/20-b-components.js` › `C.captureNotice`, `C.callStatusStrip`, `C.collapsedCallStrip`; `src/js/04-shared.js` › `C.recordingIndicator`, `C.personChip`. Styles `.cw-*`, `.cs-*`, `.fp-*` in `src/css/20-b.css` ported as-is. Not reusable: the call window's prototype bar (`.cw-proto`: layout, output route, simulated card, card keys, make key).

### 2.11 [Live and stored transcript](features/ui/live-transcript.md) — M1 · HIGH

- [x] `p2` - **ID**: `cpt-noter-feature-ui-live-transcript`

- **Purpose**: Show a call's transcript as a virtualised log that follows live speech without jumping, with speaker, time and language on every line, gap and mark rows, **Jump to Live**, and replay that is safe: on headphones during the call, on any output afterwards.

- **Milestone**: M1. **Spec**: [`docs/features/ui/live-transcript.md`](features/ui/live-transcript.md). **Status**: IMPLEMENTED.

- **Depends On**: `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-primitives`

- **Scope**:
  - `cpt-noter-component-ui-transcript-view` (live, tail and stored variants), `transcript-segment-row`, `speaker-label` (display), `language-tag`, `playback-bar`
  - The transcript Channel: snapshot then stream, confirmed rows never move, the hypothesis row replaced, 100 ms flush, gap resubscription
  - Waiting state with the **You** and **Others** meters; play control per output route; evidence highlight

- **Out of scope**:
  - The rename popover and term fixes (`cpt-noter-feature-ui-speakers`, M2)
  - The archive-change diff marks (`cpt-noter-feature-ui-call-page-outputs`, M2)

- **Requirements Covered**: PRD › Feature specification › 2. Live transcript; PRD › Success metrics › Live.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Segment, speaker, gap, mark, output route, playback state

- **Design Components**:

  - [x] `p2` - `cpt-noter-component-ui-transcript-view`
  - [x] `p2` - `cpt-noter-component-ui-transcript-segment-row`
  - [x] `p2` - `cpt-noter-component-ui-speaker-label`
  - [x] `p2` - `cpt-noter-component-ui-language-tag`
  - [x] `p2` - `cpt-noter-component-ui-playback-bar`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `transcript_subscribe` (Channel `TranscriptMsg`)
  - `levels_subscribe` (Channel `LevelsMsg`)
  - `transcript_span`
  - `audio_play`
  - `audio_stop`
  - events `playback:state`, `capture:state` (output route)

- **Sequences**:

  - `cpt-noter-seq-call-screen-replay-line`

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-segments`, `cpt-noter-dbtable-speakers`, `cpt-noter-dbtable-marks`, `cpt-noter-dbtable-gaps`

- **Prototype reuse**: Rewritten in React with the same structure and data attributes: `src/js/20-b-components.js` › `C.transcriptView`, `C.segmentRow`, `C.playbackBar`, `routeHelp`; `src/js/04-shared.js` › `C.speakerLabel`, `C.languageTag`. Styles `.cw-tr*`, `.cw-seg*`, `.np-play*` in `src/css/20-b.css` ported as-is. The prototype draws the whole list; production adds virtualisation (DESIGN NFR) without changing the row markup.

### 2.12 [Menu bar extra](features/ui/menu-bar.md) — M1 · HIGH

- [x] `p2` - **ID**: `cpt-noter-feature-ui-menu-bar`

- **Purpose**: Let the user check and control the recording from the menu bar in one click, with four monochrome glyphs, info lines in words and actions that take effect within a second and open no dialog.

- **Milestone**: M1. **Spec**: [`docs/features/ui/menu-bar.md`](features/ui/menu-bar.md). **Status**: IMPLEMENTED.

- **Depends On**: `cpt-noter-feature-ui-core-bridge`, `cpt-noter-feature-ui-dialogs-host`

- **Scope**:
  - The content model of the native status item and menu (MB-R1 to MB-R7) per state, which the core builds (native part: Tauri tray and menu in `src-tauri`, core lane)
  - The glyph set (idle, recording, paused, copilot muted, each with the hidden form) as template images
  - The optional title, the quit alert, **Finish Setup…** and **Call Detected · Start Recording**
  - XCUITest coverage in `apps/desktop/tests/native` (ui lane)

- **Out of scope**:
  - Copilot items **Catch Me Up**, **Ask About This Call…** and **Mute Copilot ▸** behaviour (`cpt-noter-feature-ui-copilot`, M4); they are hidden while the copilot flag is off

- **Requirements Covered**: PRD › Live copilot › Surfaces › Menu bar.

- **Design Principles Covered**:

  - [x] `p2` - `cpt-noter-principle-privacy-visible`

- **Design Constraints Covered**:

  - [x] `p2` - `cpt-noter-constraint-menu-bar-template-icons`
  - [x] `p2` - `cpt-noter-constraint-no-dialog-after-setup`

- **Domain Model Entities**:
  - Capture state, detection, setup status, presenting state, degraded set; the next calendar event (MB-R6) comes with Today in M2 (owner decision A, 28 Oct 2026)

- **Design Components**:

  - [x] `p2` - `cpt-noter-component-screen-menu-bar`
  - [x] `p2` - `cpt-noter-component-ui-status-item`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - Called by the core as `Caller::Native`: capture_start, capture_stop, capture_set_paused, capture_mark_moment, capture_continue, capture_answer_call_end, capture_answer_new_meeting, window_show_call, window_set_call_layout, app_set_hidden_for_presenting, window_navigate

- **Sequences**:

  - `cpt-noter-seq-menu-bar-control-recording`
  - `cpt-noter-seq-menu-bar-check-state`

- **Data**:

  - Not applicable: the UI owns no tables and reads every record through the core

- **Prototype reuse**: Source of truth only (macOS draws the real menu): `src/js/10-a-surfaces.js` › `surface('menubar')`, `mbMenu`, `MB_STATES`, and `src/js/10-a-components.js` › `C.statusItem`, `C.statusGlyph` (whose SVG glyph paths are reused as the template image source). Styles `.mb-*` in `src/css/10-a.css` are not ported.

### 2.13 [Library: Calls list](features/ui/library-calls.md) — M1 · MEDIUM

- [x] `p2` - **ID**: `cpt-noter-feature-ui-library-calls`

- **Purpose**: Show every recorded call in a sortable, multi-select table with its status, open any call, and delete one or several calls after the native alert.

- **Milestone**: M1. **Spec**: [`docs/features/ui/library-calls.md`](features/ui/library-calls.md). **Status**: IMPLEMENTED.

- **Depends On**: `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-dialogs-host`, `cpt-noter-feature-ui-live-transcript`

- **Scope**:
  - The Calls page LC-R1 and LC-R3: month groups, columns, sort, selection, status cell, **Local only** tag, context menu **Open** and **Delete…**, ⌘⌫
  - `cpt-noter-component-ui-call-row` (table row and compact variants)
  - States No calls yet, Several calls selected, Loading, and the status cells

- **Out of scope**:
  - Filter bar, search results, topics and tags (`cpt-noter-feature-ui-library-search-topics`, M3; tag commands M2)
  - **Export…** (`cpt-noter-feature-ui-call-page-outputs`, M2)

- **Requirements Covered**: PRD › Feature specification › 5. Library and search.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Call (list view)

- **Design Components**:

  - [x] `p2` - `cpt-noter-component-screen-library`
  - [x] `p2` - `cpt-noter-component-ui-call-row`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `calls_list`
  - `call_get`
  - `call_update`
  - `call_types_list`
  - `calls_delete` (after the alert, `cpt-noter-feature-ui-dialogs-host`)
  - events `entity:changed`, `outputs:progress`

- **Sequences**:

  - None of its own; it serves the stories of the features that depend on it

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-calls`

- **Prototype reuse**: Rewritten in React with the same structure and data attributes: `src/js/40-d-2-components.js` › `C.callRow`; `src/js/40-d-3-library.js` › the Calls view and `lib.deleteAsk`. Styles `.lb-*` in `src/css/40-d.css` ported as-is.

### 2.14 [Call page frame and transcript](features/ui/call-page-frame.md) — M1 · MEDIUM

- [x] `p2` - **ID**: `cpt-noter-feature-ui-call-page-frame`

- **Purpose**: Give each call a page in the main window from M1: its toolbar and ⋯ menu (rename, call type, sensitive, delete), the banner slot, Call info, and the stored transcript with replay, so the M1 stories that start on a call's page work before the outputs arrive in M2.

- **Milestone**: M1. **Spec**: [`docs/features/ui/call-page-frame.md`](features/ui/call-page-frame.md). **Status**: IMPLEMENTED.

- **Depends On**: `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-live-transcript`, `cpt-noter-feature-ui-dialogs-host`

- **Scope**:
  - PC-R1 toolbar with the view control (only delivered views are listed), ⋯ More, inspector toggle; PC-R2 banner slot; PC-R4 Call info (participants, call, privacy, audio, processing); PC-R5 Transcript view and PC-R6 playback bar
  - The notification-permission banner after the first recorded call
  - Loading in the background after a stop without taking focus (D81); `window_report_view` for notifications

- **Out of scope**:
  - Summary, items, review, naming panel, share, Agent Reviews, History and the Handoff drawer (M2 and M4 features)

- **Requirements Covered**: PRD › Feature specification › 4. Post-call outputs (frame only); PRD › Feature specification › 2 (stored transcript).

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Call, segment, participant

- **Design Components**:

  - [x] `p2` - `cpt-noter-component-screen-call-page`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `call_get`
  - `call_update`
  - `call_types_list`
  - `capture_set_sensitive`
  - `transcript_subscribe`
  - `audio_play`
  - `audio_stop`
  - `permission_request` (notifications)
  - `banner_dismiss`
  - `window_report_view`
  - `open_external` (Show in Finder)

- **Sequences**:

  - None of its own; it serves the stories of the features that depend on it

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-call-participants`

- **Prototype reuse**: Rewritten in React with the same structure and data attributes: `src/js/30-c-callpage.js` › `screen('call-page')` toolbar, ⋯ menu, `inspector('call-info')`, the Transcript view and the notifications banner. Styles `.pc-*` in `src/css/30-c.css` ported as-is.

### 2.15 [Notifications](features/ui/notifications.md) — M1 · MEDIUM

- [x] `p2` - **ID**: `cpt-noter-feature-ui-notifications`

- **Purpose**: Tell the user that outputs are ready or failed, or that capture has a problem while no Noter surface is visible, with native notifications that carry titles and counts only, never interrupt a call and start only after the user allowed them from a call's page.

- **Milestone**: M1. **Spec**: [`docs/features/ui/notifications.md`](features/ui/notifications.md). **Status**: IMPLEMENTED.

- **Depends On**: `cpt-noter-feature-ui-call-page-frame`, `cpt-noter-feature-ui-settings`

- **Scope**:
  - The content and send rules of NT-1, NT-2 and NT-3 (built and posted by the core, native)
  - The permission request from the Call page banner, and **Notifications are off for Noter** in Settings › General
  - Clicks that open the Call page or the call window; XCUITest coverage of posting and clicks

- **Out of scope**:
  - NT-4 pre-call brief (v1.x)

- **Requirements Covered**: REVIEW › F5; PRD › Security, privacy and permissions.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - [x] `p2` - `cpt-noter-constraint-notification-limits`

- **Domain Model Entities**:
  - Call (title and counts only)

- **Design Components**:

  - [x] `p2` - `cpt-noter-component-screen-notifications`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `permission_request` (notifications)
  - `window_report_view`
  - events `nav:request`, `env:changed` (notifications off)

- **Sequences**:

  - `cpt-noter-seq-notifications-allow-notifications`

- **Data**:

  - Not applicable: the UI owns no tables and reads every record through the core

- **Prototype reuse**: Source of truth only (macOS draws notifications): `src/js/10-a-surfaces.js` › `surface('notifications')`, `NT_STATES`. Styles `.nt-*` in `src/css/10-a.css` are not ported.

### 2.16 History, change log and undo — M2 · MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-ui-history-undo`

- **Purpose**: Make every user change undoable from where it happened and from History: the undo strip, change rows, the History timeline per call, person and item, and **Export Log…**.

- **Milestone**: M2. **Spec**: [`docs/features/ui/history-undo.md`](features/ui/history-undo.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-dialogs-host`

- **Scope**:
  - `undo-strip`, `change-row`, `history-timeline`
  - Call page › History view; **Export Log…** sheet

- **Out of scope**:
  - Activity day log and batches (`cpt-noter-feature-ui-activity`, M5)

- **Requirements Covered**: PRD › Feature specification › 11. History and change log.

- **Design Principles Covered**:

  - [x] `p3` - `cpt-noter-principle-undo-over-confirm`

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Change, batch

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-ui-undo-strip`
  - [ ] `p3` - `cpt-noter-component-ui-change-row`
  - [ ] `p3` - `cpt-noter-component-ui-history-timeline`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `history_list`
  - `change_undo`
  - `change_redo`
  - `history_export`

- **Sequences**:

  - None of its own; it serves the stories of the features that depend on it

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-changes`

- **Prototype reuse**: Rewrite: `src/js/04-shared.js` › `C.undoStrip`; `src/js/30-c-0-components.js` › `change-row`, `history-timeline`; styles `.np-undo`, `.pc-hist*`.

### 2.17 Items, review and evidence — M2 · MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-ui-items`

- **Purpose**: Let the user review suggested items, tick, edit and reopen items, and open each item's evidence in one click, in rows and in the Item inspector.

- **Milestone**: M2. **Spec**: [`docs/features/ui/items.md`](features/ui/items.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-call-page-frame`, `cpt-noter-feature-ui-history-undo`

- **Scope**:
  - `action-item-row`, `item-inspector`, `provenance-chip`
  - Review with A, E, R, ⇧A; carry-forward answers

- **Out of scope**:
  - Output sections and sharing (`cpt-noter-feature-ui-call-page-outputs`)

- **Requirements Covered**: PRD › Feature specification › 4 and 10.

- **Design Principles Covered**:

  - [ ] `p3` - `cpt-noter-principle-evidence-one-click`

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Item, evidence span, evidence

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-ui-action-item-row`
  - [ ] `p3` - `cpt-noter-component-ui-item-inspector`
  - [ ] `p3` - `cpt-noter-component-ui-provenance-chip`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `items_list`
  - `item_get`
  - `item_set_done`
  - `item_review`
  - `items_review_all`
  - `item_edit`
  - `item_reopen`
  - `item_create`
  - `item_answer_handoff_landed`

- **Sequences**:

  - `cpt-noter-seq-call-page-review-suggested-items`
  - `cpt-noter-seq-call-page-check-evidence`

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-items`, `cpt-noter-dbtable-item-spans`, `cpt-noter-dbtable-evidence`, `cpt-noter-dbtable-suppressions`

- **Prototype reuse**: Rewrite: `src/js/30-c-0-components.js` › action-item rows; `src/js/30-c-callpage.js` › `inspector('item')`; `src/js/04-shared.js` › `C.provenanceChip`; styles `.it-*`, `.pc-*`.

### 2.18 Call page outputs and sharing — M2 · MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-ui-call-page-outputs`

- **Purpose**: Show the outputs in PRD order as each is written, keep edits through regeneration with a diff, and share or export the call, a section or a selection in one action.

- **Milestone**: M2. **Spec**: [`docs/features/ui/call-page-outputs.md`](features/ui/call-page-outputs.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-call-page-frame`, `cpt-noter-feature-ui-items`, `cpt-noter-feature-ui-history-undo`

- **Scope**:
  - `output-section`, `output-item-row`, `share-menu`, `version-switcher`, `diff-view`
  - Call info tags; **Delete Audio Now…** and **Delete Old Audio…**; **Export…**

- **Out of scope**:
  - Agent Reviews view content (`cpt-noter-feature-ui-copilot`)

- **Requirements Covered**: PRD › Feature specification › 4. Post-call outputs and 6. Integrations.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Summary, summary version, call tag

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-ui-output-section`
  - [ ] `p3` - `cpt-noter-component-ui-output-item-row`
  - [ ] `p3` - `cpt-noter-component-ui-share-menu`
  - [ ] `p3` - `cpt-noter-component-ui-version-switcher`
  - [ ] `p3` - `cpt-noter-component-ui-diff-view`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `outputs_get`
  - `output_edit`
  - `outputs_regenerate`
  - `output_versions`
  - `output_version_get`
  - `share_copy`
  - `calls_export`
  - `call_tags_set`
  - `tags_list`
  - `audio_delete`
  - `audio_delete_older`

- **Sequences**:

  - `cpt-noter-seq-call-page-review-outputs`
  - `cpt-noter-seq-call-page-share-outputs`
  - `cpt-noter-seq-notifications-open-outputs`

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-summaries`, `cpt-noter-dbtable-summary-versions`, `cpt-noter-dbtable-call-tags`

- **Prototype reuse**: Rewrite: `src/js/30-c-0-components.js` › `output-section`, `share-menu`, `version-switcher`, `diff-view`; `src/js/30-c-callpage.js` › Summary view; `src/js/30-c-dialogs.js` › `dlg-export`, `dlg-regenerate`; styles `.pc-sec*`.

### 2.19 Speaker naming and transcript corrections — M2 · MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-ui-speakers`

- **Purpose**: Let the user name a speaker during or after the call in one step, fix a term with the glossary, and pick or create a person without leaving the surface.

- **Milestone**: M2. **Spec**: [`docs/features/ui/speakers.md`](features/ui/speakers.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-live-transcript`, `cpt-noter-feature-ui-call-page-frame`

- **Scope**:
  - `speaker-naming-panel`, `term-fix-popover`, `person-picker` with the New person form
  - Rename popover of the speaker label

- **Out of scope**:
  - People pages (`cpt-noter-feature-ui-people`, M3)

- **Requirements Covered**: PRD › Feature specification › 2 and 4; PRD › Diarization and speaker identity.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Speaker, person, glossary term

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-ui-speaker-naming-panel`
  - [ ] `p3` - `cpt-noter-component-ui-term-fix-popover`
  - [ ] `p3` - `cpt-noter-component-ui-person-picker`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `transcript_rename_speaker`
  - `transcript_fix_term`
  - `transcript_name_speakers`
  - `people_list` (M3)
  - `person_create` (M3)

- **Sequences**:

  - `cpt-noter-seq-call-screen-name-speaker`
  - `cpt-noter-seq-call-page-name-speakers`

- **Data**:

  - Not applicable: the UI owns no tables and reads every record through the core

- **Prototype reuse**: Rewrite: `src/js/20-b-components.js` › `C.personPicker`, `overlay('speaker-rename')`, `overlay('term-fix')`; `src/js/30-c-0-components.js` › `speaker-naming-panel`; styles `.cw-pp*`, `.pc-name*`.

### 2.20 Today dashboard — M2 · MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-ui-today`

- **Purpose**: Show today's calls in calendar order with what is owed to each person, let the user tick items with **Undo**, and surface setup, quit and calendar states where the day starts.

- **Milestone**: M2. **Spec**: [`docs/features/ui/today.md`](features/ui/today.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-items`, `cpt-noter-feature-ui-call-window`, `cpt-noter-feature-ui-first-run`

- **Scope**:
  - `screen-today`, `upcoming-call-card`
  - TD-R1 **Record**, TD-R2 banners, proposals waiting line

- **Out of scope**:
  - Proposal decisions (`cpt-noter-feature-ui-activity`, M5)

- **Requirements Covered**: PRD › Feature specification › 13. Today dashboard.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Calendar event, item, call

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-screen-today`
  - [ ] `p3` - `cpt-noter-component-ui-upcoming-call-card`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `today_get`
  - `item_set_done`
  - `capture_start`
  - `permission_request` (calendar)

- **Sequences**:

  - `cpt-noter-seq-today-review-before-call`
  - `cpt-noter-seq-today-tick-item`

- **Data**:

  - Not applicable: the UI owns no tables and reads every record through the core

- **Prototype reuse**: Rewrite: `src/js/10-a-today.js` › `screen('today')`, `STATES`; `src/js/10-a-components.js` › `C.upcomingCallCard`, `NP.A.itemRow`; styles `.td-*`.

### 2.21 Handoff to Claude Code and Codex — M2 · MEDIUM

- [ ] `p3` - **ID**: `cpt-noter-feature-ui-handoff`

- **Purpose**: Turn an engineering item into an editable prompt and open it in Claude Code or Codex in the mapped repository, or copy it, with the launch path visible beforehand.

- **Milestone**: M2. **Spec**: [`docs/features/ui/handoff.md`](features/ui/handoff.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-items`, `cpt-noter-feature-ui-settings`

- **Scope**:
  - `handoff-drawer`, `prompt-editor`
  - Settings › Repositories and the **Add Mapping…** sheet

- **Out of scope**:
  - Launching the target (core)

- **Requirements Covered**: PRD › Feature specification › 9. Handoff to Claude Code and Codex.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Item, repository mapping, handoff record

- **Design Components**:

  - [ ] `p3` - `cpt-noter-component-ui-handoff-drawer`
  - [ ] `p3` - `cpt-noter-component-ui-prompt-editor`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `handoff_get`
  - `handoff_generate`
  - `handoff_edit`
  - `handoff_set_target`
  - `handoff_open`
  - `handoff_copy`
  - `handoff_cancel`
  - `repos_list`
  - `repo_upsert`
  - `repo_remove`

- **Sequences**:

  - `cpt-noter-seq-call-page-hand-off-item`

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-prompt-versions`

- **Prototype reuse**: Rewrite: `src/js/30-c-callpage.js` › `inspector('handoff')`; `src/js/30-c-0-components.js` › `prompt-editor`; `src/js/30-c-dialogs.js` › `dlg-mapping`; styles `.hd-*`.

### 2.22 Library: search, filters and topics — M3 · MEDIUM

- [ ] `p4` - **ID**: `cpt-noter-feature-ui-library-search-topics`

- **Purpose**: Find a call, quote or decision in any language with one filter state, sectioned results marked strong or weak, and follow one topic across calls with rename and merge on request.

- **Milestone**: M3. **Spec**: [`docs/features/ui/library-search-topics.md`](features/ui/library-search-topics.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-library-calls`, `cpt-noter-feature-ui-items`

- **Scope**:
  - `filter-bar`, `search-result-row`, `topic-chip`
  - Search results, Topics and Topic thread pages; tags in the Calls list

- **Out of scope**:
  - Ask (`cpt-noter-feature-ui-ask`)

- **Requirements Covered**: PRD › Feature specification › 5; PRD › Search and cross-meeting memory.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Search result, topic, call tag

- **Design Components**:

  - [ ] `p4` - `cpt-noter-component-ui-filter-bar`
  - [ ] `p4` - `cpt-noter-component-ui-search-result-row`
  - [ ] `p4` - `cpt-noter-component-ui-topic-chip`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `search`
  - `topics_list`
  - `topic_get`
  - `topic_rename`
  - `topics_merge`
  - `topics_keep_separate`
  - `call_tags_set` (M2)
  - `tags_list` (M2)

- **Sequences**:

  - `cpt-noter-seq-library-search-calls`
  - `cpt-noter-seq-library-filter-calls`
  - `cpt-noter-seq-library-follow-topic`

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-chunks`, `cpt-noter-dbtable-topics`

- **Prototype reuse**: Rewrite: `src/js/40-d-2-components.js` › `C.filterBar`, `C.searchResultRow`; `src/js/40-d-3-library.js` › search and topic views; `src/js/04-shared.js` › `C.topicChip`; styles `.lb-*`.

### 2.23 Ask — M3 · MEDIUM

- [ ] `p4` - **ID**: `cpt-noter-feature-ui-ask`

- **Purpose**: Answer questions across calls and documents with citations, follow-ups and copy, never guessing when nothing was found.

- **Milestone**: M3. **Spec**: [`docs/features/ui/ask.md`](features/ui/ask.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-live-transcript`

- **Scope**:
  - `screen-ask`, `cited-answer`
  - Threads, scope presets, streaming answer

- **Out of scope**:
  - Search results (`cpt-noter-feature-ui-library-search-topics`)

- **Requirements Covered**: PRD › Search and cross-meeting memory › Ask mode.

- **Design Principles Covered**:

  - [ ] `p4` - `cpt-noter-principle-evidence-one-click`

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Ask thread, answer, citation

- **Design Components**:

  - [ ] `p4` - `cpt-noter-component-screen-ask`
  - [ ] `p4` - `cpt-noter-component-ui-cited-answer`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `ask_start` (Channel `AskMsg`)
  - `ask_stop`
  - `ask_threads_list`
  - `ask_thread_get`
  - `ask_thread_delete`
  - `ask_scope_presets`

- **Sequences**:

  - `cpt-noter-seq-ask-cited-answer`
  - `cpt-noter-seq-ask-follow-up-and-copy`

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-ask-threads`

- **Prototype reuse**: Rewrite: `src/js/40-d-4-ask.js` › `screen('ask')`; `src/js/40-d-2-components.js` › `C.citedAnswer`; styles `.ak-*`.

### 2.24 People and Person pages — M3 · MEDIUM

- [ ] `p4` - **ID**: `cpt-noter-feature-ui-people`

- **Purpose**: Prepare a 1:1 from a Person page, turn unnamed speakers into people, and manage voice profiles, edits and merges with **Undo**.

- **Milestone**: M3. **Spec**: [`docs/features/ui/people.md`](features/ui/people.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-speakers`, `cpt-noter-feature-ui-items`, `cpt-noter-feature-ui-library-calls`

- **Scope**:
  - `screen-people` (People list and Person page)
  - Voice profile, edit details and merge sheets

- **Out of scope**:
  - Behaviour metrics rows unless switched on (D47)

- **Requirements Covered**: PRD › Feature specification › 5, Person pages.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - [ ] `p4` - `cpt-noter-constraint-behaviour-metrics-off`

- **Domain Model Entities**:
  - Person, voice profile

- **Design Components**:

  - [ ] `p4` - `cpt-noter-component-screen-people`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `people_list`
  - `person_get`
  - `person_create`
  - `person_update`
  - `people_merge`
  - `person_delete`
  - `voice_profile_create`
  - `voice_profile_delete`

- **Sequences**:

  - `cpt-noter-seq-people-prepare-one-on-one`
  - `cpt-noter-seq-people-name-unnamed-speaker`
  - `cpt-noter-seq-dialogs-set-up-voice-profile`

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-people`, `cpt-noter-dbtable-voice-profiles`

- **Prototype reuse**: Rewrite: `src/js/40-d-5-people.js` › `screen('people')`, `screen('person')`, `ppl-*` overlays; styles `.pe-*`.

### 2.25 Keys and own-account sign-in — M3 · MEDIUM

- [ ] `p4` - **ID**: `cpt-noter-feature-ui-accounts`

- **Purpose**: Store or replace API keys and sign in separately with the user's own Claude and ChatGPT accounts through Claude Code and Codex, then choose which tasks and agents use them.

- **Milestone**: M3; the API key and Runtime per task part in M2 (discrepancy 9). **Spec**: [`docs/features/ui/accounts.md`](features/ui/accounts.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-settings`, `cpt-noter-feature-ui-first-run`, `cpt-noter-feature-ui-dialogs-host`

- **Scope**:
  - `credential-row` (field and account-login forms)
  - Settings › Models & Runtimes; first-run step 6; the sign-in sheet (Prepare, Sign in, Check, Use) and the sign-out alert
  - M2 (discrepancy 9): the API-key rows and the key sheet in Models & Runtimes and first-run step 6, and **Runtime per task**, on the real core; **Remove…** and **Install Ollama…** on the fake core until M3

- **Out of scope**:
  - Agent runtime pop-up (`cpt-noter-feature-ui-agents`)

- **Requirements Covered**: PRD › Feature specification › 14; PRD › LLM orchestration; PM-58.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Account, API key presence, runtime choice

- **Design Components**:

  - [ ] `p4` - `cpt-noter-component-ui-credential-row`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it differs from the feature's):
  - `accounts_get` (M2)
  - `api_key_set` (M2)
  - `api_key_remove`
  - `account_signin_prepare`
  - `cli_install`
  - `account_signin_start`
  - `account_signin_cancel`
  - `account_use_existing`
  - `account_bind_agents`
  - `account_test`
  - `account_sign_out`

- **Sequences**:

  - `cpt-noter-seq-first-run-connect-assistant`
  - `cpt-noter-seq-settings-replace-api-key`
  - `cpt-noter-seq-settings-sign-in-account`

- **Data**:

  - Not applicable: the UI owns no tables and reads every record through the core

- **Prototype reuse**: Rewrite: `src/js/60-f-accounts.js` (sign-in sheet, account rows, `ACCOUNT_STATES`); `src/js/50-e-1-components.js` › `C.credentialRow`; styles `.f-*` (`src/css/60-f.css`).

### 2.26 Privacy audit and knowledge sources — M3 · MEDIUM

- [ ] `p4` - **ID**: `cpt-noter-feature-ui-privacy-sources`

- **Purpose**: Show what left this Mac in plain words with export, and add, sync, re-index and remove knowledge sources with their status and fix.

- **Milestone**: M3. **Spec**: [`docs/features/ui/privacy-sources.md`](features/ui/privacy-sources.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-settings`, `cpt-noter-feature-ui-dialogs-host`

- **Scope**:
  - `status-row`
  - Settings › Privacy › What left this Mac; Settings › Knowledge Sources with its sheets and alerts; storage move

- **Out of scope**:
  - Maintenance jobs (`cpt-noter-feature-ui-activity`, M5)

- **Requirements Covered**: PRD › Security, privacy and permissions › Audit log; PRD › Feature specification › 7. Knowledge sources.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Audit entry, source

- **Design Components**:

  - [ ] `p4` - `cpt-noter-component-ui-status-row`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `audit_list`
  - `audit_export`
  - `sources_list`
  - `source_add_folder`
  - `source_add_mcp`
  - `source_update`
  - `source_reindex`
  - `source_remove`
  - `source_revoke_token`
  - `storage_move` (draft)

- **Sequences**:

  - `cpt-noter-seq-settings-check-privacy`
  - `cpt-noter-seq-settings-add-knowledge-source`

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-audit-log`, `cpt-noter-dbtable-sources`

- **Prototype reuse**: Rewrite: `src/js/50-e-5-settings.js` › `privacy` audit table, `knowledge` pane, `overlay('e-source')`; `src/js/50-e-1-components.js` › `C.statusRow`; `src/js/30-c-dialogs.js` › `dlg-mcp`.

### 2.27 Live copilot cards — M4 · LOW

- [ ] `p5` - **ID**: `cpt-noter-feature-ui-copilot`

- **Purpose**: Show at most three numbered cards with provenance and agent badges, pinned or dismissed by global card keys while the call app keeps focus, with catch-up, ask-about-this-call, mute and the copilot's degraded states.

- **Milestone**: M4. **Spec**: [`docs/features/ui/copilot.md`](features/ui/copilot.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-call-window`, `cpt-noter-feature-ui-items`, `cpt-noter-feature-ui-menu-bar`

- **Scope**:
  - `copilot-card-stack`, `copilot-card`, `agent-badge`, `context-chip`
  - Council column CS-R4, FP-R2/FP-R4, collapsed-strip card line, card keys, menu bar copilot items, Agent Reviews cards

- **Out of scope**:
  - Agents screen (`cpt-noter-feature-ui-agents`)

- **Requirements Covered**: PRD › Feature specification › 3; PRD › Live copilot.

- **Design Principles Covered**:

  - [x] `p5` - `cpt-noter-principle-quiet-surface`

- **Design Constraints Covered**:

  - [x] `p5` - `cpt-noter-constraint-copilot-flag`

- **Domain Model Entities**:
  - Card, agent

- **Design Components**:

  - [ ] `p5` - `cpt-noter-component-ui-copilot-card-stack`
  - [ ] `p5` - `cpt-noter-component-ui-copilot-card`
  - [ ] `p5` - `cpt-noter-component-ui-agent-badge`
  - [ ] `p5` - `cpt-noter-component-ui-context-chip`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `cards_subscribe` (Channel `CardMsg`)
  - `card_pin`
  - `card_dismiss`
  - `card_unpin`
  - `card_undo_last`
  - `card_set_held`
  - `card_rate`
  - `card_shown`
  - `copilot_catch_up`
  - `copilot_ask_about_call`
  - `copilot_mute`
  - `copilot_mute_agent`
  - `copilot_raise_budget`
  - `context_chip_set`

- **Sequences**:

  - `cpt-noter-seq-call-screen-pin-card`
  - `cpt-noter-seq-call-screen-catch-up`
  - `cpt-noter-seq-call-screen-read-copilot-state`
  - `cpt-noter-seq-menu-bar-mute-copilot`

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-cards`

- **Prototype reuse**: Rewrite: `src/js/20-b-components.js` › `C.copilotCard`, `C.copilotCardStack`, `C.cardLegend`, `C.contextChip`; `src/js/04-shared.js` › `C.agentBadge`; styles `.cw-card*`.

### 2.28 Agents and council — M4 · LOW

- [ ] `p5` - **ID**: `cpt-noter-feature-ui-agents`

- **Purpose**: Add, edit, order and switch agents with their skill and runtime, and tune which agents run per call type.

- **Milestone**: M4. **Spec**: [`docs/features/ui/agents.md`](features/ui/agents.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-accounts`, `cpt-noter-feature-ui-copilot`

- **Scope**:
  - `screen-agents`, `agent-list-row`, `agent-editor`, `council-mode-table`

- **Out of scope**:
  - Card display (`cpt-noter-feature-ui-copilot`)

- **Requirements Covered**: PRD › Feature specification › 8. Role council.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Agent, skill, council mode

- **Design Components**:

  - [ ] `p5` - `cpt-noter-component-screen-agents`
  - [ ] `p5` - `cpt-noter-component-ui-agent-list-row`
  - [ ] `p5` - `cpt-noter-component-ui-agent-editor`
  - [ ] `p5` - `cpt-noter-component-ui-council-mode-table`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `agents_get`
  - `agent_create`
  - `agent_update`
  - `agents_reorder`
  - `agent_remove`
  - `agent_skill_get`
  - `agent_skill_save`
  - `agent_skill_reset`
  - `council_set_mode`

- **Sequences**:

  - `cpt-noter-seq-agents-add-agent`
  - `cpt-noter-seq-agents-tune-council`

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-agents`

- **Prototype reuse**: Rewrite: `src/js/50-e-4-agents.js` › `screen('agents')`; `src/js/50-e-1-components.js` › `C.agentListRow`, `C.agentEditor`, `C.councilModeTable`; styles `.ag-*`.

### 2.29 Activity, proposals and maintenance — M5 · LOW

- [ ] `p6` - **ID**: `cpt-noter-feature-ui-activity`

- **Purpose**: Let the user decide what Noter proposes, undo a batch of changes, see the day log, and manage maintenance jobs and evidence sources.

- **Milestone**: M5. **Spec**: [`docs/features/ui/activity.md`](features/ui/activity.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-history-undo`, `cpt-noter-feature-ui-settings`, `cpt-noter-feature-ui-items`

- **Scope**:
  - `screen-activity`, `proposal-row`
  - Settings › Maintenance (jobs, evidence sources)

- **Out of scope**:
  - Performance (`cpt-noter-feature-ui-performance`)

- **Requirements Covered**: PRD › Feature specification › 10 and 11; PRD › Maintenance jobs, evidence collection and history.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Proposal, change batch, job run

- **Design Components**:

  - [ ] `p6` - `cpt-noter-component-screen-activity`
  - [ ] `p6` - `cpt-noter-component-ui-proposal-row`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `proposals_list`
  - `proposal_decide`
  - `proposal_always_for_term`
  - `activity_get`
  - `jobs_list`
  - `job_run_now`
  - `job_cancel`
  - `job_update`

- **Sequences**:

  - `cpt-noter-seq-activity-review-proposals`
  - `cpt-noter-seq-activity-undo-batch`

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-jobs`

- **Prototype reuse**: Rewrite: `src/js/50-e-2-activity.js` › `screen('activity')`; `src/js/50-e-1-components.js` › `C.proposalRow`; `src/js/50-e-5-settings.js` › `maintenance` pane; styles `.ac-*`, `.e-prop*`.

### 2.30 Performance — M5 · LOW

- [ ] `p6` - **ID**: `cpt-noter-feature-ui-performance`

- **Purpose**: Show the targets, the stage timeline and the bottlenecks per period and per call, and turn a bottleneck into an improvement brief for Claude Code or Codex.

- **Milestone**: M5. **Spec**: [`docs/features/ui/performance.md`](features/ui/performance.md). **Status**: NOT_STARTED.

- **Depends On**: `cpt-noter-feature-ui-main-window-shell`, `cpt-noter-feature-ui-handoff`, `cpt-noter-feature-ui-settings`

- **Scope**:
  - `screen-performance`, `metric-tile`, `stage-timeline`, `bottleneck-row`
  - Call performance; **Export Improvement Brief…** sheet

- **Out of scope**:
  - Wall-clock measurement (core and harness)

- **Requirements Covered**: PRD › Feature specification › 12. Performance and continuous improvement.

- **Design Principles Covered**:

  - None of its own; it follows the principles of the features it depends on

- **Design Constraints Covered**:

  - None of its own

- **Domain Model Entities**:
  - Metric, roll-up, model run

- **Design Components**:

  - [ ] `p6` - `cpt-noter-component-screen-performance`
  - [ ] `p6` - `cpt-noter-component-ui-metric-tile`
  - [ ] `p6` - `cpt-noter-component-ui-stage-timeline`
  - [ ] `p6` - `cpt-noter-component-ui-bottleneck-row`

- **API** (contract commands, `contracts/ipc.manifest.json`; a milestone in parentheses is the command's own when it is later than the feature's):
  - `perf_overview`
  - `perf_call`
  - `perf_brief`

- **Sequences**:

  - `cpt-noter-seq-performance-find-bottleneck`
  - `cpt-noter-seq-performance-export-brief`

- **Data**:

  - Read through the core only; owned and decomposed by `docs/DECOMPOSITION-core.md`: `cpt-noter-dbtable-metrics`, `cpt-noter-dbtable-llm-runs`

- **Prototype reuse**: Rewrite: `src/js/50-e-3-performance.js` › `screen('performance')`; `src/js/50-e-1-components.js` › `C.metricTile`, `C.stageTimeline`, `C.bottleneckRow`; `src/js/30-c-dialogs.js` › `dlg-brief`; styles `.pf-*`.

## 3. Feature Dependencies

```text
cpt-noter-feature-ui-core-bridge ──────────────┐
cpt-noter-feature-ui-tokens-theming            │
    ↓                                          │
cpt-noter-feature-ui-primitives                │
    ↓                                          │
cpt-noter-feature-ui-accessibility-l10n        │
    ↓                                          ↓
    ├─→ cpt-noter-feature-ui-main-window-shell ─→ cpt-noter-feature-ui-dialogs-host
    │       ├─→ cpt-noter-feature-ui-library-calls      (also dialogs-host, live-transcript)
    │       ├─→ cpt-noter-feature-ui-call-page-frame    (also dialogs-host, live-transcript)
    │       │       └─→ cpt-noter-feature-ui-notifications (also settings)
    │       └─→ cpt-noter-feature-ui-history-undo
    ├─→ cpt-noter-feature-ui-first-run ─→ cpt-noter-feature-ui-settings
    ├─→ cpt-noter-feature-ui-live-transcript ─→ cpt-noter-feature-ui-call-window ─→ cpt-noter-feature-ui-record-prompt
    └─→ cpt-noter-feature-ui-menu-bar (core bridge, dialogs-host)

M2  history-undo → items → call-page-outputs;  live-transcript + call-page-frame → speakers;
    items + call-window + first-run → today;  items + settings → handoff;
    settings + first-run + dialogs-host → accounts (API key and Runtime per task part, discrepancy 9)
M3  library-calls + items → library-search-topics;  shell + live-transcript → ask;
    speakers + items + library-calls → people;  accounts (completed);
    settings + dialogs-host → privacy-sources
M4  call-window + items + menu-bar → copilot;  accounts + copilot → agents
M5  history-undo + settings + items → activity;  shell + handoff + settings → performance
```

**Dependency Rationale**:

- `cpt-noter-feature-ui-primitives` requires `cpt-noter-feature-ui-tokens-theming`: every control is drawn from the tokens, materials and radii.
- `cpt-noter-feature-ui-accessibility-l10n` requires `cpt-noter-feature-ui-primitives`: the announcement, focus and string services wrap the controls' roles.
- `cpt-noter-feature-ui-main-window-shell` requires the core bridge, the primitives and accessibility: the frame renders the app snapshot, and its routing, focus order and app menu are keyboard-first.
- `cpt-noter-feature-ui-first-run` and `cpt-noter-feature-ui-settings` are M0 because milestones.toml delivers setup, settings and hotkeys there; Settings reuses the first-run components (permission row, self-test panel, display picker).
- `cpt-noter-feature-ui-call-window` requires `cpt-noter-feature-ui-live-transcript`: both layouts embed the transcript view; `cpt-noter-feature-ui-record-prompt` reuses the call window's capture-notice content for its call-ended and new-meeting variants and opens the call window after **Record**.
- `cpt-noter-feature-ui-dialogs-host` requires the main-window shell: sheets attach under its toolbar, and the delete alerts return focus into its pages.
- `cpt-noter-feature-ui-library-calls` and `cpt-noter-feature-ui-call-page-frame` both require the dialog host (delete) and the live transcript (language tags; stored transcript).
- `cpt-noter-feature-ui-notifications` requires the Call page frame (the permission banner) and Settings (the notifications-off line).
- The core bridge and tokens are independent foundations and can be built in parallel; first run, the call window and the main-window pages can be built in parallel once the foundations exist.
- Later features plug into the shells and panes built earlier; no earlier feature depends on a later one.
