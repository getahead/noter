import type { Route } from "../shell/history";
import type { SearchHit, SearchResults, TextRange } from "../../core/bindings";

export interface Segment {
  text: string;
  hit: boolean;
}

/** The original text cut at the core's highlight ranges (UTF-16 offsets); out-of-range or overlapping ranges are clamped, never trusted. */
export function segments(text: string, ranges: TextRange[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const start = Math.max(at, Math.min(r.start, text.length));
    const end = Math.max(start, Math.min(r.end, text.length));
    if (end === start) continue;
    if (start > at) out.push({ text: text.slice(at, start), hit: false });
    out.push({ text: text.slice(start, end), hit: true });
    at = end;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

export type SearchStatus = "LOADING" | "RESULTS" | "WEAK_ONLY" | "NO_MATCHES" | "READ_ERROR";

// @cpt-begin:cpt-noter-algo-ui-library-search-topics-results:p1:inst-all-weak
export const statusOf = (r: SearchResults): SearchStatus => {
  const total = r.calls.length + r.items.length + r.documents.length;
  // @cpt-begin:cpt-noter-state-ui-library-search-topics-view:p1:inst-weak
  // @cpt-begin:cpt-noter-state-ui-library-search-topics-view:p1:inst-results
  // @cpt-begin:cpt-noter-state-ui-library-search-topics-view:p1:inst-no-matches
  return !total && !r.topics.length ? "NO_MATCHES" : r.only_weak ? "WEAK_ONLY" : "RESULTS";
  // @cpt-end:cpt-noter-state-ui-library-search-topics-view:p1:inst-no-matches
  // @cpt-end:cpt-noter-state-ui-library-search-topics-view:p1:inst-results
  // @cpt-end:cpt-noter-state-ui-library-search-topics-view:p1:inst-weak
};
// @cpt-end:cpt-noter-algo-ui-library-search-topics-results:p1:inst-all-weak

export interface Section {
  key: "items" | "transcripts" | "documents";
  strong: SearchHit[];
  weak: SearchHit[];
}

// @cpt-begin:cpt-noter-algo-ui-library-search-topics-results:p1:inst-mixed
/** Items before transcript chunks, then documents; strong hits first within a section and the weak ones after them. */
export function sections(r: SearchResults): Section[] {
  // @cpt-begin:cpt-noter-algo-ui-library-search-topics-results:p1:inst-authority
  const split = (key: Section["key"], hits: SearchHit[]): Section => ({ key, strong: hits.filter((h) => h.strength === "strong"), weak: hits.filter((h) => h.strength !== "strong") });
  // @cpt-end:cpt-noter-algo-ui-library-search-topics-results:p1:inst-authority
  return [split("items", r.items), split("transcripts", r.calls), split("documents", r.documents)].filter((s) => s.strong.length + s.weak.length);
}
// @cpt-end:cpt-noter-algo-ui-library-search-topics-results:p1:inst-mixed

// @cpt-begin:cpt-noter-algo-ui-library-search-topics-results:p1:inst-groups
/** Hits of one call stay together; `visible` of them show, the rest wait behind More in This Call. */
export function groupByCall(hits: SearchHit[], visible: number): { callId: string; title: string; shown: SearchHit[]; hidden: SearchHit[] }[] {
  const by = new Map<string, SearchHit[]>();
  for (const h of hits) by.set(h.call?.id ?? "", [...(by.get(h.call?.id ?? "") ?? []), h]);
  return [...by].map(([callId, all]) => ({ callId, title: all[0]!.call?.title ?? "", shown: all.slice(0, visible), hidden: all.slice(visible) }));
}
// @cpt-end:cpt-noter-algo-ui-library-search-topics-results:p1:inst-groups

// @cpt-begin:cpt-noter-flow-ui-library-search-topics-search:p1:inst-ask
/** Ask Instead: a new Ask thread that submits the same words once. */
export const askRoute = (words: string): Route => ({ section: "ask", key: ["new", encodeURIComponent(words)].join(":") });
// @cpt-end:cpt-noter-flow-ui-library-search-topics-search:p1:inst-ask

// @cpt-begin:cpt-noter-flow-ui-library-search-topics-search:p1:inst-search
/** One read per (try, words): the same pair again (a replayed effect) starts nothing, and only the newest read's answer may show. */
export function once(): { start(tries: number, words: string): number | null; current(n: number): boolean } {
  let tries: number | null = null;
  let words = "";
  let n = 0;
  return {
    start: (t, w) => (t === tries && w === words ? null : ((tries = t), (words = w), ++n)),
    current: (m) => m === n,
  };
}
// @cpt-end:cpt-noter-flow-ui-library-search-topics-search:p1:inst-search
