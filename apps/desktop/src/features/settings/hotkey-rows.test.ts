import { describe, expect, it } from "vitest";

import type { HotkeyBinding, HotkeyList } from "../../core/bindings";
import { cardKeyConflictCaps, hotkeyRows, undoRow } from "./hotkey-rows";

const b = (action: HotkeyBinding["action"], shortcut: string | null, status: HotkeyBinding["status"] = { type: "registered" }): HotkeyBinding => ({ action, shortcut, default_shortcut: shortcut, status });
const list = (...bindings: HotkeyBinding[]): HotkeyList => ({ version: 1, bindings });

describe("hotkeyRows", () => {
  it("lists the global hotkeys in the pane's order with key caps, leaving the undo chord out", () => {
    const rows = hotkeyRows(list(b("undo_card_action", "Ctrl+Alt+Super+Z"), b("pause", "Ctrl+Alt+Super+P"), b("start_stop", "Ctrl+Alt+Super+R")));
    expect(rows.map((r) => [r.action, r.caps])).toEqual([["start_stop", "⌃⌥⌘R"], ["pause", "⌃⌥⌘P"]]);
    expect(rows[0]!.label).toBe("settings.hotkey.start_stop");
  });

  it("carries the core's conflict line, and an empty chord reads as none", () => {
    const [row] = hotkeyRows(list(b("catch_me_up", null, { type: "conflict", owner: "Raycast" })));
    expect(row).toMatchObject({ caps: "", conflict: "Used by Raycast" });
  });

  it("is empty before hotkeys_list answers", () => expect(hotkeyRows(undefined)).toEqual([]));
});

describe("undoRow", () => {
  it("finds the undo binding", () => {
    expect(undoRow(list(b("undo_card_action", "Ctrl+Alt+Super+Z")))?.caps).toBe("⌃⌥⌘Z");
    expect(undoRow(list(b("pause", null)))).toBeNull();
  });
});

describe("cardKeyConflictCaps", () => {
  it("shows each refused card key as key caps", () => {
    expect(cardKeyConflictCaps(["Ctrl+Alt+Super+3"])).toEqual(["⌃⌥⌘3"]);
    expect(cardKeyConflictCaps(undefined)).toEqual([]);
  });
});
