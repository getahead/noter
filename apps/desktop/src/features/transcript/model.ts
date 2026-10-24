// The transcript's rows and their text (DESIGN › Transcript view, Transcript segment row, Speaker label, Language tag):
// pure, so the view only draws what these return. The view owns no segments: it reads the window store's transcript slice.
import type { GapView, Lang, MarkView, SegmentView, SpeakerLabel, SpeakerRef, SpeakerView, TranscriptSnapshot } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { callTime, t } from "../../i18n/format";

export type Variant = "live" | "tail" | "stored";

export type Row =
  | { kind: "segment"; key: string; at: number; seg: SegmentView }
  | { kind: "hypothesis"; key: string; at: number; seg: SegmentView }
  | { kind: "gap"; key: string; at: number; gap: GapView }
  | { kind: "mark"; key: string; at: number; mark: MarkView };

export type TranscriptRows = Pick<TranscriptSnapshot, "segments" | "hypotheses" | "gaps" | "marks">;

/** The interface language: gap and mark rows are catalogue text. */
export const UI_LANG = "en";
/** Under this the row reads low confidence (bindings › SegmentView.confidence). */
export const LOW_CONFIDENCE = 0.7;

// @cpt-begin:cpt-noter-flow-ui-live-transcript-follow:p1:inst-render-rows
/**
 * Confirmed rows in the order the core confirmed them, gap and mark rows inserted at their time, the hypothesis rows
 * last. The tail variant keeps only the last `tailLines` transcript lines (no gap or mark rows).
 */
export function buildRows(tr: TranscriptRows, variant: Variant, tailLines = 3): Row[] {
  const hyps = [...tr.hypotheses].sort((a, b) => a.t0_ms - b.t0_ms).map((seg): Row => ({ kind: "hypothesis", key: `hyp:${seg.channel}`, at: seg.t0_ms, seg }));
  const segs = tr.segments.map((seg): Row => ({ kind: "segment", key: seg.id, at: seg.t0_ms, seg }));
  if (variant === "tail") return [...segs, ...hyps].slice(-tailLines);
  const extra = [
    ...tr.gaps.map((gap): Row => ({ kind: "gap", key: `gap:${gap.t0_ms}`, at: gap.t0_ms, gap })),
    ...tr.marks.map((mark): Row => ({ kind: "mark", key: mark.id, at: mark.at_ms, mark })),
  ].sort((a, b) => a.at - b.at);
  // merge: a gap or mark goes before the first segment that starts after it
  const rows: Row[] = [];
  let j = 0;
  for (const r of segs) {
    while (j < extra.length && extra[j]!.at < r.at) rows.push(extra[j++]!);
    rows.push(r);
  }
  return [...rows, ...extra.slice(j), ...hyps];
}
// @cpt-end:cpt-noter-flow-ui-live-transcript-follow:p1:inst-render-rows

const GAP_SPAN: Partial<Record<GapView["reason"], MsgKey>> = {
  paused: "transcript.gap.paused",
  system_audio_silent: "transcript.gap.system_audio_silent",
  stalled: "transcript.gap.stalled",
};
const GAP_LOST: Partial<Record<GapView["reason"], MsgKey>> = {
  engine_restart: "transcript.gap.engine_restart",
  device_changed: "transcript.gap.device_changed",
};

export const clock = (ms: number) => callTime(ms / 1000);

/** **Paused 00:21:08–00:23:40**, **Engine restarted · 2 s lost**; interrupted and continued recordings read **Stopped …**. */
export function gapText(g: GapView): string {
  const lost = GAP_LOST[g.reason];
  if (lost) return t(lost, { count: Math.max(1, Math.round((g.t1_ms - g.t0_ms) / 1000)) });
  return t(GAP_SPAN[g.reason] ?? "transcript.gap.stopped", { from: clock(g.t0_ms), to: clock(g.t1_ms) });
}

export const markText = (m: MarkView) => t("transcript.mark", { at: clock(m.at_ms) });

/** A speaker's current label: a rename or the archive pass replaces it in `speakers`; otherwise the segment's own. */
export function labelOf(ref: SpeakerRef, speakers: readonly SpeakerView[]): SpeakerLabel {
  return speakers.find((s) => s.id === ref.speaker_id)?.label ?? ref.label;
}

