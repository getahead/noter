import { afterEach, describe, expect, it } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { deleteCall, loadCall, loadTypes, menuActs, pageKey, openCallPage, openPrivacySettings, readCall, rename, reportView, requestNotifications, revealFolder, saveTitle, setCallType, setSensitive } from "./actions";
import { deleteErrorOf, holdExtras, resetCache, useExtras } from "./cache";
import { slots } from "./slots";

let bridge: Bridge;
let fake: FakeCore;
afterEach(() => {
  slots.deleteCall = null;
  resetCache();
  return bridge.close();
});

async function ready(seed?: (w: FakeCore["world"]) => void) {
  fake = new FakeCore({ window: "main" });
  seed?.(fake.world);
  bridge = createBridge("main", fake);
  await bridge.open();
  return fake.world.calls[0]!.id;
}
const sent = () => {
  const seen: Array<[string, unknown]> = [];
  const invoke = fake.invoke.bind(fake);
  fake.invoke = ((cmd: string, args: unknown) => (seen.push([cmd, args]), (invoke as (...a: unknown[]) => unknown)(cmd, args))) as typeof fake.invoke;
  return seen;
};

describe("call page commands", () => {
  it("loadCall reads call_get and keeps the call in the store", async () => {
    const id = await ready();
    const seen = sent();
    const res = await loadCall(bridge, id);
    expect(res.status).toBe("ok");
    expect(seen).toContainEqual(["call_get", { call_id: id }]);
    expect(bridge.store.getState().entities.call[id]).toBeDefined();
  });

  it("loadCall of a missing call ends in the not_found error state", async () => {
    await ready();
    await loadCall(bridge, "nope");
    expect(bridge.store.getState().commands["call:get:nope"]).toMatchObject({ state: "ERROR", error: { code: "not_found" } });
  });

  it("rename sends the title with the call's rev", async () => {
    const id = await ready();
    const rev = fake.world.calls[0]!.rev;
    const seen = sent();
    await rename(bridge, id, rev, "Backend sync, retro");
    expect(seen).toContainEqual(["call_update", { call_id: id, rev, title: "Backend sync, retro" }]);
    expect(bridge.store.getState().entities.call[id]!.title).toBe("Backend sync, retro");
  });

  it("a conflicting rename leaves the core's current values in the store", async () => {
    const id = await ready();
    const rev = fake.world.calls[0]!.rev;
    for (const c of [fake.world.calls[0]!, ...fake.world.call_details.filter((d) => d.call.id === id).map((d) => d.call)]) Object.assign(c, { title: "Renamed elsewhere", rev: rev + 1 });
    const res = await rename(bridge, id, rev, "Mine");
    expect(res.status).toBe("error");
    await loadCall(bridge, id);
    expect(bridge.store.getState().entities.call[id]!.title).toBe("Renamed elsewhere");
  });

  it("setCallType sends call_type with the rev, loadTypes asks the core for the types", async () => {
    const id = await ready();
    const seen = sent();
    const types = await loadTypes(bridge);
    expect(types.status).toBe("ok");
    const type = fake.world.call_types.call_types[0]!.id;
    await setCallType(bridge, id, fake.world.calls[0]!.rev, type);
    expect(seen.map((s) => s[0])).toEqual(["call_types_list", "call_update"]);
    expect(seen[1]![1]).toMatchObject({ call_id: id, call_type: type });
  });

  it("setSensitive sends the wanted state, never a toggle", async () => {
    const id = await ready();
    const seen = sent();
    await setSensitive(bridge, id, true);
    await setSensitive(bridge, id, false);
    expect(seen.filter((s) => s[0] === "capture_set_sensitive").map((s) => s[1])).toEqual([
      { call_id: id, sensitive: true },
      { call_id: id, sensitive: false },
    ]);
  });

  it("revealFolder asks open_external to reveal the folder call_get gave, and sends nothing before it is known", async () => {
    const id = await ready();
    const seen = sent();
    await revealFolder(bridge, id);
    expect(seen).toEqual([]);
    const r = await readCall(bridge, id);
    await revealFolder(bridge, id);
    expect(seen).toContainEqual(["open_external", { target: { type: "reveal_in_finder", path: r.status === "ok" ? r.data.folder : "?" } }]);
  });

  it("requestNotifications asks for the notifications permission", async () => {
    await ready();
    const seen = sent();
    await requestNotifications(bridge);
    expect(seen).toContainEqual(["permission_request", { kind: "notifications" }]);
  });

  it("reportView names the shown call, and null when the page closes", async () => {
    const id = await ready();
    const seen = sent();
    await reportView(bridge, id);
    await reportView(bridge, null);
    expect(seen.filter((s) => s[0] === "window_report_view").map((s) => s[1])).toEqual([{ call_id: id }, { call_id: null }]);
  });
});

