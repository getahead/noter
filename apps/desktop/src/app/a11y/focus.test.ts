import { describe, expect, it, vi } from "vitest";

import { createFocusReturn, FOCUSABLE, installTabNavigation, installUnobscure, nextFocusable, unobscuredScrollTop } from "./focus";

describe("createFocusReturn", () => {
  it("goes IN_PAGE → IN_OVERLAY → RETURNED → IN_PAGE and refocuses the opener", () => {
    const opener = { focus: vi.fn(), isConnected: true };
    const first = { focus: vi.fn() };
    const fr = createFocusReturn(() => opener);
    expect(fr.state()).toBe("IN_PAGE");
    fr.close();
    expect(fr.state()).toBe("IN_PAGE");
    fr.open(first);
    expect(fr.state()).toBe("IN_OVERLAY");
    expect(first.focus).toHaveBeenCalled();
    fr.close();
    expect(opener.focus).toHaveBeenCalled();
    expect(fr.state()).toBe("RETURNED");
    fr.moveOn();
    expect(fr.state()).toBe("IN_PAGE");
    fr.moveOn();
    expect(fr.state()).toBe("IN_PAGE");
  });

  it("does not focus an opener that left the document, and tolerates no first control", () => {
    const opener = { focus: vi.fn(), isConnected: false };
    const fr = createFocusReturn(() => opener);
    fr.open();
    fr.close();
    expect(opener.focus).not.toHaveBeenCalled();
    createFocusReturn(() => null).open();
  });
});

describe("nextFocusable", () => {
  const c = ["a", "b", "c"];
  it("moves and wraps both ways", () => {
    expect(nextFocusable(c, "a", false)).toBe("b");
    expect(nextFocusable(c, "c", false)).toBe("a");
    expect(nextFocusable(c, "a", true)).toBe("c");
  });
  it("starts at the first or last when nothing in the list has focus", () => {
    expect(nextFocusable(c, "x", false)).toBe("a");
    expect(nextFocusable(c, "x", true)).toBe("c");
    expect(nextFocusable([], null, false)).toBeUndefined();
  });
  it("selects controls but not disabled, tabindex=-1, hidden or inert ones", () => {
    expect(FOCUSABLE).toContain("button:not([disabled])");
    expect(FOCUSABLE).toContain('[tabindex]:not([disabled]):not([tabindex="-1"])');
  });
});

type Listener = (e: never) => void;
function fakeDoc(items: { sheet?: unknown[]; page: unknown[]; active?: unknown }) {
  const l: Record<string, Listener> = {};
  const doc = {
    activeElement: items.active,
    addEventListener: (t: string, f: Listener) => void (l[t] = f),
    removeEventListener: (t: string) => void delete l[t],
    querySelectorAll: (s: string) => (s.startsWith("[aria-modal") ? (items.sheet ? [{ querySelectorAll: () => items.sheet }] : []) : items.page),
    defaultView: { getComputedStyle: (el: { overflow?: string }) => ({ overflowY: el.overflow ?? "visible" }) },
  };
  return { doc: doc as unknown as Document, l };
}
const el = (name: string) => ({ name, focus: vi.fn(), closest: () => null, getClientRects: () => [{}] });
const tab = (o = {}) => ({ key: "Tab", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, preventDefault: vi.fn(), ...o });

describe("installTabNavigation", () => {
  it("moves focus to the next control and wraps with ⇧Tab", () => {
    const [a, b] = [el("a"), el("b")];
    const { doc, l } = fakeDoc({ page: [a, b], active: a });
    const off = installTabNavigation(doc);
    const e = tab();
    l.keydown!(e as never);
    expect(b.focus).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
    l.keydown!(tab({ shiftKey: true }) as never);
    expect(b.focus).toHaveBeenCalledTimes(2);
    off();
    expect(l.keydown).toBeUndefined();
  });

  it("keeps focus inside an open sheet and skips hidden or inert ancestors", () => {
    const [p, s] = [el("p"), el("s")];
    const hid = { ...el("h"), closest: () => ({}) };
    const unrendered = { ...el("u"), getClientRects: () => [] }; // display: none
    const { doc, l } = fakeDoc({ page: [p], sheet: [hid, unrendered, s], active: p });
    installTabNavigation(doc);
    l.keydown!(tab() as never);
    expect(s.focus).toHaveBeenCalled();
    expect(p.focus).not.toHaveBeenCalled();
    expect(hid.focus).not.toHaveBeenCalled();
    expect(unrendered.focus).not.toHaveBeenCalled();
  });

  it("ignores other keys, other modifiers and an empty page", () => {
    const { doc, l } = fakeDoc({ page: [] });
    installTabNavigation(doc);
    for (const e of [tab({ key: "a" }), tab({ metaKey: true }), tab()]) {
      l.keydown!(e as never);
      expect(e.preventDefault).not.toHaveBeenCalled();
    }
  });
});

describe("unobscuredScrollTop", () => {
  const box = { top: 100, bottom: 500 };
  it("scrolls up below a sticky header, down above a sticky footer, else stays", () => {
    expect(unobscuredScrollTop(200, { top: 110, bottom: 130 }, box, 40, 0)).toBe(170);
    expect(unobscuredScrollTop(200, { top: 480, bottom: 510 }, box, 0, 30)).toBe(240);
    expect(unobscuredScrollTop(200, { top: 200, bottom: 230 }, box, 40, 30)).toBe(200);
  });
});

describe("installUnobscure", () => {
  const rect = (r: object) => () => r;
  it("sets the scroll container's scrollTop on focusin", () => {
    const sticky = { getBoundingClientRect: rect({ top: 100, bottom: 140 }) };
    const groupHeaderBelow = { getBoundingClientRect: rect({ top: 300, bottom: 330 }) }; // sticky, but not stuck now
    const container = {
      overflow: "auto", scrollTop: 200, parentElement: null,
      getBoundingClientRect: rect({ top: 100, bottom: 500 }),
      querySelectorAll: (s: string) => (s.includes("top") ? [groupHeaderBelow, sticky] : []),
    };
    const target = { parentElement: { overflow: "visible", parentElement: container }, getBoundingClientRect: rect({ top: 110, bottom: 130 }) };
    const { doc, l } = fakeDoc({ page: [] });
    const off = installUnobscure(doc);
    l.focusin!({ target } as never);
    expect(container.scrollTop).toBe(170);
    l.focusin!({ target: { parentElement: null, getBoundingClientRect: rect({}) } } as never);
    l.focusin!({ target: {} } as never);
    l.focusin!({ target: null } as never);
    off();
    expect(l.focusin).toBeUndefined();
  });
});
