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
  items: w.items.filter((i) => i.status === "open" && i.kind !== "open_question").slice(0, over.open_count ?? 0),
  questions: [],
  handed_off: [],
  open_count: 0,
  ...over,
});
const day = (more: (w: World) => void = () => {}) => (w: World) => {
  W.idle(w);
  w.items.forEach((i) => { if (i.review === "suggested") i.review = "accepted"; });
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
    await expect(page.locator(".td-card").first()).toHaveCSS("border-top-style", "solid");
    await shot(page, "today-calls");
  });
  test("a live call no event matches is the first card", async ({ page }) => {
    await open(page, day((w) => {
      const live = w.calls.find((c) => c.id === W.LIVE_CALL)!;
      Object.assign(w.today, { live_call: live });
      Object.assign(w.app.capture, { phase: "recording", call_id: live.id, title: live.title, started_at: w.now - 754_000, recorded_ms: 754_000 });
    }));
    await expect(page.locator('[data-variant="unmatched"]')).toBeVisible();
    await shot(page, "today-live");
  });
  test("no calls today with This week", async ({ page }) => {
    await open(page, day((w) => Object.assign(w.today, { today: [], this_week: [call(w, "qa", "Cross-team QA sync", w.now + 24 * HOUR, { open_count: 2 })] })));
    await expect(page.getByText("This week", { exact: true })).toBeVisible();
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

const itemDay = day((w) => {
  const event = w.today.today[0]!;
  const rows = w.items.filter((item) => item.call.id === W.LIVE_CALL);
  event.items = rows.filter((item) => item.kind !== "open_question" && item.status !== "handed_off");
  event.questions = rows.filter((item) => item.kind === "open_question");
  event.handed_off = rows.filter((item) => item.status === "handed_off");
  event.open_count = rows.length;
  w.today.due_without_call = [w.items[0]!];
  w.today.this_week = [call(w, "week", "Weekly review", w.now + 24 * HOUR)];
});

test("Today item regions at Wide and Narrow", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await open(page, itemDay);
  await expect(page.locator('.td-card').first().locator('[data-item-id]')).toHaveCount(5);
  await shot(page, "today-items-wide");
  await page.setViewportSize({ width: 800, height: 1000 });
  await shot(page, "today-items-narrow");
});

test("Today handed-off item asks before completion", async ({ page }) => {
  await open(page, itemDay);
  const card = page.locator('.td-card').first();
  await card.getByRole("button", { name: "Show 1 More" }).click();
  await card.locator('[data-item-id="itm_virt"]').getByRole("checkbox").press("Space");
  await expect(card.getByRole("group", { name: "Did the handoff land?" })).toBeVisible();
  await shot(page, "today-open-handoff");
});

test("Today Done list remains available with Reopen for earlier completions", async ({ page }) => {
  await open(page, day((w) => {
    const item = w.items[0]!;
    Object.assign(item, { status: "done", done_at: w.now });
    w.today.done_today = [item];
  }));
  await page.getByRole("button", { name: "Done today · 1" }).click();
  await expect(page.locator('[data-region="TD-R7"]').getByRole("button", { name: "Reopen" })).toBeVisible();
  await shot(page, "today-done");
});

for (const state of ["first-use", "calendar-failed", "self-test", "model-missing", "engine-stopped", "quit-recording", "nothing-to-review"] as const) {
  test(`Today ${state}`, async ({ page }) => {
    await open(page, day((w) => {
      if (state === "first-use") Object.assign(w.today, { first_use: true, today: [], this_week: [], proposals: [], proposals_total: 0 });
      if (state === "calendar-failed") w.today.calendar = "read_failed";
      if (state === "self-test") W.selfTestSkipped(w);
      if (state === "model-missing") W.speechModel(w)!.state = "pending";
      if (state === "engine-stopped") Object.assign(w.app.capture, { phase: "failed", call_id: W.LIVE_CALL });
      if (state === "nothing-to-review") Object.assign(w.today, { proposals: [], proposals_total: 0, due_without_call: [], done_today: [], review_waiting: 0 });
      if (state === "quit-recording") w.app.banners.banners = [{ type: "recording_interrupted_by_quit", call: w.items[0]!.call }];
    }));
    await shot(page, `today-${state}`);
  });
}
