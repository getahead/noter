import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { resetCache, useTypes } from "../call-page/cache";
import type { World } from "../../../tests/support/scenario";
import { openReview } from "../items/review-banner";
import { allowCalendar, loadToday, openCalendarSettings, record, showCall, showPreviousCall } from "./actions";
import { holdToday } from "./cache";
import { TodayBanners } from "./TodayBanners";
import { positionOf } from "./position";
import { TodayPage } from "./TodayPage";
import { TodayToolbar } from "./TodayToolbar";
import { clockOf } from "./clock";
import { UpcomingCallCard } from "./UpcomingCallCard";

let bridge: Bridge;
let fake: FakeCore;
afterEach(async () => {
  await bridge?.close();
  holdToday(undefined);
  resetCache();
});
async function open(mutate: (w: World["app"]) => void = () => {}) {
  fake = new FakeCore({ window: "main" });
  mutate((fake.world as unknown as World).app);
  bridge = createBridge("main", fake);
  await bridge.open();
}
const seen = () => {
  const out: Array<[string, unknown]> = [];
  const invoke = fake.invoke.bind(fake);
  fake.invoke = ((cmd: string, args: unknown) => (out.push([cmd, args]), (invoke as (...a: unknown[]) => unknown)(cmd, args))) as typeof fake.invoke;
  return out;
};
const setCalendar = (c: string) => () => {
  (fake.world as unknown as { today: { calendar: string } }).today.calendar = c;
};

describe("TodayPage (cpt-noter-component-screen-today)", () => {
  it("shows the day once today_get answered", async () => {
    await open();
    await loadToday(bridge);
    const html = renderToString(<TodayPage bridge={bridge} />);
    expect(html).toContain('data-region="TD-R3"');
    expect(html).toContain('data-region="TD-R6"');
  });
  it("asks for Calendar access only on the button, then reads again", async () => {
    await open();
    bridge.store.setState((s) => ({ ...s, whole: { ...s.whole, capture: { ...s.whole.capture!, phase: "idle" } } }));
    setCalendar("not_asked")();
    await loadToday(bridge);
    expect(renderToString(<TodayPage bridge={bridge} />)).toContain("Allow Calendar Access");
    const out = seen();
    await allowCalendar(bridge);
    expect(out.map((c) => c[0])).toEqual(["permission_request", "today_get"]);
    expect(out[0]![1]).toEqual({ kind: "calendar" });
  });
  it("names the denied and failed states", async () => {
    await open();
    setCalendar("denied")();
    await loadToday(bridge);
    // TD-R2: the Calendar warning joins the app's shared banner slot.
    expect(renderToString(<TodayBanners route={{ section: "today", key: "root" }} bridge={bridge} appBanners={0} />)).toContain("Calendar access is off");
    const combined = renderToString(<TodayBanners route={{ section: "today", key: "root" }} bridge={bridge} appBanners={1} appBannerList={[{ id: "app-error", severity: "error", text: "Engine stopped" }]} />);
    expect(combined).toContain("Engine stopped");
    expect(combined).toContain("+1 More");
    setCalendar("read_failed")();
    await loadToday(bridge);
    expect(renderToString(<TodayPage bridge={bridge} />)).toContain("Couldn&#x27;t read today&#x27;s calendar.");
  });
  it("keeps the Today section heading in not-asked and no-calls states", async () => {
    await open();
    Object.assign(fake.world.today, { today: [], live_call: null });
    for (const calendar of ["not_asked", "granted"]) {
      setCalendar(calendar)();
      await loadToday(bridge);
      expect(renderToString(<TodayPage bridge={bridge} />)).toContain('<h2 class="td-h">Today</h2>');
    }
  });
  it("sends Open System Settings, Record and show-call with the core's arguments", async () => {
    await open();
    const out = seen();
    await openCalendarSettings(bridge);
    await record(bridge);
    await showCall(bridge);
    expect(out).toContainEqual(["open_external", { target: { type: "system_settings", permission: "calendar" } }]);
    expect(out).toContainEqual(["capture_start", { source: "today", sensitive: false }]);
    expect(out.map((c) => c[0])).toContain("window_show_call");
  });
  it("draws Record in the toolbar (TD-R1)", async () => {
    await open();
    await loadToday(bridge);
    const base = { actions: [], hasSearch: false, narrow: false, canBack: false, canForward: false, showToggle: false, search: "", searchOpen: false, title: "", onBack() {}, onForward() {}, onToggleSidebar() {}, onSearch() {}, onRunSearch() {}, onOpenSearch() {} };
    const html = renderToString(<TodayToolbar route={{ section: "today", key: "root" }} bridge={bridge} base={base} inspectorOpen={false} onToggleInspector={() => {}} />);
    expect(html).toContain('data-region="TD-R1"');
    expect(html).toMatch(/Record|Recording/);
    expect(clockOf(754)).toBe("12:34");
    expect(clockOf(754.9)).toBe("12:34");
  });
  it("says why a refused Record was refused", async () => {
    await open();
    await loadToday(bridge);
    fake.failNext("capture_start", "disk_full");
    await record(bridge);
    const base = { actions: [], hasSearch: false, narrow: false, canBack: false, canForward: false, showToggle: false, search: "", searchOpen: false, title: "", onBack() {}, onForward() {}, onToggleSidebar() {}, onSearch() {}, onRunSearch() {}, onOpenSearch() {} };
    const html = renderToString(<TodayToolbar route={{ section: "today", key: "root" }} bridge={bridge} base={base} inspectorOpen={false} onToggleInspector={() => {}} />);
    expect(html).toContain("less than 500 MB");
  });
});

