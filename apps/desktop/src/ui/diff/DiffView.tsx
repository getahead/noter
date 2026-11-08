// diff-view: the words inserted and deleted between two texts, unchanged runs folded (prototype C.diffView).
import { useMemo, useState } from "react";
import { t } from "../../i18n/format";
import { Icon } from "../icons";
import { changedWords, diffWords, fold, toLines } from "./diff";
import "./diff.css";

export interface DiffViewProps {
  before: string;
  after: string;
  title?: string;
  lang?: string;
}

// @cpt-component:cpt-noter-component-ui-diff-view:p1
export function DiffView({ before, after, title, lang }: DiffViewProps) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const { changed, blocks } = useMemo(() => {
    const parts = diffWords(before, after);
    return { changed: changedWords(parts), blocks: fold(toLines(parts)) };
  }, [before, after]);
  return (
    <div data-component="cpt-noter-component-ui-diff-view" data-variant="inline" data-state={changed ? "changes" : "no-changes"} className="pc-diff" lang={lang}>
      <div className="pc-diff__head">
        <Icon name="history" size={12} />
        {changed ? t("diff.changed", { count: changed }) : t("diff.none")}
        {title && <> · <span className="np-dim">{title}</span></>}
      </div>
      <p className="pc-diff__text">
        {blocks.map((b, bi) =>
          b.kind === "fold" && !open.has(bi) ? (
            <button key={bi} type="button" className="pc-diff__fold" onClick={() => setOpen(new Set(open).add(bi))}>
              {t("diff.unchanged_lines", { count: b.lines.length })} ▸
            </button>
          ) : (
            b.lines.map((l, li) => (
              <span key={`${bi}-${li}`} className="pc-diff__line">
                {l.parts.map((p, k) => (p.op === "ins" ? <ins key={k} className="np-ins">{p.text}</ins> : p.op === "del" ? <del key={k} className="np-del">{p.text}</del> : p.text))}
                {"\n"}
              </span>
            ))
          ),
        )}
      </p>
    </div>
  );
}
