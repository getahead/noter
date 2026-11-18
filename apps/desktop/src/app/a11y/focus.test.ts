import { describe, expect, it, vi } from "vitest";

import {
  focusAndReturn,
  focusIfLost,
  focusFirstAvailable,
  FOCUSABLE,
  installTabNavigation,
  installUnobscure,
  nextFocusable,
  notePress,
  openerOf,
  startedFrom,
  unobscuredScrollTop,
} from "./focus";

describe("focusAndReturn", () => {
  it("focuses the overlay control and returns focus to the opener exactly once", () => {
    const opener = { focus: vi.fn(), isConnected: true };
    const first = { focus: vi.fn() };
    const restore = focusAndReturn(first, () => opener);
    expect(first.focus).toHaveBeenCalled();
    expect(opener.focus).not.toHaveBeenCalled();
    restore();
    expect(opener.focus).toHaveBeenCalled();
    restore();
    expect(opener.focus).toHaveBeenCalledOnce();
  });

  it("does not focus an opener that left the document, and tolerates no first control", () => {
    const opener = { focus: vi.fn(), isConnected: false };
    const restore = focusAndReturn(null, () => opener);
    restore();
    expect(opener.focus).not.toHaveBeenCalled();
    focusAndReturn(null, () => null);
  });
});

describe("focusFirstAvailable", () => {
  it("uses the first replacement control that exists after the focused one unmounts", () => {
    const focus = vi.fn();
    const doc = { getElementById: (id: string) => id === "next" ? { focus: vi.fn(), hasAttribute: () => true } : id === "add" ? { focus, hasAttribute: () => false } : null } as unknown as Document;
    expect(focusFirstAvailable(doc, ["next", "add"])).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
  });

  it("reports when every replacement target is missing or disabled", () => {
    const doc = { getElementById: () => null } as unknown as Document;
    expect(focusFirstAvailable(doc, ["missing"])).toBe(false);
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
    expect(FOCUSABLE).toContain(
      '[tabindex]:not(:disabled):not([tabindex="-1"])',
    );
    expect(FOCUSABLE).toContain(
      '[contenteditable]:not([contenteditable="false"])',
    );
  });
});

type Listener = (e: never) => void;
const focus = { active: undefined as unknown };
const shownBox = { closest: () => null, getClientRects: () => [{}] };
function fakeDoc(items: {
  sheet?: unknown[];
  hiddenModalAfter?: boolean;
  page: unknown[];
  active?: unknown;
}) {
  const l: Record<string, Listener> = {};
  focus.active = items.active;
  const modals = [
    ...(items.sheet
      ? [{ ...shownBox, querySelectorAll: () => items.sheet }]
      : []),
    ...(items.hiddenModalAfter
      ? [
          {
            closest: () => ({}),
            getClientRects: () => [],
            querySelectorAll: () => [],
          },
        ]
      : []),
  ];
  const doc = {
    get activeElement() {
      return focus.active;
    },
    addEventListener: (t: string, f: Listener) => void (l[t] = f),
    removeEventListener: (t: string) => void delete l[t],
    querySelectorAll: (s: string) =>
      s.startsWith("[aria-modal") ? modals : items.page,
    defaultView: {
      getComputedStyle: (el: { overflow?: string }) => ({
        overflowY: el.overflow ?? "visible",
      }),
    },
  };
  return { doc: doc as unknown as Document, l };
}
/** A candidate control; `takes: false` refuses focus as WebKit does for some it cannot focus. */
const el = (name: string, takes = true) => {
  const e = {
    name,
    ...shownBox,
    focus: vi.fn(() => void (takes && (focus.active = e))),
  };
  return e;
};
const tab = (o = {}) => ({
  key: "Tab",
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  defaultPrevented: false,
  preventDefault: vi.fn(),
  ...o,
});

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
    const { doc, l } = fakeDoc({
      page: [p],
      sheet: [hid, unrendered, s],
      active: p,
    });
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
    const invisible = {
      ...el("i"),
      ownerDocument: {
        defaultView: { getComputedStyle: () => ({ visibility: "hidden" }) },
      },
    };
    const { doc, l } = fakeDoc({ page: [a, invisible, b], active: a });
    installTabNavigation(doc);
    l.keydown!(tab() as never);
    expect(invisible.focus).not.toHaveBeenCalled();
    expect(focus.active).toBe(b);
  });

  it("keeps the trap in the visible sheet although a closed dialog is retained after it", () => {
    const [p, s1, s2] = [el("p"), el("s1"), el("s2")];
    const { doc, l } = fakeDoc({
      page: [p, s1, s2],
      sheet: [s1, s2],
      hiddenModalAfter: true,
      active: s2,
    });
    installTabNavigation(doc);
    l.keydown!(tab() as never);
    expect(focus.active).toBe(s1);
  });

  it("stops once per radio group: on its checked radio, else its first", () => {
    const radio = (name: string, group: string, checked = false) =>
      Object.assign(el(name), { type: "radio", name: group, checked });
    const [a, r1, r2, s1, s2, b] = [
      el("a"),
      radio("r1", "g"),
      radio("r2", "g", true),
      radio("s1", "h"),
      radio("s2", "h"),
      el("b"),
    ];
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
    expect(
      unobscuredScrollTop(200, { top: 110, bottom: 130 }, box, 40, 0),
    ).toBe(170);
    expect(
      unobscuredScrollTop(200, { top: 480, bottom: 510 }, box, 0, 30),
    ).toBe(240);
    expect(
      unobscuredScrollTop(200, { top: 200, bottom: 230 }, box, 40, 30),
    ).toBe(200);
  });
});

