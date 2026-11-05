// M2 — Today (docs/features/ui/today.md, DESIGN.md › Screen — Today TD-R1–TD-R8, Upcoming call card).
// Stories: `cpt-noter-seq-today-review-before-call` (happy, Return to a live call, Calendar not allowed yet, Calendar access denied,
// Calendar read failed, No calls today, Noter quit during a recording) and `cpt-noter-seq-today-tick-item` (happy, open handoff,
// ticked by mistake, nothing open yet). Commands: today_get, item_set_done, item_answer_handoff_landed, change_undo,
// permission_request (calendar), open_external, capture_resume_interrupted, window_show_call, window_navigate.
// Written before the feature exists (tests first): they fail until today lands. They drive the real UI on the selected core
// (NOTER_CORE=stdio → noter-core-harness). The fixture's TodayView has no calendar events, so `todayOf` builds the cards from the
// fixture's own items and people; on the real core the harness must serve that world (data gap, _team/handoff-ui-m2-e2e-1.md).
import type { Locator, Page } from "@playwright/test";

import type { CalendarAccess, ItemView, UpcomingCall } from "../../src/core/bindings";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const ROW = '[data-component="cpt-noter-component-ui-action-item-row"]';
const CARD = '[data-component="cpt-noter-component-ui-upcoming-call-card"]';
const STRIP = '[data-component="cpt-noter-component-ui-undo-strip"]';
const toolbar = (page: Page) => page.locator('[data-region="TD-R1"]');
const banner = (page: Page) => page.locator('[data-region="TD-R2"]');
const cards = (page: Page) => page.locator(CARD);
const rowOf = (page: Page, text: string | RegExp) => page.locator(ROW).filter({ hasText: text });
const button = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name });
const sent = async (page: Page, name: string): Promise<Array<Record<string, unknown>>> =>
  (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args as Record<string, unknown>);
const SPEC = "Drawer redesign spec by Friday"; // itm_spec, owed to you by Anna K.
const VIRT = "Virtualise the 10k-row table"; // itm_virt, handed off, awaiting a PR

const HOUR = 3_600_000;
/** An upcoming-call card from the fixture's items of one call. */
function card(w: World, id: string, title: string, at: number, callId: string | null, itemIds: string[]): UpcomingCall {
  const items = w.items.filter((i) => itemIds.includes(i.id)) as ItemView[];
  const owner = items.find((i) => i.owner)?.owner ?? null;
  return {
    event_id: `evt_${id}`,
    title,
    starts_at: at,
    ends_at: at + HOUR,
    platform: "Microsoft Teams",
    attendees: owner ? [{ person: owner, name: owner.display_name, email: null }] : [],
    sensitive: false,
    call_id: callId,
    last_time: { call: { id: W.PAST_CALL, title: "Backend sync", started_at: at - 7 * 24 * HOUR, call_type: "cross_team" }, line: "estimates parked, empty state has no owner" },
    items: items.filter((i) => i.kind === "action_item" && i.status !== "handed_off"),
    questions: items.filter((i) => i.kind === "open_question"),
    handed_off: items.filter((i) => i.status === "handed_off"),
    open_count: items.filter((i) => i.status === "open" || i.status === "handed_off").length,
  } as UpcomingCall;
}
/** Today with three calls (the planning call next, then two later ones), Calendar allowed. */
const todayOf =
  (more: (w: World) => void = () => {}) =>
  (w: World) => {
    W.idle(w);
    const t = w.today;
    t.calendar = "granted";
    t.first_use = false;
    t.live_call = null;
    t.today = [
      card(w, "plan", W.LIVE_TITLE, w.now + HOUR, W.LIVE_CALL, ["itm_spec", "itm_virt", "itm_notif", "itm_a11y", "itm_replay"]),
      card(w, "sync", "Cross-team QA sync", w.now + 3 * HOUR, null, []),
      card(w, "one", "1:1 with Anna", w.now + 5 * HOUR, null, []),
    ];
    t.done_today = [];
    more(w);
  };
