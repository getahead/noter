import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HELP_TAG_MS, helpTag, Tooltip } from "./tooltip";

describe("Tooltip (cpt-noter-dod-ui-primitives-controls)", () => {
  it("makes the help tag the control's description and keeps it hidden until shown", () => {
    const html = renderToString(<Tooltip text="Hide Sidebar (⌃⌘S)"><button type="button">S</button></Tooltip>);
    const id = /aria-describedby="([^"]+)"/.exec(html)![1];
    expect(html).toContain('data-help-tag="Hide Sidebar (⌃⌘S)"');
    expect(html).toContain(`<span role="tooltip" class="np-helptag" data-component="cpt-noter-component-ui-primitives" data-primitive="tooltip" data-variant="one" id="${id}" hidden="">Hide Sidebar (⌃⌘S)</span>`);
    expect(html).not.toContain("title=");
  });
});

/** setTimeout/clearTimeout the test fires by hand. */
function timers() {
  const pending = new Map<number, () => void>();
  let n = 0;
  return {
    setTimeout: (fn: () => void) => (pending.set(++n, fn), n),
    clearTimeout: (h: unknown) => void pending.delete(h as number),
    fire: () => [...pending.values()].forEach((fn) => fn()),
    size: () => pending.size,
  };
}

describe("helpTag", () => {
  it("shows after 500 ms of hover and hides when the pointer leaves", () => {
    const t = timers();
    const show = vi.fn();
    const tag = helpTag(show, t);
    const setTimeout = vi.spyOn(t, "setTimeout");
    tag.hover();
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), HELP_TAG_MS);
    expect(HELP_TAG_MS).toBe(500);
    expect(show).not.toHaveBeenCalled();
    t.fire();
    expect(show).toHaveBeenLastCalledWith(true);
    tag.hide();
    expect(show).toHaveBeenLastCalledWith(false);
  });

  it("shows at once on keyboard focus, never on a pointer focus, and leaving before 500 ms shows nothing", () => {
    const t = timers();
    const show = vi.fn();
    const tag = helpTag(show, t);
    tag.focus(false);
    expect(show).not.toHaveBeenCalled();
    tag.focus(true);
    expect(show).toHaveBeenLastCalledWith(true);
    tag.hover();
    tag.hide();
    expect(t.size()).toBe(0);
  });
});

describe("Tooltip wiring", () => {
  it("keeps the control's handlers, delays hover, shows on keyboard focus and cancels on leave or Esc", async () => {
    vi.useFakeTimers();
    const { find, rendered } = await import("../testing");
    const own = vi.fn();
    const tree = rendered(Tooltip, { text: "Back (⌘[)", children: <button type="button" onFocus={own} onBlur={own} onKeyDown={own} onPointerEnter={own} onPointerLeave={own}>B</button> });
    const button = find(tree, (_, t) => t === "button").props as Record<string, (e: unknown) => void>;
    const rect = vi.fn(() => ({ left: 10, bottom: 30 }));
    const target = { getBoundingClientRect: rect, matches: () => true };
    button.onPointerEnter({ currentTarget: target });
    expect(vi.getTimerCount()).toBe(1);
    button.onPointerLeave({});
    expect(vi.getTimerCount()).toBe(0);
    button.onFocus({ currentTarget: target });
    expect(rect).toHaveBeenCalledOnce();
    button.onFocus({ currentTarget: { ...target, matches: () => { throw new Error("no :focus-visible"); } } });
    expect(rect).toHaveBeenCalledOnce();
    button.onPointerEnter({ currentTarget: target });
    button.onKeyDown({ key: "Escape" });
    expect(vi.getTimerCount()).toBe(0);
    button.onKeyDown({ key: "a" });
    button.onBlur({});
    expect(own.mock.calls).toEqual([
      [{ currentTarget: target }],
      [{}],
      [{ currentTarget: target }],
      [{ currentTarget: { ...target, matches: expect.any(Function) } }],
      [{ currentTarget: target }],
      [{ key: "Escape" }],
      [{ key: "a" }],
      [{}],
    ]);
  });

  it("shows the help tag after the hover delay", async () => {
    vi.useFakeTimers();
    const show = vi.fn();
    helpTag(show).hover();
    await vi.advanceTimersByTimeAsync(HELP_TAG_MS);
    expect(show).toHaveBeenCalledWith(true);
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
