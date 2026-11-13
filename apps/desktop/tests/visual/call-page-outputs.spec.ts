// Screenshot specs of the call page's sharing surfaces (docs/features/ui/call-page-outputs.md › Definitions of Done):
// the Share menu, the Export sheet, Call info with tags and audio, and the Delete Old Audio sheet, against the fake
// world. Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { fakeReady } from "./hold";

type Fake = { invoke: (cmd: string, args: unknown) => Promise<unknown> };
const quiet = (w: World) => {
  W.idle(w);
  w.app.setup.self_test = { type: "passed", at: 1 };
  w.calls.find((c) => c.id === W.PAST_CALL)!.tags = ["release", "backend"];
};
const nav = (page: Page, target: unknown) => page.evaluate((t) => (globalThis as unknown as { __noterFake: Fake }).__noterFake.invoke("window_navigate", { target: t }), target);

async function open(page: Page) {
  await openWindow(page, "main", { world: quiet });
  await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
  await fakeReady(page);
  await nav(page, { type: "call_page", call_id: W.PAST_CALL, tab: "summary" });
  await expect(page.getByRole("tab", { name: "Summary", selected: true })).toBeVisible();
}
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await expect(page).toHaveScreenshot(`${name}.png`);
};

test.describe("cpt-noter-dod-ui-call-page-outputs-actions sharing surfaces", () => {
  test("share menu open on Whole call", async ({ page }) => {
    await open(page);
    await page.locator('[data-region="PC-R1"]').getByRole("button", { name: /^Share/ }).click();
    await expect(page.getByRole("menu")).toContainText("Whole call");
    await shot(page, "call-page-share-menu");
  });

  test("export sheet with Audio while it is kept", async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-region="PC-R1"]').getByRole("button", { name: /^Share/ })).toBeVisible();
    await expect(page.locator('[data-region="PC-R3"]')).toBeVisible();
    await page.keyboard.press("Meta+KeyE");
    await expect(page.getByRole("dialog", { name: /Export/ })).toContainText("Scope: Whole call");
    await shot(page, "call-page-export-sheet");
  });

  test("call info with tags and Delete Audio Now…", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("button", { name: "Remove release" })).toBeVisible();
    await shot(page, "call-page-call-info-tags");
  });

  test("delete old audio sheet", async ({ page }) => {
    await open(page);
    await nav(page, { type: "delete_old_audio" });
    await expect(page.getByRole("dialog", { name: /Delete Old Audio/ })).toBeVisible();
    await shot(page, "call-page-delete-old-audio");
  });
});
