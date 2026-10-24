import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../app/App";
import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { CallDetail, WindowLabel } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import type { World } from "../../../tests/support/scenario";
import { find, rendered } from "../../ui/testing";
import { audioLine, CallScreenTranscript, StoredTranscriptRoute, TranscriptBar, TranscriptLog, useTranscript, type TranscriptHandle } from "./hosts";
import { LanguageTag, SpeakerLabel } from "./labels";
import { buildRows, type Row } from "./model";
import { PlaybackBar } from "./playback-bar";
import { SegmentRow } from "./segment-row";
import { ANNA, S3, seg, YOU } from "./testing";
import { TranscriptView } from "./transcript-view";

const LIVE = "call_live";
const PAST = "call_backend";
const rowOf = (s = seg("a", 1_198_000, { lang: "ru", text: "drawer redesign до пятницы" })) => ({ kind: "segment" as const, key: s.id, at: s.t0_ms, seg: s });
const act = (p: Record<string, unknown>) => (p.onAction as () => void)();
const hookOf = (b: Bridge, callId: string, o: Parameters<typeof useTranscript>[2] = {}) => rendered(() => useTranscript(b, callId, o) as never, {}) as unknown as TranscriptHandle;

describe("speaker label and language tag", () => {
  it("draw the prototype's markup with the variant and the VoiceOver name", () => {
    const you = renderToString(<SpeakerLabel text="You" variant="you" />);
    expect(you).toContain('data-component="cpt-noter-component-ui-speaker-label"');
    expect(you).toContain('class="np-spk"');
    expect(renderToString(<SpeakerLabel text="Speaker 2" variant="unresolved" />)).toContain("np-spk is-secondary");
    const low = renderToString(<LanguageTag lang="ru" confidence={0.6} />);
    expect(low).toContain('data-state="low-confidence"');
    expect(low).toContain('aria-label="Russian, low confidence"');
    expect(low).toContain(">RU?<");
    expect(renderToString(<LanguageTag lang="de" variant="call" />)).toContain('data-variant="call"');
  });
});

