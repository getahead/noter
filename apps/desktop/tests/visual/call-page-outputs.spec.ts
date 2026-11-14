// Screenshot specs of the call page's sharing surfaces (docs/features/ui/call-page-outputs.md › Definitions of Done):
// the Share menu, the Export sheet, Call info with tags and audio, and the Delete Old Audio sheet, against the fake
// world. Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { coreReady, openWindow } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { actionItemsFailed, outputsOf, sectionOf, writing, writingLocally, written } from "../e2e/support/outputs-world";
import { freeze } from "./freeze";

type Fake = { invoke: (cmd: string, args: unknown) => Promise<unknown> };
const quiet = (w: World) => {
  W.idle(w);
  w.app.setup.self_test = { type: "passed", at: 1 };
  w.calls.find((c) => c.id === W.PAST_CALL)!.tags = ["release", "backend"];
};
const nav = (page: Page, target: unknown) => page.evaluate((t) => (globalThis as unknown as { __noterFake: Fake }).__noterFake.invoke("window_navigate", { target: t }), target);
const share = (page: Page) => page.locator('[data-region="PC-R1"]').getByRole("button", { name: /^Share/ });
const outputBody = (page: Page) => page.locator('[data-region="PC-R3"]');

async function shortcutsReady(page: Page) {
  await expect(share(page)).toBeVisible();
  await expect(outputBody(page).locator(".pc-sec").first()).toBeVisible();
}

