import { describe, expect, it } from "vitest";
import { extend, press, selectAll, type Selection } from "./selection";

const order = ["a", "b", "c", "d"];
const none: Selection = { ids: [], anchor: null };
const ids = (s: Selection) => [...s.ids].sort();

describe("selection (cpt-noter-flow-ui-library-calls-delete)", () => {
  it("a plain click selects only that row", () => {
    expect(ids(press(press(none, order, "a", {}), order, "c", {}))).toEqual([
      "c",
    ]);
  });

  it("⌘-click toggles one row and keeps the others", () => {
    const s = press(
      press(press(none, order, "a", {}), order, "c", { meta: true }),
      order,
      "a",
      { meta: true },
    );
    expect(ids(s)).toEqual(["c"]);
  });

  it("⇧-click extends from the anchor in either direction", () => {
    const s = press(none, order, "b", {});
    expect(ids(press(s, order, "d", { shift: true }))).toEqual(["b", "c", "d"]);
    expect(ids(press(s, order, "a", { shift: true }))).toEqual(["a", "b"]);
  });

  it("⌘A selects every row; ⇧↓ and ⇧↑ move the edge", () => {
    expect(ids(selectAll(order))).toEqual(order);
    const s = press(none, order, "b", {});
    expect(ids(extend(s, order, 1))).toEqual(["b", "c"]);
    expect(ids(extend(extend(s, order, 1), order, -1))).toEqual(["b"]);
    expect(ids(extend(press(none, order, "a", {}), order, -1))).toEqual(["a"]);
    expect(ids(extend(none, order, 1))).toEqual(["a"]);
  });

  it("a right-click keeps a selected row's selection and replaces it for an unselected row", () => {
    const s = press(press(none, order, "a", {}), order, "b", { meta: true });
    expect(ids(press(s, order, "a", { context: true }))).toEqual(["a", "b"]);
    expect(ids(press(s, order, "d", { context: true }))).toEqual(["d"]);
  });
});
