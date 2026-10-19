# M0 motion reference and decisions

18 October 2026. Screens: main-window shell/navigation, first-run wizard and Settings. Shared primitives: sheet, popover, banner, disclosure, toggle and progress. This is a record of the prototype and DESIGN, not an amendment to either. Paths below are relative to the repository; prototype paths abbreviate `docs/prototype/clickable/`. Source line references describe the reviewed checkout, not a promise that line numbers stay fixed.

## Current authority: HoD D-13 and tokens-theming FEATURE

D-13 is decided: **keep DESIGN's motion**. Popovers fade in over **200 ms ease-out**; sheets and popovers have **ease-in exits** using the common **200 ms** sheet/popover/fade timing; inspectors slide from the trailing edge over **250 ms**, easing out on entrance and in on exit. A static prototype omitting motion is an implementation gap, not a conflict or an instruction to remove these transitions. H3/H4 are resolved by D-13, with no pending HoD decision.

These transitions are purely visual: never delay focus transfer, Escape, command completion or keyboard availability. An exiting visual layer must cease intercepting input as soon as dismissal occurs. Under Reduce Motion cosmetic transitions/animations are removed; **row spinners and level meters keep moving as explicitly permitted by the merged tokens-theming FEATURE** (`inst-no-motion`, acceptance criterion). H1 is withdrawn: the `.np-spin` exemption is correct; no spinner correction is required on #64. H2 remains resolved: keep approved 94%/96% regular-glass alpha under Increase Contrast. H5 remains the guard against behaviour changes disguised as motion polish.

## Foundations

DESIGN.md:3871–3886, **Motion and Reduce motion** in `cpt-noter-component-ui-primitives`, supplies the motion tokens as a table rather than named CSS custom properties: feedback **120 ms**, switch **160 ms short spring**, popover/sheet/fade **200 ms**, drawer/inspector **250 ms**, evidence highlight **3 s**. Entrances ease out, exits ease in. No pulsing recording dot or scrolling menu title; no animated gradients under the stated DESIGN policy. DESIGN.md:3951 removes translation, scaling and fades under Reduce Motion.

Prototype `src/css/00-base.css:95` globally sets `transition: none !important; animation: none !important` on elements and pseudo-elements under `prefers-reduced-motion: reduce`. It does not stop the underlying job, suppress updates, change navigation or insert an artificial delay. Keep textual status, current switch/disclosure state and live values available in both modes. This global prototype rule is historical evidence only: production follows the FEATURE exception for row spinners and meters stated above.

## Screen transitions and state changes

| Screen / trigger | What the prototype does | Duration / easing actually evidenced | Reduce Motion | Source |
| --- | --- | --- | --- | --- |
| Main: choose section, Back/Forward, search navigation | Replaces selected page/title and selection; no page slide or cross-fade declared | Immediate; no easing | Same immediate state change | `src/js/05-shell.js:73–82,139–196`; core render `src/js/00-core.js:218–237` |
| Main: show/hide sidebar and resize split | Updates visibility/layout; no animated width or translation | Immediate, driven by user drag where applicable | Same; do not add interpolation | `src/js/05-shell.js:125,186–195`; shell styles `src/css/00-base.css`, `01-macos27.css:29–63` |
| Main: banner appears, changes severity/progress, +N More expands, dismissal | Replaces band content and reflows content below; no entrance/height animation | Immediate; progress animation only as specified below | Same layout/state update, progress motion removed | `src/js/05-shell.js:149–160`; `src/js/04-shared.js:228–248` |
| Main: inspector opens/closes | Inserts/removes trailing aside; no CSS entry/exit transition in prototype shell | Production per D-13: 250 ms slide from trailing edge, ease-out entrance / ease-in exit; prototype omission is a gap | Appears in place | `src/js/05-shell.js:163–175`; DESIGN.md:3880. **H4**, below |
| First-run: initial window | Draws separate 760×560 window; no custom window-entry animation | Immediate WebView render; native window animation is outside prototype evidence | No custom movement | `src/js/10-a-surfaces.js:322–373` |
| First-run: Continue, Back, Skip for Now, completed-step selection | Changes step content, title, current/done/skipped marks, preserving outer window and stepper | Immediate, no slide/fade | Same state change | `src/js/10-a-surfaces.js:452–455`; `src/css/10-a.css:132–161` |
| First-run: model download and self-test results | Updates values/text and result rows; spinner or meter carries ongoing work | Event/value updates; no result-row entrance animation specified | Values/results continue; no cosmetic motion | `src/js/10-a-surfaces.js:385–407,494–525`; progress/meter rows below |
| First-run: Finish / close and resume | Finish opens Today; closing/reopening preserves setup context per FEATURE | No custom transition time evidenced | Same; navigation is not delayed | `src/js/10-a-surfaces.js:456–466`; FEATURE `first-run.md` |
| Settings: open pane, search/filter, clear no-match, deep link | Replaces pane/list selection or empty result; no cross-fade/slide | Immediate | Same; preserve pane scroll per FEATURE | `src/js/50-e-5-settings.js:278–304`; `src/css/50-e.css:217–241` |
| Settings: toggle, pop-up, radio, slider or text field changes | Control shows current value; dependent disabled reason/error or status changes in place | Switch/feedback rules below; row text/layout immediate | Control swaps instantly; async result still comes from core | `src/js/50-e-5-settings.js:303–306`; FEATURE `settings.md` change-setting flow |
| Settings: shortcut recording/conflict/cancel | Keycaps change to recording prompt or error line; no moving caret/card transition prescribed | Immediate; no animation | Same; Esc still cancels and prior chord survives refusal | `src/js/10-a-surfaces.js:492–493,528–543`; `src/js/50-e-5-settings.js` Hotkeys renderer |
| Either window: self-test sheet or other M0 overlay | Uses shared sheet on initial open; busy/step/result changes update inside | Initial entry only, 200 ms ease-out; contents immediate | Appears/updates in place, no fade | `src/js/05-shell.js:26–47`; shared sheet rows below |

