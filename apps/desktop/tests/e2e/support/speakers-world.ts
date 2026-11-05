// Starting states of the speaker-naming stories, as mutations of the fixture world. The real core keeps `call_live`'s
// transcript with the unnamed Speaker 3 (spk_3, one line, a sample); the page stories add more unnamed speakers to that
// call's transcript (`harness.world_set` takes the transcripts slice) because no stored call has one. Tests only.
import type { SpeakerView } from "../../../src/core/bindings";
import * as W from "../../support/world-presets";
import type { World } from "../../support/scenario";

export const CALL = W.LIVE_CALL;

const transcript = (w: World) => w.transcripts.find((t) => t.call_id === CALL)!;

/** `n` more unnamed speakers after Speaker 3 (Speaker 4, 5…), each with `lines` lines and a sample. */
export function unnamed(w: World, n: number, lines = 3): void {
  const t = transcript(w);
  const base = t.speakers.find((s) => s.id === "spk_3")!;
  for (let i = 0; i < n; i++) {
    const id = `spk_${4 + i}`;
    const speaker: SpeakerView = { ...structuredClone(base), id, label: { type: "unnamed", n: 4 + i }, segment_count: lines };
    t.speakers.push(speaker);
    const detail = w.call_details.find((d) => d.call.id === CALL)!;
    detail.speakers = t.speakers;
  }
}

/** The call's audio was deleted after its retention period: no sample to play. */
export function audioGone(w: World): void {
  for (const s of transcript(w).speakers) s.sample = null;
  const detail = w.call_details.find((d) => d.call.id === CALL)!;
  detail.speakers = transcript(w).speakers;
  detail.call.audio_deleted = true;
  detail.call.audio_deleted_at = Date.now() - 86_400_000;
  w.calls.find((c) => c.id === CALL)!.audio_deleted = true;
}
