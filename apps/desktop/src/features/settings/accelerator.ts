import type { Modifiers } from "../../core/bindings";

const KEYS: Record<string, string> = {
  Space: "Space", Enter: "Enter", Tab: "Tab", Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'",
  Backquote: "`", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Delete: "Delete", Insert: "Insert",
};
const GLYPHS: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Super: "⌘", Left: "←", Right: "→", Up: "↑", Down: "↓", Enter: "↩", Tab: "⇥", Space: "Space" };
const MAC_ORDER = ["Ctrl", "Alt", "Shift", "Super"];

/** The accelerator's key name for a physical `KeyboardEvent.code`; null when it has none. */
function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  if (/^Numpad\d$/.test(code)) return `Num${code.slice(6)}`;
  return KEYS[code] ?? null;
}

// The core takes Tauri accelerator syntax ("Ctrl+Alt+Super+U"), read by physical code like every shortcut.
export function toAccelerator(code: string, m: Modifiers & { shift?: boolean }): string | null {
  const key = keyName(code);
  if (!key) return null;
  return [m.control && "Ctrl", m.option && "Alt", m.shift && "Shift", m.command && "Super", key].filter(Boolean).join("+");
}

/** An accelerator as the key caps a Mac shows: ⌃⌥⇧⌘ then the key. */
export function capsOf(accelerator: string | null): string {
  if (!accelerator) return "";
  const parts = accelerator.split("+");
  const key = parts.pop()!;
  const mods = MAC_ORDER.filter((x) => parts.includes(x)).map((x) => GLYPHS[x]);
  return [...mods, GLYPHS[key] ?? key].join("");
}

/** The caps of a modifier set (card keys), such as ⌃⌥⌘. */
export const modifierCaps = (m: Modifiers & { shift?: boolean }): string =>
  [m.control && "⌃", m.option && "⌥", m.shift && "⇧", m.command && "⌘"].filter(Boolean).join("");
