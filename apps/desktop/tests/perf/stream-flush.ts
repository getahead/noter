// Performance scenario `ui_stream_flush` (harness/perf.toml, docs/ADR/0003): a 60-minute live call
// replayed through the window store's 100 ms Channel flush (core-bridge feature, `reduceStream`), the
// work the bridge does on every flush of the transcript, levels and cards Channels.
// Deterministic: fixed workload, no clock, no randomness. Bundled by Vite and run with `node --jitless --predictable` (see
// the perf.toml snippet): plain interpreted JavaScript keeps instruction counts stable under cachegrind.
// Exits non-zero when the replay loses or doubles a message, so a fast but wrong flush cannot pass.

import world from "../../../../contracts/fixtures/world.json";
import { reduceStream } from "../../src/app/store/window-store";
import type { CardView, CardsSnapshot, LevelsMsg, SegmentView, TranscriptMsg, TranscriptSnapshot } from "../../src/core/bindings";

type CardsData = CardsSnapshot & { feedback: null };

const TICKS = 60 * 60 * 10; // one flush per 100 ms for 60 minutes
const base = world.transcripts[0] as unknown as TranscriptSnapshot;
const row = base.segments[0]!;
const card = world.cards[0] as unknown as CardView;
const seg = (n: number, channel: string, state: SegmentView["state"]): SegmentView =>
  ({ ...row, id: `seg_${n}`, channel, state, t0_ms: n * 3000, t1_ms: n * 3000 + 2900, text: `${row.text} ${n}` }) as SegmentView;

let transcript: TranscriptSnapshot = { ...base, subscription_id: "sub_perf", segments: [], hypotheses: [], marks: [], gaps: [] };
let levels = { subscription_id: "sub_perf_levels", levels: null as LevelsMsg | null };
let cards: CardsData = { subscription_id: "sub_perf_cards", call_id: base.call_id, visible: [], earlier: [], pinned: [], status: undefined as never, last_seq: 0, feedback: null };
let seq = 0;
let confirmed = 0;

for (let t = 0; t < TICKS; t++) {
  // Transcript: a hypothesis every 200 ms, a confirmed row every 3 s, a correction a minute, a mark every 5 minutes.
  const tr: TranscriptMsg["event"][] = [];
  const channel = t % 60 < 30 ? "mic" : "sys";
  if (t % 2 === 0) tr.push({ type: "hypothesis", segment: seg(confirmed, channel, "hypothesis") });
  if (t % 30 === 29) tr.push({ type: "confirmed", segment: seg(confirmed++, channel, "confirmed") });
  if (t % 600 === 599) tr.push({ type: "segments_updated", segments: [{ ...transcript.segments.at(-1)!, text: "corrected" }] });
  if (t % 3000 === 2999) tr.push({ type: "mark", mark: { at_ms: t * 100 } as never });
  if (tr.length) transcript = reduceStream("transcript_subscribe", transcript, tr.map((event) => ({ seq: ++seq, event })));

  // Levels: two meter readings per flush, only the newest is kept.
  const lv: LevelsMsg[] = [0, 50].map((d) => ({ seq: ++seq, at_ms: t * 100 + d, mic_db: -30 - (t % 20), sys_db: -25 - (t % 15) }));
  levels = reduceStream("levels_subscribe", levels, lv) as typeof levels;

  // Cards: one every 30 s, filled in 2 s later, expired after 90 s.
  const cd: { type: string; [k: string]: unknown }[] = [];
  const n = Math.floor(t / 300);
  if (t % 300 === 0) cd.push({ type: "added", card: { ...card, id: `card_${n}`, number: (n % 3) + 1 } });
  if (t % 300 === 20) cd.push({ type: "updated", card: { ...card, id: `card_${n}`, body: "filled" } });
  if (t % 300 === 0 && n >= 3) cd.push({ type: "expired", card_id: `card_${n - 3}`, reason: "timeout" });
  if (cd.length) cards = reduceStream("cards_subscribe", cards, cd.map((event) => ({ seq: ++seq, event })) as never) as CardsData;
}

const expect = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`ui_stream_flush: ${what}`);
};
expect(transcript.segments.length === TICKS / 30 && new Set(transcript.segments.map((s) => s.id)).size === TICKS / 30, "confirmed rows lost or doubled");
expect(transcript.hypotheses.length === 0 && transcript.marks.length === TICKS / 3000, "a confirmed row left its hypothesis, or marks lost");
expect(levels.levels?.at_ms === (TICKS - 1) * 100 + 50, "levels did not keep the newest reading");
expect(cards.visible.length === 3 && cards.earlier.length === TICKS / 300 - 3, "cards lost or doubled");
