import { describe, expect, it } from "vitest";

import type { Citation } from "../../core/bindings";
import { toMarkdown } from "./copy";

const call = (n: number, o: Partial<Citation> = {}): Citation => ({ n, provenance: { type: "past_call", call: { id: "c", title: "Backend sync", started_at: 0, call_type: "x" }, span: {} } as never, quote: "We ship Friday.", speaker: null, strength: "strong", deleted: false, ...o });

describe("toMarkdown (cpt-noter-algo-ui-ask-copy)", () => {
  it("keeps the answer, then lists citations in first-use order with their quotes", () => {
    const md = toMarkdown({ answer_md: "Ship Friday [2]. Then review [1].", citations: [call(1, { quote: "Review" }), call(2)] });
    expect(md.startsWith("Ship Friday [2]. Then review [1].")).toBe(true);
    expect(md.indexOf("[2] Backend sync")).toBeLessThan(md.indexOf("[1] Backend sync"));
    expect(md).toContain("> We ship Friday.");
  });
  it("names weak and deleted sources, documents without links, and unused citations last", () => {
    const doc = call(3, { provenance: { type: "document", title: "Plan", section: "Q4", source_name: "Drive" } as never, strength: "weak", deleted: true });
    const md = toMarkdown({ answer_md: "A [1].", citations: [doc, call(1)] });
    expect(md).toContain("[3] Plan, Q4, Drive · Weak match · Source deleted");
    expect(md).not.toContain("http");
    expect(md.indexOf("[1]", 6)).toBeLessThan(md.indexOf("[3] Plan"));
  });
  it("copes with other provenance kinds and an empty quote", () => {
    expect(toMarkdown({ answer_md: "x", citations: [call(1, { provenance: { type: "jira", key: "VSTOR-1", url: null } as never, quote: "" })] })).toContain("[1] VSTOR-1");
  });
});
