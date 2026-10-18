import type { KeyboardEvent } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Sheet, sheetKey } from "./sheet";

describe("Sheet (cpt-noter-dod-ui-primitives-controls)", () => {
  it("renders the prototype's sheet layer and dialog", () => {
    const html = renderToString(<Sheet title="Export" width={560} onCancel={() => {}}><p>body</p></Sheet>);
    expect(html).toBe('<div class="np-sheet-layer is-new"><div class="np-sheet" data-component="cpt-noter-component-ui-primitives" data-primitive="sheet" data-variant="560" data-state="open" role="dialog" aria-modal="true" aria-label="Export" style="width:560px"><p>body</p></div></div>');
  });

  it("is busy while its command runs", () => {
    const html = renderToString(<Sheet title="Export" busy onCancel={() => {}} />);
    expect(html).toContain('data-state="busy"');
    expect(html).not.toContain("data-variant");
  });
});

function key(k: string, target: object, o: { shiftKey?: boolean; metaKey?: boolean; items?: object[] } = {}) {
  const e = { key: k, target, shiftKey: !!o.shiftKey, metaKey: !!o.metaKey, preventDefault: vi.fn(), currentTarget: { querySelectorAll: () => o.items ?? [] } };
  return e as unknown as KeyboardEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> };
}
const el = (tagName: string) => ({ tagName, focus: vi.fn() });

describe("sheetKey", () => {
  it("cancels on Esc", () => {
    const onCancel = vi.fn();
    sheetKey(key("Escape", el("INPUT")), onCancel);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("runs the default button on Return, and on ⌘Return in a multi-line field", () => {
    const onDefault = vi.fn();
    sheetKey(key("Enter", el("INPUT")), vi.fn(), onDefault);
    sheetKey(key("Enter", el("TEXTAREA")), vi.fn(), onDefault);
    sheetKey(key("Enter", el("BUTTON")), vi.fn(), onDefault); // the focused button runs itself
    expect(onDefault).toHaveBeenCalledOnce();
    sheetKey(key("Enter", el("TEXTAREA"), { metaKey: true }), vi.fn(), onDefault);
    expect(onDefault).toHaveBeenCalledTimes(2);
  });

  it("keeps focus inside: Tab from the last control goes to the first and ⇧Tab back", () => {
    const [a, b] = [el("BUTTON"), el("BUTTON")];
    const tab = key("Tab", b, { items: [a, b] });
    sheetKey(tab, vi.fn());
    expect(a.focus).toHaveBeenCalled();
    expect(tab.preventDefault).toHaveBeenCalled();
    sheetKey(key("Tab", a, { shiftKey: true, items: [a, b] }), vi.fn());
    expect(b.focus).toHaveBeenCalled();
    const inner = key("Tab", a, { items: [a, b] });
    sheetKey(inner, vi.fn());
    expect(inner.preventDefault).not.toHaveBeenCalled();
  });
});

describe("focusInside", () => {
  it("focuses the first control and gives focus back on close", async () => {
    const { focusInside } = await import("./sheet");
    const before = { focus: vi.fn() };
    const first = { focus: vi.fn() };
    vi.stubGlobal("document", { activeElement: before });
    const restore = focusInside({ querySelector: () => first } as unknown as HTMLElement);
    expect(first.focus).toHaveBeenCalled();
    restore();
    expect(before.focus).toHaveBeenCalled();
    const root = { querySelector: () => null, focus: vi.fn() };
    focusInside(root as unknown as HTMLElement);
    expect(root.focus).toHaveBeenCalled(); // no control inside: the dialog itself
    vi.stubGlobal("document", { activeElement: null });
    focusInside(null)();
    vi.unstubAllGlobals();
  });

  it("wires its keys on the dialog", async () => {
    const { find, rendered } = await import("../testing");
    const onCancel = vi.fn();
    const dialog = find(rendered(Sheet, { title: "Export", onCancel }), (p) => p.role === "dialog");
    (dialog.props.onKeyDown as (e: unknown) => void)(key("Escape", el("INPUT")));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("SheetFooter (cpt-noter-algo-ui-primitives-fit-labels)", () => {
  it("puts the default button last, so it stays last when the buttons stack", async () => {
    const { SheetFooter } = await import("./sheet");
    const html = renderToString(<SheetFooter defaultButton={<button>Export</button>}><button>Cancel</button></SheetFooter>);
    expect(html).toBe('<div class="np-sheet__foot"><button>Cancel</button><button>Export</button></div>');
  });
});
