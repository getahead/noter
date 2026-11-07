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
  // today_get reads live calls from call records, independently of the capture toolbar state.
  for (const call of [...w.calls, ...w.call_details.map((detail) => detail.call)]) {
    if (call.status === "recording" || call.status === "paused") call.status = "ready";
  }
  W.permission(w, "calendar", state);
  // the real core derives these from the permission (and refuses a changed `today`); the fake world serves them as given
  if (process.env.NOTER_CORE !== "stdio") Object.assign(w.today, { calendar: state, today: [], this_week: [], live_call: null });
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
    await expect(live).toHaveAttribute("aria-label", W.LIVE_TITLE);
    await expect(live.locator(".td-card__elapsed")).toHaveText(/ · \d+:\d{2}/);
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

function dueWorld(w: Parameters<typeof W.idle>[0]) {
  W.idle(w);
  for (const call of [...w.calls, ...w.call_details.map((detail) => detail.call)]) {
    if (call.status === "recording" || call.status === "paused") call.status = "ready";
  }
  const due = w.items.filter((it) => ["itm_spec", "itm_replay"].includes(it.id));
  due.forEach((it) => { it.due = "2020-01-01"; });
  Object.assign(w.today, { today: [], this_week: [], live_call: null, due_without_call: due, done_today: [] });
}
const due = (page: Page) => page.locator('[data-region="TD-R5"]');
const done = (page: Page) => page.locator('[data-region="TD-R7"]');

test.describe("cpt-noter-seq-today-tick-item", () => {
  test("UI — happy — tick a suggested card item, retain Undo after feedback expires, restore the suggestion", async ({ page }) => {
    await openToday(page, cardWorld);
    const row = cards(page).first().locator('[data-item-id="itm_replay"]');
    await row.getByRole("checkbox").press("Space");
    await expect(button(done(page), "Done today · 1")).toBeVisible();
    await button(done(page), "Done today · 1").click();
    await expect(done(page).getByText("Accepted and done")).toBeVisible();
    await expect(done(page).getByText("Accepted and done")).toHaveCount(0, { timeout: 15_000 });
    await button(done(page), "Undo").click();
    await expect(row.getByText("Suggested", { exact: true })).toBeVisible();
    expect(await sent(page, "change_undo")).toHaveLength(1);
    await expect(button(done(page), "Done today · 0")).toBeVisible();
  });
  test("UI — Other — keyboard Space completes, focus reaches Done disclosure, Cmd-Z restores", async ({ page }) => {
    await openToday(page, dueWorld);
    const row = due(page).locator('[data-item-id="itm_spec"]');
    await row.focus();
    await page.keyboard.press("Space");
    await expect(button(done(page), "Done today · 1")).toBeFocused();
    await page.keyboard.press("Meta+z");
    await expect(row.getByRole("checkbox")).not.toBeChecked();
    expect(await sent(page, "change_undo")).toHaveLength(1);
  });
  test("UI — error — failed completion leaves the row open and retry explicit", async ({ page }) => {
    const steer = await openToday(page, dueWorld);
    const row = due(page).locator('[data-item-id="itm_spec"]');
    await expect(row).toBeVisible();
    await steer.failNext("item_set_done", "internal");
    await row.getByRole("checkbox").press("Space");
    await expect(row.getByRole("alert")).toBeVisible();
    await expect(row.getByRole("checkbox")).not.toBeChecked();
    expect(await sent(page, "item_set_done")).toHaveLength(1);
  });
});

test.describe("cpt-noter-seq-today-review-before-call", () => {
  test("UI — error — initial calendar failure retains due items and retries with two delayed skeletons", async ({ page }) => {
    await openWindow(page, "main", { world: dueWorld, fail: [{ cmd: "today_get", code: "calendar_unavailable" }], latency: 500 });
    await expect(page.getByText("Couldn't read today's calendar.")).toBeVisible();
    await button(page, "Try Again").click();
    // the skeletons show only between 300 ms and the 500 ms latency, so poll finer than the default
    await expect.poll(() => page.locator(".td-skel").count(), { intervals: [50] }).toBe(2);
    await expect(due(page).getByText("Drawer redesign spec by Friday")).toBeVisible();
    await expect(page.getByText("No calls today")).toBeVisible();
  });
  test("UI — Other — wide columns become due, proposals, week, Done in narrow layout", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await openToday(page, dueWorld);
    const d = await due(page).boundingBox();
    const p = await page.locator('[data-region="TD-R6"]').boundingBox();
    expect(p!.x).toBeGreaterThan(d!.x + d!.width - 1);
    await page.setViewportSize({ width: 800, height: 1000 });
    await expect(async () => {
      const dd = await due(page).boundingBox();
      const pp = await page.locator('[data-region="TD-R6"]').boundingBox();
      expect(pp!.y).toBeGreaterThan(dd!.y);
    }).toPass();
  });
});

function cardWorld(w: Parameters<typeof W.idle>[0]) {
  dueWorld(w);
  const base = { ...w.today.today[0] };
  // Calendar events are harness input; the real core derives their carried items from participant history.
  const rows = w.items.filter((it) => it.call.id === W.LIVE_CALL);
  const now = Date.now();
  const event = {
    ...base, event_id: "evt_today_s2", title: "Today preparation", starts_at: now + 60_000, ends_at: now + 3_600_000,
    platform: "Microsoft Teams", attendees: [{ name: "Anna Kuznetsova", email: null, person: rows[0]!.owner }],
    call_id: null, sensitive: false, last_time: null,
    items: rows.filter((it) => it.kind !== "open_question" && it.status !== "handed_off"),
    questions: rows.filter((it) => it.kind === "open_question"),
    handed_off: rows.filter((it) => it.status === "handed_off"), open_count: rows.length,
  };
  w.today.today = [event, { ...event, event_id: "evt_today_later", title: "Later preparation", starts_at: now + 7_200_000, ends_at: now + 10_800_000 }];
  w.today.this_week = [{ ...event, event_id: "evt_week", title: "Week preparation", starts_at: now + 86_400_000, ends_at: now + 90_000_000 }];
  w.today.due_without_call = [];
}

