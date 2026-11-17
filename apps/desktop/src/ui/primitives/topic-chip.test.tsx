import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TopicChip } from "./topic-chip";

describe("TopicChip (cpt-noter-component-ui-topic-chip)", () => {
  it("is a button that opens the thread, with counts and the merge glyph when asked", () => {
    const html = renderToString(<TopicChip name="Drawer redesign" counts="6 calls" merge="Merge suggested" size="suggestion" onOpen={() => {}} />);
    expect(html).toContain("<button");
    expect(html).toContain("Drawer redesign");
    expect(html).toContain("6 calls");
    expect(html).toContain("np-topic__merge");
    expect(html).toContain('data-variant="counts"');
    expect(html).toContain("np-topic--suggestion");
  });
  it("is plain text without an opener (read-only rows) and needs no counts", () => {
    const html = renderToString(<TopicChip name="Websocket" />);
    expect(html).not.toContain("<button");
    expect(html).toContain('data-variant="name"');
  });
});