describe("SegmentRow (cpt-noter-component-ui-transcript-segment-row)", () => {
  it("draws a confirmed row with its time, speaker, text, lang, tag and play control", () => {
    const html = renderToString(<SegmentRow row={rowOf()} variant="live" speakers={[]} control={{ state: "enabled", help: "transcript.play" }} />);
    expect(html).toContain('lang="ru"');
    expect(html).toContain("00:19:58");
    expect(html).toContain("Anna K.");
    expect(html).toContain('aria-label="Play this line"');
    expect(html).toContain('data-variant="confirmed"');
    expect(html).toContain('tabindex="0"');
  });

  it("plays when enabled, and posts the reason when disabled (it stays focusable)", () => {
    const onPlay = vi.fn();
    const onReason = vi.fn();
    const r = rowOf();
    act(find(rendered(SegmentRow, { row: r, variant: "live", speakers: [], control: { state: "enabled", help: "transcript.play" }, onPlay }), (p) => p.label === "Play this line").props);
    expect(onPlay).toHaveBeenCalledWith(r.seg);
    const off = rendered(SegmentRow, { row: r, variant: "live", speakers: [], control: { state: "disabled", help: "transcript.play.speakers" }, onReason, status: "why" });
    const button = find(off, (p) => p.label === "Play this line").props;
    expect(button.disabled).toBeUndefined();
    expect((button.attrs as Record<string, string>)["aria-disabled"]).toBe("true");
    act(button);
    expect(onReason).toHaveBeenCalledWith("a", expect.stringContaining("Replay is off while recording on speakers"));
    expect(renderToString(off)).toContain('role="status"');
  });

  it("draws the hypothesis hidden from VoiceOver with the … glyph, no time, tag or actions", () => {
    const h = seg("h", 5000, { state: "hypothesis", text: "I think" });
    const html = renderToString(<SegmentRow row={{ kind: "hypothesis", key: "hyp:sys", at: 5000, seg: h }} variant="live" speakers={[]} control={{ state: "hidden" }} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-state="hypothesis"');
    expect(html).toContain("I think…");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("np-lang");
    expect(renderToString(<SegmentRow row={{ kind: "hypothesis", key: "hyp:sys", at: 0, seg: { ...h, text: "Then…" } }} variant="tail" speakers={[]} />)).not.toContain("Then……");
  });

  it("draws crosstalk, You, low confidence, find matches, playing, evidence and the tail", () => {
    const cross = renderToString(<SegmentRow row={rowOf(seg("c", 0, { crosstalk_with: [ANNA, S3] }))} variant="live" speakers={[]} />);
    expect(cross).toContain("Anna K. / Speaker 3");
    expect(cross).toContain("Crosstalk");
    expect(renderToString(<SegmentRow row={rowOf(seg("y", 0, { speaker: YOU, channel: "mic" }))} variant="live" speakers={[]} />)).toContain('data-variant="you"');
    const low = renderToString(
      <SegmentRow row={rowOf(seg("l", 0, { confidence: 0.5, text: "We add a replay buffer" }))} variant="stored" speakers={[]} find="replay" current highlighted playing control={{ state: "enabled", help: "transcript.play" }} timeHelp="Audio not stored for this call" />,
    );
    expect(low).toContain("is-lowconf");
    expect(low).toContain('title="Low confidence"');
    expect(low).toContain('<mark class="np-hl-match">replay</mark>');
    expect(low).toContain("is-current");
    expect(low).toContain("np-hl-evidence");
    expect(low).toContain('data-state="playing"');
    expect(low).toContain('aria-label="Pause"');
    expect(low).toContain('title="Audio not stored for this call"');
    expect(renderToString(<SegmentRow row={rowOf(seg("e", 0))} variant="live" speakers={[]} highlighted />)).toContain('data-state="highlighted"');
    const tail = renderToString(<SegmentRow row={rowOf()} variant="tail" speakers={[]} control={{ state: "enabled", help: "transcript.play" }} />);
    expect(tail).toContain("cw-seg--tail");
    expect(tail).not.toContain("<button");
    expect(tail).not.toContain("00:19:58");
  });

  it("draws gap and mark rows as text in the interface language", () => {
    const g = renderToString(<SegmentRow row={{ kind: "gap", key: "g", at: 0, gap: { call_id: "c", t0_ms: 1_330_000, t1_ms: 1_360_000, reason: "paused" } }} variant="live" speakers={[]} />);
    expect(g).toContain("Paused 00:22:10–00:22:40");
    expect(g).toContain('lang="en"');
    const m = renderToString(<SegmentRow row={{ kind: "mark", key: "m", at: 0, mark: { id: "m", call_id: "c", at_ms: 1_260_000, note: "decision" } }} variant="live" speakers={[]} />);
    expect(m).toContain("Marked 00:21:00");
    expect(m).toContain('lang="und"');
    const tail = renderToString(<SegmentRow row={{ kind: "mark", key: "m", at: 0, mark: { id: "m", call_id: "c", at_ms: 1_260_000, note: null } }} variant="tail" speakers={[]} />);
    expect(tail).toContain('<span class="cw-seg__time np-tnum"></span>');
  });
});

describe("PlaybackBar (cpt-noter-component-ui-playback-bar)", () => {
  const replay = { key: "a", call_id: LIVE, from_ms: 1_198_000, to_ms: 1_204_000, speaker: "Anna K.", since: 0, paused: false };
  it("draws the live-headphones line, the controls and the time; Esc and × close it", () => {
    const onClose = vi.fn();
    const onSeek = vi.fn();
    const onToggle = vi.fn();
    const p = { variant: "live-headphones" as const, state: "PLAYING" as const, replay, position_ms: 1_199_000, onToggle, onSeek, onClose };
    const html = renderToString(<PlaybackBar {...p} />);
    expect(html).toContain("Replaying while recording · headphones");
    expect(html).toContain("00:19:59");
    expect(html).toContain('aria-label="Close Playback"');
    expect(html).toContain('data-state="playing"');
    const tree = rendered(PlaybackBar, p);
    act(find(tree, (q) => q.label === "Close Playback").props);
    act(find(tree, (q) => q.label === "Back 5 Seconds").props);
    act(find(tree, (q) => q.label === "Forward 5 Seconds").props);
    act(find(tree, (q) => q.label === "Pause").props);
    (find(tree, (q) => q["aria-label"] === "Position").props.onChange as (e: unknown) => void)({ target: { value: "1200000" } });
    (tree.props.onKeyDown as (e: unknown) => void)({ key: "Escape", stopPropagation: vi.fn() });
    (tree.props.onKeyDown as (e: unknown) => void)({ key: "a", stopPropagation: vi.fn() });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSeek.mock.calls).toEqual([[1_194_000], [1_204_000], [1_200_000]]);
    expect(onToggle).toHaveBeenCalledOnce();
  });
  it("shows the stop by the route, and the stored variant without the live line", () => {
    const base = { replay, position_ms: 0, onToggle: vi.fn(), onSeek: vi.fn(), onClose: vi.fn() };
    const stopped = renderToString(<PlaybackBar variant="live-headphones" state="STOPPED_BY_ROUTE" {...base} />);
    expect(stopped).toContain("Replay stopped: output switched to speakers");
    expect(stopped).toContain('role="status"');
    const stored = renderToString(<PlaybackBar variant="stored" state="PAUSED" {...base} />);
    expect(stored).toContain("cw-pb--post-call");
    expect(stored).not.toContain("Replaying while recording");
    expect(stored).toContain('aria-label="Play"');
    expect(stored).toContain("00:19:28"); // clamped to the span minus 30 s
  });
});