const calendar = (state: CalendarAccess) => (w: World) => {
  W.idle(w);
  w.today.calendar = state;
  w.today.today = [];
  w.today.this_week = [];
};
const interrupted = (w: World) => {
  w.today.banners = [{ type: "recording_interrupted_by_quit", call: { id: W.LIVE_CALL, title: W.LIVE_TITLE, started_at: w.now - 2 * HOUR, call_type: "planning" } }];
};

/** The window opens on Today, the first section (⌘1). */
async function openToday(page: Page, world: (w: World) => void) {
  const steer = await openWindow(page, "main", { world });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit1");
    await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
  return steer;
}

test.describe("cpt-noter-seq-today-review-before-call", () => {
  test("UI — happy path: Today · 3 calls, the next call expanded with its items, Last time, ↓ then Return opens the call on Transcript, ⌘[ returns", async ({ page }) => {
    await openToday(page, todayOf());
    expect((await sent(page, "today_get")).length).toBeGreaterThan(0);
    await expect(page.getByText("Today · 3 calls")).toBeVisible();
    await expect(cards(page)).toHaveCount(3);
    const planning = cards(page).filter({ hasText: W.LIVE_TITLE });
    await expect(planning).toContainText("Last time: estimates parked, empty state has no owner");
    await expect(planning.locator(ROW).first()).toContainText(SPEC); // owed to Anna, who is on the call, first
    const later = cards(page).filter({ hasText: "Cross-team QA sync" });
    await expect(later).toContainText(/Nothing open|\d+ open items?/);
    await button(later, /Cross-team QA sync/).click(); // a later card expands in place
    await button(later, "Collapse").click();

    await rowOf(page, SPEC).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-region="PC-R1"]')).toContainText(W.LIVE_TITLE);
    await expect(page.getByRole("heading", { name: "Transcript" }).or(page.getByRole("tab", { name: "Transcript", selected: true })).first()).toBeVisible();
    expect(await sent(page, "transcript_span")).not.toHaveLength(0); // the quoted line is resolved and highlighted
    await page.keyboard.press("Meta+[");
    await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  });

  test("UI — Other — Return to a live call: the live call's card is first with the recording indicator and Open Call Screen", async ({ page }) => {
    await openToday(
      page,
      todayOf((w) => {
        Object.assign(w.app.capture, { phase: "recording", call_id: W.LIVE_CALL, title: W.LIVE_TITLE, started_at: w.now - 12 * 60_000, recorded_ms: 12 * 60_000 });
        w.today.live_call = w.calls.find((c) => c.id === W.LIVE_CALL)!;
      }),
    );
    const live = cards(page).first();
    await expect(live).toContainText(W.LIVE_TITLE);
    await expect(live.locator('[data-component="cpt-noter-component-ui-recording-indicator"]')).toBeVisible();
    await button(live, "Open Call Screen").click();
    await expect.poll(() => sent(page, "window_show_call")).toHaveLength(1);
  });

  test("UI — empty path — Calendar not allowed yet: See today's calls here, Allow Calendar Access asks once and refreshes Today", async ({ page }) => {
    const steer = await openToday(page, calendar("not_asked"));
    await expect(page.getByText("See today's calls here")).toBeVisible();
    await expect(page.getByText("Noter reads your macOS Calendar to line up open items before each call.")).toBeVisible();
    await expect(page.getByText(/^Today · \d+ calls?$/)).toHaveCount(0); // header reads Today without a count
    expect(await sent(page, "permission_request")).toHaveLength(0); // never asked automatically
    const reads = (await sent(page, "today_get")).length;
    await steer.change(todayOf());
    await button(page, "Allow Calendar Access").click();
    expect(await sent(page, "permission_request")).toEqual([{ kind: "calendar" }]);
    await expect.poll(async () => (await sent(page, "today_get")).length).toBeGreaterThan(reads);
  });

  test("UI — error path — Calendar access denied: Calendar access is off, Open System Settings…, the other regions stay", async ({ page }) => {
    await openToday(page, calendar("denied"));
    await expect(page.getByText("Calendar access is off")).toBeVisible();
    await expect(page.getByText("Due this week, no call")).toBeVisible();
    await expect(page.getByText(/Proposals waiting/)).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await button(page, "Open System Settings…").click();
    expect(await sent(page, "open_external")).toEqual([{ target: { type: "system_settings", permission: "calendar" } }]);
  });

  test("UI — error path — Calendar read failed: Couldn't read today's calendar., Try Again repeats today_get and shows the calls", async ({ page }) => {
    const steer = await openToday(page, calendar("read_failed"));
    await expect(page.getByText("Couldn't read today's calendar.")).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    const reads = (await sent(page, "today_get")).length;
    await steer.change(todayOf());
    await button(page, "Try Again").click();
    await expect.poll(async () => (await sent(page, "today_get")).length).toBe(reads + 1); // Try Again re-reads Today only
    await expect(page.getByText("Today · 3 calls")).toBeVisible();
  });

  test("UI — empty path — No calls today: the line shows, This week, Due this week, no call and Proposals waiting stay, a week row opens its items", async ({ page }) => {
    await openToday(
      page,
      todayOf((w) => {
        w.today.today = [];
        w.today.this_week = [card(w, "qa", "Cross-team QA sync", w.now + 24 * HOUR, null, ["itm_spec", "itm_a11y"])];
      }),
    );
    await expect(page.getByText("No calls today")).toBeVisible();
    await expect(page.getByText("This week")).toBeVisible();
    await expect(page.getByText("Due this week, no call")).toBeVisible();
    await expect(page.getByText(/Proposals waiting/)).toBeVisible();
    await button(page, /Cross-team QA sync · 2 items owed/).click();
    await expect(rowOf(page, SPEC)).toBeVisible();
  });

  test("UI — error path — Noter quit during a recording: the banner offers Open Call and Resume Recording", async ({ page }) => {
    await openToday(page, todayOf(interrupted));
    await expect(banner(page)).toContainText(/Noter quit during “Planning: VHI 8.0 drawer redesign” · saved up to/);
    await expect(button(banner(page), "Open Call")).toBeVisible();
    await button(banner(page), "Resume Recording").click();
    expect(await sent(page, "capture_resume_interrupted")).toEqual([{ call_id: W.LIVE_CALL }]);
  });

  test("UI — error path — Noter quit during a recording: × dismisses the banner and the offer with it", async ({ page }) => {
    await openToday(page, todayOf(interrupted));
    await button(banner(page), /Dismiss|Close|×/).click();
    await expect(page.getByText(/Noter quit during/)).toHaveCount(0);
    await expect(button(page, "Resume Recording")).toHaveCount(0);
    expect(await sent(page, "capture_resume_interrupted")).toHaveLength(0);
  });
});