describe("installUnobscure", () => {
  const rect = (r: object) => () => r;
  it("sets the scroll container's scrollTop on focusin", () => {
    const sticky = { getBoundingClientRect: rect({ top: 100, bottom: 140 }) };
    const groupHeaderBelow = {
      getBoundingClientRect: rect({ top: 300, bottom: 330 }),
    }; // sticky, but not stuck now
    const container = {
      overflow: "auto",
      scrollTop: 200,
      parentElement: null,
      getBoundingClientRect: rect({ top: 100, bottom: 500 }),
      querySelectorAll: (s: string) =>
        s.includes("top") ? [groupHeaderBelow, sticky] : [],
    };
    const target = {
      parentElement: { overflow: "visible", parentElement: container },
      getBoundingClientRect: rect({ top: 110, bottom: 130 }),
    };
    const { doc, l } = fakeDoc({ page: [] });
    const off = installUnobscure(doc);
    l.focusin!({ target } as never);
    expect(container.scrollTop).toBe(170);
    l.focusin!({
      target: { parentElement: null, getBoundingClientRect: rect({}) },
    } as never);
    l.focusin!({ target: {} } as never);
    l.focusin!({ target: null } as never);
    off();
    expect(l.focusin).toBeUndefined();
  });
});

describe("focusIfLost (only the body or the page region is lost focus)", () => {
  const target = { hasAttribute: () => false, focus: vi.fn() };
  const doc = (active: unknown) => ({ activeElement: active as never, body: {} as never, getElementById: () => target as never });
  const region = { matches: (s: string) => s.includes('[role="main"]') };
  const row = { matches: () => false }; // a focusable row, option or tabindex element: someone is on it
  it("takes focus from the page region, never from a control or a focusable row", () => {
    expect(focusIfLost(doc(region), ["x"])).toBe(true);
    expect(focusIfLost(doc(row), ["x"])).toBe(false);
    expect(focusIfLost(doc({ matches: (s: string) => s.startsWith("button") }), ["x"])).toBe(false);
  });
});

describe("openerOf (WebKit does not focus a button on click)", () => {
  const body = {};
  const button = { focus: vi.fn() };
  const press = (target: unknown) => notePress({ closest: () => target } as unknown as EventTarget);

  it("takes the focused element when there is one", () => {
    const focused = { focus: vi.fn() };
    press(button);
    expect(openerOf({ activeElement: focused as never, body: body as never })).toBe(focused);
  });

  it("a page region that took focus is no opener: the pressed button is, a focused control still wins", () => {
    // WebKit focuses an ancestor of the clicked button: the page region, or a tabindex -1 section, row or aside
    const ancestor = { focus: vi.fn(), contains: (n: unknown) => n === button };
    press(button);
    expect(openerOf({ activeElement: ancestor as never, body: body as never })).toBe(button);
    const row = { focus: vi.fn(), contains: () => false }; // a focusable row or option the user is on, not around the press
    press(button);
    expect(openerOf({ activeElement: row as never, body: body as never })).toBe(row);
    press(button);
    expect(openerOf({ activeElement: button as never, body: body as never })).toBe(button);
    expect(openerOf({ activeElement: ancestor as never, body: body as never })).toBe(ancestor); // no press left: what had focus
  });

  it("falls back to the button the mouse pressed when focus is on the body", () => {
    press(button);
    expect(openerOf({ activeElement: body as never, body: body as never })).toBe(button);
  });

  it("uses a press once, and a keypress forgets it", () => {
    press(button);
    openerOf({ activeElement: body as never, body: body as never });
    expect(openerOf({ activeElement: body as never, body: body as never })).toBeNull();
    press(button);
    notePress(null);
    expect(openerOf({ activeElement: null, body: body as never })).toBeNull();
  });
});

