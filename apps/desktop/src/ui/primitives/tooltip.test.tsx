import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
  it("keeps the control's own handlers and drives the help tag from pointer, focus and Esc", async () => {
    const { find, rendered } = await import("../testing");
    const own = vi.fn();
    const tree = rendered(Tooltip, { text: "Back (⌘[)", children: <button type="button" onFocus={own} onBlur={own} onKeyDown={own} onPointerEnter={own} onPointerLeave={own}>B</button> });
    const button = find(tree, (_, t) => t === "button").props as Record<string, (e: unknown) => void>;
    const target = { getBoundingClientRect: () => ({ left: 10, bottom: 30 }), matches: () => true };
    button.onPointerEnter({ currentTarget: target });
    button.onPointerLeave({});
    button.onFocus({ currentTarget: target }); // keyboard focus: shows at once (state set outside a render is dropped here)
    button.onFocus({ currentTarget: { ...target, matches: () => { throw new Error("no :focus-visible"); } } });
    button.onKeyDown({ key: "Escape" });
    button.onKeyDown({ key: "a" });
    button.onBlur({});
    expect(own).toHaveBeenCalledTimes(7);
  });

  it("uses the real timers by default", async () => {
    const show = vi.fn();
    helpTag(show).hover();
    await new Promise((r) => setTimeout(r, HELP_TAG_MS + 20));
    expect(show).toHaveBeenCalledWith(true);
  });
});
