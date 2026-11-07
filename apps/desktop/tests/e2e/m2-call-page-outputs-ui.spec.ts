// M2 — Call page outputs and sharing (docs/features/ui/call-page-outputs.md, DESIGN.md Call page PC-R2/PC-R3, Share menu,
// Output section, Version switcher, Diff view). Real-core stories of cpt-noter-seq-call-page-review-outputs (every path;
// History's log paths are delegated to History), cpt-noter-seq-call-page-share-outputs (every path) and
// cpt-noter-seq-notifications-open-outputs (every path; the macOS notification itself is native, XCUITest
// test_cpt_noter_seq_notifications_open_outputs). Written before the screens exist (tests first): they fail until the
// feature lands. Starting states: support/outputs-world.ts. Copy and labels are DESIGN's, never adjusted to the markup.
import type { Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { banner, body, navigate, openSummary, section, sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";
import * as O from "./support/outputs-world";

const toolbar = (page: Page) => page.locator('[data-region="PC-R1"]');
const share = (page: Page) => toolbar(page).getByRole("button", { name: /^Share|^Copied/ });
const menu = (page: Page) => page.getByRole("menu");

/** The shortcuts live on the toolbar's Share control and read the loaded outputs: press them only once both are there. */
const shortcutsReady = async (page: Page) => {
  await expect(share(page)).toBeVisible();
  await expect(body(page)).toBeVisible();
};

/** Summary opened and its controls there: the Share control (shortcuts, copy) and the loaded sections (every edit and action). */
const openReady = async (page: Page, call?: string) => {
  await (call === undefined ? openSummary(page) : openSummary(page, call));
  await shortcutsReady(page);
};

test.describe("cpt-noter-seq-call-page-review-outputs", () => {
  test("UI — happy path: Summary meta line, the four sections, Edit, ⌘Return, Edited badge and Your Edit in the version menu", async ({ page }) => {
    await openWindow(page, "main", { world: O.written });
    await openReady(page);
    await expect.poll(async () => (await sent(page, "outputs_get")).some((a) => a.call_id === W.PAST_CALL)).toBe(true);

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

    await expect.poll(() => sent(page, "output_edit")).toEqual([
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
    await openReady(page);
    const summary = section(page, "Summary");
    await summary.getByRole("button", { name: "Edit" }).click();
    await summary.getByRole("textbox").fill("A correction nobody saves");
    await page.keyboard.press("Escape");
    await expect(summary).toContainText("Drawer events will ship behind a flag.");
    expect(await sent(page, "output_edit")).toEqual([]);
  });

  test("UI — error path: a save that conflicts keeps the draft and shows the error until the user saves again", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: O.written });
    await openReady(page);
    const summary = section(page, "Summary");
    await summary.getByRole("button", { name: "Edit" }).click();
    await summary.getByRole("textbox").fill("My correction");
    await steer.failNext("output_edit", "conflict", { type: "conflict", current_rev: 3 });
    await page.keyboard.press("Meta+Enter");
    await expect(summary.getByRole("textbox")).toHaveValue("My correction");
    await expect(summary.getByRole("alert")).toBeVisible();
    await expect.poll(() => sent(page, "output_edit")).toHaveLength(1);
    await page.keyboard.press("Meta+Enter"); // an explicit new save
    await expect.poll(async () => (await sent(page, "output_edit")).length).toBe(2);
  });

  test("UI — empty path: the local runtime says Writing with the local model · up to 10 min · role reviews follow in the background", async ({ page }) => {
    await openWindow(page, "main", {
      world: O.writingLocally,
    });
    await openReady(page);
    await expect(banner(page)).toContainText("Writing with the local model · up to 10 min · role reviews follow in the background");
  });

  test("UI — error path: A section failed — the others stay usable, Try Again writes that section only", async ({ page }) => {
    await openWindow(page, "main", { world: O.actionItemsFailed });
    await openReady(page);
    const failed = section(page, /^Action items/);
    await expect(failed).toContainText("Couldn't write the action items (Claude Code timed out)");
    await expect(failed.getByRole("button", { name: "Try Again" })).toBeVisible();
    await expect(failed.getByRole("button", { name: "Use Local Model" })).toBeVisible();
    await expect(section(page, "Summary")).toContainText("Drawer events will ship behind a flag.");
    await expect(section(page, /^Decisions/)).toContainText("Decisions · 2");

    await failed.getByRole("button", { name: "Try Again" }).click();
    await expect.poll(() => sent(page, "outputs_regenerate")).toEqual([expect.objectContaining({ call_id: W.PAST_CALL, sections: ["action_items"], local: false })]);
    await expect(failed).not.toContainText("Couldn't write the action items");
  });

  test("UI — error path: Use Local Model regenerates that section locally and says so", async ({ page }) => {
    await openWindow(page, "main", { world: O.actionItemsFailed });
    await openReady(page);
    await section(page, /^Action items/).getByRole("button", { name: "Use Local Model" }).click();
    await expect.poll(() => sent(page, "outputs_regenerate")).toEqual([expect.objectContaining({ sections: ["action_items"], local: true })]);
  });

  test("UI — other path: a regenerate that is blocked during capture says it waits for the call to end, with no retry", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: O.written });
    await openReady(page);
    await steer.failNext("outputs_regenerate", "job_blocked");
    await toolbar(page).getByRole("button", { name: "More" }).click();
    await menu(page).getByRole("menuitem", { name: "Regenerate Outputs…" }).click();
    await page.getByRole("dialog", { name: "Regenerate Outputs" }).getByRole("button", { name: "Regenerate", exact: true }).click();
    await expect(page.getByText(/waits for the call to end/i)).toBeVisible();
    await page.waitForTimeout(1500);
    await expect.poll(() => sent(page, "outputs_regenerate")).toHaveLength(1); // no timer retry
  });

  test("UI — other path: a version that cannot be read keeps the current prose and offers a retry beside the version control", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: (w) => (O.written(w), Object.assign(O.sectionOf(w, "summary"), { version_count: 3, user_edited: true })) });
    await openReady(page);
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
    await openReady(page);
    await page.keyboard.press("Meta+Digit1"); // the user works elsewhere in Noter
    await navigate(page, "summary"); // what a click on NT-1 does: the core's window_navigate → nav:request
    await expect(page.getByRole("heading", { name: new RegExp(O.TITLE) }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "Summary", selected: true })).toBeVisible();
    await expect(section(page, "Summary")).toContainText("Drawer events will ship behind a flag.");
    await expect.poll(async () => (await sent(page, "outputs_get")).length).toBeGreaterThan(0);
  });

  test("UI — error path: Outputs failed — the click opens the failed section with Try Again, Try Again writes it", async ({ page }) => {
    await openWindow(page, "main", { world: O.actionItemsFailed });
    await page.waitForFunction(() => "__noterFake" in globalThis || "__TAURI_INTERNALS__" in globalThis);
    await navigate(page, "summary");
    const failed = section(page, /^Action items/);
    await expect(failed.getByRole("button", { name: "Try Again" })).toBeVisible();
    expect(await sent(page, "outputs_regenerate")).toEqual([]); // opening a failure never retries on its own
    const real = process.env.NOTER_CORE === "stdio";
    if (!real) {
      const now = new Date("2026-11-07T10:00:00Z");
      await page.clock.install({ time: now });
      await page.clock.pauseAt(now);
    }
    await failed.getByRole("button", { name: "Try Again" }).click();
    // The fake emits writing after 300 ms and ready after 600 ms: hold between them.
    if (!real) await page.clock.runFor(400);
    await expect(failed).toContainText(real ? "Scripted action item" : "Writing");
    await expect.poll(() => sent(page, "outputs_regenerate")).toEqual([expect.objectContaining({ sections: ["action_items"] })]);
  });

  test("UI — error path: the call was deleted — a notification click for it opens the frame's not-found state, not a dead Summary", async ({ page }) => {
    await openWindow(page, "main", { world: O.written });
    await page.waitForFunction(() => "__noterFake" in globalThis || "__TAURI_INTERNALS__" in globalThis);
    await page.evaluate(async () => {
      const args = { target: { type: "call_page", call_id: "call_deleted", tab: "summary" } };
      const g = globalThis as unknown as { __noterFake?: { invoke(c: string, a: unknown): Promise<unknown> }; __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> } };
      await (g.__noterFake ? g.__noterFake.invoke("window_navigate", args) : g.__TAURI_INTERNALS__!.invoke("window_navigate", { args }));
    });
    await expect(page.getByText("This call is no longer here")).toBeVisible();
  });

  test("UI — happy path: the page is already visible when the Summary finishes — Summary ready is announced once, without a second announcement", async ({ page }) => {
    await openWindow(page, "main", {
      world: (w) => {
        O.written(w);
        O.setState(w, "summary", { type: "failed", code: "runtime_unavailable", local_fallback_available: true });
        O.sectionOf(w, "summary").body_md = null;
        O.outputsOf(w).status = "partially_failed";
      },
    });
    await page.waitForFunction(() => "__noterFake" in globalThis || "__TAURI_INTERNALS__" in globalThis);
    await navigate(page, "summary");
    await section(page, /^Summary/).getByRole("button", { name: "Try Again" }).click();
    await expect(async () => {
      const said = (await calls(page)).filter((c) => c.kind === "invoke" && c.name === "window_announce" && JSON.stringify(c.args).includes("Summary ready"));
      expect(said).toHaveLength(1);
    }).toPass();
  });

  test("UI — empty path: the next call is recording — opening the finished call's Summary still reads its outputs while the live call goes on", async ({ page }) => {
    await openWindow(page, "main", { world: O.written }); // the 1:1 is the live call of the fixture; the planning call is past
    await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
    await navigate(page, "summary");
    await expect(section(page, "Summary")).toContainText("Drawer events will ship behind a flag.");
    await expect.poll(() => sent(page, "outputs_get")).toEqual([expect.objectContaining({ call_id: W.PAST_CALL })]);
    await expect(body(page)).toBeVisible();
  });
});

