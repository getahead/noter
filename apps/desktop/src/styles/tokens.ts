// The token stylesheet (tokens.css) and its WCAG 2.2 AA check (docs/features/ui/tokens-theming.md).
// The app imports this module for the stylesheet: the WebView resolves its media queries and restyles
// every open window when macOS changes appearance. resolveTokens mirrors that resolution so the
// contrast check and the unit tests can run it on the stylesheet text.

// @cpt-flow:cpt-noter-flow-ui-tokens-theming-follow-appearance:p1
// @cpt-dod:cpt-noter-dod-ui-tokens-theming-tokens:p1
// @cpt-component:cpt-noter-component-ui-primitives:p1
// The steps the WebView runs on the media queries of tokens.css itself: it re-evaluates them in every
// open window when the user changes a macOS setting and restyles live; the Reduce motion rule is there too.
// @cpt-begin:cpt-noter-flow-ui-tokens-theming-follow-appearance:p1:inst-user-changes
// @cpt-begin:cpt-noter-flow-ui-tokens-theming-follow-appearance:p1:inst-media-change
// @cpt-begin:cpt-noter-flow-ui-tokens-theming-follow-appearance:p1:inst-restyle
// @cpt-begin:cpt-noter-flow-ui-tokens-theming-follow-appearance:p1:inst-return-appearance
// @cpt-begin:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-if-motion
// @cpt-begin:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-no-motion
import "./tokens.css";
// @cpt-end:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-no-motion
// @cpt-end:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-if-motion
// @cpt-end:cpt-noter-flow-ui-tokens-theming-follow-appearance:p1:inst-return-appearance
// @cpt-end:cpt-noter-flow-ui-tokens-theming-follow-appearance:p1:inst-restyle
// @cpt-end:cpt-noter-flow-ui-tokens-theming-follow-appearance:p1:inst-media-change
// @cpt-end:cpt-noter-flow-ui-tokens-theming-follow-appearance:p1:inst-user-changes

// @cpt-state:cpt-noter-state-ui-tokens-theming-appearance:p1
export type Appearance = "LIGHT" | "DARK" | "LIGHT_CONTRAST" | "DARK_CONTRAST";
export type Tokens = Record<string, string>;

const DARK = "(prefers-color-scheme: dark)";
const MORE = "(prefers-contrast: more)";
const OPAQUE = "(prefers-reduced-transparency: reduce)";

/** The custom properties of each `:root` rule, keyed by its enclosing media query ("" at top level). */
export function rootBlocks(css: string): Record<string, Tokens> {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: Record<string, Tokens> = {};
  for (const [, query = "", body] of src.matchAll(/(?:@media\s+([^{]+?)\s*\{\s*)?:root\s*\{([^}]*)\}/g)) {
    const tokens: Tokens = (blocks[query] ??= {});
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) tokens[name] = value;
  }
  return blocks;
}

/** The tokens the browser resolves for `appearance`, with Reduce transparency on or off. Reduce motion
 *  changes no token: its rule in tokens.css zeroes the durations. */
// @cpt-algo:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1
export function resolveTokens(css: string, appearance: Appearance, reduceTransparency = false): Tokens {
  // @cpt-begin:cpt-noter-flow-ui-tokens-theming-follow-appearance:p1:inst-resolve
  const blocks = rootBlocks(css);
  const block = (query: string) => {
    const tokens = blocks[query];
    if (!tokens) throw new Error(`tokens.css has no :root block for "${query || "top level"}"`);
    return tokens;
  };
  const dark = appearance.startsWith("DARK");
  // @cpt-begin:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-light-defaults
  const tokens = { ...block("") };
  // @cpt-end:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-light-defaults
  // @cpt-begin:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-if-dark
  // @cpt-begin:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-light-dark
  // @cpt-begin:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-dark-light
  if (dark) {
    // @cpt-begin:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-dark-pairs
    Object.assign(tokens, block(DARK));
    // @cpt-end:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-dark-pairs
  }
  // @cpt-end:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-dark-light
  // @cpt-end:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-light-dark
  // @cpt-end:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-if-dark
  // @cpt-begin:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-if-contrast
  // @cpt-begin:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-light-contrast
  // @cpt-begin:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-dark-contrast
  // @cpt-begin:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-contrast-light-off
  // @cpt-begin:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-contrast-dark-off
  if (appearance.endsWith("CONTRAST")) {
    // @cpt-begin:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-contrast-light
    Object.assign(tokens, block(MORE));
    // @cpt-end:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-contrast-light
    // @cpt-begin:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-lc-dc
    // @cpt-begin:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-dc-lc
    // @cpt-begin:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-contrast-dark
    if (dark) Object.assign(tokens, block(`${MORE} and ${DARK}`));
    // @cpt-end:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-contrast-dark
    // @cpt-end:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-dc-lc
    // @cpt-end:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-lc-dc
  }
  // @cpt-end:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-contrast-dark-off
  // @cpt-end:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-contrast-light-off
  // @cpt-end:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-dark-contrast
  // @cpt-end:cpt-noter-state-ui-tokens-theming-appearance:p1:inst-light-contrast
  // @cpt-end:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-if-contrast
  // Increase Contrast drops the blur in its own block above (--glass-blur: none).
  // @cpt-begin:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-if-opaque
  if (reduceTransparency) {
    // @cpt-begin:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-opaque
    Object.assign(tokens, block(OPAQUE));
    if (dark) Object.assign(tokens, block(`${OPAQUE} and ${DARK}`));
    // @cpt-end:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-opaque
  }
  // @cpt-end:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-if-opaque
  // @cpt-begin:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-return-tokens
  return tokens;
  // @cpt-end:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1:inst-return-tokens
  // @cpt-end:cpt-noter-flow-ui-tokens-theming-follow-appearance:p1:inst-resolve
}

