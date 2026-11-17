// Library › Topics and a topic thread (cpt-noter-dod-ui-library-search-topics-topics): the prototype's Library states Topics,
// No topics yet, a thread and Nothing left in this topic at Wide, Medium and Narrow, rendered against the fake core.
// Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { settled } from "./freeze";

const WIDTHS = { wide: 1400, default: 1280, medium: 1000, narrow: 700 } as const;

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

    test(`row context menu`, async ({ page }) => {
      await topics(page, px);
      await page.locator(TOPIC_ROW).first().click({ button: "right" });
      await expect(page.getByRole("menuitem", { name: "Rename…" })).toBeVisible();
      await shot(page, "topics-row-menu", width);
    });

    test(`thread: Ask About This Thread is enabled in the toolbar`, async ({ page }) => {
      await topics(page, px);
      await page.locator(TOPIC_ROW).first().click();
      const ask = page.getByRole("button", { name: "Ask About This Thread" });
      await expect(ask).toBeEnabled();
      await ask.focus();
      await shot(page, "topics-thread-ask", width);
    });

    test(`thread: Tab to Ask About This Thread draws the focus ring`, async ({ page }) => {
      await topics(page, px);
      await page.locator(TOPIC_ROW).first().click();
      const ask = page.getByRole("button", { name: "Ask About This Thread" });
      await expect(ask).toBeEnabled();
      await expect(async () => {
        await page.keyboard.press("Tab");
        await expect(ask).toBeFocused({ timeout: 300 });
      }).toPass();
      await expect(ask).toHaveCSS("box-shadow", /rgba\(0, 122, 255, 0\.5\)/);
      // not `shot`: it blurs the focused element first, which would hide the ring this test is about
      await page.mouse.move(0, 0);
      await settled(page);
      await expect(page).toHaveScreenshot(`topics-thread-ask-ring-${width}.png`);
    });

    test(`nothing left`, async ({ page }) => {
      await topics(page, px, (w) => (w.items = w.items.map((i) => ({ ...i, topic: null }))));
      await page.locator(TOPIC_ROW).first().click();
      await expect(page.locator('[data-state="thread-empty"]')).toBeVisible();
      await shot(page, "topics-nothing-left", width);
    });
  });
}

// Rename, merge and keep separate (cpt-noter-dod-ui-library-search-topics-topics): the thread's ⋯ menu, the merge suggestion
// banner, the Rename and Merge sheets, the duplicate-name state and the undo strips, at Wide.
const suggest = (w: World) => {
  const [a, b] = w.topics;
  a!.merge_suggestion = { id: b!.id, name: b!.name };
};
const thread = async (page: Page) => {
  await topics(page, WIDTHS.wide, suggest);
  await page.locator(TOPIC_ROW).first().click();
  await expect(page.locator('[data-region="TH-R3"]')).toBeVisible();
};
const menu = async (page: Page, item: string) => {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
};
test.describe("cpt-noter-dod-ui-library-search-topics-topics Rename and merge at wide", () => {
  test("thread with the merge suggestion", async ({ page }) => {
    await thread(page);
    await expect(page.getByText(/Looks like the same subject as/)).toBeVisible();
    await shot(page, "topics-thread-suggestion", "wide");
  });
  test("thread ⋯ menu open", async ({ page }) => {
    await thread(page);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Merge With…" })).toBeVisible();
    await shot(page, "topics-thread-menu", "wide");
  });
  test("Rename sheet", async ({ page }) => {
    await thread(page);
    await menu(page, "Rename…");
    await expect(page.getByRole("dialog", { name: "Rename topic" })).toBeVisible();
    await shot(page, "topics-rename", "wide");
  });
  test("Rename to a name that is taken offers Merge Instead", async ({ page }) => {
    await thread(page);
    // the other topic's name is the one the merge suggestion names
    const banner = await page.getByText(/Looks like the same subject as/).textContent();
    const other = /“(.+)”/.exec(banner ?? "")?.[1] ?? "";
    expect(other).not.toBe("");
    await menu(page, "Rename…");
    const field = page.getByRole("textbox", { name: "Topic name" });
    await field.fill(other);
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(page.getByRole("button", { name: "Merge Instead" })).toBeVisible();
    await shot(page, "topics-rename-taken", "wide");
  });
  test("Rename done with its undo strip", async ({ page }) => {
    await thread(page);
    await menu(page, "Rename…");
    await page.getByRole("textbox", { name: "Topic name" }).fill("Drawer redesign, renamed");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(page.getByText(/Renamed “.+” to “.+”/)).toBeVisible();
    await shot(page, "topics-renamed-undo", "wide");
  });
  test("Merge sheet", async ({ page }) => {
    await thread(page);
    await menu(page, "Merge With…");
    await expect(page.getByRole("dialog", { name: /^Merge “.+” into “.+”\?$/ })).toBeVisible();
    await shot(page, "topics-merge", "wide");
  });
  test("Merge done with its undo strip", async ({ page }) => {
    await thread(page);
    await page.getByRole("button", { name: "Merge", exact: true }).click();
    await page.getByRole("button", { name: "Merge", exact: true }).last().click();
    await expect(page.getByText(/Merged \d+ items? into/)).toBeVisible();
    await shot(page, "topics-merged-undo", "wide");
  });
});
