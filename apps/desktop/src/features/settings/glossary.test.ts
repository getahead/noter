import { describe, expect, it } from "vitest";

import type { GlossaryTerm } from "../../core/bindings";
import { byTerm, cell, EMPTY_FORM, newTermArgs, splitVariants } from "./glossary";

describe("glossary form", () => {
  it("splits comma-separated variants and drops empty ones", () => expect(splitVariants("a, b ,, c")).toEqual(["a", "b", "c"]));

  it("builds the upsert args of a new term, and nothing while the term is empty", () => {
    expect(newTermArgs({ term: " ostor ", latin: "o-store, O-Store", cyrillic: "остор", spoken: "" })).toEqual({
      term: "ostor",
      variants_latin: ["o-store", "O-Store"],
      variants_cyrillic: ["остор"],
      spoken_forms: [],
      always_apply: false,
    });
    expect(newTermArgs(EMPTY_FORM)).toBeNull();
  });

  it("joins variants for a cell and orders terms by name", () => {
    expect(cell(["a", "b"])).toBe("a, b");
    expect(byTerm([{ term: "shaman" }, { term: "ostor" }] as GlossaryTerm[]).map((t) => t.term)).toEqual(["ostor", "shaman"]);
  });
});
