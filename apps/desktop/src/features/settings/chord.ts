import type { CoreError, HotkeyStatus } from "../../core/bindings";
import { t } from "../../i18n/format";

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

// Fn and CapsLock are never a chord's key: like a modifier keydown, they keep a single chord recording.
const MODIFIER_CODES = new Set([...["Control", "Alt", "Meta", "Shift"].flatMap((m) => [`${m}Left`, `${m}Right`]), "Fn", "CapsLock"]);

// @cpt-algo:cpt-noter-algo-ui-settings-check-chord:p1
export function checkChord({ code, modifiers: m, variant, voiceOver }: ChordInput): ChordResult {
  // @cpt-begin:cpt-noter-algo-ui-settings-check-chord:p1:inst-if-esc
  // @cpt-begin:cpt-noter-algo-ui-settings-check-chord:p1:inst-return-cancel
  if (code === "Escape") return { type: "cancel" };
  // @cpt-end:cpt-noter-algo-ui-settings-check-chord:p1:inst-return-cancel
  // @cpt-end:cpt-noter-algo-ui-settings-check-chord:p1:inst-if-esc
  const hasModifier = m.control || m.option || m.command;
  // a chord may start with any modifier, Shift included: only the completing key is judged
  if (variant === "single" && MODIFIER_CODES.has(code)) return { type: "wait" };
  // a modifier set is never empty: the core refuses it (`no_modifier`)
  // @cpt-begin:cpt-noter-algo-ui-settings-check-chord:p1:inst-if-delete
  // @cpt-begin:cpt-noter-algo-ui-settings-check-chord:p1:inst-return-clear
  if (code === "Backspace" && variant === "single") return { type: "clear" };
  // @cpt-end:cpt-noter-algo-ui-settings-check-chord:p1:inst-return-clear
  // @cpt-end:cpt-noter-algo-ui-settings-check-chord:p1:inst-if-delete
  // @cpt-begin:cpt-noter-algo-ui-settings-check-chord:p1:inst-if-nomod
  // @cpt-begin:cpt-noter-algo-ui-settings-check-chord:p1:inst-return-nomod
  if (!hasModifier || code === "Backspace") return { type: "keep", reason: "no_modifier", message: t("settings.hotkeys.no_modifier") };
  // @cpt-end:cpt-noter-algo-ui-settings-check-chord:p1:inst-return-nomod
  // @cpt-end:cpt-noter-algo-ui-settings-check-chord:p1:inst-if-nomod
  // @cpt-begin:cpt-noter-algo-ui-settings-check-chord:p1:inst-if-vo
  // @cpt-begin:cpt-noter-algo-ui-settings-check-chord:p1:inst-return-vo
  if (voiceOver && m.control && m.option) return { type: "keep", reason: "voiceover", message: t("settings.hotkeys.used_by", { owner: "VoiceOver" }) };
  // @cpt-end:cpt-noter-algo-ui-settings-check-chord:p1:inst-return-vo
  // @cpt-end:cpt-noter-algo-ui-settings-check-chord:p1:inst-if-vo
  // @cpt-begin:cpt-noter-algo-ui-settings-check-chord:p1:inst-physical
  // @cpt-begin:cpt-noter-algo-ui-settings-check-chord:p1:inst-return-accept
  return { type: "accept", code, modifiers: m }; // `code` is the physical KeyboardEvent.code, not the layout's character
  // @cpt-end:cpt-noter-algo-ui-settings-check-chord:p1:inst-return-accept
  // @cpt-end:cpt-noter-algo-ui-settings-check-chord:p1:inst-physical
}

/** The line under a row the core reports a refusal for; null when the row has none. */
export function conflictLine(status: HotkeyStatus): string | null {
  if (status.type === "conflict") return t("settings.hotkeys.used_by", { owner: status.owner ?? "another app" });
  return status.type === "reserved_by_system" ? t("settings.hotkeys.used_by_macos") : null;
}

/** The line a `hotkey_set` refusal (`hotkey_conflict`, `hotkey_reserved`) shows under the row; null for any other error. */
export function refusalLine(error: CoreError): string | null {
  if (error.code !== "hotkey_conflict" && error.code !== "hotkey_reserved") return null;
  const owner = error.detail?.type === "hotkey_owner" ? error.detail.owner : null;
  if (owner) return t("settings.hotkeys.used_by", { owner });
  return error.code === "hotkey_reserved" ? t("settings.hotkeys.used_by_macos") : t("settings.hotkeys.used_by", { owner: "another app" });
}
