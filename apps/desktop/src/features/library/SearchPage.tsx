import { useEffect, useRef, useState } from "react";
import { useBridge } from "../../app/bridge/context";
import type { Bridge } from "../../app/bridge/bridge";
import type { CallFilter, SearchResults } from "../../core/bindings";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { navigate } from "../shell/navigate";
import { PushButton } from "../../ui/primitives/push-button";
import { apply, heldFilter, holdFilter, isFiltered } from "./filters";
import { SearchResultRow } from "./SearchResultRow";
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
  onAsk: () => void;
}

/** The results page for one read: loading, failed, no matches, only weak matches or ranked sections. */
export function SearchView({ bridge, read, query, filter, open, onMore, onRetry, onClear, onAsk }: SearchViewProps) {
  const body = () => {
    if (read.status === "LOADING") return <div className="lb-loading" aria-busy="true" aria-label={t("search.loading")} />;
    if (read.status === "READ_ERROR") return <InlineBanner banner={{ id: "search-error", severity: "error", text: t("search.error"), actions: [{ label: t("action.try_again"), onAction: () => onRetry() }] }} />;
    const r = read.results;
    const status = statusOf(r);
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-search:p1:inst-if-ask
    const widen = (
      <div className="lb-actions">
        {isFiltered(filter) && (
          <>
            <span className="np-dim">{t("search.filters_active", { count: Object.values(filter).filter((v) => (Array.isArray(v) ? v.length : v)).length })}</span>
            <PushButton label={t("filters.clear")} size="small" onAction={onClear} />
          </>
        )}
        <PushButton label={t("search.ask_instead")} size="small" onAction={() => onAsk()} />
      </div>
    );
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-search:p1:inst-if-ask
    if (status === "NO_MATCHES")
      return (
        <>
          <EmptyState variant="filtered" title={t("search.none", { query })} />
          {widen}
        </>
      );
    const total = r.calls.length + r.items.length + r.documents.length;
    return (
      <>
        <p className="np-dim" role="status">
          {status === "WEAK_ONLY" ? t("search.count_weak", { count: total }) : t("search.count", { count: total })} · {r.mode.type === "hybrid" ? t("search.best") : r.mode.rebuild_progress === null ? t("search.keyword_only") : t("search.keyword_progress", { percent: Math.round(r.mode.rebuild_progress * 100) })}
        </p>
        {status === "WEAK_ONLY" && <InlineBanner banner={{ id: "search-weak-only", severity: "warning", text: t("search.weak_only", { query }) }} />}
        {status === "WEAK_ONLY" && widen}
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
                <h4 className="lb-thmonth__h">{t("search.weaker")}</h4>
                <ul className="lb-items">
                  {s.weak.map((h, i) => (
                    <SearchResultRow key={i} bridge={bridge} hit={h} />
                  ))}
                </ul>
              </>
            )}
          </section>
        ))}
      </>
    );
  };
  return (
    <div data-region="LS-R1" className="lb-search">
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
      onAsk={() => navigate(askRoute(query))}
    />
  );
}
