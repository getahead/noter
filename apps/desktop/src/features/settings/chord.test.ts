import { describe, expect, it } from "vitest";

import { checkChord, conflictLine, type ChordInput } from "./chord";

const none = { control: false, option: false, command: false, shift: false };
const ev = (over: Partial<ChordInput> = {}): ChordInput => ({
  code: "KeyU",
  modifiers: { ...none, control: true, option: true, command: true },
  variant: "single",
  voiceOver: false,
  ...over,
});

describe("checkChord", () => {
  it("cancels on Esc, even without a modifier", () => {
    expect(checkChord(ev({ code: "Escape", modifiers: none }))).toEqual({ type: "cancel" });
  });

  it("clears on backspace for a single chord", () => {
    expect(checkChord(ev({ code: "Backspace", modifiers: none }))).toEqual({ type: "clear" });
  });

  it("keeps the old chord when no Command, Option or Control is held (shift alone is not enough)", () => {
    const r = checkChord(ev({ modifiers: { ...none, shift: true } }));
    expect(r).toEqual({ type: "keep", reason: "no_modifier", message: "Add Command, Option or Control" });
  });

  it.each(["control", "option", "command"] as const)("accepts a lone %s", (m) => {
    expect(checkChord(ev({ modifiers: { ...none, [m]: true } })).type).toBe("accept");
  });

  it("refuses ⌃⌥ chords while VoiceOver runs, and only then", () => {
    expect(checkChord(ev({ voiceOver: true }))).toEqual({ type: "keep", reason: "voiceover", message: "Used by VoiceOver" });
    expect(checkChord(ev({ voiceOver: true, modifiers: { ...none, control: true, option: true } })).type).toBe("keep");
    expect(checkChord(ev({ voiceOver: true, modifiers: { ...none, control: true } })).type).toBe("accept");
    expect(checkChord(ev({ voiceOver: false })).type).toBe("accept");
  });

  it("accepts with the physical code and the modifiers for the caller to send", () => {
    const m = { ...none, command: true, shift: true };
    expect(checkChord(ev({ code: "Digit3", modifiers: m }))).toEqual({ type: "accept", code: "Digit3", modifiers: m });
  });

  it("checks the modifier-set variant on modifiers alone", () => {
    const r = checkChord(ev({ variant: "modifier-set", code: "ControlLeft" }));
    expect(r.type).toBe("accept");
    expect(checkChord(ev({ variant: "modifier-set", modifiers: none })).type).toBe("keep");
  });

  it("never clears a modifier set: card keys need at least one modifier", () => {
    expect(checkChord(ev({ variant: "modifier-set", code: "Backspace", modifiers: none }))).toMatchObject({ type: "keep", reason: "no_modifier" });
  });
});

describe("conflictLine", () => {
  it("is null for statuses without a conflict", () => {
    for (const type of ["registered", "registered_during_capture", "not_set"] as const) expect(conflictLine({ type })).toBeNull();
  });

  it("names the owner the core reports", () => {
    expect(conflictLine({ type: "conflict", owner: "VoiceOver" })).toBe("Used by VoiceOver");
    expect(conflictLine({ type: "conflict", owner: null })).toBe("Used by another app");
  });

  it("explains a system reservation", () => {
    expect(conflictLine({ type: "reserved_by_system" })).toBe("Used by macOS");
  });
});
