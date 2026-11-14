import type { KeyboardEvent } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Menu, menuKey, submenuKey } from "./menu";

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
  const event = (key: string, target: HTMLElement, items: HTMLElement[]) => ({
    key,
    target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    currentTarget: { querySelectorAll: () => items },
  }) as unknown as KeyboardEvent<HTMLElement>;

  it("moves focus with arrows and prevents default only for handled navigation", () => {
    const first = { focus: vi.fn(), contains: () => false } as unknown as HTMLElement;
    const second = { focus: vi.fn(), contains: () => false } as unknown as HTMLElement;
    const items = [first, second];

    const down = event("ArrowDown", first, items);
    menuKey(down);
    expect(second.focus).toHaveBeenCalledOnce();
    expect(first.focus).not.toHaveBeenCalled();
    expect(down.preventDefault).toHaveBeenCalledOnce();

    const up = event("ArrowUp", second, items);
    menuKey(up);
    expect(first.focus).toHaveBeenCalledOnce();
    expect(up.preventDefault).toHaveBeenCalledOnce();

    const wrapsAtStart = event("ArrowUp", first, items);
    menuKey(wrapsAtStart);
    expect(second.focus).toHaveBeenCalledTimes(2);
    expect(wrapsAtStart.preventDefault).toHaveBeenCalledOnce();

    const wrapsAtEnd = event("ArrowDown", second, items);
    menuKey(wrapsAtEnd);
    expect(first.focus).toHaveBeenCalledTimes(2);
    expect(wrapsAtEnd.preventDefault).toHaveBeenCalledOnce();

    const unhandled = event("Tab", first, items);
    menuKey(unhandled);
    expect(unhandled.preventDefault).not.toHaveBeenCalled();
  });

  it("closes on Esc and stops it reaching an enclosing control", () => {
    const onClose = vi.fn();
    const escape = event("Escape", {} as HTMLElement, []);
    menuKey(escape, onClose);
    expect(onClose).toHaveBeenCalledOnce();
    expect(escape.stopPropagation).toHaveBeenCalledOnce();
    expect(escape.preventDefault).toHaveBeenCalledOnce();
  });
});

describe("Menu items", () => {
  it("runs the item, then closes the menu", async () => {
    const { find, rendered } = await import("../testing");
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const tree = rendered(Menu, { items: [{ label: "Copy", onSelect }, { label: "Plain" }], onClose });
    (find(tree, (p) => p.role === "menuitem").props.onClick as () => void)();
    (tree.props.onKeyDown as (e: unknown) => void)({ key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledTimes(2);
    const plain = rendered(Menu, { items: [{ label: "Plain" }] });
    (find(plain, (p) => p.role === "menuitem").props.onClick as () => void)();
  });
});

describe("Escape inside a sheet (cpt-noter-flow-ui-primitives-operate-control)", () => {
  it("closes only the menu, not the sheet around it", async () => {
    const { sheetKey } = await import("./sheet");
    const e = { key: "Escape", target: { tagName: "BUTTON" }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation: vi.fn() };
    const [closeMenu, cancelSheet] = [vi.fn(), vi.fn()];
    menuKey(e as unknown as KeyboardEvent<HTMLElement>, closeMenu);
    sheetKey(e as unknown as KeyboardEvent<HTMLElement>, cancelSheet); // the same event bubbling up
    expect(closeMenu).toHaveBeenCalledOnce();
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(cancelSheet).not.toHaveBeenCalled();
  });
});

describe("Submenu (Call Type ▸)", () => {
  it("an item with children is a closed pop-up until opened, and lists no child yet", () => {
    const html = renderToString(<Menu items={[{ label: "Call Type", children: [{ label: "Standup" }] }]} />);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Standup");
  });

  it("→ opens it and ← closes it; other keys leave it", () => {
    expect(submenuKey("ArrowRight")).toBe("open");
    expect(submenuKey("ArrowLeft")).toBe("close");
    expect(submenuKey("ArrowDown")).toBeNull();
  });
});
