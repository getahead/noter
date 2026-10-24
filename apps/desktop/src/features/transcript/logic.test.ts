import { afterEach, describe, expect, it, vi } from "vitest";

import type { CaptureState, PlaybackState } from "../../core/bindings";
import { atEnd, LogScroller, measure, newLines, onScroll, viewState, windowOf } from "./follow";
import { after, holdChannel, showSpan } from "./hosts";
import { buildRows } from "./model";
import { barState, scrubRange, type Replay } from "./playback";
import { capturing, playControl, REFUSED } from "./play-control";
import { seg } from "./testing";

type Cap = Pick<CaptureState, "phase" | "call_id" | "output_route" | "replay_available">;
const cap = (over: Partial<Cap> = {}): Cap => ({ phase: "recording", call_id: "call_1", output_route: "headphones", replay_available: true, ...over });
const line = seg("a", 10_000);

describe("playControl (cpt-noter-algo-ui-live-transcript-play-control)", () => {
  const base = { seg: line, hypothesis: false, audio: true, gaps: [], capture: cap() };
  it("hides it on the hypothesis and when the audio is gone", () => {
    expect(playControl({ ...base, hypothesis: true })).toEqual({ state: "hidden" });
    expect(playControl({ ...base, audio: false })).toEqual({ state: "hidden" });
  });
  it("disables it where system audio was lost", () => {
    const gaps = [{ call_id: "call_1", t0_ms: 9000, t1_ms: 20_000, reason: "system_audio_silent" as const }];
    expect(playControl({ ...base, gaps })).toEqual({ state: "disabled", help: "transcript.play.no_audio" });
    expect(playControl({ ...base, gaps, seg: seg("m", 10_000, { channel: "mic" }) }).state).toBe("enabled");
  });
  it("enables it on any output once the call is not being recorded", () => {
    expect(playControl({ ...base, capture: cap({ phase: "stopped", output_route: "speakers" }) })).toEqual({ state: "enabled", help: "transcript.play" });
    expect(playControl({ ...base, capture: cap({ call_id: "other", output_route: "speakers" }) }).state).toBe("enabled");
    expect(playControl({ ...base, capture: undefined }).state).toBe("enabled");
  });
  it("follows the output route during capture", () => {
    expect(playControl(base)).toEqual({ state: "enabled", help: "transcript.play" });
    expect(playControl({ ...base, capture: cap({ replay_available: false }) })).toEqual({ state: "disabled", help: "transcript.play.own_sounds" });
    expect(playControl({ ...base, capture: cap({ output_route: "speakers", replay_available: false }) })).toEqual({ state: "disabled", help: "transcript.play.speakers" });
    expect(playControl({ ...base, capture: cap({ output_route: "unknown", replay_available: false }) })).toEqual({ state: "disabled", help: "transcript.play.unknown" });
  });
  it("knows when a call is being recorded and maps refused plays to their reasons", () => {
    expect(capturing(cap({ phase: "paused" }), "call_1")).toBe(true);
    expect(capturing(cap({ phase: "idle" }), "call_1")).toBe(false);
    expect(capturing(undefined, "call_1")).toBe(false);
    expect(REFUSED.replay_needs_headphones).toBe("transcript.play.speakers");
  });
});

describe("follow output (cpt-noter-algo-ui-live-transcript-follow-output)", () => {
  const pos = (scrollTop: number) => ({ scrollTop, clientHeight: 500, scrollHeight: 2000 });
  it("is at the end within one row", () => {
    expect(atEnd(pos(1480), 32)).toBe(true);
    expect(atEnd(pos(1400), 32)).toBe(false);
  });
  it("follows at the end, detaches when scrolled up and counts the new lines", () => {
    const following = { following: true, base: 0 };
    expect(onScroll(following, pos(1500), 1500, 32, 10)).toBe(following);
    const detached = onScroll(following, pos(900), 1500, 32, 10);
    expect(detached).toEqual({ following: false, base: 10 });
    expect(newLines(detached, 13)).toBe(3);
    expect(newLines(following, 13)).toBe(0);
    expect(onScroll(detached, pos(1000), 900, 32, 13)).toBe(detached); // scrolling down, not at the end yet
    expect(onScroll(detached, pos(1490), 1000, 32, 13)).toEqual({ following: true, base: 13 });
    expect(onScroll(following, pos(1300), 1200, 32, 13)).toBe(following); // a smooth scroll on its way down
  });
  it("detaches on the first step of a scroll up, even within one row of the end, so the next flush keeps it", () => {
    const following = { following: true, base: 0 };
    const detached = onScroll(following, pos(1490), 1500, 32, 10); // an animated wheel's first frame
    expect(detached).toEqual({ following: false, base: 10 });
    expect(onScroll(detached, pos(1470), 1490, 32, 10)).toBe(detached); // still on its way up
    const shrunk = { scrollTop: 1400, clientHeight: 500, scrollHeight: 1900 }; // a correction shortened the log: clamped to the end
    expect(onScroll(following, shrunk, 1500, 32, 10)).toBe(following);
  });
  it("names the view's state", () => {
    const s = { error: false, loaded: true, waiting: false, follow: { following: true, base: 0 }, find: false };
    expect(viewState({ ...s, error: true })).toBe("ERROR");
    expect(viewState({ ...s, loaded: false })).toBe("LOADING");
    expect(viewState({ ...s, waiting: true })).toBe("WAITING_FOR_SPEECH");
    expect(viewState({ ...s, find: true })).toBe("FIND_ACTIVE");
    expect(viewState({ ...s, follow: { following: false, base: 0 } })).toBe("DETACHED");
    expect(viewState(s)).toBe("FOLLOWING");
  });
});

