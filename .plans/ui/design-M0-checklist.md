# M0 design-fit checklist

18 October 2026. Review aid, not a change to DESIGN or FEATURE behaviour. Apply to the exact PR head; record OK / CHANGES, concrete location, state and expected result in `design/<PR>.md` and a **Designer review** PR comment. Unavailable evidence stays pending, never presumed passed.

## Evidence required for every screen

- [ ] Identify the FEATURE, DESIGN component/regions, PR head and prototype state. Compare content/control regions, excluding prototype-only surface tabs, State/Capture menus, Inspect, Components, captions and wallpaper.
- [ ] Review light, dark, light Increase Contrast and dark Increase Contrast; also Reduce Transparency and Reduce Motion. Inspect actual tinted backgrounds as well as white/content backgrounds. System appearance changes update every open window.
- [ ] Open every changed bot-generated baseline; post a table **image | matches prototype? | note**. Check normal, loading, empty, error and disabled states, keyboard focus, hover, open sheet/popover and long text where applicable. A green screenshot test only proves agreement with its baseline, not with the prototype.
- [ ] Use the 4-pt grid; 8-pt adjacent-button gaps; 16 pt before destructive actions where DESIGN specifies it. Controls: buttons 20/24/28 pt and toolbar 32, fields 26, pop-ups 24, regular switch 34×20 / small 28×16. Interactive hit targets ≥24×24 even where the painted control is smaller.
- [ ] System font; body 13/18, title 1 22/28, toolbar title 15/20, callout 12/16; 26/32 bold only for wizard welcome. Minimum 11 pt except keycaps 10/13. Tabular numeric clocks/durations; paths and prompts use mono. German +30% and mixed Cyrillic must wrap without clipping meaningful labels.
- [ ] Concentric radii: main window 26, other windows 20, sheet 22, popover 18, card/banner 14, menu 12, rows 9, fields/pop-ups 8, tags 6, keys 5; buttons, segmented controls, search and switches capsule.
- [ ] Glass only on designated chrome/overlays; no blur behind scrolling content. Check real Mac translucency separately from Linux WebView baselines. Increase Contrast retains the approved prototype regular-glass alpha (94% light /96% dark), disables blur and gives 60% control borders, 25% separators, solid tag outlines and a solid 3-pt focus ring. Reduce Transparency is opaque with no blur.
- [ ] Keyboard-only ring is visible and unobscured; disabled controls have a reason where required and no hover feedback. Error/status colours include a word and glyph, not colour alone. Button/menu copy uses title case, other copy sentence case; preserve ellipses on actions that open a further interaction.
- [ ] Sheets remain inside their owning window, trap focus, Esc cancels and focus returns to the trigger. Popovers anchor with the prototype's spacing, clamp near edges, close on Esc/outside click and return focus. Sheet default action remains trailing/last when wrapping.
- [ ] D-13 motion: popover 200 ms ease-out fade-in, sheet/popover 200 ms ease-in visual exits, inspector 250 ms trailing slide (ease-out in /ease-in out). Focus transfer, Escape, command completion and keyboard availability never wait for motion; dismissed visual layers do not intercept input. Reduce Motion removes cosmetic animation, retaining the tokens FEATURE exceptions for row spinners and meters. Progress always has text. Do not implement prototype demo timers as real-operation delays. Behaviour conflicts go to HoD through Teamlead.
- [ ] Add `visual-change-approved` only after every changed image is reviewed and the Teamlead explicitly says **label #N**. This checklist does not grant approval itself.

References: DESIGN.md:3791–3895 (type, spacing, materials, colours, motion, focus); `src/css/00-base.css`, `01-macos27.css`, `02-contrast.css` under `docs/prototype/clickable/`; FEATURE `primitives.md`, `tokens-theming.md`, `accessibility-l10n.md`.

## Main-window shell and navigation

Sources: DESIGN `cpt-noter-component-shell-main-window`, MW-R1–R5 (DESIGN.md:674 onward); FEATURE `main-window-shell.md`; prototype `src/js/05-shell.js:94–196`, `src/css/00-base.css`, `01-macos27.css:29–63`.

