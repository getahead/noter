import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { Settings } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { loadHotkeys, loadSettings, saveSection, setHotkey, resetHotkeys, unignoreKey } from "./actions";
import { AudioPane } from "./AudioPane";
import { CallScreenPane } from "./CallScreenPane";
import { GeneralPane } from "./GeneralPane";
import { HotkeysPane } from "./HotkeysPane";
import { PerformancePane } from "./PerformancePane";
import { PrivacyPane } from "./PrivacyPane";
import { SettingsWindow } from "./SettingsWindow";
import { UpdatesPane } from "./UpdatesPane";

let bridge: Bridge;
let fake: FakeCore;
afterEach(() => bridge.close());

async function ready(seed?: (w: FakeCore["world"]) => void): Promise<Settings> {
  fake = new FakeCore({ window: "settings" });
  seed?.(fake.world);
  bridge = createBridge("settings", fake);
  await bridge.open();
  await loadSettings(bridge);
  return bridge.store.getState().whole.settings!;
}
const props = async () => ({ bridge: (await ready(), bridge), settings: bridge.store.getState().whole.settings! });
/** The control a pane renders with this label (a row carries the label too, so it must have a handler). */
const control = (tree: ReturnType<typeof rendered>, label: string) => find(tree, (pr) => (pr.label === label || pr.ariaLabel === label) && typeof pr.onAction === "function").props.onAction as (v?: unknown) => void;
const stored = () => bridge.store.getState().whole.settings!;

describe("SettingsWindow", () => {
  it("lists the 11 panes in DESIGN's order with a search field and opens General", async () => {
    await ready();
    const html = renderToString(<SettingsWindow bridge={bridge} />);
    expect(html).toContain('aria-label="Settings panes"');
    expect(html).toContain('data-state="pane"');
    const names = [...html.matchAll(/role="listitem"[^>]*>.*?<span>(.*?)<\/span>/g)].map((m) => m[1]);
    expect(names).toEqual(["General", "Audio &amp; Transcription", "Models &amp; Runtimes", "Privacy", "Call Screen &amp; Menu Bar", "Hotkeys", "Repositories", "Knowledge Sources", "Maintenance", "Performance", "Updates"]);
    expect(html).toContain('data-region="ST-R2"');
    expect(html).toContain("Launch at login");
  });

  it("renders nothing in the pane until the settings arrive", async () => {
    fake = new FakeCore({ window: "settings" });
    bridge = createBridge("settings", fake);
    await bridge.open();
    expect(renderToString(<SettingsWindow bridge={bridge} />)).not.toContain("Launch at login");
  });
});

describe("saveSection", () => {
  it("sends the whole section with the latest rev and shows the stored value", async () => {
    const before = await ready();
    await saveSection(bridge, "general", { launch_at_login: !before.general.launch_at_login });
    expect(stored().general.launch_at_login).toBe(!before.general.launch_at_login);
    expect(stored().rev).toBe(before.rev + 1);
  });

  it("keeps the stored value and marks the section when the core refuses", async () => {
    const before = await ready();
    fake.failNext("settings_update", "conflict");
    await saveSection(bridge, "general", { launch_at_login: !before.general.launch_at_login });
    expect(stored().general.launch_at_login).toBe(before.general.launch_at_login);
    expect(bridge.store.getState().commands["settings:general"]?.state).toBe("ERROR");
  });

  it("does nothing before settings_get answered", async () => {
    fake = new FakeCore({ window: "settings" });
    bridge = createBridge("settings", fake);
    expect(await saveSection(bridge, "general", { launch_at_login: true })).toBeNull();
  });
});

describe("hotkey actions", () => {
  it("lists, sets, refuses with the core's owner line, and restores defaults", async () => {
    await ready();
    await loadHotkeys(bridge);
    expect(bridge.store.getState().whole.hotkeys?.bindings.length).toBeGreaterThan(0);
    expect(await setHotkey(bridge, "catch_me_up", "Ctrl+Alt+Super+U")).toEqual({ ok: true });
    expect(bridge.store.getState().whole.hotkeys?.bindings.find((b) => b.action === "catch_me_up")?.shortcut).toBe("Ctrl+Alt+Super+U");
    fake.failNext("hotkey_set", "hotkey_reserved", { type: "hotkey_owner", owner: "VoiceOver" });
    expect(await setHotkey(bridge, "mark_moment", "Ctrl+Alt+Super+H")).toEqual({ ok: false, message: "Used by VoiceOver" });
    fake.failNext("hotkey_set", "offline");
    expect(await setHotkey(bridge, "mark_moment", "Ctrl+Alt+Super+H")).toMatchObject({ ok: false });
    await resetHotkeys(bridge);
    expect(bridge.store.getState().whole.hotkeys?.bindings.find((b) => b.action === "catch_me_up")?.shortcut).toBe("Ctrl+Alt+Super+C");
  });

  it("names the control key of Remove", () => expect(unignoreKey("com.apple.Safari")).toBe("unignore:com.apple.Safari"));
});

