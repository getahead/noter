// Screenshot specs of the Person page (docs/features/ui/people.md › Acceptance Criteria): Overview at Wide, a person
// without calls, and the Calls view, rendered against the fake core. Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import * as W from "../support/world-presets";

async function openPerson(page: Page, name: RegExp) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWindow(page, "main", { world: W.idle });
  await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
  await page.keyboard.press("Meta+Digit4");
  await page.getByRole("table", { name: "People" }).getByRole("row", { name }).click();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-region="PE"]')).toBeVisible();
}
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await expect(page).toHaveScreenshot(`${name}.png`);
};

test.describe("cpt-noter-dod-ui-people-pages person page", () => {
  test("Overview: commitments, Asked you, topics, Identity and the last calls", async ({ page }) => {
    await openPerson(page, /Anna K\./);
    await expect(page.getByText("Last calls")).toBeVisible();
    await shot(page, "person-overview");
  });
  test("a person without calls", async ({ page }) => {
    await openPerson(page, /Lena K\./);
    await expect(page.getByText("No calls with Lena K. yet")).toBeVisible();
    await shot(page, "person-no-calls");
  });
  test("Calls lists every call with this person", async ({ page }) => {
    await openPerson(page, /Anna K\./);
    await page.getByRole("tab", { name: "Calls" }).click();
    await expect(page.locator('[data-region="PE-CALLS"]')).toBeVisible();
    await shot(page, "person-calls");
  });
});