describe("press tracking on the document", () => {
  it("records a pointerdown target and forgets it on a keydown", async () => {
    const on: Record<string, (e: unknown) => void> = {};
    vi.resetModules();
    vi.stubGlobal("document", { addEventListener: (t: string, f: (e: unknown) => void) => (on[t] = f) });
    const mod = await import("./focus");
    const button = { focus: vi.fn() };
    const body = {};
    on.pointerdown!({ target: { closest: () => button } });
    expect(mod.openerOf({ activeElement: body as never, body: body as never })).toBe(button);
    on.pointerdown!({ target: { closest: () => button } });
    on.keydown!({});
    expect(mod.openerOf({ activeElement: body as never, body: body as never })).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("startedFrom (a Remove button pressed by mouse or keyboard)", () => {
  const body = {};
  const doc = (active: unknown) => ({ activeElement: active as never, body: body as never });
  const press = (target: unknown) => notePress({ closest: () => target } as unknown as EventTarget);

  it("is true for the focused button, and for the pressed one when focus is on the body", () => {
    expect(startedFrom(doc({ id: "repo-remove" }), "repo-remove")).toBe(true);
    press({ id: "repo-remove" });
    expect(startedFrom(doc(body), "repo-remove")).toBe(true);
  });

  it("leaves the press for the sheet or alert that follows (Remove, then Cancel by mouse)", () => {
    const remove = { id: "repo-remove", focus: vi.fn() };
    press(remove);
    expect(startedFrom(doc(body), "repo-remove")).toBe(true);
    expect(openerOf(doc(body))).toBe(remove);
  });

  it("is false after an unrelated click, although focus is on the body then too", () => {
    press({ id: "somewhere-else" });
    expect(startedFrom(doc(body), "repo-remove")).toBe(false);
  });

  it("forgets a press that opened nothing when a surface closes", () => {
    press({ id: "repo-remove" });
    focusAndReturn(null, () => null)();
    expect(startedFrom(doc(body), "repo-remove")).toBe(false);
  });
});

describe("focusIfLost (the button a mouse click never focused, or one a sheet's work replaced)", () => {
  const body = {};
  const field = (active: unknown, target: { focus: () => void } | null) => ({ activeElement: active, body, getElementById: () => target } as never);

  it("focuses the first available id when focus is on the body", () => {
    const target = { focus: vi.fn(), hasAttribute: () => false };
    expect(focusIfLost(field(body, target), ["account-test-claude"])).toBe(true);
    expect(target.focus).toHaveBeenCalledOnce();
  });

  it("never takes focus from a control the user moved to", () => {
    const target = { focus: vi.fn(), hasAttribute: () => false };
    expect(focusIfLost(field({ id: "elsewhere" }, target), ["x"])).toBe(false);
    expect(target.focus).not.toHaveBeenCalled();
  });
});

describe("focusAndReturn when the sheet's own work replaced the opener", () => {
  it("gives focus to the control the opener names as its successor", () => {
    const successor = { focus: vi.fn(), isConnected: true };
    vi.stubGlobal("document", { getElementById: (id: string) => (id === "credential-replace-codex" ? successor : null) });
    const add = { focus: vi.fn(), isConnected: false, getAttribute: () => "credential-replace-codex" };
    focusAndReturn(null, () => add)();
    expect(add.focus).not.toHaveBeenCalled();
    expect(successor.focus).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("falls back to the control with the opener's own id", () => {
    const same = { focus: vi.fn(), isConnected: true };
    vi.stubGlobal("document", { getElementById: (id: string) => (id === "repo-add" ? same : null) });
    focusAndReturn(null, () => ({ id: "repo-add", focus: vi.fn(), isConnected: false } as never))();
    expect(same.focus).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("leaves a gone opener without a successor alone", () => {
    const gone = { focus: vi.fn(), isConnected: false, getAttribute: () => null };
    focusAndReturn(null, () => gone)();
    expect(gone.focus).not.toHaveBeenCalled();
  });
});
