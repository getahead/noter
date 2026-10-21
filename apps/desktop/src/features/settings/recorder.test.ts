import { describe, expect, it } from "vitest";

import type { ChordResult } from "./chord";
import { IDLE_RECORDER, recorderReduce, type RecorderState } from "./recorder";

const accept: ChordResult = { type: "accept", code: "KeyU", modifiers: { control: true, option: true, command: true, shift: false } };
const run = (s: RecorderState, ...events: Parameters<typeof recorderReduce>[1][]) => events.reduce(recorderReduce, s);

describe("recorderReduce", () => {
  it("starts IDLE and records on start", () => {
    expect(IDLE_RECORDER).toEqual({ type: "IDLE" });
    expect(run(IDLE_RECORDER, { type: "start" })).toEqual({ type: "RECORDING", from: "IDLE" });
  });

  it("stays RECORDING while an accepted chord waits for the core, then goes IDLE once it registered", () => {
    const s = run(IDLE_RECORDER, { type: "start" }, { type: "chord", result: accept });
    expect(s.type).toBe("RECORDING");
    expect(recorderReduce(s, { type: "registered" })).toEqual({ type: "IDLE" });
  });

  it("keeps RECORDING while a modifier waits for its letter", () => {
    const rec = recorderReduce(IDLE_RECORDER, { type: "start" });
    expect(recorderReduce(rec, { type: "chord", result: { type: "wait" } })).toBe(rec);
  });

  it("goes IDLE on Esc", () => {
    expect(run(IDLE_RECORDER, { type: "start" }, { type: "chord", result: { type: "cancel" } })).toEqual({ type: "IDLE" });
  });

  it("returns Esc to CLEARED when the row had no chord", () => {
    const cleared = run(IDLE_RECORDER, { type: "start" }, { type: "chord", result: { type: "clear" } });
    expect(cleared).toEqual({ type: "CLEARED" });
    const again = recorderReduce(cleared, { type: "start" });
    expect(again).toEqual({ type: "RECORDING", from: "CLEARED" });
    expect(recorderReduce(again, { type: "chord", result: { type: "cancel" } })).toEqual({ type: "CLEARED" });
  });

  it("goes INVALID without a modifier and VoiceOver goes CONFLICT, both keeping the message; recording again resumes", () => {
    const rec = recorderReduce(IDLE_RECORDER, { type: "start" });
    const invalid = recorderReduce(rec, { type: "chord", result: { type: "keep", reason: "no_modifier", message: "Add Command, Option or Control" } });
    expect(invalid).toEqual({ type: "INVALID", message: "Add Command, Option or Control" });
    const conflict = recorderReduce(recorderReduce(invalid, { type: "start" }), { type: "chord", result: { type: "keep", reason: "voiceover", message: "Used by VoiceOver" } });
    expect(conflict).toEqual({ type: "CONFLICT", message: "Used by VoiceOver" });
    expect(recorderReduce(conflict, { type: "start" })).toEqual({ type: "RECORDING", from: "IDLE" });
  });

  it("goes CONFLICT when the core refuses the chord, and when the pane's test registration reports it", () => {
    const rec = recorderReduce(IDLE_RECORDER, { type: "start" });
    expect(recorderReduce(rec, { type: "refused", message: "Used by macOS" })).toEqual({ type: "CONFLICT", message: "Used by macOS" });
    expect(recorderReduce(IDLE_RECORDER, { type: "refused", message: "Used by another app" })).toEqual({ type: "CONFLICT", message: "Used by another app" });
  });

  it("clears from the Clear shortcut button while IDLE", () => {
    expect(run(IDLE_RECORDER, { type: "clear" })).toEqual({ type: "CLEARED" });
  });

  it("disables with its switch and returns IDLE when the switch is on", () => {
    const d = recorderReduce(IDLE_RECORDER, { type: "disable" });
    expect(d).toEqual({ type: "DISABLED" });
    expect(recorderReduce(d, { type: "start" })).toEqual(d);
    expect(recorderReduce(d, { type: "enable" })).toEqual({ type: "IDLE" });
  });

  it("ignores events no transition names", () => {
    expect(recorderReduce(IDLE_RECORDER, { type: "registered" })).toBe(IDLE_RECORDER);
    expect(recorderReduce(IDLE_RECORDER, { type: "chord", result: accept })).toBe(IDLE_RECORDER);
    expect(recorderReduce(IDLE_RECORDER, { type: "enable" })).toBe(IDLE_RECORDER);
    const rec = recorderReduce(IDLE_RECORDER, { type: "start" });
    expect(recorderReduce(rec, { type: "disable" })).toBe(rec);
  });
});

describe("dismiss", () => {
  it("clears the hint of an invalid or refused attempt and leaves other states alone", () => {
    expect(recorderReduce({ type: "INVALID", message: "x" }, { type: "dismiss" })).toEqual({ type: "IDLE" });
    expect(recorderReduce({ type: "CONFLICT", message: "x" }, { type: "dismiss" })).toEqual({ type: "IDLE" });
    expect(recorderReduce({ type: "CLEARED" }, { type: "dismiss" })).toEqual({ type: "CLEARED" });
    expect(recorderReduce({ type: "RECORDING", from: "IDLE" }, { type: "dismiss" })).toEqual({ type: "RECORDING", from: "IDLE" });
  });
});
