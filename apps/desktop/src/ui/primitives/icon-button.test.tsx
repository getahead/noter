import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { IconButton } from "./icon-button";

describe("icon-button", () => {
  it("is a labelled button whose label is also its help tag", () => {
    const html = renderToString(<IconButton icon="sidebar" label="Hide Sidebar" />);
    expect(html).toMatch(/^<button type="button" class="np-ibtn np-ibtn--toolbar" data-component="cpt-noter-component-ui-primitives" data-primitive="icon-button" data-size="toolbar" title="Hide Sidebar" aria-label="Hide Sidebar" data-help-tag="Hide Sidebar">/);
    expect(html).toContain('width="15"');
  });

  it("renders the inline size, the on and pressed states and a badge", () => {
    const html = renderToString(<IconButton icon="pin" label="Pin" size="inline" on pressed badge="3" help="Pin this card" cls="x" />);
    expect(html).toContain('class="np-ibtn np-ibtn--inline is-on x"');
    expect(html).toContain('data-size="inline"');
    expect(html).toContain('title="Pin this card"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('width="13"');
    expect(html).toContain('<span class="np-ibtn__badge">3</span>');
  });

  it("keeps a disabled reason and takes no action while disabled", () => {
    const html = renderToString(<IconButton icon="export" label="Export" disabled help="Nothing to export yet" />);
    expect(html).toContain('data-state="disabled"');
    expect(html).toContain('title="Nothing to export yet"');
    const onAction = vi.fn();
    IconButton({ icon: "export", label: "Export", disabled: true, onAction }).props.onClick();
    expect(onAction).not.toHaveBeenCalled();
    IconButton({ icon: "export", label: "Export", onAction }).props.onClick();
    expect(onAction).toHaveBeenCalledOnce();
  });
});
