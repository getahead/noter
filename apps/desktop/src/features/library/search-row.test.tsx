import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { find, rendered } from "../../ui/testing";
import { isPlayingSpan, SearchResultRow, togglePlay } from "./SearchResultRow";

const hit = { target: { type: "item", item_id: "i1" }, title: "Planning", snippet: "<img src=x onerror=alert(1)> websocket", highlights: [{ start: 29, end: 38 }], lang: "ru", strength: "weak", call: { id: "c1", title: "Planning" }, cross_language: true } as never;

describe("SearchResultRow (cpt-noter-component-ui-search-result-row)", () => {
  it.each([
    ["decision", "Decision"], ["action_item", "Action item"],
    ["open_question", "Open question"], ["risk", "Risk"],
  ])("shows the stored known kind %s", (item_kind, label) => {
    const html = renderToString(<SearchResultRow bridge={{} as never} hit={{ ...(hit as object), item_kind } as never} />);
    expect(html).toContain("np-badge--kind");
    expect(html).toContain(label);
  });
  it.each([undefined, null, "future_kind", "__proto__", "constructor", "toString", "hasOwnProperty"])("renders an unsupported or absent kind neutrally: %s", (item_kind) => {
    // Raw wire values can include enum variants this UI does not know yet.
    const html = renderToString(<SearchResultRow bridge={{} as never} hit={{ ...(hit as object), item_kind } as never} />);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("<mark>websocket</mark>");
    expect(html).not.toContain("np-badge--kind");
  });
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
  it("a transcript hit plays its span with Space and ▶, opens it with Return and walks the hits with the arrows", () => {
    const span = { call_id: "c1", t0_ms: 1000, t1_ms: 4000, channel: null };
    const act = vi.fn(async () => ({ status: "ok", data: { playing: true } }));
    const seg = { ...(hit as object), target: { type: "segment", span } } as never;
    const tree = rendered(SearchResultRow, { bridge: { act, core: { audioPlay: vi.fn() } } as never, hit: seg });
    const row = find(tree, (p) => p.className === "lb-hit");
    const press = (key: string) => {
      const e = { key, target: 1, currentTarget: 1, preventDefault: vi.fn() };
      (row.props.onKeyDown as (e: unknown) => void)(e);
      return e;
    };
    expect(press(" ").preventDefault).toHaveBeenCalled();
    expect(act).toHaveBeenLastCalledWith("audio_play", "audio_play", expect.any(Function), expect.anything());
    press("Enter");
    expect(act).toHaveBeenLastCalledWith("window_navigate", "window_navigate", expect.any(Function), expect.anything());
    (find(tree, (p) => p.label === "Play this line").props.onAction as () => void)();
    expect(act).toHaveBeenCalledTimes(3);
    const row2 = { focus: vi.fn() };
    const rows = [{ focus: vi.fn() }, row2, { focus: vi.fn() }];
    vi.stubGlobal("document", { querySelectorAll: () => rows });
    const arrow = (key: string) => (row.props.onKeyDown as (e: unknown) => void)({ key, target: row2, currentTarget: row2, preventDefault: vi.fn() });
    arrow("ArrowDown");
    expect(rows[2]!.focus).toHaveBeenCalled();
    arrow("ArrowUp");
    expect(rows[0]!.focus).toHaveBeenCalled();
    vi.unstubAllGlobals();
    // an item hit has nothing to play
    const none = rendered(SearchResultRow, { bridge: { act } as never, hit });
    expect(() => find(none, (p) => p.label === "Play this line")).toThrow();
  });
  it("togglePlay plays, stops while playing, and says why a refused replay did not start", async () => {
    const span = { call_id: "c1", t0_ms: 0, t1_ms: 1, channel: null };
    const run = (res: unknown) => ({ act: vi.fn(async () => res), core: { audioPlay: vi.fn(), audioStop: vi.fn() } }) as never;
    expect(await togglePlay(run({ status: "ok", data: { playing: true } }), span, false)).toEqual({ playing: true, note: null });
    expect(await togglePlay(run({ status: "ok", data: {} }), span, true)).toEqual({ playing: false, note: null });
    const fail = (code: string) => run({ status: "error", error: { code } });
    expect(await togglePlay(fail("audio_deleted"), span, false)).toEqual({ playing: false, note: "transcript.play.no_audio" });
    expect(await togglePlay(fail("replay_needs_headphones"), span, false)).toMatchObject({ note: "transcript.play.speakers" });
    expect(await togglePlay(fail("internal"), span, false)).toMatchObject({ note: "search.play_failed" });
  });
  it("Pause follows the window's playback: only while playing this span, and it goes back to Play when playback ends or moves on", () => {
    const span = { call_id: "c1", t0_ms: 1000, t1_ms: 4000, channel: null };
    const on = { playing: true, call_id: "c1", position_ms: 1000 } as never;
    expect(isPlayingSpan(on, span)).toBe(true);
    expect(isPlayingSpan({ ...(on as object), position_ms: 4000 } as never, span)).toBe(true);
    expect(isPlayingSpan({ ...(on as object), playing: false } as never, span)).toBe(false); // ended
    expect(isPlayingSpan({ ...(on as object), position_ms: 9000 } as never, span)).toBe(false); // another span
    expect(isPlayingSpan({ ...(on as object), call_id: "c2" } as never, span)).toBe(false);
    expect(isPlayingSpan(null, span)).toBe(false);
    expect(isPlayingSpan(on, null)).toBe(false);
    const seg = { ...(hit as object), target: { type: "segment", span } } as never;
    const label = (playback: unknown) => renderToString(<SearchResultRow bridge={{} as never} hit={seg} playback={playback as never} />);
    expect(label(on)).toContain('aria-label="Pause"');
    expect(label(null)).toContain('aria-label="Play this line"');
    expect(label({ ...(on as object), playing: false })).toContain('aria-label="Play this line"');
  });
});

describe("an item hit is the item's own row (issue 1155)", () => {
  it("cpt-noter-seq-library-search-calls — #1155: draws an action item as its row: owner, text and evidence, without the kind tag or Open at this moment", async () => {
    const { createBridge } = await import("../../app/bridge/bridge");
    const { FakeCore } = await import("../../core/fake/fake-core");
    const fake = new FakeCore({ window: "main" });
    const bridge = createBridge("main", fake);
    await bridge.open();
    const item = fake.world.items.find((i) => i.kind === "action_item")!;
    const hit = { target: { type: "item", item_id: item.id }, item_kind: item.kind, title: item.text, snippet: item.text, highlights: [], lang: null, strength: "strong", call: item.call, provenance: { type: "past_call", call: item.call, span: item.spans[0] }, cross_language: false, item } as never;
    const html = renderToString(<SearchResultRow bridge={bridge} hit={hit} />);
    expect(html).toContain("cpt-noter-component-ui-action-item-row");
    expect(html).not.toContain("np-badge--kind");
    expect(html).not.toContain("Open at this moment");
    bridge.close();
  });
});