Do not infer window activation, focus movement, automatic advances or user-blocking waits from an animation. FEATURE-owned focus and operation success/failure remain authoritative. Prototype demo timeouts (for example permission return 1300 ms, key verification 800 ms, local-runtime installation 1600 ms in `src/js/10-a-surfaces.js:479,487,490`, update-check demo 900 ms at `src/js/50-e-5-settings.js:315`) simulate a backend; they are not motion tokens or minimum production response times.

## Primitive transitions

| Primitive / state | Animated property and normal duration/easing | Reduced behaviour | Evidence and gap |
| --- | --- | --- | --- |
| Sheet first open | Translate Y −14 pt → 0 and opacity 0 → 1, **200 ms ease-out** | Visible at final position/opacity immediately | `src/css/00-base.css:328–332`; `01-macos27.css:160–167` supplies material/radius. `.is-new` applies only the first time in `src/js/05-shell.js:29–32` |
| Sheet busy/steps/results | No repeated entry; content/height swaps directly | Same instant updates | `.is-new` guard above; DESIGN.md:3877 explicitly says not to animate again while steps change. Do not remount the sheet for each busy/step state |
| Sheet close/cancel | Production per D-13: 200 ms ease-in exit, reversing the entry translation/fade as a visual layer only | Immediate, no fade or translation | Prototype removes DOM immediately (`src/js/05-shell.js:47`); D-13 fills that motion gap. Escape, focus return and command availability happen immediately, independently of the visual exit |
| Popover open/close | Production per D-13: opacity 0→1, **200 ms ease-out**; exit opacity 1→0, **200 ms ease-in**. Keep anchor **6 pt** gap, **8 pt** side clamp and flip-above positioning | Appears/closes in place instantly | Placement: `src/css/00-base.css:322–326`, `src/js/05-shell.js:49–58`, `src/js/00-core.js:249–268`. DESIGN motion table plus D-13 fills the static prototype gap; focus and dismissal never wait for the fade |
| Banner appear / replace / +N More / dismiss | No animation; reflows content at once | Same | `src/js/04-shared.js:228–248`; `.np-banner` in `src/css/00-base.css` and `01-macos27.css:176`; no banner transition rule |
| Disclosure collapsed ↔ expanded | Triangle rotates **0 ↔ 90°**, **150 ms**; CSS omitted easing, so default **ease** (cubic-bezier(.25,.1,.25,1)). Expanded content is not height-animated by this primitive | No animated rotation; final orientation still indicates expanded/collapsed. Content updates immediately | `src/css/00-base.css:302–305`; DESIGN.md:3881 says “No rotation”. Interpret as no rotational animation, not a permanently closed glyph. If a static unchanged glyph is intended, ask HoD before changing it |
| Toggle off ↔ on | Thumb `left`: 2→12 pt regular /2→10 pt small, **160 ms cubic-bezier(.3,1.4,.5,1)**; track background **120 ms ease** | Thumb and track reach final state instantly | `src/css/01-macos27.css:123–131` overrides base thumb; track transition from `src/css/00-base.css:250`. Same easing in reverse: it is the switch's explicit spring, not a generic exit easing |
| Determinate progress | Fill width reflects latest value; **no width transition** declared | Same instantaneous width updates, readable value text remains | `src/css/00-base.css:283–286`; `src/js/02-primitives.js` progress factory. Do not smooth into an estimated value |
| Indeterminate progress | 40% segment travels X −100%→260%, **1.4 s ease-in-out infinite** | Animation disabled; static indicator plus ongoing status text | `src/css/00-base.css:285–286` and global reduced rule at :95 |
| Row spinner | One revolution, **800 ms linear infinite** | **Keeps rotating**, carrying state; adjacent status text remains | Normal timing: `src/css/00-base.css:287–288`; production exception: tokens-theming FEATURE `inst-no-motion` and AC. H1 withdrawn; #64 `.np-spin` exemption is correct |
| Progress paused/finished/failed | State/value/text changes; no separate state fade or colour animation declared | Same | Progress factory `src/js/02-primitives.js`; visual styling does not establish new backend completion behaviour |
| Level meter (self-test) | Ten segments update from live values, at most every 100 ms per DESIGN; peak-hold behaviour belongs to live meter owner, not a CSS animation | Keep updates, remove peak hold | DESIGN.md:3747,3885; primitive styling `src/css/00-base.css:289–293`. The prototype's demo clock is not an audio sampling requirement |
| Button hover/press | `background-color` and `filter`, **120 ms**, omitted easing = **ease**; gradient hover fill is not smoothly interpolated by that declaration | Instant | `src/css/00-base.css:198`; macOS override `01-macos27.css:70–78`. Disabled hover conflict noted in #64 review |
| Help tag | Shows after **500 ms hover**, immediately on keyboard focus; no separate fade token supplied | Preserve the hover delay and immediate keyboard trigger; no cosmetic transition | DESIGN primitive inventory; prototype uses native title/data-help-tag, so native tag drawing is not a custom CSS animation reference |