test.describe("cpt-noter-seq-today-review-before-call", () => {
  test("UI — happy — core-ranked cards, five rows then Show More, later and week disclosures", async ({ page }) => {
    await openToday(page, cardWorld);
    const first = cards(page).filter({ has: page.getByRole("heading", { name: "Today preparation", exact: true }) });
    await expect(first).toHaveAttribute("data-state", "expanded");
    await expect(first.locator('[data-item-id]')).toHaveCount(5);
    await button(first, "Show 1 More").click();
    await expect(first.locator('[data-item-id]')).toHaveCount(6);
    const later = cards(page).filter({ has: page.getByRole("heading", { name: "Later preparation", exact: true }) });
    await expect(later).toHaveAttribute("data-state", "collapsed");
    await button(later, "Later preparation",).click();
    await expect(later).toHaveAttribute("data-state", "expanded");
    await button(later, "Collapse").click();
    await expect(later).toHaveAttribute("data-state", "collapsed");
    await button(page, /Week preparation/).click();
    await expect(page.locator('[data-region="TD-R4"] [data-item-id]')).toHaveCount(5);
  });
  test("UI — Other — evidence Return and Back restore row focus and Show More", async ({ page }) => {
    await openToday(page, cardWorld);
    const first = cards(page).first();
    await button(first, "Show 1 More").click();
    const row = first.locator('[data-item-id="itm_spec"]');
    await row.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => sent(page, "window_navigate")).toContainEqual(expect.objectContaining({ target: expect.objectContaining({ type: "call_page", tab: "transcript" }) }));
    await expect(page.getByRole("tab", { name: "Transcript", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Meta+BracketLeft");
    await expect(row).toBeFocused();
    await expect(first.locator('[data-item-id]')).toHaveCount(6);
  });
});

test.describe("cpt-noter-seq-today-tick-item", () => {
  for (const [label, answer] of [["Keep Open", "keep_open"], ["Yes, Landed", "landed"], ["Done Another Way", "done_another_way"]] as const) {
    test(`UI — Other — handed-off card item asks explicitly: ${label}`, async ({ page }) => {
      await openToday(page, cardWorld);
      const first = cards(page).first();
      await button(first, "Show 1 More").click();
      const row = first.locator('[data-item-id="itm_virt"]');
      await row.getByRole("checkbox").press("Space");
      await expect(row.getByRole("group", { name: "Did the handoff land?" })).toBeVisible();
      expect(await sent(page, "item_set_done")).toHaveLength(0);
      await button(row, label).click();
      await expect.poll(() => sent(page, "item_answer_handoff_landed")).toContainEqual(expect.objectContaining({ item_id: "itm_virt", answer }));
      await expect(button(done(page), answer === "keep_open" ? "Done today · 0" : "Done today · 1")).toBeVisible();
      if (answer === "keep_open") await expect(row.getByRole("checkbox")).not.toBeChecked();
    });
  }
});


test("cpt-noter-seq-today-review-before-call — TD-R8 lists a link per call with suggestions and opens its Summary", async ({ page }) => {
  await openToday(page, cardWorld);
  const review = page.locator('[data-region="TD-R8"]');
  await expect(review).toContainText(/\d+ suggested items? from \d+ calls?/);
  const link = review.getByRole("link").first();
  await expect(link).toBeVisible();
  await link.click();
  await expect.poll(() => sent(page, "window_navigate")).toContainEqual({ target: { type: "call_page", call_id: expect.any(String), tab: "summary" } });
});

test("cpt-noter-seq-today-review-before-call — quit recovery opens the saved Transcript", async ({ page }) => {
  await openToday(page, (w) => {
    dueWorld(w);
    w.app.banners.banners = [{ type: "recording_interrupted_by_quit", call: w.items[0]!.call }];
  });
  await button(page, "Open Call",).click();
  await expect.poll(() => sent(page, "window_navigate")).toContainEqual({ target: { type: "call_page", call_id: W.LIVE_CALL, tab: "transcript" } });
});

test("cpt-noter-seq-today-tick-item — first use explains where items will appear", async ({ page }) => {
  await openToday(page, (w) => {
    dueWorld(w);
    w.calls = [];
    w.call_details = [];
    w.items = [];
    Object.assign(w.today, { first_use: true, due_without_call: [], done_today: [], review_waiting: 0, proposals: [], proposals_total: 0 });
  });
  await expect(page.getByText("Nothing open yet", { exact: true })).toBeVisible();
  await expect(page.getByText("Nothing due without a call", { exact: true })).toBeVisible();
  await expect(page.getByText("Nothing ticked today", { exact: true })).toBeVisible();
});

test("cpt-noter-seq-today-tick-item — Escape keeps a handed-off item open", async ({ page }) => {
  await openToday(page, cardWorld);
  const card = cards(page).first();
  await button(card, "Show 1 More").click();
  const row = card.locator('[data-item-id="itm_virt"]');
  await row.getByRole("checkbox").press("Space");
  await expect(row.getByRole("group", { name: "Did the handoff land?" })).toBeVisible();
  await row.getByRole("button", { name: "Keep Open" }).focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => sent(page, "item_answer_handoff_landed")).toContainEqual(expect.objectContaining({ answer: "keep_open" }));
  await expect(row.getByRole("checkbox")).not.toBeChecked();
});
