// M2 — Call page outputs and sharing (docs/features/ui/call-page-outputs.md, DESIGN.md Call page PC-R2/PC-R3, Share menu,
// Output section, Version switcher, Diff view). Real-core stories of cpt-noter-seq-call-page-review-outputs (every path;
// History's log paths are delegated to History), cpt-noter-seq-call-page-share-outputs (every path) and
// cpt-noter-seq-notifications-open-outputs (every path; the macOS notification itself is native, XCUITest
// test_cpt_noter_seq_notifications_open_outputs). Written before the screens exist (tests first): they fail until the
// feature lands. Starting states: support/outputs-world.ts. Copy and labels are DESIGN's, never adjusted to the markup.
import type { Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { openWindow } from "./support/app";
import { banner, body, navigate, openSummary, section, sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";
import * as O from "./support/outputs-world";

const toolbar = (page: Page) => page.locator('[data-region="PC-R1"]');
const menu = (page: Page) => page.getByRole("menu");

test.describe("cpt-noter-seq-call-page-review-outputs", () => {
  test("UI — happy path: Summary meta line, the four sections, Edit, ⌘Return, Edited badge and Your Edit in the version menu", async ({ page }) => {
    await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    expect((await sent(page, "outputs_get")).some((a) => a.call_id === W.PAST_CALL)).toBe(true);

    const summary = section(page, "Summary");
    await expect(summary).toContainText(/Summary · English · Claude Code · \d+ min \d+ s after the call/);
    await expect(section(page, /^Decisions/)).toContainText("Decisions · 2");
    await expect(section(page, /^Action items/)).toContainText("Action items · 4");
    await expect(section(page, /^Open questions/)).toContainText("Open questions · 2");
    await expect(section(page, "Per participant")).toBeVisible();

    await summary.getByRole("button", { name: "Edit" }).click();
    await expect(summary).toContainText("⌘Return saves · Esc cancels");
    await expect(summary.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(summary.getByRole("button", { name: "Save" })).toBeVisible();
    const editor = summary.getByRole("textbox");
    await editor.fill("Backend and QA aligned on the websocket notifications. The soak run is Oleg's.");
    await page.keyboard.press("Meta+Enter");

    expect(await sent(page, "output_edit")).toEqual([
      expect.objectContaining({ call_id: W.PAST_CALL, summary_id: "sum_backend", rev: 2, body_md: "Backend and QA aligned on the websocket notifications. The soak run is Oleg's." }),
    ]);
    await expect(summary).toContainText("The soak run is Oleg's.");
    await expect(summary.getByText("Edited")).toBeVisible();
    await expect(summary.getByText("Saved")).toBeVisible(); // 2 s
    await summary.getByRole("button", { name: /Version/ }).click();
    await expect(menu(page)).toContainText(/Your Edit · \d{1,2}:\d{2}/);
  });

  test("UI — happy path: Esc discards the draft and the saved text stays", async ({ page }) => {
    await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    const summary = section(page, "Summary");
    await summary.getByRole("button", { name: "Edit" }).click();
    await summary.getByRole("textbox").fill("A correction nobody saves");
    await page.keyboard.press("Escape");
    await expect(summary).toContainText("Drawer events will ship behind a flag.");
    expect(await sent(page, "output_edit")).toEqual([]);
  });

  test("UI — error path: a save that conflicts keeps the draft and shows the error until the user saves again", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    const summary = section(page, "Summary");
    await summary.getByRole("button", { name: "Edit" }).click();
    await summary.getByRole("textbox").fill("My correction");
    await steer.failNext("output_edit", "conflict", { type: "conflict", current_rev: 3 });
    await page.keyboard.press("Meta+Enter");
    await expect(summary.getByRole("textbox")).toHaveValue("My correction");
    await expect(summary.getByRole("alert")).toBeVisible();
    expect(await sent(page, "output_edit")).toHaveLength(1);
    await page.keyboard.press("Meta+Enter"); // an explicit new save
    await expect.poll(async () => (await sent(page, "output_edit")).length).toBe(2);
  });

  test("UI — empty path: the local runtime says Writing with the local model · up to 10 min · role reviews follow in the background", async ({ page }) => {
    await openWindow(page, "main", {
      world: (w) => (O.writing(w), (O.outputsOf(w).written_locally = true)),
    });
    await openSummary(page);
    await expect(banner(page)).toContainText("Writing with the local model · up to 10 min · role reviews follow in the background");
  });

  test("UI — error path: A section failed — the others stay usable, Try Again writes that section only", async ({ page }) => {
    await openWindow(page, "main", { world: O.actionItemsFailed });
    await openSummary(page);
    const failed = section(page, /^Action items/);
    await expect(failed).toContainText("Couldn't write the action items (Claude Code timed out)");
    await expect(failed.getByRole("button", { name: "Try Again" })).toBeVisible();
    await expect(failed.getByRole("button", { name: "Use Local Model" })).toBeVisible();
    await expect(section(page, "Summary")).toContainText("Drawer events will ship behind a flag.");
    await expect(section(page, /^Decisions/)).toContainText("Decisions · 2");

    await failed.getByRole("button", { name: "Try Again" }).click();
    expect(await sent(page, "outputs_regenerate")).toEqual([expect.objectContaining({ call_id: W.PAST_CALL, sections: ["action_items"], local: false })]);
    await expect(failed).not.toContainText("Couldn't write the action items");
  });

  test("UI — error path: Use Local Model regenerates that section locally and says so", async ({ page }) => {
    await openWindow(page, "main", { world: O.actionItemsFailed });
    await openSummary(page);
    await section(page, /^Action items/).getByRole("button", { name: "Use Local Model" }).click();
    expect(await sent(page, "outputs_regenerate")).toEqual([expect.objectContaining({ sections: ["action_items"], local: true })]);
  });

  test("UI — other path: a regenerate that is blocked during capture says it waits for the call to end, with no retry", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    await steer.failNext("outputs_regenerate", "job_blocked");
    await toolbar(page).getByRole("button", { name: "More" }).click();
    await menu(page).getByRole("menuitem", { name: "Regenerate Outputs…" }).click();
    await page.getByRole("dialog", { name: "Regenerate Outputs" }).getByRole("button", { name: "Regenerate", exact: true }).click();
    await expect(page.getByText(/waits for the call to end/i)).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await sent(page, "outputs_regenerate")).toHaveLength(1); // no timer retry
  });

  test("UI — other path: a version that cannot be read keeps the current prose and offers a retry beside the version control", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: (w) => (O.written(w), Object.assign(O.sectionOf(w, "summary"), { version_count: 3, user_edited: true })) });
    await openSummary(page);
    const summary = section(page, "Summary");
    await steer.failNext("output_version_get", "not_found");
    await summary.getByRole("button", { name: /Version/ }).click();
    await menu(page).getByRole("menuitem", { name: /^v1/ }).click();
    await expect(summary).toContainText("Drawer events will ship behind a flag.");
    await expect(summary.getByRole("button", { name: "Try Again" })).toBeVisible();
  });
});

