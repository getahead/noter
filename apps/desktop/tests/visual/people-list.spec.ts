// Screenshot specs of the People list (docs/features/ui/people.md › Acceptance Criteria): the default list with the
// unnamed speakers, no people yet and no match for a query, rendered against the fake core.
// Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";

async function open(page: Page, world: (w: World) => void) {
  await openWindow(page, "main", { world });
  await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
  await page.keyboard.press("Meta+Digit4");
  await expect(page.locator('[data-region="PL-R2"]')).toBeVisible();
}
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await expect(page).toHaveScreenshot(`${name}.png`);
};

test.describe("cpt-noter-dod-ui-people-pages people list", () => {
  test("the people with their open items and the unnamed speakers", async ({ page }) => {
    await open(page, W.idle);
    await expect(page.getByRole("table", { name: "People" })).toBeVisible();
    await shot(page, "people-list");
  });
  test("no people yet", async ({ page }) => {
    await open(page, (w) => {
      W.idle(w);
      w.people = w.people.filter((p) => p.is_you);
    });
    await expect(page.getByText("No people yet").first()).toBeVisible();
    await shot(page, "people-empty");
  });
  test("no person matches the query", async ({ page }) => {
    await open(page, W.idle);
    await page.getByRole("searchbox", { name: "Search people" }).fill("Zzyzx");
    await expect(page.getByText("No people match “Zzyzx”")).toBeVisible();
    await shot(page, "people-no-match");
  });
});
