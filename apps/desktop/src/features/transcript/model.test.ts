import { describe, expect, it } from "vitest";

import type { GapView, SpeakerView } from "../../core/bindings";
import { buildRows, findMatches, gapText, langAttr, langName, langTag, markText, meterLevel, rowVariant, speakerColumn, speakerName, speakerVariant, spanKeys, splitMatch } from "./model";
import { ANNA, S3, seg, YOU } from "./testing";

const gap = (t0: number, t1: number, reason: GapView["reason"] = "paused"): GapView => ({ call_id: "call_1", t0_ms: t0, t1_ms: t1, reason });

describe("buildRows (transcript view rows)", () => {
  const tr = {
    segments: [seg("a", 1000), seg("b", 5000), seg("c", 9000)],
    hypotheses: [seg("h2", 12_000, { channel: "mic", state: "hypothesis" }), seg("h1", 11_000, { state: "hypothesis" })],
    gaps: [gap(6000, 8000)],
    marks: [
      { id: "mk", call_id: "call_1", at_ms: 500, note: null },
      { id: "late", call_id: "call_1", at_ms: 20_000, note: null },
    ],
  };

  it("puts gaps and marks at their time among the confirmed rows and the hypotheses last, by time", () => {
    expect(buildRows(tr, "live").map((r) => r.key)).toEqual(["mk", "a", "b", "gap:6000", "c", "late", "hyp:sys", "hyp:mic"]);
    expect(buildRows(tr, "stored").map((r) => r.kind)).toEqual(["mark", "segment", "segment", "gap", "segment", "mark", "hypothesis", "hypothesis"]);
  });

  it("keeps a hypothesis row's key per channel, so a new hypothesis replaces it in place", () => {
    expect(buildRows({ ...tr, hypotheses: [seg("h9", 13_000, { state: "hypothesis" })] }, "live").at(-1)!.key).toBe("hyp:sys");
  });

  it("the tail keeps the last lines only, without gap or mark rows", () => {
    expect(buildRows(tr, "tail").map((r) => r.key)).toEqual(["c", "hyp:sys", "hyp:mic"]);
    expect(buildRows(tr, "tail", 8)).toHaveLength(5);
  });
});

describe("gap and mark rows", () => {
  it("say what happened with start and end, or the seconds lost", () => {
    expect(gapText(gap(1_330_000, 1_360_000))).toBe("Paused 00:22:10–00:22:40");
    expect(gapText(gap(1_802_000, 1_840_000, "system_audio_silent"))).toBe("System audio silent 00:30:02–00:30:40");
    expect(gapText(gap(0, 2000, "engine_restart"))).toBe("Engine restarted · 2 s lost");
    expect(gapText(gap(0, 400, "device_changed"))).toBe("Microphone changed · 1 s lost");
    expect(gapText(gap(60_000, 120_000, "stalled"))).toBe("Transcription stalled 00:01:00–00:02:00");
    expect(gapText(gap(60_000, 120_000, "continued"))).toBe("Stopped 00:01:00–00:02:00");
    expect(gapText(gap(60_000, 120_000, "interrupted"))).toBe("Stopped 00:01:00–00:02:00");
    expect(markText({ id: "m", call_id: "c", at_ms: 1_260_000, note: null })).toBe("Marked 00:21:00");
  });
});

describe("speaker label (display)", () => {
  it("names You, a person, Speaker 2 and Guest (your side)", () => {
    expect(speakerName({ type: "you" })).toBe("You");
    expect(speakerName(ANNA.label)).toBe("Anna K.");
    expect(speakerName({ type: "person", person: { id: "p", display_name: "Me", short_name: "Me", initials: "M", is_you: true } })).toBe("You");
    expect(speakerName({ type: "unnamed", n: 2 })).toBe("Speaker 2");
    expect(speakerName({ type: "guest_your_side" })).toBe("Guest (your side)");
    expect([YOU.label, ANNA.label, S3.label, { type: "guest_your_side" as const }].map(speakerVariant)).toEqual(["you", "resolved", "unresolved", "guest"]);
  });

  it("shows both candidates on a crosstalk row and follows a rename from the speakers list", () => {
    expect(speakerColumn(seg("x", 0, { crosstalk_with: [ANNA, S3] }), [])).toEqual({ text: "Anna K. / Speaker 3", variant: "crosstalk" });
    const renamed = { id: "spk_3", call_id: "call_1", label: { type: "unnamed", n: 7 }, channel: "sys", segment_count: 1, talk_ms: null } as unknown as SpeakerView;
    expect(speakerColumn(seg("x", 0, { speaker: S3 }), [renamed])).toEqual({ text: "Speaker 7", variant: "unresolved" });
  });

  it("gives the row's variant: you, crosstalk, low confidence, tail or confirmed", () => {
    expect(rowVariant(seg("x", 0, { speaker: YOU }), "live", [])).toBe("you");
    expect(rowVariant(seg("x", 0, { crosstalk_with: [ANNA, S3] }), "live", [])).toBe("crosstalk");
    expect(rowVariant(seg("x", 0, { confidence: 0.5 }), "stored", [])).toBe("low-confidence");
    expect(rowVariant(seg("x", 0), "tail", [])).toBe("tail");
    expect(rowVariant(seg("x", 0, { confidence: null }), "live", [])).toBe("confirmed");
  });
});

describe("language tag", () => {
  it("carries the code as lang, und without one, and reads the language's name", () => {
    expect(langAttr("ru")).toBe("ru");
    expect(langAttr({ code: "FR" })).toBe("fr");
    expect(langAttr(null)).toBe("und");
    expect(langName("de")).toBe("German");
    expect(langName({ code: "zz-invalid-!" })).toBe("zz-invalid-!");
    expect(langTag("ru", 0.95)).toEqual({ text: "RU", label: "Russian", low: false });
    expect(langTag("ru", 0.6)).toEqual({ text: "RU?", label: "Russian, low confidence", low: true });
    expect(langTag("en")).toMatchObject({ text: "EN", low: false });
  });
});

describe("find, spans and meters", () => {
  const rows = buildRows({ segments: [seg("a", 0, { text: "We add a Replay buffer" }), seg("b", 5000, { text: "nothing" })], hypotheses: [], gaps: [gap(1, 2)], marks: [] }, "stored");
  it("finds lines case-insensitively and splits the first match", () => {
    expect(findMatches(rows, "replay BUFFER")).toEqual(["a"]);
    expect(findMatches(rows, "  ")).toEqual([]);
    expect(splitMatch("We add a Replay buffer", "replay")).toEqual(["We add a ", "Replay", " buffer"]);
    expect(splitMatch("nothing", "replay")).toBeNull();
    expect(splitMatch("text", "")).toBeNull();
  });
  it("picks the rows a span covers and maps dBFS to meter segments", () => {
    expect(spanKeys(rows, { t0_ms: 3000, t1_ms: 6000 })).toEqual(["a", "b"]);
    expect([meterLevel(null), meterLevel(-90), meterLevel(-30), meterLevel(0), meterLevel(6)]).toEqual([0, 0, 5, 10, 10]);
  });
});
