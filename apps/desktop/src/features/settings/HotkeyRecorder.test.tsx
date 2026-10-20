import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { find, rendered } from "../../ui/testing";
import { HotkeyRecorder } from "./HotkeyRecorder";

describe("HotkeyRecorder", () => {
  it("shows the chord as key caps on a field named with its row and chord", () => {
    const html = renderToString(<HotkeyRecorder id="hk-a" label="Catch me up" caps="⌃⌥⌘C" />);
    expect(html).toContain('aria-label="Catch me up: ⌃⌥⌘C. Click to record a new shortcut"');
    expect(html).toContain('data-state="idle"');
    expect(html).toContain("Clear shortcut");
  });

  it("reads None and is cleared when the row has no chord", () => {
    const html = renderToString(<HotkeyRecorder id="hk-a" label="Catch me up" caps="" />);
    expect(html).toContain("None");
    expect(html).toContain('data-state="cleared"');
    expect(html).not.toContain("Clear shortcut");
  });

  it("is a read-only field for the derived variant and has no clear button for a modifier set", () => {
    expect(renderToString(<HotkeyRecorder id="hk-d" label="Dismiss a card" variant="derived" caps="⌃⌥⇧⌘" />)).toContain("hk-field is-ro");
    const set = renderToString(<HotkeyRecorder id="hk-p" label="Pin a card" variant="modifier-set" caps="⌃⌥⌘" />);
    expect(set).toContain("+ 1, 2 or 3");
    expect(set).not.toContain("Clear shortcut");
  });

  it("is disabled with the row dimmed", () => {
    const html = renderToString(<HotkeyRecorder id="hk-a" label="Pin a card" caps="⌃⌥⌘" disabled />);
    expect(html).toContain("hk-row is-disabled");
    expect(html).toContain("disabled");
  });

  it("focuses the field on click, because Safari does not", () => {
    const field = find(rendered(HotkeyRecorder, { id: "hk-a", label: "Catch me up", caps: "⌃⌥⌘C" }), (p, type) => type === "button");
    const focus = vi.fn();
    (field.props.onClick as (e: unknown) => void)({ currentTarget: { focus } });
    expect(focus).toHaveBeenCalled();
  });

  it("ignores keys until recording starts", () => {
    const field = find(rendered(HotkeyRecorder, { id: "hk-a", label: "Catch me up", caps: "⌃⌥⌘C" }), (p, type) => type === "button");
    const preventDefault = vi.fn();
    (field.props.onKeyDown as (e: unknown) => void)({ code: "KeyU", ctrlKey: true, altKey: true, metaKey: true, shiftKey: false, repeat: false, preventDefault, stopPropagation() {} });
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
