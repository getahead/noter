import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchResultRow } from "./SearchResultRow";

const hit = { target: { type: "item", item_id: "i1" }, title: "Planning", snippet: "<img src=x onerror=alert(1)> websocket", highlights: [{ start: 29, end: 38 }], lang: "ru", strength: "weak", call: { id: "c1", title: "Planning" }, cross_language: true } as never;

describe("SearchResultRow (cpt-noter-component-ui-search-result-row)", () => {
  it("marks the highlighted range, escapes the text, keeps the language and the weak tag, and says cross-language", () => {
    const html = renderToString(<SearchResultRow bridge={{} as never} hit={hit} />);
    expect(html).toContain("<mark>websocket</mark>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain('lang="ru"');
    expect(html).toContain('data-strength="weak"');
    expect(html).toContain("Cross-language match");
  });
  it("prints an item's text once (title equal to the snippet) and the call with its date", () => {
    const call = { id: "c1", title: "Backend sync", started_at: Date.UTC(2026, 9, 2, 12), call_type: "ct" };
    const html = renderToString(<SearchResultRow bridge={{} as never} hit={{ ...(hit as object), title: "Fix it", snippet: "Fix it", highlights: [], call } as never} />);
    expect(html.match(/Fix it/g)).toHaveLength(1);
    expect(html).toContain("Backend sync · Oct 2");
  });
});
