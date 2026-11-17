import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { find, rendered } from "../../ui/testing";
import { SearchView, type Read, type SearchViewProps } from "./SearchPage";

const hit = (strength: "strong" | "weak", call = "c1", title = "T") =>
  ({ target: { type: "item", item_id: "i" }, title, snippet: "websocket", highlights: [{ start: 0, end: 9 }], lang: "en", strength, call: { id: call, title: call }, cross_language: false }) as never;
const results = (o: object = {}): Read => ({ status: "OK", results: { query: "q", mode: { type: "hybrid" }, calls: [], items: [], documents: [], topics: [], only_weak: false, explain: {}, ...o } as never });
const props = (read: Read, o: Partial<SearchViewProps> = {}): SearchViewProps => ({ bridge: {} as never, read, query: "websocket", filter: {}, open: new Set(), onMore: vi.fn(), onRetry: vi.fn(), onClear: vi.fn(), onAsk: vi.fn(), ...o });
const html = (p: SearchViewProps) => renderToString(<SearchView {...p} />);

describe("SearchView (cpt-noter-state-ui-library-search-topics-view)", () => {
  it("LOADING is a busy region; READ_ERROR offers Try Again", () => {
    expect(html(props({ status: "LOADING" }))).toContain('aria-busy="true"');
    const p = props({ status: "READ_ERROR" });
    expect(html(p)).toContain("Couldn’t search your calls");
    const retry = find(rendered(SearchView, p), (x) => Array.isArray((x.banner as { actions?: unknown[] } | undefined)?.actions));
    (retry.props.banner as { actions: { onAction: () => void }[] }).actions[0]!.onAction();
    expect(p.onRetry).toHaveBeenCalled();
  });
  it("NO_MATCHES keeps the query, Ask Instead, and Clear Filters only when filters are set", () => {
    const none = props(results(), { filter: {} });
    expect(html(none)).toContain("No matches for “websocket”");
    expect(html(none)).toContain("Ask Instead");
    expect(html(none)).not.toContain("Clear Filters");
    const filtered = props(results(), { filter: { tags: ["release"] } });
    expect(html(filtered)).toContain("Clear Filters");
    expect(html(filtered)).toContain("1 filter active");
    const ask = find(rendered(SearchView, none), (x) => x.label === "Ask Instead");
    (ask.props.onAction as () => void)();
    expect(none.onAsk).toHaveBeenCalled();
    const clear = find(rendered(SearchView, filtered), (x) => x.label === "Clear Filters");
    (clear.props.onAction as () => void)();
    expect(filtered.onClear).toHaveBeenCalled();
  });
  it("WEAK_ONLY says so and offers the widening actions", () => {
    const h = html(props(results({ items: [hit("weak")], only_weak: true })));
    expect(h).toContain("only weak matches");
    expect(h).toContain("Ask Instead");
  });
  it("RESULTS: items before transcripts, strong first, weaker after, three spans per call and More in This Call", () => {
    const strong = [1, 2, 3, 4].map(() => hit("strong"));
    const h = html(props(results({ items: [hit("strong")], calls: [...strong, hit("weak")] })));
    expect(h.indexOf("Items")).toBeLessThan(h.indexOf("Transcripts"));
    expect(h).toContain("Best matches · keyword and meaning");
    expect(h).toContain("Weaker matches");
    expect(h).toContain("More in This Call");
    const open = html(props(results({ calls: strong }), { open: new Set(["transcripts:c1"]) }));
    expect(open).not.toContain("More in This Call");
    const p = props(results({ calls: strong }));
    (find(rendered(SearchView, p), (x) => x.className === "lb-fbtn").props.onClick as () => void)();
    expect(p.onMore).toHaveBeenCalledWith("transcripts:c1");
  });
  it("shows the keyword-only line while the index rebuilds", () => {
    expect(html(props(results({ mode: { type: "keyword_only", rebuild_progress: 0.4 }, items: [hit("strong")] })))).toContain("Keyword matches only");
  });
});
