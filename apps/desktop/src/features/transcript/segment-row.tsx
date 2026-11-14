// Transcript segment row with its gap, mark and hypothesis variants (DESIGN › Transcript segment row; prototype
// src/js/20-b-components.js C.segmentRow). Markup and classes as the prototype's; the view decides the play control.
import type { ReactNode, Ref } from "react";

import type { SegmentView, SpeakerView, TextRange } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineStatus } from "../../ui/feedback/inline-status";
import { Icon } from "../../ui/icons";
import { cx } from "../../ui/primitives/attrs";
import { Badge } from "../../ui/primitives/badge";
import { IconButton } from "../../ui/primitives/icon-button";
import { LanguageTag, SpeakerLabel } from "./labels";
import { clock, gapText, langAttr, LOW_CONFIDENCE, markText, rowVariant, speakerColumn, splitMatch, UI_LANG, type Row, type Variant } from "./model";
import type { PlayControl } from "./play-control";

const COMPONENT = "cpt-noter-component-ui-transcript-segment-row";

export interface SegmentRowProps {
  row: Row;
  variant: Variant;
  speakers: readonly SpeakerView[];
  control?: PlayControl;
  playing?: boolean;
  /** Evidence target (3 s). */
  highlighted?: boolean;
  /** The find bar's query: matches in the match highlight. */
  find?: string;
  /** The current find match: a focus ring. */
  current?: boolean;
  /** The list's one Tab stop; the other lines are reached with ↑/↓. */
  stop?: boolean;
  /** The disabled control's reason, posted as an inline status (Space or click). */
  status?: string;
  /** The time's help tag when the audio is gone. */
  timeHelp?: string;
  onPlay?: (seg: SegmentView) => void;
  /** The speaker label was chosen on this line: open Rename Speaker. */
  onRename?: (speakerId: string, seg: SegmentView, anchor: HTMLElement) => void;
  /** Fix Term… on the selected words of this line (context menu): the range is in UTF-16 units of the line's text. */
  onFixTerm?: (seg: SegmentView, range: TextRange, anchor: HTMLElement) => void;
  onReopenFixTerm?: (seg: SegmentView, range: TextRange, anchor: HTMLElement) => void;
  onReason?: (key: string, text: string) => void;
  onStatusDone?: () => void;
  ref?: Ref<HTMLDivElement>;
}

/** The selection inside `el` as offsets into its text (the find highlight splits nodes, so count characters); `null` when empty or outside. */
export function selectedRange(el: HTMLElement, sel: Selection | null): TextRange | null {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  return { start, end: start + r.toString().length };
}

/** The confirmed words selected in a stored line: the segment, the range in its text and the line's text element; `null` for any other selection. */
export function selectedFixTerm(sel: Selection | null, segments: readonly SegmentView[]): { seg: SegmentView; range: TextRange; anchor: HTMLElement } | null {
  const node = sel?.anchorNode;
  const el = (node && "closest" in node ? (node as Element) : node?.parentElement)?.closest<HTMLElement>(".cw-seg__text");
  const id = el?.closest<HTMLElement>("[data-segment-id]")?.dataset.segmentId;
  const seg = segments.find((x) => x.id === id);
  const range = el ? selectedRange(el, sel) : null;
  return seg && el && range ? { seg, range, anchor: el } : null;
}

/** The text with the find match highlighted. */
function Text({ text, find }: { text: string; find?: string }) {
  const parts = find ? splitMatch(text, find) : null;
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <mark className="np-hl-match">{parts[1]}</mark>
      {parts[2]}
    </>
  );
}

function CorrectedText({ seg, find, onReopen }: { seg: SegmentView; find?: string; onReopen?: (seg: SegmentView, range: TextRange, anchor: HTMLElement) => void }) {
  const corrections = [...seg.corrections].sort((a, b) => a.range.start - b.range.start);
  if (!corrections.length) return <Text text={seg.text} find={find} />;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const correction of corrections) {
    const { start, end } = correction.range;
    if (start < at || end > seg.text.length || start >= end) continue;
    parts.push(<Text key={`before-${start}`} text={seg.text.slice(at, start)} find={find} />);
    parts.push(<button key={`fix-${start}`} type="button" className="cw-term" title={t("speakers.fix.heard_as", { text: correction.original })} aria-label={t("speakers.fix.heard_as", { text: correction.original })} onClick={(e) => onReopen?.(seg, correction.range, e.currentTarget)}><Text text={seg.text.slice(start, end)} find={find} /></button>);
    at = end;
  }
  parts.push(<Text key="after" text={seg.text.slice(at)} find={find} />);
  return <>{parts}</>;
}

