// diff-view: the words inserted and deleted between two texts, unchanged runs folded (prototype C.diffView).
import { Fragment, useMemo, useState } from "react";
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

const hasWordCharacter = (text: string) => /[\p{L}\p{N}]/u.test(text);

function separatesReplacement(parts: { op: string; text: string }[], index: number): boolean {
  const current = parts[index]!;
  if (current.op === "eq") return false;
  const opposite = current.op === "ins" ? "del" : "ins";
  let hasPreviousWord = false;
  for (let i = index - 1; i >= 0 && parts[i]!.op === opposite; i--) hasPreviousWord ||= hasWordCharacter(parts[i]!.text);
  return hasPreviousWord && hasWordCharacter(current.text);
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
                {l.parts.map((p, k) => {
                  const separator = separatesReplacement(l.parts, k);
                  return (
                    <Fragment key={k}>
                      {separator ? " " : null}
                      {p.op === "ins" ? <ins className="np-ins">{p.text}</ins> : p.op === "del" ? <del className="np-del">{p.text}</del> : p.text}
                    </Fragment>
                  );
                })}
                {"\n"}
              </span>
            ))
          ),
        )}
      </p>
    </div>
  );
}
