// Pseudo-localisation pass of cpt-noter-feature-ui-accessibility-l10n: every window label rendered
// with Cyrillic (+40 %) and German (+30 %) pseudo-strings (?pseudo=), failing on any truncated
// button, menu item, tab, option or sidebar label, then compared with its screenshot baseline.
import { expect, test } from "@playwright/test";

import { COMMANDS } from "../../src/core/bindings";

const TRUNCATABLE = 'button, [role="menuitem"], [role="tab"], [role="option"], [data-region="sidebar"] [role="listitem"]';

for (const label of COMMANDS.app_snapshot.windows) {
  for (const mode of ["cyrillic", "german"]) {
    test(`${label} in ${mode} pseudo-localisation shows no truncated label`, async ({ page }) => {
      await page.goto(`/?window=${label}&pseudo=${mode}`);
      // attached, not visible: a window whose screens are not built yet has no size
      await page.waitForSelector('[data-region="window"][data-state="ready"]', { state: "attached" });
      const truncated = await page.$$eval(TRUNCATABLE, (els) =>
        els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => (el.textContent ?? "").trim() || el.getAttribute("aria-label") || el.tagName),
      );
      expect(truncated, `truncated labels: ${truncated.join(", ")}`).toEqual([]);
      await expect(page).toHaveScreenshot(`${label}-${mode}.png`, { fullPage: true });
    });
  }
}
