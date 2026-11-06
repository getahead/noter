// M2 — Items review (docs/features/ui/items.md, DESIGN.md › Screen — Call page PC-R2). Story:
// `cpt-noter-seq-call-page-review-suggested-items`. Commands: items_list, items_review_all, change_undo.
// This file keeps what runs green on both cores today: the review banner and Accept All. The paths that need the
// Summary view's rows (Start Review focus, A/E/R, Rejected · Undo, regenerate, inspector) stay on lane/ui/e2e-m2-1
// until 2.18's sections land; the fake does not log a batch change for `items_review_all`, so its batch Undo is
// proved on the real core only. The fixture's "Planning: VHI 8.0 drawer redesign" (call_live, idle) has 3 suggested items.
import type { Locator, Page } from "@playwright/test";

import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const FAKE = process.env.NOTER_CORE !== "stdio";
const STRIP = '[data-component="cpt-noter-component-ui-undo-strip"]';
const banner = (page: Page) => page.locator('[data-region="PC-R2"]');
const strip = (page: Page) => page.locator(STRIP);
const button = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name });
const sent = async (page: Page, name: string): Promise<Array<Record<string, unknown>>> =>
  (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args as Record<string, unknown>);

const quiet = (more: (w: World) => void = () => {}) => (w: World) => (W.idle(w), more(w));
const allAccepted = (w: World) => w.items.forEach((i) => (i.review = "accepted"));

/** Library › Calls (⌘3), then the call's page the way the core opens it (`window_navigate` → `nav:request`). */
async function openCall(page: Page, world: (w: World) => void) {
  const steer = await openWindow(page, "main", { world });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit3");
    await expect(page.getByRole("heading", { name: "Calls", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.waitForFunction(() => "__noterFake" in globalThis || "__TAURI_INTERNALS__" in globalThis);
  await page.evaluate(
    async ([id]) => {
      const args = { target: { type: "call_page", call_id: id, tab: "summary" } };
      const g = globalThis as unknown as { __noterFake?: { invoke(c: string, a: unknown): Promise<unknown> }; __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> } };
      await (g.__noterFake ? g.__noterFake.invoke("window_navigate", args) : g.__TAURI_INTERNALS__!.invoke("window_navigate", { args }));
    },
    [W.LIVE_CALL],
  );
  await expect(page.locator('[data-region="PC-R1"]')).toContainText(W.LIVE_TITLE);
  return steer;
}

test.describe("cpt-noter-seq-call-page-review-suggested-items", () => {
  test("UI — happy path: the banner counts the suggested items and offers Start Review and Accept All", async ({ page }) => {
    await openCall(page, quiet());
    await expect(banner(page)).toContainText("3 suggested items to review before sharing");
    await expect(button(banner(page), "Start Review")).toBeVisible();
    await expect(button(banner(page), "Accept All")).toBeVisible();
    expect((await sent(page, "items_list")).length).toBeGreaterThan(0);
  });

  test("UI — empty path — Nothing to review: no banner, no Accept All", async ({ page }) => {
    await openCall(page, quiet(allAccepted));
    await expect.poll(async () => (await sent(page, "items_list")).length).toBeGreaterThan(0); // the page has loaded its items
    await expect(page.getByText(/suggested items? to review/)).toHaveCount(0);
    await expect(button(page, "Accept All")).toHaveCount(0);
  });

  test("UI — Other — Accept everything at once: Accept All sends every kind and shows Accepted … · Undo; Undo reverses the batch", async ({ page }) => {
    await openCall(page, quiet());
    await button(banner(page), "Accept All").click();
    expect(await sent(page, "items_review_all")).toEqual([{ call_id: W.LIVE_CALL, kinds: [] }]);
    await expect(strip(page)).toContainText("Accepted 3 suggested items");
    await expect(banner(page).getByText(/suggested items to review/)).toHaveCount(0);
    await expect(button(strip(page), "Undo")).toBeVisible();
    if (FAKE) return; // the fake logs no change for a batch accept: Undo is real-core only
    await button(strip(page), "Undo").click();
    expect(await sent(page, "change_undo")).toEqual([{ target: { type: "batch", batch_id: expect.any(String) } }]); // one batch, one undo
    await expect(banner(page)).toContainText("3 suggested items to review before sharing");
  });
});
