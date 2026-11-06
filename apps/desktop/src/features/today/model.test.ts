import { describe, expect, it } from "vitest";

import type { TodayView } from "../../core/bindings";
import { calendarState, cardRows, cards, isExpanded, proposalPreview, recordBlock, reviewLine } from "./model";

const view = (over: Partial<TodayView> = {}): TodayView =>
  ({ date: "2026-11-05", ranking: "owed_to_todays_people", calendar: "granted", live_call: null, today: [], this_week: [], due_without_call: [], done_today: [], review_waiting: 0, proposals: [], proposals_total: 0, banners: [], first_use: false, ...over }) as TodayView;

describe("calendarState (cpt-noter-state-ui-today-calendar)", () => {
  it("is LOADING until the first read and ERROR when the command failed", () => {
    expect(calendarState({ state: "WAITING" }, undefined)).toBe("LOADING");
    expect(calendarState({ state: "IDLE" }, undefined)).toBe("LOADING");
    expect(calendarState({ state: "ERROR" }, undefined)).toBe("ERROR");
    expect(calendarState({ state: "ERROR" }, view())).toBe("ERROR");
  });
  it("maps the read's calendar result", () => {
    expect(calendarState({ state: "DONE" }, view({ calendar: "not_asked" }))).toBe("NOT_ASKED");
    expect(calendarState({ state: "DONE" }, view({ calendar: "denied" }))).toBe("DENIED");
    expect(calendarState({ state: "DONE" }, view({ calendar: "read_failed" }))).toBe("ERROR");
    expect(calendarState({ state: "DONE" }, view())).toBe("NO_CALLS");
    expect(calendarState({ state: "DONE" }, view({ today: [{}] as never }))).toBe("READY");
  });
  it("reads a live call alone as a day with calls", () => {
    expect(calendarState({ state: "DONE" }, view({ live_call: {} as never }))).toBe("READY");
  });
  it("keeps the last read while it is read again", () => {
    expect(calendarState({ state: "WAITING" }, view({ today: [{}] as never }))).toBe("READY");
  });
  it("is ASKING while the permission prompt is open", () => {
    expect(calendarState({ state: "DONE" }, view({ calendar: "not_asked" }), true)).toBe("ASKING");
  });
});

describe("reviewLine (TD-R8)", () => {
  it("is absent while nothing waits and counts what the core reports", () => {
    expect(reviewLine(view())).toBeNull();
    expect(reviewLine(view({ review_waiting: 3 }))).toEqual({ count: 3 });
  });
});

describe("proposalPreview (TD-R6)", () => {
  it("shows at most three, and the core's total", () => {
    const rows = [1, 2, 3, 4].map((i) => ({ id: `chg_${i}` })) as never;
    expect(proposalPreview(view({ proposals: rows, proposals_total: 7 }))).toEqual({ rows: (rows as unknown[]).slice(0, 3), total: 7 });
  });
});

describe("recordBlock (TD-R1)", () => {
  it("dims Record with the reason while the speech model is missing or the disk is nearly full", () => {
    const ready = { models: { bundles: [{ required_for_capture: true, state: "ready" }] } } as never;
    const missing = { models: { bundles: [{ required_for_capture: true, state: "pending" }] } } as never;
    expect(recordBlock(ready, { disk_free_mb: 9000 } as never)).toBeNull();
    expect(recordBlock(missing, { disk_free_mb: 9000 } as never)).toBe("model_missing");
    expect(recordBlock(ready, { disk_free_mb: 499 } as never)).toBe("disk_full");
    expect(recordBlock(undefined, undefined)).toBeNull();
  });
});

const ev = (id: string, over: Record<string, unknown> = {}) => ({ event_id: id, call_id: null, items: [], questions: [], sensitive: false, ...over }) as never;
const item = (n: number) => ({ id: `itm_${n}` }) as never;

describe("cards (cpt-noter-algo-ui-today-project)", () => {
  it("keeps the core's order", () => {
    expect(cards(view({ today: [ev("a"), ev("b")] })).map((c) => c.event?.event_id)).toEqual(["a", "b"]);
  });
  it("moves the card of the recorded call first", () => {
    const out = cards(view({ today: [ev("a"), ev("b", { call_id: "call_1" })], live_call: { id: "call_1" } as never }));
    expect(out.map((c) => [c.event?.event_id, c.variant])).toEqual([["b", "live"], ["a", "today"]]);
  });
  it("makes a live call no event matches its own card", () => {
    const out = cards(view({ today: [ev("a")], live_call: { id: "call_9" } as never }));
    expect(out.map((c) => c.variant)).toEqual(["unmatched", "today"]);
    expect(out[0]!.event).toBeNull();
  });
});

describe("cardRows", () => {
  const card = { items: [1, 2, 3, 4].map(item), questions: [5, 6, 7].map(item) } as never;
  it("shows five rows and counts the rest", () => {
    const r = cardRows(card, false);
    expect(r.rows).toHaveLength(5);
    expect(r.more).toBe(2);
  });
  it("shows all of them after Show More", () => expect(cardRows(card, true)).toMatchObject({ more: 0, rows: expect.any(Array) }));
});

describe("isExpanded (cpt-noter-state-ui-today-card)", () => {
  it("opens the next call and collapses later ones", () => {
    expect(isExpanded("a", new Map(), true)).toBe(true);
    expect(isExpanded("b", new Map(), false)).toBe(false);
  });
  it("keeps the user's choice by event id", () => {
    expect(isExpanded("b", new Map([["b", true]]), false)).toBe(true);
    expect(isExpanded("a", new Map([["a", false]]), true)).toBe(false);
  });
});
