// Shortcuts match the physical key (`event.code`), so single-key actions work on Russian and German layouts.
import { useEffect } from "react";

/** Chord string → action, e.g. "KeyA", "Meta+KeyF", "Control+Alt+Meta+KeyR" (modifier order: Control, Alt, Shift, Meta). */
export type ShortcutTable = Record<string, () => void>;

type Mods = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
> &
  Partial<Pick<KeyboardEvent, "isComposing" | "repeat">>;
export type ShortcutEvent = Mods & {
  target: EventTarget | null;
  preventDefault(): void;
  stopPropagation(): void;
};

export function chord(e: Mods): string {
  return [
    e.ctrlKey && "Control",
    e.altKey && "Alt",
    e.shiftKey && "Shift",
    e.metaKey && "Meta",
    e.code,
  ]
    .filter(Boolean)
    .join("+");
}

const TEXT_INPUTS = new Set([
  "",
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

export function isTyping(target: EventTarget | null): boolean {
  const el = target as Partial<HTMLInputElement> | null;
  if (!el) return false;
  if (
    el.isContentEditable ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  )
    return true;
  return el.tagName === "INPUT" && TEXT_INPUTS.has(el.type ?? "");
}

// @cpt-algo:cpt-noter-algo-ui-accessibility-l10n-physical-key:p1
export function matchShortcut(
  e: Mods & { target: EventTarget | null },
  tables: ShortcutTable[],
): (() => void) | null {
  // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-physical-key:p1:inst-read-code
  const key = chord(e);
  // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-physical-key:p1:inst-read-code
  // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-physical-key:p1:inst-if-typing
  // An IME composing a character, or a held key repeating, is typing too.
  if (
    e.isComposing ||
    e.repeat ||
    (isTyping(e.target) && !e.metaKey && !e.ctrlKey)
  ) {
    // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-physical-key:p1:inst-return-typing
    return null;
    // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-physical-key:p1:inst-return-typing
  }
  // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-physical-key:p1:inst-if-typing
  // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-physical-key:p1:inst-lookup
  const table = tables.find((t) => Object.hasOwn(t, key));
  // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-physical-key:p1:inst-lookup
  // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-physical-key:p1:inst-return-action
  return table ? table[key]! : null;
  // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-physical-key:p1:inst-return-action
}

// @cpt-flow:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1
// @cpt-dod:cpt-noter-dod-ui-accessibility-l10n-keyboard:p1
/** Runs the matched action and consumes the event; true when one ran. */
export function handleShortcut(
  e: ShortcutEvent,
  tables: ShortcutTable[],
): boolean {
  // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-user-key
  // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-if-shortcut
  // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-match-key
  const action = matchShortcut(e, tables);
  // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-match-key
  // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-if-shortcut
  // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-user-key
  if (!action) return false;
  e.preventDefault();
  e.stopPropagation();
  action();
  return true;
}

/** `onKeyDown` for a region element; its table wins over the window's (which stops at the region). */
export const useShortcuts = (table: ShortcutTable) => (e: ShortcutEvent) =>
  void handleShortcut(e, [table]);

export function useWindowShortcuts(table: ShortcutTable): void {
  useEffect(() => {
    const on = (e: KeyboardEvent) => void handleShortcut(e, [table]);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [table]);
}
