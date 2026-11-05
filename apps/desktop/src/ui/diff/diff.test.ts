import { describe, expect, it } from "vitest";
import { changedWords, diffWords, fold, toLines } from "./diff";

describe("diffWords (cpt-noter-component-ui-diff-view)", () => {
  it("marks deleted and inserted words", () => {
    const parts = diffWords("the shaman node", "the Shaman node");
    expect(parts.filter((p) => p.op === "del").map((p) => p.text)).toEqual(["shaman"]);
    expect(parts.filter((p) => p.op === "ins").map((p) => p.text)).toEqual(["Shaman"]);
    expect(changedWords(parts)).toBe(2);
  });

  it("equal text has no changes", () => {
    expect(changedWords(diffWords("same text", "same text"))).toBe(0);
    expect(changedWords(diffWords("", ""))).toBe(0);
  });

  it("handles pure insertion and pure deletion", () => {
    expect(diffWords("", "new").map((p) => p.op)).toEqual(["ins"]);
    expect(diffWords("old", "").map((p) => p.op)).toEqual(["del"]);
  });
});

describe("line cap", () => {
  it("compares whole lines past 60 lines", () => {
    const big = Array.from({ length: 70 }, (_, i) => `a b ${i}`).join("\n");
    const parts = diffWords(big, big.replace("a b 3\n", "a c 3\n"));
    expect(parts.filter((p) => p.op === "del").map((p) => p.text)).toEqual(["a b 3"]);
  });
});

describe("fold", () => {
  const text = (n: number) => Array.from({ length: n }, (_, i) => `line${i}`).join("\n");
  it("folds an unchanged run longer than three lines and keeps shorter ones", () => {
    const long = fold(toLines(diffWords(text(8) + "\nold", text(8) + "\nnew")));
    expect(long.map((b) => b.kind)).toEqual(["fold", "lines"]);
    expect(long[0]!.lines).toHaveLength(8);
    const short = fold(toLines(diffWords(text(3) + "\nold", text(3) + "\nnew")));
    expect(short.map((b) => b.kind)).toEqual(["lines"]);
  });

  it("an unchanged text is one fold when long", () => {
    expect(fold(toLines(diffWords(text(5), text(5)))).map((b) => b.kind)).toEqual(["fold"]);
  });
});
