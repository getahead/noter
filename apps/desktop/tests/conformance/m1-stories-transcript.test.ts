// M1 transcript story against the real core (Backend Teamlead TL-7, HoD D-26): each test names
// the DESIGN.md story and asserts its core-visible steps — state, events and rows — not only a
// command result. The fixture's live call is recording; the real core serves it from the rows the
// harness seeded and streams the engine's hypotheses and meters (the harness's scripted engine).
// All five transcript commands are called here: transcript_subscribe, levels_subscribe,
// transcript_span, audio_play and audio_stop.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LevelsMsg, PlaybackState, SegmentView, TranscriptMsg, TranscriptSnapshot } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import { LIVE_CALL } from "../support/world-presets";

let s: Scenario;
beforeEach(() => {
  s = openScenario({ alsoRecord: exercised });
});
afterEach(async () => {
  await s.dispose();
});

/** Channel messages arrive with seq = previous + 1, the first at `from + 1`. */
function contiguous(messages: ReadonlyArray<{ seq: number }>, from = messages[0] ? messages[0].seq - 1 : 0): boolean {
  return messages.every((m, i) => m.seq === (i === 0 ? from : messages[i - 1].seq) + 1);
}

/** The live transcript as the call screen opens it: the snapshot and the messages after it. */
async function openTranscript(window: "call-screen" | "main" = "call-screen") {
  const got: TranscriptMsg[] = [];
  const snap = ok(await s.core(window).transcriptSubscribe({ call_id: LIVE_CALL }, (m) => got.push(m)));
  return { snap, got };
}

const annasLine = (snap: TranscriptSnapshot): SegmentView => {
  const line = snap.segments.find((g) => g.speaker.speaker_id === "spk_anna");
  expect(line).toBeDefined();
  return line!;
};

const capturePhase = async () => ok(await s.core("call-screen").appSnapshot({})).capture.phase;