test.describe("cpt-noter-seq-notifications-open-outputs", () => {
  test("UI — happy path: a notification click (nav:request) opens the call's Summary in the main window with its outputs loaded", async ({ page }) => {
    await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    await page.keyboard.press("Meta+Digit1"); // the user works elsewhere in Noter
    await navigate(page, "summary"); // what a click on NT-1 does: the core's window_navigate → nav:request
    await expect(page.getByRole("heading", { name: new RegExp(O.TITLE) }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "Summary", selected: true })).toBeVisible();
    await expect(section(page, "Summary")).toContainText("Drawer events will ship behind a flag.");
    expect((await sent(page, "outputs_get")).length).toBeGreaterThan(0);
  });

  test("UI — error path: Outputs failed — the click opens the failed section with Try Again, Try Again writes it", async ({ page }) => {
    await openWindow(page, "main", { world: O.actionItemsFailed });
    await page.waitForFunction(() => "__noterFake" in globalThis || "__TAURI_INTERNALS__" in globalThis);
    await navigate(page, "summary");
    const failed = section(page, /^Action items/);
    await expect(failed.getByRole("button", { name: "Try Again" })).toBeVisible();
    expect(await sent(page, "outputs_regenerate")).toEqual([]); // opening a failure never retries on its own
    await failed.getByRole("button", { name: "Try Again" }).click();
    await expect(failed).toContainText("Writing");
    expect(await sent(page, "outputs_regenerate")).toEqual([expect.objectContaining({ sections: ["action_items"] })]);
  });

  test("UI — empty path: the next call is recording — opening the finished call's Summary still reads its outputs while the live call goes on", async ({ page }) => {
    await openWindow(page, "main", { world: O.written }); // the 1:1 is the live call of the fixture; the planning call is past
    await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
    await navigate(page, "summary");
    await expect(section(page, "Summary")).toContainText("Drawer events will ship behind a flag.");
    expect(await sent(page, "outputs_get")).toEqual([expect.objectContaining({ call_id: W.PAST_CALL })]);
    await expect(body(page)).toBeVisible();
  });
});
