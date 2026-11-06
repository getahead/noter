// Fix Term popover (DESIGN › Term fix popover; prototype 20-b-components.js): the selected words of a confirmed line, the
// correct term, a glossary switch. The core corrects the segment and returns it; a stale range asks to select again.
import { useEffect, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { withStreamSegment } from "../../app/store/window-store";
import type { GlossaryTerm, SegmentView, TextRange } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Checkbox } from "../../ui/primitives/checkbox";
import { Popover } from "../../ui/primitives/popover";
import { PushButton } from "../../ui/primitives/push-button";
import { TextField } from "../../ui/primitives/text-field";
import { fixKey, fixMessage, staleFix } from "./naming";
import "./speakers.css";

export interface TermFixPopoverProps {
  bridge: Bridge;
  segment: SegmentView;
  range: TextRange;
  anchor: HTMLElement | null;
  onClose: () => void;
  /** The core fixed the term: the status text and the change to undo. */
  onFixed: (text: string, change_id: string) => void;
}

// @cpt-component:cpt-noter-component-ui-term-fix-popover:p1
// @cpt-flow:cpt-noter-flow-ui-speakers-fix-term:p1
// @cpt-state:cpt-noter-state-ui-speakers-correction:p1
/** Fix the term: the segment replaces the line in the transcript Channel; an error text keeps the replacement. */
export async function applyFix(bridge: Bridge, segment: SegmentView, range: TextRange, text: string, glossary: boolean): Promise<{ error: string } | { message: string; change_id: string }> {
  // @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-call
  const res = await bridge.act(fixKey(segment.id), "transcript_fix_term", () => bridge.core.transcriptFixTerm({ call_id: segment.call_id, segment_id: segment.id, range, replacement: text, add_to_glossary: glossary }), {});
  // @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-call
  // @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-error
  // the replacement stays; a stale range is never retried by offset: the person selects the words again
  if (res.status === "error") return { error: t(staleFix(res.error.code) ? "speakers.fix.stale" : "speakers.fix.err") };
  // @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-error
  // @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-result
  bridge.store.setState((s) => withStreamSegment(s, res.data.segment));
  return { message: fixMessage(text, res.data.glossary_term_id), change_id: res.data.change_id };
  // @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-result
}

export function TermFixPopover({ bridge, segment, range, anchor, onClose, onFixed }: TermFixPopoverProps) {
  // @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-range
  const selected = segment.text.slice(range.start, range.end);
  const [terms, setTerms] = useState<readonly GlossaryTerm[]>([]);
  useEffect(() => void bridge.act("glossary:list", "glossary_list", () => bridge.core.glossaryList({}), {}).then((r) => r.status === "ok" && setTerms(r.data.terms)), [bridge]);
  // @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-range
  // @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-draft
  const [text, setText] = useState("");
  const [glossary, setGlossary] = useState(true);
  // @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-draft
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = text.trim().length > 0;

  const fix = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const out = await applyFix(bridge, segment, range, text.trim(), glossary);
    setBusy(false);
    if ("error" in out) return setError(out.error);
    onFixed(out.message, out.change_id);
    // @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-return
    onClose();
    // @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-return
  };

  return (
    <Popover variant="term-fix" anchor={anchor} width={320} label={t("speakers.fix.title")} onClose={onClose}>
      <div className="cw-pr" data-component="cpt-noter-component-ui-term-fix-popover" data-state={busy ? "applying" : error ? "error" : valid ? "editing" : "invalid"}>
        <h3 className="cw-pr__title">{t("speakers.fix.title")}</h3>
        <div className="cw-pp__lbl">
          {t("speakers.fix.selected")}
          <q>{selected}</q>
        </div>
        <TextField label={t("speakers.fix.correct")} showLabel value={text} invalid={!!error} message={error ?? undefined} disabled={busy} onChange={(v) => (setText(v), setError(null))} onEnter={() => void fix()} />
        {terms.length > 0 && (
          <div className="pc-name__chips" role="group" aria-label={t("speakers.fix.correct")}>
            {terms.slice(0, 5).map((x) => (
              <button key={x.id} type="button" className="pc-name__chip" onClick={() => setText(x.term)}>
                {x.term}
              </button>
            ))}
          </div>
        )}
        <Checkbox label={t("speakers.fix.glossary")} checked={glossary} onAction={setGlossary} />
        <span className="pc-name__hint">{t("speakers.fix.info")}</span>
        <div className="cw-pr__foot">
          <PushButton label={t("speakers.fix.apply")} variant="primary" disabled={!valid || busy} loading={busy} onAction={() => void fix()} />
        </div>
      </div>
    </Popover>
  );
}
