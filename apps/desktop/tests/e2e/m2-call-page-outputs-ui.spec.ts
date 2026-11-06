// M2 — Call page outputs and sharing (docs/features/ui/call-page-outputs.md, DESIGN.md Call page PC-R2/PC-R3, Share menu,
// Output section, Version switcher, Diff view). Real-core stories of cpt-noter-seq-call-page-review-outputs (every path;
// History's log paths are delegated to History), cpt-noter-seq-call-page-share-outputs (every path) and
// cpt-noter-seq-notifications-open-outputs (every path; the macOS notification itself is native, XCUITest
// test_cpt_noter_seq_notifications_open_outputs). Written before the screens exist (tests first): they fail until the
// feature lands. Starting states: support/outputs-world.ts. Copy and labels are DESIGN's, never adjusted to the markup.
import type { Page } from "@playwright/test";

import { navigate, openSummary, section, sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";
import * as O from "./support/outputs-world";

const toolbar = (page: Page) => page.locator('[data-region="PC-R1"]');
const share = (page: Page) => toolbar(page).getByRole("button", { name: /^Share/ });
const menu = (page: Page) => page.getByRole("menu");

test.describe("cpt-noter-seq-call-page-review-outputs", () => {

  test("UI — happy path: Esc discards the draft and the saved text stays", async ({ page }) => {
    const { call } = await O.openOutputs(page, "written");
    await openSummary(page, call);
    const summary = section(page, "Summary");
    await summary.getByRole("button", { name: "Edit" }).click();
    await summary.getByRole("textbox").fill("A correction nobody saves");
    await page.keyboard.press("Escape");
    await expect(summary).toContainText("Drawer events will ship behind a flag.");
    expect(await sent(page, "output_edit")).toEqual([]);
  });

  test("UI — error path: a save that conflicts keeps the draft and shows the error until the user saves again", async ({ page }) => {
    const { steer, call } = await O.openOutputs(page, "written");
    await openSummary(page, call);
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

  test("UI — error path: A section failed — the others stay usable, Try Again writes that section only", async ({ page }) => {
    const { call } = await O.openOutputs(page, "actionItemsFailed");
    await openSummary(page, call);
    const failed = section(page, /^Action items/);
    await expect(failed).toContainText("Couldn't write the action items (Claude Code timed out)");
    await expect(failed.getByRole("button", { name: "Try Again" })).toBeVisible();
    await expect(failed.getByRole("button", { name: "Use Local Model" })).toBeVisible();
    await expect(section(page, "Summary")).toContainText("Drawer events will ship behind a flag.");
    await expect(section(page, /^Decisions/)).toBeVisible(); // the second scripted answer carries no items

    await failed.getByRole("button", { name: "Try Again" }).click();
    expect(await sent(page, "outputs_regenerate")).toEqual([expect.objectContaining({ call_id: call, sections: ["action_items"], local: false })]);
    await expect(failed).not.toContainText("Couldn't write the action items");
  });

  test("UI — error path: Use Local Model regenerates that section locally and says so", async ({ page }) => {
    const { call } = await O.openOutputs(page, "actionItemsFailed");
    await openSummary(page, call);
    await section(page, /^Action items/).getByRole("button", { name: "Use Local Model" }).click();
    expect(await sent(page, "outputs_regenerate")).toEqual([expect.objectContaining({ sections: ["action_items"], local: true })]);
  });

  test("UI — other path: a version that cannot be read keeps the current prose and offers a retry beside the version control", async ({ page }) => {
    const { steer, call } = await O.openOutputs(page, "written", { world: (w) => Object.assign(O.sectionOf(w, "summary"), { version_count: 3, user_edited: true }), edits: 1 });
    await openSummary(page, call);
    const summary = section(page, "Summary");
    await steer.failNext("output_version_get", "not_found");
    await summary.getByRole("button", { name: /Version/ }).click();
    await menu(page).getByRole("menuitem", { name: /^v1/ }).click();
    await expect(summary).toContainText("Drawer events will ship behind a flag.");
    await expect(summary.getByRole("button", { name: "Try Again" })).toBeVisible();
  });
});

test.describe("cpt-noter-seq-call-page-share-outputs", () => {
  test("UI — happy path: Share opens on Whole call, Copy for Slack shows Copied for Slack on the button", async ({ page }) => {
    const { call } = await O.openOutputs(page, "written");
    await openSummary(page, call);
    await share(page).click();
    await expect(menu(page)).toContainText("Whole call");
    await menu(page).getByRole("menuitem", { name: "Copy for Slack" }).click();
    const first = { call_id: call, scope: { sections: [], item_ids: [], include_unreviewed: false }, format: "slack" };
    if (O.REAL) {
      // the real core's call carries suggested items: it refuses, and Copy anyway is the explicit inclusion
      expect(await sent(page, "share_copy")).toEqual([first]);
      await share(page).click();
      await menu(page).getByRole("menuitem", { name: "Copy anyway" }).click();
      expect((await sent(page, "share_copy")).at(-1)).toEqual({ ...first, scope: { ...first.scope, include_unreviewed: true } });
    } else expect(await sent(page, "share_copy")).toEqual([first]);
    await expect(share(page)).toContainText("Copied for Slack"); // 2 s, announced politely
    await expect(page.getByRole("status").filter({ hasText: "Copied for Slack" })).toHaveCount(1);
    await expect(share(page)).not.toContainText("Copied for Slack", { timeout: 5000 });
  });

  test("UI — happy path: ⌘⇧C copies for Slack without opening the menu", async ({ page }) => {
    const { call } = await O.openOutputs(page, "written");
    await openSummary(page, call);
    await page.keyboard.press("Meta+Shift+KeyC");
    await expect(menu(page)).toHaveCount(0);
    expect(await sent(page, "share_copy")).toEqual([expect.objectContaining({ call_id: call, format: "slack" })]);
    if (O.REAL) return; // suggested items on the real call: the shortcut never includes them on its own, so the core refuses
    await expect(share(page)).toContainText("Copied for Slack");
  });

  test("UI — other path: Export to a folder — ⌘E, the sheet with Scope: Whole call, tick Transcript, Export…, Exported to <path> with Show in Finder", async ({ page }) => {
    const { call } = await O.openOutputs(page, "written");
    await openSummary(page, call);
    await page.keyboard.press("Meta+KeyE");
    const sheet = page.getByRole("dialog", { name: /Export/ });
    await expect(sheet).toContainText("Scope: Whole call");
    await expect(sheet.getByRole("checkbox", { name: "Summary and items" })).toBeChecked();
    await expect(sheet.getByRole("checkbox", { name: "Transcript" })).not.toBeChecked();
    await expect(sheet.getByRole("checkbox", { name: "Audio" })).toBeVisible(); // audio is kept
    await sheet.getByText("Transcript", { exact: true }).click(); // the label is the hit area
    await expect(sheet.getByRole("checkbox", { name: "Transcript" })).toBeChecked();
    await sheet.getByRole("button", { name: "Export…" }).click(); // the core shows the macOS save panel; the harness answers it

    expect(await sent(page, "calls_export")).toEqual([
      { call_ids: [call], include: { summary_and_items: true, transcript: true, audio: false }, scope: null },
    ].map((a) => expect.objectContaining({ call_ids: a.call_ids, include: expect.objectContaining({ summary_and_items: true, transcript: true }) })));
    await expect(toolbar(page)).toContainText(/Exported to .+/);
    await page.getByRole("button", { name: "Show in Finder" }).click();
    expect(await sent(page, "open_external")).toEqual([{ target: { type: "reveal_in_finder", path: expect.any(String) } }]);
  });

  test("UI — other path: Export needs one content checkbox, and a cancelled save panel leaves no Exported status", async ({ page }) => {
    const { steer, call } = await O.openOutputs(page, "written");
    await openSummary(page, call);
    await page.keyboard.press("Meta+KeyE");
    const sheet = page.getByRole("dialog", { name: /Export/ });
    await sheet.getByText("Summary and items", { exact: true }).click();
    await expect(sheet.getByRole("button", { name: "Export…" })).toBeDisabled();
    await sheet.getByText("Summary and items", { exact: true }).click();
    await steer.failNext("calls_export", "cancelled");
    await sheet.getByRole("button", { name: "Export…" }).click();
    await expect(toolbar(page)).not.toContainText("Exported to");
    await expect(page.getByRole("button", { name: "Show in Finder" })).toHaveCount(0);
  });

});

test.describe("cpt-noter-seq-notifications-open-outputs", () => {
  test("UI — happy path: a notification click (nav:request) opens the call's Summary in the main window with its outputs loaded", async ({ page }) => {
    const { call } = await O.openOutputs(page, "written");
    await openSummary(page, call);
    await page.keyboard.press("Meta+Digit1"); // the user works elsewhere in Noter
    await navigate(page, "summary", call); // what a click on NT-1 does: the core's window_navigate → nav:request
    await expect(page.getByRole("tab", { name: "Summary", selected: true })).toBeVisible();
    await expect(section(page, "Summary")).toContainText("Drawer events will ship behind a flag.");
    expect((await sent(page, "outputs_get")).length).toBeGreaterThan(0);
  });

});
