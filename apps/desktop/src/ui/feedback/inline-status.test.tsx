import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { find, rendered } from "../testing";
import { InlineStatus, statusHandlers } from "./inline-status";
import { statusTimer } from "./status-timer";

const none = () => {};

describe("InlineStatus (cpt-noter-dod-ui-primitives-feedback)", () => {
  it("renders the prototype's markup: a check, the text and a status role", () => {
    const html = renderToString(<InlineStatus text="Copied" onExpire={none} />);
    expect(html).toMatch(/^<span data-component="cpt-noter-component-ui-inline-status" data-variant="trailing" data-state="shown" class="np-istatus np-istatus--trailing" role="status"><svg/);
    expect(html).toContain('<span class="np-istatus__text">Copied</span>');
  });

  it("a notice shows the info glyph; a row outcome carries Undo and a blind feedback its key cap", () => {
    expect(renderToString(<InlineStatus variant="notice" text="Saved as draft" onExpire={none} />)).toContain("np-istatus--notice");
    expect(renderToString(<InlineStatus variant="row-outcome" text="Moved to Done" actionLabel="Undo" onExpire={none} />)).toContain('class="np-link"');
    expect(renderToString(<InlineStatus variant="blind" text="Marked" kbd="⌘M" onExpire={none} />)).toContain("np-kbd");
  });

  it("renders nothing without text", () => {
    expect(renderToString(<InlineStatus text="" onExpire={none} />)).toBe("");
  });

  it("Undo runs the owner's action and hides the status", () => {
    const [onAction, onExpire] = [vi.fn(), vi.fn()];
    const link = find(rendered(InlineStatus, { variant: "row-outcome", text: "Moved", actionLabel: "Undo", onAction, onExpire }), (p) => p.label === "Undo");
    (link.props.onAction as () => void)();
    expect(onAction).toHaveBeenCalledOnce();
    expect(onExpire).toHaveBeenCalledOnce();
  });
});

describe("statusHandlers (cpt-noter-flow-ui-primitives-inline-status)", () => {
  /** The real timer on a clock the test moves by hand. */
  function setup() {
    let now = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    let next = 0;
    const clock = {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => (timers.set(++next, { at: now + ms, fn }), next),
      clearTimeout: (h: unknown) => void timers.delete(h as number),
    };
    const advance = (ms: number) => {
      now += ms;
      for (const [h, t] of [...timers]) if (t.at <= now) (timers.delete(h), t.fn());
    };
    const expired = vi.fn();
    const timer = { current: statusTimer(10000, expired, clock) };
    const h = statusHandlers(timer, { hover: false, focus: false }, true);
    const inside = { contains: (n: unknown) => n === "child" };
    return { h, advance, expired, blur: (to: unknown) => h.onBlur?.({ currentTarget: inside, relatedTarget: to } as never) };
  }

  it("stays paused while focus remains after the pointer leaves", () => {
    const { h, advance, expired, blur } = setup();
    h.onPointerEnter?.();
    h.onFocus?.();
    h.onPointerLeave?.();
    advance(20000);
    expect(expired).not.toHaveBeenCalled();
    blur(null); // focus leaves too: the time runs on
    advance(10000);
    expect(expired).toHaveBeenCalledOnce();
  });

  it("stays paused while hovered after focus leaves, and ignores focus moving inside the status", () => {
    const { h, advance, expired, blur } = setup();
    h.onFocus?.();
    h.onPointerEnter?.();
    blur("child");
    blur(null);
    advance(20000);
    expect(expired).not.toHaveBeenCalled();
    h.onPointerLeave?.();
    advance(10000);
    expect(expired).toHaveBeenCalledOnce();
  });

  it("a status without an action never pauses", () => {
    expect(statusHandlers({ current: null }, { hover: false, focus: false }, false)).toEqual({});
  });
});
