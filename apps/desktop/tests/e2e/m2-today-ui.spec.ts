// M2 — Today (docs/features/ui/today.md, DESIGN.md › Screen — Today TD-R1–TD-R8, Upcoming call card), slice S1.
// Stories: `cpt-noter-seq-today-review-before-call`: Return to a live call, Calendar not allowed yet and Calendar access denied.
// Commands: today_get, permission_request (calendar), open_external, window_show_call. These run on the real core
// (NOTER_CORE=stdio → noter-core-harness). The other paths of the two stories (call cards with items, read failed, quit banner,
// due list, Done today, tick, handoff, Undo) need `world_set today` (Unblocker ask #6) or the item rows (2.17) and stay on
// lane/ui/e2e-m2-1 until S2.
import type { Locator, Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const CARD = '[data-component="cpt-noter-component-ui-upcoming-call-card"]';
const cards = (page: Page) => page.locator(CARD);
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
