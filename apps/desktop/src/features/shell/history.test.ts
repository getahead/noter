import { describe, expect, it } from "vitest";

import { INITIAL_HISTORY, historyMove, type History, type HistoryMove, type Route } from "./history";
import { searchRoute } from "./sections";

const call = (id: string): Route => ({ section: "library", key: `call:${id}` });
const go = (h: History, ...moves: HistoryMove[]) => moves.reduce((s, m) => historyMove(s.history, m), { history: h, route: h.entries[h.index]! });

describe("historyMove", () => {
  it("starts on Today's root", () => {
    expect(INITIAL_HISTORY.entries).toEqual([{ section: "today", key: "root" }]);
    expect(INITIAL_HISTORY.index).toBe(0);
  });

  it("opens a section at its root, then at the place the user last left it", () => {
    let r = go(INITIAL_HISTORY, { type: "section", section: "library" });
    expect(r.route).toEqual({ section: "library", key: "root" });
    r = go(r.history, { type: "push", route: call("a") }, { type: "section", section: "today" }, { type: "section", section: "library" });
    expect(r.route).toEqual(call("a"));
    expect(r.history.entries.map((e) => e.key)).toEqual(["root", "root", "call:a", "root", "call:a"]);
  });

  it("does not push a section that is already showing", () => {
    const r = go(INITIAL_HISTORY, { type: "section", section: "today" });
    expect(r.history.entries).toHaveLength(1);
  });

  it("push drops the entries after the index", () => {
    const r = go(INITIAL_HISTORY, { type: "push", route: call("a") }, { type: "push", route: call("b") }, { type: "back" }, { type: "push", route: call("c") });
    expect(r.history.entries.map((e) => e.key)).toEqual(["root", "call:a", "call:c"]);
    expect(r.history.index).toBe(2);
  });

  it("back and forward move the index by one and stop at the ends", () => {
    let r = go(INITIAL_HISTORY, { type: "push", route: call("a") });
    r = go(r.history, { type: "back" });
    expect(r.route.key).toBe("root");
    expect(go(r.history, { type: "back" }).history).toBe(r.history);
    r = go(r.history, { type: "forward" });
    expect(r.route).toEqual(call("a"));
    expect(go(r.history, { type: "forward" }).history).toBe(r.history);
  });

  it("Back and Forward return to the same search query, and Forward to the page that followed it", () => {
    let r = go(INITIAL_HISTORY, { type: "push", route: searchRoute("zoom") }, { type: "push", route: call("a") });
    r = go(r.history, { type: "back" });
    expect(r.route).toEqual(searchRoute("zoom"));
    expect(r.history.last.library).toEqual(searchRoute("zoom"));
    r = go(r.history, { type: "forward" });
    expect(r.route).toEqual(call("a"));
  });

  it("replace swaps the entry at the index", () => {
    const r = go(INITIAL_HISTORY, { type: "push", route: call("a") }, { type: "replace", route: call("b") });
    expect(r.history.entries.map((e) => e.key)).toEqual(["root", "call:b"]);
    expect(r.history.index).toBe(1);
  });

  it("remembers every route as its section's last location, also after back", () => {
    const r = go(INITIAL_HISTORY, { type: "push", route: call("a") }, { type: "back" }, { type: "section", section: "library" });
    // back landed on Today's root, so Today remembers root; Calls still remembers a
    expect(r.history.last.today).toEqual({ section: "today", key: "root" });
    expect(r.route).toEqual(call("a"));
  });

  it("closes the inspector on every move unless it is kept for the same page", () => {
    let r = go(INITIAL_HISTORY, { type: "push", route: call("a"), inspector: true });
    expect(r.history.inspectorOpen).toBe(false);
    r = go(r.history, { type: "push", route: call("a"), keepInspector: true, inspector: true });
    expect(r.history.inspectorOpen).toBe(true);
    expect(go(r.history, { type: "replace", route: call("a"), keepInspector: true }).history.inspectorOpen).toBe(true);
    expect(go(r.history, { type: "back" }).history.inspectorOpen).toBe(false);
    expect(go(r.history, { type: "section", section: "ask" }).history.inspectorOpen).toBe(false);
  });
});
