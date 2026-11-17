// Screenshot spec of the Set Up Voice Profile sheet (docs/features/ui/people.md › Voice profile). Delete Profile… is a
// native alert (XCUITest), not drawn by the WebView. Baselines come from the update-screenshots workflow only.
import { expect, test } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import * as W from "../support/world-presets";

test.describe("cpt-noter-dod-ui-people-identity voice profile", () => {
  test("Set Up Voice Profile asks for the opt-in", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWindow(page, "main", { world: W.idle });
    await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
    await page.keyboard.press("Meta+Digit4");
    await expect(page.locator('[data-region="PL-R2"]')).toBeVisible();
    await page.getByRole("table", { name: "People" }).getByRole("row", { name: /Pavel/ }).click();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-region="PE"]')).toBeVisible();
    await page.getByRole("button", { name: "Set Up Voice Profile…" }).click();
    const sheet = page.getByRole("dialog", { name: "Set Up Voice Profile" });
    await expect(sheet).toContainText("stays on this Mac");
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page).toHaveScreenshot("person-voice-setup.png");
  });
});
