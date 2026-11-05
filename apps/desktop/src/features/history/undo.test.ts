import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bridge } from "../../app/bridge/bridge";
import type { Clock } from "../../ui/feedback/status-timer";
import { undoKey } from "./UndoStrip";
import { dismissUndo, holdPointer, holdUndo, resetUndo, runUndo, undoLast, undoMode, UNDO_MS, useUndo } from "./undo";

// The hook is a thin useSyncExternalStore over the module state: read it without React.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useSyncExternalStore: (_s: unknown, get: () => unknown) => get() }));
const peek = () => useUndo();

let now = 0;
const timers = new Map<number, { at: number; fn: () => void }>();
let n = 0;
const clock: Clock = {
  now: () => now,
  setTimeout: (fn, ms) => (timers.set(++n, { at: now + ms, fn }), n),
  clearTimeout: (h) => void timers.delete(h as number),
};
const advance = (ms: number) => {
  now += ms;
  for (const [h, t] of [...timers]) if (t.at <= now) (timers.delete(h), t.fn());
};

const change = { type: "change", change_id: "chg_1" } as const;
const ok = (undone: number, skipped_edited_later = 0) => () => ({ status: "ok", data: { undone, skipped_edited_later } });
const bridgeFor = (answer: () => unknown, calls: string[] = []) =>
  ({
    core: { changeUndo: async () => (calls.push("undo"), answer()), changeRedo: async () => (calls.push("redo"), answer()) },
    act: async (_k: string, _c: string, run: () => Promise<unknown>) => run(),
  }) as unknown as Bridge;

beforeEach(() => {
  now = 0;
  timers.clear();
  resetUndo(clock);
});

describe("undo strip timing (cpt-noter-algo-ui-history-undo-strip)", () => {
  it("shows for 10 s and then hides", () => {
    holdUndo({ target: change, message: "Renamed" });
    expect(peek()?.phase).toBe("VISIBLE");
    advance(UNDO_MS - 1);
    expect(peek()).not.toBeNull();
    advance(1);
    expect(peek()).toBeNull();
  });

  it("hover or focus pauses expiry and the 10 s restart only when both end", () => {
    holdUndo({ target: change, message: "Renamed" });
    advance(6000);
    holdPointer("hover", true);
    holdPointer("focus", true);
    expect(peek()?.phase).toBe("PAUSED");
    advance(60_000);
    expect(peek()).not.toBeNull();
    holdPointer("hover", false);
    expect(peek()?.phase).toBe("PAUSED");
    holdPointer("focus", false);
    expect(peek()?.phase).toBe("VISIBLE");
    advance(UNDO_MS - 1);
    expect(peek()).not.toBeNull();
    advance(1);
    expect(peek()).toBeNull();
  });

  it("a new action replaces the strip and its target", () => {
    holdUndo({ target: change, message: "A" });
    holdUndo({ target: { type: "batch", batch_id: "bat_1" }, message: "B" });
    expect(peek()?.message).toBe("B");
  });

  it("dismiss hides at once and leaves no timer", () => {
    holdUndo({ target: change, message: "A" });
    dismissUndo();
    expect(peek()).toBeNull();
    expect(timers.size).toBe(0);
  });
});

