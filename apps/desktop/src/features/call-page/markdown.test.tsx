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
});
