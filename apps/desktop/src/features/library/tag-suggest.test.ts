import { describe, expect, it } from "vitest";
import { heldFilter, holdFilter, BLANK } from "./filters";
import { tagChoice, tagMatches, takeTag } from "./tag-suggest";

describe("# tag suggestions (cpt-noter-algo-ui-library-search-topics-filters)", () => {
  it("a # word naming a tag in use is a choice, any other text is a search", () => {
    expect(tagChoice("#Release", ["release", "hotfix"])).toBe("release");
    expect(tagChoice("#rel", ["release"])).toBeNull();
    expect(tagChoice("release", ["release"])).toBeNull();
    expect(tagChoice("#two words", ["two"])).toBeNull();
  });
  it("a choice adds the tag filter once", () => {
    holdFilter(BLANK);
    expect(takeTag("#release", ["release"])).toBe(true);
    expect(takeTag("#release", ["release"])).toBe(true);
    expect(heldFilter().filter.tags).toEqual(["release"]);
    expect(takeTag("planning", ["release"])).toBe(false);
    holdFilter(BLANK);
  });
});

describe("tagMatches (the list under the search field)", () => {
  it("lists the tags that contain what follows the #, only while a # is being typed", () => {
    const tags = ["release", "vhi-8.0", "backend", "release-notes"];
    expect(tagMatches("#", tags)).toEqual(tags);
    expect(tagMatches("#rel", tags)).toEqual(["release", "release-notes"]);
    expect(tagMatches("#release", tags)).toEqual(["release-notes"]); // an exact tag is taken as the filter, not listed
    expect(tagMatches("rel", tags)).toEqual([]);
    expect(tagMatches("#x", tags)).toEqual([]);
    expect(tagMatches("#", Array.from({ length: 12 }, (_, i) => `t${i}`))).toHaveLength(8);
  });
});
