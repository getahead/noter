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
  /** What the owner does: send the accepted chord or the clear, or (modifier set) hold the modifiers until they are released. */
  send: { type: "record"; code: string; modifiers: ChordModifiers } | { type: "hold"; modifiers: ChordModifiers } | { type: "clear" } | null;
}

/** What a keydown on a recording field does; null while the field is not recording or the key is a repeat. */
export function onRecordKey(recording: boolean, e: RecorderKey, variant: "single" | "modifier-set"): KeyOutcome | null {
  if (!recording || e.repeat) return null;
  const modifiers = { control: e.ctrlKey, option: e.altKey, command: e.metaKey, shift: e.shiftKey };
  // the core owns the VoiceOver state: it refuses the chord with `hotkey_reserved`, so it is not read here
  const result: ChordResult = checkChord({ code: e.code, modifiers, variant, voiceOver: false });
  const event: RecorderEvent = { type: "chord", result };
  // a modifier set is complete only when the user lets go of the keys: Control alone must not be saved on the way to ⌃⌥⌘
  if (result.type === "accept") return { event, send: variant === "modifier-set" ? { type: "hold", modifiers: result.modifiers } : { type: "record", code: result.code, modifiers: result.modifiers } };
  return { event, send: result.type === "clear" ? { type: "clear" } : null };
}

/** The modifiers held so far, with the ones this keydown adds. */
export const holdMore = (held: ChordModifiers | null, m: ChordModifiers): ChordModifiers => ({
  control: !!held?.control || m.control,
  option: !!held?.option || m.option,
  command: !!held?.command || m.command,
  shift: !!held?.shift || m.shift,
});

/** A keyup ends a modifier set once no modifier is still down: the combination held so far is what to save. */
export const releasedSet = (held: ChordModifiers | null, e: Pick<RecorderKey, "ctrlKey" | "altKey" | "metaKey" | "shiftKey">): ChordModifiers | null =>
  held && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey ? held : null;
