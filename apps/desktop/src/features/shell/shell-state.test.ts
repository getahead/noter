import { describe, expect, it } from "vitest";

import { INITIAL_SHELL, SIDEBAR, ZOOM_STEPS, currentRoute, shellReduce, zoomStyle, type ShellEvent, type ShellState } from "./shell-state";

const run = (events: ShellEvent[], from: ShellState = INITIAL_SHELL) => events.reduce(shellReduce, from);
const go = (section: "library" | "people"): ShellEvent => ({ type: "move", move: { type: "section", section } });

describe("shell state", () => {
  it("navigates through the one history", () => {
    const s = run([go("library"), go("people"), { type: "move", move: { type: "back" } }]);
    expect(currentRoute(s.history)).toEqual({ section: "library", key: "root" });
    expect(s.history.index).toBe(1);
  });

  it("toggles the docked sidebar, or the overlay while collapsed, and closes the overlay on navigation", () => {
    expect(run([{ type: "toggle-sidebar", overlay: false }]).sidebar).toBe(false);
    const open = run([{ type: "toggle-sidebar", overlay: true }]);
    expect(open).toMatchObject({ sidebar: true, overlayOpen: true });
    expect(run([go("library")], open).overlayOpen).toBe(false);
    expect(run([{ type: "close-overlay" }], open).overlayOpen).toBe(false);
    expect(run([{ type: "close-overlay" }])).toBe(INITIAL_SHELL);
  });

  it("opens and closes the inspector", () => {
    const open = run([{ type: "toggle-inspector" }]);
    expect(open.history.inspectorOpen).toBe(true);
    expect(run([{ type: "close-inspector" }], open).history.inspectorOpen).toBe(false);
    expect(run([{ type: "close-inspector" }])).toBe(INITIAL_SHELL);
    // leaving the page closes it (history rule)
    expect(run([go("library")], open).history.inspectorOpen).toBe(false);
  });

  it("zooms one step at a time between 100 and 200 %, and ⌘0 resets", () => {
    expect(ZOOM_STEPS).toEqual([100, 125, 150, 175, 200]);
    const z = (events: Array<"in" | "out" | "reset">) => run(events.map((to) => ({ type: "zoom", to }))).zoom;
    expect(z(["in"])).toBe(125);
    expect(z(["in", "in", "in", "in", "in", "in"])).toBe(200);
    expect(z(["out"])).toBe(100);
    expect(z(["in", "in", "reset"])).toBe(100);
  });

  it("resizes the sidebar between 180 and 320 pt from its 220-pt default", () => {
    expect(INITIAL_SHELL.sidebarWidth).toBe(220);
    expect(run([{ type: "resize-sidebar", width: 260 }]).sidebarWidth).toBe(260);
    expect(run([{ type: "resize-sidebar", width: 100 }]).sidebarWidth).toBe(SIDEBAR.min);
    expect(run([{ type: "resize-sidebar", width: 900 }]).sidebarWidth).toBe(SIDEBAR.max);
  });

  it("sizes the zoomed window so it still fills the viewport", () => {
    expect(zoomStyle(100)).toEqual({ zoom: undefined, width: "calc(100vw / 1)", height: "calc(100vh / 1)" });
    expect(zoomStyle(200)).toEqual({ zoom: 2, width: "calc(100vw / 2)", height: "calc(100vh / 2)" });
  });
});
