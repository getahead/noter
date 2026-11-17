import { describe, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import { currentStream, isStopKey, isStored, openThread, questionOf, settleTurn, threadOfRoute, loadPresets, loadRows, loadThread, NEW_SCOPE, startAsk, stopAsk } from "./actions";

// act runs the call and wraps its result the way the bridge does
const make = (result: unknown) => {
  const core = {
    askThreadsList: vi.fn(async () => result),
    askScopePresets: vi.fn(async () => result),
    askThreadGet: vi.fn(async () => result),
    askStop: vi.fn(async () => result),
  };
  const bridge = { core, act: (_k: string, _c: string, f: () => unknown) => f(), subscribe: vi.fn() } as unknown as Bridge;
  return { bridge, core, subscribe: bridge.subscribe as ReturnType<typeof vi.fn> };
};
const ok = (data: unknown) => ({ status: "ok", data });
const err = { status: "error", error: { code: "x" } };

describe("Ask actions (cpt-noter-flow-ui-ask-question)", () => {
  it("return the data on ok and null on an error", async () => {
    expect(await loadRows(make(ok({ threads: [1] })).bridge)).toEqual([1]);
    expect(await loadRows(make(err).bridge)).toBeNull();
    expect(await loadPresets(make(ok({ presets: [2] })).bridge)).toEqual([2]);
    expect(await loadPresets(make(err).bridge)).toBeNull();
    expect(await loadThread(make(ok({ turns: [3] })).bridge, "a")).toEqual([3]);
    expect(await loadThread(make(err).bridge, "a")).toBeNull();
  });
  it("start subscribes with the scope or all of it; stop names the turn", async () => {
    const m = make(ok({}));
    startAsk(m.bridge, null, "Q", undefined);
    expect(m.subscribe).toHaveBeenCalledWith("ask_start", { thread_id: null, question: "Q", scope: NEW_SCOPE });
    stopAsk(m.bridge, "t1");
    expect(m.core.askStop).toHaveBeenCalledWith({ turn_id: "t1" });
  });
  it("reloads the thread only for a stored turn", () => {
    expect(["ready", "weak", "not_found"].every((p) => isStored(p as never))).toBe(true);
    expect(["streaming", "error", "stopped", "interrupted", null].some((p) => isStored(p as never))).toBe(false);
  });
  it("picks the question and the route's thread", () => {
    expect(questionOf("  hi ", false)).toBe("hi");
    expect(questionOf("hi", true)).toBeNull();
    expect(questionOf("   ", false)).toBeNull();
    expect(threadOfRoute("thread:a1")).toBe("a1");
    expect(threadOfRoute("thread:")).toBeNull();
    expect(threadOfRoute("root")).toBeNull();
  });
  it("opens a thread with its turns, or the empty composer when it is gone", async () => {
    const set = () => ({ setThread: vi.fn(), setTurns: vi.fn(), setAsking: vi.fn(), refresh: vi.fn(async () => {}) });
    const m = make(ok({ turns: [3] }));
    (m.bridge as unknown as { unsubscribe: unknown }).unsubscribe = vi.fn();
    const s = set();
    await openThread(m.bridge, "a", s);
    expect(s.setTurns).toHaveBeenLastCalledWith([3]);
    const gone = make(err);
    (gone.bridge as unknown as { unsubscribe: unknown }).unsubscribe = vi.fn();
    const g = set();
    await openThread(gone.bridge, "a", g);
    expect(g.setThread).toHaveBeenLastCalledWith(null);
    const none = set();
    await openThread(m.bridge, null, none);
    expect(none.setTurns).toHaveBeenCalledWith([]);
  });
  it("keeps the thread and refreshes Recent for a stopped or failed turn, leaving its partial on screen", async () => {
    for (const phase of ["stopped", "error", "interrupted"] as const) {
      const s = { setThread: vi.fn(), setTurns: vi.fn(), setAsking: vi.fn(), refresh: vi.fn(async () => {}) };
      await settleTurn(make(ok({ turns: [4] })).bridge, "a", phase, s);
      expect(s.setThread).toHaveBeenCalledWith("a"); // the next question is a follow-up, not a new thread
      expect(s.refresh).toHaveBeenCalled();
      expect(s.setTurns).not.toHaveBeenCalled();
      expect(s.setAsking).not.toHaveBeenCalled();
    }
    const live = { setThread: vi.fn(), setTurns: vi.fn(), setAsking: vi.fn(), refresh: vi.fn(async () => {}) };
    await settleTurn(make(ok({})).bridge, "a", "streaming", live);
    expect(live.setThread).not.toHaveBeenCalled();
  });
  it("settles a stored turn into its thread", async () => {
    const s = { setThread: vi.fn(), setTurns: vi.fn(), setAsking: vi.fn(), refresh: vi.fn(async () => {}) };
    await settleTurn(make(ok({ turns: [4] })).bridge, "a", "ready", s);
    expect(s.setTurns).toHaveBeenCalledWith([4]);
    expect(s.setAsking).toHaveBeenCalledWith(null);
    expect(s.refresh).toHaveBeenCalled();
  });
  it("stops on ⌘. only", () => {
    expect(isStopKey({ key: ".", metaKey: true })).toBe(true);
    expect(isStopKey({ key: ".", metaKey: false })).toBe(false);
    expect(isStopKey({ key: "a", metaKey: true })).toBe(false);
  });
  it("ignores the previous turn's stream until the follow-up's own data arrives", () => {
    const first = { turn_id: "t1", thread_id: "a" };
    expect(currentStream(first, null)).toBe(first);
    expect(currentStream(first, "t1")).toBeNull(); // the follow-up is asked, its stream not yet here
    const second = { turn_id: "t2", thread_id: "a" };
    expect(currentStream(second, "t1")).toBe(second);
    expect(currentStream(null, "t1")).toBeNull();
  });
});
