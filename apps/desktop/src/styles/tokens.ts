// Reads the token stylesheet (tokens.css) and checks its colours against WCAG 2.2 AA.
// The browser does the real resolution through the media queries; this module mirrors
// it for the contrast check, which runs in the unit tests (docs/features/ui/tokens-theming.md).

export type Appearance = "LIGHT" | "DARK" | "LIGHT_CONTRAST" | "DARK_CONTRAST";
export type Tokens = Record<string, string>;

const DARK = "(prefers-color-scheme: dark)";
const MORE = "(prefers-contrast: more)";

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

/** The tokens the browser resolves for `appearance` (tokens.css carries the resolve-tokens markers). */
export function resolveTokens(css: string, appearance: Appearance): Tokens {
  const blocks = rootBlocks(css);
  const block = (query: string) => {
    const tokens = blocks[query];
    if (!tokens) throw new Error(`tokens.css has no :root block for "${query || "top level"}"`);
    return tokens;
  };
  const dark = appearance.startsWith("DARK");
  const tokens = { ...block("") };
  if (dark) Object.assign(tokens, block(DARK));
  if (appearance.endsWith("CONTRAST")) {
    Object.assign(tokens, block(MORE));
    if (dark) Object.assign(tokens, block(`${MORE} and ${DARK}`));
  }
  return tokens;
}

type Rgba = [number, number, number, number];

/** The first #RRGGBB or rgb()/rgba() colour in a value, so a box-shadow such as the focus ring works too. */
function parseColor(value: string): Rgba {
  const hex = /#([0-9a-f]{6})\b/i.exec(value);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
  const fn = /rgba?\(([^)]+)\)/.exec(value);
  if (fn) {
    const [r, g, b, a = 1] = fn[1].split(",").map(Number);
    return [r, g, b, a];
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

/** Pairs of DESIGN's colour table (3.2 › Colour tokens, Contrast targets): [foreground, background]. */
const TEXT = ["--label", "--label-2", "--label-3", "--accent-text", "--rec", "--error", "--warning", "--success"];
const TINTS = ["--sel-unemph", "--sel-accent", "--match", "--evidence", "--diff-ins", "--diff-del", "--error-tint", "--warning-tint", "--success-tint", "--info-tint"];
export const TEXT_PAIRS: [string, string][] = [
  ...TEXT.flatMap((t): [string, string][] => [[t, "--content-bg"], [t, "--card-bg"]]),
  ["--on-accent", "--accent-fill"],
  ...TINTS.map((bg): [string, string] => ["--label", bg]),
];
export const NON_TEXT_PAIRS: [string, string][] = ["--ctrl-border", "--accent", "--accent-fill", "--focus-ring", "--rec", "--error", "--warning", "--success"].map((t) => [t, "--content-bg"]);

// @cpt-algo:cpt-noter-algo-ui-tokens-theming-check-contrast:p1
// @cpt-dod:cpt-noter-dod-ui-tokens-theming-contrast-check:p1
export function checkContrast(tokens: Tokens, textPairs = TEXT_PAIRS, nonTextPairs = NON_TEXT_PAIRS): string[] {
  const failures: string[] = [];
  const check = (fg: string, bg: string, min: number) => {
    const ratio = contrastRatio(tokens[fg], tokens[bg], tokens["--content-bg"]);
    if (ratio < min) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`);
  };
  // @cpt-begin:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-for-each-text
  for (const [fg, bg] of textPairs) {
    // @cpt-begin:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-text-ratio
    check(fg, bg, 4.5);
    // @cpt-end:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-text-ratio
  }
  // @cpt-end:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-for-each-text
  // @cpt-begin:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-for-each-nontext
  for (const [fg, bg] of nonTextPairs) {
    // @cpt-begin:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-nontext-ratio
    check(fg, bg, 3);
    // @cpt-end:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-nontext-ratio
  }
  // @cpt-end:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-for-each-nontext
  // @cpt-begin:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-return-check
  return failures;
  // @cpt-end:cpt-noter-algo-ui-tokens-theming-check-contrast:p1:inst-return-check
}