describe("virtualised window", () => {
  it("draws the rows in view plus the overscan, the rest as spacers", () => {
    const h = Array.from({ length: 3000 }, () => 30);
    expect(windowOf(h, 0, 300, 5)).toEqual({ start: 0, end: 15, before: 0, after: (3000 - 15) * 30 });
    expect(windowOf(h, 3000 * 30 - 300, 300, 5)).toEqual({ start: 2985, end: 3000, before: 2985 * 30, after: 0 });
    expect(windowOf([], 0, 300, 5)).toEqual({ start: 0, end: 0, before: 0, after: 0 });
  });
  it("measures the drawn rows and how much the rows above the view grew", () => {
    const heights = new Map([["b", 30]]);
    const nodes = [
      { offsetHeight: 50, offsetTop: 0 }, // a: above the view, estimated 30, grew by 20
      { offsetHeight: 30, offsetTop: 50 }, // b: unchanged
      { offsetHeight: 40, offsetTop: 400 }, // c: in view
      { offsetHeight: 0, offsetTop: 440 }, // not laid out
    ];
    expect(measure(nodes, ["a", "b", "c", "d"], 0, heights, 30, 200)).toEqual({ changed: true, shift: 20 });
    expect(heights.get("c")).toBe(40);
    expect(measure(nodes.slice(1, 2), ["a", "b"], 1, heights, 30, 200)).toEqual({ changed: false, shift: 0 });
    expect(measure([{ offsetHeight: 10, offsetTop: 0 }], [], 0, heights, 30, 0)).toEqual({ changed: false, shift: 0 });
  });
});

describe("playback bar state (cpt-noter-state-ui-live-transcript-playback)", () => {
  const replay: Replay = { key: "a", call_id: "call_1", from_ms: 60_000, to_ms: 64_000, speaker: "Anna K.", since: 4, paused: false };
  const pb = (over: Partial<PlaybackState>): PlaybackState => ({ version: 5, playing: true, call_id: "call_1", position_ms: 60_500, to_ms: 64_000, route: "headphones", stopped_reason: null, ...over });
  it("goes closed, loading, playing, paused, ended and stopped by the route", () => {
    expect(barState(null, pb({}))).toBe("CLOSED");
    expect(barState(replay, undefined)).toBe("LOADING");
    expect(barState(replay, pb({ version: 4 }))).toBe("LOADING"); // a report from before this replay
    expect(barState(replay, pb({}))).toBe("PLAYING");
    expect(barState({ ...replay, paused: true }, pb({ playing: false, stopped_reason: "user" }))).toBe("PAUSED");
    expect(barState(replay, pb({ playing: false, stopped_reason: "ended" }))).toBe("ENDED");
    expect(barState(replay, pb({ playing: false, stopped_reason: "output_switched_to_speakers" }))).toBe("STOPPED_BY_ROUTE");
    expect(barState(replay, pb({ call_id: "other" }))).toBe("LOADING");
  });
  it("scrubs over the span plus or minus 30 s", () => {
    expect(scrubRange(replay)).toEqual({ min: 30_000, max: 94_000 });
    expect(scrubRange({ from_ms: 10_000, to_ms: null })).toEqual({ min: 0, max: 40_000 });
  });
});

