// M2 — Today (docs/features/ui/today.md, DESIGN.md › Screen — Today TD-R1–TD-R8, Upcoming call card), slice S1.
// Stories: `cpt-noter-seq-today-review-before-call`: Return to a live call, Calendar not allowed yet and Calendar access denied.
// Commands: today_get, permission_request (calendar), open_external, window_show_call, item_set_done. They run on the fake
// and on the real core (NOTER_CORE=stdio → noter-core-harness). S2 adds `cpt-noter-seq-today-tick-item` over the due list
// (TD-R5) and Done today (TD-R7) of the default world. The card paths (items on a card, Show More, read failed before the
// first read, quit banner, handoff answer) stay on lane/ui/e2e-m2-1: the real core ranks card items itself, so a card's
// rows cannot be set by the test.
import type { Locator, Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const CARD = '[data-component="cpt-noter-component-ui-upcoming-call-card"]';
const cards = (page: Page) => page.locator(CARD);
const ROW = '[data-component="cpt-noter-component-ui-action-item-row"]';
const SPEC = "Drawer redesign spec by Friday"; // itm_spec, due without a call in the fixture world
// the row's own Undo button, or the Undo link of its fresh outcome
const undo = (row: Locator) => row.getByRole("button", { name: "Undo" }).or(row.getByRole("link", { name: "Undo" }));
const button = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name });
const sent = async (page: Page, name: string): Promise<Array<Record<string, unknown>>> =>
  (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args as Record<string, unknown>);
const calendar = (state: "not_asked" | "denied") => (w: Parameters<typeof W.idle>[0]) => {
  W.idle(w);
  W.permission(w, "calendar", state);
  // the real core derives these from the permission (and refuses a changed `today`); the fake world serves them as given
  if (process.env.NOTER_CORE !== "stdio") Object.assign(w.today, { calendar: state, today: [], this_week: [] });
};

/** The window opens on Today, the first section (⌘1). */
async function openToday(page: Page, world: (w: Parameters<typeof W.idle>[0]) => void) {
  const steer = await openWindow(page, "main", { world });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit1");
    await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
  return steer;
}

test.describe("cpt-noter-seq-today-review-before-call", () => {
  test("UI — Other — Return to a live call: the recording's card is first with the recording indicator and Open Call Screen", async ({ page }) => {
    await openToday(page, () => {}); // the fixture world records the planning call and no calendar event matches it
    const live = cards(page).first();
    await expect(live).toContainText(W.LIVE_TITLE);
    await expect(live.locator('[data-component="cpt-noter-component-ui-recording-indicator"]')).toBeVisible();
    await button(live, "Open Call Screen").click();
    await expect.poll(() => sent(page, "window_show_call")).toHaveLength(1);
  });

  test("UI — empty path — Calendar not allowed yet: See today's calls here, Allow Calendar Access asks once and refreshes Today", async ({ page }) => {
    await openToday(page, calendar("not_asked"));
    await expect(page.getByText("See today's calls here")).toBeVisible();
    await expect(page.getByText("Noter reads your macOS Calendar to line up open items before each call.")).toBeVisible();
    await expect(page.getByText(/^Today · \d+ calls?$/)).toHaveCount(0); // header reads Today without a count
    expect(await sent(page, "permission_request")).toHaveLength(0); // never asked automatically
    const reads = (await sent(page, "today_get")).length;
    await button(page, "Allow Calendar Access").click();
    expect(await sent(page, "permission_request")).toEqual([{ kind: "calendar" }]);
    await expect.poll(async () => (await sent(page, "today_get")).length).toBeGreaterThan(reads);
  });

  test("UI — error path — Calendar access denied: Calendar access is off, Open System Settings…, Proposals waiting stays", async ({ page }) => {
    await openToday(page, calendar("denied"));
    await expect(page.getByText("Calendar access is off")).toBeVisible();
    await expect(page.getByText(/Proposals waiting/)).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await button(page, "Open System Settings…").click();
    expect(await sent(page, "open_external")).toEqual([{ target: { type: "system_settings", permission: "calendar" } }]);
  });
});

test.describe("cpt-noter-seq-today-tick-item", () => {
  test.skip(process.env.NOTER_CORE !== "stdio", "the fake core's Today read does not regroup due and Done today after a tick; the real core does");
  test("UI — happy path: Space on a due row's checkbox ticks it (item_set_done with the rev), it reads Done and Done today lists it with Undo", async ({ page }) => {
    await openToday(page, () => {});
    const due = page.locator('[data-region="TD-R5"]');
    const row = due.locator(ROW).filter({ hasText: SPEC });
    await row.getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    expect(await sent(page, "item_set_done")).toEqual([{ item_id: "itm_spec", rev: expect.any(Number), done: true }]);
    const done = page.locator('[data-region="TD-R7"]');
    await button(done, /Done today/).click();
    await expect(done.locator(ROW).filter({ hasText: SPEC })).toBeVisible();
    await expect(undo(done.locator(ROW).filter({ hasText: SPEC }))).toBeVisible();
  });

  test("UI — error path — Ticked by mistake: Undo in Done today opens the item again in the due list", async ({ page }) => {
    await openToday(page, () => {});
    await page.locator('[data-region="TD-R5"]').locator(ROW).filter({ hasText: SPEC }).getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    const done = page.locator('[data-region="TD-R7"]');
    await button(done, /Done today/).click();
    await undo(done.locator(ROW).filter({ hasText: SPEC })).click();
    await expect(page.locator('[data-region="TD-R5"]').locator(ROW).filter({ hasText: SPEC })).toBeVisible();
    await expect(done.locator(ROW).filter({ hasText: SPEC })).toHaveCount(0);
  });
});
