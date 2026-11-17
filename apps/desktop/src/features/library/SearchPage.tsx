import { useEffect, useRef, useState } from "react";
import { Popover } from "../../ui/primitives/popover";
import { useBridge } from "../../app/bridge/context";
import type { Bridge } from "../../app/bridge/bridge";
import type { CallFilter, SearchResults } from "../../core/bindings";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { navigate } from "../shell/navigate";
import { TopicChip } from "../../ui/primitives/topic-chip";
import { PushButton } from "../../ui/primitives/push-button";
import { apply, heldFilter, holdFilter, isFiltered } from "./filters";
import { SearchResultRow } from "./SearchResultRow";
import { openTopic } from "./topic-nav";
import { topicCounts } from "./topics-model";
import { askRoute, groupByCall, once, sections, statusOf } from "./search-model";
import "./library.css";

const SECTION = { items: "search.section.items", transcripts: "search.section.transcripts", documents: "search.section.documents" } as const;
export type Read = { status: "LOADING" } | { status: "READ_ERROR" } | { status: "OK"; results: SearchResults };

export interface SearchViewProps {
  bridge: Bridge;
  read: Read;
  query: string;
  filter: CallFilter;
  /** The call groups whose hidden spans were revealed (More in This Call). */
  open: ReadonlySet<string>;
  onMore: (group: string) => void;
  onRetry: () => void;
  onClear: () => void;
  /** Drops the Language filter (the weak-match warning offers it only while one is set). */
  onAllLanguages?: () => void;
  onAsk: () => void;
}

/** The results page for one read: loading, failed, no matches, only weak matches or ranked sections. */
export function SearchView({ bridge, read, query, filter, open, onMore, onRetry, onClear, onAllLanguages, onAsk }: SearchViewProps) {
  const [how, setHow] = useState<HTMLElement | null>(null);
  const body = () => {
    if (read.status === "LOADING") return <div className="lb-loading" aria-busy="true" aria-label={t("search.loading")} />;
    if (read.status === "READ_ERROR") return <InlineBanner banner={{ id: "search-error", severity: "error", text: t("search.error"), actions: [{ label: t("action.try_again"), onAction: () => onRetry() }] }} />;
    const r = read.results;
    const status = statusOf(r);
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-search:p1:inst-if-ask
    const filtered = isFiltered(filter);
    const clear = { label: t("filters.clear"), onAction: onClear };
    const ask = { label: t("search.ask_instead"), onAction: () => onAsk() };
    const widen = (
      <div className="lb-actions">
        {filtered && (
          <>
            <PushButton label={clear.label} size="small" onAction={clear.onAction} />
          </>
        )}
        <PushButton label={ask.label} size="small" onAction={ask.onAction} />
      </div>
    );
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-search:p1:inst-if-ask
    if (status === "NO_MATCHES")
      return (
        <>
          <EmptyState variant="filtered" title={t("search.none", { query })} body={filtered ? t("search.filters_active", { count: Object.values(filter).filter((v) => (Array.isArray(v) ? v.length : v)).length }) : t("search.try_fewer")} />
          {widen}
        </>
      );
    // A search that only found topics still has a result to count: the one topic row.
    const total = r.calls.length + r.items.length + r.documents.length || Math.min(r.topics.length, 1);
    const topic = r.topics[0];
    return (
      <>
        <p className="np-dim" role="status">
          {status === "WEAK_ONLY" ? t("search.count_weak", { count: total }) : t("search.count", { count: total })} · {r.mode.type === "hybrid" ? t("search.best") : r.mode.rebuild_progress === null ? t("search.keyword_only") : t("search.keyword_progress", { percent: Math.round(r.mode.rebuild_progress * 100) })}
        </p>
        {status === "WEAK_ONLY" && <InlineBanner banner={{ id: "search-weak-only", severity: "warning", text: t("search.weak_only", { query }), actions: [...(filtered ? [clear] : []), ...(filter.languages?.length && onAllLanguages ? [{ label: t("search.all_languages"), onAction: onAllLanguages }] : []), ask] }} />}
        {topic && (
          <section data-region="LS-R3" aria-label={t("search.section.topic")}>
            <TopicChip size="suggestion" name={topic.name} counts={topicCounts(topic)} merge={topic.merge_suggestion ? t("topics.merge_glyph") : undefined} onOpen={() => openTopic(bridge, topic.id)} />
          </section>
        )}
        {sections(r).map((s) => (
          <section key={s.key} aria-label={t(SECTION[s.key])}>
            <h3 className="lb-thmonth__h">{t(SECTION[s.key])}</h3>
            {groupByCall(s.strong, 3).map((g) => (
              <ul key={g.callId} className="lb-items">
                {(open.has(`${s.key}:${g.callId}`) ? [...g.shown, ...g.hidden] : g.shown).map((h, i) => (
                  <SearchResultRow key={i} bridge={bridge} hit={h} />
                ))}
                {g.hidden.length > 0 && !open.has(`${s.key}:${g.callId}`) && (
                  <li><button type="button" className="lb-fbtn" onClick={() => onMore(`${s.key}:${g.callId}`)}>{t("search.more_in_call", { count: g.hidden.length })}</button></li>
                )}
              </ul>
            ))}
            {s.weak.length > 0 && (
              <>
                {status !== "WEAK_ONLY" && <h4 className="lb-thmonth__h">{t("search.weaker")}</h4>}
                <ul className="lb-items">
                  {s.weak.map((h, i) => (
                    <SearchResultRow key={i} bridge={bridge} hit={h} />
                  ))}
                </ul>
              </>
            )}
          </section>
        ))}
        <button type="button" className="lb-fbtn" aria-expanded={how !== null} onClick={(e) => setHow(how ? null : e.currentTarget)}>{t("search.how")}</button>
        {how && (
          <Popover variant="how-searched" anchor={how} width={320} label={t("search.how_title")} onClose={() => setHow(null)}>
            <div className="lb-pop">
              <strong>{t("search.how_title")}</strong>
              <span>{t("search.how_words", { words: r.explain.normalized_query || query })}</span>
              <span>{t("search.how_meaning", { state: r.mode.type === "hybrid" ? t("search.on") : t("search.off") })}</span>
              <span>{t("search.how_filters", { filters: r.explain.filters_applied ? t("search.how_n", { count: r.explain.filters_applied }) : t("search.how_none") })}</span>
            </div>
          </Popover>
        )}
      </>
    );
  };
  return (
    <div
      data-region="LS-R1"
      className="lb-search"
      // focus lands on the title after a search: ↓ from there enters the first hit
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" || e.target !== e.currentTarget.querySelector("h2")) return;
        const hit = e.currentTarget.querySelector<HTMLElement>(".lb-hit");
        if (hit) (e.preventDefault(), hit.focus());
      }}
    >
      <h2 className="lb-title" tabIndex={-1}>{t("search.title")}</h2>
      {body()}
    </div>
  );
}

