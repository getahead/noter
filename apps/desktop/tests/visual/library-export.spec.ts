// Library › Export for the selected calls (cpt-noter-dod-ui-library-search-topics-search): the Export sheet for three
// calls (scope line "3 calls", no Audio) and the "Exported to …" line, at Wide, against the fake core.
// Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import * as W from "../support/world-presets";
import { settled } from "./freeze";

const ROW = '[data-component="cpt-noter-component-ui-call-row"][data-variant="table-row"]';

async function calls(page: Page) {
  await page.setViewportSize({ width: 1400, height: 800 });
  await openWindow(page, "main", { world: (w) => (W.idle(w), (w.app.setup.self_test = { type: "passed", at: 1 }), W.morePastCalls(w, 3)) });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit3");
    await expect(page.getByRole("heading", { name: "Calls", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
}
const shot = async (page: Page, name: string) => {
  await page.mouse.move(0, 0);
  await settled(page);
  await expect(page).toHaveScreenshot(`${name}.png`);
};

test.describe("cpt-noter-dod-ui-library-search-topics-search Export of selected calls", () => {
  test("the sheet for three calls and the result line", async ({ page }) => {
    await calls(page);
    await page.locator(ROW).first().click();
    await page.locator(ROW).nth(2).click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "Export…" }).click();
    const sheet = page.getByRole("dialog", { name: /Export/ });
    await expect(sheet).toContainText("Scope: 3 calls");
    await expect(sheet).not.toContainText("Audio");
    await shot(page, "library-export-sheet");
    await sheet.getByRole("button", { name: "Export…" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Exported to" })).toBeVisible();
    await shot(page, "library-export-done");
  });

  test("the Calls context menu offers Export… with ⌘E before Delete…", async ({ page }) => {
    await calls(page);
    await page.locator(ROW).first().click();
    await page.locator(ROW).nth(1).click({ modifiers: ["Meta"] });
    await page.locator(ROW).first().click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: /^Export…/ })).toBeVisible();
    await shot(page, "library-export-menu");
  });
});
