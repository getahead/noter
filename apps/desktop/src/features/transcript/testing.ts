// Segments for the transcript's unit tests.
import type { SegmentView, SpeakerRef } from "../../core/bindings";

export const ANNA: SpeakerRef = { speaker_id: "spk_anna", label: { type: "person", person: { id: "per_anna", display_name: "Anna Kuznetsova", short_name: "Anna K.", initials: "AK", is_you: false } } };
export const YOU: SpeakerRef = { speaker_id: "spk_you", label: { type: "you" } };
export const S3: SpeakerRef = { speaker_id: "spk_3", label: { type: "unnamed", n: 3 } };

export const seg = (id: string, t0: number, over: Partial<SegmentView> = {}): SegmentView => ({
  id,
  call_id: "call_1",
  channel: "sys",
  speaker: ANNA,
  crosstalk_with: [],
  t0_ms: t0,
  t1_ms: t0 + 4000,
  text: `Line ${id}`,
  lang: "en",
  lang_p: 0.9,
  confidence: 0.9,
  state: "confirmed",
  pass: "live",
  corrections: [],
  ...over,
});
