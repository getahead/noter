// Exploratory-testing regressions for Settings › Hotkeys (#1104, #1143), against the selected core.
// #1104: while a shortcut field records, the app's global hotkeys are paused (hotkeys_pause), so a pressed
// app chord reaches the field instead of running its action. #1143: pausing must not replace the pane's
// hotkey list (the pane went blank on the first click into a field).
import type { Page } from "@playwright/test";

import { openWindow } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";

const panes = (page: Page) => page.getByRole("navigation", { name: "Settings panes" });
const pane = (page: Page) => page.locator('[data-region="ST-R2"]');
const field = (page: Page, row: string) => pane(page).getByRole("button", { name: new RegExp(`^${row}: `) });

test.describe("cpt-noter-seq-settings-set-hotkeys", () => {
  test("UI — recording a shortcut pauses the app's hotkeys and the pane keeps its rows (#1104, #1143)", async ({ page }) => {
    await openWindow(page, "settings");
    await panes(page).getByRole("option").filter({ hasText: "Hotkeys" }).click();
    await expect(pane(page).getByRole("heading", { name: "Hotkeys", exact: true })).toBeVisible();

    await field(page, "Pause or resume").click();
    await expect(field(page, "Pause or resume")).toContainText("Type a shortcut…");
    // the pane still renders every row: the pause answered an Ack and left the list alone
    await expect(field(page, "Catch me up")).toBeVisible();
    await expect.poll(async () => (await sent(page, "hotkeys_pause")).map((a) => a.paused)).toEqual([true]);

    await page.keyboard.press("Escape");
    await expect(field(page, "Pause or resume")).not.toContainText("Type a shortcut…");
    await expect.poll(async () => (await sent(page, "hotkeys_pause")).map((a) => a.paused)).toEqual([true, false]);
    await expect(field(page, "Catch me up")).toBeVisible();
  });
});
