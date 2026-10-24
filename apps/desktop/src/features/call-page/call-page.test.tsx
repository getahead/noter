// The frame's components against the real bridge and the fake core: what each draws for a loaded call, and what
// its controls send.
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { pageFor } from "../shell/pages";
import { holdExtras, holdTypes, resetCache } from "./cache";
import { CallBanners } from "./CallBanners";
import { CallInfo } from "./CallInfo";
import { CallPage } from "./CallPage";
import { CallToolbar, moreItems, REGISTERED_VIEWS } from "./CallToolbar";
import { loadCall, loadTypes } from "./actions";
import { slots } from "./slots";
import "./register";

let bridge: Bridge;
let fake: FakeCore;
let id: string;
beforeEach(resetCache);
afterEach(() => {
  slots.transcript = null;
  slots.deleteCall = null;
  return bridge.close();
});

async function ready(more: (w: FakeCore["world"]) => void = () => {}) {
  fake = new FakeCore({ window: "main" });
  more(fake.world);
  bridge = createBridge("main", fake);
  await bridge.open();
  id = fake.world.calls.find((c) => c.status === "ready")!.id;
  const res = await loadCall(bridge, id);
  if (res.status === "ok") holdExtras(id, res.data);
  const types = await loadTypes(bridge);
  if (types.status === "ok") holdTypes(types.data.call_types);
}
const route = () => ({ section: "library", key: `call:${id}:transcript` }) as const;
const sent = () => {
  const seen: Array<[string, unknown]> = [];
  const invoke = fake.invoke.bind(fake);
  fake.invoke = ((cmd: string, args: unknown) => (seen.push([cmd, args]), (invoke as (...a: unknown[]) => unknown)(cmd, args))) as typeof fake.invoke;
  return seen;
};
const settle = () => new Promise((r) => setTimeout(r));

describe("CallInfo", () => {
  it("draws the five sections and the Sensitive switch sends the wanted state", async () => {
    await ready();
    const seen = sent();
    const html = renderToString(<CallInfo bridge={bridge} callId={id} />);
    for (const h of ["Call info", "Participants", "Call", "Privacy", "Audio", "Processing"]) expect(html).toContain(h);
    const tree = rendered(CallInfo, { bridge, callId: id });
    (find(tree, (p) => p.label === "Sensitive" && typeof p.onAction === "function").props.onAction as () => void)();
    await settle();
    expect(seen).toContainEqual(["capture_set_sensitive", { call_id: id, sensitive: true }]);
  });

  it("draws nothing until the call is held", async () => {
    await ready();
    expect(renderToString(<CallInfo bridge={bridge} callId="missing" />)).toBe("");
  });
});

describe("CallToolbar", () => {
  const base = { title: "", actions: [], hasSearch: true, narrow: false, canBack: true, canForward: false, showToggle: false, search: "", searchOpen: false, onBack() {}, onForward() {}, onToggleSidebar() {}, onSearch() {}, onRunSearch() {}, onOpenSearch() {} };

  it("lists only the delivered view, with the call's title and subtitle in PC-R1", async () => {
    await ready();
    const html = renderToString(<CallToolbar route={route()} bridge={bridge} base={base} inspectorOpen onToggleInspector={() => {}} />);
    expect(html).toContain('data-region="PC-R1"');
    expect(html).toContain(fake.world.calls.find((c) => c.id === id)!.title);
    expect(html).toContain("Transcript");
    for (const later of ["Summary", "Agent Reviews", "History"]) expect(html).not.toContain(later);
    expect(html).toContain("Hide Inspector");
    expect(REGISTERED_VIEWS).toEqual(["transcript"]);
  });

  it("the inspector toggle runs the shell's toggle", async () => {
    await ready();
    let toggled = 0;
    const tree = rendered(CallToolbar, { route: route(), bridge, base, inspectorOpen: false, onToggleInspector: () => void toggled++ });
    (find(tree.props.trailing as ReactNode, (p) => p.label === "Show Inspector").props.onAction as () => void)();
    expect(toggled).toBe(1);
  });

  it("the ⋯ menu offers the M1 items, Delete Call… disabled until the dialogs host registers", async () => {
    await ready();
    const call = fake.world.calls.find((c) => c.id === id)!;
    const calls: string[] = [];
    const act = { rename: () => calls.push("rename"), type: (t: string) => calls.push(`type:${t}`), sensitive: () => calls.push("sensitive"), finder: () => calls.push("finder"), remove: null };
    const items = moreItems(call, fake.world.call_types.call_types, act);
    const labels = items.flatMap((i) => ("label" in i ? [i.label] : []));
    expect(labels).toEqual(["Rename…", "Call Type", "Mark as Sensitive", "Show in Finder", "Delete Call…"]);
    const del = items.find((i) => "label" in i && i.label === "Delete Call…") as { disabled?: boolean; kbd?: string };
    expect(del).toMatchObject({ disabled: true, kbd: "⌘⌫" });
    for (const i of items) if ("label" in i && !i.children && !i.disabled) i.onSelect?.();
    const type = items.find((i) => "label" in i && i.children) as { children: Array<{ label: string; checked?: boolean; onSelect?: () => void }> };
    type.children[0]!.onSelect?.();
    expect(calls).toEqual(["rename", "sensitive", "finder", `type:${fake.world.call_types.call_types[0]!.id}`]);
    expect(type.children.some((c) => c.checked)).toBe(call_has_type(call, type.children, fake.world.call_types.call_types));
  });

  it("a sensitive call's item reads Sensitive and is checked, and Delete Call… runs the host's alert once registered", async () => {
    await ready();
    const call = { ...fake.world.calls.find((c) => c.id === id)!, privacy: "sensitive" as const };
    let removed = 0;
    const items = moreItems(call, [], { rename() {}, type() {}, sensitive() {}, finder() {}, remove: () => void removed++ });
    expect(items.find((i) => "label" in i && i.label === "Sensitive")).toMatchObject({ checked: true });
    (items.find((i) => "label" in i && i.label === "Delete Call…") as { onSelect: () => void }).onSelect();
    expect(removed).toBe(1);
  });
});
const call_has_type = (call: { call_type: string }, children: Array<{ checked?: boolean }>, types: Array<{ id: string }>) => types.some((t, i) => t.id === call.call_type && children[i]?.checked);

