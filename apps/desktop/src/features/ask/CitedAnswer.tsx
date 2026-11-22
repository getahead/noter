// A turn's answer with its [n] references and the sources they point at (AK-R3 answer, cpt-noter-dod-ui-ask-citations).
import { useEffect, useRef, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { Citation, TimeSpan } from "../../core/bindings";
import { t } from "../../i18n/format";
import { PersonChip } from "../../ui/primitives/person-chip";
import { PushButton } from "../../ui/primitives/push-button";
import { ProvenanceChip } from "../items/ProvenanceChip";
import { openSpan, spanTime } from "../items/evidence";
import { copyTurn, openDocument, openPerson } from "./actions";
import { blocks, type Inline } from "./markdown";

const COPIED_MS = 2000;

// @cpt-component:cpt-noter-component-ui-cited-answer:p1
// @cpt-dod:cpt-noter-dod-ui-ask-citations:p1
export function CitedAnswer({ bridge, text, citations, live, onAskAgain, onPlay }: { bridge: Bridge; text: string; citations: Citation[]; live: boolean; onAskAgain?: () => void; onPlay?: (span: TimeSpan) => void }) {
  const [focus, setFocus] = useState<number | null>(null);
  const rows = useRef(new Map<number, HTMLLIElement>());
  const origin = useRef<HTMLElement | null>(null); // the superscript that sent focus to a row: ⇧Tab goes back to it
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  // @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-clipboard
  useEffect(() => {
    if (copy === "idle") return;
    const h = setTimeout(() => setCopy("idle"), COPIED_MS);
    return () => clearTimeout(h);
  }, [copy]);
  // @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-clipboard
  const known = new Set(citations.map((c) => c.n));
  // @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-citation-focus
  const span = (s: Inline, i: number) =>
    s.t === "ref" ? (
      known.has(s.n) ? (
        <button key={i} type="button" className="ak-ref" disabled={live} aria-label={t("ask.ref", { n: s.n })} onClick={(e) => ((origin.current = e.currentTarget), setFocus(s.n), rows.current.get(s.n)?.focus())}>
          <sup>{s.n}</sup>
        </button>
      ) : null // a number the core never cited is dropped, not shown as a source
    ) : s.t === "bold" ? (
      <strong key={i}>{s.text}</strong>
    ) : s.t === "italic" ? (
      <em key={i}>{s.text}</em>
    ) : s.t === "code" ? (
      <code key={i}>{s.text}</code>
    ) : (
      s.text
    );
  // @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-citation-focus
  return (
    <div className="ak-ans" aria-busy={live}>
      {blocks(text).map((b, i) =>
        b.t === "p" ? (
          <p key={i} className="ak-ans__p">{b.inline.map(span)}</p>
        ) : b.t === "ul" ? (
          <ul key={i} className="ak-ans__list">{b.items.map((it, j) => <li key={j}>{it.map(span)}</li>)}</ul>
        ) : (
          <ol key={i} className="ak-ans__list">{b.items.map((it, j) => <li key={j}>{it.map(span)}</li>)}</ol>
        ),
      )}
      {!live && citations.length > 0 && (
        <ol className="ak-cites" aria-label={t("ask.sources")}>
          {citations.map((c) => (
            <CitationRow key={c.n} bridge={bridge} c={c} focused={focus === c.n} onPlay={onPlay} back={() => origin.current?.focus()} register={(el) => (el ? rows.current.set(c.n, el) : rows.current.delete(c.n))} />
          ))}
        </ol>
      )}
      {!live && text && (
        <div className="ak-actions">
          {/* @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-if-deleted */}
          {/* @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-again */}
          {/* @cpt-begin:cpt-noter-state-ui-ask-turn:p1:inst-again */}
          {onAskAgain && citations.some((c) => c.deleted) && <PushButton label={t("ask.ask_again")} onAction={onAskAgain} />}
          {/* @cpt-end:cpt-noter-state-ui-ask-turn:p1:inst-again */}
          {/* @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-again */}
          {/* @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-if-deleted */}
          {/* @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-copy */}
          <PushButton
            ariaLabel={t("ask.copy")} /* the name stays; the label shows Copied and the status region announces it */
            label={copy === "copied" ? t("ask.copied") : copy === "failed" ? t("ask.copy_failed") : t("ask.copy")}
            onAction={() => void copyTurn({ answer_md: text, citations }, (s) => navigator.clipboard.writeText(s)).then(setCopy)}
          />
          {/* @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-copy */}
          <span role="status" className="ak-live">{copy === "copied" ? t("ask.copied_status") : ""}</span>
        </div>
      )}
    </div>
  );
}

export function CitationRow({ bridge, c, focused, onPlay, register, back }: { bridge: Bridge; c: Citation; focused: boolean; onPlay?: (span: TimeSpan) => void; register: (el: HTMLLIElement | null) => void; back: () => void }) {
  const p = c.provenance;
  const span = p.type === "past_call" || p.type === "this_call" ? p.span : null;
  return (
    <li ref={register} tabIndex={-1} onKeyDown={(e) => e.target === e.currentTarget && e.key === "Tab" && e.shiftKey && (e.preventDefault(), back())} data-component="cpt-noter-component-ui-citation-row" className={`ak-cite${focused ? " is-focus" : ""}`} value={c.n}>
      {/* @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-deleted */}
      {/* @cpt-begin:cpt-noter-state-ui-ask-turn:p1:inst-deleted */}
      {c.deleted && <span className="np-dim">{t("items.source_deleted")}</span>}
      {/* @cpt-end:cpt-noter-state-ui-ask-turn:p1:inst-deleted */}
      {/* @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-deleted */}
      {!c.deleted && span && <ProvenanceChip bridge={bridge} span={span} arrow={false} />}
      {c.speaker && <PersonChip variant="link" initials={c.speaker.initials} name={c.speaker.short_name} title={c.speaker.display_name} label={t("ask.open_person", { name: c.speaker.display_name })} onAction={() => c.speaker && openPerson(c.speaker.id)} />}
      {/* @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-evidence */}
      {p.type === "past_call" &&
        (c.deleted ? (
          <span className="ak-cite__src">{p.call.title}</span>
        ) : (
          <a href="#open" className="np-link ak-cite__src" onClick={(e) => (e.preventDefault(), void openSpan(bridge, p.span, "ask"))}>
            {p.call.title}
          </a>
        ))}
      {p.type === "document" &&
        (c.deleted ? (
          <span className="ak-cite__src">{[p.title, p.source_name].join(" · ")}</span>
        ) : (
          <a href="#open" className="np-link ak-cite__src" onClick={(e) => (e.preventDefault(), void openDocument(bridge, p.document_id, p.chunk_id))}>
            {[p.title, p.source_name].join(" · ")}
          </a>
        ))}
      {/* @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-evidence */}
      {/* @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-play */}
      {span && (
        <button type="button" className="np-link" disabled={c.deleted} aria-label={t("ask.play", { at: spanTime(span) })} onClick={() => onPlay?.(span)}>
          ▶
        </button>
      )}
      {/* @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-play */}
      {c.strength === "weak" && <span className="np-dim">{t("ask.weak")}</span>}
      {c.quote && <blockquote className="ak-cite__quote" lang={typeof c.lang === "string" ? c.lang : c.lang?.code}>{c.quote}</blockquote>}
    </li>
  );
}
