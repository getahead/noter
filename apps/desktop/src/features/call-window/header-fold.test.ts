import { afterEach, describe, expect, it, vi } from "vitest";

const { hook } = vi.hoisted(() => ({ hook: { effect: undefined as undefined | (() => (() => void) | void), fold: 0, setFold: vi.fn() } }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: () => [hook.fold, hook.setFold],
  useEffect: (effect: () => (() => void) | void) => void (hook.effect = effect),
}));

import { foldOrder, nextFold, TITLE_MIN_EM, useHeaderFold } from "./header-fold";

describe("FP-R1 overflow (#1186)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    hook.setFold.mockReset();
    hook.fold = 0;
  });

  it("folds Move to Display 2 first, then Collapse, then the shield; Move only with two displays", () => {
    expect(foldOrder(true)).toEqual(["move", "collapse", "shield"]);
    expect(foldOrder(false)).toEqual(["collapse", "shield"]);
  });
  it("folds one more control while the title is under 8 em, up to all of them", () => {
    expect(nextFold(0, 3, TITLE_MIN_EM * 13 - 1, 13)).toBe(1);
    expect(nextFold(3, 3, 10, 13)).toBe(3);
  });
  it("unfolds one only with room for it, and holds in between so the header never flaps", () => {
    expect(nextFold(2, 3, (TITLE_MIN_EM + 3) * 13, 13)).toBe(1);
    expect(nextFold(2, 3, (TITLE_MIN_EM + 1) * 13, 13)).toBe(2);
    expect(nextFold(0, 3, 400, 13)).toBe(0);
  });

  it("measures the title and its header as they resize, and stops when the header goes", () => {
    const observed: unknown[] = [];
    let onResize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(cb: () => void) { onResize = cb; }
      observe(el: unknown) { observed.push(el); }
      disconnect = disconnect;
    });
    vi.stubGlobal("getComputedStyle", () => ({ fontSize: "19.5px" }));
    const header = {};
    const title = { clientWidth: 50, parentElement: header };
    hook.fold = 5; // more than max: clamped
    expect(useHeaderFold({ current: title as unknown as HTMLElement }, 3, [])).toBe(3);
    const stop = hook.effect!() as () => void;
    expect(observed).toEqual([header, title]);
    const step = hook.setFold.mock.calls[0]![0] as (f: number) => number;
    expect(step(0)).toBe(1); // 50 px < 8 × 19.5 px
    title.clientWidth = 400;
    onResize();
    expect((hook.setFold.mock.calls[1]![0] as (f: number) => number)(3)).toBe(2);
    stop();
    expect(disconnect).toHaveBeenCalled();
  });

  it("does nothing before the title is drawn or without ResizeObserver", () => {
    useHeaderFold({ current: null }, 3, []);
    expect(hook.effect!()).toBeUndefined();
    vi.stubGlobal("ResizeObserver", undefined);
    useHeaderFold({ current: {} as HTMLElement }, 3, []);
    expect(hook.effect!()).toBeUndefined();
    expect(hook.setFold).not.toHaveBeenCalled();
  });
});
