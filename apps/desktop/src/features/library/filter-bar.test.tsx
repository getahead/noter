import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FilterBar, PeopleList, lookups } from "./filter-bar";
import { find, rendered } from "../../ui/testing";
import { apply, BLANK } from "./filters";

const lists = { people: [{ id: "per_a", short_name: "Anna", display_name: "Anna K" }], types: [], tags: [] } as never;
const bar = (s = BLANK) => renderToString(<FilterBar state={s} lists={lists} onAction={() => {}} />);

describe("FilterBar (cpt-noter-component-ui-filter-bar)", () => {
  it("offers the pop-ups and a disabled Clear without filters (#1078)", () => {
    const html = bar();
    for (const w of ["People", "Type", "Tags", "Language", "Date", "Has Open Items"]) expect(html).toContain(w);
    expect(html).toMatch(/<button[^>]*disabled[^>]*><span>Clear<\/span>/);
  });
  it("shows a token with the person's short name and Clear once a filter is set", () => {
    const html = bar(apply(BLANK, { type: "toggle", group: "people", value: "per_a" }));
    expect(html).toContain("Anna");
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*><span>Clear<\/span>/);
  });
  it("the People pop-up is headed People with a search field and a checkbox per person, sorted, without you", () => {
    const row = (id: string, display_name: string, is_you = false) => ({ id, display_name, aliases: [], is_you });
    const l = { people: [row("per_z", "Zoe"), row("per_me", "Me", true), row("per_a", "Anna")], types: [], tags: [] } as never;
    const onAction = vi.fn();
    const h = renderToString(<PeopleList lists={l} held={["per_a"]} onAction={onAction} />);
    expect(h).toContain("<strong>People</strong>");
    expect(h).toContain("Search people");
    expect(h.indexOf("Anna")).toBeGreaterThan(-1);
    expect(h.indexOf("Anna")).toBeLessThan(h.indexOf("Zoe"));
    expect(h).not.toContain("Me<");
    const tree = rendered(PeopleList, { lists: l, held: ["per_a"], onAction });
    const box = find(tree, (p) => p.label === "Zoe");
    (box.props.onAction as () => void)();
    expect(onAction).toHaveBeenCalledWith({ type: "toggle", group: "people", value: "per_z" });
  });
  it("falls back to the id for an unknown person or type", () => {
    expect(lookups(lists).person("x")).toBe("x");
    expect(lookups(lists).type("y")).toBe("y");
  });
});

import { readLists } from "./filter-bar";
describe("readLists", () => {
  it("reads people, call types and tags, and leaves a failed list empty", async () => {
    const bridge = {
      act: async (_k: string, cmd: string) =>
        cmd === "people_list" ? { status: "ok", data: { people: [{ id: "p" }] } } : cmd === "tags_list" ? { status: "ok", data: { tags: [{ tag: "x", calls: 1 }] } } : { status: "error" },
      core: { peopleList: () => 0, callTypesList: () => 0, tagsList: () => 0 },
    };
    const l = await readLists(bridge as never);
    expect(l.people).toHaveLength(1);
    expect(l.tags).toEqual([{ tag: "x", calls: 1 }]);
    expect(l.types).toEqual([]);
  });
});
