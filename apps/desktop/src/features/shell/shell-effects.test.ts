import { describe, expect, it, vi } from "vitest";

import { layoutFor, exitMs, leaveTimer, openFocus, actionEvent, createScrollMemory, escapeEvent, focusEffect, focusHeading, navEffect, navMove, scrollEffect, scrollSaver, tickWhile, watchWidth } from "./shell-effects";

describe("shell actions", () => {
  it("turns each action into its view-state event", () => {
    expect(actionEvent({ type: "section", section: "people" }, false, false)).toEqual({ type: "move", move: { type: "section", section: "people" } });
    expect(actionEvent({ type: "back" }, false, false)).toEqual({ type: "move", move: { type: "back" } });
    expect(actionEvent({ type: "forward" }, false, false)).toEqual({ type: "move", move: { type: "forward" } });
    expect(actionEvent({ type: "toggle-sidebar" }, true, false)).toEqual({ type: "toggle-sidebar", overlay: true });
    expect(actionEvent({ type: "zoom", to: "in" }, false, false)).toEqual({ type: "zoom", to: "in" });
  });

  it("toggles the inspector only for a page that has one, and leaves search and Settings to the window", () => {
    expect(actionEvent({ type: "toggle-inspector" }, false, true)).toEqual({ type: "toggle-inspector" });
    expect(actionEvent({ type: "toggle-inspector" }, false, false)).toBeNull();
    expect(actionEvent({ type: "focus-search" }, false, true)).toBeNull();
    expect(actionEvent({ type: "open-settings" }, false, true)).toBeNull();
  });

  it("Esc closes the inspector first, then the overlay sidebar", () => {
    expect(escapeEvent({ inspectorOpen: true })).toEqual({ type: "close-inspector" });
    expect(escapeEvent({ inspectorOpen: false })).toEqual({ type: "close-overlay" });
  });
});

describe("navigation requests", () => {
  it("opens a section root as a section move and any other page as a push", () => {
    expect(navMove({ type: "agents" })).toEqual({ type: "section", section: "agents" });
    expect(navMove({ type: "person", person_id: "p1" })).toEqual({ type: "push", route: { section: "people", key: "person:p1" } });
    expect(navMove({ type: "settings", pane: "privacy" })).toBeNull();
  });
});

describe("page view state", () => {
  it("remembers the scroll position of each page, from the top by default", () => {
    const m = createScrollMemory();
    expect(m.top("library/root")).toBe(0);
    m.save("library/root", 340);
    expect(m.top("library/root")).toBe(340);
    expect(m.top("people/root")).toBe(0);
  });

  it("moves focus to the first heading, without scrolling, and reports a page without one", () => {
    const heading = { tabIndex: 0, focus: vi.fn() };
    expect(focusHeading({ querySelector: () => heading as never })).toBe(true);
    expect(heading.tabIndex).toBe(-1);
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true });
    const root = { scrollTop: 300, querySelector: () => ({ tabIndex: 0, focus: () => void (root.scrollTop = 0) }) as never };
    expect(focusHeading(root)).toBe(true);
    expect(root.scrollTop).toBe(300); // focus() that scrolls anyway leaves the scroll position as it was
    expect(focusHeading({ querySelector: () => null })).toBe(false);
    expect(focusHeading(null)).toBe(false);
  });
});

describe("watchWidth", () => {
  it("reports the width on every resize and stops on cleanup", () => {
    let on = () => {};
    const win = { innerWidth: 1000, addEventListener: (_: "resize", f: () => void) => (on = f), removeEventListener: vi.fn() };
    const set = vi.fn();
    const stop = watchWidth(win, set);
    win.innerWidth = 820;
    on();
    expect(set).toHaveBeenCalledWith(820);
    stop();
    expect(win.removeEventListener).toHaveBeenCalledWith("resize", on);
  });
});

