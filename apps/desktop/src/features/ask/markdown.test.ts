import { describe, expect, it } from "vitest";

import { blocks, inline } from "./markdown";

describe("markdown (cpt-noter-algo-ui-ask-stream)", () => {
  it("reads bold, italic, code and numbered references", () => {
    expect(inline("a **b** *c* `d` e [2]")).toEqual([
      { t: "text", text: "a " }, { t: "bold", text: "b" }, { t: "text", text: " " }, { t: "italic", text: "c" }, { t: "text", text: " " },
      { t: "code", text: "d" }, { t: "text", text: " e " }, { t: "ref", n: 2 },
    ]);
  });
  it("keeps raw tags and links as text", () => {
    expect(inline("<img src=x onerror=1> [x](javascript:1)")).toEqual([{ t: "text", text: "<img src=x onerror=1> [x](javascript:1)" }]);
  });
  it("splits paragraphs and groups list items", () => {
    expect(blocks("one\ntwo\n\n- a\n- b [1]\n\n1. x\n2. y")).toEqual([
      { t: "p", inline: [{ t: "text", text: "one two" }] },
      { t: "ul", items: [[{ t: "text", text: "a" }], [{ t: "text", text: "b " }, { t: "ref", n: 1 }]] },
      { t: "ol", items: [[{ t: "text", text: "x" }], [{ t: "text", text: "y" }]] },
    ]);
  });
  it("starts a paragraph after a list when plain text follows it", () => {
    expect(blocks("- a\ntail").map((b) => b.t)).toEqual(["ul", "p"]);
  });
});
