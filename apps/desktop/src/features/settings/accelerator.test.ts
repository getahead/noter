import { describe, expect, it } from "vitest";

import { capsOf, modifierCaps, toAccelerator } from "./accelerator";

const m = (over: object = {}) => ({ control: false, option: false, command: false, shift: false, ...over });
const all = m({ control: true, option: true, command: true });

describe("toAccelerator", () => {
  it("writes Tauri accelerator syntax from the physical code, in Ctrl, Alt, Shift, Super order", () => {
    expect(toAccelerator("KeyU", all)).toBe("Ctrl+Alt+Super+U");
    expect(toAccelerator("Digit3", m({ command: true, shift: true }))).toBe("Shift+Super+3");
    expect(toAccelerator("F5", m({ control: true }))).toBe("Ctrl+F5");
  });

  it.each([
    ["Space", "Space"],
    ["ArrowLeft", "Left"],
    ["Comma", ","],
    ["Numpad7", "Num7"],
  ])("maps %s to %s", (code, key) => expect(toAccelerator(code, m({ control: true }))).toBe(`Ctrl+${key}`));

  it("is null for a code with no accelerator name", () => expect(toAccelerator("IntlBackslash", all)).toBeNull());
});

describe("capsOf", () => {
  it("shows the macOS key caps in ⌃⌥⇧⌘ order", () => {
    expect(capsOf("Ctrl+Alt+Super+C")).toBe("⌃⌥⌘C");
    expect(capsOf("Shift+Super+3")).toBe("⇧⌘3");
    expect(capsOf("Ctrl+Left")).toBe("⌃←");
  });

  it("is empty for no shortcut", () => expect(capsOf(null)).toBe(""));
});

describe("modifierCaps", () => {
  it("shows the modifier set, optionally with ⇧", () => {
    expect(modifierCaps({ control: true, option: true, command: true })).toBe("⌃⌥⌘");
    expect(modifierCaps({ control: true, option: true, command: true, shift: true })).toBe("⌃⌥⇧⌘");
  });
});
