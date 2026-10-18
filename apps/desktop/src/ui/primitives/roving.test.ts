import type { KeyboardEvent } from "react";
import { describe, expect, it } from "vitest";
import { activates, moveFocus, nextIndex } from "./roving";

describe("nextIndex", () => {
  it("moves by one with ↑/↓ and wraps when asked", () => {
    expect(nextIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextIndex("ArrowUp", 0, 3)).toBe(2);
    expect(nextIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextIndex("ArrowDown", 2, 3, false)).toBe(2);
    expect(nextIndex("ArrowUp", 0, 3, false)).toBe(0);
  });

  it("goes to the ends with Home and End, and enters the list from outside", () => {
    expect(nextIndex("Home", 2, 3)).toBe(0);
    expect(nextIndex("End", 0, 3)).toBe(2);
    expect(nextIndex("ArrowDown", -1, 3)).toBe(0);
    expect(nextIndex("ArrowUp", -1, 3)).toBe(2);
  });

  it("ignores other keys and empty lists", () => {
    expect(nextIndex("ArrowLeft", 0, 3)).toBeNull();
    expect(nextIndex("a", 0, 3)).toBeNull();
    expect(nextIndex("ArrowDown", -1, 0)).toBeNull();
  });
});

/** An element that records focus. */
const item = (log: string[], name: string) => ({ name, focus: () => log.push(name), contains: (n: unknown) => n === item }) as unknown as HTMLElement;

function keyEvent(key: string, target: unknown, items: HTMLElement[]) {
  let prevented = false;
  const e = { key, target, currentTarget: { querySelectorAll: () => items }, preventDefault: () => (prevented = true) } as unknown as KeyboardEvent<HTMLElement>;
  return { e, prevented: () => prevented };
}

describe("moveFocus (cpt-noter-flow-ui-primitives-operate-control)", () => {
  it("focuses the next item of the composite and keeps the key from scrolling", () => {
    const log: string[] = [];
    const items = [item(log, "a"), item(log, "b"), item(log, "c")];
    const { e, prevented } = keyEvent("ArrowDown", items[0], items);
    expect(moveFocus(e, "[role=menuitem]")).toBe(true);
    expect(log).toEqual(["b"]);
    expect(prevented()).toBe(true);
  });

  it("finds the item that holds the focused element", () => {
    const log: string[] = [];
    const inner = {};
    const items = [item(log, "a"), { ...item(log, "b"), contains: (n: unknown) => n === inner } as unknown as HTMLElement];
    expect(moveFocus(keyEvent("ArrowUp", inner, items).e, "tr")).toBe(true);
    expect(log).toEqual(["a"]);
  });

  it("leaves other keys to the item", () => {
    const log: string[] = [];
    const items = [item(log, "a")];
    const { e, prevented } = keyEvent("Enter", items[0], items);
    expect(moveFocus(e, "tr")).toBe(false);
    expect(log).toEqual([]);
    expect(prevented()).toBe(false);
  });
});

describe("activates", () => {
  it("is Return or Space", () => {
    expect(["Enter", " ", "Escape", "a"].map((key) => activates({ key }))).toEqual([true, true, false, false]);
  });
});
