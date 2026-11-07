import { expect, it, vi } from "vitest";
import type { Bridge } from "../../app/bridge/bridge";
import { positionOf, restorePosition } from "./position";

it("keeps each window's return position and disclosures independently", () => {
  const bridge = {} as Bridge;
  const position = positionOf(bridge);
  position.focused = "one";
  position.expanded = new Map([["event", true]]);
  position.all.add("event");
  expect(positionOf(bridge)).toBe(position);
  expect(positionOf({} as Bridge).focused).toBeNull();
});

it("sets one row stop, restores its focus, and falls back to Done when the core moves it", () => {
  const rows = ["one", "two"].map((itemId) => ({ dataset: { itemId }, tabIndex: -1, focus: vi.fn(), toggleAttribute: vi.fn(), closest: () => null }));
  const done = { focus: vi.fn() };
  const body = {};
  const root = { querySelectorAll: () => rows, querySelector: () => done, ownerDocument: { body, activeElement: body } };
  const position = positionOf({} as Bridge);
  restorePosition(root as unknown as HTMLElement, position);
  expect(rows.map((r) => r.tabIndex)).toEqual([0, -1]);
  position.focused = "two"; // a control inside the second row took focus: the Tab stop stays on the first row
  restorePosition(root as unknown as HTMLElement, position);
  expect(rows.map((r) => r.tabIndex)).toEqual([0, -1]);
  expect(rows[1]!.focus).toHaveBeenCalledOnce(); // and focus is restored there when it is lost
  position.stop = { id: "two" }; // the row itself took focus
  restorePosition(root as unknown as HTMLElement, position);
  expect(rows.map((r) => r.tabIndex)).toEqual([-1, 0]);
  position.focused = "moved";
  restorePosition(root as unknown as HTMLElement, position);
  expect(done.focus).toHaveBeenCalledOnce();
  root.ownerDocument.activeElement = {};
  restorePosition(root as unknown as HTMLElement, position);
  expect(done.focus).toHaveBeenCalledOnce();
  restorePosition(null, position);
});

it("restores the same occurrence when one item appears in two calendar cards", () => {
  const rows = ["first", "later"].map((group) => ({ dataset: { itemId: "same" }, tabIndex: -1, focus: vi.fn(), toggleAttribute: vi.fn(), closest: () => ({ dataset: { todayGroup: group } }) }));
  const body = {};
  const root = { querySelectorAll: () => rows, querySelector: () => null, ownerDocument: { body, activeElement: body } };
  const position = positionOf({} as Bridge);
  position.focused = "same";
  position.group = "later";
  restorePosition(root as unknown as HTMLElement, position);
  expect(rows.map((r) => r.tabIndex)).toEqual([-1, 0]);
  expect(rows[1]!.focus).toHaveBeenCalledOnce();
});
