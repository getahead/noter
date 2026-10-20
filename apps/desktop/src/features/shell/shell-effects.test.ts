import { describe, expect, it, vi } from "vitest";

import { exitMs, leaveTimer, openFocus, actionEvent, createScrollMemory, escapeEvent, focusEffect, focusHeading, navEffect, navMove, scrollEffect, tickWhile, watchWidth } from "./shell-effects";

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
    const flags = { first: false, quiet: false };
    navEffect(null, flags, dispatch);
    navEffect({ type: "settings", pane: "general" }, flags, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
    navEffect({ type: "activity" }, flags, dispatch);
    expect(dispatch).toHaveBeenCalledWith({ type: "move", move: { type: "section", section: "activity" } });
    expect(flags.quiet).toBe(true);
  });

  it("restores the scroll position on arrival and saves it on leaving", () => {
    const memory = createScrollMemory();
    memory.save("library/root", 200);
    const el = { scrollTop: 0 };
    const leave = scrollEffect(el, memory, "library/root");
    expect(el.scrollTop).toBe(200);
    el.scrollTop = 450;
    leave();
    expect(memory.top("library/root")).toBe(450);
    scrollEffect(null, memory, "x")(); // no content element yet
  });

  it("focuses the heading after navigation, but not on the first render or for a page the core asked for", () => {
    const heading = { tabIndex: 0, focus: vi.fn() };
    const root = { querySelector: () => heading as never };
    const flags = { first: true, quiet: false };
    focusEffect(flags, root);
    expect(heading.focus).not.toHaveBeenCalled();
    flags.quiet = true;
    focusEffect(flags, root);
    expect(heading.focus).not.toHaveBeenCalled();
    focusEffect(flags, root);
    expect(heading.focus).toHaveBeenCalledOnce();
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
