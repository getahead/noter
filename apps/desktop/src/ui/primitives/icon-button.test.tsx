import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { IconButton } from "./icon-button";

describe("icon-button", () => {
  it("wires its help tag to the tooltip and accessible description", async () => {
    const html = renderToString(<IconButton icon="sidebar" label="Hide Sidebar" />);
    expect(html).toMatch(/<button[^>]+aria-describedby="[^"]+"[^>]+data-help-tag="Hide Sidebar"/);
    expect(html).toContain('role="tooltip"');
    expect(html).not.toContain('title="Hide Sidebar"');
  });

  it("is a labelled button whose label is also its help tag", () => {
    const html = renderToString(<IconButton icon="sidebar" label="Hide Sidebar" />);
    expect(html).toMatch(/^<button type="button" class="np-ibtn np-ibtn--toolbar" data-component="cpt-noter-component-ui-primitives" data-primitive="icon-button" data-size="toolbar" aria-label="Hide Sidebar" aria-describedby="[^"]+" data-help-tag="Hide Sidebar">/);
    expect(html).toContain('width="15"');
  });

  it("renders the inline size, the on and pressed states and a badge", () => {
    const html = renderToString(<IconButton icon="pin" label="Pin" size="inline" on pressed badge="3" help="Pin this card" cls="x" />);
    expect(html).toContain('class="np-ibtn np-ibtn--inline is-on x"');
    expect(html).toContain('data-size="inline"');
    expect(html).toContain('data-help-tag="Pin this card"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('width="13"');
    expect(html).toContain('<span class="np-ibtn__badge">3</span>');
  });

  it("keeps a disabled reason and takes no action while disabled", async () => {
    const html = renderToString(<IconButton icon="export" label="Export" disabled help="Nothing to export yet" />);
    expect(html).toContain('data-state="disabled"');
    expect(html).toContain('data-help-tag="Nothing to export yet"');
    const onAction = vi.fn();
    const { find, rendered } = await import("../testing");
    (find(rendered(IconButton, { icon: "export", label: "Export", disabled: true, onAction }), (_, type) => type === "button").props.onClick as () => void)();
    expect(onAction).not.toHaveBeenCalled();
    (find(rendered(IconButton, { icon: "export", label: "Export", onAction }), (_, type) => type === "button").props.onClick as () => void)();
    expect(onAction).toHaveBeenCalledOnce();
  });
});
