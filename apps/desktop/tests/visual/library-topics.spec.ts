// Library › Topics and a topic thread (cpt-noter-dod-ui-library-search-topics-topics): the prototype's Library states Topics,
// No topics yet, a thread and Nothing left in this topic at Wide, Medium and Narrow, rendered against the fake core.
// Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { settled } from "./freeze";

const WIDTHS = { wide: 1400, medium: 1000, narrow: 700 } as const;

async function topics(page: Page, width: number, world: (w: World) => void = () => {}) {
  await page.setViewportSize({ width, height: 800 });
  await openWindow(page, "main", { world: (w) => (W.idle(w), (w.app.setup.self_test = { type: "passed", at: 1 }), world(w)) });
  // a key pressed before the window's shortcuts are bound is lost, so press until the page is Topics
  await expect(async () => {
    await page.keyboard.press("Meta+Digit5");
    await expect(page.getByRole("heading", { name: "Topics", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
}
const shot = async (page: Page, name: string, width: string) => {
  await page.mouse.move(0, 0);
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await settled(page);
  await expect(page).toHaveScreenshot(`${name}-${width}.png`);
};
const TOPIC_ROW = '[data-lib-topic]';

for (const [width, px] of Object.entries(WIDTHS)) {
  test.describe(`cpt-noter-dod-ui-library-search-topics-topics Topics at ${width}`, () => {
    test(`list`, async ({ page }) => {
      await topics(page, px);
      await expect(page.locator(TOPIC_ROW).first()).toBeVisible();
      await shot(page, "topics-list", width);
    });

    test(`no topics`, async ({ page }) => {
      await topics(page, px, (w) => (w.topics = []));
      await expect(page.locator('[data-component="cpt-noter-component-ui-empty-state"]')).toContainText("No topics yet");
      await shot(page, "topics-empty", width);
    });

    test(`no match`, async ({ page }) => {
      await topics(page, px);
      await page.getByPlaceholder("Search topics").fill("zzzz");
      await expect(page.locator('[data-component="cpt-noter-component-ui-empty-state"]')).toContainText("No topics match");
      await shot(page, "topics-no-match", width);
    });

    test(`thread`, async ({ page }) => {
      await topics(page, px);
      await page.locator(TOPIC_ROW).first().click();
      await expect(page.locator('[data-region="TH-R3"]')).toBeVisible();
      await shot(page, "topics-thread", width);
    });

    test(`nothing left`, async ({ page }) => {
      await topics(page, px, (w) => (w.items = w.items.map((i) => ({ ...i, topic: null }))));
      await page.locator(TOPIC_ROW).first().click();
      await expect(page.locator('[data-state="thread-empty"]')).toBeVisible();
      await shot(page, "topics-nothing-left", width);
    });
  });
}