describe("panes", () => {
  it("General: a toggle saves the section and the ignored app can be removed", async () => {
    const p = await ready((w) => (w.settings.general.ignored_apps = [{ bundle_id: "com.apple.Safari", app_name: "Safari" }]));
    const tree = rendered(GeneralPane, { bridge, settings: stored() });
    control(tree, "Launch at login")(!p.general.launch_at_login);
    await new Promise((r) => setTimeout(r));
    expect(stored().general.launch_at_login).toBe(!p.general.launch_at_login);
    expect(renderToString(<GeneralPane bridge={bridge} settings={stored()} />)).toContain("Safari");
    control(tree, "Remove")();
    await new Promise((r) => setTimeout(r));
    expect(stored().general.ignored_apps).toEqual([]);
    expect(renderToString(<GeneralPane bridge={bridge} settings={stored()} />)).toContain("Noter offers to record calls in every app.");
  });

  it("General: offer to record is disabled with its reason until the self-test passed", async () => {
    await ready((w) => (w.app.setup.self_test = { type: "not_run" }));
    expect(renderToString(<GeneralPane bridge={bridge} settings={stored()} />)).toContain("Needs a passed audio self-test");
  });

  it("Privacy: the mode, retention line and metrics switch save through settings_update", async () => {
    await props();
    const tree = rendered(PrivacyPane, { bridge, settings: stored() });
    (find(tree, (pr) => pr.name === "st-pmode").props.onAction as (v: string) => void)("local_only");
    await new Promise((r) => setTimeout(r));
    expect(stored().privacy.mode).toBe("local_only");
    control(tree, "Audio retention")("days7");
    (find(tree, (pr) => typeof pr.ariaLabel === "string" && pr.ariaLabel.startsWith("Show talk-time")).props.onAction as (v: boolean) => void)(true);
    await new Promise((r) => setTimeout(r));
    expect(stored().audio.retention).toBe("days7");
    expect(stored().privacy.behaviour_metrics).toBe(true);
    const html = renderToString(<PrivacyPane bridge={bridge} settings={stored()} />);
    expect(html).toContain("Local only");
    expect(html).toContain("In force:");
  });

  it("Call screen and menu bar: layout, automatic opening, title and quick actions save", async () => {
    await props();
    const tree = rendered(CallScreenPane, { bridge, settings: stored() });
    control(tree, "Layout")("floating");
    control(tree, "Menu bar title")("elapsed_time");
    control(tree, "Pause or resume")(false);
    await new Promise((r) => setTimeout(r));
    expect(stored().call_screen.layout).toBe("floating");
    expect(stored().menu_bar.title).toBe("elapsed_time");
    expect(stored().menu_bar.hidden_actions).toContain("pause");
    control(tree, "Open the call screen automatically")(false);
    await new Promise((r) => setTimeout(r));
    expect(stored().call_screen.open_automatically).toBe(false);
  });

  it("Performance and Updates save their sections", async () => {
    await props();
    const perf = rendered(PerformancePane, { bridge, settings: stored() });
    control(perf, "Keep metrics for")("365");
    await new Promise((r) => setTimeout(r));
    expect(stored().performance.retention_days).toBe(365);
    expect(renderToString(<PerformancePane bridge={bridge} settings={stored()} />)).toContain("Bottleneck thresholds");
    const upd = rendered(UpdatesPane, { bridge, settings: stored() });
    control(upd, "Channel")("beta");
    (find(upd, (pr) => pr.name === "st-install").props.onAction as (v: string) => void)("ask");
    await new Promise((r) => setTimeout(r));
    expect(stored().updates.channel).toBe("beta");
    expect(stored().updates.install_automatically).toBe(false);
    expect(renderToString(<UpdatesPane bridge={bridge} settings={stored()} />)).toContain("Check Now");
  });

  it("Updates: a waiting update offers Restart Now", async () => {
    await ready((w) => (w.app.environment.update = { version: "1.2", notes_md: "", ready: true }));
    const html = renderToString(<UpdatesPane bridge={bridge} settings={stored()} />);
    expect(html).toContain("Version 1.2 installs on next launch");
    expect(html).toContain("Restart Now");
  });

  it("Audio: the current output can be marked as headphones; the backends and own sounds save", async () => {
    await ready((w) => (w.app.environment.output_device = { uid: "uid-1", name: "AirPods Pro" } as never));
    const tree = rendered(AudioPane, { bridge, settings: stored() });
    control(tree, "Treat AirPods Pro as headphones")(true);
    control(tree, "Exclude Noter’s own sounds")(false);
    control(tree, "Live transcription")("parakeet_tdt_v3");
    await new Promise((r) => setTimeout(r));
    expect(stored().audio.output.headphones_devices).toContain("uid-1");
    expect(stored().audio.exclude_own_sounds).toBe(false);
    expect(stored().audio.live_backend).toBe("parakeet_tdt_v3");
  });

  it("Hotkeys: one row per global hotkey, the card keys group and Restore Defaults", async () => {
    await props();
    await loadHotkeys(bridge);
    const html = renderToString(<HotkeysPane bridge={bridge} />);
    expect(html).toContain("Start or stop recording");
    expect(html).toContain("Card keys during calls");
    expect(html).toContain("Restore Defaults");
    const tree = rendered(HotkeysPane, { bridge });
    control(tree, "Use card keys during calls")(false);
    await new Promise((r) => setTimeout(r));
    expect(stored().copilot.card_keys.enabled).toBe(false);
    control(tree, "Dismiss with keys")(true);
    await new Promise((r) => setTimeout(r));
    expect(stored().copilot.dismiss_with_keys).toBe(true);
  });
});
