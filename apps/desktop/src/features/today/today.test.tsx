import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import type { World } from "../../../tests/support/scenario";
import { allowCalendar, loadToday, openCalendarSettings, record, showCall } from "./actions";
import { holdToday } from "./cache";
import { TodayPage } from "./TodayPage";
import { TodayToolbar, clockOf } from "./TodayToolbar";

let bridge: Bridge;
let fake: FakeCore;
afterEach(async () => {
  await bridge?.close();
  holdToday(undefined);
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
    expect(renderToString(<TodayPage bridge={bridge} />)).toContain("Calendar access is off.");
    setCalendar("read_failed")();
    await loadToday(bridge);
    expect(renderToString(<TodayPage bridge={bridge} />)).toContain("Couldn’t read today’s calendar.");
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
  });
});
