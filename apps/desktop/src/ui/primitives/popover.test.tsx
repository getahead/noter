import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rendered } from "../testing";
import { closeOnEscape, closeOnOutside, measure, placeFloating, Popover, returnFocus, zoomedRegionRoot } from "./popover";

describe("Popover (cpt-noter-dod-ui-primitives-controls)", () => {
  it("renders the prototype's popover as a dialog", () => {
    const html = renderToString(<Popover variant="rename" width={320} label="Rename" anchor={null} onClose={() => {}}><div className="np-pop__body">x</div></Popover>);
    expect(html).toMatch(/^<div class="np-pop" data-component="cpt-noter-component-ui-primitives" data-primitive="popover" data-variant="rename" role="dialog" aria-label="Rename" tabindex="-1" style="width:320px"><div class="np-pop__body">x<\/div><\/div>$/);
  });
});

describe("placeFloating", () => {
  const view = { width: 1000, height: 800 };
  const size = { width: 300, height: 200 };
  it("opens under the anchor, its leading edge aligned", () => {
    expect(placeFloating({ left: 100, right: 180, top: 40, bottom: 60 }, size, view)).toEqual({ left: 100, top: 66 });
  });
  it("aligns the trailing edge for end-aligned popovers", () => {
    expect(placeFloating({ left: 600, right: 700, top: 40, bottom: 60 }, size, view, "end")).toEqual({ left: 400, top: 66 });
  });
  it("stays 8 pt inside the window and opens above when there is no room below", () => {
    expect(placeFloating({ left: 900, right: 990, top: 700, bottom: 720 }, size, view)).toEqual({ left: 692, top: 494 });
    expect(placeFloating({ left: -50, right: 10, top: 40, bottom: 60 }, size, view).left).toBe(8);
  });
  it("centres without an anchor", () => {
    expect(placeFloating(null, size, view)).toEqual({ left: 350, top: 80 });
  });
});

