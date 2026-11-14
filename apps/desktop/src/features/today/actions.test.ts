import { afterEach, expect, it, vi } from "vitest";
import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { allowCalendar, loadToday, READ_KEY } from "./actions";
import { holdToday } from "./cache";

let bridge: Bridge;
afterEach(async () => { await bridge?.close(); holdToday(undefined); });

it("coalesces simultaneous refreshes and serializes a refresh during an older failed read", async () => {
  const fake = new FakeCore({ window: "main" });
  bridge = createBridge("main", fake);
  await bridge.open();
  const read = bridge.core.todayGet.bind(bridge.core);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const spy = vi.spyOn(bridge.core, "todayGet").mockImplementationOnce(async () => {
    await blocked;
    return { status: "error", error: { code: "calendar_unavailable", message: "old read", retryable: true, detail: null } };
  }).mockImplementation(read);
  const first = loadToday(bridge);
  const sameTurn = loadToday(bridge);
  await Promise.resolve();
  expect(spy).toHaveBeenCalledTimes(1);
  const newer = loadToday(bridge);
  expect(spy).toHaveBeenCalledTimes(1);
  release();
  await Promise.all([first, sameTurn, newer]);
  expect(spy).toHaveBeenCalledTimes(2);
  expect(bridge.store.getState().commands[READ_KEY]?.state).toBe("DONE");
});

it("never requests Calendar while recording, even when an old permission button is invoked", async () => {
  const fake = new FakeCore({ window: "main" });
  bridge = createBridge("main", fake);
  await bridge.open();
  const request = vi.spyOn(bridge.core, "permissionRequest");
  await allowCalendar(bridge);
  expect(request).not.toHaveBeenCalled();
});

it("a refresh landing as a read finishes is never dropped, at any microtask offset", async () => {
  for (let depth = 0; depth <= 8; depth++) {
    const fake = new FakeCore({ window: "main" });
    bridge = createBridge("main", fake);
    await bridge.open();
    const read = bridge.core.todayGet.bind(bridge.core);
    let late: Promise<unknown> | undefined;
    const spy = vi.spyOn(bridge.core, "todayGet").mockImplementationOnce(async () => {
      const res = await read({});
      let tick: Promise<void> = Promise.resolve();
      for (let i = 0; i < depth; i++) tick = tick.then(() => undefined);
      void tick.then(() => { late = loadToday(bridge); });
      return res;
    }).mockImplementation(read);
    await loadToday(bridge);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await late;
    expect(spy, `microtask offset ${depth}`).toHaveBeenCalledTimes(2);
    await bridge.close();
  }
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
