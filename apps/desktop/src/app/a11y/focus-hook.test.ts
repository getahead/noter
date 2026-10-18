// useFocusReturn runs outside React here: the two hooks it uses are replaced by plain calls (no DOM in unit tests).
import { afterEach, describe, expect, it, vi } from "vitest";

const effects: (() => void | (() => void))[] = [];
vi.mock("react", () => ({ useRef: (v: unknown) => ({ current: v }), useEffect: (f: () => void | (() => void)) => void effects.push(f) }));

const { useFocusReturn } = await import("./focus");

afterEach(() => {
  effects.length = 0;
  vi.unstubAllGlobals();
});

function setup(open: boolean) {
  const l: Record<string, (e: unknown) => void> = {};
  const opener = { focus: vi.fn(), isConnected: true };
  const first = { focus: vi.fn(), closest: () => null, getClientRects: () => [{}] };
  const hidden = { focus: vi.fn(), closest: () => ({}), getClientRects: () => [] }; // in a [hidden] part of the overlay
  vi.stubGlobal("document", { activeElement: opener, addEventListener: (t: string, f: never) => void (l[t] = f), removeEventListener: (t: string) => void delete l[t] });
  const inside = {};
  const overlay = { current: { querySelectorAll: () => [hidden, first], contains: (n: unknown) => n === inside } };
  const onClose = vi.fn();
  useFocusReturn(open, overlay as never, onClose);
  return { l, opener, first, hidden, inside, onClose, run: () => effects.at(-1)!() as (() => void) | undefined };
}

describe("useFocusReturn", () => {
  it("does nothing while closed", () => {
    const t = setup(false);
    expect(t.run()).toBeUndefined();
    expect(t.first.focus).not.toHaveBeenCalled();
  });

  it("focuses the first control, closes on Esc or an outside press, and returns focus on cleanup", () => {
    const t = setup(true);
    const cleanup = t.run()!;
    expect(t.first.focus).toHaveBeenCalled();
    expect(t.hidden.focus).not.toHaveBeenCalled();
    t.l.keydown!({ key: "a" });
    t.l.pointerdown!({ target: t.inside });
    expect(t.onClose).not.toHaveBeenCalled();
    const esc = { key: "Escape", stopPropagation: vi.fn() };
    t.l.keydown!(esc);
    expect(esc.stopPropagation).toHaveBeenCalled(); // window shortcuts never see the Esc that closed the overlay
    t.l.pointerdown!({ target: {} });
    expect(t.onClose).toHaveBeenCalledTimes(2);
    cleanup();
    expect(t.opener.focus).toHaveBeenCalled();
    expect(t.l.keydown).toBeUndefined();
  });

  it("lets only the topmost overlay close on Esc or an outside press", () => {
    const sheet = setup(true);
    const closeSheet = sheet.run()!;
    const sheetKey = sheet.l.keydown!;
    const sheetPress = sheet.l.pointerdown!;
    const menu = setup(true);
    const closeMenu = menu.run()!;
    sheetKey({ key: "Escape", stopPropagation: vi.fn() });
    sheetPress({ target: {} });
    menu.l.keydown!({ key: "Escape", stopPropagation: vi.fn() });
    expect(sheet.onClose).not.toHaveBeenCalled();
    expect(menu.onClose).toHaveBeenCalledTimes(1);
    closeMenu();
    sheetKey({ key: "Escape", stopPropagation: vi.fn() });
    expect(sheet.onClose).toHaveBeenCalledTimes(1);
    closeSheet();
  });
});
