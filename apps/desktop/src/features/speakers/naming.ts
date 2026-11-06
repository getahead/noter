// Pure parts of the post-call naming panel and the Fix Term popover (DESIGN › Speaker naming panel, Term fix popover):
// which speakers the panel lists, its suggestion chips, the sample's playing state and the selection's TextRange.
import type {
  ErrorCode,
  PersonChip,
  PlaybackState,
  SegmentView,
  SpeakerView,
  TextRange,
} from "../../core/bindings";
import { t } from "../../i18n/format";

/** The panel's rows: unnamed speakers still to name, and the ones the user skipped (never counted as named). */
export function panelRows(
  speakers: readonly SpeakerView[],
  skipped: ReadonlySet<string>,
) {
  // @cpt-begin:cpt-noter-state-ui-speakers-naming:p1:inst-skip
  const unnamed = speakers.filter((s) => s.label.type === "unnamed");
  return {
    open: unnamed.filter((s) => !skipped.has(s.id)),
    skipped: unnamed.filter((s) => skipped.has(s.id)),
    unnamed: unnamed.length,
  };
  // @cpt-end:cpt-noter-state-ui-speakers-naming:p1:inst-skip
}

/** The core's suggestion first, then the call's participants that no speaker carries yet (never you). */
export function chipsFor(
  speaker: Pick<SpeakerView, "suggestion">,
  speakers: readonly SpeakerView[],
  participants: readonly PersonChip[],
): PersonChip[] {
  const taken = new Set(
    speakers.flatMap((s) =>
      s.label.type === "person" ? [s.label.person.id] : [],
    ),
  );
  const out = new Map<string, PersonChip>();
  [speaker.suggestion, ...participants].forEach(
    (c) =>
      c && !c.is_you && !taken.has(c.id) && !out.has(c.id) && out.set(c.id, c),
  );
  return [...out.values()];
}

/** The speaker's first confirmed line, by time. */
export function firstLine(
  segments: readonly SegmentView[],
  speakerId: string,
): string | null {
  const own = segments.filter((s) => s.speaker.speaker_id === speakerId);
  return own.length
    ? own.reduce((a, b) => (b.t0_ms < a.t0_ms ? b : a)).text
    : null;
}

/** Play Sample reads **Playing…** from the request until a newer report says playback stopped. */
export function samplePlaying(
  sample: { callId: string; since: number } | null,
  pb: PlaybackState | undefined,
): boolean {
  if (!sample) return false;
  const fresh = pb && pb.version > sample.since && pb.call_id === sample.callId;
  return !fresh || pb.playing || !pb.stopped_reason;
}

/** A TextRange in UTF-16 units (as JavaScript counts and the core expects), ordered and clamped to the text. */
export const rangeOf = (text: string, a: number, b: number): TextRange => ({
  start: Math.max(0, Math.min(a, b)),
  end: Math.min(text.length, Math.max(a, b)),
});

/** The selection's range in the segment's text; `null` when nothing is selected. */
export function selectionRange(
  text: string,
  a: number,
  b: number,
): TextRange | null {
  const r = rangeOf(text, a, b);
  return r.end > r.start ? r : null;
}

// @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-result
/** The status after a fix: the glossary line only when the core added the term. */
export const fixMessage = (to: string, glossaryTermId: string | null) =>
  t(glossaryTermId ? "speakers.fix.done_glossary" : "speakers.fix.done", {
    to,
  });
// @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-result

/** A stale selection (the segment changed under it) or an invalid range: ask to select again instead of retrying. */
export const staleFix = (code: ErrorCode) =>
  code === "not_found" || code === "invalid_input";

/** The command keys of the panel's rows and the fix popover (bridge.act). */
export const nameKey = (speakerId: string) => `speaker:name:${speakerId}`;
export const fixKey = (segmentId: string) => `term:fix:${segmentId}`;
