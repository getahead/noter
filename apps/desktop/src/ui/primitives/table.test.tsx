import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Table, Th } from "./table";

describe("Table (cpt-noter-dod-ui-primitives-controls)", () => {
  it("renders the prototype's table() markup and data attributes", () => {
    const html = renderToString(<Table label="Calls" region="LC-R3" id="ignored"><tbody><tr tabIndex={0}><td>Retro</td></tr></tbody></Table>);
    expect(html).toMatch(/^<div class="np-table-wrap"><table class="np-table" data-component="cpt-noter-component-ui-primitives" data-primitive="table" data-variant="sortable" data-region="LC-R3" aria-label="Calls">/);
    expect(html).not.toContain('id="ignored"');
  });

  it("takes another variant and extra classes", () => {
    const html = renderToString(<Table variant="outline" cls="x" wrapCls="w"><tbody /></Table>);
    expect(html).toContain('class="np-table-wrap w"');
    expect(html).toContain('class="np-table x"');
    expect(html).toContain('data-variant="outline"');
  });
});

describe("Th", () => {
  it("is a column header with its sort state and arrow", () => {
    const html = renderToString(<table><thead><tr><Th label="Date" sort="desc" width="120px" /></tr></thead></table>);
    expect(html).toContain('<th scope="col" aria-sort="descending" style="width:120px">Date<svg class="np-ic np-th__sort"');
    expect(renderToString(<table><thead><tr><Th label="A" sort="asc" /></tr></thead></table>)).toContain('aria-sort="ascending"');
  });

  it("is reachable by keyboard only when it sorts", () => {
    expect(renderToString(<table><thead><tr><Th label="Title" /></tr></thead></table>)).toBe('<table><thead><tr><th scope="col">Title</th></tr></thead></table>');
    expect(renderToString(<table><thead><tr><Th label="Title" onSort={() => {}} /></tr></thead></table>)).toContain('tabindex="0"');
  });
});

describe("Table and Th keys", () => {
  it("moves between focusable rows with ↑/↓ and sorts on Return, Space or a click", async () => {
    const { find, rendered } = await import("../testing");
    const focus = vi.fn();
    const row = { focus, contains: () => false };
    const table = find(rendered(Table, { children: null }), (_, t) => t === "table");
    const e = { key: "ArrowDown", target: null, preventDefault: vi.fn(), currentTarget: { querySelectorAll: (sel: string) => (sel === "tbody tr[tabindex]" ? [row] : []) } };
    (table.props.onKeyDown as (e: unknown) => void)(e);
    expect(focus).toHaveBeenCalled();

    const onSort = vi.fn();
    const th = Th({ label: "Date", onSort });
    const press = (key: string) => th.props.onKeyDown({ key, preventDefault: vi.fn() });
    press("Enter");
    press(" ");
    press("a");
    th.props.onClick();
    expect(onSort).toHaveBeenCalledTimes(3);
  });
});

describe("TextCell (cpt-noter-algo-ui-primitives-fit-labels)", () => {
  it("tail-truncates and keeps the full text in a help tag and for VoiceOver", async () => {
    const { TextCell } = await import("./table");
    const long = "Quarterly planning with the platform team and Anna";
    const html = renderToString(<table><tbody><tr><TextCell text={long} /></tr></tbody></table>);
    expect(html).toContain(`<td class="np-td--trunc" title="${long}">${long}</td>`);
  });
});