test.describe("cpt-noter-seq-call-page-share-outputs", () => {
  test("UI — happy path: Share opens on Whole call, Copy for Slack shows Copied for Slack on the button", async ({ page }) => {
    const { call } = await O.openOutputs(page, "written");
    await openReady(page, call);
    await share(page).click();
    await expect(menu(page)).toContainText("Whole call");
    await menu(page).getByRole("menuitem", { name: "Copy for Slack" }).click();
    const first = { call_id: call, scope: { sections: [], item_ids: [], include_unreviewed: false }, format: "slack" };
    await expect.poll(() => sent(page, "share_copy")).toEqual([first]);
    await expect(share(page)).toContainText("Copied for Slack"); // 2 s, announced politely
    await expect(page.getByRole("status").filter({ hasText: "Copied for Slack" })).toHaveCount(1);
    await expect(share(page)).not.toContainText("Copied for Slack", { timeout: 5000 });
  });

  test("UI — happy path: ⌘⇧C copies for Slack without opening the menu", async ({ page }) => {
    const { call } = await O.openOutputs(page, "written");
    await openReady(page, call);
    await shortcutsReady(page);
    await page.keyboard.press("Meta+Shift+KeyC");
    await expect(menu(page)).toHaveCount(0);
    // the menu never opens, so nothing above waits for the invoke: poll until the core has been asked
    await expect.poll(() => sent(page, "share_copy")).toEqual([expect.objectContaining({ call_id: call, format: "slack" })]);
    await expect(share(page)).toContainText("Copied for Slack");
  });

  test("UI — other path: Export to a folder — ⌘E, the sheet with Scope: Whole call, tick Transcript, Export…, Exported to <path> with Show in Finder", async ({ page }) => {
    const { call } = await O.openOutputs(page, "written");
    await openReady(page, call);
    await shortcutsReady(page);
    await page.keyboard.press("Meta+KeyE");
    const sheet = page.getByRole("dialog", { name: /Export/ });
    await expect(sheet).toContainText("Scope: Whole call");
    await expect(sheet.getByRole("checkbox", { name: "Summary and items" })).toBeChecked();
    await expect(sheet.getByRole("checkbox", { name: "Transcript" })).not.toBeChecked();
    await expect(sheet.getByRole("checkbox", { name: "Audio" })).toBeVisible(); // audio is kept
    await sheet.getByText("Transcript", { exact: true }).click(); // the label is the hit area
    await expect(sheet.getByRole("checkbox", { name: "Transcript" })).toBeChecked();
    await sheet.getByRole("button", { name: "Export…" }).click(); // the core shows the macOS save panel; the harness answers it

    await expect.poll(() => sent(page, "calls_export")).toEqual([
      { call_ids: [call], include: { summary_and_items: true, transcript: true, audio: false }, scope: null },
    ].map((a) => expect.objectContaining({ call_ids: a.call_ids, include: expect.objectContaining({ summary_and_items: true, transcript: true }) })));
    await expect(toolbar(page)).toContainText(/Exported to .+/);
    await page.getByRole("button", { name: "Show in Finder" }).click();
    await expect.poll(() => sent(page, "open_external")).toEqual([{ target: { type: "reveal_in_finder", path: expect.any(String) } }]);
  });

  test("UI — other path: Export needs one content checkbox, and a cancelled save panel leaves no Exported status", async ({ page }) => {
    const { steer, call } = await O.openOutputs(page, "written");
    await openReady(page, call);
    await shortcutsReady(page);
    await page.keyboard.press("Meta+KeyE");
    const sheet = page.getByRole("dialog", { name: /Export/ });
    await sheet.getByText("Summary and items", { exact: true }).click();
    await expect(sheet.getByRole("button", { name: "Export…" })).toBeDisabled();
    await sheet.getByText("Summary and items", { exact: true }).click();
    await steer.failNext("calls_export", "cancelled");
    await sheet.getByRole("button", { name: "Export…" }).click();
    await expect.poll(() => sent(page, "calls_export")).toHaveLength(1); // the core has answered (cancelled) before we look for a status
    await expect(sheet).toHaveCount(0);
    await expect(toolbar(page)).not.toContainText("Exported to");
    await expect(page.getByRole("button", { name: "Show in Finder" })).toHaveCount(0);
  });

});



test("cpt-noter-seq-call-page-share-outputs — marking an open call sensitive updates the clipboard warning", async ({ page }) => {
  const { call } = await O.openOutputs(page, "written");
  await openReady(page, call);
  await expect(section(page, "Summary")).toBeVisible();
  await toolbar(page).getByRole("button", { name: "More" }).click();
  await menu(page).getByRole("menuitemcheckbox", { name: "Mark as Sensitive" }).click();
  await share(page).click();
  await expect(menu(page)).toContainText("Sensitive call · copying puts the text on your clipboard");
  await menu(page).getByRole("menuitem", { name: "Copy for Slack" }).click();
  await expect(share(page)).toContainText("Copied");
  await expect(share(page)).not.toContainText("Copied for Slack");
});