// @cpt-state:cpt-noter-state-ui-library-search-topics-view:p1
// @cpt-component:cpt-noter-component-screen-library:p1
/** Library › Search results: one `search` read per words and filter, an answer for older ones is dropped, Try Again only on request. */
export function SearchPage({ query }: { query: string }) {
  const bridge = useBridge();
  const [read, setRead] = useState<Read>({ status: "LOADING" });
  const [again, setAgain] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const filter = heldFilter().filter;
  const reads = useRef(once());
  useEffect(() => {
    const mine = reads.current.start(again, query);
    if (mine === null) return;
    setRead({ status: "LOADING" });
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-search:p1:inst-search
    void bridge.act("search", "search", () => bridge.core.search({ query, filter, limit: null }), { screen: "library-search" }).then((r) => {
      if (reads.current.current(mine)) setRead(r.status === "ok" ? { status: "OK", results: r.data } : { status: "READ_ERROR" });
    });
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-search:p1:inst-search
  }, [bridge, query, again]);
  return (
    <SearchView
      bridge={bridge}
      read={read}
      query={query}
      filter={filter}
      open={open}
      onMore={(g) => setOpen(new Set(open).add(g))}
      onRetry={() => setAgain((n) => n + 1)}
      onClear={() => (holdFilter(apply(heldFilter(), { type: "clear" })), setAgain((n) => n + 1))}
      onAllLanguages={() => (holdFilter((filter.languages ?? []).reduce((st, l) => apply(st, { type: "toggle", group: "languages", value: typeof l === "string" ? l : l.code }), heldFilter())), setAgain((n) => n + 1))}
      onAsk={() => navigate(askRoute(query))}
    />
  );
}
