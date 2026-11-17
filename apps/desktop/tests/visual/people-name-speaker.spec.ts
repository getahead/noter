// Screenshot specs of naming an unnamed speaker from People (docs/features/ui/people.md › Name an unnamed speaker):
// the popover on an unnamed row, its new-person form, and the empty-name and taken-name errors.
// Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import * as W from "../support/world-presets";

async function openPopover(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWindow(page, "main", { world: W.idle });
  await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
  await page.keyboard.press("Meta+Digit4");
  await expect(page.locator('[data-region="PL-R3"]')).toBeVisible();
  await page.locator('[data-region="PL-R3"]').getByRole("button", { name: "Name…" }).first().click();
  const popover = page.getByRole("dialog", { name: /^Name Speaker \d/ });
  await expect(popover).toBeVisible();
  return popover;
}
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => scrollTo(0, 0));
  await expect(page).toHaveScreenshot(`${name}.png`);
};

test.describe("cpt-noter-dod-ui-people-identity naming an unnamed speaker", () => {
  test("the popover opens under the Name… button of an unnamed row", async ({ page }) => {
    await openPopover(page);
    await shot(page, "people-name-speaker");
  });
  test("a name nobody has says No one called it", async ({ page }) => {
    const popover = await openPopover(page);
    await popover.getByRole("combobox", { name: "Name…" }).fill("Zoya");
    await expect(popover).toContainText("No one called “Zoya”");
    await shot(page, "people-name-speaker-none");
  });
  test("after naming, the undo strip offers Undo", async ({ page }) => {
    const popover = await openPopover(page);
    await popover.getByRole("combobox", { name: "Name…" }).fill("Dmitri");
    await popover.getByRole("option", { name: /Dmitri Sokolov/ }).click();
    await expect(page.getByText(/Named Speaker 3 as Dmitri S\./)).toBeVisible();
    await shot(page, "people-name-speaker-undo");
  });
  test("a name nobody has opens the new-person form", async ({ page }) => {
    const popover = await openPopover(page);
    await popover.getByRole("combobox", { name: "Name…" }).fill("Zoya Petrova");
    await popover.getByRole("option", { name: /New Person/ }).click();
    await expect(page.getByRole("dialog", { name: /^New person for Speaker/ })).toBeVisible();
    await shot(page, "people-name-speaker-new");
  });
  test("an empty name in the form says Enter a name.", async ({ page }) => {
    const popover = await openPopover(page);
    await popover.getByRole("combobox", { name: "Name…" }).fill("Zoya Petrova");
    await popover.getByRole("option", { name: /New Person/ }).click();
    const form = page.getByRole("dialog", { name: /^New person for Speaker/ });
    await form.getByRole("textbox", { name: "Name" }).fill("");
    await form.getByRole("button", { name: "Create and Name" }).click();
    await expect(form.getByText("Enter a name.")).toBeVisible();
    await shot(page, "people-name-speaker-empty");
  });
  test("a name already in People offers Use … instead of a second person", async ({ page }) => {
    const popover = await openPopover(page);
    await popover.getByRole("combobox", { name: "Name…" }).fill("Anna Kuznetsova");
    await popover.getByRole("option", { name: /New Person/ }).click();
    const form = page.getByRole("dialog", { name: /^New person for Speaker/ });
    await form.getByRole("button", { name: "Create and Name" }).click();
    await expect(form.getByText(/A person called “Anna Kuznetsova” already exists: Anna Kuznetsova/)).toBeVisible();
    await shot(page, "people-name-speaker-taken");
  });
});
