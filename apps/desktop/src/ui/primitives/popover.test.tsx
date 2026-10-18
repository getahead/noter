import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { closeOnOutside, measure, placeFloating, Popover } from "./popover";

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
  it("closes on Esc without closing what holds it", async () => {
    const { find, rendered } = await import("../testing");
    const onClose = vi.fn();
    const stopPropagation = vi.fn();
    const pop = find(rendered(Popover, { anchor: null, onClose }), (p) => p.role === "dialog");
    const keyDown = pop.props.onKeyDown as (e: unknown) => void;
    keyDown({ key: "Escape", stopPropagation });
    keyDown({ key: "a", stopPropagation });
    expect(onClose).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });

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

  it("measures itself against its anchor and the window", () => {
    vi.stubGlobal("innerWidth", 1000);
    vi.stubGlobal("innerHeight", 800);
    const el = { offsetWidth: 300, offsetHeight: 200 } as HTMLElement;
    const anchor = { getBoundingClientRect: () => ({ left: 100, right: 180, top: 40, bottom: 60 }) } as unknown as HTMLElement;
    expect(measure(el, anchor)).toEqual({ left: 100, top: 66 });
    expect(measure(el, null)).toEqual({ left: 350, top: 80 });
    expect(measure(null, anchor)).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("Popover Esc", () => {
  it("leaves an Esc an inner control already handled (a search field clearing its text)", async () => {
    const { find, rendered } = await import("../testing");
    const onClose = vi.fn();
    const dialog = find(rendered(Popover, { anchor: null, label: "Speakers", onClose }), (p) => p.role === "dialog");
    const key = (defaultPrevented: boolean) => (dialog.props.onKeyDown as (e: unknown) => void)({ key: "Escape", defaultPrevented, stopPropagation: vi.fn() });
    key(true);
    expect(onClose).not.toHaveBeenCalled();
    key(false);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
