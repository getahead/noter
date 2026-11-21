import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contrastRatio, resolveTokens, type Appearance } from "./tokens";
import { accentTokens, installNativeAccent } from "./native-accent";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const appearances: Appearance[] = ["LIGHT", "DARK", "LIGHT_CONTRAST", "DARK_CONTRAST"];
const accents: [number, number, number][] = [[0, 122, 255], [175, 82, 222], [142, 142, 147], [255, 204, 0], [0, 0, 0], [255, 255, 255]];
afterEach(() => vi.unstubAllGlobals());

describe("native accent (cpt-noter-flow-ui-tokens-theming-follow-appearance)", () => {
  it.each(appearances)("keeps accent text, fills and focus accessible in %s", (appearance) => {
    const base = resolveTokens(css, appearance);
    for (const rgb of accents) {
      const tokens = { ...base, ...accentTokens(rgb, appearance, base) };
      for (const bg of ["--content-bg", "--card-bg", "--win-bg"]) {
        expect(contrastRatio(tokens["--accent-text"], tokens[bg])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(tokens["--accent-text"], tokens["--sel-accent"], tokens[bg])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(tokens["--accent"], tokens[bg])).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(tokens["--accent-fill"], tokens[bg])).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(tokens["--focus-ring"], tokens[bg])).toBeGreaterThanOrEqual(3);
      }
      // Sidebars paint over the content surface, including their opaque accessibility variant.
      expect(contrastRatio(tokens["--accent-text"], tokens["--side-bg"], tokens["--content-bg"])).toBeGreaterThanOrEqual(4.5);
      for (const key of ["--accent", "--accent-fill", "--focus-ring"]) {
        expect(contrastRatio(tokens[key], tokens["--side-bg"], tokens["--content-bg"])).toBeGreaterThanOrEqual(3);
      }
      expect(contrastRatio(tokens["--on-accent"], tokens["--accent-fill"])).toBeGreaterThanOrEqual(4.5);
      expect(tokens["--on-accent"]).toBe("#FFFFFF");
    }
    expect(accentTokens(accents[0], appearance, base)).not.toEqual(accentTokens(accents[1], appearance, base));
    const graphite = accentTokens([142, 142, 142], appearance, base)["--accent"];
    expect(graphite.slice(1, 3)).toBe(graphite.slice(3, 5));
  });

  it("derives the accent from the minified surfaces a production build computes", () => {
    // getComputedStyle in the packaged app returns tokens.css as the minifier wrote it (0.24.1 went blank on these)
    const minified = {
      LIGHT: { "--content-bg": "#fff", "--card-bg": "#fff", "--win-bg": "#f5f5f5", "--side-bg": "#f2f2f49e" },
      DARK: { "--content-bg": "#1e1e1e", "--card-bg": "#2a2a2a", "--win-bg": "#262626", "--side-bg": "#26262894" },
    } as const;
    for (const appearance of ["LIGHT", "DARK"] as const) {
      expect(accentTokens([0, 122, 255], appearance, minified[appearance])).toEqual(accentTokens([0, 122, 255], appearance, resolveTokens(css, appearance)));
    }
  });

  it("updates on appearance changes, replaces an accent and cleans up listeners and overrides", () => {
    let dark = false;
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("matchMedia", (q: string) => ({ get matches() { return q.includes("dark") && dark; }, addEventListener: (_: string, fn: () => void) => listeners.set(q, fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(q) }));
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (key: string) => resolveTokens(css, dark ? "DARK" : "LIGHT")[key] }));
    const values = new Map<string, string>();
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn(), style: { setProperty: (k: string, v: string) => values.set(k, v), removeProperty: (k: string) => values.delete(k) } } as unknown as HTMLElement;
    const stop = installNativeAccent([175, 82, 222], root);
    const light = values.get("--accent-text");
    dark = true;
    listeners.forEach((fn) => fn());
    expect(values.get("--accent-text")).not.toBe(light);
    expect(listeners.size).toBe(3);
    stop();
    expect(values.size).toBe(0);
    expect(listeners.size).toBe(0);
    const stopBlue = installNativeAccent([0, 122, 255], root);
    expect(values.get("--accent-text")).not.toBe(light);
    stopBlue();
  });

  it("rechecks the focus boundary when reduced transparency makes the sidebar opaque", () => {
    let reduced = false;
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("matchMedia", (q: string) => ({ get matches() { return q.includes("reduced-transparency") && reduced; }, addEventListener: (_: string, fn: () => void) => listeners.set(q, fn), removeEventListener: () => listeners.delete(q) }));
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (key: string) => resolveTokens(css, "LIGHT", reduced)[key] }));
    const values = new Map<string, string>();
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn(), style: { setProperty: (k: string, v: string) => values.set(k, v), removeProperty: (k: string) => values.delete(k) } } as unknown as HTMLElement;
    const stop = installNativeAccent([255, 204, 0], root);
    try {
      const before = values.get("--accent");
      reduced = true;
      listeners.get("(prefers-reduced-transparency: reduce)")?.();
      const after = values.get("--accent")!;
      expect(after).not.toBe(before);
      const base = resolveTokens(css, "LIGHT", true);
      expect(contrastRatio(after, base["--side-bg"], base["--content-bg"])).toBeGreaterThanOrEqual(3);
    } finally { stop(); }
  });
});