describe("runUndo (cpt-noter-flow-ui-history-undo-reverse)", () => {
  it("undo switches once to Redo for the same target with the returned count, then refreshes", async () => {
    const refresh = vi.fn();
    holdUndo({ target: change, message: "Renamed", refresh });
    await runUndo(bridgeFor(ok(37)));
    expect(peek()).toMatchObject({ mode: "redo", phase: "SWITCHED", message: "Undone 37 changes", target: change });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("redo switches back to Undo", async () => {
    holdUndo({ target: change, message: "Renamed" });
    const b = bridgeFor(ok(1));
    await runUndo(b);
    await runUndo(b);
    expect(peek()).toMatchObject({ mode: "undo", message: "Redone 1 change" });
  });

  it("a partial result names the kept rows", async () => {
    holdUndo({ target: change, message: "x" });
    await runUndo(bridgeFor(ok(35, 2)));
    expect(peek()).toMatchObject({ phase: "PARTIAL", message: "Undone 35 of 37 · 2 kept because you edited them later" });
  });

  it("a failure keeps the strip, names the error and shows no success message", async () => {
    holdUndo({ target: change, message: "Renamed" });
    await runUndo(bridgeFor(() => ({ status: "error", error: { code: "edited_later" } })));
    expect(peek()).toMatchObject({ phase: "VISIBLE", mode: "undo", message: "Renamed", context: "Edited later, so it was kept." });
    await runUndo(bridgeFor(() => ({ status: "error", error: { code: "internal" } })));
    expect(peek()?.context).toBe("Couldn't finish that. Try again.");
  });

  it("a second press while the command runs is ignored", async () => {
    holdUndo({ target: change, message: "x" });
    const calls: string[] = [];
    const b = bridgeFor(ok(1), calls);
    const first = runUndo(b);
    expect(peek()?.phase).toBe("WORKING");
    await runUndo(b);
    await first;
    expect(calls).toEqual(["undo"]);
  });

  it("does not expire while working", async () => {
    holdUndo({ target: change, message: "x" });
    let release!: () => void;
    const b = {
      core: { changeUndo: () => new Promise((r) => (release = () => r(ok(1)()))) },
      act: async (_k: string, _c: string, run: () => Promise<unknown>) => run(),
    } as unknown as Bridge;
    const p = runUndo(b);
    advance(60_000);
    expect(peek()?.phase).toBe("WORKING");
    release();
    await p;
    expect(peek()?.phase).toBe("SWITCHED");
  });

  it("does nothing without a strip", async () => {
    await runUndo(bridgeFor(ok(1)));
    expect(peek()).toBeNull();
  });
});

describe("undoKey", () => {
  const k = (o: Partial<{ code: string; metaKey: boolean; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }>) => ({ code: "KeyZ", metaKey: true, shiftKey: false, altKey: false, ctrlKey: false, ...o });
  const entry = (mode: "undo" | "redo") => mode;
  it("⌘Z undoes, ⇧⌘Z redoes, only while a strip is shown", () => {
    expect(undoKey(k({}), entry("undo"))).toBe(true);
    expect(undoKey(k({ shiftKey: true }), entry("undo"))).toBe(false);
    expect(undoKey(k({ shiftKey: true }), entry("redo"))).toBe(true);
    expect(undoKey(k({}), entry("redo"))).toBe(false);
    expect(undoKey(k({}), null)).toBe(false);
    expect(undoKey(k({ metaKey: false }), entry("undo"))).toBe(false);
  });
});

describe("refresh after a replaced strip", () => {
  it("re-reads the source view even when the strip was dismissed while the command ran", async () => {
    const refresh = vi.fn();
    holdUndo({ target: change, message: "x", refresh });
    let release!: () => void;
    const b = {
      core: { changeUndo: () => new Promise((r) => (release = () => r(ok(1)()))) },
      act: async (_k: string, _c: string, run: () => Promise<unknown>) => run(),
    } as unknown as Bridge;
    const p = runUndo(b);
    dismissUndo();
    release();
    await p;
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("the last applicable change", () => {
  it("⌘Z and ⇧⌘Z keep working after the strip is dismissed, on the same target", async () => {
    const calls: string[] = [];
    const b = bridgeFor(ok(1), calls);
    holdUndo({ target: change, message: "x" });
    await runUndo(b);
    dismissUndo();
    expect(peek()).toBeNull();
    expect(undoMode()).toBe("redo");
    await undoLast(b);
    expect(calls).toEqual(["undo", "redo"]);
    expect(peek()).toMatchObject({ mode: "undo", target: change });
  });

  it("nothing to run before any action", async () => {
    expect(undoMode()).toBeNull();
    await undoLast(bridgeFor(ok(1)));
    expect(peek()).toBeNull();
  });
});
