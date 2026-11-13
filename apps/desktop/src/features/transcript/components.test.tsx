import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../app/App";
import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { CallDetail, WindowLabel } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import type { World } from "../../../tests/support/scenario";
import { find, rendered } from "../../ui/testing";
import { audioLine, holdFix, readNaming, StoredTranscript, TranscriptBar, TranscriptLog, useTranscript, type TranscriptHandle } from "./hosts";
import { LanguageTag, SpeakerLabel } from "./labels";
import { buildRows, type Row } from "./model";
import { LogScroller } from "./follow";
import { resetUndo, undoLast } from "../history/undo";
import { PlaybackBar } from "./playback-bar";
import { SegmentRow } from "./segment-row";
import { ANNA, S3, seg, YOU } from "./testing";
import { moveLineFocus, TranscriptView } from "./transcript-view";

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
    const low = renderToString(<LanguageTag lang="ru" langP={0.6} />);
    expect(low).toContain('data-state="low-confidence"');
    expect(low).toContain('aria-label="Russian, low confidence"');
    expect(low).toContain(">RU?<");
    expect(renderToString(<LanguageTag lang="de" variant="call" />)).toContain('data-variant="call"');
  });
});

describe("SegmentRow (cpt-noter-component-ui-transcript-segment-row)", () => {
  it("marks corrected words with accessible original wording and reopens their correction", () => {
    const corrected = seg("term", 0, { text: "ArchiMate is here", corrections: [
      { range: { start: 0, end: 9 }, original: "a chi" },
      { range: { start: 50, end: 55 }, original: "missing" },
    ] });
    const onReopenFixTerm = vi.fn();
    const props = { row: rowOf(corrected), variant: "stored" as const, speakers: [], onReopenFixTerm };
    expect(renderToString(<SegmentRow {...props} />)).toContain('aria-label="Heard as “a chi”"');
    const row = rendered(SegmentRow, props);
    const correctedText = find(row, (p) => p.seg === corrected);
    const text = (correctedText.type as (p: unknown) => React.ReactNode)(correctedText.props);
    const button = find(text, (p) => p.className === "cw-term");
    const anchor = {} as HTMLElement;
    (button.props.onClick as (e: unknown) => void)({ currentTarget: anchor });
    expect(onReopenFixTerm).toHaveBeenCalledWith(corrected, { start: 0, end: 9 }, anchor);
  });

  it("selected words open the Copy / Fix Term menu by pointer or keyboard, and the label opens Rename", () => {
    const r = rowOf();
    const onFixTerm = vi.fn();
    const onRename = vi.fn();
    const tree = rendered(SegmentRow, { row: r, variant: "live", speakers: [], onFixTerm, onRename });
    const text = find(tree, (p) => "onContextMenu" in p).props as { onContextMenu: (e: unknown) => void };
    const el = { contains: () => true };
    const event = { currentTarget: el, preventDefault: vi.fn() };
    vi.stubGlobal("document", { createRange: () => ({ selectNodeContents() {}, setEnd() {}, toString: () => "ab" }) });
    vi.stubGlobal("getSelection", () => ({ rangeCount: 1, isCollapsed: false, getRangeAt: () => ({ startContainer: {}, endContainer: {}, startOffset: 0, toString: () => "cd" }) }));
    text.onContextMenu(event);
    expect(onFixTerm).toHaveBeenCalledWith(expect.anything(), { start: 2, end: 4 }, el);
    expect(event.preventDefault).toHaveBeenCalled();
    const keyboard = find(tree, (p) => "onKeyDown" in p).props as { onKeyDown: (e: unknown) => void };
    const keyEvent = { currentTarget: { querySelector: () => el }, preventDefault: vi.fn(), key: "F10", shiftKey: true };
    keyboard.onKeyDown(keyEvent);
    expect(keyEvent.preventDefault).toHaveBeenCalledOnce();
    keyboard.onKeyDown({ ...keyEvent, key: "ContextMenu", shiftKey: false });
    expect(onFixTerm).toHaveBeenCalledTimes(3);
    keyboard.onKeyDown({ ...keyEvent, shiftKey: false });
    keyboard.onKeyDown({ ...keyEvent, currentTarget: { querySelector: () => null } });
    expect(onFixTerm).toHaveBeenCalledTimes(3);
    vi.stubGlobal("getSelection", () => null);
    event.preventDefault.mockClear();
    text.onContextMenu(event);
    keyboard.onKeyDown({ ...keyEvent, preventDefault: event.preventDefault });
    expect(onFixTerm).toHaveBeenCalledTimes(3);
    expect(event.preventDefault).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    const label = find(tree, (p) => "onRename" in p && "text" in p).props as { onRename: (a: unknown) => void };
    label.onRename(el);
    expect(onRename).toHaveBeenCalledWith(expect.any(String), expect.anything(), el);
    const btn = find(rendered(SpeakerLabel, { text: "Speaker 3", variant: "unnamed" as never, onRename }), (p) => "onClick" in p).props as { onClick: (e: unknown) => void };
    btn.onClick({ currentTarget: el });
    expect(onRename).toHaveBeenCalledTimes(2);
  });

  it("draws a confirmed row with its time, speaker, text, lang, tag and play control", () => {
    const html = renderToString(<SegmentRow row={rowOf()} variant="live" speakers={[]} control={{ state: "enabled", help: "transcript.play" }} />);
    expect(html).toContain('lang="ru"');
    expect(html).toContain("00:19:58");
    expect(html).toContain("Anna K.");
    expect(html).toContain('aria-label="Play this line"');
    expect(html).toContain('data-variant="confirmed"');
    expect(html).toContain('tabindex="-1"'); // reached with ↑/↓ unless it is the list's one Tab stop
    expect(renderToString(<SegmentRow row={rowOf()} variant="live" speakers={[]} stop />)).toContain('tabindex="0"');
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

  it("moves line focus through the complete list for arrows, Home, End and Command arrows", () => {
    const list = [rowOf(seg("first", 0)), { kind: "gap" as const, key: "gap", at: 1, gap: { call_id: LIVE, t0_ms: 1, t1_ms: 2, reason: "paused" as const } }, rowOf(seg("last", 5000))];
    const keys = list.map((row) => row.key);
    const log = new LogScroller(32);
    const area = { scrollTop: 0, clientHeight: 96, scrollHeight: 1000, scrollTo: ({ top }: { top: number }) => { area.scrollTop = top; } } as unknown as HTMLDivElement;
    const setPos = vi.fn();
    const move = (key: string, metaKey = false, id = "first") => {
      const preventDefault = vi.fn();
      moveLineFocus({ key, metaKey, target: { closest: () => ({ getAttribute: () => id }) }, preventDefault } as never, list, keys, log, area, setPos);
      return preventDefault;
    };
    expect(move("ArrowDown")).toHaveBeenCalledOnce();
    expect(log.focusKey).toBe("last");
    expect(setPos).toHaveBeenCalledWith({ top: area.scrollTop, height: area.clientHeight });
    expect(move("ArrowUp", true)).toHaveBeenCalledOnce();
    expect(log.focusKey).toBe("first");
    expect(move("ArrowDown", true)).toHaveBeenCalledOnce();
    expect(log.focusKey).toBe("last");
    expect(move("Home")).toHaveBeenCalledOnce();
    expect(log.focusKey).toBe("first");
    expect(move("End")).toHaveBeenCalledOnce();
    expect(log.focusKey).toBe("last");
    expect(move("x")).not.toHaveBeenCalled();
  });

  it("routes scroll-area focus and ignores keys outside the line navigation map", () => {
    const tree = rendered(TranscriptView, { variant: "stored", rows, speakers: [], loaded: true });
    const scroll = find(tree, (p) => p.className === "cw-tv__scroll");
    const event = { key: "x", metaKey: false, target: { closest: () => null }, preventDefault: vi.fn() };
    (scroll.props.onKeyDown as (e: unknown) => void)(event);
    (scroll.props.onFocus as (e: unknown) => void)({ target: { closest: () => ({ getAttribute: () => "a" }) } });
    expect(event.preventDefault).not.toHaveBeenCalled();
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

describe("holdFix (the Undo of a term fix)", () => {
  it("re-reads the fixed line when the strip's Undo ran, since no Channel event restores it", async () => {
    const { bridge: b } = await open("main");
    const span = vi.spyOn(b.core, "transcriptSpan");
    resetUndo();
    holdFix(b, seg("seg_fix", 0))("Fixed “a” · added to the glossary", "chg_unknown");
    await undoLast(b);
    expect(span).toHaveBeenCalledOnce();
    resetUndo();
  });
});

describe("fake transcript corrections", () => {
  it("removes and restores a one-line speaker split through undo and redo", async () => {
    const { fake, bridge: b } = await open("main");
    const transcript = fake.world.transcripts[0]!;
    const segment = transcript.segments.find((line) => line.speaker.speaker_id === "spk_3")!;
    const speakerCount = transcript.speakers.length;
    const renamed = await b.core.transcriptRenameSpeaker({ call_id: transcript.call_id, speaker_id: "spk_3", person: { type: "existing", person_id: "per_anna" }, scope: { type: "one_segment", segment_id: segment.id } });
    expect(renamed.status).toBe("ok");
    expect(transcript.speakers).toHaveLength(speakerCount + 1);
    if (renamed.status !== "ok") return;
    await b.core.changeUndo({ target: { type: "change", change_id: renamed.data.change_id } });
    expect(transcript.segments.find((line) => line.id === segment.id)?.speaker.speaker_id).toBe("spk_3");
    expect(transcript.speakers).toHaveLength(speakerCount);
    await b.core.changeRedo({ target: { type: "change", change_id: renamed.data.change_id } });
    expect(transcript.speakers).toHaveLength(speakerCount + 1);
    expect(transcript.segments.find((line) => line.id === segment.id)?.speaker.speaker_id).not.toBe("spk_3");
    expect((await b.core.transcriptRenameSpeaker({ call_id: transcript.call_id, speaker_id: "spk_3", person: { type: "existing", person_id: "per_anna" }, scope: { type: "whole_call" } })).status).toBe("ok");
  });

  it("shifts later correction ranges when an earlier term grows and rejects invalid ranges", async () => {
    const { fake, bridge: b } = await open("main", (w) => {
      const transcript = w.transcripts[0]!;
      transcript.segments[0]!.text = "abcdefghijklmno";
      transcript.segments[0]!.corrections = [];
    });
    const transcript = fake.world.transcripts[0]!;
    const line = transcript.segments[0]!;
    const first = await b.core.transcriptFixTerm({ call_id: transcript.call_id, segment_id: line.id, range: { start: 10, end: 12 }, replacement: "XYZ", add_to_glossary: false });
    expect(first.status).toBe("ok");
    const earlier = await b.core.transcriptFixTerm({ call_id: transcript.call_id, segment_id: line.id, range: { start: 0, end: 2 }, replacement: "longer", add_to_glossary: false });
    expect(earlier.status).toBe("ok");
    expect(line.text).toBe("longercdefghijXYZmno");
    expect(line.corrections.map((c) => c.range)).toEqual([{ start: 0, end: 6 }, { start: 14, end: 17 }]);
    if (earlier.status === "ok") await b.core.changeUndo({ target: { type: "change", change_id: earlier.data.change_id } });
    expect(line.text).toBe("abcdefghijXYZmno");
    expect(line.corrections).toHaveLength(1);
    expect(line.corrections[0]!.range).toEqual({ start: 10, end: 13 });
    const invalid = await b.core.transcriptFixTerm({ call_id: transcript.call_id, segment_id: line.id, range: { start: 9000, end: 9005 }, replacement: "oops", add_to_glossary: false });
    expect(invalid.status).toBe("error");
    expect(line.text).toBe("abcdefghijXYZmno");
    const overlapping = await b.core.transcriptFixTerm({ call_id: transcript.call_id, segment_id: line.id, range: { start: 11, end: 12 }, replacement: "Q", add_to_glossary: false });
    expect(overlapping.status).toBe("ok");
    expect(line.corrections.map((c) => c.range)).toEqual([{ start: 11, end: 12 }]);
  });
});

describe("readNaming (the Summary's naming panel)", () => {
  it("reads the call's speakers and lines once, or nothing for a call the core does not know", async () => {
    const { bridge: b } = await open("main");
    const got = await readNaming(b, LIVE);
    expect(got?.speakers.length).toBeGreaterThan(0);
    expect(got?.segments.length).toBeGreaterThan(0);
    expect(await readNaming(b, "call_missing")).toBeNull();
  });
});

describe("useTranscript and TranscriptPanel (hosts)", () => {
  it("offers term fixes and corrected-word reopening in live and stored logs", async () => {
    const { bridge: b } = await open("main");
    await b.subscribe("transcript_subscribe", { call_id: LIVE });
    const tr = hookOf(b, LIVE);
    const range = { start: 0, end: 1 };
    const anchor = {} as HTMLElement;
    for (const variant of ["live", "stored"] as const) {
      const tree = rendered(TranscriptLog, { tr, variant });
      const row = find(tree, (p) => typeof p.onFixTerm === "function");
      (row.props.onFixTerm as (s: unknown, r: unknown, a: unknown) => void)(tr.data!.segments[0], range, anchor);
      (row.props.onReopenFixTerm as (s: unknown, r: unknown, a: unknown) => void)(tr.data!.segments[0], range, anchor);
    }
  });

  it("requests the native call window key before live rename, but never for stored rename", async () => {
    const { bridge: b } = await open("call-screen", (w) => void (w.live_script = []));
    await b.subscribe("transcript_subscribe", { call_id: LIVE });
    const focus = vi.spyOn(b.core, "windowShowCall");
    const tr = hookOf(b, LIVE);
    const rename = (variant: "live" | "stored") => find(rendered(TranscriptLog, { tr, variant }), (p) => "onRename" in p).props.onRename as (...args: unknown[]) => Promise<void>;
    await rename("live")("spk_3", tr.data!.segments[0], {});
    expect(focus).toHaveBeenCalledWith({});
    focus.mockClear();
    await rename("stored")("spk_3", tr.data!.segments[0], {});
    expect(focus).not.toHaveBeenCalled();
  });

  it("draws the live call in CS-R2 from the Channel, and the call screen mounts it", async () => {
    const { bridge: b } = await open("call-screen", (w) => void (w.live_script = []));
    await b.subscribe("transcript_subscribe", { call_id: LIVE });
    await b.act("window_call_state", "window_call_state", () => b.core.windowCallState({}), { slice: "callWindow" }); // the call window (2.10) draws once it has its state
    const html = renderToString(<App bridge={b} />);
    expect(html).toContain('data-region="CS-R2"');
    expect(html).toContain("drawer redesign");
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
    // a host that read the call passes it (no second call_get), and draws the audio line in its own heading
    expect(renderToString(<StoredTranscript bridge={b} callId={PAST} detail={detail.data} />)).toMatch(/audio kept until/);
    expect(renderToString(<StoredTranscript bridge={b} callId={PAST} detail={detail.data} header={null} />)).not.toMatch(/audio kept until/);
    expect(tr.waiting).toBe(false);
  });

  it("writes the audio line for kept, deleted and never-stored audio", () => {
    const prefs = { time_format: "h24" as const, first_weekday: 1, time_zone: "UTC" };
    const call = { audio_deleted: false, audio_kept_until: Date.UTC(2026, 10, 15), started_at: Date.UTC(2026, 9, 16), duration_ms: 52 * 60_000 };
    const d = (c: object, notStored = false) => ({ call: { ...call, ...c }, audio_not_stored: notStored }) as unknown as CallDetail;
    // the date in the macOS locale: "15 Nov" or "Nov 15"; D-36: no deletion date in M1
    expect(audioLine(d({}), prefs)).toMatch(/^52 min · audio kept until (15 Nov|Nov 15)$/);
    expect(audioLine(d({}), undefined)).toBeNull();
    expect(audioLine(d({ audio_deleted: true }), prefs)).toBe("Audio deleted · transcript kept"); // no date known
    expect(audioLine(d({ audio_deleted: true, audio_deleted_at: Date.UTC(2026, 10, 15) }), prefs)).toMatch(/^Audio deleted on (15 Nov|Nov 15) · transcript kept$/);
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