describe("LogScroller (the view's scroll bookkeeping)", () => {
  const area = (scrollTop: number) => ({ scrollTop, clientHeight: 300, scrollHeight: 3000, scrollTo: vi.fn() });
  const list = (n: number, h = 30) => ({ children: Array.from({ length: n }, (_, i) => ({ offsetHeight: h, offsetTop: i * h, focus: vi.fn() })) });
  const keys = Array.from({ length: 100 }, (_, i) => `k${i}`);

  it("keeps the end in view while following: a jump on the first draw and for corrections, smooth after", () => {
    const log = new LogScroller(30);
    const el = area(2700);
    expect(log.afterRender(el, list(0), keys, true, "smooth")).toBe(false);
    expect(el.scrollTo).toHaveBeenLastCalledWith({ top: 3000, behavior: "instant" });
    log.prevTop = 2700;
    log.afterRender(el, list(0), keys, true, "smooth");
    expect(el.scrollTo).toHaveBeenLastCalledWith({ top: 3000, behavior: "smooth" });
  });

  it("detached, scrolls by how much the rows above the view grew, so the rows in view stay put", () => {
    const log = new LogScroller(30);
    const el = area(600);
    const start = log.window(keys, 600, 300).start; // 12
    const rows = { children: [{ offsetHeight: 50, offsetTop: 0 }, ...list(20).children.slice(1)] };
    expect(start).toBe(12);
    expect(log.afterRender(el, rows, keys, false, "smooth")).toBe(true);
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 620, behavior: "instant" });
    const still = area(620); // where the correction left it
    expect(log.afterRender(still, rows, keys, false, "smooth")).toBe(false); // measured already
    expect(still.scrollTo).not.toHaveBeenCalled();
  });

  it("focuses a waiting row once it is drawn, and scrolls a row to a third of the view", () => {
    const log = new LogScroller(30);
    const rows = list(20);
    log.focusKey = "k3";
    log.afterRender(area(0), rows, keys, false, "smooth");
    expect(rows.children[3]!.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(log.focusKey).toBeNull();
    log.focusKey = "k99"; // not drawn yet: it waits
    log.afterRender(area(0), list(20), keys, false, "smooth");
    expect(log.focusKey).toBe("k99");
    const el = area(0);
    log.scrollToRow(el, keys, "k50", "instant");
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 1400, behavior: "instant" });
    log.scrollToRow(el, keys, "k1", "smooth");
    expect(el.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
    log.scrollToRow(el, keys, "nope", "smooth");
    expect(el.scrollTo).toHaveBeenCalledTimes(2);
  });

  it("turns scroll events into the follow state from the position before each", () => {
    const log = new LogScroller(30);
    const f = { following: true, base: 0 };
    expect(log.scrolled(f, { scrollTop: 2700, clientHeight: 300, scrollHeight: 3000 }, 5)).toBe(f);
    expect(log.scrolled(f, { scrollTop: 1000, clientHeight: 300, scrollHeight: 3000 }, 5)).toEqual({ following: false, base: 5 });
    expect(log.prevTop).toBe(1000);
  });
});

describe("host effects", () => {
  afterEach(() => vi.useRealTimers());
  it("holds one Channel through StrictMode's second run and ends it a tick after unmount", () => {
    vi.useFakeTimers();
    const bridge = { subscribe: vi.fn(async () => {}), unsubscribe: vi.fn(async () => {}) };
    const held = { current: null as string | null };
    const ending = { current: null as ReturnType<typeof setTimeout> | null };
    const cleanup = holdChannel(bridge, "transcript_subscribe", "c1", held, ending);
    cleanup(); // StrictMode: cleanup, then the effect again
    holdChannel(bridge, "transcript_subscribe", "c1", held, ending)();
    vi.runAllTimers();
    expect(bridge.subscribe).toHaveBeenCalledOnce();
    expect(bridge.unsubscribe).toHaveBeenCalledOnce();
    holdChannel(bridge, "levels_subscribe", "c1", held, ending);
    holdChannel(bridge, "levels_subscribe", null, held, ending); // speech arrived: no more meters
    expect(bridge.unsubscribe).toHaveBeenLastCalledWith("levels_subscribe");
  });

  it("runs a timer that its cleanup cancels", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    after(3000, fn);
    after(3000, fn)();
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("highlights a loaded span at once, and asks transcript_span for one that is not loaded", async () => {
    const rows = buildRows({ segments: [seg("a", 0)], hypotheses: [], gaps: [], marks: [] }, "stored");
    const transcriptSpan = vi.fn(async () => ({ status: "ok" as const, data: { segments: [seg("z", 90_000)] } }));
    const bridge = { core: { transcriptSpan } } as never;
    const set = vi.fn();
    showSpan(bridge, { call_id: "call_1", t0_ms: 0, t1_ms: 1000 }, rows, set);
    expect(set).toHaveBeenCalledWith(["a"]);
    showSpan(bridge, { call_id: "call_1", t0_ms: 90_000, t1_ms: 91_000 }, rows, set);
    await Promise.resolve();
    await Promise.resolve();
    expect(transcriptSpan).toHaveBeenCalledOnce();
    expect(set).toHaveBeenLastCalledWith(["z"]);
  });
});
