// Contrast and material checks of the token stylesheet (docs/features/ui/tokens-theming.md).
// Reads tokens.css as text: Playwright cannot emulate Reduce transparency, so the
// opaque-material rule is checked here on the stylesheet itself.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkContrast, contrastRatio, resolveTokens, rootBlocks } from "./tokens";

const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for equal colours", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#1E1E1E", "#1E1E1E")).toBeCloseTo(1, 5);
  });

  it("composites a translucent foreground and background before measuring", () => {
    // black 60 % on white is #666666
    expect(contrastRatio("rgba(0,0,0,.60)", "#FFFFFF")).toBeCloseTo(contrastRatio("#666666", "#FFFFFF"), 1);
    // a tint is laid over its base first
    expect(contrastRatio("#000000", "rgba(255,255,255,.5)", "#000000")).toBeCloseTo(contrastRatio("#000000", "#808080"), 1);
  });

  it("takes the colour out of a box-shadow value", () => {
    expect(contrastRatio("0 0 0 3px #0064D1", "#FFFFFF")).toBeCloseTo(contrastRatio("#0064D1", "#FFFFFF"), 5);
  });

  it("rejects a value without a colour and a translucent background without a base", () => {
    expect(() => contrastRatio("none", "#FFFFFF")).toThrow(/no colour/);
    expect(() => contrastRatio("#000000", "rgba(0,0,0,.5)")).toThrow(/opaque/);
  });
});

describe("tokens.css", () => {
  // cpt-noter-dod-ui-tokens-theming-contrast-check
  it.each(["LIGHT_CONTRAST", "DARK_CONTRAST"] as const)("meets WCAG 2.2 AA under Increase Contrast (%s)", (appearance) => {
    expect(checkContrast(resolveTokens(css, appearance))).toEqual([]);
  });

  it("reports every pair below its target", () => {
    const weak = { ...resolveTokens(css, "LIGHT_CONTRAST"), "--label-2": "#999999", "--ctrl-border": "rgba(0,0,0,.2)" };
    const failures = checkContrast(weak);
    expect(failures).toContain("--label-2 on --content-bg: 2.85 < 4.5");
    expect(failures.some((f) => f.startsWith("--ctrl-border on --content-bg"))).toBe(true);
  });

  it("resolves the prototype's values for each appearance", () => {
    expect(resolveTokens(css, "LIGHT")["--label"]).toBe("rgba(0,0,0,.85)");
    expect(resolveTokens(css, "DARK")["--content-bg"]).toBe("#1E1E1E");
    expect(resolveTokens(css, "LIGHT_CONTRAST")["--glass-bg"]).toBe("rgba(255,255,255,.94)");
    const dc = resolveTokens(css, "DARK_CONTRAST");
    expect(dc["--glass-bg"]).toBe("rgba(38,38,40,.96)");
    expect(dc["--focus-ring"]).toBe("0 0 0 3px #4DA3FF");
    expect(dc["--content-bg"]).toBe("#1E1E1E");
    expect(() => resolveTokens("", "LIGHT")).toThrow(/no :root block/);
  });

  it("keeps no prototype-only tokens or toggles", () => {
    expect(css).not.toMatch(/--(wall|desk|chrome)-|data-theme|data-contrast/);
  });

  it("blurs only through --glass-blur", () => {
    const filters = css.match(/backdrop-filter\s*:[^;]+/g) ?? [];
    expect(filters.length).toBeGreaterThan(0);
    for (const f of filters) expect(f).toMatch(/:\s*var\(--glass-blur\)$/);
  });

  it.each(["(prefers-reduced-transparency: reduce)", "(prefers-contrast: more)"])("drops the blur and keeps no backdrop-filter under %s", (query) => {
    expect(rootBlocks(css)[query]["--glass-blur"]).toBe("none");
    for (const [q, body] of mediaBodies(css)) if (q.includes(query)) expect(body).not.toMatch(/backdrop-filter\s*:\s*(?!none)/);
  });

  it("makes materials opaque under Reduce transparency", () => {
    const rt = rootBlocks(css)["(prefers-reduced-transparency: reduce)"];
    for (const t of ["--side-bg", "--glass-bg", "--glass-bg-strong"]) expect(rt[t]).not.toMatch(/rgba|transparent/);
  });

  it("stops motion under Reduce motion except the row spinner and level meters", () => {
    const body = mediaBodies(css).find(([q]) => q === "(prefers-reduced-motion: reduce)")?.[1] ?? "";
    expect(body).toMatch(/transition-duration:\s*0s !important/);
    expect(body).toMatch(/animation-duration:\s*0s !important/);
    expect(body).toMatch(/:not\(\.np-spin\)/);
    expect(body).toMatch(/:not\(\.np-meter \*\)/);
  });
});

/** [query, body] of each top-level @media block. */
function mediaBodies(text: string): [string, string][] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: [string, string][] = [];
  for (let i = src.indexOf("@media"); i >= 0; i = src.indexOf("@media", i + 1)) {
    const open = src.indexOf("{", i);
    let depth = 1;
    let j = open + 1;
    for (; depth > 0; j++) depth += src[j] === "{" ? 1 : src[j] === "}" ? -1 : 0;
    out.push([src.slice(i + 6, open).trim(), src.slice(open + 1, j - 1)]);
    i = j;
  }
  return out;
}
