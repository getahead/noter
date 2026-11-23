// Screenshot spec of the Set Up Voice Profile sheet (docs/features/ui/people.md › Voice profile). Delete Profile… is a
// native alert (XCUITest), not drawn by the WebView. Baselines come from the update-screenshots workflow only.
import { expect, test } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import * as W from "../support/world-presets";
import { NOW } from "./freeze";

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

  test("Create Profile confirms on the person's page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWindow(page, "main", { world: W.idle });
    await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
    await page.keyboard.press("Meta+Digit4");
    await expect(page.locator('[data-region="PL-R2"]')).toBeVisible();
    await page.getByRole("table", { name: "People" }).getByRole("row", { name: /Pavel/ }).click();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-region="PE"]')).toBeVisible();
    await page.getByRole("button", { name: "Set Up Voice Profile…" }).click();
    // The new profile is stamped "On since <today>" from the page clock: pin it so the baseline is the same every day (#1226).
    await page.clock.setFixedTime(NOW);
    await page.getByRole("dialog", { name: "Set Up Voice Profile" }).getByRole("button", { name: "Create Profile" }).click();
    await expect(page.getByText("Voice profile created for Pavel")).toBeVisible();
    await expect(page.getByText(/On since Nov 6\b/)).toBeVisible();
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page).toHaveScreenshot("person-voice-created.png");
  });
});