describe("cpt-noter-seq-call-screen-replay-line", () => {
  it("happy path: scroll back to Anna K.'s line while the stream goes on, play it on headphones, back to live", async () => {
    const playback = await s.events("playback:state");
    const { snap, got } = await openTranscript();
    // rows: the call is live, the stored lines and speakers are in the snapshot
    expect(snap).toMatchObject({ call_id: LIVE_CALL, live: true });
    expect(snap.subscription_id).not.toBeNull();
    const line = annasLine(snap);
    expect(snap.speakers.find((p) => p.id === "spk_anna")?.sample).not.toBeNull(); // the replay sample
    // events: the stream continues strictly after last_seq
    await until(() => got.length >= 2, "the live stream moves");
    expect(contiguous(got, snap.last_seq)).toBe(true);

    // scroll back: reread the line (rows) without the stream stopping (events)
    const before = got.length;
    const span = ok(await s.core("call-screen").transcriptSpan({ span: { call_id: LIVE_CALL, t0_ms: line.t0_ms, t1_ms: line.t1_ms } }));
    expect(span.segments.map((g) => g.id)).toContain(line.id);
    expect(span.audio_available).toBe(true);
    await until(() => got.length > before, "the stream goes on while the user reads back");
    expect(contiguous(got, snap.last_seq)).toBe(true);

    // play it on headphones; state: Replaying while recording · headphones
    const playing = ok(await s.core("call-screen").audioPlay({ call_id: LIVE_CALL, from_ms: line.t0_ms, to_ms: line.t1_ms }));
    expect(playing).toMatchObject({ playing: true, call_id: LIVE_CALL, route: "headphones" });
    await until(() => playback.latest()?.playing === true, "playback:state playing");
    expect(ok(await s.core("call-screen").audioStop({})).playing).toBe(false);
    await until(() => playback.latest()?.playing === false, "playback:state stopped");
    expect(await capturePhase()).toBe("recording"); // the recording untouched
    const versions = playback.all.map((p: PlaybackState) => p.version);
    expect(versions.every((v: number, i: number) => i === 0 || v > versions[i - 1])).toBe(true);
    // the stream still goes on after the replay
    const after = got.length;
    await until(() => got.length > after, "back to live");
  });

  it("error path — Recording on speakers: replay is refused, the line stays readable and the stream goes on", async () => {
    await s.change((w) => (w.app.environment.output_route = "speakers"));
    const { snap, got } = await openTranscript();
    const line = annasLine(snap);
    const off = refused(await s.core("call-screen").audioPlay({ call_id: LIVE_CALL, from_ms: line.t0_ms, to_ms: line.t1_ms }));
    expect(off).toMatchObject({ code: "replay_needs_headphones", retryable: false });
    const span = ok(await s.core("call-screen").transcriptSpan({ span: { call_id: LIVE_CALL, t0_ms: line.t0_ms, t1_ms: line.t1_ms } }));
    expect(span.segments.length).toBeGreaterThan(0);
    await until(() => got.length >= 1, "the stream goes on");
    expect(await capturePhase()).toBe("recording");
  });

  it("error path — Output switches to speakers: playback stops at once and says why", async () => {
    const playback = await s.events("playback:state");
    const { snap } = await openTranscript();
    const line = annasLine(snap);
    ok(await s.core("call-screen").audioPlay({ call_id: LIVE_CALL, from_ms: line.t0_ms, to_ms: line.t1_ms }));
    await until(() => playback.latest()?.playing === true, "playback:state playing");
    await s.change((w) => (w.app.environment.output_route = "speakers")); // headphones unplugged
    await until(() => playback.latest()?.playing === false, "playback stopped");
    // the real core says why; the fake's playback ends on its own
    if (s.target !== "fake") expect((playback.latest() as PlaybackState).stopped_reason).toBe("output_switched_to_speakers");
    expect(refused(await s.core("call-screen").audioPlay({ call_id: LIVE_CALL, from_ms: line.t0_ms })).code).toBe("replay_needs_headphones");
    expect(await capturePhase()).toBe("recording");
  });

  it("error path — Output not identified: marking the device as headphones in Settings unlocks replay at once", async () => {
    await s.change((w) => {
      w.app.environment.output_route = "unknown";
      w.app.environment.output_device = { name: "Scarlett 2i2 USB", uid: "AppleUSBAudioEngine:Focusrite:Scarlett", marked_headphones: false };
    });
    const { snap } = await openTranscript();
    const line = annasLine(snap);
    expect(refused(await s.core("call-screen").audioPlay({ call_id: LIVE_CALL, from_ms: line.t0_ms })).code).toBe("output_route_unknown");
    const settings = s.core("settings");
    const current = ok(await settings.settingsGet({}));
    const audio = structuredClone(current.audio);
    audio.output.headphones_devices = [...audio.output.headphones_devices, "AppleUSBAudioEngine:Focusrite:Scarlett"];
    ok(await settings.settingsUpdate({ rev: current.rev, section: { section: "audio", value: audio } }));
    expect(ok(await s.core("call-screen").audioPlay({ call_id: LIVE_CALL, from_ms: line.t0_ms, to_ms: line.t1_ms })).playing).toBe(true);
    ok(await s.core("call-screen").audioStop({}));
  });

  it("error path — Noter's own sounds not excluded: replay is refused until the setting is on", async () => {
    await s.change((w) => (w.settings.audio.exclude_own_sounds = false));
    const { snap } = await openTranscript();
    const line = annasLine(snap);
    expect(refused(await s.core("call-screen").audioPlay({ call_id: LIVE_CALL, from_ms: line.t0_ms })).code).toBe("own_sounds_not_excluded");
  });

  it("other path — a window reloaded gets the same lines from its own snapshot and goes on from its own last_seq", async () => {
    const first = await openTranscript("call-screen");
    await until(() => first.got.length >= 1, "the first window's stream moves");
    ok(await s.core("call-screen").streamUnsubscribe({ subscription_id: first.snap.subscription_id! })); // the window reloads
    const second = await openTranscript("call-screen");
    const ids = (g: SegmentView[]) => g.map((x) => x.id);
    expect(ids(second.snap.segments)).toEqual(expect.arrayContaining(ids(first.snap.segments))); // nothing lost
    expect(new Set(ids(second.snap.segments)).size).toBe(second.snap.segments.length); // nothing doubled
    expect(second.snap.subscription_id).not.toBe(first.snap.subscription_id);
    await until(() => second.got.length >= 2, "the new subscription streams");
    expect(contiguous(second.got, second.snap.last_seq)).toBe(true);
  });

  it("the level meters: levels_subscribe delivers from seq 1 without a gap and stops after stream_unsubscribe", async () => {
    const got: LevelsMsg[] = [];
    const sub = ok(await s.core("call-screen").levelsSubscribe({ call_id: LIVE_CALL }, (m) => got.push(m)));
    await until(() => got.length >= 3, "three level messages");
    expect(contiguous(got, 0)).toBe(true);
    ok(await s.core("call-screen").streamUnsubscribe({ subscription_id: sub.subscription_id }));
    const n = got.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(got.length).toBe(n);
  });
});
