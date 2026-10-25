import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../app/App";
import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import type { World } from "../../../tests/support/scenario";
import { find, rendered } from "../../ui/testing";
import { MainWindow } from "./main-window";
import { registerPage, pageFor } from "./pages";
import { Sidebar } from "./sidebar";
import { ToolbarHost } from "./toolbar";
import { BannerSlot } from "../../ui/feedback/inline-banner";
import { slots } from "../call-page/slots";

vi.mock("../../core/tauri-transport", () => ({ nativeAsk: vi.fn().mockResolvedValue(true) }));

let bridge: Bridge | null = null;
afterEach(async () => {
  await bridge?.close();
  bridge = null;
});

async function open(mutate: (w: World["app"]) => void = () => {}, label: "main" | "settings" = "main") {
  const fake = new FakeCore({ window: label });
  mutate((fake.world as unknown as World).app);
  bridge = createBridge(label, fake);
  await bridge.open();
  return renderToString(<App bridge={bridge} />);
}

describe("MainWindow (cpt-noter-component-shell-main-window)", () => {
  it("gives the call page Delete Call…: the dialogs host's alert, then calls_delete", async () => {
    slots.deleteCall = null;
    await open();
    const fake = (bridge as unknown as { core: { callsDelete: (a: unknown) => Promise<unknown> } }).core;
    const sent = vi.spyOn(fake, "callsDelete");
    // the page shows a failure, so the slot hands the outcome back
    await expect(slots.deleteCall!(bridge!, "call_backend")).resolves.toEqual({ outcome: "deleted" });
    expect(sent).toHaveBeenCalledWith({ call_ids: ["call_backend"] });
  });

  it("draws MW-R1 to MW-R3 and the frame state from the snapshot", async () => {
    const html = await open((a) => {
      a.capture.phase = "idle";
      a.setup.self_test = { type: "passed", at: 1 };
    });
    for (const region of ["MW-R1", "MW-R2", "MW-R3"]) expect(html).toContain(`data-region="${region}"`);
    expect(html).toContain('data-component="cpt-noter-component-shell-main-window"');
    expect(html).toContain('data-state="ready"');
    expect(html).toContain('data-width="medium"');
    expect(html).toContain("Today is not built yet");
    expect(html).not.toContain('data-region="MW-R5"');
    expect(html).not.toContain("np-srclist__live");
  });

  it("shows the live-call row and Recording · name in the footer while capturing", async () => {
    const html = await open((a) => {
      a.capture.phase = "recording";
      a.capture.title = "Planning: VHI 8.0";
      a.capture.recorded_ms = 1394000;
    });
    expect(html).toContain('data-state="capturing"');
    expect(html).toContain("np-srclist__live");
    expect(html).toContain("Recording · Planning");
  });

  it("fills MW-R5 with the self-test banner after a skipped self-test", async () => {
    const html = await open((a) => {
      a.capture.phase = "idle";
      a.setup.self_test = { type: "skipped" };
    });
    expect(html).toContain('data-region="MW-R5"');
    expect(html).toContain("Call detection is off until the audio self-test passes");
    expect(html).toContain("Run Audio Self-Test…");
    expect(html).toContain("Finish Setup…");
  });

  it("names the degraded modes in the footer", async () => {
    const html = await open((a) => {
      a.capture.phase = "idle";
      a.degraded.states = [{ type: "no_assistant" }] as never;
    });
    expect(html).toContain("No assistant");
    expect(html).toContain("is-warn");
  });

  it("is not mounted by the other windows, and the section-level error is an inline banner", async () => {
    expect(await open(() => {}, "settings")).not.toContain("MW-R1");
    const fake = new FakeCore({ window: "main" });
    bridge = createBridge("main", fake);
    fake.failNext("app_snapshot", "offline");
    await bridge.open();
    const html = renderToString(<App bridge={bridge} />);
    expect(html).toContain('data-component="cpt-noter-component-ui-inline-banner"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try Again");
    expect(html).not.toContain("MW-R1");
    // Try Again opens the window again
    const reopen = vi.spyOn(bridge, "open");
    const banner = find(rendered(App, { bridge }), (p) => "banner" in p);
    (banner.props.banner as { actions: Array<{ onAction: () => void }> }).actions[0]!.onAction();
    expect(reopen).toHaveBeenCalledOnce();
  });

  it("shows skeleton rows after 300 ms until the snapshot arrives, under the label Window reloaded", () => {
    bridge = createBridge("main", new FakeCore({ window: "main" }));
    bridge.store.setState({ slow: true });
    const html = renderToString(<App bridge={bridge} />);
    expect(html).toContain('aria-label="Window reloaded"');
    expect(html.match(/np-skel__row/g)).toHaveLength(5);
    expect(html).not.toContain("is not built yet");
  });

  it("shows nothing but the frame before the snapshot is applied (LOADING)", () => {
    bridge = createBridge("main", new FakeCore({ window: "main" }));
    const html = renderToString(<App bridge={bridge} />);
    expect(html).toContain('data-state="loading"');
    expect(html).toContain("MW-R2");
  });
});

describe("MainWindow controls", () => {
  it("runs each control's command through the bridge: show the call, banner actions, dismiss, Settings", async () => {
    vi.useFakeTimers();
    const fake = new FakeCore({ window: "main" });
    const app = (fake.world as unknown as World).app;
    app.setup.self_test = { type: "skipped" };
    app.banners.banners = [{ type: "update_ready", version: "1.2" }, { type: "recording_interrupted_by_quit", call: { id: "call_9", title: "Planning", started_at: 0, call_type: "x" } }] as never;
    bridge = createBridge("main", fake);
    await bridge.open();
    const acts: string[] = [];
    vi.spyOn(bridge, "act").mockImplementation((async (key: string, _cmd: string, run: () => Promise<unknown>) => (acts.push(key), void run(), { status: "ok", data: {} })) as never);
    const tree = rendered(MainWindow, { bridge });

    const side = find(tree, (_, type) => type === Sidebar).props as never as Parameters<typeof Sidebar>[0];
    side.onSelect("people");
    side.onToggle();
    side.onShowCall();
    side.onOpenPrivacy();

    const bar = find(tree, (_, type) => type === ToolbarHost).props as never as Parameters<typeof ToolbarHost>[0];
    bar.onBack();
    bar.onForward();
    bar.onToggleSidebar();
    bar.onSearch("zoom");
    bar.onRunSearch(" zoom ");
    bar.onOpenSearch();

    const slot = find(tree, (_, type) => type === BannerSlot).props as never as Parameters<typeof BannerSlot>[0];
    for (const b of slot.banners) for (const a of b.actions ?? []) a.onAction?.();
    slot.onDismiss!("update_ready");
    slot.onDismiss!("self-test"); // not a core banner: nothing to send
    await vi.runAllTimersAsync().catch(() => {}); // ⌘F focuses the field after a tick, and a DOM is not there
    vi.useRealTimers();

    expect(acts.filter((k) => k === "window_navigate")).toHaveLength(4); // Run Audio Self-Test…, Finish Setup…, Open Call, Open Privacy Settings
    expect(acts).toEqual(expect.arrayContaining(["window_show_call", "update_install", "capture_resume_interrupted", "banner_dismiss"]));
    expect(acts.filter((k) => k === "banner_dismiss")).toHaveLength(1);
  });
});

describe("MainWindow dismissals", () => {
  it("answers false when the core refused banner_dismiss, so the slot shows the banner again, and shows the failure", async () => {
    const fake = new FakeCore({ window: "main" });
    (fake.world as unknown as World).app.banners.banners = [{ type: "update_ready", version: "1.2" }] as never;
    bridge = createBridge("main", fake);
    await bridge.open();
    const slot = find(rendered(MainWindow, { bridge }), (_, type) => type === BannerSlot).props as never as Parameters<typeof BannerSlot>[0];
    fake.failNext("banner_dismiss", "offline");
    expect(await slot.onDismiss!("update_ready")).toBe(false);
    const html = renderToString(<App bridge={bridge} />);
    expect(html).toContain("Noter could not finish that action");
    expect(html).toContain("Try Again");
    expect(await slot.onDismiss!("update_ready")).toBe(true);
  });
});

describe("pages", () => {
  it("falls back to an empty state naming the section, and lets a later feature register its page", () => {
    expect(pageFor("people").title({ section: "people", key: "root" })).toBe("People");
    expect(renderToString(<>{pageFor("people").render({ section: "people", key: "root" })}</>)).toContain("People is not built yet");
    registerPage("people", { title: () => "People!", render: () => <p>real</p> });
    expect(pageFor("people").title({ section: "people", key: "root" })).toBe("People!");
  });
});
