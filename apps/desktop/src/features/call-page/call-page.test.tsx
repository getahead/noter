// The frame's components against the real bridge and the fake core: what each draws for a loaded call, and what
// its controls send.
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { CallOutputs } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { pageFor } from "../shell/pages";
import { holdDeleteError, holdExtras, holdTypes, resetCache } from "./cache";
import { holdOutputs, resetOutputsCache } from "./outputs-cache";
import { CallBanners } from "./CallBanners";
import { CallInfo } from "./CallInfo";
import { CallPage } from "./CallPage";
import { CallToolbar, moreItems, nativeItemReviewMenuState, runNativeReviewMenuAction, watchNativeMenuContext } from "./CallToolbar";
import { registeredViews } from "./views";
import { loadCall, loadTypes } from "./actions";
import { loadItems } from "../items/actions";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { deleteAudio } from "./share-actions";
import { slots } from "./slots";
import { StoredTranscript } from "../transcript/hosts";
import "./register";

vi.mock("../../core/native-menu", () => ({ updateNativeMenuContext: vi.fn() }));
import { updateNativeMenuContext } from "../../core/native-menu";

let bridge: Bridge;
let fake: FakeCore;
let id: string;
beforeEach(() => (resetCache(), resetOutputsCache()));
afterEach(() => {
  slots.deleteCall = null;
  vi.unstubAllGlobals();
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

  it("the Type pop-up lists the core's types and sends call_update with the one chosen", async () => {
    await ready();
    const seen = sent();
    const call = bridge.store.getState().entities.call[id]!;
    const pick = fake.world.call_types.call_types.find((x) => x.id !== call.call_type)!;
    const popup = find(rendered(CallInfo, { bridge, callId: id }), (p) => p.label === "Type" && Array.isArray(p.options));
    expect(popup.props).toMatchObject({ value: call.call_type, options: fake.world.call_types.call_types.map((x) => ({ value: x.id, label: x.label })) });
    (popup.props.onAction as (v: string) => void)(pick.id);
    await settle();
    expect(seen).toContainEqual(["call_update", { call_id: id, rev: call.rev, call_type: pick.id }]);
  });

  it("draws nothing until the call is held", async () => {
    await ready();
    expect(renderToString(<CallInfo bridge={bridge} callId="missing" />)).toBe("");
  });
});

