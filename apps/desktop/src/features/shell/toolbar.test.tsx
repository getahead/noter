import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { find, rendered } from "../../ui/testing";
import { MainToolbar, OverflowMenu, type ToolbarProps } from "./toolbar";

const props = (over: Partial<ToolbarProps> = {}): ToolbarProps => ({
  title: "Calls",
  subtitle: "212 calls",
  actions: [],
  hasSearch: true,
  narrow: false,
  canBack: true,
  canForward: false,
  showToggle: false,
  search: "",
  searchOpen: false,
  onBack: vi.fn(),
  onForward: vi.fn(),
  onToggleSidebar: vi.fn(),
  onSearch: vi.fn(),
  onRunSearch: vi.fn(),
  onOpenSearch: vi.fn(),
  ...over,
});
const actions = [
  { label: "Export…", onAction: vi.fn() },
  { label: "Record", onAction: vi.fn(), primary: true },
];

describe("MainToolbar (cpt-noter-dod-ui-main-window-shell-frame)", () => {
  it("draws MW-R1: Back and Forward in one capsule, the title and subtitle, the search field", () => {
    const html = renderToString(<MainToolbar {...props()} />);
    expect(html).toContain('data-region="MW-R1"');
    expect(html).toContain('<span class="np-toolbar__nav">');
    expect(html).toContain('<h1 class="np-toolbar__title" title="Calls">Calls</h1>');
    expect(html).toContain("212 calls");
    expect(html).toContain('type="search"');
    expect(html.match(/disabled=""/g)).toHaveLength(1); // Forward at the end of the history
    expect(html).not.toContain("Show Sidebar");
  });

  it("disables Back at the start, and shows the sidebar toggle while the sidebar is hidden", () => {
    const html = renderToString(<MainToolbar {...props({ canBack: false, canForward: true, showToggle: true })} />);
    expect(html).toContain('aria-label="Show Sidebar"');
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });

  it("omits the search field for a page without one", () => {
    expect(renderToString(<MainToolbar {...props({ hasSearch: false })} />)).not.toContain('type="search"');
  });

  it("shows every action at Wide and Medium", () => {
    const html = renderToString(<MainToolbar {...props({ actions })} />);
    expect(html).toContain("Export…");
    expect(html).toContain("Record");
    expect(html).not.toContain('aria-label="More"');
  });

  it("at Narrow keeps the primary action, overflows the rest into », and the search becomes an icon", () => {
    const p = props({ actions, narrow: true });
    const html = renderToString(<MainToolbar {...p} />);
    expect(html).toContain("Record");
    expect(html).not.toContain("Export…");
    expect(html).toContain('aria-label="More"');
    expect(html).not.toContain('type="search"');
    (find(rendered(MainToolbar, p), (x) => x.label === "Search").props.onAction as () => void)();
    expect(p.onOpenSearch).toHaveBeenCalledOnce();
    expect(renderToString(<MainToolbar {...props({ narrow: true, searchOpen: true })} />)).toContain('type="search"');
  });

  it("runs the owner's handlers", () => {
    const p = props({ canForward: true, showToggle: true });
    const tree = rendered(MainToolbar, p);
    (find(tree, (x) => x.label === "Back").props.onAction as () => void)();
    (find(tree, (x) => x.label === "Forward").props.onAction as () => void)();
    (find(tree, (x) => x.label === "Show Sidebar").props.onAction as () => void)();
    (find(tree, (x) => x.id === "mw-search").props.onChange as (v: string) => void)("zoom");
    (find(tree, (x) => x.id === "mw-search").props.onEnter as (v: string) => void)("zoom");
    expect([p.onBack, p.onForward, p.onToggleSidebar].every((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(true);
    expect(p.onSearch).toHaveBeenCalledWith("zoom");
    expect(p.onRunSearch).toHaveBeenCalledWith("zoom");
  });

  it("opens the » menu under its button and runs the chosen action", () => {
    const p = props({ actions, narrow: true });
    vi.stubGlobal("document", { getElementById: () => null });
    (find(rendered(MainToolbar, p), (x) => x.id === "mw-overflow").props.onAction as () => void)();
    vi.unstubAllGlobals();
    const onClose = vi.fn();
    const tree = rendered(OverflowMenu, { actions, anchor: null as never, onClose });
    expect(renderToString(tree)).toContain('data-variant="toolbar-overflow"');
    expect(renderToString(tree)).toContain("Export…");
    expect(renderToString(tree)).toContain('role="menu"');
    const menu = find(tree, (x) => Array.isArray(x.items));
    (menu.props.items as Array<{ onSelect: () => void }>)[0]!.onSelect();
    expect(onClose).toHaveBeenCalledOnce();
    expect(actions[0]!.onAction).toHaveBeenCalledOnce();
  });
});
