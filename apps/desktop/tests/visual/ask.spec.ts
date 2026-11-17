// Ask (cpt-noter-dod-ui-ask-threads): the first-question screen and an answered thread at Wide, Medium and Narrow,
// rendered against the fake core. Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import * as W from "../support/world-presets";
import { settled } from "./freeze";

const WIDTHS = { wide: 1400, medium: 1000, narrow: 700 } as const;

async function ask(page: Page, width: number, plan: Parameters<typeof openWindow>[2] = {}) {
  await page.setViewportSize({ width, height: 800 });
  await openWindow(page, "main", { world: (w) => (W.idle(w), (w.app.setup.self_test = { type: "passed", at: 1 })), ...plan });
  // a key pressed before the window's shortcuts are bound is lost, so press until the page is Ask
  await expect(async () => {
    await page.keyboard.press("Meta+Digit2");
    await expect(page.getByRole("heading", { name: "Ask", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
}
const shot = async (page: Page, name: string, width: string) => {
  await page.mouse.move(0, 0);
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await settled(page);
  await expect(page).toHaveScreenshot(`${name}-${width}.png`);
};

for (const [width, px] of Object.entries(WIDTHS)) {
  test.describe(`cpt-noter-dod-ui-ask-threads Ask at ${width}`, () => {
    test("first question", async ({ page }) => {
      await ask(page, px);
      await expect(page.getByText("Ask anything about your calls and documents")).toBeVisible();
      await shot(page, "first", width);
    });

    test("answered thread", async ({ page }) => {
      await ask(page, px);
      await page.locator('[data-region="AK-R4"]').getByRole("textbox").fill("What did we decide about the backend?");
      await page.keyboard.press("Enter");
      // done = the core stored the turn: the recent list gains its row beside the seeded thread, and Stop is gone
      await expect(page.locator(".ak-recent__item")).toHaveCount(2);
      await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeVisible();
      await expect(page.getByText("Answering…")).toHaveCount(0);
      await shot(page, "answered", width);
    });
  });
}

test.describe("cpt-noter-dod-ui-ask-citations Ask states at wide", () => {
  const QUESTION = "What did we decide about the backend?";
  const askAndWait = async (page: Page) => {
    await page.locator('[data-region="AK-R4"]').getByRole("textbox").fill(QUESTION);
    await page.keyboard.press("Enter");
    await expect(page.locator(".ak-recent__item")).toHaveCount(2); // the core stored the turn beside the seeded thread
    await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeVisible();
  };

  test("a citation playing: the playback bar under the thread", async ({ page }) => {
    await ask(page, WIDTHS.wide);
    await askAndWait(page);
    await page.locator('[data-component="cpt-noter-component-ui-citation-row"]').getByRole("button", { name: /^Play/ }).first().click();
    await expect(page.locator('[data-component="cpt-noter-component-ui-playback-bar"]')).toBeVisible();
    await shot(page, "playing", "wide");
  });

  test("the recent-row menu: Copy Question and Delete", async ({ page }) => {
    await ask(page, WIDTHS.wide);
    await page.locator(".ak-recent__item").first().click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    await shot(page, "row-menu", "wide");
  });

  test("the runtime cannot be reached: the error banner with Try Again and Answer with Local Model", async ({ page }) => {
    await ask(page, WIDTHS.wide, { fail: [{ cmd: "ask_start", code: "runtime_unavailable" }] });
    await page.locator('[data-region="AK-R4"]').getByRole("textbox").fill(QUESTION);
    await page.keyboard.press("Enter");
    const banner = page.locator('[data-component="cpt-noter-component-ui-inline-banner"]');
    await expect(banner).toContainText("Couldn't reach Claude Code");
    await shot(page, "error-banner", "wide");
  });
});

test.describe("cpt-noter-dod-ui-ask-threads Ask scope and stream states at wide", () => {
  test("the started line: the runtime and mode above the answering turn", async ({ page }) => {
    await page.clock.install();
    await page.clock.resume();
    await ask(page, WIDTHS.wide);
    // stop the page's clock, then advance it by hand: the fake core's started event and the bridge's buffered render are timers
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500);
    await page.locator('[data-region="AK-R4"]').getByRole("textbox").fill("What did we decide about the backend?");
    await page.keyboard.press("Enter");
    const status = page.locator(".ak-turn .ak-status");
    // started is due at 200 ms and the bridge renders it 100 ms later; the first word is due at 400 ms. Each clock step is a
    // round trip (about a second on CI), so cover the first 250 ms in one and then go by condition, in small steps
    await page.clock.runFor(250);
    await expect(async () => {
      await page.clock.runFor(20);
      await expect(status.first()).toContainText("·", { timeout: 200 });
    }).toPass({ timeout: 20000 });
    await expect(page.locator(".ak-turn").last().getByText("Answering…")).toBeVisible(); // still no word of the answer: the first delta is later than started
    await shot(page, "started-line", "wide");
  });

  test("a topic route: the Topic: <name> option in the scope pop-up", async ({ page }) => {
    await ask(page, WIDTHS.wide, { world: (w) => (W.idle(w), (w.app.setup.self_test = { type: "passed", at: 1 }), void (w.topics[0].id = "tp_vis")) });
    await page.evaluate(async () => {
      const module = "/src/features/shell/navigate.ts"; // served by the dev server: the app's own module instance
      const { navigate } = (await import(/* @vite-ignore */ module)) as { navigate: (route: { section: string; key: string }) => void };
      navigate({ section: "ask", key: "new-topic:tp_vis" });
    });
    await expect(page.locator(".ak-recent__item")).toHaveCount(2); // asked and stored
    const scope = page.locator('[data-region="AK-R1"]').getByRole("combobox", { name: /scope/i });
    await expect(scope.locator("option", { hasText: /^Topic: / })).toHaveCount(1);
    await expect(scope).toContainText("Topic: "); // the arrival selects it
    await shot(page, "topic-scope", "wide");
  });

  test("Narrow: the » menu holds New Question and the scope choices", async ({ page }) => {
    await ask(page, WIDTHS.narrow);
    await page.locator("#mw-overflow").click();
    await expect(page.getByRole("menuitem", { name: /^Scope: / }).first()).toBeVisible();
    await shot(page, "overflow-menu", "narrow");
  });
});