Status dwell times are not entrance durations. Keep inline status/Undo availability for their FEATURE-specified intervals and preserve them under Reduce Motion. Removing animation must not shorten an undo opportunity or silence result text. Never postpone focus, cancel handling or command dispatch until a transition-end event that reduced motion can eliminate.

## Decision record and behaviour guard

- **H1 — withdrawn:** merged tokens-theming FEATURE deliberately permits moving row spinners and level meters under Reduce Motion; `.np-spin` exemption is correct. Required change 2 on #64 is dropped.
- **H2 — resolved:** approved Increase Contrast regular glass stays 94% light /96% dark (DECOMPOSITION §1 prototype difference 8).
- **H3 — resolved by D-13:** popover 200 ms fade-in, ease-out entrance; sheet/popover ease-in exits use the 200 ms common timing. Purely visual; focus transfer, Escape, command completion and keyboard availability never wait.
- **H4 — resolved by D-13:** inspector 250 ms slide from the trailing edge, ease-out entrance /ease-in exit. Reduced Motion removes the slide; interaction remains immediate.
- **H5 — unchanged behaviour guard:** any proposal to gate Continue/Finish/Record, advance steps automatically, hold success text or simulate operation latency to fit motion is a behaviour change, not visual polish. Existing FEATURE rules govern; seek HoD before changing them.

Additional visual contradiction: prototype Settings skeleton `.e-skel` (`src/css/50-e.css:6`) uses a **1.4 s linear infinite animated gradient**, while DESIGN.md:3886 says animated gradients are never used. Do not silently introduce that animation into an M0 loading frame; route a decision if needed. Under Reduce Motion it is static in the prototype regardless.

## Review evidence to collect

Use interaction/video or computed-animation inspection for timings; still screenshots cannot prove duration or easing. Check initial sheet entry once, busy/step updates without replay, toggle both directions, disclosure both ways, ongoing jobs with Reduce Motion, and instantaneous error/recovery text. Verify keyboard focus restoration and async completion separately. Bot screenshots remain the pinned-container evidence for static appearance; native window choreography and glass over real content require Mac observation.
