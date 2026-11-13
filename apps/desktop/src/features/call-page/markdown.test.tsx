import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownBody } from "./markdown";

const html = (md: string) => renderToStaticMarkup(<MarkdownBody md={md} />);

describe("MarkdownBody", () => {
  it("draws paragraphs, headings, lists and bold as elements", () => {
    expect(html("# Title\n\nA **bold** word and `code`.\n\n- one\n- two")).toBe('<div class="pc-md"><h3>Title</h3><p>A <strong>bold</strong> word and <code>code</code>.</p><ul><li>one</li><li>two</li></ul></div>');
  });
  it("keeps raw HTML as literal text", () => {
    const out = html('<img src=x onerror="alert(1)"> <script>x</script>');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
  });

  it("renders wrapped paragraphs, nested and ordered lists, deeper headings and emphasis safely", () => {
    expect(html("First line\nsoft wrapped.\n\n  - parent\n    - child\n\n1. first\n2. second\n\n### Risks\n\n*emphasis* and [*literal emphasis* link](https://example.test)"))
      .toBe('<div class="pc-md"><p>First line soft wrapped.</p><ul><li>parent<ul><li>child</li></ul></li></ul><ol><li>first</li><li>second</li></ol><h5>Risks</h5><p><em>emphasis</em> and [*literal emphasis* link](https://example.test)</p></div>');
  });
});
