import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourceList, SourceListGroup, SourceListItem, SourceListLive } from "./source-list";

describe("SourceList (cpt-noter-dod-ui-primitives-controls)", () => {
  it("renders the sidebar list of 05-shell.js with its parts", () => {
    const html = renderToString(
      <SourceList>
        <SourceListLive><span>live</span></SourceListLive>
        <SourceListGroup>Library</SourceListGroup>
        <SourceListItem icon="calendar" label="Today" help="Today (⌘1)" selected badge={3} />
        <SourceListItem icon="list" label="Activity" warn />
      </SourceList>,
    );
    expect(html).toContain('<nav class="np-srclist" role="list" data-component="cpt-noter-component-ui-primitives" data-primitive="source-list" aria-label="Sidebar">');
    expect(html).toContain('<div class="np-srclist__live" data-variant="live-row"><span>live</span></div>');
    expect(html).toContain('<div class="np-srclist__group" data-variant="group-header">Library</div>');
    expect(html).toContain('<a href="#" role="listitem" class="np-srclist__item is-sel" data-variant="item" data-state="selected" aria-current="page" title="Today (⌘1)">');
    expect(html).toContain('<span class="np-srclist__label">Today</span><span class="np-srclist__badge" data-variant="badge">3</span>');
    expect(html).toContain('class="np-srclist__item" data-variant="item" data-state="default" aria-current="false"');
    expect(html).toContain('<span class="np-srclist__warn" title="Needs attention"><svg class="np-ic" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="problem"');
  });

  it("reads the item with the label the owner sets", () => {
    expect(renderToString(<SourceListItem icon="inbox" label="Activity" badge={3} warn ariaLabel="Activity, 3 waiting, 1 problem" />)).toContain('aria-label="Activity, 3 waiting, 1 problem"');
  });

  it("selects without following the link", () => {
    const onSelect = vi.fn();
    const preventDefault = vi.fn();
    const el = SourceListItem({ icon: "calendar", label: "Today", onSelect });
    el.props.onClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalled();
  });
});

describe("SourceList keys", () => {
  it("moves between items with ↑/↓", async () => {
    const { find, rendered } = await import("../testing");
    const focus = vi.fn();
    const nav = find(rendered(SourceList, {}), (_, t) => t === "nav");
    (nav.props.onKeyDown as (e: unknown) => void)({ key: "End", target: null, preventDefault: vi.fn(), currentTarget: { querySelectorAll: () => [{ focus, contains: () => false }] } });
    expect(focus).toHaveBeenCalled();
  });

  it("selects even without an owner handler", () => {
    SourceListItem({ icon: "calendar", label: "Today" }).props.onClick({ preventDefault: vi.fn() });
  });
});
