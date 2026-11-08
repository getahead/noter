// Fix Term popover (DESIGN › Term fix popover; prototype 20-b-components.js): the selected words of a confirmed line, the
// correct term, a glossary switch. The core corrects the segment and returns it; a stale range asks to select again.
import { useEffect, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { withStreamSegment } from "../../app/store/window-store";
import type { GlossaryTerm, SegmentView, TextRange } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Checkbox } from "../../ui/primitives/checkbox";
import { Popover } from "../../ui/primitives/popover";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PushButton } from "../../ui/primitives/push-button";
import { TextField } from "../../ui/primitives/text-field";
import { langAttr, langName } from "../transcript/model";
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

/** The segment's span from the core into the transcript Channel: after a stale range or an Undo of the fix. */
export async function rereadSegment(bridge: Bridge, segment: SegmentView): Promise<void> {
  const fresh = await bridge.core.transcriptSpan({ span: { call_id: segment.call_id, t0_ms: segment.t0_ms, t1_ms: segment.t1_ms } });
  if (fresh.status === "ok") for (const updated of fresh.data.segments) bridge.store.setState((s) => withStreamSegment(s, updated));
}

// @cpt-flow:cpt-noter-flow-ui-speakers-fix-term:p1
// @cpt-state:cpt-noter-state-ui-speakers-correction:p1
/** Fix the term: the segment replaces the line in the transcript Channel; an error text keeps the replacement. */
export async function applyFix(bridge: Bridge, segment: SegmentView, range: TextRange, text: string, glossary: boolean): Promise<{ error: string; reselect?: boolean } | { message: string; change_id: string }> {
  // @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-call
  const res = await bridge.act(fixKey(segment.id), "transcript_fix_term", () => bridge.core.transcriptFixTerm({ call_id: segment.call_id, segment_id: segment.id, range, replacement: text, add_to_glossary: glossary }), {});
  // @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-call
  // @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-error
  // the replacement stays; a stale range is never retried by offset: the person selects the words again
  if (res.status === "error") {
    const reselect = staleFix(res.error.code);
    if (reselect) {
      await rereadSegment(bridge, segment);
    }
    return { error: t(reselect ? "speakers.fix.stale" : "speakers.fix.err"), reselect };
  }
  // @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-error
  // @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-result
  bridge.store.setState((s) => withStreamSegment(s, res.data.segment));
  return { message: fixMessage(text, res.data.glossary_term_id), change_id: res.data.change_id };
  // @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-result
}

// @cpt-dod:cpt-noter-dod-ui-speakers-corrections:p1
// @cpt-component:cpt-noter-component-ui-term-fix-popover:p1
export function TermFixPopover({ bridge, segment, range, anchor, onClose, onFixed }: TermFixPopoverProps) {
  // @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-range
  const selected = segment.text.slice(range.start, range.end);
  const language = langAttr(segment.lang);
  const languages = ["en", "ru", "de"].map((value) => ({ value, label: langName({ code: value }) }));
  if (!languages.some((x) => x.value === language)) languages.push({ value: language, label: langName(segment.lang) });
  const [terms, setTerms] = useState<readonly GlossaryTerm[]>([]);
  useEffect(() => void bridge.act("glossary:list", "glossary_list", () => bridge.core.glossaryList({}), {}).then((r) => r.status === "ok" && setTerms(r.data.terms)), [bridge]);
  // @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-range
  // @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-draft
  const [text, setText] = useState(selected);
  const [glossary, setGlossary] = useState(true);
  // @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-draft
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reselect, setReselect] = useState(false);
  // @cpt-begin:cpt-noter-state-ui-speakers-correction:p1:inst-invalid
  // @cpt-begin:cpt-noter-state-ui-speakers-correction:p1:inst-valid
  const valid = text.trim().length > 0 && !reselect;
  // @cpt-end:cpt-noter-state-ui-speakers-correction:p1:inst-valid
  // @cpt-end:cpt-noter-state-ui-speakers-correction:p1:inst-invalid

  const fix = async () => {
    if (!valid || busy) return;
    // @cpt-begin:cpt-noter-state-ui-speakers-correction:p1:inst-apply
    setBusy(true);
    setError(null);
    // @cpt-end:cpt-noter-state-ui-speakers-correction:p1:inst-apply
    const out = await applyFix(bridge, segment, range, text.trim(), glossary);
    setBusy(false);
    // @cpt-begin:cpt-noter-state-ui-speakers-correction:p1:inst-error
    if ("error" in out) {
      setReselect(!!out.reselect);
      return setError(out.error);
    }
    // @cpt-end:cpt-noter-state-ui-speakers-correction:p1:inst-error
    // @cpt-begin:cpt-noter-state-ui-speakers-correction:p1:inst-done
    onFixed(out.message, out.change_id);
    // @cpt-end:cpt-noter-state-ui-speakers-correction:p1:inst-done
    // @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-return
    onClose();
    // @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-return
  };

  // @cpt-begin:cpt-noter-state-ui-speakers-correction:p1:inst-open
  // @cpt-begin:cpt-noter-state-ui-speakers-correction:p1:inst-cancel
  return (
    <Popover variant="term-fix" anchor={anchor} width={320} label={t("speakers.fix.title")} onClose={onClose}>
      <div className="cw-pr" data-component="cpt-noter-component-ui-term-fix-popover" data-state={busy ? "applying" : error ? "error" : valid ? "editing" : "invalid"}>
        <h3 className="cw-pr__title">{t("speakers.fix.title")}</h3>
        <div className="cw-pp__lbl">
          {t("speakers.fix.selected")}
          <q lang={langAttr(segment.lang)}>{selected}</q>
        </div>
        <TextField label={t("speakers.fix.correct")} showLabel value={text} invalid={!!error} message={error ?? undefined} disabled={busy} onChange={(v) => (setText(v), !reselect && setError(null))} onEnter={() => void fix()} />
        {terms.length > 0 && (
          <div className="pc-name__chips" role="group" aria-label={t("speakers.fix.correct")}>
            {terms.slice(0, 5).map((x) => (
              <button key={x.id} type="button" className="pc-name__chip" onClick={() => setText(x.term)}>
                {x.term}
              </button>
            ))}
          </div>
        )}
        <label className="cw-pp__lbl" title={t("speakers.fix.lang_readonly")}>
          {t("speakers.fix.lang")}
          <PopupButton label={t("speakers.fix.lang")} options={languages} value={language} disabled />
        </label>
        <Checkbox label={t("speakers.fix.glossary")} checked={glossary} onAction={setGlossary} />
        <span className="pc-name__hint">{t("speakers.fix.info")}</span>
        <div className="cw-pr__foot">
          <PushButton label={t("speakers.fix.apply")} variant="primary" disabled={!valid || busy} loading={busy} onAction={() => void fix()} />
        </div>
      </div>
    </Popover>
  );
  // @cpt-end:cpt-noter-state-ui-speakers-correction:p1:inst-cancel
  // @cpt-end:cpt-noter-state-ui-speakers-correction:p1:inst-open
}
