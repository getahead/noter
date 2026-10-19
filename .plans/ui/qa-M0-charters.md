# M0 UI — QA charters (ui-qa)

Owner: ui-qa. Written 18 Oct 2026 against `main` @ 5a9f2b4. Sources: `docs/TEST-PLAN.md` (M0), `docs/features/ui/{primitives,accessibility-l10n,main-window-shell,first-run,settings}.md` (flows, states, DoD, acceptance criteria), `harness/milestones.toml` [M0] (22 commands; stories `cpt-noter-seq-first-run-complete-setup`, `cpt-noter-seq-first-run-download-models`, `cpt-noter-seq-settings-set-hotkeys`), the clickable prototype `docs/prototype/clickable/noter-prototype.html`.

On a feature PR I run §0 (procedure), §1 (regression of what is delivered), §2 (cross-cutting checks), then that feature's section. **H** = happy path, **N** = negative or error path, **X** = exploratory charter (time-boxed, "explore … with … to discover …"). Every step names what I do and what must be true. A step that the PR does not deliver yet (a later milestone, or an unchecked spec step) is marked *n/a — reason* in the PR report, never silently skipped.

---

## 0. Procedure per PR

### 0.1 Set up (my worktree `~/orca/workspaces/noter/ui-qa`, mine alone)

```sh
export PATH=/opt/homebrew/bin:/usr/bin:$PATH
cd ~/orca/workspaces/noter/ui-qa
git fetch origin && git fetch origin pull/<N>/head:pr-<N> && git switch -f pr-<N>   # local branch pr-<N>; never pushed
just setup                                                                            # only when the lockfile changed
gh pr view <N> --json title,labels,files,headRefOid                                   # record the SHA I test
```

### 0.2 The gate (real exit code, never piped)

```sh
lockf ~/projects/noter-wt/.e2e.lock just gate; echo "gate=$?"
```
The QA verdict is FAIL if the gate fails for a reason inside the diff. A failure outside the diff (infra, a gate red on main too) goes to the Teamlead as *blocked*, with the log, and I go on with the charters.

### 0.3 Run the app against the fake core

```sh
cd apps/desktop
lockf ~/projects/noter-wt/.e2e.lock sh -c 'VITE_FAKE_CORE=1 pnpm exec vite --port 5173 --strictPort & V=$!; <driver>; kill $V'
```
- Windows: `http://127.0.0.1:5173/?window=<main|call-screen|record-prompt|settings|first-run>` (an unknown label opens `main`).
- **Driver** = a Playwright WebKit script in my scratchpad that opens windows the way `apps/desktop/tests/e2e/support/app.ts › openWindow` does: it routes `/src/core/fake/fake-core.ts` and appends a hook that applies a plan before the window's first command — `fail` (`FakeCore.failNext`), `contractVersion`, `latency`, plus (my addition) a `world` mutation built from `tests/support/world-presets.ts` (`idle`, `firstRun({modelsReady})`, `permission(kind,state)`, `selfTestSkipped`, `laptopOnly`, `degrade`, `recover`, `notice`, `speechModel`). Commands and event subscriptions are logged in `globalThis.__noterCalls`. For component-level checks it can also mount the real `App` over its own `createBridge(label, FakeCore)` through Vite-served modules (`import('/src/app/bridge/bridge.ts')`).
- Appearance: `page.emulateMedia({ colorScheme: 'light'|'dark', contrast: 'no-preference'|'more', reducedMotion: 'reduce' })`. Reduce transparency has no emulation in WebKit; contrast `more` triggers the same opaque treatment.
- Zoom: `document.documentElement.style.zoom = '2'` (and 1.75), viewports 1280×800, 900×700, 759×700, 700×600.
- Accessibility tree: `locator.ariaSnapshot()`; keyboard only = `page.keyboard`, no `click`.
- Evidence: screenshots and the call log in `~/projects/noter-wt/_team/ui/qa/evidence/<N>/` (PNG + JSON), referenced from the report.

### 0.4 Prototype comparison