describe("TranscriptView (cpt-noter-component-ui-transcript-view)", () => {
  const rows = buildRows({ segments: [seg("a", 0, { text: "We add a replay buffer" }), seg("b", 5000)], hypotheses: [seg("h", 9000, { state: "hypothesis" })], gaps: [], marks: [] }, "live");
  it("is a log, never announced, with every row and its play control", () => {
    const html = renderToString(<TranscriptView variant="live" rows={rows} speakers={[]} loaded control={() => ({ state: "enabled", help: "transcript.play" })} />);
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="off"');
    expect(html).toContain('aria-label="Transcript"');
    expect(html).toContain('data-state="following"');
    expect(html.match(/data-component="cpt-noter-component-ui-transcript-segment-row"/g)).toHaveLength(3);
    expect(html).not.toContain("Jump to Live");
  });
  it("shows the waiting state with the two meters", () => {
    const html = renderToString(<TranscriptView variant="live" rows={[]} speakers={[]} loaded waiting levels={{ mic_db: -30, sys_db: null }} />);
    expect(html).toContain("Waiting for speech…");
    expect(html).toContain(">You<");
    expect(html).toContain(">Others<");
    expect(html).toContain('aria-label="Microphone level"');
    expect(html).toContain('data-state="waiting-for-speech"');
  });
  it("shows skeleton rows, the error and the header in the stored variant", () => {
    const html = renderToString(<TranscriptView variant="stored" rows={[]} speakers={[]} loaded={false} loading header="Audio not stored for this call" error={<p>broken</p>} />);
    expect(html).toContain("pc-skel__line");
    expect(html).toContain("Audio not stored for this call");
    expect(html).toContain("<p>broken</p>");
    expect(html).toContain("cw-tv--post-call");
    expect(renderToString(<TranscriptView variant="tail" rows={rows} speakers={[]} loaded />)).toContain("cw-tv--tail");
  });
  it("routes a row's reason to its inline status and a refused play to the row", () => {
    const onRefusedDone = vi.fn();
    const tree = rendered(TranscriptView, { variant: "live", rows, speakers: [], loaded: true, refused: { key: "a", text: "Refused" }, onRefusedDone });
    const row = find(tree, (p) => (p.row as Row | undefined)?.key === "a");
    expect(row.props.status).toBe("Refused");
    (row.props.onReason as (k: string, t: string) => void)("a", "why");
    (row.props.onStatusDone as () => void)();
    expect(onRefusedDone).toHaveBeenCalledOnce();
  });
});

let bridge: Bridge | null = null;
afterEach(async () => {
  await bridge?.close();
  bridge = null;
});
async function open(label: WindowLabel, mutate: (w: World) => void = () => {}) {
  const fake = new FakeCore({ window: label });
  mutate(fake.world as unknown as World);
  bridge = createBridge(label, fake);
  await bridge.open();
  return { fake, bridge };
}

