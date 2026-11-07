import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { BannerSlot, slotView, type BannerSlotProps } from "../../ui/feedback/inline-banner";
import { find, rendered } from "../../ui/testing";
import { MainWindow } from "../shell/main-window";
import { pageFor, registerPage } from "../shell/pages";
import { loadToday } from "./actions";
import { holdToday } from "./cache";
import { TodayBanners } from "./TodayBanners";

let bridge: Bridge;
const original = pageFor("today");
afterEach(async () => {
  await bridge?.close();
  holdToday(undefined);
  registerPage("today", original);
});

async function open(calendar: "denied" | "granted" = "denied", selfTestSkipped = false) {
  const fake = new FakeCore({ window: "main" });
  fake.world.today.calendar = calendar;
  fake.world.app.setup.self_test = selfTestSkipped ? { type: "skipped" } : { type: "passed", at: 1 };
  fake.world.app.banners.banners = [{ type: "update_ready", version: "1.2" }];
  bridge = createBridge("main", fake);
  await bridge.open();
  await loadToday(bridge);
  registerPage("today", { title: () => "Today", render: () => null, banners: TodayBanners });
  return fake;
}

function todaySlot(): BannerSlotProps {
  const shell = rendered(MainWindow, { bridge });
  const page = find(shell, (_props, type) => type === TodayBanners);
  const tree = rendered(TodayBanners, page.props as unknown as Parameters<typeof TodayBanners>[0]);
  return find(tree, (_props, type) => type === BannerSlot).props as unknown as BannerSlotProps;
}

describe("Today banner arbitration (cpt-noter-algo-ui-today-project)", () => {
  it("shows Calendar warning ahead of an informational app banner in one MW-R5 slot", async () => {
    await open();
    const html = renderToString(<MainWindow bridge={bridge} />);
    expect(html).toContain("Calendar access is off");
    expect(html).toContain("+1 More");
    expect(html.match(/class="np-bannerslot"/g)).toHaveLength(1);
    expect(html).toContain('data-region="MW-R5"');
    expect(html).not.toContain("Restart Now");
  });

  it("keeps Calendar in More behind errors and preserves the settings action", async () => {
    const fake = await open();
    fake.failNext("window_navigate", "internal");
    await bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "first_run" } }), { screen: "main-window-shell" });
    const slot = todaySlot();
    const view = slotView(slot.banners, new Set(), true);
    expect(view.first?.severity).toBe("error");
    expect(view.more).toBe(2);
    expect(view.list.map((b) => b.id)).toEqual(["today-denied", "update_ready"]);
    const settings = vi.spyOn(bridge.core, "openExternal");
    view.list[0]!.actions![0]!.onAction!();
    expect(settings).toHaveBeenCalledWith({ target: { type: "system_settings", permission: "calendar" } });
  });

  it("keeps existing warnings first and Calendar reachable when severities tie", async () => {
    await open("denied", true);
    const view = slotView(todaySlot().banners, new Set(), true);
    expect(view.first?.id).toBe("self-test");
    expect(view.list.map((b) => b.id)).toEqual(["today-denied", "update_ready"]);
  });

  it("removes Calendar when access changes and renders no empty banner slot", async () => {
    await open();
    expect(todaySlot().banners.map((b) => b.id)).toContain("today-denied");
    holdToday(undefined);
    expect(todaySlot().banners.map((b) => b.id)).toEqual(["update_ready"]);
    expect(renderToString(<TodayBanners route={{ section: "today", key: "root" }} bridge={bridge} appBanners={0} />)).toBe("");
  });

  it("passes dismiss commands and refused dismissals back through the combined slot", async () => {
    const fake = await open();
    const dismiss = vi.spyOn(bridge.core, "bannerDismiss");
    fake.failNext("banner_dismiss", "internal");
    await expect(todaySlot().onDismiss!("update_ready")).resolves.toBe(false);
    await expect(todaySlot().onDismiss!("update_ready")).resolves.toBe(true);
    expect(dismiss).toHaveBeenCalledWith({ banner: "update_ready" });
    expect(todaySlot().banners.find((b) => b.id === "today-denied")?.severity).toBe("warning");
  });

  it("keeps app banners when Calendar is granted and leaves other page banner slots unchanged", async () => {
    await open("granted");
    expect(todaySlot().banners.map((b) => b.id)).toEqual(["update_ready"]);
    const LegacyBanners = ({ appBanners }: { appBanners: number }) => <span>Legacy count: {appBanners}</span>;
    registerPage("today", { title: () => "Other page", render: () => null, banners: LegacyBanners });
    const html = renderToString(<MainWindow bridge={bridge} />);
    expect(html).toContain("Restart Now");
    expect(html).toContain("Legacy count: <!-- -->1");
    expect(html.match(/class="np-bannerslot"/g)).toHaveLength(1);
  });
});

it("shows failed-capture recovery ahead of Calendar and resumes the same call", async () => {
  await open();
  bridge.store.setState((s) => ({ ...s, whole: { ...s.whole, capture: { ...s.whole.capture!, phase: "failed" } } }));
  const resume = vi.spyOn(bridge.core, "captureResumeInterrupted");
  const slot = todaySlot();
  expect(slotView(slot.banners, new Set(), false).first?.id).toBe("today-engine");
  await slot.banners.find((b) => b.id === "today-engine")!.actions![0]!.onAction!();
  expect(resume).toHaveBeenCalledWith({ call_id: "call_live" });
});
