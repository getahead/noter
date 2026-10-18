// M1 — Library › Calls (docs/features/ui/library-calls.md, DESIGN.md › Screen — Library, LC-R1 and LC-R3).
// The feature has no story of its own in M1: it carries the flows below and the path of
// cpt-noter-seq-dialogs-delete-call (Other — Several calls selected), which m1-dialogs-host-ui.spec.ts drives.
// Markup follows the prototype (`C.callRow`, 40-d-3-library.js): LC-R1 is the toolbar with the subtitle,
// LC-R3 the table, rows are `data-component="cpt-noter-component-ui-call-row"` with `data-state`, the
// chevron is the button "Open <title>". Written before the screen exists (tests first).
// NATIVE (apps/desktop/tests/native): test_cpt_noter_seq_dialogs_delete_call__other_several_calls_selected
//   (the NSAlert Delete 3 calls? with Cancel as default).
import type { Page } from "@playwright/test";

import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";
import { alertText, alerts, answerAlerts, watchAlerts } from "./support/native-alert";

const ROW = '[data-component="cpt-noter-component-ui-call-row"][data-variant="table-row"]';
const table = (page: Page) => page.locator('[data-region="LC-R3"]');
const toolbar = (page: Page) => page.locator('[data-region="LC-R1"]');
const rowOf = (page: Page, title: string) => page.locator(ROW).filter({ hasText: title });
const sent = async (page: Page, name: string): Promise<unknown[]> =>
  (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args);
const first = (w: World) => w.calls.find((c) => c.id === W.PAST_CALL)!;

async function openCalls(page: Page, world: (w: World) => void = () => {}, plan: { latency?: number } = {}) {
  await watchAlerts(page);
  const steer = await openWindow(page, "main", { ...plan, world: (w) => (W.idle(w), world(w)) });
  await page.keyboard.press("Meta+Digit3");
  return steer;
}

test.describe("cpt-noter-flow-ui-library-calls-browse", () => {
  test("UI — happy path: ⌘3 lists the calls newest first with one calls_list read, sort headers toggle and are announced", async ({ page }) => {
    await openCalls(page);
    await expect(toolbar(page)).toContainText("Calls");
    await expect(toolbar(page)).toContainText(/\d+ calls? · /);
    await expect(page.locator(ROW)).toHaveCount(2);
    const reads = await sent(page, "calls_list");
    expect(reads).toHaveLength(1); // one call per page, never one per row
    expect(reads[0]).toMatchObject({ sort: "newest", filter: {} });
    expect(await sent(page, "call_get")).toHaveLength(0);

    const header = (name: string) => table(page).getByRole("columnheader", { name });
    await header("Length").click();
    await expect.poll(() => sent(page, "calls_list")).toContainEqual(expect.objectContaining({ sort: "longest" }));
    await expect(header("Length")).toHaveAttribute("aria-sort", /ascending|descending/);
    await expect(page.getByRole("status").filter({ hasText: /sorted (ascending|descending)/ })).toBeVisible();
    await header("Call").click();
    await expect.poll(() => sent(page, "calls_list")).toContainEqual(expect.objectContaining({ sort: "title" }));
    await header("When").click();
    await header("When").click();
    await expect.poll(async () => (await sent(page, "calls_list")).map((a) => (a as { sort: string }).sort)).toEqual(expect.arrayContaining(["oldest", "newest"]));
  });

  test("UI — keyboard only: Return opens the call's page, Back returns to the same scroll position and selection, the end of the page loads the next one", async ({ page }) => {
    await openCalls(page, (w) => W.morePastCalls(w, 40));
    const last = rowOf(page, "Backend sync #41");
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeVisible(); // the later page arrived with the scroll
    await last.click();
    const y = (await last.boundingBox())!.y;
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-region="MW-R1"]').getByRole("heading", { name: "Backend sync #41" })).toBeVisible();
    expect(await sent(page, "call_get")).toContainEqual(expect.objectContaining({ call_id: `${W.PAST_CALL}_41` }));

    await page.keyboard.press("Meta+BracketLeft");
    await expect(last).toHaveAttribute("aria-selected", "true");
    expect(Math.abs((await last.boundingBox())!.y - y)).toBeLessThan(3);
  });

  test("UI — empty path: No calls yet with Run Audio Self-Test… only while the self-test has not passed", async ({ page }) => {
    const steer = await openCalls(page, (w) => {
      w.calls = [];
      W.selfTestSkipped(w);
    });
    const empty = table(page).locator('[data-component="cpt-noter-component-ui-empty-state"]');
    await expect(empty).toContainText("No calls yet");
    await expect(empty).toContainText("Calls you record appear here with their summary, decisions and action items.");
    await expect(empty.getByRole("button", { name: "Run Audio Self-Test…" })).toBeVisible();
    await empty.getByRole("button", { name: "Run Audio Self-Test…" }).click();
    await expect(page.locator('[data-primitive="sheet"]')).toBeVisible();
    await page.keyboard.press("Escape");

    await steer.change((w) => (w.app.setup.self_test = { type: "passed", at: Date.now() }));
    await expect(empty.getByRole("button", { name: "Run Audio Self-Test…" })).toHaveCount(0);
  });

  test("UI — slow read: skeleton rows after 300 ms", async ({ page }) => {
    await openCalls(page, () => {}, { latency: 900 });
    await expect(table(page).locator('[aria-busy="true"], [data-state="loading"]').first()).toBeVisible({ timeout: 1_200 });
    await expect(page.locator(ROW).first()).toBeVisible();
  });

  test("UI — error path: the list read fails, the inline banner offers Try Again", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: W.idle });
    await steer.failNext("calls_list", "internal");
    await page.keyboard.press("Meta+Digit3");
    const banner = page.locator('[data-component="cpt-noter-component-ui-inline-banner"]');
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Try Again" }).click();
    await expect(page.locator(ROW)).toHaveCount(2);
  });
});