describe("effects", () => {
  it("a nav request moves the history and keeps focus where it is; no request or another window's target does nothing", () => {
    const dispatch = vi.fn();
    const flags = { first: false, quiet: null as string | null };
    navEffect(null, flags, dispatch);
    navEffect({ type: "settings", pane: "general" }, flags, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
    navEffect({ type: "activity" }, flags, dispatch);
    expect(dispatch).toHaveBeenCalledWith({ type: "move", move: { type: "section", section: "activity" } });
    expect(flags.quiet).toBe("activity/root");
  });

  it("restores the scroll position on arrival", () => {
    const memory = createScrollMemory();
    memory.save("library/root", 200);
    const el = { scrollTop: 0 };
    scrollEffect(el, memory, "library/root");
    expect(el.scrollTop).toBe(200);
    scrollSaver(memory, "library/root")({ currentTarget: { scrollTop: 450 } });
    expect(memory.top("library/root")).toBe(450);
    scrollEffect(null, memory, "x"); // no content element yet
  });

  it("focuses the heading after navigation, but not on the first render or for the page the core asked for", () => {
    const heading = { tabIndex: 0, focus: vi.fn() };
    const root = { querySelector: () => heading as never };
    const flags = { first: true, quiet: null as string | null };
    focusEffect(flags, root, "today/root");
    expect(heading.focus).not.toHaveBeenCalled();
    flags.quiet = "library/call:1:summary";
    focusEffect(flags, root, "library/call:1:summary");
    expect(heading.focus).not.toHaveBeenCalled();
    focusEffect(flags, root, "people/root");
    expect(heading.focus).toHaveBeenCalledOnce();
  });

  it("a request that moved nowhere does not swallow the next heading focus the user earns", () => {
    const heading = { tabIndex: 0, focus: vi.fn() };
    const root = { querySelector: () => heading as never };
    const flags = { first: false, quiet: null as string | null };
    navEffect({ type: "today" }, flags, vi.fn()); // already on Today: the history does not move, no focus effect runs
    focusEffect(flags, root, "library/root"); // the user opens Calls next
    expect(heading.focus).toHaveBeenCalledOnce();
    expect(flags.quiet).toBeNull();
  });

  it("ticks every second while recording and stops on cleanup", () => {
    vi.useFakeTimers();
    const set = vi.fn();
    expect(tickWhile(false, set)).toBeUndefined();
    const stop = tickWhile(true, set, () => 42)!;
    vi.advanceTimersByTime(2500);
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith(42);
    stop();
    vi.advanceTimersByTime(3000);
    expect(set).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("inspector exit (D-13)", () => {
  it("slides out for 250 ms, and not at all under Reduce Motion", () => {
    expect(exitMs()).toBe(250); // no matchMedia in the unit environment
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(exitMs()).toBe(0);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(exitMs()).toBe(250);
    vi.unstubAllGlobals();
  });

  it("keeps the layer drawn for the slide, then lets it go; nothing runs while it is open", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    expect(leaveTimer(false, done)).toBeUndefined();
    const cancel = leaveTimer(true, done, 250)!;
    vi.advanceTimersByTime(249);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledOnce();
    cancel();
    vi.useRealTimers();
  });

  it("returns focus to the opener the moment the inspector closes, without waiting for the slide", () => {
    const opener = { focus: vi.fn(), isConnected: true };
    const inspector = { focus: vi.fn() };
    expect(openFocus(false, inspector, () => opener)).toBeUndefined();
    const close = openFocus(true, inspector, () => opener)!;
    expect(inspector.focus).toHaveBeenCalledOnce();
    expect(opener.focus).not.toHaveBeenCalled();
    close();
    expect(opener.focus).toHaveBeenCalledOnce();
  });
});

describe("layoutFor", () => {
  const input = { windowWidth: 1170, zoom: 100, sidebarWidth: 220, inspectorWidth: null, need: { full: 0, singleColumn: 0, fewerColumns: 0 } };

  it("takes the sidebar's width from the content only while it is docked and shown", () => {
    expect(layoutFor(input, false).widthClass).toBe("medium"); // 1170 − 220 = 950 pt of content
    expect(layoutFor(input, true).widthClass).toBe("wide"); // hidden: all 1170 pt are content
  });

  it("gives the width back when the sidebar collapsed into an overlay", () => {
    const r = layoutFor({ ...input, windowWidth: 800 }, false);
    expect(r.sidebar).toBe("overlay");
    expect(r.widthClass).toBe("medium"); // 800 pt of content, not 580 (Narrow)
  });
});