describe("Popover behaviour", () => {
  it("closes on a pointer press outside itself and its anchor", () => {
    let listener: ((e: unknown) => void) | undefined;
    const doc = { addEventListener: vi.fn((_: string, fn: (e: unknown) => void) => (listener = fn)), removeEventListener: vi.fn() };
    vi.stubGlobal("document", doc);
    const inside = {};
    const onAnchor = {};
    const onClose = vi.fn();
    const remove = closeOnOutside({ current: { contains: (n: unknown) => n === inside } as unknown as HTMLElement }, { contains: (n: unknown) => n === onAnchor } as unknown as HTMLElement, onClose);
    listener!({ target: inside });
    listener!({ target: onAnchor });
    expect(onClose).not.toHaveBeenCalled();
    listener!({ target: {} });
    expect(onClose).toHaveBeenCalledOnce();
    remove();
    expect(doc.removeEventListener).toHaveBeenCalledWith("pointerdown", listener);
    closeOnOutside({ current: null }, null, onClose);
    listener!({ target: inside });
    expect(onClose).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("closes on Escape anywhere, unless something already handled it, and stops listening when removed", () => {
    let listener: ((e: unknown) => void) | undefined;
    const root = {} as HTMLElement;
    const doc = { querySelectorAll: () => [root], addEventListener: vi.fn((_: string, fn: (e: unknown) => void) => (listener = fn)), removeEventListener: vi.fn() };
    vi.stubGlobal("document", doc);
    const onClose = vi.fn();
    const remove = closeOnEscape(onClose, root);
    const preventDefault = vi.fn();
    listener!({ key: "Tab", preventDefault });
    listener!({ key: "Escape", defaultPrevented: true, preventDefault });
    expect(onClose).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    listener!({ key: "Escape", defaultPrevented: false, preventDefault, stopPropagation: vi.fn() });
    expect(onClose).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce(); // consumed, so the shell's Esc shortcut skips it
    remove();
    expect(doc.removeEventListener).toHaveBeenCalledWith("keydown", listener);
    vi.unstubAllGlobals();
  });

  it("measures itself against its anchor and the window", () => {
    vi.stubGlobal("innerWidth", 1000);
    vi.stubGlobal("innerHeight", 800);
    const el = { offsetWidth: 300, offsetHeight: 200, closest: () => null } as unknown as HTMLElement;
    const anchor = { getBoundingClientRect: () => ({ left: 100, right: 180, top: 40, bottom: 60 }) } as unknown as HTMLElement;
    expect(measure(el, anchor)).toEqual({ left: 100, top: 66 });
    expect(measure(el, null)).toEqual({ left: 350, top: 80 });
    expect(measure(null, anchor)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("uses the zoomed shell's visible layout coordinates for anchors and viewport bounds", () => {
    const shell = { style: { zoom: "2" } } as HTMLElement;
    vi.stubGlobal("innerWidth", 820);
    vi.stubGlobal("innerHeight", 820);
    vi.stubGlobal("getComputedStyle", () => shell.style);
    const el = { offsetWidth: 100, offsetHeight: 100, closest: () => shell } as unknown as HTMLElement;
    const anchor = { closest: () => shell, getBoundingClientRect: () => ({ left: 40, right: 100, top: 760, bottom: 795 }) } as unknown as HTMLElement;
    expect(measure(el, anchor)).toEqual({ left: 20, top: 274 });
    vi.unstubAllGlobals();
  });
});

describe("returnFocus", () => {
  it("goes to a focusable anchor", () => {
    const anchor = { tabIndex: 0, focus: vi.fn() };
    const restore = vi.fn();
    returnFocus(anchor, restore);
    expect(anchor.focus).toHaveBeenCalledOnce();
    expect(restore).not.toHaveBeenCalled();
  });

  it("falls back to the previous focus when the anchor is no control (tabIndex -1) or absent", () => {
    const anchor = { tabIndex: -1, focus: vi.fn() };
    const restore = vi.fn();
    returnFocus(anchor, restore);
    returnFocus(null, restore);
    expect(anchor.focus).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledTimes(2);
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// #988: the sheet's own bubbling handler must offer Esc to the topmost popover first.
describe("stacked popover Escape", () => {
  function setup() {
    const roots = [{}, {}] as HTMLElement[];
    const listeners = new Set<(event: KeyboardEvent) => void>();
    const doc = {
      querySelectorAll: () => roots,
      addEventListener: vi.fn((_: string, listener: (event: KeyboardEvent) => void) => listeners.add(listener)),
      removeEventListener: vi.fn((_: string, listener: (event: KeyboardEvent) => void) => listeners.delete(listener)),
    };
    vi.stubGlobal("document", doc);
    const event = (composing = false) => ({
      key: "Escape", target: { tagName: "INPUT" }, defaultPrevented: false,
      isComposing: composing, nativeEvent: { isComposing: composing },
      preventDefault() { this.defaultPrevented = true; }, stopPropagation: vi.fn(),
    });
    return { roots, doc, listeners, event };
  }

  it("wires the dialog's Escape to only its topmost popover without closing what holds it", async () => {
    const { find, rendered } = await import("../testing");
    const { roots, event } = setup();
    const close = vi.fn();
    const remove = closeOnEscape(close, roots[0]);
    try {
      const pop = find(rendered(Popover, { anchor: null, onClose: close }), (p) => p.role === "dialog");
      const keyDown = pop.props.onKeyDown as (e: unknown) => void;
      const escape = event();
      keyDown(escape);
      keyDown({ ...event(), key: "a" });
      expect(close).toHaveBeenCalledOnce();
      expect(escape.stopPropagation).toHaveBeenCalledOnce();
      expect(escape.defaultPrevented).toBe(true);
    } finally { remove(); }
  });

  it("leaves an Escape that an inner search control handled or an input method is composing", async () => {
    const { find, rendered } = await import("../testing");
    const { roots, event } = setup();
    const close = vi.fn();
    const remove = closeOnEscape(close, roots[0]);
    try {
      const dialog = find(rendered(Popover, { anchor: null, label: "Speakers", onClose: close }), (p) => p.role === "dialog");
      const keyDown = dialog.props.onKeyDown as (e: unknown) => void;
      keyDown({ ...event(), defaultPrevented: true });
      keyDown(event(true));
      expect(close).not.toHaveBeenCalled();
      keyDown(event());
      expect(close).toHaveBeenCalledOnce();
    } finally { remove(); }
  });

  it("closes the inner popover before its enclosing sheet, even with focus outside the popover", async () => {
    const { sheetKey } = await import("./sheet");
    const { roots, event } = setup();
    const close = vi.fn();
    const cancel = vi.fn();
    const remove = closeOnEscape(close, roots[0]);
    try {
      sheetKey(event() as never, cancel);
      expect(close).toHaveBeenCalledOnce();
      expect(cancel).not.toHaveBeenCalled();
    } finally { remove(); }
  });

  it.each([false, true])("closes only the topmost DOM popover (child registered first: %s)", (childFirst) => {
    const { roots, listeners, event } = setup();
    const outer = vi.fn();
    const inner = vi.fn();
    const removeFirst = closeOnEscape(childFirst ? inner : outer, roots[childFirst ? 1 : 0]);
    const removeSecond = closeOnEscape(childFirst ? outer : inner, roots[childFirst ? 0 : 1]);
    const removeInner = childFirst ? removeFirst : removeSecond;
    const removeOuter = childFirst ? removeSecond : removeFirst;
    try {
      const key = event();
      for (const listener of listeners) listener(key as never);
      expect(inner).toHaveBeenCalledOnce();
      expect(outer).not.toHaveBeenCalled();
      removeInner();
      roots.pop();
      const next = event();
      for (const listener of listeners) listener(next as never);
      expect(outer).toHaveBeenCalledOnce();
    } finally { removeInner(); removeOuter(); }
    expect(listeners.size).toBe(0);
  });

  it("leaves composing and already handled Escape alone", async () => {
    const { sheetKey } = await import("./sheet");
    const { roots, listeners, event } = setup();
    const close = vi.fn();
    const cancel = vi.fn();
    const remove = closeOnEscape(close, roots[0]);
    try {
      const composing = event(true);
      sheetKey(composing as never, cancel);
      for (const listener of listeners) listener(composing as never);
      const handled = { ...event(), defaultPrevented: true };
      sheetKey(handled as never, cancel);
      for (const listener of listeners) listener(handled as never);
      expect(close).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
    } finally { remove(); }
  });
});

describe("a popover in a region Text size zooms (#1190)", () => {
  afterEach(() => vi.unstubAllGlobals());
  // window root > zoomed header > button
  const tree = (zoom: string) => {
    const root = { parentElement: null, nodeType: 1 }; // an element node, as createPortal checks
    const header = { parentElement: root, zoom };
    const anchor = { parentElement: header, closest: (s: string) => (s === ".np-win" ? root : null) } as unknown as HTMLElement;
    vi.stubGlobal("getComputedStyle", (e: { zoom?: string }) => ({ zoom: e.zoom ?? "1" }));
    return { root, anchor };
  };

  it("is drawn at the window root, at system size, when its anchor sits in a zoomed region", () => {
    const { root, anchor } = tree("1.5");
    expect(zoomedRegionRoot(anchor)).toBe(root);
    const out = rendered(Popover, { anchor, onClose: () => {} }) as unknown as { containerInfo?: unknown };
    expect(out.containerInfo).toBe(root); // a portal into the root
  });

  it("stays in place anywhere else, inside its sheet's focus trap", () => {
    expect(zoomedRegionRoot(tree("1").anchor)).toBeNull();
    expect(zoomedRegionRoot({ closest: () => null } as unknown as HTMLElement)).toBeNull();
    expect(zoomedRegionRoot(null)).toBeNull();
  });
});
