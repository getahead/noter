// Library › Calls (cpt-noter-dod-ui-library-calls-table): the prototype's Library states Normal, Calls · No calls yet,
// Calls · Several calls selected, Calls · Status cells and Loading at Wide, Medium and Narrow, rendered against the fake core.
// Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";

const WIDTHS = { wide: 1280, medium: 1100, narrow: 820 } as const;
const ROW = '[data-component="cpt-noter-component-ui-call-row"][data-variant="table-row"]';
const rowOf = (page: Page, title: string) => page.locator(ROW).filter({ hasText: title });

async function calls(page: Page, width: number, world: (w: World) => void, latency = 0) {
  await page.setViewportSize({ width, height: 800 });
  await openWindow(page, "main", { latency, world: (w) => (W.idle(w), (w.app.setup.self_test = { type: "passed", at: 1 }), world(w)) });
  // a key pressed before the window's shortcuts are bound is lost, so press until the page is Calls
  await expect(async () => {
    await page.keyboard.press("Meta+Digit3");
    await expect(page.getByRole("heading", { name: "Calls", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
}
const shot = async (page: Page, name: string, width: string) => {
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await expect(page).toHaveScreenshot(`${name}-${width}.png`);
};

for (const [width, px] of Object.entries(WIDTHS)) {
  test.describe(`cpt-noter-dod-ui-library-calls-table Calls at ${width}`, () => {
    test(`default`, async ({ page }) => {
      await calls(page, px, (w) => W.morePastCalls(w, 3));
      await expect(page.locator(ROW)).toHaveCount(5);
      await shot(page, "default", width);
    });

    test(`empty`, async ({ page }) => {
      await calls(page, px, (w) => ((w.calls = []), (w.call_details = [])));
      await expect(page.locator('[data-component="cpt-noter-component-ui-empty-state"]')).toContainText("No calls yet");
      await shot(page, "empty", width);
    });

    test(`selected`, async ({ page }) => {
      await calls(page, px, (w) => W.morePastCalls(w, 3));
      await rowOf(page, "Backend sync").first().click();
      await rowOf(page, "Backend sync #3").click({ modifiers: ["Meta"] });
      await rowOf(page, "Backend sync #4").click({ modifiers: ["Meta"] });
      await expect(page.locator(`${ROW}[aria-selected="true"]`)).toHaveCount(3);
      await shot(page, "selected", width);
    });

    test(`statuses`, async ({ page }) => {
      await calls(page, px, (w) => {
        W.morePastCalls(w, 3);
        const [a, b, c, d] = w.calls.filter((x) => x.id.startsWith(W.PAST_CALL));
        Object.assign(a, { outputs: "failed", archive: "pending" });
        Object.assign(b, { outputs: "writing" });
        Object.assign(c, { outputs: "ready", archive: "pending", privacy: "sensitive" });
        Object.assign(d, { outputs: "ready", unnamed_speakers: 0, archive: "pending", audio_deleted: true });
      });
      await expect(rowOf(page, "Backend sync #2")).toContainText("Writing summary…");
      await shot(page, "statuses", width);
    });

    test(`loading`, async ({ page }) => {
      await page.setViewportSize({ width: px, height: 800 });
      await openWindow(page, "main", { world: (w) => (W.idle(w), (w.app.setup.self_test = { type: "passed", at: 1 })) });
      await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
      // only the Calls read is slow, so the rest of the window is as in the other states
      await page.waitForFunction(() => (globalThis as unknown as { __noterFake?: unknown }).__noterFake);
      await page.evaluate(() => ((globalThis as unknown as { __noterFake: { latency: number } }).__noterFake.latency = 8000));
      await expect(async () => {
        await page.keyboard.press("Meta+Digit3");
        await expect(page.getByRole("heading", { name: "Calls", level: 1 })).toBeVisible({ timeout: 1000 });
      }).toPass();
      await expect(page.locator('[data-region="LC-R3"] [aria-busy="true"], [data-region="LC-R3"] [data-state="loading"]').first()).toBeVisible({ timeout: 3000 });
      await shot(page, "loading", width);
    });
  });
}
