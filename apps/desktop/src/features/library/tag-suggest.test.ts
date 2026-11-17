import { describe, expect, it } from "vitest";
import { heldFilter, holdFilter, BLANK } from "./filters";
import { holdTag, listKey, tagChoice, tagMatches } from "./tag-suggest";

describe("# tag suggestions (cpt-noter-algo-ui-library-search-topics-filters)", () => {
  it("a # word naming a tag in use is a choice, any other text is a search", () => {
    expect(tagChoice("#Release", ["release", "hotfix"])).toBe("release");
    expect(tagChoice("#rel", ["release"])).toBeNull();
    expect(tagChoice("release", ["release"])).toBeNull();
    expect(tagChoice("#two words", ["two"])).toBeNull();
  });
  it("a chosen tag adds the tag filter once", () => {
    holdFilter(BLANK);
    holdTag("release");
    holdTag("release");
    expect(heldFilter().filter.tags).toEqual(["release"]);
    holdFilter(BLANK);
  });
});

describe("tagMatches (the list under the search field)", () => {
  it("lists the tags that contain what follows the #, only while a # is being typed", () => {
    const tags = ["release", "vhi-8.0", "backend", "release-notes"];
    expect(tagMatches("#", tags)).toEqual(tags);
    expect(tagMatches("#rel", tags)).toEqual(["release", "release-notes"]);
    expect(tagMatches("#release", tags)).toEqual(["release", "release-notes"]); // typing "#back" never blocks "#backend": nothing is taken until Return or a pick
    expect(tagMatches("rel", tags)).toEqual([]);
    expect(tagMatches("#x", tags)).toEqual([]);
    expect(tagMatches("#", Array.from({ length: 12 }, (_, i) => `t${i}`))).toHaveLength(8);
  });
});

describe("listKey (↑ ↓ Return in the list)", () => {
  it("moves the active row with the arrows (wrapping), Return picks it, any other key leaves the field alone", () => {
    expect(listKey("ArrowDown", -1, 3)).toEqual({ active: 0 });
    expect(listKey("ArrowDown", 2, 3)).toEqual({ active: 0 });
    expect(listKey("ArrowUp", -1, 3)).toEqual({ active: 2 });
    expect(listKey("ArrowUp", 1, 3)).toEqual({ active: 0 });
    expect(listKey("Enter", 1, 3)).toEqual({ active: 1, pick: 1 });
    expect(listKey("Enter", -1, 3)).toBeNull(); // nothing active: Return runs the search (or takes an exact #tag)
    expect(listKey("a", 0, 3)).toBeNull();
    expect(listKey("ArrowDown", -1, 0)).toBeNull();
  });
});
