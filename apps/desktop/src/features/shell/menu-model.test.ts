import { describe, expect, it, vi } from "vitest";

import { APP_MENU, dispatchNativeMenuShortcut, nativeMenuShortcut, shellActionForMenuItem, shellShortcuts, type MenuItem } from "./menu-model";

const items = APP_MENU.flatMap((m) => m.items).filter((e): e is MenuItem => e !== "separator");

describe("app menu model", () => {
  it("has the seven menus of DESIGN in order", () => {
    expect(APP_MENU.map((m) => m.title)).toEqual(["Noter", "File", "Edit", "View", "Call", "Window", "Help"]);
  });

  it("shows ⌘1 to ⌘8 for the sections and the documented shortcuts", () => {
    const accel = (label: string) => items.find((i) => i.label === label)?.accel;
    expect(items.filter((i) => i.action?.type === "section").map((i) => `${i.label} ${i.accel}`)).toEqual([
      "Today ⌘1",
      "Ask ⌘2",
      "Calls ⌘3",
      "People ⌘4",
      "Topics ⌘5",
      "Activity ⌘6",
      "Agents ⌘7",
      "Performance ⌘8",
    ]);
    expect([accel("Hide Sidebar"), accel("Show Inspector"), accel("Find"), accel("Settings…"), accel("Quit Noter"), accel("Close")]).toEqual(["⌃⌘S", "⌥⌘I", "⌘F", "⌘,", "⌘Q", "⌘W"]);
  });

  it("never gives two items the same chord", () => {
    const chords = items.flatMap((i) => i.chords ?? []);
    expect(new Set(chords).size).toBe(chords.length);
  });

  it("binds each chord of the menu to its action", () => {
    const run = vi.fn();
    const table = shellShortcuts(run);
    table["Meta+Digit3"]!();
    table["Meta+BracketLeft"]!();
    table["Control+Meta+KeyS"]!();
    table["Meta+Shift+Equal"]!();
    expect(run.mock.calls.map(([a]) => a)).toEqual([{ type: "section", section: "library" }, { type: "back" }, { type: "toggle-sidebar" }, { type: "zoom", to: "in" }]);
    expect(table["Meta+KeyQ"]).toBeUndefined(); // ⌘Q stays with the native menu
  });

  it("routes native menu selections through the same shell actions as their shortcuts", () => {
    expect(shellActionForMenuItem("section.library")).toEqual({ type: "section", section: "library" });
    expect(shellActionForMenuItem("menu.back")).toEqual({ type: "back" });
    expect(shellActionForMenuItem("menu.settings")).toEqual({ type: "open-settings" });
    expect(shellActionForMenuItem("menu.export")).toBeUndefined();
  });

  it("routes page menu commands through the focused page's existing keyboard handler", () => {
    expect(nativeMenuShortcut("menu.select_all")).toMatchObject({ code: "KeyA", key: "a", metaKey: true, bubbles: true, cancelable: true });
    expect(nativeMenuShortcut("menu.export")).toMatchObject({ code: "KeyE", key: "e", metaKey: true, shiftKey: false });
    expect(nativeMenuShortcut("menu.copy_for_slack")).toMatchObject({ code: "KeyC", key: "c", metaKey: true, shiftKey: true });
    expect(nativeMenuShortcut("menu.copy_for_jira")).toMatchObject({ code: "KeyC", altKey: true, metaKey: true });
    expect(nativeMenuShortcut("menu.delete")).toMatchObject({ code: "Backspace", metaKey: true });
    expect(nativeMenuShortcut("menu.about_noter")).toBeNull();
  });

  it("dispatches a native menu shortcut to the focused element and reports whether it was handled", () => {
    class TestKeyboardEvent extends Event {
      readonly code: string;
      readonly key: string;
      readonly metaKey: boolean;
      constructor(type: string, init: KeyboardEventInit & { code?: string; key?: string }) {
        super(type, init);
        this.code = init.code ?? "";
        this.key = init.key ?? "";
        this.metaKey = init.metaKey ?? false;
      }
    }
    const dispatchEvent = vi.fn((event: Event) => {
      event.preventDefault();
      return true;
    });
    vi.stubGlobal("document", { activeElement: { dispatchEvent } });
    vi.stubGlobal("KeyboardEvent", TestKeyboardEvent);
    expect(dispatchNativeMenuShortcut("menu.export")).toBe(true);
    const event = dispatchEvent.mock.calls[0]![0] as KeyboardEvent;
    expect(event).toMatchObject({ type: "keydown", code: "KeyE", key: "e", metaKey: true, bubbles: true });
    expect(dispatchNativeMenuShortcut("menu.about_noter")).toBe(false);
    vi.unstubAllGlobals();
  });
});
