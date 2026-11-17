// A menu opened by mouse inside a tabindex=-1 container (a call-page output section) hands focus back to the button that
// opened it, not to the container WebKit focused on the click (DESIGN › Focus order; cpt-noter-state-ui-accessibility-l10n-focus-return).
import * as W from "../support/world-presets";
import { openWindow } from "./support/app";
import { openSummary } from "./support/call-page";
import { expect, test } from "./support/fixtures";

test.describe("cpt-noter-seq-call-page-share-outputs — focus with the mouse", () => {
  test("happy path: Esc on a section's Share menu returns focus to that section's Share button", async ({ page }) => {
    await openWindow(page, "main", { world: (w) => W.idle(w) });
    await openSummary(page);
    const share = page.getByRole("button", { name: "Share Action items" });
    await share.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(share).toBeFocused();
  });
});