Open `docs/prototype/clickable/noter-prototype.html` (Playwright `file://`), pick the surface tab and **State ▾**, Light/Dark, Capture ▾ › Increase contrast; **Inspect** shows component, primitive, variant, state and region. Compare: text (exact copy, the spec's bold strings), `data-component`, `data-primitive`, `data-variant`, `data-size`, `data-state`, `data-region`, element order, sizes in pt. Pixel match is the visual gate's and the designer's job; I report what a user would notice.

### 0.5 Verdict and report

- `~/projects/noter-wt/_team/ui/qa/<N>.md`: PR, SHA, gate result, a table charter → PASS / FAIL / n/a (reason), then each finding: **severity** (Blocker: a DoD or acceptance criterion fails, a crash, data loss, a security or accessibility-baseline break; Major: a spec flow or state is wrong; Minor: copy, layout, polish), repro steps, expected (with the spec line), actual, evidence.
- **QA: FAIL** while any Blocker or Major is open; otherwise **QA: PASS** (Minors listed).
- PR comment (short): `QA: PASS|FAIL — <n> blocker, <n> major, <n> minor; <n>/<n> charters run. Findings: _team/ui/qa/<N>.md` + one line per finding title. Then `orca orchestration send --type status --subject "ui-qa: PR #<N> QA <PASS|FAIL>"` to the Teamlead.
- Re-test after fixes: the same charters on the new SHA; the report gets a new dated section, the old one stays.

---

## 1. Regression of what main already delivers (every UI PR)

### 1.1 core-bridge (#36) — `cpt-noter-feature-ui-core-bridge`

| ID | Steps | Expected |
| --- | --- | --- |
| R-CB-1 H | Open each of the 5 labels `?window=<label>`; read `[data-region="window"]` | `data-window` = label, `data-state="ready"`, `aria-busy="false"`; the call log shows a `listen` for each of the 20 events **before** `app_snapshot`, and exactly one `app_snapshot`; no console error |
| R-CB-2 H | Reload `main` 10 times | `ready` every time, one `app_snapshot` per load; `localStorage`, `sessionStorage`, cookies and IndexedDB empty |
| R-CB-3 N | Plan `fail: app_snapshot not_ready` (retryable) | `data-state="failed"`, `role="alert"` with the section-level error and **Try Again**; no automatic retry; `log_ui` warn with code + command, no content; **Try Again** (click; again by Tab + Return) → `ready`, alert gone, 2 snapshots in total |
| R-CB-4 N | Plan `fail: app_snapshot window_not_allowed` | failed, no **Try Again**, `log_ui` at `error` |
| R-CB-5 N | Plan `contractVersion: <major+1>.0` | failed, no **Try Again**, `log_ui` "app_snapshot: contract X, bindings Y"; a minor-only difference → `ready` |
| R-CB-6 N | Plan `latency: 1500` | `loading` + `aria-busy="true"` until it arrives; after 300 ms the region shows skeleton rows (*n/a until a screen implements `inst-skeleton`*) |
| X-CB-1 | 20 min: explore the window **with** failures on every M0 command the PR's screen calls (`failNext` with each `ErrorCode` the command may return, retryable and not) **to discover** a typed error that falls through to a blank area, a double retry, or a stuck loading control | every error ends in a named state or the section-level error; no command runs twice without a user action |

### 1.2 tokens-theming (#30) — `cpt-noter-feature-ui-tokens-theming`

| ID | Steps | Expected |
| --- | --- | --- |
| R-TT-1 H | For each new screen: light, dark, light + contrast more, dark + contrast more | colours, borders and focus ring change live without reload; values equal the prototype's in the same state |
| R-TT-2 H | `reducedMotion: reduce`; trigger every transition the screen has (hover, banner in, status out) | no transition or animation runs except row spinners and level meters |
| R-TT-3 H | Contrast `more` (stands in for Reduce transparency) | no element has a computed `backdrop-filter` other than `none` |
| R-TT-4 N | `grep -rnE '#[0-9a-fA-F]{3,8}\b\|rgba?\(' apps/desktop/src --include=*.tsx --include=*.ts` outside `styles/` | no component file holds a literal colour |
| R-TT-5 H | `getComputedStyle(document.body)` in each appearance | the document uses the token font, label colour and window background (see main-bugs.md MB-1) |

---

## 2. Cross-cutting checks (every UI PR)

| ID | Check | How |
| --- | --- | --- |
| C-1 | Lane: the diff touches only `apps/desktop/**` minus `src-tauri`, `src/core/fake/**`, `tests/conformance` | `gh pr diff <N> --name-only` |
| C-2 | No hand edit of generated files or baselines (`contracts/**`, `bindings.ts`, `tests/visual/__screenshots__/**`) except the `update-screenshots` bot's commit | `gh pr diff`, `git log --format='%an %s' origin/main..pr-<N> -- <path>` |
| C-3 | Markers: every flow/algo/state/dod the PR implements carries `@cpt-*` with IDs from the spec; no marker removed; spec boxes ticked only for what is there | `git diff origin/main...pr-<N> \| grep -E '^[-+].*@cpt-'`; `just trace` is in the gate |
| C-4 | Tests first: unit tests for the new components; E2E titles name the story; the M0 story tests gain the TEST-PLAN *UI steps to add* for the screen the PR delivers | read the test diff |
| C-5 | No `dangerouslySetInnerHTML`, `innerHTML =`, Markdown with raw HTML | `grep -rn "dangerouslySetInnerHTML\|innerHTML" apps/desktop/src` |
| C-6 | No browser storage, no network other than the dev server and the core | grep `localStorage\|sessionStorage\|indexedDB\|document.cookie\|fetch(`; request log in the driver |
| C-7 | No console error or warning while running the charters (React key or act warnings, failed imports) | driver `page.on('console')`, `page.on('pageerror')` |
| C-8 | Keyboard only: every new control reachable by Tab/⇧Tab in visual order, operable by Space/Return/arrows, focus ring for keyboard focus only (not after a mouse click), Esc closes overlays and focus returns to the opener | driver keyboard pass with a screenshot at each stop |
| C-9 | VoiceOver roles and names as DESIGN's table; a disabled control exposes its reason as its description | `ariaSnapshot()` |
| C-10 | Hit areas ≥ 24×24 pt (including 20-pt buttons and 22-pt inline icon buttons) | `getBoundingClientRect` of every `button, [role=button], a, input`, plus any hit-extension pseudo-element |
| C-11 | Hostile text (`<img src=x onerror=alert(1)>`, `**bold**`, a 5 000-char line without spaces, RTL + Cyrillic + CJK + emoji ZWJ) in every user- or core-sourced string the screen shows (via `world` mutation) | rendered as text, no dialog, no layout break; tail-truncation with the full text in a help tag where the spec says so |
| C-12 | Zoom 200 % and widths 1280 / 900 / 759 / 700 | no horizontal scrollbar; labels whole (no ellipsis on buttons, menu items, sidebar labels) |
| C-13 | Copy: every bold string of the spec appears verbatim (curly quotes “…”, ellipsis …, sentence case) | visible text vs the spec's flow and state lists |
| C-14 | Reload mid-flow: the screen comes back from the core in the same state (nothing kept only in the UI) | `page.reload()` in each state |

---

## 3. 2.3 Primitives — `cpt-noter-feature-ui-primitives` (`docs/features/ui/primitives.md`)

Preconditions: the PR delivers `apps/desktop/src/ui/primitives/*`, `apps/desktop/src/ui/feedback/*` and the primitives page (the visual fixture `tests/visual/fixtures/primitives.html` becomes it). I open that page in Vite (path from the PR) or mount each primitive through the driver.

**Happy paths**

| ID | Steps | Expected (spec) |
| --- | --- | --- |
| PR-H1 | For each of the 26 primitives × each variant × each size (20, 24, 28, 32) × each state, read the root's attributes; open the same primitive in the prototype (Inspect) | `data-component="cpt-noter-component-ui-primitives"`, `data-primitive`, `data-variant`, `data-size`, `data-state` identical to `src/js/02-primitives.js` (AC 1) |
| PR-H2 | Push button: pointer in (wait 120 ms), press, release; then Tab to it and Space; then Return in a region with a default button | HOVER → PRESSED → handler called once; Space runs it; Return runs only the default button; focus ring on keyboard focus only (`inst-feedback`) |
| PR-H3 | Owner puts the button in LOADING; click it and press Space twice more | spinner replaces the icon, label stays, width unchanged; handler not called again (`inst-if-disabled`) |
| PR-H4 | Segmented control, radio group, table, source list, menu: Tab in, then ←/→/↑/↓, Home/End | selection or focus moves with the arrow keys; one Tab stop per composite |
| PR-H5 | Inline banner with an action: click it | WORKING (the action shows loading), then RESOLVED when the owner removes it |
| PR-H6 | Info and success banners: click ×; again by Tab to × then Esc; then Tab + Return | DISMISSED, hidden until the event happens again; warning, error and degraded have no × (except **Noter quit during …**) |
| PR-H7 | Inline status in each variant (on the label, trailing, blind feedback, row outcome, notice); trigger **Copy** | glyph + text in `role="status"`; focus never moves; gone after 2 s (label, notice), 3 s (blind feedback), 10 s (row outcome); the label returns; no other element moves (compare rects before and after) |
| PR-H8 | Row outcome with **Undo**: hover it at 8 s for 5 s, leave; then focus it by Tab | timer paused while hovered or focused (PAUSED), resumes on leave; **Undo** runs once and hides it |
| PR-H9 | Empty state: first use, filtered empty, section line, large area | copy and markup as `C.emptyState` |

**Negative cases**

| ID | Steps | Expected |
| --- | --- | --- |
| PR-N1 | Disabled push button with a reason: hover, click, Tab, Space | no action; looks disabled by more than colour; the reason is the help tag and the accessible description; check DESIGN's table for whether it stays focusable |
| PR-N2 | One slot gets 4 banners in the order info, error, warning(1), warning(2), degraded | the error shows; **+N More** carries the real count of the rest (check it is not a literal "+2"); opening it lists warning(1), warning(2), degraded, info: severity first, core order within a severity (`inst-keep-order`); never two banners at once (AC 4) |
| PR-N3 | A banner action fails (the owner reports failure, the cause remains) | back to SHOWN with its actions enabled; no second banner |
| PR-N4 | A banner given 4 actions | at most 3 rendered (spec: up to three); report what happens to the 4th |
| PR-N5 | Labels that do not fit: segmented control at 200 px; footer with 3 long buttons at 300 px; table cell with 300 chars | segmented → popup-button with the same options; footer stacks with the default button **last**; push buttons hug their label, ≥ 56 pt at regular size, never truncate; table cells tail-truncate with the full text in a help tag and the accessible name |
| PR-N6 | Hostile strings (C-11) in every text-bearing primitive: button label, banner title and sentence, empty state, table cell, menu item, badge, text field value, help tag | rendered as text; the DoD `text-only` security test exists and covers them |
| PR-N7 | A failure reported through the inline status | not allowed: failures use the banner (check the owners in the PR) |

**Exploratory charters**

- **X-PR-1 (45 min)** Explore every primitive **with** keyboard only and the accessibility tree **to discover** controls without a role or name, without a visible focus ring, a tab trap, or focus lost after an action.
- **X-PR-2 (30 min)** Explore the four appearance states and Reduce motion **with** the primitives page next to the prototype **to discover** colours, borders, radii, spacing or focus rings that differ (glass materials opaque under contrast).
- **X-PR-3 (20 min)** Explore timers **with** rapid repeats (Copy 5× in 1 s, Undo at 9.9 s, hover in and out at the boundary, window blur during the timer) **to discover** stacked statuses, timers that never fire or fire twice, state updates after unmount (console warnings).
- **X-PR-4 (20 min)** Explore hit areas **with** 20-pt and 22-pt controls at 100 % and 200 % zoom **to discover** targets below 24×24 pt or overlapping neighbours.

DoD/AC coverage: `dod-ui-primitives-controls` → H1–H4, N1, N5, X-PR-1, X-PR-4; `dod-ui-primitives-feedback` → H5–H9, N2–N4, X-PR-3; `dod-ui-primitives-text-only` → N6; the screenshot AC → visual gate + X-PR-2.

---

## 4. 2.4 Accessibility, keyboard and localisation — `cpt-noter-feature-ui-accessibility-l10n`

Preconditions: `src/app/a11y/{announce,focus,keys}.ts`, `src/i18n/*`. `window_announce` is an M1 command: check what the PR does with it on M0.

**Happy paths**

| ID | Steps | Expected |
| --- | --- | --- |
| AL-H1 | Call the announcement service from `main` (key) for each event of DESIGN's announcement table | text written once into the polite or assertive live region; assertive only for capture failures and capture decisions (call ended, new meeting) |
| AL-H2 | The same event twice | announced once (D56) |
| AL-H3 | From `call-screen` and `record-prompt` while not key (the PR's "is key" input false), then while key | not key → `window_announce` with text and politeness, nothing in the live region (D55); key → live region |
| AL-H4 | Open a popover, sheet, menu, inspector by keyboard; close by Esc; again by a click outside; again by its action | first control focused on open; focus back on the opener every time (IN_PAGE → IN_OVERLAY → RETURNED) |
| AL-H5 | Physical keys: dispatch `KeyboardEvent` with `code: 'KeyA'`, `key: 'ф'` (Russian) and `code: 'KeyZ'`, `key: 'y'` (German) against the single-key table (A, E, R, T, U) and a ⌘ shortcut | matched by `code`, not by `key` |
| AL-H6 | Format: plurals (0, 1, 2, 5, 21), dates in en-US and de-DE, 12/24-hour preference, call-relative HH:MM:SS, durations (**48 min**), money in USD | correct per catalogue; no sentence assembled by concatenation (the PR's lint rule) |
| AL-H7 | A string quoting user text | wrapped in “…” with its own `lang` attribute |

**Negative cases**

| ID | Steps | Expected |
| --- | --- | --- |
| AL-N1 | Give the service a transcript line, a level-meter value, a clock tick, countdown seconds | nothing announced (AC 1) |
| AL-N2 | Text field focused, press a single-key shortcut (A) | typing wins: the character is typed, the action does not run; ⌘/⌃ shortcuts still work |
| AL-N3 | Sticky header + undo strip + banner over a list; Tab down the list | the focused row stays clear of sticky parts (WCAG 2.4.11): its rect never intersects them |
| AL-N4 | Close an overlay whose opener was removed meanwhile | focus goes to a sensible fallback (the page heading), not `body`; report what happens |
| AL-N5 | macOS keyboard navigation off (D51): Tab through a page | Tab reaches every control (links, toggles), not only text fields |
| AL-N6 | Pseudo-localised build (+40 %, Cyrillic) and the German pass, when the PR adds them; add a deliberately long string | no truncated button, menu item or sidebar label in the screenshot suite (AC 4); the suite fails on the long string |
| AL-N7 | Content blocks without `lang` | every content block carries `lang` (AC 5); query by the PR's convention |

**Exploratory charters**

- **X-AL-1 (30 min)** Explore the announcement service **with** bursts (10 events in 100 ms, same and different ids, polite and assertive mixed) **to discover** dropped, merged or repeated announcements, and live regions re-created on each render (VoiceOver ignores text in a new region).
- **X-AL-2 (30 min)** Explore every shipped screen **with** keyboard only on Russian and German layouts (dispatching `code`/`key` pairs) **to discover** unreachable controls, traps and shortcuts firing inside text fields.
- **X-AL-3 (20 min)** Explore the catalogue **with** a grep for hard-coded English in `apps/desktop/src/**/*.tsx` **to discover** strings outside the catalogue.

DoD/AC coverage: `dod-…-announce` → H1–H3, N1, X-AL-1; `dod-…-keyboard` → H4, H5, N2–N5, X-AL-2; `dod-…-strings` → H6, H7, N6, N7, X-AL-3.

---

## 5. 2.5 Main window shell — `cpt-noter-feature-ui-main-window-shell`

Preconditions: `?window=main`. The fixture world starts **mid-call** (`call_live` recording, "Planning: VHI 8.0 drawer redesign"); preset `idle` for the idle frame. M0 commands: `banner_dismiss`, `update_install`; `window_show_call`, `window_navigate` and `nav:request` are M1 (check how the PR handles them: hidden, disabled with a reason, or `not_implemented` handled).

**Happy paths**

| ID | Steps | Expected |
| --- | --- | --- |
| MW-H1 | Open main with `idle` | LOADING → READY; glass sidebar, 8 sections in 3 groups with badges (VoiceOver "Activity, 3 waiting, 1 problem"), status footer with the mode indicator's sidebar variant (**Idle · API key · local fallback ready** or the fixture's mode), 56-pt unified toolbar with Back/Forward in one capsule, 240–360-pt search field, empty banner slot; regions, classes and data attributes as `S.window`, `sidebar()`, `toolbar()`, `bannerSlot()`, `inspectorSlot()` |
| MW-H2 | Press ⌘1 … ⌘8 | each section opens at its root (or its last location); sidebar marks it; focus on the page heading; a section whose feature is not shipped shows an empty state naming it, never a blank area |
| MW-H3 | Section A → push a page → section B → ⌘[ twice → ⌘] | one history across sections: back to the pushed page, then A's root; Forward re-applies; Back disabled at the start, Forward at the end |
| MW-H4 | ⌘3 → scroll Calls, set a query and filter → ⌘1 → ⌘3; then open a row and Back | Calls at the last location with query, filters and scroll (AC 3); *n/a until a list page exists* |
| MW-H5 | Fixture world (recording); then pause; then `idle` | live-call row (recording indicator, **● Planning · 23:14** style) at the top of the source list and footer **Recording · Planning**; **Paused** instead of the time while paused; row gone after stop (CAPTURING ↔ READY) |
| MW-H6 | Preset `selfTestSkipped` | MW-R5: **Call detection is off until the audio self-test passes** · **Run Audio Self-Test…** · **Finish Setup…** |
| MW-H7 | Update-ready banner **Version 1.2 installs on next launch** · **Restart Now**: click | `update_install` once; the button shows loading; the banner leaves when the core reports |
| MW-H8 | Mode indicator: click; then Space; then Return | popover **Cloud with redaction: names and PII are replaced before anything leaves this Mac** + **Open Privacy Settings**; Esc closes, focus back on the indicator; accessible name "Mode: cloud with redaction" |
| MW-H9 | ⌃⌘S, ⌥⌘I, ⌘F, ⌘,, ⌘W | sidebar hides and shows; the others routed; the app menu model (Noter, File, Edit, View, Call, Window, Help with shortcuts) is published for the core |
| MW-H10 | Width 1280 → 1100 → 1099 → 900 → 899 → 760 → 759 | Wide ≥ 1100, Medium 760–1099, Narrow < 760 (content width = window − sidebar − docked inspector); collapse order: inspector overlays, grids one column, low-priority columns hide, sidebar becomes an overlay below 900 pt or at zoom ≥ 175 %; toolbar overflow » from the trailing side; Back, title and primary action never overflow |
| MW-H11 | Zoom 200 % | reflow without horizontal scrolling |

**Negative cases**

| ID | Steps | Expected |
| --- | --- | --- |
| MW-N1 | `update_install` fails retryable, then not retryable | the banner keeps its action, with **Try Again** when retryable; one call per click, never automatic |
| MW-N2 | 3 app banners (error, warning, info) | the error shows with **+2 More** listing the rest by severity; resolve two → ONE; dismiss the info → EMPTY |
| MW-N3 | **Noter quit during …** banner: × | dismissed, its **Resume Recording** offer ends (PM-67); `banner_dismiss` sent once |
| MW-N4 | `degrade(switched_to_local)` then `recover`; `degrade(no_assistant)` | warning glyph + word **Switched to local** / **No assistant**, the reason not in the popover; back to cloud with redaction on recovery; never colour alone; no council-mode words |
| MW-N5 | `app:presenting` hidden while READY and while CAPTURING; then shown | HIDDEN_FOR_PRESENTING; back exactly as it was (selection, scroll) |
| MW-N6 | Click the live-call row | `window_show_call` (M1) without taking focus, sidebar selection kept; on M0 report how the PR handles it |
| MW-N7 | ⌘[ at the first entry, ⌘] at the last, ⌘9 | nothing happens, no error |
| MW-N8 | Slow snapshot (latency 1500) | skeleton rows after 300 ms ("Window reloaded"), not a blank frame |

**Exploratory charters**

- **X-MW-1 (40 min)** Explore navigation **with** fast key sequences (⌘1–⌘8, ⌘[, ⌘] mashed), reloads in between, pages pushed from several sections **to discover** history corruption, a wrong section marked, focus lost to `body`, or an inspector left open on the wrong page.
- **X-MW-2 (30 min)** Explore app-level events **with** `banners:changed`, `capture:state`, `privacy:changed`, `degraded:changed` arriving out of order and with stale versions **to discover** a frame showing an older state than the core.
- **X-MW-3 (30 min)** Explore widths, zoom and pseudo-localised labels **with** every width-class boundary ±1 px **to discover** truncated sidebar labels, group headers or toolbar buttons (AC 5) and overlapping controls.
- **X-MW-4 (20 min)** Compare idle, capturing, banner, several banners and Narrow with the prototype states (App-level banner, Switched to local, No assistant, Capturing, Hidden for presenting, Update ready, Reopened after a quit, Window reloaded).

DoD/AC coverage: `dod-…-frame` → H1, H5–H7, N1–N3, N5, N8; `dod-…-navigation` → H2–H4, H9, N7, X-MW-1; `dod-…-collapse` → H10, H11, X-MW-3; `dod-…-mode-indicator` → H8, N4.

---

## 6. 2.6 First-run wizard — `cpt-noter-feature-ui-first-run`

Preconditions: `?window=first-run`, preset `firstRun({ modelsReady: false })` (or `true`), `permission(kind, state)`, `speechModel`, `laptopOnly`. Stories `cpt-noter-seq-first-run-complete-setup` and `cpt-noter-seq-first-run-download-models` (`tests/e2e/m0-first-run.spec.ts`; the PR adds the TEST-PLAN *UI steps* to them). Prototype: surface **First run**, State ▾ = the 18 `FR_STATES`. `open_external`, `levels_subscribe` and `window_navigate` are M1.

**Happy paths**

| ID | Steps | Expected |
| --- | --- | --- |
| FR-H1 | Open first-run on a fresh world | `setup_status` called; **Welcome to Noter**; stepper with the 6 steps, Welcome current |
| FR-H2 | **Continue** | `setup_set_step` (models); Models lists **Speech model · WhisperKit Large v3 Turbo** 1.5 GB, **Speaker model** 0.1 GB, **Search model** 0.4 GB; `models_download` (start) once, not when the core already downloads; **About 2 GB** · **Pause**; **Continue** enabled at once |
| FR-H3 | Push `jobs:progress`; **Pause**, **Resume** | per-row percentage, then **Ready**; Pause and Resume call `models_download` pause/resume; the footer button flips |
| FR-H4 | **Continue** during downloads | Permissions; the stepper shows the background ring on **Models** with **Downloading in the background · 64 %**; when every bundle is in, **Models** done and "Models downloaded" announced politely once |
| FR-H5 | **Allow…** beside **Microphone** | `permission_request` (microphone) only now (AC 2: no prompt before **Allow…**); granted → the row granted (meter and **Hearing you** need `levels_subscribe`, M1: report) |
| FR-H6 | System audio starts MISSING; `change` to granted + `setup:changed` | **Checking…** with a spinner, then **Granted**; **System audio recording is not allowed yet.** goes; **Run Test** enabled (dimmed before) |
| FR-H7 | **Run Test** | `self_test_run` Channel: **You** and **Others** meters (≤ every 100 ms), the line "Noter test. Привет. Hallo." with a `lang` per part, ticks **System audio arrives**, **Your microphone arrives**, **Both streams line up**, fourth line **Noter's own sounds stay out of the recording**; **Self-test passed** with **Details**; each result line announced once, then "Self-test passed"; the transcript line **never** announced; **Permissions** marked done |
| FR-H8 | **Continue** → **Call display** (2 displays) | **The display without the call app** (default, **Recommended**), then each display by name with **· Call app is here**; **Open the call screen automatically** on; **Continue** → `setup_set_call_display` (display identity, open automatically) |
| FR-H9 | **Audio storage** | radio group **Keep audio for 30 days** (default), **7 days**, **90 days**, **Forever**, **Never store audio**; a choice → `setup_set_audio_storage` |
| FR-H10 | **Assistants** | the step 6 frame: account cards (keys M2, sign-in M3, frames only), the **Local runtime** line, **Privacy mode** radio group; a change → `settings_update` (privacy section + `rev`) |
| FR-H11 | **Finish** | `setup_set_step` (done); the main window opens (Today via M1 `window_navigate`: report the M0 behaviour); call detection on |
| FR-H12 | Close the window at step 3, reopen | resumes at the same step (resumed stepper variant) (AC 4) |
| FR-H13 | Click a done step in the stepper; **Back** | goes back; later choices kept |

**Negative cases**

| ID | Steps | Expected |
| --- | --- | --- |
| FR-N1 | Microphone denied after **Allow…** (`permission(microphone, denied)`) | **Microphone · not allowed** + **Open System Settings…**; on return (window focus) **Checking…**, then **Granted** or back to MISSING |
| FR-N2 | Self-test with one stream silent | **We hear your microphone but not system audio. Play any sound in another app and try again.** (and its mirror for the mic); **Run Test** runs again (FAILED → RUNNING) |
| FR-N3 | **Skip for Now** on Permissions (step 3), and on Call display (step 4) | `setup_set_step` (skip); a dash on the stepper; after **Finish**, main shows **Call detection is off until the audio self-test passes** · **Run Audio Self-Test…** · **Finish Setup…**; **Record** still works |
| FR-N4 | Offline (`models_download` → `offline`) | **Waiting for a connection — downloads resume automatically**; nothing to do; resumes on reconnect |
| FR-N5 | `disk_full` | error banner in FR-R2 **Needs 2.1 GB, 1.4 GB free** · **Try Again** → `models_download` again, one call per click |
| FR-N6 | `checksum_failed` on one bundle | **Check failed** · **Try Again** on that row, its bar stopped; after moving on, **Models** shows the error glyph; clicking it goes back to Models (ERROR → CURRENT) |
| FR-N7 | **Run Test** before the speech model is in | **Waiting for the speech model · 62 %**, then runs by itself (WAITING_FOR_MODEL → RUNNING); note the TEST-PLAN gap: the fake's self-test ignores the speech model |
| FR-N8 | Permission missing at the self-test | meters at zero; **Play Test Clip** and **Run Test** dimmed with the reason; **System audio recording is not allowed yet.** + **Open System Settings…** |
| FR-N9 | Exclusion off, then exclusion failed, in `passed` | fourth line **Noter's own sounds are recorded. Replay while recording stays off. Change this in Settings › Audio & Transcription.** / **Noter's own sounds reached the recording. Replay while recording stays off until this passes.**; the test still passes |
| FR-N10 | `laptopOnly` (one display) | one-display variant: one rectangle, the floating-layout note and drawing, only the default option |
| FR-N11 | Remembered display not connected | **LG UltraFine 5K (not connected)** in secondary text, still selectable; the list redraws in place on `env:changed` |
| FR-N12 | No key, no account, no local runtime | **Without an assistant Noter still records and transcribes; summaries wait until one is connected.**; **Finish** stays enabled |
| FR-N13 | Downloads running at every step | **Continue** never disabled by a download (AC 3) |
| FR-N14 | `settings_update` → `conflict` on privacy | the control returns to the stored value, error under the row |

**Exploratory charters**

- **X-FR-1 (45 min)** Explore the wizard **with** reloads, close and reopen, and Back at every step and download state **to discover** a wrong resume, a lost choice, a duplicate `models_download`, or **Continue** disabled.
- **X-FR-2 (30 min)** Explore the self-test **with** Channel messages out of order, a `seq` gap, `ended` without `passed`, and a second **Run Test** while running **to discover** a stuck RUNNING state, double ticks, or a Channel left open after leaving the step (`stream_unsubscribe`).
- **X-FR-3 (30 min)** Compare the 16 step-1-to-5 `FR_STATES` with the prototype in light and dark (AC 1); keyboard only through the whole wizard.
- **X-FR-4 (20 min)** Explore announcements **with** the accessibility tree and the live regions **to discover** a result line announced twice, the transcript line announced, or "Models downloaded" repeated.

DoD/AC coverage: `dod-…-window` → H1, H2, H8–H13, N3, N12–N14; `dod-…-models` → H2–H4, N4–N7; `dod-…-components` → H5–H7, N1, N2, N8–N11, X-FR-2, X-FR-4.

---

## 7. 2.7 Settings window — `cpt-noter-feature-ui-settings`

Preconditions: `?window=settings`. Story `cpt-noter-seq-settings-set-hotkeys` (`tests/e2e/m0-settings-hotkeys.spec.ts`). Fixture: the nine default hotkeys with `ask_about_call` in conflict with Raycast; settings `rev` > 0, retention 30 days, Spotify ignored, Exclude Noter's own sounds on. Prototype: surface **Settings**, State ▾ (`hk-voiceover`, `hk-nomod`, `hk-card-conflict`, `self-test`, `notifications-off`, `icloud`, `model-downloading`, `display-absent`, `one-display`, `update-ready`, `no-match`, `calendar-off`). `share_test_run` is M2, `open_external` M1.

**Happy paths**

| ID | Steps | Expected |
| --- | --- | --- |
| ST-H1 | Open Settings | 820×620 (minimum 700×480); ST-R1 search + the 11 panes in order General, Audio & Transcription, Models & Runtimes, Privacy, Call Screen & Menu Bar, Hotkeys, Repositories, Knowledge Sources, Maintenance, Performance, Updates; `settings_get` **once** per window; grouped inset form ≤ 560 pt |
| ST-H2 | ↑/↓ in the pane list; scroll a pane, switch away and back | panes switch; each pane keeps its scroll position |
| ST-H3 | **Hotkeys** | `hotkeys_list`; one row per global hotkey in sentence case with key caps; group **Card keys during calls** (**Use card keys during calls**, **Pin a card** with **+ 1, 2 or 3**, **Dismiss with keys** off, **Dismiss a card** derived, **Undo last card action**); **Restore Defaults** and the footnote; the Raycast conflict line under its row |
| ST-H4 | Click the **Catch me up** field; again with Return and with Space on it | focus ring + **Type a shortcut…** (RECORDING) |
| ST-H5 | Press ⌃⌥⌘U | `hotkey_set` (catch_me_up, `Ctrl+Alt+Super+U`); the row shows ⌃⌥⌘U; `hotkeys:changed` updates the labels in other windows |
| ST-H6 | **Restore Defaults** | `hotkeys_reset`; the set re-checked and re-rendered |
| ST-H7 | A toggle, pop-up, radio group and slider in General, Audio, Call Screen, Updates | applies at once (no Save): `settings_update` with the **whole section** as wanted state and its `rev`; `settings:changed` → the stored value shown; survives a reload (AC 2) |
| ST-H8 | General › **Apps Noter doesn't ask about** › Spotify › **Remove** | `settings_unignore_app` (bundle id); row gone |
| ST-H9 | Glossary **+**, edit, **−** | `glossary_upsert` / `glossary_remove`; list from `glossary_list` |
| ST-H10 | Search "shortcut", "retention", "MIC" | panes whose name or keywords match, ignoring case, as the prototype's `PANES` (AC 4) |
| ST-H11 | Updates › **Check Now**; **Restart Now** when an update waits | **Noter is up to date**; `update_install` |
| ST-H12 | Privacy pane | **Privacy mode** with the mode indicator in force; **Audio retention** with the next-nightly-run line; **Calendar** row (**Allow Calendar Access** → `permission_request` calendar); behaviour-metrics switch off by default, its rows absent until on, with its footnote; **Voice profiles** + **Manage on Person Pages**; the **What left this Mac** frame (M3) |
| ST-H13 | **Screen Share Test…** | 640-pt sheet **What a share would show** with **Hidden / Visible / May be visible** per surface and share type; limits line ending **Share a window, not a display, or press** ⌃⌥⌘0 **to hide Noter.**; **Run Capture Test** (M2: report its M0 state); **Done** returns to Privacy with focus on the opener |
| ST-H14 | Models & Runtimes, Repositories, Knowledge Sources, Maintenance | a frame stating the later milestone, never blank (AC 5) |

**Negative cases**

| ID | Steps | Expected |
| --- | --- | --- |
| ST-N1 | Record a chord without ⌘/⌥/⌃ (⇧K, plain K) | **Add Command, Option or Control**; the old chord stays; no `hotkey_set` (AC 3) |
| ST-N2 | Esc while recording | cancel: the old chord stays, recording ends; Tab leaves the field (no trap) |
| ST-N3 | ⌫ while recording, and **Clear shortcut** | **None**; menus show the item without a key |
| ST-N4 | VoiceOver on (the PR's VO-state input) + ⌃⌥X | **Used by VoiceOver** under the row, old chord kept, the pane's VO-Tab note; a different chord clears it |
| ST-N5 | `hotkey_set` → `hotkey_reserved` (Minimize) and `hotkey_conflict` | old chord kept; conflict line (**Used by macOS for Minimize**) announced politely |
| ST-N6 | Card key ⌃⌥⌘3 held by another app | **Card key** ⌃⌥⌘3 **is used by another app** under **Pin a card**; free it (`change`), reopen Hotkeys → the line is gone |
| ST-N7 | Search "zzzz" | **No settings match “zzzz”** in place of the pane list; × clears it back to all 11 panes |
| ST-N8 | `settings_update` → `conflict` (stale `rev`), then `invalid_input` | the control returns to the stored value, error under the row, no automatic retry |
| ST-N9 | Self-test not passed | **Offer to record when a call starts** disabled with **Needs a passed audio self-test** · **Run Audio Self-Test…** (opens the self-test sheet: the first-run panel, sheet variant) |
| ST-N10 | Storage location in iCloud Drive or Dropbox | the warning line under the path |
| ST-N11 | **Use card keys during calls** off; **Dismiss with keys** off | card rows DISABLED and back to IDLE when on; **Dismiss a card** disabled while **Dismiss with keys** is off |
| ST-N12 | During a recording: **Run Capture Test** | disabled with **Run the test when no call is being recorded.**; the table still answers |
| ST-N13 | Two windows change the same section | the second writer gets `conflict` or the latest `settings:changed`; no lost update shown as saved |

**Exploratory charters**

- **X-ST-1 (45 min)** Explore the hotkey recorder **with** every modifier combination, function keys, a Russian layout (`code`/`key` pairs), key repeat, and clicking another field while recording **to discover** a chord accepted without a modifier, a stuck RECORDING state, a wrong letter shown, or a refused chord shown as saved.
- **X-ST-2 (30 min)** Explore changing settings **with** fast toggling (10 clicks in 1 s), reloads and conflicts **to discover** lost writes, `rev` errors shown as success, or a control out of step with `settings:changed`.
- **X-ST-3 (30 min)** Compare every pane and the prototype's `ST` states in light, dark and contrast; keyboard only through every pane; a narrow window (below 600 pt: labels above controls).
- **X-ST-4 (20 min)** Explore search **with** punctuation, quotes, emoji, Cyrillic and 200 characters **to discover** crashes, broken quoting in **No settings match “…”**, or a pane list that does not come back.

DoD/AC coverage: `dod-…-window` → H1, H2, H7–H11, H14, N7–N10, N13; `dod-…-hotkeys` → H3–H6, N1–N6, N11; `dod-…-privacy` → H12, H13, N12.

---

## 8. Known gaps of the fake core (TEST-PLAN.md › Requests 7) — not UI bugs

The fake does not check disk space in `models_download`, its self-test ignores the speech model's state, it does not re-evaluate the call layout when displays change, never sets `show_share_warning` or `chosen_display_missing`, and has no download scheduler (the *No connection* test sends the resume itself). When a charter needs one of these, I set the state by a `world` mutation or `failNext` and say so in the report; a new gap goes to the Teamlead for the Backend Teamlead.