test.describe("cpt-noter-algo-ui-library-calls-status-cell", () => {
  test("UI — other path: status cell order, the Local only tag and the audio-deleted glyph", async ({ page }) => {
    await openCalls(page, (w) => {
      W.morePastCalls(w, 3);
      const [a, b, c, d] = w.calls.filter((x) => x.id.startsWith(W.PAST_CALL));
      Object.assign(a, { outputs: "failed", unnamed_speakers: 2, archive: "pending" }); // the first that applies wins
      Object.assign(b, { outputs: "writing", unnamed_speakers: 2 });
      Object.assign(c, { outputs: "ready", unnamed_speakers: 2, archive: "pending", privacy: "sensitive" });
      Object.assign(d, { outputs: "ready", unnamed_speakers: 0, archive: "pending", audio_deleted: true });
    });
    await expect(rowOf(page, "Backend sync").first()).toContainText("Couldn't write the summary");
    await expect(rowOf(page, "Backend sync").first()).not.toContainText("Archive pending");
    await expect(rowOf(page, "Backend sync #2")).toContainText("Writing summary…");
    await expect(rowOf(page, "Backend sync #3")).toContainText("2 speakers not named");
    await expect(rowOf(page, "Backend sync #3")).toContainText("Local only");
    await expect(rowOf(page, "Backend sync #4")).toContainText("Archive pending");
    await expect(rowOf(page, "Backend sync #4").getByTitle(/^Audio deleted on .+ \(kept 30 days\)$/)).toBeVisible();
  });
});

