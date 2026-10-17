# Noter clickable prototype

**Status: the UI prototype of record (PM-59, 17 October 2026).** It matches `docs/DESIGN.md` v1.1 (17 October 2026, with the owner decisions of `docs/REVIEW-2026-10-17-design-core.md`) and `docs/PRD.md` as synced on 17 October 2026. DESIGN describes each screen and component in words; this prototype shows how they look and behave. The raw boards in `docs/prototype/` are kept as history only. If you find a difference between this prototype and DESIGN or the PRD, treat it as a bug in whichever is wrong and fix both in the same change.

- `noter-prototype.html` is the whole prototype in one file, with no build step and no network access. Open it in any browser.
- `src/` holds the modules it is assembled from. Run `python3 build.py` to rebuild `dist/noter-prototype.html`.

## What it covers

- **Surfaces:** the main window with all its pages, the call window in both layouts plus the collapsed strip, the record prompt, the menu bar extra, the first-run wizard, the Settings window (11 panes, using DESIGN's pane list) and notifications. 33 dialogs (sheets, alerts and popovers) open from **Dialogs ▾**.
- **Screens and states:** all 16 DESIGN screens. Every row of each screen's **States** table that looks different is selectable from **State ▾**, plus seven account states. That makes 343 screen and state combinations, all checked for errors.
- **Components:** all 75 component IDs from DESIGN 3.2 (shells, screens and complex components) and 25 of the 26 primitives appear somewhere. Help tags (tooltips) are carried as `title`/`data-help-tag` instead of `data-primitive`.
- **Clickable paths:** the main user paths of DESIGN 3.6 work end to end. For example: Record → call window → pin and dismiss cards → Stop Recording → closing state → Open in Noter → Call page → review the suggested items → hand off to Claude Code. Others: search → results → Call page at the span; Ask with citations; Person page; Activity proposals with Undo and Redo; Settings › replace a rejected API key.

## Prototype controls (the dark bar; not product UI)

| Control | What it does |
| --- | --- |
| Surface tabs | Switch between the windows and panels |
| Dialogs ▾ | Open any sheet, alert or popover from Screen — Dialogs |
| State ▾ | Show the current screen in another state from its DESIGN States table |
| Capture ▾ | Idle, recording or paused; setup scenarios (microphone access off, system audio access off, self-test not passed, no assistant). None of them blocks **Record**: a capture started with access off shows **Microphone off** or **System audio silent**, and an unpassed self-test only keeps call detection off (PM-60). Also **Claude account signed in** and **ChatGPT account signed in**; **Increase contrast** (macOS accessibility) |
| Auto / Light / Dark | Appearance |
| **Inspect** | Hover any element to see its component, primitive, variant, state and region. Click it to pin the details in the panel |
| **Components** | Lists every component kind on the current view with counts, variants and states. Click a row to highlight it |

The call window adds its own prototype bar: layout, output route (headphones, speakers, not identified), a simulated new card, card keys, and making the panel key.

## Owner decisions of 17 October (DESIGN v1.1)

The backend design review (`docs/REVIEW-2026-10-17-design-core.md`) changed these, as DESIGN's PM-60 to PM-67 describe:

- **Record always works** (PM-60). No start control reads **Finish Setup…**; it stays only as a link on Today's setup banner and in the menu bar. **Record** is dimmed only below 500 MB free (record prompt) or while the speech model downloads (Today › State ▾ › **Speech model not downloaded yet**). New call-window states **Microphone off** and **System audio silent** (renamed from System audio lost), with the indicator **Recording · no mic** or **Recording · mic only**.
- **Not recording · engine stopped** with **Try Again** (PM-67): call window, Today, menu bar and NT-3.
- **Notifications** (PM-67): NT-3 now covers system audio silent, microphone off and engine stopped; it is never held and not sent while hidden for presenting.
- **Today ranking** (PM-63): Settings › General › **Ranking** offers **Owed to today's people, then due date** (default) and **Due date, then owed to you**.
- **Agents** (PM-64): an agent switches itself off for a call type at 80 % dismissed over the last 10 calls; Agents › State ▾ › **Agent switched itself off** shows the one-time announcement with **Undo**.
- **Settings** (PM-65, PM-67): **Output devices** with **Treat as headphones** per not-identified device (no speakers-with-echo-cancellation option); the **Audio retention** line says how many calls' audio the next nightly run deletes; the talk-time footnote says the metrics count only from when they are switched on.
- **Today** quit banner: a close × ends the **Resume Recording** offer (PM-67).

## Handoff contract: which component to use

Every element that maps to DESIGN sits inside an element carrying these attributes. Use your browser's dev tools, or **Inspect**, to read them.

| Attribute | Meaning | Example |
| --- | --- | --- |
| `data-component` | The DESIGN ID of the shell, screen or component. Search `docs/DESIGN.md` for it | `cpt-noter-component-ui-copilot-card` |
| `data-primitive` | Which of the 26 primitives this is. Always paired with `data-component="cpt-noter-component-ui-primitives"` | `push-button`, `segmented-control`, `search-field` |
| `data-variant` | The DESIGN variant, in kebab case | `primary`, `call-ended`, `live-headphones`, `compact` |
| `data-size` | Size of a primitive | `small` (20), `regular` (24), `large` (28) |
| `data-state` | The DESIGN state shown | `suggested`, `ticked`, `loading`, `low-confidence` |
| `data-region` | The DESIGN layout region code | `TD-R3`, `CS-R4c`, `MW-R4` |
| `data-help-tag` | Help tag (tooltip) text | `Hide Noter for Presenting` |

Reading an element: `data-component` on the nearest ancestor tells you which component to build or reuse. Nested `data-component` elements are its parts; a primitive inside a component is built from the primitive set. For example, a copilot card is `cpt-noter-component-ui-copilot-card` (variant `call`, state `default`). Inside it are `agent-badge` (variant `interactive`), `provenance-chip` (variant `chip`) and two `push-button` primitives.

Ignore any attribute starting with `data-proto-` (actions, popover anchors, scroll keys). Ignore anything inside the dark prototype bar too. Both are prototype plumbing.

## Your own Claude and ChatGPT accounts

Settings › Models & Runtimes › **Your own accounts** has two separate rows, **Your Claude account** and **Your ChatGPT account**. You can add one, the other or both. They replace the single "Use my own Claude or ChatGPT login" switch. The same rows appear in the first-run wizard's **Assistants** step. Code: `src/js/60-f-accounts.js` and `src/css/60-f.css`.

- **Sign-in sheet**: `data-component="cpt-noter-component-screen-dialogs"`, `data-variant="sign-in-claude"` or `"sign-in-chatgpt"`, and `data-state` set to the current step. It has four steps:
  - **Prepare**: checks that Claude Code or Codex is installed and offers to install it. If the tool is already signed in on this Mac, it offers **Use This Account** without a browser. Claude also asks for a personal-use confirmation.
  - **Sign in**: opens the browser, shows a one-time code with **Copy Code**, and has **Open the Page Again**. A simulated browser lets you approve, cancel, time out, lose the connection or use an account on a free plan.
  - **Check**: signed in, then plan checked, then a test request.
  - **Use**: switch agents to the new account in one step. Agents whose runtime is down are preselected. **Undo** is offered afterwards.
- **Errors**: cancelled in the browser, timed out, no eligible plan (offers **Use Another Account** or **Use an API Key Instead**), and no connection.
- **Account row**: `cpt-noter-component-ui-credential-row`, `data-variant="account-login"`. Its `data-state` is `signed-out`, `signing-in`, `signed-in` or `expired`. When signed in it shows the account, the plan and which agents use it, with **Test** and **Sign Out…**. The sign-out alert says which agents fall back to the API key and offers to sign out of the tool too. Noter never holds the password or token; Claude Code and Codex keep the sign-in in the Keychain.
- **Choosing per agent**: the agent editor's **Runtime** pop-up groups the choices under Your accounts, API keys and On this Mac. Choices that aren't connected stay visible but disabled. When both accounts are signed in, either can be picked for any agent. The model list follows the runtime. An agent whose runtime is down gets a one-click fix, such as **Use Your ChatGPT Account** for an agent waiting on a missing Codex key.
- **Prototype controls**: **Capture ▾** has **Claude account signed in** and **ChatGPT account signed in** toggles. The State menus of Settings and Agents have seven account states: one signed in, both, both and bound to agents, session ended, tool already signed in, and Codex not installed.

DESIGN.md (PM-58, story `cpt-noter-seq-settings-sign-in-account`) and the PRD (Credentials, Feature specification 8 and 14, LLM orchestration, `agents.runtime`) describe the same behaviour.

## Visual style: macOS 27 (Liquid Glass)

The look follows Apple's macOS 27 design language from the [Apple Design Resources](https://developer.apple.com/design/resources/#macos-apps) page. The Figma and Sketch UI kit couldn't be opened from here, so the values come from Apple's published macOS system colours and from what has been published about macOS 27. Expect small differences from the kit file. The style lives in three CSS files and changes no `data-*` attribute:

- `src/css/00-base.css`, top: tokens. These are Apple system colours: label 85 %, secondary 50 % (55 % in dark), tertiary 30 % (25 % in dark), systemBlue `#007AFF`/`#0A84FF`, link `#0068DA`/`#419CFF`, systemRed, systemOrange and systemGreen. They also include Liquid Glass material tokens (`--glass-bg`, `--glass-blur`, `--glass-edge`) and corner radii: window 26, panel 20, sheet 22, card 14, row 9, control 8, tag 6, capsule.
- `src/css/01-macos27.css`: the macOS 27 layer.
  - **Windows and toolbar:** an edge-to-edge glass sidebar with coloured icons, and a unified toolbar with grouped glass capsules (back and forward, view switch, actions, search).
  - **Controls:** capsule push buttons (small 20, regular 24, large 28), capsule segmented controls with a white thumb, rounder fields, and switches with an oval thumb.
  - **Menus, sheets and alerts:** glass menus and popovers, rounder sheets, and left-aligned alerts with side-by-side buttons.
  - **Desktop:** a wallpaper behind the windows, so the glass has something to show through.

**Contrast (AC5, PM-57).** The default look uses Apple's system colours, as macOS 27 does. Some of them fall below 4.5:1 on the content background, for example the tertiary label and the warning and success text in light mode. When macOS **Increase Contrast** is on, the WCAG 2.2 AA values apply instead. They live in `src/css/02-contrast.css`:

- Tertiary text uses the secondary colour, #616161 in light mode.
- Recording and error text is #C4281C, warning text #A85A00, success text #1E7E34, and the accent #0064D1.
- Separators and control borders are stronger, the focus ring is a solid 3 pt, and the glass materials become opaque.

The file follows the system setting (`prefers-contrast: more`). **Capture ▾ › Increase contrast** switches it on in any browser. Control heights are the macOS 27 values, 20, 24 and 28, as DESIGN's Primitives section now states.

## Not built, or simplified

- **Keyboard:** single-key shortcuts (A, E, R, T, U on rows) and the app-menu shortcuts are shown but not wired. ⌘1 to ⌘8 belong to the browser, so the prototype uses ⌃1 to ⌃8. ⌃⌥⌘ call hotkeys work while the call window is showing.
- **Window sizes:** the narrow-window collapse order, toolbar overflow », text zoom and portrait displays are not built. The dedicated call screen is drawn about 1500 pt wide instead of 1920.
- **Small gaps:** Agents drag-to-reorder shows the grip but does not move rows. **Fix Term…** is a hover button on each transcript row instead of a context menu on selected text.
- **Native surfaces** (menu bar, notifications, alerts, open and save panels) are drawn to look native. In the app, macOS draws them. Alerts put the default button on the right.
- **Described in DESIGN, not built here:** the search field at the top of the **People** and **Tags** filter menus; the **Date › Custom…** range popover; the Ask recent-question context menu (**Copy Question**, **Delete**) and the **Recent ▾** pop-up at medium and narrow widths; the talk-time row on the Person page (D47, only when switched on); Return and arrow-key selection in the name picker.
- **Sample data:** all records are example data. "Today" is Thursday 16 October 2026.
