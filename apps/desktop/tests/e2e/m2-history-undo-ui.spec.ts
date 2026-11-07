// M2 — History (docs/features/ui/history-undo.md). Stories: `cpt-noter-seq-call-page-review-outputs` (No changes yet,
// Export the call's change log) and `cpt-noter-seq-call-page-check-evidence` (Item History). Commands: history_list,
// history_export, item_review. Runs on the fake and the real core; the partial strip is a fake-world visual (the UI cannot
// seed an edited-later batch in the real core).
import type { Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import * as O from "./support/outputs-world";
import { expect, test } from "./support/fixtures";

const TIMELINE = '[data-component="cpt-noter-component-ui-history-timeline"]';
const INSPECTOR = '[data-component="cpt-noter-component-ui-item-inspector"]';
const CHANGE = '[data-component="cpt-noter-component-ui-change-row"]';
const ROW = '[data-component="cpt-noter-component-ui-action-item-row"], [data-component="cpt-noter-component-ui-output-item-row"]';
const toolbar = (page: Page) => page.locator('[data-region="PC-R1"]');

/** The written outputs with a suggested decision, then Backend sync the way the core opens it (`window_navigate`) on `tab`. */
async function openCall(page: Page, tab: "summary" | "history") {
  await openWindow(page, "main", {
    world: (w) => {
      O.written(w);
      for (const i of O.outputsOf(w).sections.flatMap((s) => s.items)) if (i.id === "itm_d1") Object.assign(i, { review: "suggested", created_by: "llm" });
      O.outputsOf(w).review_waiting = 1;
    },
  });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit3");
    await expect(page.getByRole("heading", { name: "Calls", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await navigate(page, tab);
  await expect(toolbar(page)).toContainText(O.TITLE);
}
async function navigate(page: Page, tab: "summary" | "history") {
  await page.waitForFunction(() => "__noterFake" in globalThis || "__TAURI_INTERNALS__" in globalThis);
  await page.evaluate(
    async ([id, view]) => {
      const args = { target: { type: "call_page", call_id: id, tab: view } };
      const g = globalThis as unknown as { __noterFake?: { invoke(c: string, a: unknown): Promise<unknown> }; __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> } };
      await (g.__noterFake ? g.__noterFake.invoke("window_navigate", args) : g.__TAURI_INTERNALS__!.invoke("window_navigate", { args }));
    },
    [W.PAST_CALL, tab],
  );
}

test.describe("cpt-noter-seq-call-page-review-outputs", () => {
  test("UI — empty path — No changes yet: a call nobody changed shows the empty History", async ({ page }) => {
    await openCall(page, "history");
    await expect(page.locator(TIMELINE)).toBeVisible();
    await expect(page.getByText("No changes yet")).toBeVisible();
    expect((await calls(page)).filter((c) => c.kind === "invoke" && c.name === "history_list").length).toBeGreaterThan(0);
  });

  test("UI — Other — Export the call's change log: Export Log sends the call scope and reports where it went", async ({ page }) => {
    await openCall(page, "history");
    await page.getByRole("button", { name: "Export Log…" }).click();
    const sheet = page.getByRole("dialog", { name: /Export Log/ });
    await expect(sheet).toContainText("Whole call");
    await sheet.getByRole("button", { name: "Export…" }).click();
    const sent = (await calls(page)).filter((c) => c.kind === "invoke" && c.name === "history_export").map((c) => c.args as Record<string, unknown>);
    expect(sent).toEqual([expect.objectContaining({ scope: { type: "call", call_id: W.PAST_CALL }, format: "markdown" })]);
    await expect(page.getByText(/Exported log to /)).toBeVisible();
  });
});

test.describe("cpt-noter-seq-call-page-check-evidence", () => {
  test("UI — Other — Item History: an accepted decision lists its change in the inspector's History, with no export control", async ({ page }) => {
    await openCall(page, "summary");
    await page.locator(ROW).filter({ hasText: "Ship drawer events behind a flag" }).getByRole("button", { name: "Edit" }).click();
    const inspector = page.locator(INSPECTOR);
    await inspector.getByRole("button", { name: "Accept" }).click();
    await inspector.getByRole("tab", { name: "History" }).click();
    await expect(inspector.locator(CHANGE).first()).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Export Log…" })).toHaveCount(0);
  });
});