describe("call cards (cpt-noter-component-ui-upcoming-call-card)", () => {
  it("hides collapsed metadata and gives week cards one weekday/count summary", async () => {
    await open();
    const event = { ...fake.world.today.today[0]!, platform: "Microsoft Teams", sensitive: true, open_count: 2 };
    const card = { variant: "this-week" as const, event, live: null };
    const html = renderToString(<UpcomingCallCard bridge={bridge} card={card} expanded={false} onToggle={() => {}} />);
    expect(html).not.toContain("td-card__meta");
    expect(html).not.toContain("td-card__last");
    expect(html).not.toContain("2 open items");
    expect(html).toContain(new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(event.starts_at));
    const expanded = renderToString(<UpcomingCallCard bridge={bridge} card={card} expanded onToggle={() => {}} />);
    expect(expanded).toContain("Microsoft Teams");
    expect(expanded).toContain('data-component="cpt-noter-component-ui-person-chip"');
    expect(expanded).toContain("Local only");
  });
  it("loads Call Type choices when More opens before any Call page has been visited", async () => {
    await open();
    const out = seen();
    const card = { variant: "today" as const, event: fake.world.today.today[0]!, live: null };
    const tree = rendered(UpcomingCallCard, { bridge, card, expanded: true, onToggle() {} });
    await (find(tree, (p) => p.icon === "ellipsis").props.onAction as () => Promise<void>)();
    expect(out).toContainEqual(["call_types_list", {}]);
    const Types = () => <span>{useTypes().map((type) => type.label).join(", ")}</span>;
    const html = renderToString(<Types />);
    for (const type of fake.world.call_types.call_types) expect(html).toContain(type.label);
  });
  const event = (id: string, over: Record<string, unknown> = {}) => ({ event_id: id, title: `Call ${id}`, starts_at: 1_700_000_000_000, ends_at: 1_700_003_600_000, platform: null, attendees: [{ person: null, name: "Anna", email: null }], sensitive: false, call_id: null, last_time: null, items: fake.world.items.slice(0, 2), questions: [], handed_off: [], open_count: 2, ...over });
  const put = (today: unknown[], week: unknown[] = [], live: unknown = null) => () => {
    Object.assign((fake.world as unknown as { today: object }).today, { today, this_week: week, live_call: live });
  };
  it("expands the next call and collapses the later ones, with attendees and Local only", async () => {
    await open();
    put([event("a", { last_time: { call: { id: "call_1" }, line: "Agreed the plan" } }), event("b", { sensitive: true })])();
    await loadToday(bridge);
    const html = renderToString(<TodayPage bridge={bridge} />);
    expect(html).toContain("Today · 2 calls");
    expect(html).toMatch(/data-variant="today"[^>]*data-state="expanded"/);
    expect(html).toMatch(/data-state="collapsed"/);
    expect(html).toContain("Anna");
    expect(html).toContain("Local only");
    expect(html).toContain("Last time:");
    expect(html).toContain("2 open items");
  });
  it("puts This week under its own heading and shows the live call first with Open Call Screen", async () => {
    await open();
    put([event("a")], [event("w")], { id: "call_9", title: "Planning" })();
    await loadToday(bridge);
    const html = renderToString(<TodayPage bridge={bridge} />);
    expect(html).toContain('data-region="TD-R4"');
    expect(html).toContain("This week");
    expect(html.indexOf('data-variant="unmatched"')).toBeLessThan(html.indexOf('data-variant="today"'));
    expect(html).toContain("Open Call Screen");
  });
  it("shows the unmatched recording app and elapsed time", async () => {
    await open();
    const live = { ...fake.world.calls[0]!, platform: "Microsoft Teams" };
    const html = renderToString(<UpcomingCallCard bridge={bridge} card={{ variant: "unmatched", event: null, live }} expanded onToggle={() => {}} />);
    expect(html).toContain("Microsoft Teams");
    expect(html).toContain("td-card__elapsed");
  });
  it("opens the previous call's Summary", async () => {
    await open();
    const out = seen();
    await showPreviousCall(bridge, "call_1");
    expect(out).toContainEqual(["window_navigate", { target: { type: "call_page", call_id: "call_1", tab: "summary" } }]);
  });
});

