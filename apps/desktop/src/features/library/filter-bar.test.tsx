import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilterBar, lookups } from "./filter-bar";
import { apply, BLANK } from "./filters";

const lists = { people: [{ id: "per_a", short_name: "Anna", display_name: "Anna K" }], types: [], tags: [] } as never;
const bar = (s = BLANK) => renderToString(<FilterBar state={s} lists={lists} onAction={() => {}} />);

describe("FilterBar (cpt-noter-component-ui-filter-bar)", () => {
  it("offers the pop-ups and no Clear without filters", () => {
    const html = bar();
    for (const w of ["People", "Type", "Tags", "Language", "Date", "Has Open Items"]) expect(html).toContain(w);
    expect(html).not.toContain("Clear Filters");
  });
  it("shows a token with the person's short name and Clear once a filter is set", () => {
    const html = bar(apply(BLANK, { type: "toggle", group: "people", value: "per_a" }));
    expect(html).toContain("Anna");
    expect(html).toContain("Clear Filters");
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