test.describe("cpt-noter-seq-today-tick-item", () => {
  test("UI — happy path: Space on the row ticks it (item_set_done with the rev), it reads Done · Undo, moves into Done today and its card has one open item fewer", async ({ page }) => {
    await openToday(page, todayOf());
    const planning = cards(page).filter({ hasText: W.LIVE_TITLE });
    const before = await planning.getByText(/\d+ open items?/).first().textContent();
    await rowOf(page, SPEC).focus();
    await page.keyboard.press("Space");
    expect(await sent(page, "item_set_done")).toEqual([{ item_id: "itm_spec", rev: expect.any(Number), done: true }]);
    await expect(rowOf(page, SPEC)).toContainText("Done");
    await expect(button(rowOf(page, SPEC), "Undo")).toBeVisible();
    await button(page, /Done today/).click();
    await expect(page.locator('[data-region="TD-R7"]').getByText(SPEC)).toBeVisible();
    await expect(planning.getByText(/\d+ open items?/).first()).not.toHaveText(before ?? "");
    expect((await sent(page, "today_get")).length).toBeGreaterThan(1); // every card refreshed from the core
  });

  test("UI — the checkbox ticks a suggested row as Accepted and done · Undo", async ({ page }) => {
    await openToday(page, todayOf());
    await rowOf(page, "Replay buffer").getByRole("checkbox").click();
    expect(await sent(page, "item_set_done")).toEqual([expect.objectContaining({ item_id: "itm_replay", done: true })]);
    await expect(rowOf(page, "Replay buffer")).toContainText("Accepted and done");
  });

  test("UI — error path — Item has an open handoff: Did the handoff land? with Yes, Landed, Done Another Way, Keep Open; Yes, Landed completes it", async ({ page }) => {
    await openToday(page, todayOf());
    await rowOf(page, VIRT).focus();
    await page.keyboard.press("Space");
    await expect(page.getByText("Did the handoff land?")).toBeVisible();
    await expect(button(page, "Done Another Way")).toBeVisible();
    await expect(button(page, "Keep Open")).toBeVisible();
    expect(await sent(page, "item_set_done")).toHaveLength(0); // no tick before the answer
    await button(page, "Yes, Landed").click();
    expect(await sent(page, "item_answer_handoff_landed")).toEqual([{ item_id: "itm_virt", rev: expect.any(Number), answer: "landed" }]);
    await button(page, /Done today/).click();
    await expect(page.locator('[data-region="TD-R7"]').getByText(VIRT)).toBeVisible();
  });

  test("UI — error path — Item has an open handoff: Esc keeps it open and sends nothing", async ({ page }) => {
    await openToday(page, todayOf());
    await rowOf(page, VIRT).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");
    await expect(page.getByText("Did the handoff land?")).toHaveCount(0);
    expect(await sent(page, "item_answer_handoff_landed")).toHaveLength(0);
    await expect(rowOf(page, VIRT)).toBeVisible();
  });

  test("UI — error path — Ticked by mistake: Done today lists it with Undo, Undo opens it again in its card", async ({ page }) => {
    await openToday(page, todayOf());
    await rowOf(page, SPEC).focus();
    await page.keyboard.press("Space");
    await button(page, /Done today/).click();
    const done = page.locator('[data-region="TD-R7"]');
    await button(done.locator(ROW).filter({ hasText: SPEC }), "Undo").click();
    expect(await sent(page, "change_undo")).toEqual([{ target: { type: "change", change_id: expect.any(String) } }]);
    await expect(cards(page).filter({ hasText: W.LIVE_TITLE }).locator(ROW).filter({ hasText: SPEC })).toBeVisible();
    await expect(page.locator(STRIP)).toContainText(/Undone/);
  });

  test("UI — ⌘Z undoes the last tick while its strip is the last applicable change", async ({ page }) => {
    await openToday(page, todayOf());
    await rowOf(page, SPEC).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Meta+z");
    await expect.poll(() => sent(page, "change_undo")).toHaveLength(1);
  });

  test("UI — error path: a refused tick keeps the row where it was and shows no Done", async ({ page }) => {
    const steer = await openToday(page, todayOf());
    await steer.failNext("item_set_done", "conflict");
    await rowOf(page, SPEC).focus();
    await page.keyboard.press("Space");
    await expect(rowOf(page, SPEC)).not.toContainText("Done");
    await expect.poll(async () => (await sent(page, "item_get")).length).toBeGreaterThan(0); // refreshed before an explicit retry
  });

  test("UI — empty path — Nothing open yet: before any call, the page says what will fill it", async ({ page }) => {
    await openToday(page, (w) => {
      W.idle(w);
      Object.assign(w.today, { first_use: true, calendar: "granted", today: [], this_week: [], due_without_call: [], done_today: [], review_waiting: 0, proposals: [], proposals_total: 0, banners: [] });
      w.items = [];
    });
    await expect(page.getByText("Nothing open yet")).toBeVisible();
    await expect(page.getByText("Items from your calls appear here. Noter offers to record when a call starts.")).toBeVisible();
    await expect(page.getByText("Nothing due without a call")).toBeVisible();
    await expect(page.getByText("Nothing ticked today")).toBeVisible();
    await expect(toolbar(page)).toContainText("Today");
  });
});
