import { describe, expect, it } from "vitest";

import { INITIAL_WINDOW, listStep, windowKind, windowReduce, type WindowState } from "./window";

const run = (s: WindowState, ...events: Parameters<typeof windowReduce>[1][]) => events.reduce(windowReduce, s);

describe("settings window state", () => {
  it("starts on the General pane", () => {
    expect(INITIAL_WINDOW).toMatchObject({ pane: "general", search: "", error: null, hidden: false });
    expect(windowKind(INITIAL_WINDOW)).toBe("PANE");
  });

  it("moves PANE → SEARCH_RESULTS → NO_MATCH → PANE as the search text changes", () => {
    let s = run(INITIAL_WINDOW, { type: "search", text: "hot" });
    expect(windowKind(s)).toBe("SEARCH_RESULTS");
    s = windowReduce(s, { type: "search", text: "hotqq" });
    expect(windowKind(s)).toBe("NO_MATCH");
    s = windowReduce(s, { type: "search", text: "" });
    expect(windowKind(s)).toBe("PANE");
  });

  it("goes back from NO_MATCH to results when an edit matches again", () => {
    expect(windowKind(run(INITIAL_WINDOW, { type: "search", text: "qq" }, { type: "search", text: "zoom" }))).toBe("SEARCH_RESULTS");
  });

  it("selects a pane and keeps the search", () => {
    const s = run(INITIAL_WINDOW, { type: "search", text: "zoom" }, { type: "pane", pane: "hotkeys" });
    expect(s).toMatchObject({ pane: "hotkeys", search: "zoom" });
  });

  it("shows PANE_ERROR until the core reports the fix", () => {
    const s = run(INITIAL_WINDOW, { type: "error", message: "Keychain is locked" });
    expect(windowKind(s)).toBe("PANE_ERROR");
    expect(s.error).toBe("Keychain is locked");
    expect(windowKind(windowReduce(s, { type: "fixed" }))).toBe("PANE");
  });

  it("comes back as it was after being hidden for presenting", () => {
    const before = run(INITIAL_WINDOW, { type: "pane", pane: "privacy" }, { type: "error", message: "x" });
    const hidden = windowReduce(before, { type: "hidden", hidden: true });
    expect(windowKind(hidden)).toBe("HIDDEN_FOR_PRESENTING");
    expect(windowReduce(hidden, { type: "hidden", hidden: false })).toEqual(before);
  });
});

describe("listStep", () => {
  it("moves one pane with ↑ and ↓, stopping at both ends, and ignores other keys or focus outside the list", () => {
    expect(listStep("ArrowDown", 0, 11)).toBe(1);
    expect(listStep("ArrowUp", 0, 11)).toBe(0);
    expect(listStep("ArrowDown", 10, 11)).toBe(10);
    expect(listStep("ArrowUp", 5, 11)).toBe(4);
    expect(listStep("a", 5, 11)).toBeNull();
    expect(listStep("ArrowDown", -1, 11)).toBeNull();
  });
});
