// M0 — Main window shell: collapse order, zoom and the app menu's shortcuts (docs/features/ui/main-window-shell.md,
// `cpt-noter-flow-ui-main-window-shell-resize`). QA Q-1 of #77: at 200 % the page reflows without horizontal scrolling.
import type { Page } from "@playwright/test";

import { openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const win = (page: Page) => page.locator('[data-component="cpt-noter-component-shell-main-window"]');
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe("cpt-noter-flow-ui-main-window-shell-resize", () => {
  test("UI — keyboard only: ⌘+ zooms to 200 % without horizontal scrolling, the sidebar collapses into an overlay, ⌘0 restores it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWindow(page, "main");
    await expect(win(page)).toHaveAttribute("data-state", /capturing|ready/);
    await expect(page.locator('[data-region="MW-R2"]')).toBeVisible();
    await expect(win(page)).toHaveAttribute("data-collapse", "none");

    for (let i = 0; i < 4; i++) await page.keyboard.press("Meta+Equal");
    await expect(win(page)).toHaveAttribute("data-collapse", "sidebar");
    await expect(page.locator('[data-region="MW-R2"]')).toHaveCount(0);
    expect(await noSideways(page)).toBe(true);
    await expect(page.getByRole("button", { name: "Show Sidebar" })).toBeVisible();

    await page.keyboard.press("Control+Meta+KeyS"); // opens the collapsed sidebar as an overlay from the leading edge
    await expect(page.locator('[data-region="MW-R2"]')).toBeVisible();
    await page.keyboard.press("Meta+Digit4"); // choosing a section closes the overlay
    await expect(page.locator('[data-region="MW-R2"]')).toHaveCount(0);

    await page.keyboard.press("Meta+Digit0");
    await expect(page.locator('[data-region="MW-R2"]')).toBeVisible();
    await expect(win(page)).toHaveAttribute("data-collapse", "none");
  });

  test("UI — a window narrower than 900 pt collapses the sidebar, Narrow content overflows the toolbar search into an icon", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 700 });
    await openWindow(page, "main");
    await expect(win(page)).toHaveAttribute("data-collapse", "sidebar");
    await expect(win(page)).toHaveAttribute("data-width", "narrow");
    await expect(page.locator('[data-region="MW-R2"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
    expect(await noSideways(page)).toBe(true);
    await page.keyboard.press("Meta+KeyF"); // ⌘F opens the collapsed search field and focuses it
    await expect(page.getByRole("searchbox")).toBeFocused();
  });

  test("UI — ⌃⌘S hides and shows the docked sidebar, Back and Forward follow ⌘[ and ⌘]", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await openWindow(page, "main");
    await expect(page.locator('[data-region="MW-R2"]')).toBeVisible();
    await page.keyboard.press("Control+Meta+KeyS");
    await expect(page.locator('[data-region="MW-R2"]')).toHaveCount(0);
    await page.keyboard.press("Control+Meta+KeyS");
    await expect(page.locator('[data-region="MW-R2"]')).toBeVisible();
    await page.keyboard.press("Meta+Digit6");
    await expect(page.locator('[data-region="MW-R2"] [aria-current="page"]')).toContainText("Activity");
    await page.keyboard.press("Meta+BracketLeft");
    await page.keyboard.press("Meta+BracketRight");
    await expect(page.locator('[data-region="MW-R2"] [aria-current="page"]')).toContainText("Activity");
    await expect(page.getByRole("button", { name: "Forward" })).toBeDisabled();
  });

  test("UI — keyboard only: the split divider resizes the sidebar from 220 pt to the 180 to 320 pt limits", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await openWindow(page, "main");
    const width = () => page.locator('[data-region="MW-R2"]').evaluate((el) => el.getBoundingClientRect().width);
    expect(await width()).toBe(220);
    await page.getByRole("separator").focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(width).toBe(230);
    await page.keyboard.press("End");
    await expect.poll(width).toBe(320);
    await page.keyboard.press("Home");
    await expect.poll(width).toBe(180);
    const bottom = await page.locator('[data-region="MW-R2"]').evaluate((el) => el.getBoundingClientRect().bottom);
    expect(bottom).toBe(820); // the window fills the viewport, the footer reaches its bottom edge
  });
});