describe("CallToolbar", () => {
  const base = { title: "", actions: [], hasSearch: true, narrow: false, canBack: true, canForward: false, showToggle: false, search: "", searchOpen: false, onBack() {}, onForward() {}, onToggleSidebar() {}, onSearch() {}, onRunSearch() {}, onOpenSearch() {} };

  it("lists only the delivered views, with the call's title and subtitle in PC-R1", async () => {
    await ready();
    const html = renderToString(<CallToolbar route={route()} bridge={bridge} base={base} inspectorOpen onToggleInspector={() => {}} />);
    expect(html).toContain('data-region="PC-R1"');
    expect(html).toContain(fake.world.calls.find((c) => c.id === id)!.title);
    expect(html).toContain("Transcript");
    expect(html).toContain("Summary"); // registered by register.tsx (call-page-outputs)
    for (const later of ["Agent Reviews", "History"]) expect(html).not.toContain(later);
    expect(html).toContain("Hide Inspector");
    expect(registeredViews()).toEqual(["transcript", "summary"]);
  });

  it("at Narrow width the view control is a pop-up button with the same views", async () => {
    await ready();
    const html = renderToString(<CallToolbar route={route()} bridge={bridge} base={{ ...base, narrow: true }} inspectorOpen onToggleInspector={() => {}} />);
    expect(html).toContain('data-primitive="popup-button"');
    expect(html).toContain("<option");
    expect(html).not.toContain('data-primitive="segmented-control"');
  });

  it("the page re-renders from entity:changed: a new title reaches PC-R1", async () => {
    await ready();
    const call = bridge.store.getState().entities.call[id]!;
    fake.emit("entity:changed", { type: "call", call: { ...call, title: "Renamed in the list", rev: call.rev + 1 } });
    await settle();
    expect(renderToString(<CallToolbar route={route()} bridge={bridge} base={base} inspectorOpen onToggleInspector={() => {}} />)).toContain("Renamed in the list");
  });

  it("the inspector toggle runs the shell's toggle", async () => {
    await ready();
    let toggled = 0;
    const tree = rendered(CallToolbar, { route: route(), bridge, base, inspectorOpen: false, onToggleInspector: () => void toggled++ });
    (find(tree.props.trailing as ReactNode, (p) => p.label === "Show Inspector").props.onAction as () => void)();
    expect(toggled).toBe(1);
  });

  it("enables native item review only for a focused suggested row, and Accept All only when suggestions remain", () => {
    expect(nativeItemReviewMenuState(false, true, 3)).toEqual({ acceptItemEnabled: false, rejectItemEnabled: false, acceptAllSuggestionsEnabled: false });
    expect(nativeItemReviewMenuState(true, false, 3)).toEqual({ acceptItemEnabled: false, rejectItemEnabled: false, acceptAllSuggestionsEnabled: true });
    expect(nativeItemReviewMenuState(true, true, 0)).toEqual({ acceptItemEnabled: true, rejectItemEnabled: true, acceptAllSuggestionsEnabled: false });
  });

  it("routes native menu Accept/Reject to the focused suggested item and Accept All to every kind in that call", async () => {
    await ready();
    const selected = fake.world.items.find((item) => item.id === "itm_replay")!;
    const selectedRev = selected.rev;
    bridge.store.setState((s) => ({ ...s, entities: { ...s.entities, item: { ...s.entities.item, [selected.id]: selected } } }));
    const row = { dataset: { callId: selected.call.id, itemId: selected.id, review: "suggested" } };
    vi.stubGlobal("document", { activeElement: { closest: () => row }, querySelectorAll: () => [] });
    const reviewCall = vi.spyOn(bridge.core, "itemReview");
    expect(runNativeReviewMenuAction("menu.accept_item", bridge, selected.call.id, 1)).toBe(true);
    await settle();
    expect(reviewCall).toHaveBeenCalledTimes(1);
    expect(reviewCall).toHaveBeenCalledWith({ item_id: selected.id, rev: selectedRev, decision: "accept" });
    expect(runNativeReviewMenuAction("menu.reject_item", bridge, selected.call.id, 1)).toBe(false);
    expect(runNativeReviewMenuAction("menu.accept_all_suggestions", bridge, selected.call.id, 0)).toBe(false);

    const batchCall = vi.spyOn(bridge.core, "itemsReviewAll");
    expect(runNativeReviewMenuAction("menu.accept_all_suggestions", bridge, selected.call.id, 2)).toBe(true);
    await settle();
    expect(batchCall).toHaveBeenCalledTimes(1);
    expect(batchCall).toHaveBeenCalledWith({ call_id: selected.call.id, kinds: [] });
  });

  it("keeps native context commands enabled only for a focused, ready call page and clears them on cleanup", async () => {
    await ready();
    const call = bridge.store.getState().entities.call[id]!;
    const browserWindow = new EventTarget();
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("document", { hasFocus: () => true });
    const send = vi.mocked(updateNativeMenuContext);
    send.mockClear();

    const stop = watchNativeMenuContext(call, { status: "writing", sensitive: false } as CallOutputs);
    expect(send).toHaveBeenLastCalledWith({ focused: true, exportEnabled: true, copySlackEnabled: false, copyJiraEnabled: false, copyMarkdownEnabled: false, deleteEnabled: true, acceptItemEnabled: false, rejectItemEnabled: false, acceptAllSuggestionsEnabled: false });
    browserWindow.dispatchEvent(new Event("blur"));
    expect(send).toHaveBeenLastCalledWith({ focused: false, exportEnabled: true, copySlackEnabled: false, copyJiraEnabled: false, copyMarkdownEnabled: false, deleteEnabled: true, acceptItemEnabled: false, rejectItemEnabled: false, acceptAllSuggestionsEnabled: false });
    browserWindow.dispatchEvent(new Event("focus"));
    stop();
    const callsAfterCleanup = send.mock.calls.length;
    browserWindow.dispatchEvent(new Event("blur"));
    expect(send).toHaveBeenCalledWith({ focused: false, exportEnabled: false, copySlackEnabled: false, copyJiraEnabled: false, copyMarkdownEnabled: false, deleteEnabled: false, acceptItemEnabled: false, rejectItemEnabled: false, acceptAllSuggestionsEnabled: false });
    expect(send).toHaveBeenCalledTimes(callsAfterCleanup);
  });

  it("disables native item review when the focused row enters edit or save state", async () => {
    await ready();
    const call = bridge.store.getState().entities.call[id]!;
    const source = fake.world.items.find((candidate) => candidate.review === "suggested")!;
    const item = { ...source, call: { ...source.call, id } };
    bridge.store.setState((s) => ({ ...s, entities: { ...s.entities, item: { ...s.entities.item, [item.id]: item } } }));
    const row = { dataset: { callId: id, itemId: item.id, review: "suggested", state: "suggested" } };
    let mutation: MutationCallback | undefined;
    let options: MutationObserverInit | undefined;
    class TestObserver {
      constructor(callback: MutationCallback) { mutation = callback; }
      observe(_target: Node, next: MutationObserverInit) { options = next; }
      disconnect() {}
    }
    vi.stubGlobal("MutationObserver", TestObserver);
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", { body: {}, activeElement: { closest: () => row }, querySelectorAll: () => [row] });
    const send = vi.mocked(updateNativeMenuContext);
    send.mockClear();

    const stop = watchNativeMenuContext(call, { status: "ready", sensitive: false, review_waiting: 1 } as CallOutputs, bridge);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ acceptItemEnabled: true, rejectItemEnabled: true }));
    expect(options?.attributeFilter).toContain("data-state");
    row.dataset.state = "editing";
    mutation?.([], {} as MutationObserver);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ acceptItemEnabled: false, rejectItemEnabled: false }));
    stop();
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
    const selectedType = fake.world.call_types.call_types.find((candidate) => candidate.id === call.call_type)!;
    expect(type.children.filter((child) => child.checked).map((child) => child.label)).toEqual([selectedType.label]);
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

