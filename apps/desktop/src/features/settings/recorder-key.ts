import { checkChord, type ChordModifiers, type ChordResult } from "./chord";
import type { RecorderEvent } from "./recorder";

export interface RecorderKey {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

export interface KeyOutcome {
  event: RecorderEvent;
  /** What the owner sends to the core: the accepted chord, or the clear. */
  send: { type: "record"; code: string; modifiers: ChordModifiers } | { type: "clear" } | null;
}

/** What a keydown on a recording field does; null while the field is not recording or the key is a repeat. */
export function onRecordKey(recording: boolean, e: RecorderKey, variant: "single" | "modifier-set"): KeyOutcome | null {
  if (!recording || e.repeat) return null;
  const modifiers = { control: e.ctrlKey, option: e.altKey, command: e.metaKey, shift: e.shiftKey };
  // the core owns the VoiceOver state: it refuses the chord with `hotkey_reserved`, so it is not read here
  const result: ChordResult = checkChord({ code: e.code, modifiers, variant, voiceOver: false });
  const event: RecorderEvent = { type: "chord", result };
  if (result.type === "accept") return { event, send: { type: "record", code: result.code, modifiers: result.modifiers } };
  return { event, send: result.type === "clear" ? { type: "clear" } : null };
}