async function open(page: Page, world: (w: World) => void = quiet) {
  await openWindow(page, "main", { world });
  await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
  await coreReady(page);
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
    await shortcutsReady(page);
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

test.describe("cpt-noter-feature-ui-call-page-outputs section states", () => {
  test("writing: sections remain visible while outputs are being written", async ({ page }) => {
    await openWindow(page, "main", { world: writing });
    await coreReady(page);
    await nav(page, { type: "call_page", call_id: W.PAST_CALL, tab: "summary" });
    await expect(page.getByText("Writing the outputs · the transcript is ready to read")).toBeInViewport();
    await shot(page, "outputs-writing");
  });

  test("local: the local writing notice names its runtime", async ({ page }) => {
    await openWindow(page, "main", { world: writingLocally });
    await coreReady(page);
    await nav(page, { type: "call_page", call_id: W.PAST_CALL, tab: "summary" });
    await expect(page.getByText("Writing with the local model · up to 10 min · role reviews follow in the background")).toBeInViewport();
    await shot(page, "outputs-local-writing");
  });

  test("failed: one section shows retry while its neighbours stay ready", async ({ page }) => {
    await openWindow(page, "main", { world: actionItemsFailed });
    await coreReady(page);
    await nav(page, { type: "call_page", call_id: W.PAST_CALL, tab: "summary" });
    const failed = outputBody(page).locator(".pc-sec").filter({ hasText: "Action items" });
    const retry = failed.getByRole("button", { name: "Try Again" });
    await expect(failed).toContainText("Couldn't write the action items");
    await retry.scrollIntoViewIfNeeded();
    await expect(retry).toBeInViewport();
    await expect(failed.getByText(/Couldn't write the action items/)).toBeInViewport();
    await expect(outputBody(page)).toContainText("Drawer events will ship behind a flag.");
    await shot(page, "outputs-section-failed");
  });

  test("empty: a section with no items has its empty state", async ({ page }) => {
    await openWindow(page, "main", { world: (w) => { written(w); Object.assign(sectionOf(w, "open_questions"), { state: { type: "empty" }, items: [] }); } });
    await coreReady(page);
    await nav(page, { type: "call_page", call_id: W.PAST_CALL, tab: "summary" });
    const empty = outputBody(page).locator(".pc-sec").filter({ hasText: "Open questions" });
    await empty.scrollIntoViewIfNeeded();
    await expect(empty).toContainText("No open questions in this call");
    await expect(empty).toBeInViewport();
    await expect(empty.getByText("No open questions in this call")).toBeInViewport();
    await shot(page, "outputs-empty-section");
  });

  test("edited: the saved edit and its version control are visible", async ({ page }) => {
    await openWindow(page, "main", { world: (w) => { written(w); const summary = sectionOf(w, "summary"); Object.assign(summary, { body_md: "Edited summary copy.", user_edited: true, version_count: 2 }); outputsOf(w).status = "ready"; } });
    await coreReady(page);
    await nav(page, { type: "call_page", call_id: W.PAST_CALL, tab: "summary" });
    await expect(outputBody(page)).toContainText("Edited summary copy.");
    await expect(outputBody(page)).toContainText("Edited");
    await expect(outputBody(page).locator(".pc-sec").first().getByText("Edited summary copy.")).toBeInViewport();
    await expect(outputBody(page).locator(".pc-sec__meta")).toContainText("1 min 40 s after the call");
    await shot(page, "outputs-edited");
  });

  test("regeneration sheet: runtime and selected sections are visible before submit", async ({ page }) => {
    await open(page, (w) => { quiet(w); written(w); });
    await shortcutsReady(page);
    await page.locator('[data-region="PC-R1"]').getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Regenerate Outputs…" }).click();
    const dialog = page.getByRole("dialog", { name: "Regenerate Outputs" });
    await expect(dialog).toBeInViewport();
    await expect(dialog).toContainText("Runtime and model");
    await expect(dialog).toContainText("With Current Settings");
    await expect(dialog.getByRole("checkbox", { name: "Summary" })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: "Decisions, action items and open questions" })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: "Role reviews" })).not.toBeChecked();
    await expect(dialog.getByText("Summary", { exact: true })).toBeInViewport();
    await expect(dialog.getByText("Decisions, action items and open questions", { exact: true })).toBeInViewport();
    await shot(page, "outputs-regeneration-sheet");
  });

  test("regenerating: accepted work keeps the old summary visible with progress", async ({ page }) => {
    await page.clock.install();
    await freeze(page);
    await open(page, (w) => { quiet(w); written(w); });
    await shortcutsReady(page);
    await page.locator('[data-region="PC-R1"]').getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Regenerate Outputs…" }).click();
    const dialog = page.getByRole("dialog", { name: "Regenerate Outputs" });
    const selectedItems = dialog.getByRole("checkbox", { name: "Decisions, action items and open questions" });
    await expect(dialog).toContainText("Runtime and model");
    await expect(dialog).toContainText("With Current Settings");
    await expect(dialog.getByRole("checkbox", { name: "Summary" })).toBeChecked();
    await expect(selectedItems).toBeChecked();
    await dialog.getByText("Decisions, action items and open questions", { exact: true }).click();
    await expect(selectedItems).not.toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: "Summary" })).toBeChecked();
    await page.clock.pauseAt(await page.evaluate(() => Date.now()));
    await dialog.getByRole("button", { name: "Regenerate", exact: true }).click();

    const summary = outputBody(page).locator('.pc-sec[data-kind="summary"]');
    await expect(dialog).toBeHidden();
    await page.clock.runFor(300);
    await expect(summary).toHaveAttribute("data-state", "writing");
    await expect(summary.locator(".pc-md")).toContainText("Backend and QA aligned on the websocket notifications.");
    await expect(summary).toContainText("Regenerating…");
    await expect(summary).toBeInViewport();
    await expect(summary.locator(".pc-md")).toBeInViewport();
    await shot(page, "outputs-regenerating-in-progress");
  });

  test("comparing: the edited summary exposes its before and after diff", async ({ page }) => {
    await open(page, (w) => {
      quiet(w);
      written(w);
      Object.assign(sectionOf(w, "summary"), { regenerated_with_edits: true, version_count: 1 });
    });
    const summary = outputBody(page).locator(".pc-sec").first();
    await summary.getByRole("button", { name: "Edit" }).click();
    await summary.getByRole("textbox").fill("Edited comparison copy.");
    await page.keyboard.press("Meta+Enter");
    await expect(summary.locator(".pc-md")).toHaveText("Edited comparison copy.");
    await summary.getByRole("button", { name: "Show Diff" }).click();
    await expect(summary.locator(".pc-diff")).toBeInViewport();
    await shot(page, "outputs-comparing");
  });
});
