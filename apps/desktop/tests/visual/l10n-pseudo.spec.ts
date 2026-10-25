// Pseudo-localisation pass of cpt-noter-feature-ui-accessibility-l10n: every window label rendered
// with Cyrillic (+40 %) and German (+30 %) pseudo-strings (?pseudo=), failing on any truncated
// button, menu item, tab, option or sidebar label, then compared with its screenshot baseline.
// Until the screens land, each window shows its section-level error (catalogue text and the
// Try Again button), so the pass measures real localised controls, not an empty frame. The record
// prompt has landed: it is drawn for a detected call, with its own buttons.
import { expect, test, type Page } from "@playwright/test";

import { COMMANDS } from "../../src/core/bindings";
import { setPseudo, t, type Pseudo } from "../../src/i18n/format";
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

const pseudo = (mode: Pseudo, key: Parameters<typeof t>[0]) => {
  setPseudo(mode);
  const text = t(key);
  setPseudo("off");
  return text;
};

for (const label of COMMANDS.app_snapshot.windows) {
  for (const mode of ["cyrillic", "german"] as const) {
    test(`${label} in ${mode} pseudo-localisation shows no truncated label`, async ({ page }) => {
      if (label === "record-prompt") {
        const world = (w: Parameters<typeof W.idle>[0]) => (W.idle(w), (w.app.setup.self_test = { type: "passed", at: 1 }), W.detect(w, W.APPS.teams));
        await openWindow(page, `${label}&pseudo=${mode}`, { world });
        await expect(page.locator('[data-component="cpt-noter-component-ui-record-prompt"]')).toBeVisible();
      } else {
        await openWindow(page, `${label}&pseudo=${mode}`, { fail: [{ cmd: "app_snapshot", code: "not_ready" }] });
        await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "failed");
        await expect(page.getByText(pseudo(mode, "window.error"))).toBeVisible();
        await expect(page.getByRole("button", { name: pseudo(mode, "action.try_again") })).toBeVisible();
      }
      const truncated = await truncatedLabels(page);
      expect(truncated, `truncated labels: ${truncated.join(", ")}`).toEqual([]);
      await expect(page).toHaveScreenshot(`${label}-${mode}.png`, { fullPage: true });
    });
  }
}

test("the truncation check fails on a deliberately long label, across or down", async ({ page }) => {
  await page.setContent(`<button style="width: 60px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">Keep Recording Anyway</button>
    <button style="width: 60px; height: 20px; overflow: hidden">Keep Recording Anyway</button>
    <button>Fits</button>`);
  expect(await truncatedLabels(page)).toEqual(["Keep Recording Anyway", "Keep Recording Anyway"]);
});
