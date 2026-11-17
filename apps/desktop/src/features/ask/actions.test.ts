import { describe, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import { afterTurn, bindStopKey, copyText, copyTurn, currentStream, deleteThread, isStopKey, isStored, loadPresets, loadRows, loadThread, NEW_SCOPE, openThread, playAudio, questionOf, endedWhileAway, removeThread, replayOf, searchByKeyword, settleTurn, startAsk, stopAudio, stopAsk, threadOfRoute, questionOfRoute, startFromRoute } from "./actions";

// act runs the call and wraps its result the way the bridge does
const make = (result: unknown) => {
  const core = {
    askThreadsList: vi.fn(async () => result),
    askScopePresets: vi.fn(async () => result),
    askThreadGet: vi.fn(async () => result),
    askStop: vi.fn(async () => result),
    askThreadDelete: vi.fn(async () => result),
    audioPlay: vi.fn(async () => result),
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
    expect(["ready", "weak", "not_found", "stopped"].every((p) => isStored(p as never))).toBe(true);
    expect(["streaming", "error", "interrupted", null].some((p) => isStored(p as never))).toBe(false);
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
  it("keeps the thread and refreshes Recent for a failed or interrupted turn, leaving its partial on screen", async () => {
    for (const phase of ["error", "interrupted"] as const) {
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
  it("reloads a stopped turn from the store: it keeps its partial text", async () => {
    const s = { setThread: vi.fn(), setTurns: vi.fn(), setAsking: vi.fn(), refresh: vi.fn(async () => {}) };
    await settleTurn(make(ok({ turns: [5] })).bridge, "a", "stopped", s);
    expect(s.setTurns).toHaveBeenCalledWith([5]);
    expect(s.setAsking).toHaveBeenCalledWith(null);
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
  it("carries a conversation through two questions: the second is not settled on the first's stream", async () => {
    // the page's bookkeeping, step by step: ask 1, its stream arrives and settles, ask 2 while the slice still holds stream 1
    let previous: string | null = null;
    let slice: { turn_id: string; thread_id: string } | null = null;
    const shown = () => currentStream(slice, previous);
    previous = afterTurn(shown(), previous); // Return on question 1
    expect(shown()).toBeNull();
    slice = { turn_id: "t1", thread_id: "a" };
    expect(shown()).toBe(slice);
    const set = { setThread: vi.fn(), setTurns: vi.fn(), setAsking: vi.fn(), refresh: vi.fn(async () => {}) };
    await settleTurn(make(ok({ turns: [1] })).bridge, "a", "ready", set);
    expect(set.setAsking).toHaveBeenCalledWith(null); // question 1 is settled
    previous = afterTurn(shown(), previous); // Return on question 2: the slice still holds stream 1
    expect(shown()).toBeNull(); // nothing to settle: question 2 stays asked, Stop can show
    slice = { turn_id: "t2", thread_id: "a" };
    expect(shown()).toMatchObject({ turn_id: "t2" });
    previous = afterTurn(shown(), previous); // question 3
    expect(shown()).toBeNull();
  });
  it("reports a copy as copied, or failed when the clipboard rejects", async () => {
    const a = { answer_md: "A", citations: [] };
    expect(await copyTurn(a, async () => {})).toBe("copied");
    expect(await copyTurn(a, () => Promise.reject(new Error("no")))).toBe("failed");
  });
  it("deletes a thread through the core and says whether it worked", async () => {
    const m = make(ok({}));
    expect(await deleteThread(m.bridge, "a")).toBe(true);
    expect(await deleteThread(make(err).bridge, "a")).toBe(false);
  });
  it("plays a citation's span through audio_play and stops through audio_stop", async () => {
    const m = make(ok({}));
    (m.core as unknown as Record<string, unknown>).audioStop = vi.fn(async () => ok({}));
    await playAudio(m.bridge, "c", 5000, 9000);
    expect(m.core.audioPlay).toHaveBeenCalledWith({ call_id: "c", from_ms: 5000, to_ms: 9000 });
    await stopAudio(m.bridge);
    expect((m.core as unknown as { audioStop: ReturnType<typeof vi.fn> }).audioStop).toHaveBeenCalled();
    expect(replayOf({ call_id: "c", t0_ms: 5000, t1_ms: 9000 } as never, 3)).toMatchObject({ key: "c:5000", from_ms: 5000, to_ms: 9000, since: 3, paused: false });
  });
  it("removes a thread, closes it when it was open, and refreshes Recent only after success", async () => {
    const h = () => ({ open: vi.fn(), refresh: vi.fn() });
    const open = h();
    await removeThread(make(ok({})).bridge, "a", "a", open);
    expect(open.open).toHaveBeenCalledWith(null);
    expect(open.refresh).toHaveBeenCalled();
    const other = h();
    await removeThread(make(ok({})).bridge, "a", "b", other);
    expect(other.open).not.toHaveBeenCalled();
    expect(other.refresh).toHaveBeenCalled();
    const failed = h();
    await removeThread(make(err).bridge, "a", "a", failed);
    expect(failed.refresh).not.toHaveBeenCalled();
  });
  it("binds ⌘. to Stop while it is bound, and lets go after", () => {
    let handler: ((e: KeyboardEvent) => void) | undefined;
    const doc = { addEventListener: (_: string, h: never) => void (handler = h), removeEventListener: vi.fn() };
    const stop = vi.fn();
    const off = bindStopKey(doc as never, stop);
    handler?.({ key: "x", metaKey: true, preventDefault() {} } as never);
    expect(stop).not.toHaveBeenCalled();
    handler?.({ key: ".", metaKey: true, preventDefault() {} } as never);
    expect(stop).toHaveBeenCalledOnce();
    off();
    expect(doc.removeEventListener).toHaveBeenCalled();
  });
  it("copies text and swallows a refused write", async () => {
    const write = vi.fn(async () => {});
    await copyText("Q", write);
    expect(write).toHaveBeenCalledWith("Q");
    await expect(copyText("Q", () => Promise.reject(new Error("no")))).resolves.toBeUndefined();
  });
  it("searches by keyword without a main window: nothing happens, nothing throws", () => {
    expect(() => searchByKeyword("What did we decide?")).not.toThrow();
  });
  it("names a turn that ended while the user was away, once", () => {
    const raw = { turn_id: "t1" };
    expect(endedWhileAway(raw, "ready", null, null)).toBe("t1");
    expect(endedWhileAway(raw, "stopped", null, null)).toBe("t1");
    expect(endedWhileAway(raw, "ready", null, "t1")).toBeNull(); // already refreshed
    expect(endedWhileAway(raw, "ready", "asked here", null)).toBeNull(); // the page settles its own turn
    expect(endedWhileAway(raw, "streaming", null, null)).toBeNull();
    expect(endedWhileAway(raw, null, null, null)).toBeNull();
    expect(endedWhileAway(null, "ready", null, null)).toBeNull();
  });
  it("keeps listening to a turn still answering when its thread is left", async () => {
    const m = make(ok({ turns: [] }));
    const unsubscribe = vi.fn();
    (m.bridge as unknown as { unsubscribe: unknown }).unsubscribe = unsubscribe;
    const set = { setThread: vi.fn(), setTurns: vi.fn(), setAsking: vi.fn() };
    await openThread(m.bridge, null, set, true);
    expect(unsubscribe).not.toHaveBeenCalled();
    await openThread(m.bridge, null, set);
    expect(unsubscribe).toHaveBeenCalledWith("ask_start");
  });
  it("reads the words of a new:<words> route, decoded, and nothing from other routes", () => {
    expect(questionOfRoute("new:What%20did%20we%20decide%3F")).toBe("What did we decide?");
    expect(questionOfRoute("new:  spaced  ")).toBe("spaced");
    expect(questionOfRoute("new:")).toBeNull();
    expect(questionOfRoute("new:%E0%A4%A")).toBe("%E0%A4%A"); // malformed: the words as they came
    expect(questionOfRoute("root")).toBeNull();
    expect(questionOfRoute("thread:a1")).toBeNull();
  });
  it("starts the routed question once per route key", () => {
    const ask = vi.fn();
    let handled = startFromRoute("new:Why%3F", null, ask);
    expect(ask).toHaveBeenCalledWith("Why?");
    expect(handled).toBe("new:Why%3F");
    handled = startFromRoute("new:Why%3F", handled, ask); // a re-render on the same route does not ask again
    expect(ask).toHaveBeenCalledOnce();
    handled = startFromRoute("new:Next", handled, ask); // a new route asks its own question
    expect(ask).toHaveBeenCalledTimes(2);
    expect(startFromRoute("root", handled, ask)).toBe(handled);
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