- [ ] Default 1280×820, minimum 900×600. Sidebar 220, resizing 180–320; toolbar 56; content inset 24 horizontally /20 top; reading column ≤760. Window content classes use **content width**, not outer frame: Wide ≥1100, Medium 760–1099, Narrow <760.
- [ ] MW-R2 extends edge to edge under traffic lights with sidebar glass, accent icons, rounded selection and sentence-case Library/Workspace group headers. Exact order: Today ⌘1, Ask ⌘2; Calls ⌘3, People ⌘4, Topics ⌘5; Activity ⌘6, Agents ⌘7, Performance ⌘8.
- [ ] MW-R1 uses content-colour fill and hairline divider. Back/Forward share one glass capsule; page title/subtitle, view switch, actions and 240–360 search are aligned like the prototype. Toolbar controls overflow from the trailing side at Narrow width; search can collapse to its glyph.
- [ ] Hide/Show Sidebar label and trigger location follow visibility. Collapse/reflow follows the FEATURE order (inspector overlay, page side panel, multi-column content, toolbar overflow); no inaccessible offscreen controls.
- [ ] Live-call red capsule is separate from section selection; idle/recording/paused displays use static recording dot and correct clock. Clicking live row shows the call window without changing the selected section. Badges distinguish waiting count, problem and writing progress.
- [ ] Status footer uses exact mode copy (for example **Idle · API key · local fallback ready**, **Local only**, **Switched to local**, **No assistant**) and links to Models & Runtimes.
- [ ] MW-R5 sits directly below toolbar; one highest-severity banner, error → warning → degraded → info; **+N More** exposes the rest. Check setup incomplete, permission denial, failure/degraded and recovery; the message stays at the affected scope.
- [ ] One trailing inspector at a time: Call info 280, Item 320, Handoff 400. Close × / Esc returns focus; overlay/backdrop at narrow widths does not obscure its close action.
- [ ] Check navigation history endpoints, last-location restoration per section, selected state after Back/Forward, search focus and results navigation. M0 later-page frames name their milestone instead of being blank or pretending their later behaviour is delivered.
- [ ] Loading, bridge failure and no-assistant/setup-not-done states remain legible; Record is not gated by setup completion. Hidden-for-presenting restores prior view; background call-page loading must not steal focus. Treat these as existing behaviour checks, not new motion requirements.

## First-run wizard

Sources: DESIGN `cpt-noter-component-screen-first-run`, FR-R1–R3 (DESIGN.md:1170 onward); FEATURE `first-run.md`; prototype `src/js/10-a-surfaces.js:298–525`, `src/css/10-a.css:130 onward`.

- [ ] Separate 760×560 fixed-width window, 20-pt corners; leading stepper 210 wide, footer 52 high, content scrolls above footer. Opaque pane-list material; content 24 top/28 horizontal/20 bottom per `.fr-r2`. Welcome title 26/32; other step titles 22/28.
- [ ] Six steps and exact order: Welcome, Models, Permissions, Call display, Audio storage, Assistants. Stepper shows current/done/skipped/error plus background model-download status. Copy: **Set up Noter** and **Everything here runs on this Mac. Nothing leaves it until you connect an assistant in step 6.**
- [ ] Footer: environment line, **Skip for Now** only on skippable steps, disabled **Back** at Welcome, primary **Continue**, then **Finish**. Long labels wrap without covering controls. Step title receives focus after moving; screen swap does not replay sheet/window entrance.
- [ ] Models: downloading/paused/ready, checksum failure + **Try Again**, disk shortage (**Needs 2.1 GB, 1.4 GB free** in prototype). Progress and readable text persist while navigating other steps. No invented minimum wait or lock until download finishes.
- [ ] Permissions: Microphone and System Audio Recording rows; granted/denied/missing with correct repair actions. Self-test idle/running/pass/failure/clipping; level meter accompanied by **Hearing you**/result text. Result lines arrive once, without progress chatter. No unrequested Calendar/Notifications/Accessibility prompt in setup.
- [ ] Call display: recommended choice, display diagram/identity, call-app location, one-display layout explanation and absent remembered display warning. All options remain readable with long display names.
- [ ] Audio storage: choices include **Never store audio** and retention explanation; an irreversible delete action uses the designed confirmation rather than happening on a toggle.
- [ ] Assistants: initial/no assistant, privacy selection and local-runtime states. M0 frame accurately distinguishes later key/account work (M2/M3); never treat prototype demo account success as a delivered M0 flow.
- [ ] Resume after close, skipped steps, downloads completing off-step, and Finish → Today. Manual Record remains available before/during/after setup; automatic call detection remains off until the self-test passes. Do not infer new gating from progress animation.