test.describe("cpt-noter-flow-ui-library-calls-delete", () => {
  test("UI — other path (cpt-noter-seq-dialogs-delete-call, Several calls selected): ⌘A selects all, ⇧↑ and ⌘-click adjust, the subtitle counts them", async ({ page }) => {
    await openCalls(page, (w) => W.morePastCalls(w, 2));
    await rowOf(page, "Backend sync").first().click();
    await page.keyboard.press("Meta+KeyA");
    await expect(toolbar(page)).toContainText("· 4 selected");
    await rowOf(page, "Backend sync #2").click(); // a plain click selects only that row
    await expect(toolbar(page)).not.toContainText("selected");
    await page.keyboard.press("Shift+ArrowDown");
    await expect(toolbar(page)).toContainText("· 2 selected");
    await rowOf(page, "Backend sync #3").click({ modifiers: ["Meta"] });
    await expect(toolbar(page)).toContainText("· 3 selected");
  });

  test("UI — error path: a right-click on an unselected row selects only it; Delete… from its menu asks about that one call and Cancel keeps it", async ({ page }) => {
    await openCalls(page, (w) => W.morePastCalls(w, 2));
    await rowOf(page, "Backend sync").first().click();
    await rowOf(page, "Backend sync #2").click({ modifiers: ["Meta"] });
    await rowOf(page, "Backend sync #3").click({ button: "right" });
    await expect(rowOf(page, "Backend sync #3")).toHaveAttribute("aria-selected", "true");
    await expect(rowOf(page, "Backend sync").first()).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("menuitem", { name: "Open" })).toBeVisible();

    await page.getByRole("menuitem", { name: /^Delete…/ }).click();
    await expect.poll(async () => (await alerts(page)).length).toBe(1);
    expect(alertText((await alerts(page))[0])).toContain("Delete “Backend sync #3”?");
    expect(await sent(page, "calls_delete")).toHaveLength(0); // answered Cancel
    await expect(page.locator(ROW)).toHaveCount(4);
  });

  test("UI — happy path: deleting the last call leaves the No calls yet state", async ({ page }) => {
    await openCalls(page, (w) => (w.calls = [first(w)]));
    await rowOf(page, "Backend sync").click();
    await answerAlerts(page, "confirm");
    await page.keyboard.press("Meta+Backspace");
    await expect.poll(() => sent(page, "calls_delete")).toContainEqual({ call_ids: [W.PAST_CALL] });
    await expect(table(page).locator('[data-component="cpt-noter-component-ui-empty-state"]')).toContainText("No calls yet");
  });
});

test.describe("cpt-noter-flow-ui-library-calls-edit", () => {
  test("UI — happy path: Rename… and Call Type ▸ on the call's page send call_update with the rev and the row shows the new values", async ({ page }) => {
    let rev = 0;
    await openCalls(page, (w) => (rev = first(w).rev));
    await rowOf(page, "Backend sync").click();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Rename…" }).click();
    await page.getByRole("textbox", { name: /title|name/i }).fill("Backend sync, renamed");
    await page.keyboard.press("Enter");
    await expect.poll(() => sent(page, "call_update")).toContainEqual({ call_id: W.PAST_CALL, rev, title: "Backend sync, renamed" });

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: /^Call Type/ }).click();
    expect(await sent(page, "call_types_list")).toHaveLength(1);
    await page.getByRole("menuitem", { name: /one on one/i }).click();
    await expect.poll(async () => (await sent(page, "call_update")).at(-1)).toMatchObject({ call_id: W.PAST_CALL, call_type: "one_on_one" });

    await page.keyboard.press("Meta+BracketLeft");
    await expect(rowOf(page, "Backend sync, renamed")).toContainText(/one on one/i);
  });

  test("UI — error path: conflict, the row keeps the core's current title", async ({ page }) => {
    const steer = await openCalls(page);
    await rowOf(page, "Backend sync").click();
    await page.keyboard.press("Enter");
    await steer.failNext("call_update", "conflict");
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Rename…" }).click();
    await page.getByRole("textbox", { name: /title|name/i }).fill("Never saved");
    await page.keyboard.press("Enter");
    await expect.poll(() => sent(page, "call_update")).toHaveLength(1);
    await page.keyboard.press("Meta+BracketLeft");
    await expect(rowOf(page, "Backend sync").first()).toBeVisible();
    await expect(rowOf(page, "Never saved")).toHaveCount(0);
  });
});