describe("CallBanners", () => {
  it("offers the notification prompt after the first recorded call, and Notify Me asks for the permission", async () => {
    await ready();
    holdExtras(id, { first_recorded_call: true, audio_not_stored: false, mode_used: "cloud" });
    const html = renderToString(<CallBanners route={route()} bridge={bridge} appBanners={0} />);
    expect(html).toContain("Get a notification when a summary is ready.");
    expect(html).toContain('data-region="PC-R2"');
    const seen = sent();
    const tree = rendered(CallBanners, { route: route(), bridge, appBanners: 0 });
    (find(tree, (p) => Array.isArray(p.banners)).props.banners as Array<{ actions: Array<{ onAction: () => void }> }>)[0]!.actions[0]!.onAction();
    await settle();
    expect(seen).toContainEqual(["permission_request", { kind: "notifications" }]);
  });

  it("shows nothing when it is not the first recorded call, when an app banner is up, or before the call is read", async () => {
    await ready();
    expect(renderToString(<CallBanners route={route()} bridge={bridge} appBanners={0} />)).toBe("");
    holdExtras(id, { first_recorded_call: true, audio_not_stored: false, mode_used: "cloud" });
    expect(renderToString(<CallBanners route={route()} bridge={bridge} appBanners={1} />)).toBe("");
  });

  it("shows nothing for the call being recorded", async () => {
    await ready((w) => {
      w.app.capture.phase = "recording";
      w.app.capture.call_id = w.calls.find((c) => c.status === "ready")!.id;
    });
    holdExtras(id, { first_recorded_call: true, audio_not_stored: false, mode_used: "cloud" });
    expect(renderToString(<CallBanners route={route()} bridge={bridge} appBanners={0} />)).toBe("");
  });

  it("× closes it for this window without sending anything", async () => {
    await ready();
    holdExtras(id, { first_recorded_call: true, audio_not_stored: false, mode_used: "cloud" });
    const seen = sent();
    const tree = rendered(CallBanners, { route: route(), bridge, appBanners: 0 });
    (find(tree, (p) => typeof p.onDismiss === "function").props.onDismiss as (id: string) => void)("notify");
    expect(renderToString(<CallBanners route={route()} bridge={bridge} appBanners={0} />)).toBe("");
    expect(seen).toEqual([]);
  });
});

describe("CallPage", () => {
  it("draws the PC-R5 region with the stored transcript the live-transcript feature registered", async () => {
    await ready();
    slots.transcript = ({ callId, audioKept }) => <i data-x={`${callId}:${audioKept}`} />;
    const html = renderToString(<CallPage bridge={bridge} callId={id} />);
    expect(html).toContain('data-region="PC-R5"');
    expect(html).toContain(`data-x="${id}:true"`);
  });

  it("says the transcript appears here until it is registered", async () => {
    await ready();
    expect(renderToString(<CallPage bridge={bridge} callId={id} />)).toContain("The transcript appears here.");
  });

  it("shows the empty state when the call is gone, and the section error with Try Again for any other failure", async () => {
    await ready();
    await loadCall(bridge, "nope");
    expect(renderToString(<CallPage bridge={bridge} callId="nope" />)).toContain("This call is no longer here");
    fake.failNext("call_get", "internal");
    await loadCall(bridge, id);
    const html = renderToString(<CallPage bridge={bridge} callId={id} />);
    expect(html).toContain("Couldn’t open this call.");
    expect(html).toContain("Try Again");
  });

  it("draws nothing while the call is read, before the 300 ms skeleton", async () => {
    await ready();
    expect(renderToString(<CallPage bridge={bridge} callId="not-held-yet" />)).toBe("");
  });

  it("no audio kept: the stored transcript gets audioKept false", async () => {
    await ready((w) => w.calls.concat(w.call_details.map((d) => d.call)).forEach((c) => (c.audio_deleted = true)));
    await loadCall(bridge, id);
    slots.transcript = ({ audioKept }) => <i data-kept={String(audioKept)} />;
    expect(renderToString(<CallPage bridge={bridge} callId={id} />)).toContain('data-kept="false"');
  });
});

describe("registration with the shell", () => {
  it("the Library's call routes show the call page, with its own toolbar, banners and Call info docked by default", async () => {
    await ready();
    const page = pageFor("library", route());
    expect(page.toolbar).toBe(CallToolbar);
    expect(page.banners).toBe(CallBanners);
    expect(page.inspector).toMatchObject({ width: 280, label: "callpage.info", openByDefault: true });
    expect(page.title(route())).toBe("Call");
    expect(renderToString(<>{page.render(route(), bridge)}</>)).toContain("PC-R5");
    expect(renderToString(<>{page.inspector!.render(route(), bridge)}</>)).toContain("Call info");
    expect(pageFor("library", { section: "library", key: "root" }).toolbar).toBeUndefined();
  });
});
