// Pseudo-localisation pass of cpt-noter-feature-ui-accessibility-l10n: every window label rendered
// with Cyrillic (+40 %) and German (+30 %) pseudo-strings (?pseudo=), failing on any truncated
// button, menu item, tab, option or sidebar label, then compared with its screenshot baseline.
// The record prompt is drawn for a detected call, with its own buttons. The other windows' pseudo
// passes run on their real screens in e2e/m0-a11y-l10n-screens.spec.ts and main-window-shell.spec.ts.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import * as W from "../support/world-presets";

const TRUNCATABLE = 'button, [role="menuitem"], [role="tab"], [role="option"], [data-region="sidebar"] [role="listitem"]';

/** Labels clipped across (ellipsis) or down (line clamp, fixed height). */
const truncatedLabels = (page: Page) =>
  page.$$eval(TRUNCATABLE, (els) =>
    els
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .map((el) => (el.textContent ?? "").trim() || el.getAttribute("aria-label") || el.tagName),
  );

for (const mode of ["cyrillic", "german"] as const) {
  test(`record-prompt in ${mode} pseudo-localisation shows no truncated label`, async ({ page }) => {
    const world = (w: Parameters<typeof W.idle>[0]) => (W.idle(w), (w.app.setup.self_test = { type: "passed", at: 1 }), W.detect(w, W.APPS.teams));
    await openWindow(page, `record-prompt&pseudo=${mode}`, { world });
    await expect(page.locator('[data-component="cpt-noter-component-ui-record-prompt"]')).toBeVisible();
    const truncated = await truncatedLabels(page);
    expect(truncated, `truncated labels: ${truncated.join(", ")}`).toEqual([]);
    await expect(page).toHaveScreenshot(`record-prompt-${mode}.png`, { fullPage: true });
  });
}
