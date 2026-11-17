import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilterBar, lookups } from "./filter-bar";
import { apply, BLANK } from "./filters";

const lists = { people: [{ id: "per_a", short_name: "Anna", display_name: "Anna K" }], types: [], tags: [] } as never;
const bar = (s = BLANK) => renderToString(<FilterBar state={s} lists={lists} onAction={() => {}} onRun={() => {}} />);

describe("FilterBar (cpt-noter-component-ui-filter-bar)", () => {
  it("offers the pop-ups and no Clear without filters", () => {
    const html = bar();
    for (const w of ["People", "Type", "Tags", "Language", "Date", "Has open items"]) expect(html).toContain(w);
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
