// Library › Calls filter bar and tags (cpt-noter-dod-ui-library-search-topics-search): the bar with tokens, the Tags
// pop-up, filtered-empty, several selected and the Add Tag popover at Wide, Medium and Narrow, against the fake core.
// Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import * as W from "../support/world-presets";
import { settled } from "./freeze";

const WIDTHS = { wide: 1400, medium: 1000, narrow: 700 } as const;
const ROW = '[data-component="cpt-noter-component-ui-call-row"][data-variant="table-row"]';

async function calls(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await openWindow(page, "main", { world: (w) => (W.idle(w), (w.app.setup.self_test = { type: "passed", at: 1 }), W.morePastCalls(w, 3)) });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit3");
    await expect(page.getByRole("heading", { name: "Calls", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
}
const shot = async (page: Page, name: string, width: string) => {
  await page.mouse.move(0, 0);
  await settled(page);
  await expect(page).toHaveScreenshot(`${name}-${width}.png`);
};

for (const [width, px] of Object.entries(WIDTHS)) {
  test.describe(`cpt-noter-dod-ui-library-search-topics-search Filters at ${width}`, () => {
    test("bar with a token and Has Open Items", async ({ page }) => {
      await calls(page, px);
      await page.getByRole("button", { name: "Has Open Items" }).click();
      await expect(page.getByRole("button", { name: "Clear Filters" })).toBeVisible();
      await shot(page, "filters-bar", width);
    });
    test("Tags pop-up", async ({ page }) => {
      await calls(page, px);
      await page.getByRole("button", { name: /^Tags/ }).click();
      await expect(page.getByRole("dialog", { name: "Tags" })).toBeVisible();
      await shot(page, "filters-tags-popup", width);
    });
    test("People pop-up is opaque", async ({ page }) => {
      await calls(page, px);
      await page.getByRole("button", { name: /^People/ }).click();
      await expect(page.getByRole("dialog", { name: "People" })).toBeVisible();
      await shot(page, "filters-people-popup", width);
    });
    test("People pop-up with two people ticked", async ({ page }) => {
      await calls(page, px);
      await page.getByRole("button", { name: /^People/ }).click();
      const pop = page.getByRole("dialog", { name: "People" });
      await pop.locator("label.np-check").nth(0).click();
      await pop.locator("label.np-check").nth(1).click();
      await expect(pop.getByRole("checkbox", { checked: true })).toHaveCount(2);
      await shot(page, "filters-people-ticked", width);
    });
    test("Calls menu with Remove Tag", async ({ page }) => {
      await calls(page, px);
      await page.locator(ROW).first().click();
      await page.locator(ROW).first().click({ button: "right" });
      await expect(page.getByRole("menuitem", { name: "Add Tag…" })).toBeVisible();
      await shot(page, "filters-remove-tag-menu", width);
    });
    test("several selected and the Add Tag popover", async ({ page }) => {
      await calls(page, px);
      await page.locator(ROW).first().click();
      await page.locator(ROW).nth(2).click({ modifiers: ["Shift"] });
      await page.locator(ROW).nth(1).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Add Tag…" }).click();
      await expect(page.getByRole("dialog", { name: /Add tag to/ })).toBeVisible();
      await shot(page, "filters-add-tag", width);
    });
  });
}
