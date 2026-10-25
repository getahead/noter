import { describe, expect, it, vi } from "vitest";

import {
  chord,
  handleShortcut,
  isTyping,
  matchShortcut,
  useShortcuts,
  type ShortcutEvent,
} from "./keys";

const ev = (code: string, o: Partial<ShortcutEvent> & { key?: string } = {}) =>
  ({
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    target: null,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...o,
  }) as ShortcutEvent;
const input = { tagName: "INPUT", type: "text" } as unknown as EventTarget;

describe("chord", () => {
  it("orders modifiers Control, Alt, Shift, Meta then the code", () => {
    expect(
      chord(ev("KeyR", { ctrlKey: true, altKey: true, metaKey: true })),
    ).toBe("Control+Alt+Meta+KeyR");
    expect(chord(ev("KeyF", { shiftKey: true }))).toBe("Shift+KeyF");
    expect(chord(ev("KeyA"))).toBe("KeyA");
  });
});

describe("isTyping", () => {
  it("is true for text fields, textareas, selects and contenteditable", () => {
    expect(isTyping(input)).toBe(true);
    expect(isTyping({ tagName: "INPUT" } as never)).toBe(true);
    expect(isTyping({ tagName: "TEXTAREA" } as never)).toBe(true);
    expect(isTyping({ tagName: "SELECT" } as never)).toBe(true);
    expect(isTyping({ tagName: "DIV", isContentEditable: true } as never)).toBe(
      true,
    );
  });
  it("is false for buttons, checkboxes, other elements and nothing", () => {
    expect(isTyping({ tagName: "INPUT", type: "checkbox" } as never)).toBe(
      false,
    );
    expect(isTyping({ tagName: "BUTTON" } as never)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe("matchShortcut", () => {
  const a = vi.fn();
  const z = vi.fn();
  it("matches the physical key on a Russian layout", () => {
    expect(
      matchShortcut(ev("KeyA", { key: "ф" } as never), [{ KeyA: a }]),
    ).toBe(a);
  });
  it("maps the German Z/Y swap by position", () => {
    expect(
      matchShortcut(ev("KeyZ", { key: "y" } as never), [{ KeyZ: z }]),
    ).toBe(z);
  });
  it("lets typing win for single keys but not for ⌘ or ⌃", () => {
    expect(
      matchShortcut(ev("KeyA", { target: input }), [{ KeyA: a }]),
    ).toBeNull();
    expect(
      matchShortcut(ev("KeyF", { target: input, metaKey: true }), [
        { "Meta+KeyF": a },
      ]),
    ).toBe(a);
    expect(
      matchShortcut(ev("KeyF", { target: input, ctrlKey: true }), [
        { "Control+KeyF": a },
      ]),
    ).toBe(a);
  });
  it("treats date and time fields as typing", () => {
    for (const type of ["date", "time", "datetime-local", "month", "week"])
      expect(
        matchShortcut(
          ev("KeyA", { target: { tagName: "INPUT", type } as never }),
          [{ KeyA: vi.fn() }],
        ),
      ).toBeNull();
  });

  it("ignores IME composition and key repeat", () => {
    const table = { KeyA: vi.fn() };
    expect(
      matchShortcut(ev("KeyA", { isComposing: true }), [table]),
    ).toBeNull();
    expect(matchShortcut(ev("KeyA", { repeat: true }), [table])).toBeNull();
  });

  it("prefers the region table over the window table, and returns null on no match", () => {
    expect(matchShortcut(ev("KeyA"), [{ KeyA: a }, { KeyA: z }])).toBe(a);
    expect(matchShortcut(ev("KeyA"), [{}, { KeyA: z }])).toBe(z);
    expect(matchShortcut(ev("KeyQ"), [{ KeyA: a }])).toBeNull();
    expect(matchShortcut(ev("constructor"), [{}])).toBeNull();
  });
});

describe("handleShortcut", () => {
  it("runs the action and consumes the event", () => {
    const run = vi.fn();
    const e = ev("KeyA");
    expect(handleShortcut(e, [{ KeyA: run }])).toBe(true);
    expect(run).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });
  it("leaves unmatched events alone", () => {
    const e = ev("KeyQ");
    expect(handleShortcut(e, [{}])).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
  it("useShortcuts returns a handler over the table", () => {
    const run = vi.fn();
    useShortcuts({ KeyA: run })(ev("KeyA"));
    expect(run).toHaveBeenCalled();
  });
});
