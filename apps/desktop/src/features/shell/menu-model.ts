import { t } from "../../i18n/format";
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
    title: t("menu.title.noter"),
    items: [item(t("menu.about_noter")), "separator", item(t("menu.settings"), "⌘,", { chords: ["Meta+Comma"], action: { type: "open-settings" } }), item(t("menu.run_setup_again")), "separator", item(t("menu.hide_noter")), item(t("menu.quit_noter"), "⌘Q")],
  },
  { title: t("menu.title.file"), items: [item(t("menu.new_question"), "⌘N"), item(t("menu.export"), "⌘E"), "separator", item(t("menu.delete"), "⌘⌫")] },
  {
    title: t("menu.title.edit"),
    items: [
      item(t("menu.undo"), "⌘Z"),
      item(t("menu.redo"), "⇧⌘Z"),
      "separator",
      item(t("menu.cut"), "⌘X"),
      item(t("menu.copy"), "⌘C"),
      item(t("menu.paste"), "⌘V"),
      "separator",
      item(t("menu.copy_for_slack"), "⌘⇧C"),
      item(t("menu.copy_for_jira"), "⌥⌘C"),
      item(t("menu.copy_as_markdown"), "⌥⇧⌘C"),
      "separator",
      item(t("menu.accept_item")),
      item(t("menu.accept_all_suggestions")),
      item(t("menu.reject_item")),
      "separator",
      item(t("menu.find"), "⌘F", { chords: ["Meta+KeyF"], action: { type: "focus-search" } }),
    ],
  },
  {
    title: t("menu.title.view"),
    items: [
      item(t("menu.hide_sidebar"), "⌃⌘S", { chords: ["Control+Meta+KeyS"], action: { type: "toggle-sidebar" } }),
      item(t("menu.show_inspector"), "⌥⌘I", { chords: ["Alt+Meta+KeyI"], action: { type: "toggle-inspector" } }),
      "separator",
      ...SECTIONS.map((s) => item(t(s.label), `⌘${s.digit}`, { chords: [`Meta+Digit${s.digit}`], action: { type: "section", section: s.key } })),
      "separator",
      item(t("menu.back"), "⌘[", { chords: ["Meta+BracketLeft"], action: { type: "back" } }),
      item(t("menu.forward"), "⌘]", { chords: ["Meta+BracketRight"], action: { type: "forward" } }),
      "separator",
      item(t("menu.actual_size"), "⌘0", { chords: ["Meta+Digit0"], action: { type: "zoom", to: "reset" } }),
      item(t("menu.zoom_in"), "⌘+", { chords: ["Meta+Equal", "Meta+Shift+Equal"], action: { type: "zoom", to: "in" } }),
      item(t("menu.zoom_out"), "⌘−", { chords: ["Meta+Minus"], action: { type: "zoom", to: "out" } }),
    ],
  },
  {
    title: t("menu.title.call"),
    items: [
      item(t("menu.start_recording"), "⌃⌥⌘R"),
      item(t("menu.pause"), "⌃⌥⌘P"),
      item(t("menu.mark_moment"), "⌃⌥⌘M"),
      item(t("menu.catch_me_up"), "⌃⌥⌘C"),
      item(t("menu.ask_about_this_call"), "⌃⌥⌘A"),
      item(t("menu.open_call_screen"), "⌃⌥⌘N"),
      item(t("menu.use_floating_panel")),
      item(t("menu.mute_copilot")),
      item(t("menu.hide_for_presenting"), "⌃⌥⌘0"),
    ],
  },
  { title: t("menu.title.window"), items: [item(t("menu.minimize"), "⌘M"), item(t("menu.close"), "⌘W")] },
  { title: t("menu.title.help"), items: [item(t("menu.noter_help"))] },
];

/** Every chord the window handles, with its action: the keyboard table is read off the menu so the two never differ. */
export function shellShortcuts(run: (a: ShellAction) => void): ShortcutTable {
  const table: ShortcutTable = {};
  for (const menu of APP_MENU)
    for (const e of menu.items)
      if (e !== "separator" && e.action) for (const c of e.chords ?? []) table[c] = () => run(e.action!);
  return table;
}
