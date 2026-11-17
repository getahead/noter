import { describe, expect, it } from "vitest";
import { askRoute, groupByCall, once, sections, segments, statusOf } from "./search-model";

const hit = (strength: "strong" | "weak", call = "c1") => ({ strength, call: { id: call, title: call } }) as never;
const res = (o: object) => ({ calls: [], items: [], documents: [], topics: [], only_weak: false, ...o }) as never;

describe("search presentation (cpt-noter-algo-ui-library-search-topics-results)", () => {
  it("cuts the original text at the highlight ranges and clamps bad ranges", () => {
    expect(segments("Привет мир", [{ start: 7, end: 10 }])).toEqual([{ text: "Привет ", hit: false }, { text: "мир", hit: true }]);
    expect(segments("abc", [{ start: 2, end: 99 }, { start: 1, end: 3 }])).toEqual([{ text: "a", hit: false }, { text: "bc", hit: true }]);
    expect(segments("<b>x</b>", [])).toEqual([{ text: "<b>x</b>", hit: false }]);
  });
  it("names the state: no matches, weak only, results", () => {
    expect(statusOf(res({}))).toBe("NO_MATCHES");
    expect(statusOf(res({ items: [hit("weak")], only_weak: true }))).toBe("WEAK_ONLY");
    expect(statusOf(res({ calls: [hit("strong")] }))).toBe("RESULTS");
  });
  it("orders sections items, transcripts, documents and strong before weak", () => {
    const s = sections(res({ calls: [hit("weak"), hit("strong")], items: [hit("strong")] }));
    expect(s.map((x) => x.key)).toEqual(["items", "transcripts"]);
    expect(s[1]!.strong).toHaveLength(1);
    expect(s[1]!.weak).toHaveLength(1);
  });
  it("shows three spans per call and keeps the rest behind More in This Call", () => {
    const g = groupByCall([hit("strong"), hit("strong"), hit("strong"), hit("strong"), hit("strong", "c2")], 3);
    expect(g.map((x) => [x.shown.length, x.hidden.length])).toEqual([[3, 1], [1, 0]]);
  });
});

describe("Ask Instead", () => {
  it("opens a new Ask thread with the same words, encoded once", () => {
    expect(askRoute("websocket уведомления")).toEqual({ section: "ask", key: "new:websocket%20%D1%83%D0%B2%D0%B5%D0%B4%D0%BE%D0%BC%D0%BB%D0%B5%D0%BD%D0%B8%D1%8F" });
  });
});

describe("once (one search read per words, even when the page effect runs twice)", () => {
  it("skips a repeated key, keeps the newest answer and lets a new key through", () => {
    const o = once();
    const a = o.start(0, "drawer");
    expect(a).not.toBeNull();
    expect(o.start(0, "drawer")).toBeNull(); // the strict-mode replay of the same read
    const b = o.start(1, "drawer"); // Try Again / Clear Filters
    expect(b).not.toBeNull();
    expect(o.current(a!)).toBe(false);
    expect(o.current(b!)).toBe(true);
  });
});
