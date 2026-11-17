// Screenshot specs of the People surfaces that change a person (docs/features/ui/people.md): the Add Person popover,
// Edit Details and Merge sheets, the ⋯ menu and the row menu, plus a People list with a non-zero You owe.
// Delete Person… and Delete Profile… are native alerts (XCUITest), not drawn by the WebView.
// Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";

const owes = (w: World) => {
  W.idle(w);
  w.people.find((p) => p.id === "per_anna")!.you_owe = 2;
};
async function openPeople(page: Page, world: (w: World) => void = W.idle) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWindow(page, "main", { world });
  await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
  await page.keyboard.press("Meta+Digit4");
  await expect(page.locator('[data-region="PL-R2"]')).toBeVisible();
}
const openAnna = async (page: Page) => {
  await openPeople(page);
  await page.getByRole("table", { name: "People" }).getByRole("row", { name: /Anna K\./ }).click();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-region="PE"]')).toBeVisible();
};
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => scrollTo(0, 0));
  await expect(page).toHaveScreenshot(`${name}.png`);
};

test.describe("cpt-noter-dod-ui-people-identity people management", () => {
  test("You owe shows the core's count and stays blank at zero", async ({ page }) => {
    await openPeople(page, owes);
    await expect(page.getByRole("table", { name: "People" }).getByRole("cell", { name: "2", exact: true }).first()).toBeVisible();
    await shot(page, "people-you-owe");
  });
  test("Add Person opens the New person form under the button", async ({ page }) => {
    await openPeople(page);
    await page.getByRole("button", { name: "Add Person" }).click();
    await expect(page.getByRole("dialog", { name: "New person" })).toBeVisible();
    await shot(page, "people-add-person");
  });
  test("the row menu of one row offers Open, Edit Details…, Merge With… and Delete Person…", async ({ page }) => {
    await openPeople(page);
    await page.getByRole("table", { name: "People" }).getByRole("row", { name: /Anna K\./ }).click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Merge With…" })).toBeVisible();
    await shot(page, "people-row-menu");
  });
  test("the row menu of two rows offers Merge 2 People…", async ({ page }) => {
    await openPeople(page);
    const rows = page.getByRole("table", { name: "People" });
    await rows.getByRole("row", { name: /Anna K\./ }).click();
    await rows.getByRole("row", { name: /Dmitri S\./ }).click({ modifiers: ["Meta"] });
    await rows.getByRole("row", { name: /Dmitri S\./ }).click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Merge 2 People…" })).toBeVisible();
    await shot(page, "people-row-menu-two");
  });
  test("the person's ⋯ menu", async ({ page }) => {
    await openAnna(page);
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menuitem", { name: "Edit Details…" })).toBeVisible();
    await shot(page, "person-more-menu");
  });
  test("Edit Details sheet", async ({ page }) => {
    await openAnna(page);
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Edit Details…" }).click();
    await expect(page.getByRole("dialog", { name: "Edit details" })).toBeVisible();
    await shot(page, "person-edit-sheet");
  });
  test("Merge sheet with a person chosen shows what moves", async ({ page }) => {
    await openAnna(page);
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Merge With…" }).click();
    const sheet = page.getByRole("dialog", { name: /^Merge .* with another entry$/ });
    await sheet.locator("select").selectOption({ index: 1 });
    await expect(sheet).toContainText(/What moves to /);
    await shot(page, "person-merge-sheet");
  });
});
