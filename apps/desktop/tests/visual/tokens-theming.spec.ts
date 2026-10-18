// Token sheet of cpt-noter-feature-ui-tokens-theming: every colour token, the three glass
// materials, the radius scale and the type scale, rendered from the production stylesheet in
// the four appearance states, plus live restyling when macOS changes appearance (no reload).
// Reduce transparency has no Playwright emulation; tokens.test.ts covers it on the stylesheet.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const css = read("../../src/styles/tokens.css");
// The prototype of record, with its own appearance blocks (docs/prototype/clickable/src/css).
const prototype = ["00-base", "01-macos27", "02-contrast"].map((f) => read(`../../../../docs/prototype/clickable/src/css/${f}.css`)).join("\n");

const colours = [
  "win-bg", "side-bg", "content-bg", "card-bg", "ctrl-bg", "label", "label-2", "label-3", "label-dis", "sep",
  "ctrl-border", "ctrl-border-soft", "accent", "accent-fill", "accent-text", "sel-unemph", "sel-accent", "rec", "error",
  "warning", "success", "error-tint", "warning-tint", "success-tint", "info-tint", "match", "evidence", "diff-ins", "diff-del",
];
const radii = ["window", "panel", "sheet", "popover", "card", "menu", "row", "control", "tag", "key", "capsule"];
const type = ["large", "title1", "title2", "title3", "headline", "body", "callout", "sub", "foot", "call-transcript", "call-card", "call-card-floating"];

const sheet = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: var(--win-bg); color: var(--label); font: 400 13px/18px var(--font); }
  .grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 16px; }
  .sw { background: var(--content-bg); border: 1px solid var(--sep); border-radius: var(--r-control); padding: 6px; }
  .sw i { display: block; height: 28px; border-radius: var(--r-tag); border: 1px solid var(--ctrl-border-soft); margin-bottom: 4px; }
  .row { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
  .glass { width: 160px; height: 56px; padding: 8px; border-radius: var(--r-card); }
  .r { width: 48px; height: 32px; background: var(--accent-fill); color: var(--on-accent); font-size: 10px; display: grid; place-items: center; }
  .card { background: var(--card-bg); border-radius: var(--r-card); box-shadow: var(--shadow-pop); padding: 12px; }
  .focus { box-shadow: var(--focus-ring); border: 1px solid var(--ctrl-border); border-radius: var(--r-control); background: var(--ctrl-bg); padding: 4px 12px; }
</style></head><body>
  <div class="grid">${colours.map((c) => `<div class="sw" data-token="${c}"><i style="background: var(--${c})"></i>${c}</div>`).join("")}</div>
  <div class="row" style="background: linear-gradient(90deg, var(--accent), var(--success)); padding: 12px;">
    <div class="np-glass glass">glass</div>
    <div class="np-glass glass" style="background: var(--glass-bg-strong)">glass strong</div>
    <div class="np-glass glass" style="background: var(--side-bg)">sidebar</div>
  </div>
  <div class="row">${radii.map((r) => `<div class="r" style="border-radius: var(--r-${r})">${r}</div>`).join("")}</div>
  <div class="row"><span class="focus">Focus ring</span><span style="color: var(--label-2)">Secondary</span><span style="color: var(--label-3)">Tertiary</span><span style="color: var(--accent-text)">Accent text</span><span class="np-mono np-tnum">00:42:17</span></div>
  <div class="card">${type.map((t) => `<div class="t-${t}">${t} — Sprint 42 retro</div>`).join("")}</div>
</body></html>`;

const states = {
  light: { colorScheme: "light", contrast: "no-preference" },
  dark: { colorScheme: "dark", contrast: "no-preference" },
  "light-contrast": { colorScheme: "light", contrast: "more" },
  "dark-contrast": { colorScheme: "dark", contrast: "more" },
} as const;

const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test.describe("cpt-noter-state-ui-tokens-theming-appearance token sheet", () => {
  for (const [state, media] of Object.entries(states)) {
    test(`renders the token sheet (${state})`, async ({ page }) => {
      await page.emulateMedia(media);
      await page.setContent(sheet);
      await expect(page).toHaveScreenshot(`tokens-${state}.png`, { fullPage: true, timeout: 15_000 }); // amd64 emulation on Apple Silicon is slow
    });
  }
});

/** Every custom property of the page's top-level `:root` rules, resolved for the current media. */
const rootTokens = (page: Page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const names = [...document.styleSheets].flatMap((s) => [...s.cssRules])
      .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText === ":root")
      .flatMap((r) => [...r.style]).filter((n) => n.startsWith("--"));
    return Object.fromEntries(names.map((n) => [n, root.getPropertyValue(n).trim()]));
  });

test.describe("cpt-noter-state-ui-tokens-theming-appearance matches the prototype", () => {
  for (const [state, media] of Object.entries(states)) {
    test(`every prototype token resolves to the prototype's value (${state})`, async ({ page }) => {
      await page.emulateMedia(media);
      await page.setContent(`<style>${prototype}</style>`);
      const expected = Object.fromEntries(Object.entries(await rootTokens(page)).filter(([n]) => !/^--(wall|desk|chrome)-/.test(n)));
      // Production drops the blur through --glass-blur; the prototype does it per surface (02-contrast.css).
      if (media.contrast === "more") expected["--glass-blur"] = "none";
      await page.setContent(`<style>${css}</style>`);
      const actual = await rootTokens(page);
      expect(Object.keys(expected).length).toBeGreaterThan(40);
      expect(Object.fromEntries(Object.keys(expected).map((n) => [n, actual[n]]))).toEqual(expected);
    });
  }
});

