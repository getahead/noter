// M0 — Main window shell › app banners (docs/features/ui/main-window-shell.md, flow app-state): a dismissible banner in MW-R5
// is closed with `banner_dismiss`, and the core's set no longer carries it.
import { calls, openWindow } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";


test.describe("cpt-noter-flow-ui-main-window-shell-app-state", () => {
  test("UI — happy path: a dismissible banner closes with banner_dismiss and stays closed", async ({ page }) => {
    await openWindow(page, "main", { world: (w) => void (w.app.banners.banners = [{ type: "roll_up_failed", at: 1_700_000_000_000 }]) });
    const banner = page.locator('[data-region="MW-R5"]').filter({ hasText: "The performance roll-up did not finish" });
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Dismiss" }).click();
    await expect(banner).toHaveCount(0);
    expect(await sent(page, "banner_dismiss")).toEqual([{ banner: "roll_up_failed" }]);
  });
});