describe("item regions (TD-R5, TD-R7) and card rows", () => {
  const items = () => (fake.world as unknown as { items: Array<Record<string, unknown>> }).items;
  const today = () => (fake.world as unknown as { today: Record<string, unknown> }).today;
  it("lists the due items and Done today with their counts, and the empty lines", async () => {
    await open();
    // the fake derives both regions from the items: add one due item and one ticked today
    const date = String(today().date);
    const extra = [
      { ...items()[0]!, id: "itm_due_nocall", review: "accepted", status: "open", due: date },
      { ...items()[1]!, id: "itm_done_today", review: "accepted", status: "done", done_at: Date.parse(date) + 1000 },
    ];
    items().push(...extra);
    Object.assign(today(), { first_use: false });
    await loadToday(bridge);
    let html = renderToString(<TodayPage bridge={bridge} />);
    expect(html).toContain('data-region="TD-R5"');
    expect(html).toContain("Due this week, no call");
    expect(html).toContain("Done today · 1");
    expect(html).toContain('data-variant="compact"');
    items().splice(items().length - extra.length, extra.length);
    await loadToday(bridge);
    html = renderToString(<TodayPage bridge={bridge} />);
    expect(html).toContain("Nothing due without a call");
    expect(html).toContain("Nothing ticked today"); // an empty Done today shows its line open
  });
  it("TD-R8 links each call with suggested items or unnamed speakers to its Summary", async () => {
    await open();
    const out = seen();
    Object.assign(today(), { first_use: false });
    await loadToday(bridge);
    const html = renderToString(<TodayPage bridge={bridge} />);
    const res = await bridge.core.todayGet({});
    const waiting = res.status === "ok" ? res.data.review_calls : [];
    expect(waiting.length).toBeGreaterThan(0);
    expect(html).toContain('data-region="TD-R8"');
    waiting.forEach((c) => expect(html).toContain(c.title.replaceAll("&", "&amp;")));
    await openReview(bridge, waiting[0]!.id);
    expect(out).toContainEqual(["window_navigate", { target: { type: "call_page", call_id: waiting[0]!.id, tab: "summary" } }]);
  });
  it("TD-R8 says what waits and from how many calls, without a zero clause, and links sit in a row", async () => {
    await open();
    Object.assign(today(), { first_use: false });
    await loadToday(bridge);
    let html = renderToString(<TodayPage bridge={bridge} />);
    const region = (h: string) => h.replaceAll("<!-- -->", "").slice(h.indexOf('data-region="TD-R8"'), h.indexOf('data-region="TD-R8"') + 900);
    expect(region(html)).toMatch(/To review:.*\d+ suggested items? from \d+ calls?/);
    expect(region(html)).toContain("td-review__links");
    expect(region(html)).not.toContain("<ul");
    items().forEach((i) => { i.review = "accepted"; });
    await loadToday(bridge);
    html = renderToString(<TodayPage bridge={bridge} />);
    expect(html.replaceAll("<!-- -->", "")).not.toMatch(/\b0 suggested/);
  });
  it("TD-R6 shows each proposal as a proposal row in a card, not a bullet list", async () => {
    await open();
    Object.assign(today(), { first_use: false });
    await loadToday(bridge);
    const html = renderToString(<TodayPage bridge={bridge} />);
    const r6 = html.slice(html.indexOf('data-region="TD-R6"'), html.indexOf('data-region="TD-R7"'));
    expect(r6).toContain('data-component="cpt-noter-component-ui-proposal-row"');
    expect(r6).toContain("td-prop__why");
    expect(r6).not.toContain("<ul");
  });
  it("says what will fill the page on first use", async () => {
    await open();
    Object.assign(today(), { first_use: true });
    await loadToday(bridge);
    expect(renderToString(<TodayPage bridge={bridge} />)).toContain("Nothing open yet");
  });
  it("shows at most five rows in an expanded card, then Show N More", async () => {
    await open();
    const rows = [0, 1, 2, 3, 4, 5, 6].map((n) => ({ ...items()[0], id: `itm_${n}`, text: `Row ${n}` }));
    const ev = { event_id: "e1", title: "Sync", starts_at: 1_700_000_000_000, ends_at: 1_700_003_600_000, platform: null, attendees: [], sensitive: false, call_id: null, last_time: null, items: rows, questions: [], handed_off: [], open_count: 7 };
    Object.assign(today(), { today: [ev], this_week: [], live_call: null });
    await loadToday(bridge);
    const html = renderToString(<TodayPage bridge={bridge} />);
    expect(html).toContain("Row 4");
    expect(html).not.toContain("Row 5");
    expect(html).toContain("Show 2 More");
  });
});

