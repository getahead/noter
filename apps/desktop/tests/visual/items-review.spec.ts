// Screenshot specs of the item review banner (docs/features/ui/items.md › Definitions of Done): the call page's PC-R2
// banner above ready output sections, with suggested items waiting or all items reviewed, against the fake world. Baselines come
// from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { coreReady, openWindow } from "../e2e/support/app";
import { outputsOf, sectionOf, threeSuggested, written } from "../e2e/support/outputs-world";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { freeze } from "./freeze";

type Fake = { invoke: (cmd: string, args: unknown) => Promise<unknown> };
const quiet = (more: (w: World) => void = () => {}) => (w: World) => {
  W.idle(w);
  w.app.setup.self_test = { type: "passed", at: 1 };
  more(w);
};

async function open(page: Page, world: (w: World) => void) {
  await openWindow(page, "main", { world });
  await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
  await coreReady(page);
  await page.evaluate((id) => (globalThis as unknown as { __noterFake: Fake }).__noterFake.invoke("window_navigate", { target: { type: "call_page", call_id: id, tab: "summary" } }), W.PAST_CALL);
  await expect(page.locator('[data-region="PC-R1"]')).toContainText("Backend sync");
  await expect(page.locator('[data-region="PC-R3"]')).toContainText("Drawer events will ship behind a flag.");
  await expect(page.locator('[data-region="PC-R3"]')).toContainText("Write the flag rollout note");
}
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await expect(page).toHaveScreenshot(`${name}.png`);
};

test.beforeEach(({ page }) => freeze(page));
test.describe("cpt-noter-dod-ui-items-actions review banner", () => {
  test("ready: 3 suggested items to review before sharing", async ({ page }) => {
    await open(page, quiet(threeSuggested));
    await expect(page.locator('[data-region="PC-R2"]')).toContainText("3 suggested items to review before sharing");
    await shot(page, "items-review-banner");
  });

  test("empty: nothing to review, no banner", async ({ page }) => {
    await open(page, quiet(written));
    await expect(page.getByText(/suggested items? to review/)).toHaveCount(0);
    await shot(page, "items-review-none");
  });

  test("action rows: suggested, overdue, carried, handed-off and closed states", async ({ page }) => {
    await open(page, quiet((w) => {
      written(w);
      const rows = sectionOf(w, "action_items").items;
      Object.assign(rows[0]!, { review: "suggested", due: "2026-10-30" });
      Object.assign(rows[1]!, { status: "done", due: "2026-10-30", done_at: Date.UTC(2026, 10, 6) });
      Object.assign(rows[2]!, { status: "carried", carried_from: { id: W.PAST_CALL, title: "Planning", started_at: 1, call_type: "cross_team" } });
      Object.assign(rows[3]!, { status: "handed_off", is_engineering: true, review: "accepted" });
      rows.push({ ...structuredClone(rows[1]!), id: "itm_visual_closed", status: "closed_by_evidence", closed_by: { summary: "VSTOR-42 merged" } as never, text: "Closed by linked evidence" });
      rows.push({ ...structuredClone(rows[1]!), id: "itm_visual_answered", status: "answered_in_call", text: "Answered in the call" });
      outputsOf(w).review_waiting = 1;
    }));
    await expect(page.locator('[data-region="PC-R3"]').locator('[data-component="cpt-noter-component-ui-action-item-row"]')).toHaveCount(6);
    await expect(page.locator('[data-region="PC-R3"]')).toContainText("Carried from Planning");
    await expect(page.locator('[data-region="PC-R3"]')).toContainText("Closed: VSTOR-42 merged");
    await expect(page.locator('[data-region="PC-R3"]')).toContainText("Answered in the call");
    await shot(page, "items-action-row-states");
  });

  test("action row: handed-off completion asks before closing", async ({ page }) => {
    await open(page, quiet((w) => {
      written(w);
      const row = sectionOf(w, "action_items").items[0]!;
      Object.assign(row, { status: "handed_off", is_engineering: true, review: "accepted" });
    }));
    const row = page.locator('[data-component="cpt-noter-component-ui-action-item-row"]').first();
    await row.getByRole("checkbox").press("Space");
    await expect(row.getByRole("group", { name: "Did the handoff land?" })).toBeVisible();
    await shot(page, "items-action-handoff-question");
  });
});
