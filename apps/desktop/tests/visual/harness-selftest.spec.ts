// Self-test of the screenshot pipeline: renders a fixed page of UI primitives
// (no app needed) so a broken container, font set or comparison setting shows
// up before any real screen depends on it. Product screens get their own specs
// here, one per DESIGN.md screen and state, rendered against the fake core.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const fixture = readFileSync(fileURLToPath(new URL("./fixtures/primitives.html", import.meta.url)), "utf8");

for (const scheme of ["light", "dark"] as const) {
  test(`primitives render identically (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setContent(fixture);
    await expect(page).toHaveScreenshot(`primitives-${scheme}.png`, { fullPage: true });
  });
}
