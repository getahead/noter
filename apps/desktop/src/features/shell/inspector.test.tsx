import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { find, rendered } from "../../ui/testing";
import { InspectorSlot } from "./inspector";

const def = { width: 320 as const, label: "shell.inspector" as const, render: () => <p>Item details</p> };

const ROUTE = { section: "library", key: "call:c:transcript" } as const;
const BRIDGE = {} as never;

describe("InspectorSlot (MW-R4)", () => {
  it("draws nothing while no inspector is open", () => {
    expect(renderToString(<InspectorSlot route={ROUTE} bridge={BRIDGE} def={undefined} overlay={false} onClose={vi.fn()} />)).toBe("");
  });

  it("draws the page's inspector at its width with a close button, docked or as an overlay", () => {
    const docked = renderToString(<InspectorSlot route={ROUTE} bridge={BRIDGE} def={def} overlay={false} onClose={vi.fn()} />);
    expect(docked).toContain('data-region="MW-R4"');
    expect(docked).toContain('data-state="open"');
    expect(docked).toContain("width:320px");
    expect(docked).toContain('aria-label="Inspector"');
    expect(docked).toContain("Item details");
    expect(docked).not.toContain("is-overlay");
    expect(docked).not.toContain("inert");
    expect(renderToString(<InspectorSlot route={ROUTE} bridge={BRIDGE} def={def} overlay onClose={vi.fn()} />)).toContain("np-inspector is-overlay");
  });

  it("closes from its × button", () => {
    const onClose = vi.fn();
    (find(rendered(InspectorSlot, { route: ROUTE, bridge: BRIDGE, def, overlay: false, onClose }), (p) => p.label === "Close Inspector").props.onAction as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