## Settings window

Sources: DESIGN `cpt-noter-component-screen-settings`, ST-R1–R3 (DESIGN.md:3328 onward); FEATURE `settings.md`; prototype `src/js/50-e-5-settings.js:10–26,239–315`, `src/css/50-e.css:217 onward`.

- [ ] Separate default 820×620 / minimum 700×480 window; pane list 200, scrolling grouped form ≤560, card fill and separators; ST-R3 only for pane-level errors. Below 600 pt content width labels stack above controls. Pane scroll position is remembered independently.
- [ ] Search plus all 11 panes in order: General; Audio & Transcription; Models & Runtimes; Privacy; Call Screen & Menu Bar; Hotkeys; Repositories; Knowledge Sources; Maintenance; Performance; Updates. Selected pane has rounded accent selection, tinted icon, correct heading and matching form content.
- [ ] Filter names and keywords; match/no-match/clear states. Exact empty message **No settings match “…”**. Use a genuine no-match input such as **zoom calls**; **zoom** matches prototype keywords and must not be forced empty.
- [ ] General: immediate settings, notifications off repair, self-test prerequisite reason **Needs a passed audio self-test** · **Run Audio Self-Test…**, ignored-app Remove, iCloud/Dropbox storage warning. Run Setup Again opens the separate wizard.
- [ ] Audio: input/output labels, live levels, transcription/glossary and model downloading state. Long device/model names wrap; progress line and units are visible.
- [ ] Privacy: mode + mode in force, audio retention and next-run consequence, Calendar permission, behaviour-metrics switch off by default and its explanatory footnote, **Manage on Person Pages**. Later audit/source features have honest frames. Share-test sheet static states can be reviewed in M0; capture command is M2.
- [ ] Call Screen & Menu Bar: automatic-open choice, layout, text-size control, display picker (one/absent display), menu-title option; disabled controls explain prerequisites. Sliders have precise paired input and units.
- [ ] Hotkeys: chord keycaps / **None** / **Type a shortcut…**, disabled card-key rows, **Restore Defaults**; conflict messages directly under affected row: **Used by VoiceOver**, **Add Command, Option or Control**, card-key conflict. Refused chord retains old value, Esc cancels recording and never traps focus.
- [ ] Updates: idle/checking/**Noter is up to date**/update ready/**Restart Now**, loading state without layout jump. No fabricated installation outcome.
- [ ] Changes apply immediately without Save; refusal restores stored value and shows row error. Search, deep links (pane+row), keyboard navigation, sheet close and hidden-for-presenting restore context.
- [ ] Models & Runtimes, Repositories, Knowledge Sources and Maintenance have later-milestone frames per FEATURE AC. Review full later account/source/job states when their owning features arrive, not as M0 acceptance failures.

## Questions to preserve across reviews

- H1 withdrawn: the merged tokens-theming FEATURE intentionally permits moving row spinners and meters under Reduce Motion; #64 spinner finding is dropped.
- H2 resolved: keep 94/96% regular-glass alpha per DECOMPOSITION §1 prototype difference 8.
- H3/H4 resolved by HoD D-13: preserve DESIGN motion despite the static prototype gap; apply the timings and interaction guards above.
- Motion conflicts and any proposed changes to focus, async timing, navigation or gating must go to HoD; see `M0-motion.md`. Never “fix” behaviour by adjusting screenshot baselines.
