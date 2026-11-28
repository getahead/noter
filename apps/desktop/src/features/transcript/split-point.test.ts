import { expect, it, vi } from "vitest";

import { pointedWord, selectedSplit, splitAt, splitTime, watchSplitMenu, wordAt } from "./split-point";
import { seg } from "./testing";

const line = seg("line", 1000, { text: "Yes 😀 okay", t1_ms: 2000 });

it("reads UTF-16 word offsets and counts characters for the proportional timestamp", () => {
  expect(splitAt(line.text, 0)).toBe(false);
  expect(splitAt(line.text, 5)).toBe(false);
  expect(splitAt(line.text, 7)).toBe(true);
  expect(wordAt(line.text, 9)).toEqual({ start: 7, end: 11 });
  expect(wordAt(line.text, 99)).toBeNull();
  expect(splitTime(line, 7)).toBe(1600);
  expect(splitTime(line, 7, 1800)).toBe(1800);
});

it("uses a caret or selection start inside the line and snaps pointer hits to the word", () => {
  let left = "Yes 😀 ";
  const node = { parentElement: { closest: () => el } };
  const range = { startContainer: node, endContainer: node, startOffset: 0 };
  const doc = {
    createRange: () => ({ selectNodeContents() {}, setEnd() {}, toString: () => left }),
    caretPositionFromPoint: vi.fn(() => ({ offsetNode: node, offset: 0 })),
    caretRangeFromPoint: vi.fn(() => range),
  };
  const el = { ownerDocument: doc, closest: () => ({ dataset: { segmentId: line.id } }), contains: (n: unknown) => n === node };
  const anchor = el as unknown as HTMLElement;
  const selection = { rangeCount: 1, getRangeAt: () => range } as unknown as Selection;
  expect(selectedSplit(null, [line])).toBeNull();
  expect(selectedSplit(selection, [])).toBeNull();
  expect(selectedSplit(selection, [line])).toEqual({ seg: line, anchor, at: 7 });
  expect(selectedSplit({ ...selection, getRangeAt: () => ({ ...range, endContainer: {} }) } as unknown as Selection, [line])).toBeNull();
  left += "ka";
  expect(selectedSplit(selection, [line])).toBeNull();
  expect(pointedWord(anchor, line.text, 20, 50)).toEqual({ start: 7, end: 11 });
  expect(doc.caretRangeFromPoint).not.toHaveBeenCalled();
  expect(pointedWord(anchor, line.text, Number.NaN, 50)).toBeNull();
  doc.caretPositionFromPoint.mockImplementationOnce(() => null as never);
  expect(pointedWord(anchor, line.text, 20, 50)?.start).toBe(7);
  doc.caretPositionFromPoint.mockImplementationOnce(() => ({ offsetNode: {} as typeof node, offset: 0 }));
  expect(pointedWord(anchor, line.text, 20, 50)).toBeNull();
});

it("enables the Edit item only with an eligible focused selection", async () => {
  const doc = Object.assign(new EventTarget(), { hasFocus: () => true });
  const win = new EventTarget();
  const point = { seg: line, anchor: {} as HTMLElement, at: 7 };
  const pick = vi.fn(() => point as typeof point | null);
  const setEnabled = vi.fn();
  const open = vi.fn();
  const unlisten = vi.fn();
  let choose = (_key: string) => {};
  const cleanup = watchSplitMenu(doc, win, pick, setEnabled, async (handler) => { choose = handler; return unlisten; }, open);
  expect(setEnabled).toHaveBeenLastCalledWith(true);
  choose("menu.copy");
  expect(open).not.toHaveBeenCalled();
  choose("menu.split_line");
  expect(open).toHaveBeenCalledWith(point);
  pick.mockReturnValue(null);
  choose("menu.split_line");
  expect(open).toHaveBeenCalledTimes(1);
  doc.dispatchEvent(new Event("selectionchange"));
  expect(setEnabled).toHaveBeenLastCalledWith(false);
  win.dispatchEvent(new Event("blur"));
  cleanup();
  await Promise.resolve();
  expect(unlisten).toHaveBeenCalled();
});
