import type { HotkeyAction, HotkeyBinding, HotkeyList } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { capsOf } from "./accelerator";
import { conflictLine } from "./chord";

/** The global hotkeys in the pane's order; the undo chord belongs to the card keys group. */
export const GLOBAL_ACTIONS: readonly HotkeyAction[] = ["start_stop", "pause", "mark_moment", "catch_me_up", "ask_about_call", "open_call_screen", "mute_copilot", "hide_for_presenting"];

export interface HotkeyRow {
  action: HotkeyAction;
  label: MsgKey;
  caps: string;
  /** What the core's test registration reports for the row. */
  conflict: string | null;
}

const row = (b: HotkeyBinding): HotkeyRow => ({ action: b.action, label: `settings.hotkey.${b.action}`, caps: capsOf(b.shortcut), conflict: conflictLine(b.status) });

/** One row per global hotkey, from `hotkeys_list` (never a cached copy). */
export function hotkeyRows(list: HotkeyList | undefined): HotkeyRow[] {
  return GLOBAL_ACTIONS.flatMap((a) => list?.bindings.filter((b) => b.action === a).map(row) ?? []);
}

/** The **Undo last card action** row. */
export const undoRow = (list: HotkeyList | undefined): HotkeyRow | null => {
  const b = list?.bindings.find((x) => x.action === "undo_card_action");
  return b ? row(b) : null;
};

/** Card keys another app took, as key caps for the line under **Pin a card**. */
export const cardKeyConflictCaps = (conflicts: readonly string[] | undefined): string[] => (conflicts ?? []).map(capsOf);