type Rgba = [number, number, number, number];

/** The first #RRGGBB or rgb()/rgba() colour in a value, so a box-shadow such as the focus ring works too. */
function parseColor(value: string): Rgba {
  const hex = /#([0-9a-f]{6})\b/i.exec(value);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
  const fn = /rgba?\(([^)]+)\)/.exec(value);
  if (fn) {
    const [r, g, b, a = 1] = fn[1].split(",").map(Number);
    // NaN would compare false against every target and pass the check, so an unread syntax throws
    if ([r, g, b, a].every(Number.isFinite)) return [r, g, b, a];
  }
  throw new Error(`no colour in "${value}"`);
}

function over([r, g, b, a]: Rgba, [R, G, B]: Rgba): Rgba {
  return [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of `fg` over `bg`; a translucent `bg` is laid over the opaque `base` first. */
export function contrastRatio(fg: string, bg: string, base?: string): number {
  let back = parseColor(bg);
  if (back[3] < 1) {
    if (!base) throw new Error(`background "${bg}" is not opaque and has no base`);
    back = over(back, parseColor(base));
  }
  const [hi, lo] = [luminance(over(parseColor(fg), back)), luminance(back)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pairs of DESIGN's colour table (3.2 › Colour tokens, Contrast targets) and the prototype's text pairs outside
 *  it (accent text on the accent selection of token chips, white on the error fill): [foreground, background,
 *  opaque base under a translucent background, default the content background]. */
const TEXT = ["--label", "--label-2", "--label-3", "--accent-text", "--rec", "--error", "--warning", "--success"];
const TINTS = ["--sel-unemph", "--sel-accent", "--match", "--evidence", "--diff-ins", "--diff-del", "--error-tint", "--warning-tint", "--success-tint", "--info-tint"];
export type Pair = [fg: string, bg: string, base?: string];
export const TEXT_PAIRS: Pair[] = [
  ...TEXT.flatMap((t): Pair[] => [[t, "--content-bg"], [t, "--card-bg"]]),
  ["--on-accent", "--accent-fill"],
  ...TINTS.map((bg): Pair => ["--label", bg]),
  ["--accent-text", "--sel-accent"],
  ["--accent-text", "--sel-accent", "--card-bg"],
  ["--on-accent", "--error-fill"],
];
/** The white warning glyph in the recording dot ('mic only', 'no mic'; prototype 04-shared.js C.recordingIndicator) is
 *  the only sign of that state, so it is a non-text pair. The prototype fills the dot with --rec (2.82:1 in dark Increase
 *  Contrast); tokens.css fills it with --error-fill under Increase Contrast, the paused ring keeps --rec. */
export const RECDOT_PAIR: Pair = ["--on-accent", "--error-fill"];
export const NON_TEXT_PAIRS: Pair[] = [
  ...["--ctrl-border", "--accent", "--accent-fill", "--focus-ring", "--rec", "--error", "--warning", "--success"].map((t): Pair => [t, "--content-bg"]),
  RECDOT_PAIR,
];

// @cpt-algo:cpt-noter-algo-ui-tokens-theming-check-contrast:p1
// @cpt-dod:cpt-noter-dod-ui-tokens-theming-contrast-check:p1
export function checkContrast(tokens: Tokens, textPairs = TEXT_PAIRS, nonTextPairs = NON_TEXT_PAIRS): string[] {
  const failures: string[] = [];
  const check = ([fg, bg, base]: Pair, min: number) => {
    const ratio = contrastRatio(tokens[fg], tokens[bg], tokens[base ?? "--content-bg"]);
    if (ratio < min) failures.push(`${fg} on ${bg}${base ? ` over ${base}` : ""}: ${ratio.toFixed(2)} < ${min}`);
  };
  // @cpt-begin:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-for-each-text
  for (const pair of textPairs) {
    // @cpt-begin:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-text-ratio
    check(pair, 4.5);
    // @cpt-end:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-text-ratio
  }
  // @cpt-end:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-for-each-text
  // @cpt-begin:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-for-each-nontext
  for (const pair of nonTextPairs) {
    // @cpt-begin:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-nontext-ratio
    check(pair, 3);
    // @cpt-end:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-nontext-ratio
  }
  // @cpt-end:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-for-each-nontext
  // @cpt-begin:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-return-check
  return failures;
  // @cpt-end:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-return-check
}
