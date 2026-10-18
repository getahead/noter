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
const proto = (f: string) => read(`../../../../docs/prototype/clickable/src/css/${f}.css`);
const prototype = ["00-base", "01-macos27", "02-contrast"].map(proto).join("\n");
const groups = ["10-a", "20-b", "30-c", "40-d", "50-e", "60-f"];
// The prototype's component sheets as production ports them: 00-base without its token blocks and
// motion rule (tokens.css replaces them), then 01-macos27 and the screen groups, all after tokens.css.
const base = proto("00-base");
const components = [base.slice(base.indexOf("}", base.indexOf(':root[data-theme="dark"]')) + 1).replace(/@media \(prefers-reduced-motion: reduce\)[^\n]*\n/, ""), proto("01-macos27"), ...groups.map(proto)].join("\n");
const wholePrototype = ["00-base", "01-macos27", "02-contrast", ...groups].map(proto).join("\n");
// Increase Contrast values changed from the prototype to meet WCAG 2.2 AA (PRD AC5; FEATURE spec › Additional Context).
const deviations: Record<string, Record<string, string>> = {
  "light-contrast": { "--accent-text": "#0060C9" },
  "dark-contrast": { "--accent-text": "#6DB4FF" },
};

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
      Object.assign(expected, deviations[state]);
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

  // The prototype's component sheets load after tokens.css and carry rules as specific as `:root .np-btn`
  // (`.np-toolbar .np-btn`); the Increase Contrast treatments must still win, as they do in the prototype.
  const controls = `<div class="np-toolbar"><button class="np-btn">Share</button><button class="np-btn np-btn--quiet">Quiet</button>
      <button class="np-btn np-btn--primary">Record</button><span class="np-popup"><select><option>All</option></select></span>
      <div class="np-toolbar__nav">n</div><div class="np-search">q</div></div>
    <button class="np-btn">Cancel</button><span class="np-popup"><select><option>A</option></select></span><input class="np-field__input">
    <span class="np-check__box"></span><span class="np-radio__dot"></span><span class="np-toggle__track"></span>
    <span class="np-badge">Draft</span><span class="np-lang">EN</span><div class="np-sidebar">s</div><div class="np-menu">m</div><div class="np-pop">p</div>`;
  const treatments = (page: Page) =>
    page.evaluate(() => [...document.body.querySelectorAll("*:not(style)")].map((el) => {
      const s = getComputedStyle(el);
      return [el.className || el.tagName, s.boxShadow, s.backdropFilter || s.getPropertyValue("-webkit-backdrop-filter")];
    }));
  for (const state of ["light-contrast", "dark-contrast"] as const) {
    test(`Increase Contrast treatments win over the component sheets loaded after tokens.css (${state})`, async ({ page }) => {
      await page.emulateMedia(states[state]);
      const theme = state === "dark-contrast" ? ' data-theme="dark"' : "";
      await page.setContent(`<html data-contrast="more"${theme}><body><style>${wholePrototype}</style>${controls}</body></html>`);
      const expected = await treatments(page);
      await page.setContent(`<html><body><style>${css}</style><style>${components}</style>${controls}</body></html>`);
      const actual = await treatments(page);
      expect(actual.find(([c]) => c === "np-btn")?.[1]).toMatch(/0px 0px 0px 1px inset/);
      expect(actual).toEqual(expected);
    });
  }

  test("Increase Contrast fills the destructive button, the icon badge and the failed step dot in --error-fill", async ({ page }) => {
    const markup = `<button class="np-btn np-btn--destructive np-btn--primary">Delete</button><span class="np-ibtn__badge">3</span>
      <div class="f-steps__i is-err"><span class="f-steps__dot">2</span></div>`;
    // no transitions: .np-btn eases its background, and the check reads it right after each appearance change
    await page.setContent(`<html><body><style>${css}</style><style>${components} * { transition: none !important; }</style>${markup}</body></html>`);
    const fills = () => page.evaluate(() => [".np-btn", ".np-ibtn__badge", ".f-steps__dot"].map((sel) => {
      const s = getComputedStyle(document.querySelector(sel)!);
      return [s.backgroundColor, s.color];
    }));
    const white = "rgb(255, 255, 255)";
    await page.emulateMedia(states["dark-contrast"]);
    expect(await fills()).toEqual(Array(3).fill(["rgb(196, 81, 75)", white]));
    await page.emulateMedia(states["light-contrast"]);
    expect(await fills()).toEqual(Array(3).fill(["rgb(196, 40, 28)", white]));
    await page.emulateMedia(states.dark); // the system red outside Increase Contrast, as in the prototype
    expect(await fills()).toEqual(Array(3).fill(["rgb(255, 69, 58)", white]));
  });

  test("Reduce motion zeroes transitions and animations except the level meters; the row spinner stands still", async ({ page }) => {
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
    expect(await timing("spin")).toEqual(["0s", "0s"]); // stationary, as in the prototype (00-base.css)
    expect(await timing("meter")).toEqual(["0.3s", "1s"]);
  });
});
