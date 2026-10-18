import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { find, rendered } from "../testing";
import { EmptyState } from "./empty-state";

describe("EmptyState (cpt-noter-dod-ui-primitives-feedback)", () => {
  it("renders the prototype's first-use empty state: glyph, title, body and a primary action", () => {
    const html = renderToString(<EmptyState title="No calls yet" body="Calls you record show here." actionLabel="Record a Call" />);
    expect(html).toMatch(/^<div data-component="cpt-noter-component-ui-empty-state" data-variant="first-use" class="np-empty np-empty--first-use">/);
    expect(html).toContain('<div class="np-empty__glyph">');
    expect(html).toContain('<div class="np-empty__title">No calls yet</div><div class="np-empty__body">Calls you record show here.</div>');
    expect(html).toContain('<div class="np-empty__act"><button type="button" class="np-btn np-btn--primary np-btn--regular"');
  });

  it("a filtered empty state has no glyph and a secondary action", () => {
    const html = renderToString(<EmptyState variant="filtered" title="No matches" actionLabel="Clear Filters" />);
    expect(html).not.toContain("np-empty__glyph");
    expect(html).toContain("np-btn--secondary");
    expect(html).not.toContain("np-empty__body");
  });

  it("a section empty state is one line of text", () => {
    expect(renderToString(<EmptyState variant="section" title="No open items" />)).toBe(
      '<div data-component="cpt-noter-component-ui-empty-state" data-variant="section" class="np-empty np-empty--section">No open items</div>',
    );
  });

  it("a large empty state carries its own glyph and a link", () => {
    const onLink = vi.fn();
    const tree = rendered(EmptyState, { variant: "large", icon: "people", title: "No people", linkLabel: "Learn More", onLink });
    expect(renderToString(tree)).toContain("np-empty--large");
    const link = find(tree, (p) => p.label === "Learn More");
    (link.props.onAction as () => void)();
    expect(onLink).toHaveBeenCalledOnce();
  });

  it("the action runs the owner's handler", () => {
    const onAction = vi.fn();
    const button = find(rendered(EmptyState, { title: "No calls", actionLabel: "Record", onAction }), (p) => p.label === "Record");
    (button.props.onAction as () => void)();
    expect(onAction).toHaveBeenCalledOnce();
  });
});
