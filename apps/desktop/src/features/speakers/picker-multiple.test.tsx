import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import type { PersonChip, PersonRow } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { PersonPicker } from "./PersonPicker";
import { candidates, stepActive } from "./picker";

const row = (id: string, name: string, you = false): PersonRow =>
  ({ id, display_name: name, short_name: name.split(" ")[0], initials: name.slice(0, 2), aliases: [], role: null, is_you: you }) as unknown as PersonRow;
const chip = (r: PersonRow): PersonChip => ({ id: r.id, display_name: r.display_name, short_name: r.short_name, initials: r.initials, is_you: r.is_you });
const me = row("per_me", "Me Myself", true);
const anna = row("per_anna", "Anna Kuz");
const boris = row("per_boris", "Boris B");
const bridge = { core: {}, act: async () => ({ status: "ok" }), store: { getState: () => ({ entities: { person: {} } }), subscribe: () => () => {} } } as unknown as Bridge;
const props = (o = {}) => ({ bridge, variant: "popover" as const, participants: [], speakers: [], people: [me, anna, boris], confirmLabel: "x", onPick: vi.fn(), multiple: true as const, selected: [] as PersonChip[], onChange: vi.fn(), ...o });
const key = (k: string) => ({ key: k, metaKey: false, nativeEvent: { isComposing: false }, preventDefault() {} });

describe("candidates (cpt-noter-algo-ui-speakers-picker)", () => {
  it("leaves You out unless a multi-select asks for them", () => {
    const names = (inc: boolean) => candidates([chip(me)], [], [me, anna], inc).flatMap((g) => g.entries.map((e) => e.id));
    expect(names(false)).toEqual(["per_anna"]);
    expect(names(true)).toEqual(["per_me", "per_anna"]);
  });
});

describe("stepActive (cpt-noter-algo-ui-speakers-picker)", () => {
  it("moves through the options and stops at the ends; the last option is the New person row only in single mode", () => {
    // single mode, 3 options + the New row at index 3
    expect([stepActive(-1, 1, 3), stepActive(0, 1, 3), stepActive(3, 1, 3), stepActive(-1, -1, 3)]).toEqual([0, 1, 3, 3]);
    // multi mode: the last index is the last option, so arrows reach every match
    expect([stepActive(-1, 1, 2), stepActive(0, 1, 2), stepActive(1, 1, 2), stepActive(2, 1, 2), stepActive(2, -1, 2)]).toEqual([0, 1, 2, 2, 1]);
    // nothing to highlight: stays unset
    expect(stepActive(-1, 1, -1)).toBe(-1);
  });
});

describe("PersonPicker multiple (cpt-noter-component-ui-person-picker)", () => {
  it("offers You like anyone else, never the New person row, and not what is already chosen", () => {
    const h = renderToString(<PersonPicker {...props({ selected: [chip(anna)] })} />);
    expect(h).toContain("Me Myself");
    expect(h).toContain("Boris B");
    expect(h).not.toContain("New Person");
    expect(h).not.toContain(">Anna Kuz<"); // chosen: a chip, no longer an option
  });
  it("shows the chosen people as chips with a remove cross each", () => {
    const h = renderToString(<PersonPicker {...props({ selected: [chip(anna)] })} />);
    expect(h).toContain("cw-pp__chip");
    expect(h).toContain("Remove Anna");
  });
  it("picking adds a chip and keeps the list open; Backspace on an empty field and the cross remove one", () => {
    const onChange = vi.fn();
    const tree = rendered(PersonPicker, props({ onChange, selected: [chip(anna)] }));
    const option = find(tree, (p) => p.role === "option");
    (option.props.onClick as () => void)();
    expect(onChange).toHaveBeenCalledWith([chip(anna), expect.objectContaining({ is_you: expect.any(Boolean) })]);
    (find(tree, (p) => p.role === "combobox").props.onKeyDown as (e: unknown) => void)(key("Backspace"));
    expect(onChange).toHaveBeenLastCalledWith([]);
    (find(tree, (p) => p.className === "cw-pp__x").props.onClick as () => void)();
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
  it("Return on the highlighted match adds that person and never confirms a single choice", () => {
    const onChange = vi.fn();
    const onConfirm = vi.fn();
    // the field holds "bor", so the first match (Boris) is highlighted
    const tree = rendered(PersonPicker, props({ onChange, onConfirm, value: "bor", selected: [chip(anna)] }));
    (find(tree, (p) => p.role === "combobox").props.onKeyDown as (e: unknown) => void)(key("Enter"));
    expect(onChange).toHaveBeenCalledWith([chip(anna), expect.objectContaining({ id: "per_boris" })]);
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it("single mode is unchanged: the New person row stays and You stays out", () => {
    const h = renderToString(<PersonPicker {...props({ multiple: undefined, selected: undefined })} />);
    expect(h).toContain("New Person");
    expect(h).not.toContain("Me Myself");
  });
});
