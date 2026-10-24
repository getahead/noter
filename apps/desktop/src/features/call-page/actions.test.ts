import { afterEach, describe, expect, it } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { loadCall, rename, reportView, requestNotifications, revealFolder, setCallType, setSensitive, loadTypes } from "./actions";

let bridge: Bridge;
let fake: FakeCore;
afterEach(() => bridge.close());

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
    fake.world.calls[0]!.title = "Renamed elsewhere";
    fake.world.calls[0]!.rev += 1;
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

  it("revealFolder asks open_external to reveal the call's folder", async () => {
    const id = await ready();
    const seen = sent();
    await revealFolder(bridge, id);
    expect(seen).toContainEqual(["open_external", { target: { type: "reveal_in_finder", path: expect.stringContaining(id) } }]);
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
