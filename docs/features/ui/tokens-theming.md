---
title: "Feature — Design tokens and theming"
description: "The macOS 27 foundations of the Noter UI: colour tokens for light, dark and Increase Contrast, typography, spacing and radii, Liquid Glass materials, Reduce transparency and Reduce motion, ported from the clickable prototype."
status: DRAFT
version: "1.0"
date: "2026-10-18"
feature: cpt-noter-feature-ui-tokens-theming
milestone: M0
---

# Feature: Design tokens and theming


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Follow the macOS appearance](#follow-the-macos-appearance)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Resolve the token set](#resolve-the-token-set)
  - [Check contrast](#check-contrast)
- [4. States (CDSL)](#4-states-cdsl)
  - [Appearance](#appearance)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Token stylesheet ported from the prototype](#token-stylesheet-ported-from-the-prototype)
  - [Automated contrast check](#automated-contrast-check)
- [6. Acceptance Criteria](#6-acceptance-criteria)
- [7. Additional Context](#7-additional-context)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-noter-featstatus-ui-tokens-theming`

## 1. Feature Context

- [ ] `p1` - `cpt-noter-feature-ui-tokens-theming`

### 1.1 Overview

One stylesheet of CSS custom properties defines every colour, size, radius, material and motion value the UI uses, with a value for light, dark, Increase Contrast light and Increase Contrast dark. The appearance follows macOS: `prefers-color-scheme`, `prefers-contrast: more`, `prefers-reduced-transparency` and `prefers-reduced-motion`. The values are the prototype's, which are the record (PM-57, PM-59).

### 1.2 Purpose

This feature builds the foundations part (**Anatomy and variants**) of `cpt-noter-component-ui-primitives`: typography, spacing and sizes, materials, colour tokens with contrast, appearance modes, and motion. The controls themselves are `cpt-noter-feature-ui-primitives`; focus, announcements and localisation are `cpt-noter-feature-ui-accessibility-l10n`.

**Requirements**: owner acceptance criterion AC5 with its contrast clause revised by PM-57 (WCAG 2.2 AA under Increase Contrast); PRD › UI prototype › Look. The PRD has no requirement IDs.

**Principles**: `cpt-noter-principle-native-macos`, `cpt-noter-principle-accessible-multilingual`

Success criteria: every text and control colour reaches WCAG 2.2 AA (4.5:1 text, 3:1 non-text) with Increase Contrast on, in light and dark, checked by an automated test; switching appearance in macOS restyles every open window without a reload.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Chooses light, dark or automatic appearance, Increase Contrast, Reduce transparency and Reduce motion in macOS System Settings |
| macOS (system) | Exposes the appearance settings to the WebView as media features |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md) › UI prototype › Look
- **Design**: [DESIGN.md](../../DESIGN.md) › 3.2 Primitives inventory › Anatomy and variants (Typography; Spacing and sizes; Materials; Colour tokens; Contrast targets; Dark mode, Increase Contrast and Reduce transparency; Motion and Reduce motion)
- **Design elements**: `cpt-noter-component-ui-primitives` (foundations part, shared with `cpt-noter-feature-ui-primitives`)
- **Stories**: none of its own; every screenshot spec of every screen depends on it
- **Commands**: none
- **Prototype modules**: `docs/prototype/clickable/src/css/00-base.css` (`:root` tokens, dark block, reduced-motion rule), `src/css/02-contrast.css` (Increase Contrast), `src/css/01-macos27.css` (materials, radii, control heights)
- **Dependencies**: None

## 2. Actor Flows (CDSL)

### Follow the macOS appearance

- [x] `p1` - **ID**: `cpt-noter-flow-ui-tokens-theming-follow-appearance`

**Actor**: Primary user

**Success Scenarios**:
- The user switches macOS to dark mode and every open Noter window turns dark at once
- The user turns on Increase Contrast and every colour switches to its AA-checked value, separators and outlines thicken, the focus ring becomes solid

**Error Scenarios**:
- None: the media features always have a value; without one the light default applies

**Steps**:
1. [x] - `p1` - User changes Appearance, Increase Contrast, Reduce transparency or Reduce motion in System Settings - `inst-user-changes`
2. [x] - `p1` - UI: the WebView reports the new media feature values to every open window - `inst-media-change`
3. [x] - `p1` - Algorithm: resolve the token set with `cpt-noter-algo-ui-tokens-theming-resolve-tokens` - `inst-resolve`
4. [x] - `p1` - UI: every element restyles from the custom properties; no component holds a colour of its own - `inst-restyle`
5. [x] - `p1` - **RETURN** windows in the new appearance - `inst-return-appearance`

## 3. Processes / Business Logic (CDSL)

### Resolve the token set

- [x] `p1` - **ID**: `cpt-noter-algo-ui-tokens-theming-resolve-tokens`

**Input**: `prefers-color-scheme`, `prefers-contrast`, `prefers-reduced-transparency`, `prefers-reduced-motion`

**Output**: the active values of every custom property

**Steps**:
1. [x] - `p1` - Start from the light defaults of the prototype's `:root` block: label 85 %, secondary 50 %, tertiary 30 %, separator 10 %, control border 20 %, accent and accent fill #007AFF, accent text #0068DA, recording and error #FF3B30, warning #FF9500, success #28CD41, the status tints, match, evidence and diff tints, glass 58 % and strong glass 82 % - `inst-light-defaults`
2. [x] - `p1` - **IF** the colour scheme is dark - `inst-if-dark`
   1. [x] - `p1` - Apply the dark pairs: content #1E1E1E, card #2A2A2A, label 85 % white, secondary 55 %, tertiary 25 %, accent #0A84FF, accent text #419CFF, recording and error #FF453A, warning #FF9F0A, success #32D74B, glass #28282A at 55 % - `inst-dark-pairs`
3. [x] - `p1` - **IF** Increase Contrast is on - `inst-if-contrast`
   1. [x] - `p1` - Apply the prototype's `02-contrast.css` values: light label #1D1D1F, secondary and tertiary #616161, separators 25 %, control borders 60 %, accent and accent fill #0064D1, accent text #0060C9 (prototype #0064D1, see Additional Context), recording, error and error fill #C4281C, warning #A85A00, success #1E7E34, glass 94 % white, focus ring solid 3 pt #0064D1 - `inst-contrast-light`
   2. [x] - `p1` - **IF** the colour scheme is also dark: label #F2F2F2, secondary and tertiary #AAAAAA, accent fill #0A6FE0, accent text #6DB4FF (prototype #4DA3FF), recording and error #FF6961, error fill #C4514B (prototype fills with the error colour), success #30D158, glass at 96 %, focus ring solid 3 pt #4DA3FF - `inst-contrast-dark`
4. [x] - `p1` - **IF** Reduce transparency or Increase Contrast is on - `inst-if-opaque`
   1. [x] - `p1` - Make the sidebar, toolbar control groups, menus, popovers, alerts, the undo strip, the record prompt and the floating panel opaque in the window or card colour; drop the backdrop blur - `inst-opaque`
5. [x] - `p1` - **IF** Reduce motion is on - `inst-if-motion`
   1. [x] - `p1` - Set every transition and animation duration to zero except the row spinner and the level meters, which carry state (motion table of DESIGN) - `inst-no-motion`
6. [x] - `p1` - **RETURN** the active token set - `inst-return-tokens`

### Check contrast

- [x] `p1` - **ID**: `cpt-noter-algo-ui-tokens-theming-check-contrast`

**Input**: the Increase Contrast token values, light and dark, the pairs of DESIGN's colour table (text on content, card, tints; non-text on its neighbour), and the prototype's text pairs outside it: accent text on the accent selection (token chips) over content and card, white on the error fill

**Output**: pass, or the list of pairs below the target

**Steps**:
1. [x] - `p1` - **FOR EACH** text token and each background it is used on - `inst-for-each-text`
   1. [x] - `p1` - Compute the contrast ratio; record a failure below 4.5:1 - `inst-text-ratio`
2. [x] - `p1` - **FOR EACH** non-text token (control border, focus ring, meter fill, status icon) and its neighbour - `inst-for-each-nontext`
   1. [x] - `p1` - Compute the ratio; record a failure below 3:1 - `inst-nontext-ratio`
3. [x] - `p1` - **RETURN** pass when no failure was recorded; the build fails otherwise - `inst-return-check`

## 4. States (CDSL)

### Appearance

- [x] `p1` - **ID**: `cpt-noter-state-ui-tokens-theming-appearance`

**States**: LIGHT, DARK, LIGHT_CONTRAST, DARK_CONTRAST

**Initial State**: LIGHT

**Transitions**:
1. [x] - `p1` - **FROM** LIGHT **TO** DARK **WHEN** macOS switches to dark appearance - `inst-light-dark`
2. [x] - `p1` - **FROM** DARK **TO** LIGHT **WHEN** macOS switches to light appearance - `inst-dark-light`
3. [x] - `p1` - **FROM** LIGHT **TO** LIGHT_CONTRAST **WHEN** Increase Contrast turns on - `inst-light-contrast`
4. [x] - `p1` - **FROM** DARK **TO** DARK_CONTRAST **WHEN** Increase Contrast turns on - `inst-dark-contrast`
5. [x] - `p1` - **FROM** LIGHT_CONTRAST **TO** LIGHT **WHEN** Increase Contrast turns off - `inst-contrast-light-off`
6. [x] - `p1` - **FROM** DARK_CONTRAST **TO** DARK **WHEN** Increase Contrast turns off - `inst-contrast-dark-off`
7. [x] - `p1` - **FROM** LIGHT_CONTRAST **TO** DARK_CONTRAST **WHEN** macOS switches to dark appearance - `inst-lc-dc`
8. [x] - `p1` - **FROM** DARK_CONTRAST **TO** LIGHT_CONTRAST **WHEN** macOS switches to light appearance - `inst-dc-lc`

## 5. Definitions of Done

### Token stylesheet ported from the prototype

- [x] `p1` - **ID**: `cpt-noter-dod-ui-tokens-theming-tokens`

The system **MUST** ship one token stylesheet with the prototype's custom-property names and values for light, dark and Increase Contrast, the typography scale (Large title 26/32 to Footnote 10/13, Call transcript 15/22, Call card 15/21 and 13/19), the 4-pt spacing grid, the radius scale (window 26, panel 20, sheet 22, popover 18, card 14, menu 12, row 9, control 8, tag 6, key cap 5, capsule) and the three glass materials, driven only by macOS media features.

**Implements**:
- `cpt-noter-flow-ui-tokens-theming-follow-appearance`
- `cpt-noter-algo-ui-tokens-theming-resolve-tokens`
- `cpt-noter-state-ui-tokens-theming-appearance`

**Constraints**: `cpt-noter-constraint-macos-apple-silicon`, `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Code: `apps/desktop/src/styles/tokens.css` (from `src/css/00-base.css`, `01-macos27.css`, `02-contrast.css`), owned and imported through `apps/desktop/src/styles/tokens.ts`
- Tests: `apps/desktop/tests/visual/tokens-theming.spec.ts`: the token sheet in the four appearance states, every prototype token checked against the prototype in each state, live restyling, the Increase Contrast treatments and Reduce motion. The screenshot spec of the production primitives page (the harness self-test fixture `apps/desktop/tests/visual/fixtures/primitives.html` becomes that page) belongs to `cpt-noter-feature-ui-primitives`

### Automated contrast check

- [x] `p1` - **ID**: `cpt-noter-dod-ui-tokens-theming-contrast-check`

The system **MUST** run a unit test that reads the Increase Contrast values of the token stylesheet in light and dark and fails when a text pair is below 4.5:1 or a non-text pair below 3:1.

**Implements**:
- `cpt-noter-algo-ui-tokens-theming-check-contrast`

**Constraints**: `cpt-noter-constraint-accessibility-baseline`

**Touches**:
- Tests: `apps/desktop/src/styles/tokens.test.ts`

## 6. Acceptance Criteria

- [ ] Every custom property used by a component is defined in the token stylesheet; no component file holds a literal colour
- [ ] In each of the four appearance states every token of the prototype resolves to the prototype's value, and the token sheet renders identically to its baseline (screenshot match ≥ 98 % in the pinned container). The primitives page compared with the prototype's renderings is an acceptance criterion of `cpt-noter-feature-ui-primitives`, which builds that page
- [x] With Reduce transparency or Increase Contrast on, no element uses `backdrop-filter`
- [x] With Reduce motion on, no transition or animation runs except row spinners and level meters
- [x] The contrast test passes for light and dark Increase Contrast values

## 7. Additional Context

**Prototype reuse.** Ported as-is: the `:root` block and the dark block of `src/css/00-base.css`, the `:root[data-contrast="more"]` and `prefers-contrast: more` blocks of `src/css/02-contrast.css` (token values and the component treatments: solid tag and chip outlines, the solid focus outline, control borders, no blur on glass surfaces), and the material, radius and control-height rules of `src/css/01-macos27.css`, with the same custom-property names (`--win-bg`, `--side-bg`, `--content-bg`, `--card-bg`, `--label`, `--label-2`, `--label-3`, `--sep`, `--ctrl-border`, `--accent`, `--accent-fill`, `--accent-text`, `--rec`, `--error`, `--warning`, `--success`, the `*-tint` tokens, `--glass-*`, `--focus-ring`, `--r-*`, `--font*`, `--mono`). Dropped as prototype-only: `--wall-*`, `--desk-*`, `--chrome-*`, the desktop wallpaper, and the `[data-theme]` and `[data-contrast]` toggles used by the prototype's bar (production follows the media features only).

**DESIGN versus prototype.** Under Increase Contrast the prototype's glass is 94 % white in light and 96 % in dark, where DESIGN says opaque, and its dark focus ring is #4DA3FF where DESIGN names the accent #0A84FF. This feature follows the prototype (owner decision); the difference is listed in `docs/DECOMPOSITION.md`. The prototype has no Reduce transparency rule; DESIGN's rule (materials opaque) applies, because there is no prototype state to follow.

**Accessibility versus prototype.** WCAG 2.2 AA under Increase Contrast is a PRD bar (AC5, PM-57), so it overrides the prototype where the prototype misses it. Three Increase Contrast values change, each by the smallest step on the same hue that reaches 4.5:1; the automated check covers the pairs:

| Pair | Appearance | Prototype | Production | Ratio |
|---|---|---|---|---|
| accent text on accent selection (token chips, pressed icon buttons) | light | `--accent-text` #0064D1 | #0060C9 | 4.29 → 4.56:1 (content and card) |
| accent text on accent selection | dark | `--accent-text` #4DA3FF | #6DB4FF | 4.27 → 5.14:1 on content, 3.77 → 4.54:1 on a card |
| white on the error fill (destructive button, icon badge, failed step dot) | dark | `--error` #FF6961 as the fill | new `--error-fill` #C4514B | 2.82 → 4.54:1 |

The error fill needs its own token: as text on the dark content background the error colour needs a relative luminance of at least 0.233, and under white text at most 0.183, so no single value serves both (the prototype splits `--accent-fill` from `--accent` for the same reason). `--error-fill` equals the error colour in the other appearances; under Increase Contrast `tokens.css` fills `.np-btn--destructive.np-btn--primary`, `.np-ibtn__badge` and `.f-steps__i.is-err .f-steps__dot` with it.

**Cascade order.** The prototype's component sheets load after `tokens.css` and carry rules as specific as the treatments (`.np-toolbar .np-btn`), so the Increase Contrast treatments use `:root:root`, the specificity they have in `02-contrast.css`; `tokens-theming.spec.ts` loads both in production order and compares every treatment with the prototype.

**States coverage.** The prototype's appearance controls **Auto / Light / Dark** and **Capture ▾ › Increase contrast** correspond to the four states above.

**Not applicable.** Commands, data, security and error handling: the tokens hold no data and call nothing. Performance: `backdrop-filter` is used only on the surfaces DESIGN lists, never behind scrolling content (DESIGN 1.3, technology risks); its cost on long lists is measured in M4 (DESIGN 4.3).