test.describe("cpt-noter-flow-ui-tokens-theming-follow-appearance", () => {
  test("restyles an open page on every appearance transition without a reload", async ({ page }) => {
    await page.emulateMedia(states.light);
    await page.setContent(sheet);
    // Marker that would vanish on a reload.
    await page.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
    const label = async () => (await token(page, "--label")).toUpperCase();
    expect(await token(page, "--content-bg")).toBe("#FFFFFF");

    await page.emulateMedia(states.dark); // LIGHT -> DARK
    expect(await token(page, "--content-bg")).toBe("#1E1E1E");
    await page.emulateMedia(states["dark-contrast"]); // DARK -> DARK_CONTRAST
    expect(await label()).toBe("#F2F2F2");
    expect(await token(page, "--focus-ring")).toBe("0 0 0 3px #4DA3FF");
    await page.emulateMedia(states["light-contrast"]); // DARK_CONTRAST -> LIGHT_CONTRAST
    expect(await label()).toBe("#1D1D1F");
    expect(await token(page, "--focus-ring")).toBe("0 0 0 3px #0064D1");
    await page.emulateMedia(states.light); // LIGHT_CONTRAST -> LIGHT
    expect(await token(page, "--label")).toBe("rgba(0,0,0,.85)");

    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
  });

  test("Increase Contrast drops the glass blur; it is back when it turns off", async ({ page }) => {
    await page.setContent(sheet);
    const blur = () => page.locator(".np-glass").first().evaluate((el) => getComputedStyle(el).backdropFilter || getComputedStyle(el).getPropertyValue("-webkit-backdrop-filter"));
    await page.emulateMedia(states.light);
    expect(await blur()).toContain("blur(22px)");
    for (const media of [states["light-contrast"], states["dark-contrast"]]) {
      await page.emulateMedia(media);
      expect(await blur()).toBe("none");
    }
    await page.emulateMedia(states.dark);
    expect(await blur()).toContain("blur(22px)");
  });

  test("Increase Contrast outlines tags and chips, draws a solid focus outline and borders controls", async ({ page }) => {
    await page.setContent(`<style>${css}</style><span class="np-badge" style="color: rgb(1, 2, 3)">Draft</span>
      <span class="np-btn" tabindex="0">Save</span><span class="np-btn np-btn--primary">Record</span>`); // a native <button> keeps WebKit's own look
    const style = (sel: string, prop: string) => page.locator(sel).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
    await page.emulateMedia(states.light);
    expect(await style(".np-badge", "box-shadow")).toBe("none");
    await page.emulateMedia(states["light-contrast"]);
    expect(await style(".np-badge", "box-shadow")).toBe("rgb(1, 2, 3) 0px 0px 0px 1px inset");
    expect(await style(".np-btn:not(.np-btn--primary)", "box-shadow")).toBe("rgba(0, 0, 0, 0.6) 0px 0px 0px 1px inset");
    expect(await style(".np-btn--primary", "box-shadow")).toBe("none");
    await page.keyboard.press("Tab");
    expect(await style(".np-btn:focus-visible", "outline")).toMatch(/3px solid rgb\(0, 100, 209\)|rgb\(0, 100, 209\) solid 3px/);
  });

  test("Reduce motion zeroes transitions and animations except the row spinner and level meters", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setContent(`<style>${css} @keyframes s { to { transform: rotate(1turn); } }
      div { transition: opacity .3s; animation: s 1s infinite; }</style>
      <div id="plain"></div><div class="np-spin" id="spin"></div><div class="np-meter"><div id="meter"></div></div>`);
    const timing = (id: string) =>
      page.locator(`#${id}`).evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.transitionDuration, s.animationDuration];
      });
    expect(await timing("plain")).toEqual(["0s", "0s"]);
    expect(await timing("spin")).toEqual(["0.3s", "1s"]);
    expect(await timing("meter")).toEqual(["0.3s", "1s"]);
  });
});
