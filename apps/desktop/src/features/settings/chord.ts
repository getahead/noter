import type { HotkeyStatus } from "../../core/bindings";

export interface ChordModifiers {
  control: boolean;
  option: boolean;
  command: boolean;
  shift: boolean;
}

/**
 * A key event as the recorder gets it: `code` is the physical `KeyboardEvent.code`, already read
 * by the shortcut matcher, so this module never parses keys; it only judges the chord.
 */
export interface ChordInput {
  code: string;
  modifiers: ChordModifiers;
  /** `single`: one chord; `modifier-set`: card keys, where only the modifiers are recorded. */
  variant: "single" | "modifier-set";
  voiceOver: boolean;
}

export type KeepReason = "no_modifier" | "voiceover";

export type ChordResult =
  | { type: "accept"; code: string; modifiers: ChordModifiers }
  | { type: "keep"; reason: KeepReason; message: string }
  | { type: "cancel" }
  | { type: "clear" }
  /** A single chord got only a modifier keydown: keep recording until a non-modifier key arrives. */
  | { type: "wait" };

const MODIFIER_CODES = new Set(["Control", "Alt", "Meta", "Shift"].flatMap((m) => [`${m}Left`, `${m}Right`]));

// @cpt-algo:cpt-noter-algo-ui-settings-check-chord:p1
export function checkChord({ code, modifiers: m, variant, voiceOver }: ChordInput): ChordResult {
  if (code === "Escape") return { type: "cancel" };
  const hasModifier = m.control || m.option || m.command;
  // a modifier set is never empty: the core refuses it (`no_modifier`)
  if (code === "Backspace" && variant === "single") return { type: "clear" };
  if (!hasModifier || code === "Backspace") return { type: "keep", reason: "no_modifier", message: "Add Command, Option or Control" };
  if (variant === "single" && MODIFIER_CODES.has(code)) return { type: "wait" };
  if (voiceOver && m.control && m.option) return { type: "keep", reason: "voiceover", message: "Used by VoiceOver" };
  return { type: "accept", code, modifiers: m };
}

/** The line under a row the core reports a refusal for; null when the row has none. */
export function conflictLine(status: HotkeyStatus): string | null {
  if (status.type === "conflict") return `Used by ${status.owner ?? "another app"}`;
  return status.type === "reserved_by_system" ? "Used by macOS" : null;
}
