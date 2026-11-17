import { useEffect, useState } from "react";
import { useBridge } from "../../app/bridge/context";
import type { SearchResults } from "../../core/bindings";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { heldFilter } from "./filters";
import { SearchResultRow } from "./SearchResultRow";
import { groupByCall, sections, statusOf } from "./search-model";
import "./library.css";

const SECTION = { items: "search.section.items", transcripts: "search.section.transcripts", documents: "search.section.documents" } as const;
type Read = { status: "LOADING" } | { status: "READ_ERROR" } | { status: "OK"; results: SearchResults };

// @cpt-state:cpt-noter-state-ui-library-search-topics-view:p1
// @cpt-component:cpt-noter-component-screen-library:p1
/** Library › Search results: one `search` read per words and filter, an answer for older ones is dropped, Try Again only on request. */
export function SearchPage({ query }: { query: string }) {
  const bridge = useBridge();
  const [read, setRead] = useState<Read>({ status: "LOADING" });
  const [again, setAgain] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const filter = heldFilter().filter;
  useEffect(() => {
    let live = true;
    setRead({ status: "LOADING" });
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-search:p1:inst-search
    void bridge.act("search", "search", () => bridge.core.search({ query, filter, limit: null }), { screen: "library-search" }).then((r) => {
      if (live) setRead(r.status === "ok" ? { status: "OK", results: r.data } : { status: "READ_ERROR" });
    });
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-search:p1:inst-search
    return () => void (live = false);
  }, [bridge, query, again]);

  const body = () => {
    if (read.status === "LOADING") return <div className="lb-loading" aria-busy="true" aria-label={t("search.loading")} />;
    if (read.status === "READ_ERROR") return <InlineBanner banner={{ id: "search-error", severity: "error", text: t("search.error"), actions: [{ label: t("action.try_again"), onAction: () => setAgain((n) => n + 1) }] }} />;
    const r = read.results;
    const status = statusOf(r);
    if (status === "NO_MATCHES") return <EmptyState variant="filtered" title={t("search.none", { query })} />;
    const total = r.calls.length + r.items.length + r.documents.length;
    return (
      <>
        <p className="np-dim" role="status">
          {status === "WEAK_ONLY" ? t("search.count_weak", { count: total }) : t("search.count", { count: total })} · {r.mode.type === "hybrid" ? t("search.best") : t("search.keyword_only")}
        </p>
        {sections(r).map((s) => (
          <section key={s.key} aria-label={t(SECTION[s.key])}>
            <h3 className="lb-thmonth__h">{t(SECTION[s.key])}</h3>
            {groupByCall(s.strong, 3).map((g) => (
              <ul key={g.callId} className="lb-items">
                {(open.has(`${s.key}:${g.callId}`) ? [...g.shown, ...g.hidden] : g.shown).map((h, i) => (
                  <SearchResultRow key={i} bridge={bridge} hit={h} />
                ))}
                {g.hidden.length > 0 && !open.has(`${s.key}:${g.callId}`) && (
                  <li><button type="button" className="lb-fbtn" onClick={() => setOpen(new Set(open).add(`${s.key}:${g.callId}`))}>{t("search.more_in_call")}</button></li>
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