describe("opening the page and its controls", () => {
  const settle = () => new Promise((r) => setTimeout(r));

  it("openCallPage reads the call and the call types once each", async () => {
    const id = await ready();
    const seen = sent();
    const [call, types] = await openCallPage(bridge, id);
    expect([call.status, types.status]).toEqual(["ok", "ok"]);
    expect(seen.map((s) => s[0]).sort()).toEqual(["call_get", "call_types_list"]);
  });

  it("readCall keeps what the call row does not hold (first recorded call) for the banner", async () => {
    const id = await ready();
    const detail = fake.world.call_details.find((d) => d.call.id === id);
    if (detail) detail.first_recorded_call = true;
    await readCall(bridge, id);
    let held: unknown;
    const { renderToString } = await import("react-dom/server");
    const Probe = () => ((held = useExtras(id)), null);
    renderToString(<Probe />);
    expect(held).toMatchObject({ first_recorded_call: !!detail });
    holdExtras(id, { first_recorded_call: true, audio_not_stored: false, mode_used: "cloud", folder: "/calls/x" });
  });

  it("saveTitle saves a changed title, ignores an empty or unchanged one and reads the call again after a refusal", async () => {
    const id = await ready();
    const call = fake.world.calls.find((c) => c.id === id)!;
    const seen = sent();
    await saveTitle(bridge, call, "  ");
    await saveTitle(bridge, call, call.title);
    expect(seen).toEqual([]);
    await saveTitle(bridge, call, "A new title");
    expect(seen.map((s) => s[0])).toEqual(["call_update"]);
    await saveTitle(bridge, { ...call, rev: 1 }, "Stale rev");
    expect(seen.map((s) => s[0]).filter((c) => c !== "log_ui")).toEqual(["call_update", "call_update", "call_get"]);
  });

  it("the Mode indicator opens Settings › Privacy", async () => {
    await ready();
    const seen = sent();
    await openPrivacySettings(bridge);
    expect(seen).toContainEqual(["window_navigate", { target: { type: "settings", pane: "privacy" } }]);
  });

  it("menuActs sends each item's command and has no Delete Call… until the dialogs host registers", async () => {
    const id = await ready();
    const call = { id, rev: fake.world.calls.find((c) => c.id === id)!.rev, privacy: "normal" as const };
    await readCall(bridge, id);
    const seen = sent();
    let renamed = 0;
    const acts = menuActs(bridge, call, () => void renamed++);
    acts.rename();
    acts.type(fake.world.call_types.call_types[0]!.id);
    acts.sensitive();
    acts.finder();
    await settle();
    expect(renamed).toBe(1);
    expect(seen.map((s) => s[0])).toEqual(["call_update", "capture_set_sensitive", "open_external"]);
    expect(seen[1]![1]).toEqual({ call_id: id, sensitive: true });
    expect(acts.remove).toBeNull();
    const asked: string[] = [];
    slots.deleteCall = async (_b, callId) => (asked.push(callId), { outcome: "cancelled" });
    menuActs(bridge, call, () => {}).remove?.();
    expect(asked).toEqual([id]);
  });

  it("a failed delete stays on the page as its error until the next try, which clears it first", async () => {
    await ready();
    const id = fake.world.calls[0]!.id;
    const error = { code: "internal", message: "x", retryable: true, detail: null } as const;
    let next: Awaited<ReturnType<NonNullable<typeof slots.deleteCall>>> = { outcome: "failed", error };
    const seen: unknown[] = [];
    slots.deleteCall = async () => (seen.push(deleteErrorOf(id)), next);
    await deleteCall(bridge, id);
    expect(deleteErrorOf(id)).toEqual(error);
    next = { outcome: "deleted" };
    await deleteCall(bridge, id);
    expect(seen).toEqual([undefined, undefined]);
    expect(deleteErrorOf(id)).toBeUndefined();
  });

  it("⌘⌫ deletes the call, but not while a text field has the key, nor with another modifier or a repeat", async () => {
    await ready();
    const asked: string[] = [];
    slots.deleteCall = async (_b, callId) => (asked.push(callId), { outcome: "cancelled" });
    let prevented = 0;
    const c1 = fake.world.calls[0]!.id;
    await readCall(bridge, c1);
    pageKey(bridge, "not-read", { code: "Backspace", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, target: null, preventDefault: () => {}, stopPropagation: () => {} });
    const key = (more: Partial<KeyboardEvent> & { target?: unknown } = {}) =>
      pageKey(bridge, c1, { code: "Backspace", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, target: null, preventDefault: () => void prevented++, ...more } as never);
    key({ target: { tagName: "INPUT", type: "text" } as unknown as EventTarget });
    key({ shiftKey: true });
    key({ repeat: true });
    key({ code: "Delete" });
    key({ metaKey: false });
    expect(asked).toEqual([]);
    key();
    expect(asked).toEqual([c1]);
    expect(prevented).toBe(1);
    slots.deleteCall = null;
    key();
    expect(prevented).toBe(1);
  });
});
