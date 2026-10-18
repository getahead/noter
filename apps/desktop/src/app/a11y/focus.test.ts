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
    expect(FOCUSABLE).toContain("button:not(:disabled)"); // also a button inside a disabled fieldset
    expect(FOCUSABLE).toContain('[tabindex]:not(:disabled):not([tabindex="-1"])');
    expect(FOCUSABLE).toContain('[contenteditable]:not([contenteditable="false"])');
  });
});

type Listener = (e: never) => void;
const focus = { active: undefined as unknown };
const shownBox = { closest: () => null, getClientRects: () => [{}] };
function fakeDoc(items: { sheet?: unknown[]; hiddenModalAfter?: boolean; page: unknown[]; active?: unknown }) {
  const l: Record<string, Listener> = {};
  focus.active = items.active;
  const modals = [
    ...(items.sheet ? [{ ...shownBox, querySelectorAll: () => items.sheet }] : []),
    ...(items.hiddenModalAfter ? [{ closest: () => ({}), getClientRects: () => [], querySelectorAll: () => [] }] : []),
  ];
  const doc = {
    get activeElement() {
      return focus.active;
    },
    addEventListener: (t: string, f: Listener) => void (l[t] = f),
    removeEventListener: (t: string) => void delete l[t],
    querySelectorAll: (s: string) => (s.startsWith("[aria-modal") ? modals : items.page),
    defaultView: { getComputedStyle: (el: { overflow?: string }) => ({ overflowY: el.overflow ?? "visible" }) },
  };
  return { doc: doc as unknown as Document, l };
}
/** A candidate control; `takes: false` refuses focus as WebKit does for some it cannot focus. */
const el = (name: string, takes = true) => {
  const e = { name, ...shownBox, focus: vi.fn(() => void (takes && (focus.active = e))) };
  return e;
};
const tab = (o = {}) => ({ key: "Tab", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, defaultPrevented: false, preventDefault: vi.fn(), ...o });

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
    expect(a.focus).toHaveBeenCalledTimes(1);
    expect(focus.active).toBe(a);
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

  it("moves past a control that refuses focus instead of sticking on it", () => {
    const [a, refuses, b] = [el("a"), el("r", false), el("b")];
    const { doc, l } = fakeDoc({ page: [a, refuses, b], active: a });
    installTabNavigation(doc);
    l.keydown!(tab() as never);
    expect(refuses.focus).toHaveBeenCalled();
    expect(focus.active).toBe(b);
  });

  it("skips visibility: hidden controls", () => {
    const [a, b] = [el("a"), el("b")];
    const invisible = { ...el("i"), ownerDocument: { defaultView: { getComputedStyle: () => ({ visibility: "hidden" }) } } };
    const { doc, l } = fakeDoc({ page: [a, invisible, b], active: a });
    installTabNavigation(doc);
    l.keydown!(tab() as never);
    expect(invisible.focus).not.toHaveBeenCalled();
    expect(focus.active).toBe(b);
  });

  it("keeps the trap in the visible sheet although a closed dialog is retained after it", () => {
    const [p, s1, s2] = [el("p"), el("s1"), el("s2")];
    const { doc, l } = fakeDoc({ page: [p, s1, s2], sheet: [s1, s2], hiddenModalAfter: true, active: s2 });
    installTabNavigation(doc);
    l.keydown!(tab() as never);
    expect(focus.active).toBe(s1);
  });

  it("stops once per radio group: on its checked radio, else its first", () => {
    const radio = (name: string, group: string, checked = false) => Object.assign(el(name), { type: "radio", name: group, checked });
    const [a, r1, r2, s1, s2, b] = [el("a"), radio("r1", "g"), radio("r2", "g", true), radio("s1", "h"), radio("s2", "h"), el("b")];
    const { doc, l } = fakeDoc({ page: [a, r1, r2, s1, s2, b], active: a });
    installTabNavigation(doc);
    l.keydown!(tab() as never);
    expect(focus.active).toBe(r2);
    l.keydown!(tab() as never);
    expect(focus.active).toBe(s1);
    l.keydown!(tab() as never);
    expect(focus.active).toBe(b);
  });

  it("leaves a Tab that another handler already took", () => {
    const [a, b] = [el("a"), el("b")];
    const { doc, l } = fakeDoc({ page: [a, b], active: a });
    installTabNavigation(doc);
    l.keydown!(tab({ defaultPrevented: true }) as never);
    expect(b.focus).not.toHaveBeenCalled();
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
