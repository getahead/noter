import { describe, expect, it } from "vitest";
import { heldFilter, holdFilter, BLANK } from "./filters";
import { tagChoice, takeTag } from "./tag-suggest";

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
