// Screenshot specs of Today (docs/features/ui/today.md › Definitions of Done), slice S1: the calls, the live call, This
// week, Calendar not asked and Calendar denied, rendered against the fake core. The due list and Done today join in S2.
// Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import type { UpcomingCall } from "../../src/core/bindings";
import { openWindow } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";

const HOUR = 3_600_000;
const call = (w: World, id: string, title: string, at: number, over: Partial<UpcomingCall> = {}): UpcomingCall => ({
  event_id: `evt_${id}`,
  title,
  starts_at: at,
  ends_at: at + HOUR,
  platform: "Microsoft Teams",
  attendees: [{ person: null, name: "Anna K.", email: null }],
  sensitive: false,
  call_id: null,
  last_time: { call: { id: W.PAST_CALL, title: "Backend sync", started_at: at - 7 * 24 * HOUR, call_type: "cross_team" }, line: "estimates parked, empty state has no owner" },
  items: [],
  questions: [],
  handed_off: [],
  open_count: 0,
  ...over,
});
const day = (more: (w: World) => void = () => {}) => (w: World) => {
  W.idle(w);
  w.app.setup.self_test = { type: "passed", at: 1 };
  Object.assign(w.today, { calendar: "granted", first_use: false, live_call: null, banners: [], done_today: [], due_without_call: [], review_waiting: 0 });
  w.today.today = [call(w, "plan", W.LIVE_TITLE, w.now + HOUR, { open_count: 3 }), call(w, "sync", "Cross-team QA sync", w.now + 3 * HOUR, { sensitive: true, open_count: 1 })];
  more(w);
};
async function open(page: Page, world: (w: World) => void) {
  await openWindow(page, "main", { world });
  await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
  // Proposals remain visible after Today loads even when Calendar is denied and its region is empty.
  await expect(page.locator('[data-region="TD-R6"]')).toBeVisible();
}
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await expect(page).toHaveScreenshot(`${name}.png`);
};

test.describe("cpt-noter-dod-ui-today-dashboard today", () => {
  test("the day's calls, the next expanded and Local only on the later one", async ({ page }) => {
    await open(page, day());
    await expect(page.getByText("Today · 2 calls")).toBeVisible();
    await shot(page, "today-calls");
  });
  test("a live call no event matches is the first card", async ({ page }) => {
    await open(page, day((w) => Object.assign(w.today, { live_call: w.calls.find((c) => c.id === W.LIVE_CALL)! })));
    await expect(page.locator('[data-variant="unmatched"]')).toBeVisible();
    await shot(page, "today-live");
  });
  test("no calls today with This week", async ({ page }) => {
    await open(page, day((w) => Object.assign(w.today, { today: [], this_week: [call(w, "qa", "Cross-team QA sync", w.now + 24 * HOUR, { open_count: 2 })] })));
    await expect(page.getByText("This week")).toBeVisible();
    await shot(page, "today-no-calls-week");
  });
  test("Calendar not asked", async ({ page }) => {
    await open(page, (w) => (day()(w), W.permission(w, "calendar", "not_asked"), Object.assign(w.today, { calendar: "not_asked", today: [] })));
    await shot(page, "today-calendar-not-asked");
  });
  test("Calendar denied", async ({ page }) => {
    await open(page, (w) => (day()(w), W.permission(w, "calendar", "denied"), Object.assign(w.today, { calendar: "denied", today: [] })));
    await expect(page.getByText("Calendar access is off")).toBeVisible();
    await shot(page, "today-calendar-denied");
  });
});
