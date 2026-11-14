import { expect, test } from "@playwright/test";
import { openWindow } from "../e2e/support/app";

// The mapped default is already captured by Settings › Repositories; keep only states that add a distinct view.
for (const state of ["empty", "missing", "add", "edit"] as const) {
  test(`Repositories — ${state}`, async ({ page }) => {
    await openWindow(page, "settings", { world: (w) => {
      if (state === "empty" || state === "add") w.repos.mappings = [];
      if (state === "missing") w.repos.mappings[0]!.path_exists = false;
    } });
    await page.getByRole("navigation", { name: "Settings panes" }).getByRole("listitem").filter({ hasText: "Repositories" }).click();
    const pane = page.locator('[data-region="ST-R2"]');
    if (state === "add") await pane.getByRole("button", { name: "Add Mapping…" }).click();
    else if (state === "edit") {
      await pane.getByRole("row").filter({ hasText: "VSTOR" }).first().click();
      await pane.getByRole("button", { name: "Edit Mapping…" }).click();
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page.locator('[data-region="window"]')).toHaveScreenshot(`repositories-${state}.png`);
  });
}
