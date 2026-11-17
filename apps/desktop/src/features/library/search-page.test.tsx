import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BridgeProvider } from "../../app/bridge/context";
import { find, rendered } from "../../ui/testing";
import { BLANK, heldFilter, holdFilter } from "./filters";
import { keepLink, linkIn, SearchPage } from "./SearchPage";
import { SearchResultRow } from "./SearchResultRow";

vi.mock("../shell/navigate", () => ({ navigate: vi.fn() }));
import { navigate } from "../shell/navigate";

describe("SearchPage (cpt-noter-flow-ui-library-search-topics-search)", () => {
  it("reads once for the words and filter; Ask Instead opens a new Ask thread, Clear drops the filters", () => {
    holdFilter({ words: "", filter: { tags: ["release"] } });
    const act = vi.fn(() => new Promise(() => {}));
    let out: never = null as never;
    const Probe = () => ((out = SearchPage({ query: "websocket" }) as never), null);
    renderToString(
      <BridgeProvider value={{ act, core: {}, store: { getState: () => ({ whole: {} }), subscribe: () => () => {} } } as never}>
        <Probe />
      </BridgeProvider>,
    );
    const view = out as { props: { onMore: (g: string) => void; onRetry: () => void; onClear: () => void; onAsk: () => void; filter: object } };
    expect(view.props.filter).toEqual({ tags: ["release"] });
    view.props.onMore("items:c1");
    view.props.onRetry();
    view.props.onAsk();
    expect(navigate).toHaveBeenCalledWith({ section: "ask", key: "new:websocket" });
    view.props.onClear();
    expect(heldFilter().filter).toEqual({});
    holdFilter(BLANK);
  });
});

describe("SearchResultRow actions", () => {
  const row = (target: object, call: object | null = { id: "c1", title: "T" }) => ({ target, title: "T", snippet: "x", highlights: [], lang: null, strength: "strong", call, cross_language: false }) as never;
  const press = (hit: never) => {
    const act = vi.fn().mockResolvedValue({ status: "ok" });
    const bridge = { act, core: { windowNavigate: vi.fn(), openExternal: vi.fn() } };
    const tree = rendered(SearchResultRow, { bridge: bridge as never, hit });
    (find(tree, (p) => p.label === "Open at this moment").props.onAction as () => void)();
    return act;
  };
  it("opens a span at its moment, a document through open_external, an item or summary at its call", () => {
    expect(press(row({ type: "segment", span: { call_id: "c1", t0_ms: 0, t1_ms: 1 } })).mock.calls[0]![1]).toBe("window_navigate");
    expect(press(row({ type: "document", document_id: "d", chunk_id: "k" })).mock.calls[0]![1]).toBe("open_external");
    expect(press(row({ type: "item", item_id: "i" })).mock.calls[0]![1]).toBe("window_navigate");
    expect(press(row({ type: "item", item_id: "i" }, null)).mock.calls.length).toBe(0);
  });
});

describe("linkIn", () => {
  it("finds the link a popover anchors on, and nothing without a wrapper or a link", () => {
    const link = {} as HTMLElement;
    expect(linkIn({ querySelector: (s) => (s === "a" ? link : null) })).toBe(link);
    expect(linkIn({ querySelector: () => null })).toBeNull();
    expect(linkIn(null)).toBeNull();
  });
});

describe("keepLink", () => {
  it("stores the wrapper's link in the ref, and clears it when the wrapper goes", () => {
    const link = {} as HTMLElement;
    const to: { current: HTMLElement | null } = { current: null };
    keepLink(to)({ querySelector: () => link } as unknown as HTMLElement);
    expect(to.current).toBe(link);
    keepLink(to)(null);
    expect(to.current).toBeNull();
  });
});
