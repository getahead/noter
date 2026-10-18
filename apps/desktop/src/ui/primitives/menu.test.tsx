import type { KeyboardEvent } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Menu, menuKey } from "./menu";

describe("Menu (cpt-noter-dod-ui-primitives-controls)", () => {
  const items = [
    { header: "Share" },
    { label: "Copy as Markdown", kbd: "⌘C", onSelect: () => {} },
    { label: "Language", checked: true },
    { label: "More", submenu: true, disabled: true },
    { divider: true as const },
    { label: "Delete Call…", destructive: true },
  ];

  it("renders the prototype's menu() markup", () => {
    const html = renderToString(<Menu items={items} label="Share" />);
    expect(html).toMatch(/^<div class="np-menu" role="menu" data-component="cpt-noter-component-ui-primitives" data-primitive="menu" data-variant="item-menu" aria-label="Share">/);
    expect(html).toContain('<div class="np-menu__hdr">Share</div>');
    expect(html).toContain('<button type="button" role="menuitem" class="np-menu__item" tabindex="-1"><span class="np-menu__check"></span><span class="np-menu__label">Copy as Markdown</span><span class="np-menu__kbd">⌘C</span></button>');
    expect(html).toContain('role="menuitemcheckbox" class="np-menu__item" tabindex="-1" aria-checked="true"><span class="np-menu__check"><svg');
    expect(html).toMatch(/role="menuitem" class="np-menu__item" tabindex="-1" disabled=""><span class="np-menu__check"><\/span><span class="np-menu__label">More<\/span><svg/);
    expect(html).toContain('<div class="np-menu__sep" role="separator"></div>');
    expect(html).toContain('class="np-menu__item is-danger"');
  });

  it("takes the context-menu variant", () => {
    expect(renderToString(<Menu items={[]} variant="context-menu" />)).toContain('data-variant="context-menu"');
  });
});

describe("menuKey", () => {
  const event = (key: string) => ({ key, target: null, preventDefault: vi.fn(), currentTarget: { querySelectorAll: () => [] } }) as unknown as KeyboardEvent<HTMLElement>;
  it("closes on Esc and lets arrows move between items", () => {
    const onClose = vi.fn();
    menuKey(event("Escape"), onClose);
    expect(onClose).toHaveBeenCalledOnce();
    menuKey(event("ArrowDown"), onClose);
    menuKey(event("Escape"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("Menu items", () => {
  it("runs the item, then closes the menu", async () => {
    const { find, rendered } = await import("../testing");
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const tree = rendered(Menu, { items: [{ label: "Copy", onSelect }, { label: "Plain" }], onClose });
    (find(tree, (p) => p.role === "menuitem").props.onClick as () => void)();
    (tree.props.onKeyDown as (e: unknown) => void)({ key: "Escape" });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledTimes(2);
    const plain = rendered(Menu, { items: [{ label: "Plain" }] });
    (find(plain, (p) => p.role === "menuitem").props.onClick as () => void)();
  });
});
