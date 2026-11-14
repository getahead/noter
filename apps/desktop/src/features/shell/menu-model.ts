import { t } from "../../i18n/format";
import type { MsgKey } from "../../i18n/en";
import type { ShortcutTable } from "../../app/a11y/keys";
import { SECTIONS } from "./sections";
import type { SectionKey } from "./history";
import model from "./menu-model.json";

/** What a shell shortcut does; the window turns each into history, layout or a command. */
export type ShellAction =
  | { type: "section"; section: SectionKey }
  | { type: "back" | "forward" | "toggle-sidebar" | "toggle-inspector" | "focus-search" | "open-settings" }
  | { type: "zoom"; to: "in" | "out" | "reset" };

export interface MenuItem {
  label: string;
  /** The accelerator as the menu shows it. */
  accel?: string;
  /** Physical-key chords (`event.code`) the window handles itself; ⌘Q, ⌘W and the like stay with the native menu. */
  chords?: string[];
  action?: ShellAction;
}

export type MenuEntry = MenuItem | "separator";
export interface Menu {
  title: string;
  items: MenuEntry[];
}

// @cpt-dod:cpt-noter-dod-ui-main-window-shell-navigation:p1
/** The app menu (DESIGN › Shell — Main window › App menu); the core builds it natively from this model. */
const actionFor = (key: string): Pick<MenuItem, "action" | "chords"> => {
  if (key === "menu.settings") return { action: { type: "open-settings" }, chords: ["Meta+Comma"] };
  if (key === "menu.find") return { action: { type: "focus-search" }, chords: ["Meta+KeyF"] };
  if (key === "menu.hide_sidebar") return { action: { type: "toggle-sidebar" }, chords: ["Control+Meta+KeyS"] };
  if (key === "menu.show_inspector") return { action: { type: "toggle-inspector" }, chords: ["Alt+Meta+KeyI"] };
  if (key === "menu.back") return { action: { type: "back" }, chords: ["Meta+BracketLeft"] };
  if (key === "menu.forward") return { action: { type: "forward" }, chords: ["Meta+BracketRight"] };
  if (key === "menu.actual_size") return { action: { type: "zoom", to: "reset" }, chords: ["Meta+Digit0"] };
  if (key === "menu.zoom_in") return { action: { type: "zoom", to: "in" }, chords: ["Meta+Equal", "Meta+Shift+Equal"] };
  if (key === "menu.zoom_out") return { action: { type: "zoom", to: "out" }, chords: ["Meta+Minus"] };
  const section = SECTIONS.find((candidate) => candidate.label === key);
  return section ? { action: { type: "section", section: section.key }, chords: [`Meta+Digit${section.digit}`] } : {};
};

export const shellActionForMenuItem = (key: string): ShellAction | undefined => actionFor(key).action;

/** Runs a page's existing keyboard handler for a native command, preserving its focused selection/context. */
export function nativeMenuShortcut(key: string): KeyboardEventInit | null {
  const item = model.flatMap((menu) => menu.items).find((entry) => entry?.key === key);
  if (!item?.shortcut) return null;
  const label = item.shortcut;
  const modifiers = { ctrlKey: label.includes("⌃"), altKey: label.includes("⌥"), shiftKey: label.includes("⇧"), metaKey: label.includes("⌘") };
  const keyName = label.replace(/[⌃⌥⇧⌘]/g, "");
  const code = keyName === "⌫" ? "Backspace" : keyName === "+" ? "Equal" : keyName === "−" ? "Minus" : keyName === "," ? "Comma" : /^[A-Z]$/.test(keyName) ? `Key${keyName}` : /^\d$/.test(keyName) ? `Digit${keyName}` : null;
  if (!code) return null;
  const keyValue = code === "Backspace" ? "Backspace" : code === "Comma" ? "," : code === "Equal" ? "+" : code === "Minus" ? "-" : code.startsWith("Key") ? code.slice(3).toLowerCase() : code.slice(5);
  return { ...modifiers, code, key: keyValue, bubbles: true, cancelable: true };
}

export function dispatchNativeMenuShortcut(key: string): boolean {
  const init = nativeMenuShortcut(key);
  if (!init || typeof document === "undefined") return false;
  const event = new KeyboardEvent("keydown", init);
  (document.activeElement ?? window).dispatchEvent(event);
  return event.defaultPrevented;
}

export const APP_MENU: readonly Menu[] = model.map(({ title, items }) => ({
  title: t(title as MsgKey),
  items: items.map((entry) => entry ? { label: t(entry.key as MsgKey), accel: entry.shortcut, ...actionFor(entry.key) } : "separator"),
}));

/** Every chord the window handles, with its action: the keyboard table is read off the menu so the two never differ. */
export function shellShortcuts(run: (a: ShellAction) => void): ShortcutTable {
  const table: ShortcutTable = {};
  for (const menu of APP_MENU)
    for (const e of menu.items)
      if (e !== "separator" && e.action) for (const c of e.chords ?? []) table[c] = () => run(e.action!);
  return table;
}
