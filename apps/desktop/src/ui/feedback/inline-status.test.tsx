import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { find, rendered } from "../testing";
import { InlineStatus, statusHandlers } from "./inline-status";
import type { StatusTimer } from "./status-timer";

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
  const timer = () => ({ pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() }) satisfies StatusTimer;

  it("pauses the timer while a status with an action is hovered or focused", () => {
    const t = timer();
    const h = statusHandlers({ current: t }, true);
    h.onPointerEnter?.();
    h.onFocus?.();
    expect(t.pause).toHaveBeenCalledTimes(2);
    h.onPointerLeave?.();
    h.onBlur?.();
    expect(t.resume).toHaveBeenCalledTimes(2);
    statusHandlers({ current: null }, true).onPointerEnter?.(); // not started yet: nothing to pause
  });

  it("a status without an action never pauses", () => {
    expect(statusHandlers({ current: timer() }, false)).toEqual({});
  });
});