describe("useTranscript and TranscriptPanel (hosts)", () => {
  it("draws the live call in CS-R2 from the Channel, and the call screen mounts it", async () => {
    const { bridge: b } = await open("call-screen", (w) => void (w.live_script = []));
    await b.subscribe("transcript_subscribe", { call_id: LIVE });
    const html = renderToString(<CallScreenTranscript bridge={b} />);
    expect(html).toContain('data-region="CS-R2"');
    expect(html).toContain("drawer redesign");
    expect(renderToString(<App bridge={b} />)).toContain('data-region="CS-R2"');
    const tr = hookOf(b, LIVE);
    expect(renderToString(<TranscriptLog tr={tr} variant="tail" tailLines={2} />).match(/cw-seg--tail/g)).toHaveLength(2);
    expect(renderToString(<TranscriptBar tr={tr} variant="live" />)).toBe("");
  });

  it("plays a line, pauses, resumes, seeks and closes through audio_play and audio_stop", async () => {
    const { bridge: b } = await open("call-screen", (w) => void (w.live_script = []));
    await b.subscribe("transcript_subscribe", { call_id: LIVE });
    const play = vi.spyOn(b.core, "audioPlay");
    const stop = vi.spyOn(b.core, "audioStop");
    const first = hookOf(b, LIVE);
    const anna = first.data!.segments.find((s) => s.text.includes("drawer redesign"))!;
    expect(first.control({ kind: "segment", key: anna.id, at: 0, seg: anna })).toEqual({ state: "enabled", help: "transcript.play" });
    expect(first.control({ kind: "gap", key: "g", at: 0, gap: { call_id: LIVE, t0_ms: 0, t1_ms: 1, reason: "paused" } })).toBeUndefined();
    await first.play(anna);
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ call_id: LIVE, from_ms: anna.t0_ms }));
    expect(b.store.getState().whole.playback?.playing).toBe(true);
    const playing = hookOf(b, LIVE);
    expect(renderToString(<TranscriptBar tr={{ ...playing, replay: { key: anna.id, call_id: LIVE, from_ms: anna.t0_ms, to_ms: anna.t1_ms, speaker: "Anna K.", since: 0, paused: false }, bar: "PLAYING" }} variant="live" />)).toContain('data-region="CS-R2b"');
    expect(renderToString(<TranscriptBar tr={{ ...playing, replay: { key: anna.id, call_id: LIVE, from_ms: 0, to_ms: 1, speaker: "", since: 0, paused: false }, bar: "PLAYING" }} variant="tail" />)).not.toContain("data-region");
    first.toggle();
    first.seek(anna.t0_ms + 1000);
    first.close();
    await Promise.resolve();
    expect(stop).toHaveBeenCalled();
  });

  it("shows a refused play's reason on the row", async () => {
    const { bridge: b } = await open("call-screen", (w) => {
      w.live_script = [];
      w.app.environment.output_route = "speakers";
    });
    await b.subscribe("transcript_subscribe", { call_id: LIVE });
    const tr = hookOf(b, LIVE);
    await tr.play(tr.data!.segments[0]!);
    expect(b.store.getState().commands.audio_play?.state).toBe("ERROR");
  });

  it("draws the stored transcript in PC-R5 with its audio line, and the dev route mounts it", async () => {
    const { bridge: b } = await open("main");
    await b.subscribe("transcript_subscribe", { call_id: PAST });
    const detail = (await b.core.callGet({ call_id: PAST })) as { status: "ok"; data: CallDetail };
    const tr = hookOf(b, PAST, { detail: detail.data });
    expect(renderToString(<TranscriptLog tr={tr} variant="stored" />)).toMatch(/audio kept until/);
    expect(renderToString(<TranscriptLog tr={hookOf(b, PAST, { detail: { ...detail.data, audio_not_stored: true } })} variant="stored" />)).toContain('title="Audio not stored for this call"');
    expect(renderToString(<TranscriptLog tr={hookOf(b, PAST, { detail: { ...detail.data, call: { ...detail.data.call, audio_deleted: true } } })} variant="stored" />)).toContain('title="Audio deleted"');
    expect(hookOf(b, PAST, { audioKept: false }).control({ kind: "segment", key: "x", at: 0, seg: tr.data!.segments[0]! })).toEqual({ state: "hidden" });
    expect(renderToString(<StoredTranscriptRoute bridge={b} callId={PAST} />)).toContain('data-region="PC-R5"');
    expect(tr.waiting).toBe(false);
  });

  it("writes the audio line for kept, deleted and never-stored audio", () => {
    const prefs = { time_format: "h24" as const, first_weekday: 1, time_zone: "UTC" };
    const call = { audio_deleted: false, audio_kept_until: Date.UTC(2026, 10, 15), started_at: Date.UTC(2026, 9, 16), duration_ms: 52 * 60_000 };
    const d = (c: object, notStored = false) => ({ call: { ...call, ...c }, audio_not_stored: notStored }) as unknown as CallDetail;
    // the date in the macOS locale: "15 Nov" or "Nov 15"; D-36: no deletion date in M1
    expect(audioLine(d({}), prefs)).toMatch(/^52 min · audio kept until (15 Nov|Nov 15)$/);
    expect(audioLine(d({}), undefined)).toBeNull();
    expect(audioLine(d({ audio_deleted: true }), prefs)).toBe("Audio deleted · transcript kept");
    expect(audioLine(d({}, true), prefs)).toBe("Audio not stored for this call");
    expect(audioLine(d({ audio_kept_until: null }), prefs)).toBeNull();
    expect(audioLine(null, prefs)).toBeNull();
  });

  it("shows the read error with Try Again in the view body", async () => {
    const { fake, bridge: b } = await open("main");
    fake.failNext("transcript_subscribe", "internal");
    await b.subscribe("transcript_subscribe", { call_id: PAST });
    const html = renderToString(<TranscriptLog tr={hookOf(b, PAST)} variant="stored" />);
    expect(html).toContain("Couldn’t load the transcript.");
    expect(html).toContain("Try Again");
  });
});