it("Today row keys tick, open typed evidence, and preserve the last focused item", async () => {
  await open();
  const item = fake.world.items[0]!;
  fake.world.today.due_without_call = [item];
  await loadToday(bridge);
  const out = seen();
  const tree = rendered(TodayPage, { bridge });
  const click = vi.fn();
  const focus = vi.fn();
  const target = { matches: () => true, closest: () => null, dataset: { itemId: item.id }, querySelector: () => ({ click }), focus, contains: () => false };
  const event = (key: string) => ({ key, target, currentTarget: { querySelectorAll: () => [target] }, nativeEvent: {}, preventDefault: vi.fn() });
  const key = tree.props.onKeyDown as (e: unknown) => void;
  key(event(" "));
  expect(click).toHaveBeenCalledOnce();
  key(event("Enter"));
  expect(out).toContainEqual(["window_navigate", { target: { type: "call_page", call_id: item.spans[0]!.call_id, tab: "transcript", span: item.spans[0] } }]);
  key(event("ArrowDown"));
  expect(focus).toHaveBeenCalledOnce();
  (tree.props.onFocus as (e: unknown) => void)({ target: { closest: () => target } });
  expect(positionOf(bridge).focused).toBe(item.id);
  key({ ...event("Enter"), metaKey: true });
  key({ ...event("Enter"), target: { ...target, matches: () => false } });
  key(event("Escape"));
});
