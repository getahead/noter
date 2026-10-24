// Transcript segment row with its gap, mark and hypothesis variants (DESIGN › Transcript segment row; prototype
// src/js/20-b-components.js C.segmentRow). Markup and classes as the prototype's; the view decides the play control.
import type { Ref } from "react";

import type { SegmentView, SpeakerView } from "../../core/bindings";
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
  /** The disabled control's reason, posted as an inline status (Space or click). */
  status?: string;
  /** The time's help tag when the audio is gone. */
  timeHelp?: string;
  onPlay?: (seg: SegmentView) => void;
  onReason?: (key: string, text: string) => void;
  onStatusDone?: () => void;
  ref?: Ref<HTMLDivElement>;
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

// @cpt-component:cpt-noter-component-ui-transcript-segment-row:p1
export function SegmentRow({ row, variant, speakers, control, playing, highlighted, find, current, status, timeHelp, onPlay, onReason, onStatusDone, ref }: SegmentRowProps) {
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
  const v = rowVariant(seg, variant, speakers);
  const low = seg.confidence != null && seg.confidence < LOW_CONFIDENCE;
  const shown = control && control.state !== "hidden" && !tail ? control : null;
  const help = shown ? t(shown.help) : "";
  return (
    <div
      ref={ref}
      data-component={COMPONENT}
      data-variant={v}
      data-state={playing ? "playing" : highlighted ? "highlighted" : "default"}
      className={cx("cw-seg", tail && "cw-seg--tail", highlighted && "np-hl-evidence", playing && "is-playing", current && "is-current")}
      lang={langAttr(seg.lang)}
      tabIndex={tail ? undefined : 0}
    >
      <span className="cw-seg__time np-tnum" title={timeHelp}>
        {tail ? "" : clock(seg.t0_ms)}
      </span>
      <span className="cw-seg__spk">
        <SpeakerLabel text={spk.text} variant={spk.variant} />
        {v === "crosstalk" && (
          <>
            {" "}
            <Badge text={t("transcript.crosstalk")} kind="kind" />
          </>
        )}
      </span>
      <span className={cx("cw-seg__text", low && "is-lowconf")} title={low ? t("transcript.low_confidence") : undefined}>
        <Text text={seg.text} find={find} />
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
