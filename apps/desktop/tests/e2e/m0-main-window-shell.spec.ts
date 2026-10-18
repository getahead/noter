// M0 — Main window shell (docs/features/ui/main-window-shell.md, DESIGN.md › Shell — Main window, MW-R1..R5).
// The shell has no story of its own; it shows the app banner of `cpt-noter-seq-first-run-complete-setup`
// (Empty — Self-test skipped) and carries the keyboard-only pass across sections that
// accessibility-l10n asks of every screen. Written before the shell exists (tests first): they fail
// until the main-window-shell feature lands, and its PR carries them. Markup follows the prototype
// (05-shell.js): the sidebar is MW-R2 with `aria-current="page"` on the selected section, the banner
// slot is MW-R5, the page is MW-R3.
import type { Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const BANNER = "Call detection is off until the audio self-test passes";
const sidebar = (page: Page) => page.locator('[data-region="MW-R2"]');
const section = (page: Page, label: string) => sidebar(page).getByRole("listitem").filter({ hasText: label });
const content = (page: Page) => page.locator('[data-region="MW-R3"]');

test.describe("cpt-noter-seq-first-run-complete-setup", () => {
  test("UI — empty path: Self-test skipped — the app banner with Run Audio Self-Test… and Finish Setup…, gone once the test passes", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: (w) => (W.idle(w), W.selfTestSkipped(w)) });

    const banner = page.locator('[data-region="MW-R5"], [data-region="TD-R2"]').filter({ hasText: BANNER });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button", { name: "Run Audio Self-Test…" })).toBeVisible();
    await expect(banner.getByRole("link", { name: "Finish Setup…" }).or(banner.getByRole("button", { name: "Finish Setup…" }))).toBeVisible();

    // The self-test passes (from the sheet or Settings): the core switches detection on and the banner goes.
    await steer.change((w) => {
      w.app.setup.self_test = { type: "passed", at: Date.now() };
      w.app.setup.detection_enabled = true;
    });
    await expect(page.getByText(BANNER)).toHaveCount(0);
  });
});

test.describe("cpt-noter-flow-ui-main-window-shell-navigate", () => {
  test("UI — keyboard only: ⌘3 opens Calls with focus on its heading, ⌘[ goes back, Back is disabled at the start", async ({ page }) => {
    await openWindow(page, "main");
    await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
    await expect(page.getByRole("button", { name: "Back" })).toBeDisabled();
    const start = await sidebar(page).locator('[aria-current="page"]').innerText();

    await page.keyboard.press("Meta+Digit3");
    await expect(section(page, "Calls")).toHaveAttribute("aria-current", "page");
    await expect(content(page).getByRole("heading").first()).toBeFocused();
    await expect(content(page)).toContainText("Calls"); // a section not shipped yet shows an empty state naming it, never a blank area

    await page.keyboard.press("Meta+BracketLeft");
    await expect(sidebar(page).locator('[aria-current="page"]')).toHaveText(start);
    await expect(page.getByRole("button", { name: "Forward" })).toBeEnabled();
  });

  test("UI — keyboard only: Tab moves through the sidebar, toolbar and page without a trap", async ({ page }) => {
    await openWindow(page, "main");
    await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      seen.add(await page.evaluate(() => document.activeElement?.closest("[data-region]")?.getAttribute("data-region") ?? ""));
    }
    expect([...seen]).toEqual(expect.arrayContaining(["MW-R2", "MW-R3"]));
  });
});
