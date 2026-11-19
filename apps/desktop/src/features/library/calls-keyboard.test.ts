import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { moveCallsSelection, watchCallsMenuContext } from "./calls-page";
import { updateNativeMenuContext } from "../../core/native-menu";

vi.mock("../../core/native-menu", () => ({ updateNativeMenuContext: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Calls keyboard selection (cpt-noter-flow-ui-library-calls-browse)", () => {
  function fixture() {
    const doc = { activeElement: null as unknown };
    const rows = ["a", "b", "c"].map((id) => ({ dataset: { libRow: id }, contains: () => false, focus() { doc.activeElement = this; } }));
    doc.activeElement = rows[1];
    vi.stubGlobal("document", doc);
    const select = vi.fn();
    const event = (key: string, extra = {}) => ({ key, target: rows[1], currentTarget: { querySelectorAll: () => rows }, preventDefault: vi.fn(), ...extra }) as unknown as KeyboardEvent<HTMLElement>;
    return { rows, doc, select, event };
  }
  it.each([["ArrowDown", "c"], ["ArrowUp", "a"], ["Home", "a"], ["End", "c"]])("%s moves focus, selection and range anchor together", (key, id) => {
    const f = fixture();
    expect(moveCallsSelection(f.event(key), f.select)).toBe(true);
    expect(f.doc.activeElement).toBe(f.rows.find((r) => r.dataset.libRow === id));
    expect(f.select).toHaveBeenCalledWith({ ids: [id], anchor: id });
  });
  it("preserves modified selection, consumed events and text caret navigation", () => {
    const f = fixture();
    for (const extra of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }, { defaultPrevented: true }, { target: { closest: () => ({}) } }])
      expect(moveCallsSelection(f.event("ArrowDown", extra), f.select)).toBe(false);
    expect(f.select).not.toHaveBeenCalled();
  });
});

describe("Calls native Select All context (cpt-noter-dod-ui-main-window-shell-navigation)", () => {
  it("uses app selection only for a focused Calls row and resets after a modal, text focus, blur or unmount", () => {
    const events = new Map<string, () => void>();
    const addEventListener = (name: string, fn: () => void) => events.set(name, fn);
    const removeEventListener = vi.fn();
    let modal = false;
    const doc = { activeElement: { tagName: "TR", closest: () => ({}) } as unknown, querySelector: () => modal ? {} : null, addEventListener, removeEventListener, body: {} };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", { addEventListener, removeEventListener });
    let changed!: () => void;
    const disconnect = vi.fn();
    vi.stubGlobal("MutationObserver", class { constructor(fn: () => void) { changed = fn; } observe() {} disconnect = disconnect; });
    const cleanup = watchCallsMenuContext();
    expect(updateNativeMenuContext).toHaveBeenLastCalledWith({ selectAllCalls: true });
    modal = true; changed();
    expect(updateNativeMenuContext).toHaveBeenLastCalledWith({ selectAllCalls: false });
    modal = false;
    doc.activeElement = { tagName: "TEXTAREA", closest: () => ({}) };
    events.get("focusin")!();
    expect(updateNativeMenuContext).toHaveBeenLastCalledWith({ selectAllCalls: false });
    doc.activeElement = { tagName: "TR", closest: () => ({}) };
    events.get("focusin")!();
    expect(updateNativeMenuContext).toHaveBeenLastCalledWith({ selectAllCalls: true });
    events.get("blur")!();
    expect(updateNativeMenuContext).toHaveBeenLastCalledWith({ selectAllCalls: false });
    cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalled();
  });
});
