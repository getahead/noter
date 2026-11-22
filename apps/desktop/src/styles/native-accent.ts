import { compositeColor, contrastRatio, type Appearance, type Tokens } from "./tokens";

type RGB = readonly [number, number, number];
const hex = (rgb: RGB) => `#${rgb.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;

/** Move toward black/white only as far as the required contrast needs, retaining the accent hue. */
function accessible(rgb: RGB, accepts: (color: string) => boolean, light: boolean): string {
  for (const end of light ? [255, 0] : [0, 255]) {
    for (let step = 0; step <= 255; step++) {
      const color = hex(rgb.map((c) => c + (end - c) * step / 255) as unknown as RGB);
      if (accepts(color)) return color;
    }
  }
  throw new Error("accent has no accessible variant for these surfaces");
}

// @cpt-algo:cpt-noter-algo-ui-tokens-theming-resolve-tokens:p1
export function accentTokens(rgb: RGB, appearance: Appearance, base: Tokens): Tokens {
  const dark = appearance.startsWith("DARK");
  const backgrounds = [base["--content-bg"], base["--card-bg"], base["--win-bg"], compositeColor(base["--side-bg"], base["--content-bg"])];
  const selection = `rgba(${rgb.join(",")},${dark ? 0.30 : 0.16})`;
  const boundary = accessible(rgb, (c) => backgrounds.every((bg) => contrastRatio(c, bg) >= 3), dark);
  const text = accessible(rgb, (c) => backgrounds.every((bg) => contrastRatio(c, bg) >= 4.5 && contrastRatio(c, selection, bg) >= 4.5), dark);
  const fill = accessible(rgb, (c) => contrastRatio("#FFFFFF", c) >= 4.5 && backgrounds.every((bg) => contrastRatio(c, bg) >= 3), false);
  return { "--accent": boundary, "--accent-fill": fill, "--accent-text": text, "--sel-accent": selection, "--focus-ring": `0 0 0 3px ${boundary}` };
}

/** Each WebView observes its own media queries; env:changed replaces the native RGB on every window. */
// @cpt-flow:cpt-noter-flow-ui-tokens-theming-follow-appearance:p1
export function installNativeAccent(rgb: RGB, root = document.documentElement, report?: (error: Error) => void): () => void {
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const more = matchMedia("(prefers-contrast: more)");
  const media = [dark, more, matchMedia("(prefers-reduced-transparency: reduce)")];
  let keys: string[] = [];
  const clear = () => {
    root.removeAttribute("data-native-accent");
    for (const key of keys) root.style.removeProperty(key);
    keys = [];
  };
  const update = () => {
    try {
      const style = getComputedStyle(root);
      const base = Object.fromEntries(["--content-bg", "--card-bg", "--win-bg", "--side-bg"].map((key) => [key, style.getPropertyValue(key).trim()]));
      const appearance: Appearance = dark.matches ? more.matches ? "DARK_CONTRAST" : "DARK" : more.matches ? "LIGHT_CONTRAST" : "LIGHT";
      const tokens = accentTokens(rgb, appearance, base);
      keys = Object.keys(tokens);
      for (const [key, value] of Object.entries(tokens)) root.style.setProperty(key, value);
    } catch (error) {
      // a failed accent keeps the default theme; it must not take the window down (#1036)
      clear();
      report?.(error instanceof Error ? error : new Error(String(error)));
    }
  };
  root.setAttribute("data-native-accent", "");
  update();
  for (const query of media) query.addEventListener("change", update);
  return () => {
    for (const query of media) query.removeEventListener("change", update);
    clear();
  };
}
