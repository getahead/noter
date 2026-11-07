import { expect, test } from "@playwright/test";
import { openWindow } from "../e2e/support/app";
import { navigate } from "../e2e/support/call-page";
import * as S from "../e2e/support/speakers-world";
import * as W from "../support/world-presets";

// D320-4: WebKit can report the 22pt backdrop filter without painting it.
// The approved opaque fallback must prevent transcript bleed-through, measured
// against the same frame with transcript ink hidden (no platform baseline).
for (const colorScheme of ["light", "dark"] as const) {
  for (const appearance of ["normal", "contrast", "reduce-transparency"] as const) {
    test(`cpt-noter-seq-call-screen-name-speaker readable popover (${colorScheme}, ${appearance})`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme, contrast: appearance === "contrast" ? "more" : "no-preference", reducedMotion: "reduce" });
      await openWindow(page, "call-screen");
      await page.getByRole("button", { name: "Speaker 3", exact: true }).first().click();
      const popover = page.getByRole("dialog", { name: "Rename Speaker 3" });
      await expect(popover.getByRole("combobox", { name: "Name…" })).toBeFocused();
      // Playwright has no reduced-transparency emulation. Activate the actual
      // production media rules, retaining their other conditions (including dark).
      if (appearance === "reduce-transparency") {
        await page.evaluate(() => {
          for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) {
            if (rule instanceof CSSMediaRule && rule.conditionText.includes("prefers-reduced-transparency")) {
              rule.media.mediaText = rule.conditionText.replace("(prefers-reduced-transparency: reduce)", "(min-width: 0px)");
            }
          }
        });
      }
      const material = await popover.evaluate(el => {
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, blur: style.backdropFilter, glass: style.getPropertyValue("--glass-bg").trim() };
      });
      expect(material.blur).toBe(appearance === "normal" ? "blur(22px) saturate(1.85)" : "none");
      if (appearance === "contrast") {
        expect(material.glass).toBe(colorScheme === "light" ? "rgba(255,255,255,.94)" : "rgba(38,38,40,.96)");
      }
      expect(material.background).toBe(colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(42, 42, 42)");
      await popover.evaluate(el => (el.querySelector("input") as HTMLElement)?.blur());
      const screenshot = testInfo.outputPath(`${colorScheme}-${appearance}.png`);
      await page.screenshot({ path: screenshot, animations: "disabled", caret: "hide" });
      await testInfo.attach(`${colorScheme}-${appearance}`, { path: screenshot, contentType: "image/png" });
      const bounds = (await popover.boundingBox())!;
      // Exclude the rounded corners, which intentionally reveal the background.
      const clip = { x: bounds.x + 24, y: bounds.y + 24, width: bounds.width - 48, height: bounds.height - 48 };
      const withTranscript = await page.screenshot({ clip, animations: "disabled", caret: "hide" });
      await page.locator(".cw-seg__text").evaluateAll(elements => elements.forEach(el => (el as HTMLElement).style.visibility = "hidden"));
      const withoutTranscript = await page.screenshot({ clip, animations: "disabled", caret: "hide" });
      expect(withTranscript.equals(withoutTranscript), "Transcript ink must not bleed through Rename speaker").toBe(true);
    });
  }
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`cpt-noter-seq-call-page-name-speakers readable correction popover (${colorScheme})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await openWindow(page, "main", { world: w => { W.idle(w); w.app.setup.self_test = { type: "passed", at: 1 }; } });
    await navigate(page, "transcript", S.CALL);
    const text = page.locator(".cw-seg__text").first();
    await text.dblclick();
    await text.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Fix Term…", exact: true }).click();
    const popover = page.getByRole("dialog", { name: "Fix term" });
    await expect(popover).toBeVisible();
    await expect(popover).toHaveCSS("background-color", colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(42, 42, 42)");
    await popover.evaluate(el => (el.querySelector("input") as HTMLElement)?.blur());
    const screenshot = testInfo.outputPath(`fix-term-${colorScheme}.png`);
    await page.screenshot({ path: screenshot, animations: "disabled", caret: "hide" });
    await testInfo.attach(`fix-term-${colorScheme}`, { path: screenshot, contentType: "image/png" });
    const bounds = (await popover.boundingBox())!;
    const clip = { x: bounds.x + 24, y: bounds.y + 24, width: bounds.width - 48, height: bounds.height - 48 };
    const withTranscript = await page.screenshot({ clip, animations: "disabled", caret: "hide" });
    await page.locator(".cw-seg__text").evaluateAll(elements => elements.forEach(el => (el as HTMLElement).style.visibility = "hidden"));
    const withoutTranscript = await page.screenshot({ clip, animations: "disabled", caret: "hide" });
    expect(withTranscript.equals(withoutTranscript), "Transcript ink must not bleed through Fix Term").toBe(true);
  });
}