// @cpt-component:cpt-noter-component-ui-transcript-segment-row:p1
export function SegmentRow({ row, variant, speakers, control, playing, highlighted, find, current, stop, status, timeHelp, onPlay, onRename, onFixTerm, onReopenFixTerm, onReason, onStatusDone, ref }: SegmentRowProps) {
  const tail = variant === "tail";
  if (row.kind === "gap") {
    return (
      <div ref={ref} data-component={COMPONENT} data-variant="gap" className="cw-seg cw-seg--gap" lang={UI_LANG}>
        <span className="cw-seg__time" />
        <span className="cw-seg__gaptext">{gapText(row.gap)}</span>
      </div>
    );
  }
  if (row.kind === "mark") {
    return (
      <div ref={ref} data-component={COMPONENT} data-variant="mark" className="cw-seg cw-seg--mark" lang={UI_LANG}>
        <span className="cw-seg__time np-tnum">{tail ? "" : clock(row.mark.at_ms)}</span>
        <span className="cw-seg__marktext">
          <Icon name="flag" size={12} /> {markText(row.mark)}
          {row.mark.note && <span lang="und"> · {row.mark.note}</span>}
        </span>
      </div>
    );
  }
  const seg = row.seg;
  const spk = speakerColumn(seg, speakers);
  if (row.kind === "hypothesis") {
    // D31: hidden from VoiceOver until confirmed; no time, no tag, no actions; the … glyph marks it beside the colour
    return (
      <div ref={ref} data-component={COMPONENT} data-variant="hypothesis" data-state="hypothesis" className={cx("cw-seg cw-seg--hyp", tail && "cw-seg--tail")} lang={langAttr(seg.lang)} aria-hidden="true">
        <span className="cw-seg__time" />
        <span className="cw-seg__spk">
          <SpeakerLabel text={spk.text} variant={spk.variant} />
        </span>
        <span className="cw-seg__text">{seg.text.endsWith("…") ? seg.text : `${seg.text}…`}</span>
        <span />
      </div>
    );
  }
  // a selection in the line opens the Copy / Fix Term… menu; without one the native menu stays
  const openFixMenu = (e: { preventDefault: () => void }, el: HTMLElement) => {
    const range = selectedRange(el, globalThis.getSelection());
    if (!range) return;
    e.preventDefault();
    onFixTerm?.(seg, range, el);
  };
  const v = rowVariant(seg, variant, speakers);
  const low = seg.confidence != null && seg.confidence < LOW_CONFIDENCE;
  const shown = control && control.state !== "hidden" && !tail ? control : null;
  const help = shown ? t(shown.help) : "";
  return (
    <div
      ref={ref}
      data-component={COMPONENT}
      data-variant={v}
      data-segment-id={seg.id}
      data-state={playing ? "playing" : highlighted ? "highlighted" : "default"}
      className={cx("cw-seg", tail && "cw-seg--tail", highlighted && "np-hl-evidence", playing && "is-playing", current && "is-current")}
      lang={langAttr(seg.lang)}
      tabIndex={tail ? undefined : stop ? 0 : -1}
      // the keyboard path of the context menu: Shift+F10 or the Menu key on the focused line
      onKeyDown={
        onFixTerm && !tail
          ? (e) => {
              const text = e.currentTarget.querySelector<HTMLElement>(".cw-seg__text");
              if (text && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) openFixMenu(e, text);
            }
          : undefined
      }
    >
      <span className="cw-seg__time np-tnum" title={timeHelp}>
        {tail ? "" : clock(seg.t0_ms)}
      </span>
      <span className="cw-seg__spk">
        <SpeakerLabel text={spk.text} variant={spk.variant} onRename={onRename && v !== "you" && v !== "crosstalk" ? (anchor) => onRename(seg.speaker.speaker_id, seg, anchor) : undefined} />
        {v === "crosstalk" && (
          <>
            {" "}
            <Badge text={t("transcript.crosstalk")} kind="kind" />
          </>
        )}
      </span>
      <span
        className={cx("cw-seg__text", low && "is-lowconf")}
        title={low ? t("transcript.low_confidence") : undefined}
        onContextMenu={onFixTerm && !tail ? (e) => openFixMenu(e, e.currentTarget) : undefined}
      >
        <CorrectedText seg={seg} find={find} onReopen={onReopenFixTerm} />
      </span>
      <span className="cw-seg__end">
        {shown && (
          <span className="cw-seg__acts">
            {/* a disabled control stays focusable: Space or a click posts its reason */}
            <IconButton
              icon={playing ? "pause" : "play"}
              label={playing ? t("transcript.pause") : t("transcript.play")}
              size="inline"
              help={help}
              state={shown.state === "disabled" ? "disabled" : undefined}
              attrs={shown.state === "disabled" ? { "aria-disabled": "true", "aria-description": help } : undefined}
              onAction={() => (shown.state === "enabled" ? onPlay?.(seg) : onReason?.(row.key, help))}
            />
            {status && <InlineStatus text={status} variant="notice" onExpire={() => onStatusDone?.()} />}
          </span>
        )}
        <LanguageTag lang={seg.lang} langP={seg.lang_p} />
      </span>
    </div>
  );
}
