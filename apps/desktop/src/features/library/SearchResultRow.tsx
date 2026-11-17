import type { Bridge } from "../../app/bridge/bridge";
import type { SearchHit } from "../../core/bindings";
import { shortDay, t } from "../../i18n/format";
import { Link } from "../../ui/primitives/link";
import { openSpan } from "../items/evidence";
import { segments } from "./search-model";

// @cpt-component:cpt-noter-component-ui-search-result-row:p1
/** One hit: the call, the original snippet with the core's highlights (text nodes, never HTML), and › to open it. */
export function SearchResultRow({ bridge, hit }: { bridge: Bridge; hit: SearchHit }) {
  const lang = hit.lang === null ? undefined : typeof hit.lang === "string" ? hit.lang : hit.lang.code;
  const go = () => {
    const x = hit.target;
    if (x.type === "segment") void openSpan(bridge, x.span, "library-search");
    else if (x.type === "document") void bridge.act("open_external", "open_external", () => bridge.core.openExternal({ target: { type: "document", document_id: x.document_id, chunk_id: x.chunk_id } }), { screen: "library-search" });
    else if (hit.call) void bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "call_page", call_id: hit.call!.id, tab: "summary" } }), { screen: "library-search" });
  };
  return (
    <li className="lb-hit" data-component="cpt-noter-component-ui-search-result-row" data-strength={hit.strength} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && go()}>
      {hit.title !== hit.snippet && <span className="lb-hit__title">{hit.title}</span>}
      <span className="lb-hit__snippet" lang={lang}>
        {segments(hit.snippet, hit.highlights).map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : s.text))}
      </span>
      {hit.call && <span className="np-dim">{t("search.from_call", { title: hit.call.title, date: shortDay(hit.call.started_at, undefined) })}</span>}
      {hit.cross_language && <span className="np-dim">{t("search.cross_language")}</span>}
      <Link label={t("search.open")} onAction={go} />
    </li>
  );
}