export type SpeakerVariant = "you" | "resolved" | "unresolved" | "guest" | "crosstalk";

/** **You**, **Anna K.**, **Speaker 2**, **Guest (your side)**. */
export function speakerName(label: SpeakerLabel): string {
  switch (label.type) {
    case "you":
      return t("transcript.speaker.you");
    case "person":
      return label.person.is_you ? t("transcript.speaker.you") : label.person.short_name;
    case "unnamed":
      return t("transcript.speaker.unnamed", { n: label.n });
    case "guest_your_side":
      return t("transcript.speaker.guest");
  }
}

export function speakerVariant(label: SpeakerLabel): SpeakerVariant {
  if (label.type === "you" || (label.type === "person" && label.person.is_you)) return "you";
  return label.type === "person" ? "resolved" : label.type === "guest_your_side" ? "guest" : "unresolved";
}

/** The row's speaker column: both candidates on a crosstalk row, **Anna K. / Speaker 3**. */
export function speakerColumn(seg: SegmentView, speakers: readonly SpeakerView[]): { text: string; variant: SpeakerVariant } {
  if (seg.crosstalk_with.length > 1) return { text: seg.crosstalk_with.map((r) => speakerName(labelOf(r, speakers))).join(" / "), variant: "crosstalk" };
  const label = labelOf(seg.speaker, speakers);
  return { text: speakerName(label), variant: speakerVariant(label) };
}

/** The `lang` attribute of a row: the ISO code the core carries, or `und` when it carries none. */
export const langAttr = (lang: Lang | null | undefined): string => (!lang ? "und" : typeof lang === "string" ? lang : lang.code.toLowerCase());

/** The language's English name for VoiceOver and the help tag: **Russian**. */
export function langName(lang: Lang): string {
  const code = langAttr(lang);
  try {
    return new Intl.DisplayNames([UI_LANG], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The language tag: **RU**, or **RU?** when language ID was unsure (`lang_p` under 0.7: the speaker prior decided). */
export function langTag(lang: Lang, langP: number | null = null): { text: string; label: string; low: boolean } {
  const low = langP != null && langP < LOW_CONFIDENCE;
  const code = langAttr(lang).toUpperCase();
  const name = langName(lang);
  return { text: low ? `${code}?` : code, label: low ? t("transcript.lang_low", { lang: name }) : name, low };
}

/** The segment row's variant (DESIGN › Transcript segment row › Variants). */
export function rowVariant(seg: SegmentView, variant: Variant, speakers: readonly SpeakerView[]): string {
  if (variant === "tail") return "tail";
  if (seg.crosstalk_with.length > 1) return "crosstalk";
  if (speakerVariant(labelOf(seg.speaker, speakers)) === "you") return "you";
  return seg.confidence != null && seg.confidence < LOW_CONFIDENCE ? "low-confidence" : "confirmed";
}

/** Rows whose text contains `query` (case-insensitive); the stored variant's find bar. */
export function findMatches(rows: readonly Row[], query: string): string[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  return rows.filter((r) => r.kind === "segment" && r.seg.text.toLocaleLowerCase().includes(q)).map((r) => r.key);
}

/** The text split around the first match, for the match highlight. */
export function splitMatch(text: string, query: string): [string, string, string] | null {
  const q = query.trim();
  const i = q ? text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase()) : -1;
  return i < 0 ? null : [text.slice(0, i), text.slice(i, i + q.length), text.slice(i + q.length)];
}

/** The rows a span covers (evidence, search result). */
export const spanKeys = (rows: readonly Row[], span: { t0_ms: number; t1_ms: number }) =>
  rows.filter((r) => r.kind === "segment" && r.seg.t1_ms >= span.t0_ms && r.seg.t0_ms <= span.t1_ms).map((r) => r.key);

/** dBFS (-90..0) to the level meter's 0–10 segments; -60 dB and below is silent. */
export const meterLevel = (db: number | null | undefined) => (db == null ? 0 : Math.max(0, Math.min(10, Math.round((db + 60) / 6))));
