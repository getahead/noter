import type { ShortcutTable } from "../../app/a11y/keys";
import { SECTIONS } from "./sections";
import type { SectionKey } from "./history";

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

const item = (label: string, accel?: string, extra: Partial<MenuItem> = {}): MenuItem => ({ label, accel, ...extra });

// @cpt-dod:cpt-noter-dod-ui-main-window-shell-navigation:p1
/** The app menu (DESIGN › Shell — Main window › App menu); the core builds it natively from this model. */
export const APP_MENU: readonly Menu[] = [
  {
    title: "Noter",
    items: [item("About Noter"), "separator", item("Settings…", "⌘,", { chords: ["Meta+Comma"], action: { type: "open-settings" } }), item("Run Setup Again…"), "separator", item("Hide Noter"), item("Quit Noter", "⌘Q")],
  },
  { title: "File", items: [item("New Question", "⌘N"), item("Export…", "⌘E"), "separator", item("Delete…", "⌘⌫")] },
  {
    title: "Edit",
    items: [
      item("Undo", "⌘Z"),
      item("Redo", "⇧⌘Z"),
      "separator",
      item("Cut", "⌘X"),
      item("Copy", "⌘C"),
      item("Paste", "⌘V"),
      "separator",
      item("Copy for Slack", "⌘⇧C"),
      item("Copy for Jira", "⌥⌘C"),
      item("Copy as Markdown", "⌥⇧⌘C"),
      "separator",
      item("Accept Item"),
      item("Accept All Suggestions"),
      item("Reject Item"),
      "separator",
      item("Find", "⌘F", { chords: ["Meta+KeyF"], action: { type: "focus-search" } }),
    ],
  },
  {
    title: "View",
    items: [
      item("Hide Sidebar", "⌃⌘S", { chords: ["Control+Meta+KeyS"], action: { type: "toggle-sidebar" } }),
      item("Show Inspector", "⌥⌘I", { chords: ["Alt+Meta+KeyI"], action: { type: "toggle-inspector" } }),
      "separator",
      ...SECTIONS.map((s) => item(s.key === "library" ? "Calls" : s.key[0]!.toUpperCase() + s.key.slice(1), `⌘${s.digit}`, { chords: [`Meta+Digit${s.digit}`], action: { type: "section", section: s.key } })),
      "separator",
      item("Back", "⌘[", { chords: ["Meta+BracketLeft"], action: { type: "back" } }),
      item("Forward", "⌘]", { chords: ["Meta+BracketRight"], action: { type: "forward" } }),
      "separator",
      item("Actual Size", "⌘0", { chords: ["Meta+Digit0"], action: { type: "zoom", to: "reset" } }),
      item("Zoom In", "⌘+", { chords: ["Meta+Equal", "Meta+Shift+Equal"], action: { type: "zoom", to: "in" } }),
      item("Zoom Out", "⌘−", { chords: ["Meta+Minus"], action: { type: "zoom", to: "out" } }),
    ],
  },
  {
    title: "Call",
    items: [
      item("Start Recording", "⌃⌥⌘R"),
      item("Pause", "⌃⌥⌘P"),
      item("Mark Moment", "⌃⌥⌘M"),
      item("Catch Me Up", "⌃⌥⌘C"),
      item("Ask About This Call…", "⌃⌥⌘A"),
      item("Open Call Screen", "⌃⌥⌘N"),
      item("Use Floating Panel"),
      item("Mute Copilot"),
      item("Hide for Presenting", "⌃⌥⌘0"),
    ],
  },
  { title: "Window", items: [item("Minimize", "⌘M"), item("Close", "⌘W")] },
  { title: "Help", items: [item("Noter Help")] },
];

/** Every chord the window handles, with its action: the keyboard table is read off the menu so the two never differ. */
export function shellShortcuts(run: (a: ShellAction) => void): ShortcutTable {
  const table: ShortcutTable = {};
  for (const menu of APP_MENU)
    for (const e of menu.items)
      if (e !== "separator" && e.action) for (const c of e.chords ?? []) table[c] = () => run(e.action!);
  return table;
}
