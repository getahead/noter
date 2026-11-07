import { describe, expect, it, vi } from "vitest";

import { followFixTermChoice, watchFixTermMenu } from "./fix-term-menu";
import { seg } from "./testing";

const segment = seg("seg_1", 0, { text: "the notification service" });

/** A selection of "service" inside line `seg_1`, or of nothing: the unit environment has no DOM, so stand in for it. */
function selecting(ofWords: boolean): Selection | null {
  const text = { contains: () => true, closest: (q: string) => (q === "[data-segment-id]" ? { dataset: { segmentId: "seg_1" } } : null) };
  const node = { parentElement: { closest: () => text } };
  vi.stubGlobal("document", { createRange: () => ({ selectNodeContents() {}, setEnd() {}, toString: () => "the notification " }) });
  return { anchorNode: node, rangeCount: 1, isCollapsed: !ofWords, getRangeAt: () => ({ startContainer: {}, endContainer: {}, startOffset: 0, toString: () => "service" }) } as unknown as Selection;
}

describe("watchFixTermMenu", () => {
  it("enables the menu item for confirmed words, disables it when the selection empties, and again on stop", () => {
    let listener = () => {};
    const doc = { addEventListener: (_: string, l: () => void) => void (listener = l), removeEventListener: vi.fn() } as never;
    const removed = (doc as { removeEventListener: ReturnType<typeof vi.fn> }).removeEventListener;
    let selection: Selection | null = null;
    const setEnabled = vi.fn();
    const stop = watchFixTermMenu(doc, () => selection, () => [segment], setEnabled);
    listener();
    expect(setEnabled).not.toHaveBeenCalled();
    selection = selecting(true);
    listener();
    listener();
    expect(setEnabled.mock.calls).toEqual([[true]]);
    selection = selecting(false);
    listener();
    expect(setEnabled.mock.calls).toEqual([[true], [false]]);
    selection = selecting(true);
    listener();
    stop();
    expect(removed).toHaveBeenCalled();
    expect(setEnabled.mock.calls.at(-1)).toEqual([false]);
    vi.unstubAllGlobals();
  });

  it("a selection outside any stored line, or in a line the transcript does not hold, keeps it disabled", () => {
    let listener = () => {};
    const doc = { addEventListener: (_: string, l: () => void) => void (listener = l), removeEventListener() {} } as never;
    const setEnabled = vi.fn();
    watchFixTermMenu(doc, () => selecting(true), () => [], setEnabled);
    listener();
    watchFixTermMenu(doc, () => ({ anchorNode: null }) as unknown as Selection, () => [segment], setEnabled);
    listener();
    expect(setEnabled).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("followFixTermChoice", () => {
  it("opens on the selection once per choice, and nothing without a selection", () => {
    const handled = { current: 0 };
    const open = vi.fn();
    followFixTermChoice(handled, 0, () => "words", open);
    expect(open).not.toHaveBeenCalled();
    followFixTermChoice(handled, 1, () => "words", open);
    followFixTermChoice(handled, 1, () => "words", open);
    expect(open.mock.calls).toEqual([["words"]]);
    followFixTermChoice(handled, 2, () => null, open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(handled.current).toBe(2);
  });
});
