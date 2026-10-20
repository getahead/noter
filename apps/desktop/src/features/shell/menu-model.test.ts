import { describe, expect, it, vi } from "vitest";

import { APP_MENU, shellShortcuts, type MenuItem } from "./menu-model";

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
});