describe("CallBanners", () => {
  it("offers the notification prompt after the first recorded call, and Notify Me asks for the permission", async () => {
    await ready();
    holdExtras(id, { first_recorded_call: true, audio_not_stored: false, mode_used: "cloud", folder: "/calls/x" });
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
    holdExtras(id, { first_recorded_call: true, audio_not_stored: false, mode_used: "cloud", folder: "/calls/x" });
    expect(renderToString(<CallBanners route={route()} bridge={bridge} appBanners={1} />)).toBe("");
  });

  it("shows nothing once macOS reports the permission answered, even on the first recorded call", async () => {
    for (const answer of ["authorized", "denied"] as const) {
      await ready((w) => (w.app.environment.notifications = answer));
      holdExtras(id, { first_recorded_call: true, audio_not_stored: false, mode_used: "cloud", folder: "/calls/x" });
      expect(renderToString(<CallBanners route={route()} bridge={bridge} appBanners={0} />)).toBe("");
    }
  });

  it("shows nothing for the call being recorded", async () => {
    await ready((w) => {
      w.app.capture.phase = "recording";
      w.app.capture.call_id = w.calls.find((c) => c.status === "ready")!.id;
    });
    holdExtras(id, { first_recorded_call: true, audio_not_stored: false, mode_used: "cloud", folder: "/calls/x" });
    expect(renderToString(<CallBanners route={route()} bridge={bridge} appBanners={0} />)).toBe("");
  });

  it("shows a failed audio deletion with a retry action", async () => {
    await ready();
    fake.failNext("audio_delete", "internal");
    const seen = sent();
    expect(await deleteAudio(bridge, id, async () => true)).toBe("failed");

    const tree = rendered(CallBanners, { route: route(), bridge, appBanners: 0 });
    expect(renderToString(<CallBanners route={route()} bridge={bridge} appBanners={0} />)).toContain("Couldn&#x27;t delete the audio. Try again.");
    const banner = find(tree, (p) => Array.isArray(p.banners)).props.banners as Array<{ actions: Array<{ onAction: () => void }> }>;
    banner[0]!.actions[0]!.onAction();
    await settle();
    expect(seen.filter(([cmd]) => cmd === "audio_delete")).toHaveLength(2);
  });

  it("× closes it for this window without sending anything", async () => {
    await ready();
    holdExtras(id, { first_recorded_call: true, audio_not_stored: false, mode_used: "cloud", folder: "/calls/x" });
    const seen = sent();
    const tree = rendered(CallBanners, { route: route(), bridge, appBanners: 0 });
    (find(tree, (p) => typeof p.onDismiss === "function").props.onDismiss as (id: string) => void)("notify");
    expect(renderToString(<CallBanners route={route()} bridge={bridge} appBanners={0} />)).toBe("");
    expect(seen).toEqual([]);
  });

  // cpt-noter-seq-call-page-review-suggested-items: no review banner until the outputs are written (#1038)
  it("offers the review only once the outputs are written, never before they start", async () => {
    await ready((w) => {
      const callId = w.calls.find((c) => c.status === "ready")!.id;
      const item = w.items.find((i) => i.call.id === callId) ?? w.items[0];
      w.items.push({ ...item, id: "itm_1038", call: { ...item.call, id: callId }, review: "suggested" });
    });
    await loadItems(bridge, id);
    await settle();
    const summaryRoute = { section: "library", key: `call:${id}:summary` } as const;
    const ids = () => (find(rendered(CallBanners, { route: summaryRoute, bridge, appBanners: 0 }), (p) => Array.isArray(p.banners)).props.banners as Array<{ id: string }>).map((b) => b.id);
    const outputs = (status: CallOutputs["status"]) => holdOutputs({ call_id: id, status, sections: [], archive: "not_started", review_waiting: 1, sensitive: false, written_locally: false } as CallOutputs);
    outputs("ready");
    expect(ids()).toContain("review");
    outputs("not_started");
    expect(renderToString(<CallBanners route={summaryRoute} bridge={bridge} appBanners={0} />)).not.toContain("to review before sharing");
  });

  it("does not hide the notification offer when another banner closes", async () => {
    await ready();
    holdExtras(id, { first_recorded_call: true, audio_not_stored: false, mode_used: "cloud", folder: "/calls/x" });
    holdOutputs({ call_id: id, status: "writing", sections: [], archive: "not_started", review_waiting: 0, sensitive: false, written_locally: false } as CallOutputs);
    const summaryRoute = { section: "library", key: `call:${id}:summary` } as const;
    const tree = rendered(CallBanners, { route: summaryRoute, bridge, appBanners: 0 });
    expect((find(tree, (p) => Array.isArray(p.banners)).props.banners as Array<{ id: string }>).some((b) => b.id === "writing")).toBe(true);

    (find(tree, (p) => typeof p.onDismiss === "function").props.onDismiss as (id: string) => void)("writing");

    const after = rendered(CallBanners, { route: summaryRoute, bridge, appBanners: 0 });
    expect((find(after, (p) => Array.isArray(p.banners)).props.banners as Array<{ id: string }>).some((b) => b.id === "notify")).toBe(true);
  });
});

