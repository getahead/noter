// Screenshot specs of the item review banner (docs/features/ui/items.md › Definitions of Done): the call page's PC-R2
// banner with suggested items waiting, rendered against the fake world. The row states (suggested, accepted, rejected,
// editing, done, handed off) render inside the Summary view's sections and join this file with 2.18. Baselines come
// from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";

type Fake = { invoke: (cmd: string, args: unknown) => Promise<unknown> };
const quiet = (more: (w: World) => void = () => {}) => (w: World) => {
  W.idle(w);
  w.app.setup.self_test = { type: "passed", at: 1 };
  more(w);
};

async function open(page: Page, world: (w: World) => void) {
  await openWindow(page, "main", { world });
  await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
  await page.waitForFunction(() => (globalThis as unknown as { __noterFake?: Fake }).__noterFake);
  await page.evaluate((id) => (globalThis as unknown as { __noterFake: Fake }).__noterFake.invoke("window_navigate", { target: { type: "call_page", call_id: id, tab: "summary" } }), W.LIVE_CALL);
  await expect(page.locator('[data-region="PC-R1"]')).toContainText(W.LIVE_TITLE);
}
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await expect(page).toHaveScreenshot(`${name}.png`);
};

test.describe("cpt-noter-dod-ui-items-actions review banner", () => {
  test("ready: 3 suggested items to review before sharing", async ({ page }) => {
    await open(page, quiet());
    await expect(page.locator('[data-region="PC-R2"]')).toContainText("3 suggested items to review before sharing");
    await shot(page, "items-review-banner");
  });

  test("empty: nothing to review, no banner", async ({ page }) => {
    await open(page, quiet((w) => w.items.forEach((i) => (i.review = "accepted"))));
    await expect(page.getByText(/suggested items? to review/)).toHaveCount(0);
    await shot(page, "items-review-none");
  });
});