describe("CallPage", () => {
  it("draws PC-R5 with the header (Transcript, language tags, audio meta) and the stored transcript under it", async () => {
    await ready();
    const tree = rendered(CallPage, { bridge, callId: id });
    const stored = find(tree, (_p, type) => type === StoredTranscript);
    expect(stored.props).toMatchObject({ callId: id, detail: { call: { id, audio_deleted: false }, audio_not_stored: false }, header: null });
    const html = renderToString(<CallPage bridge={bridge} callId={id} />);
    expect(html).toContain('data-region="PC-R5"');
    expect(html).toMatch(/<span class="t-headline">Transcript<\/span><span data-component="cpt-noter-component-ui-language-tag" data-variant="call"/);
    expect(html).toMatch(/class="np-dim">\d+ min · audio kept until /);
    expect(html).not.toContain("The transcript appears here.");
  });

  it("the header says the audio was deleted, or never stored", async () => {
    await ready((w) => w.calls.concat(w.call_details.map((d) => d.call)).forEach((c) => (c.audio_deleted = true)));
    await loadCall(bridge, id);
    expect(renderToString(<CallPage bridge={bridge} callId={id} />)).toContain('class="np-dim">Audio deleted · transcript kept</span>');
    holdExtras(id, { first_recorded_call: false, audio_not_stored: true, mode_used: "cloud", folder: "/calls/x" });
    expect(renderToString(<CallPage bridge={bridge} callId={id} />)).toContain('class="np-dim">Audio not stored for this call</span>');
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

  it("a failed delete shows the section error above the transcript: Try Again deletes again when retryable, × closes it", async () => {
    await ready();
    const asked: string[] = [];
    slots.deleteCall = async (_b, callId) => (asked.push(callId), { outcome: "cancelled" });
    holdDeleteError(id, { code: "internal", message: "x", retryable: true, detail: null });
    const error = find(rendered(CallPage, { bridge, callId: id }), (_p, type) => type === InlineBanner);
    const b = error.props.banner as { severity: string; text: string; actions: { label: string; onAction: () => void }[] };
    expect(b).toMatchObject({ severity: "error", text: "Couldn’t delete this call.", actions: [{ label: "Try Again" }] });
    b.actions[0]!.onAction();
    expect(asked).toEqual([id]);
    holdDeleteError(id, { code: "already_recording", message: "x", retryable: false, detail: null });
    const live = find(rendered(CallPage, { bridge, callId: id }), (_p, type) => type === InlineBanner);
    expect(live.props.banner).toMatchObject({ text: "This call is still recording. Stop the recording first.", actions: [] });
    (live.props.onDismiss as () => void)();
    expect(renderToString(<CallPage bridge={bridge} callId={id} />)).not.toContain('role="alert"');
  });

  it("draws nothing while the call is read, before the 300 ms skeleton", async () => {
    await ready();
    expect(renderToString(<CallPage bridge={bridge} callId="not-held-yet" />)).toBe("");
  });

  it("no audio kept: the stored transcript gets the call the page read, so it draws no play controls and asks nothing", async () => {
    await ready((w) => w.calls.concat(w.call_details.map((d) => d.call)).forEach((c) => (c.audio_deleted = true)));
    await loadCall(bridge, id);
    expect(find(rendered(CallPage, { bridge, callId: id }), (_p, type) => type === StoredTranscript).props.detail).toMatchObject({ call: { audio_deleted: true } });
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
