import type { CopilotSettings, Modifiers } from "../../core/bindings";

export interface CardKeyRow {
  id: "pin" | "dismiss" | "undo";
  /** `modifier-set`: **+ 1, 2 or 3**; `derived`: read-only, the set plus ⇧; `single`: an ordinary chord. */
  variant: "single" | "modifier-set" | "derived";
  /** Null for the undo row: its chord is the `undo_card_action` binding from `hotkeys_list`. */
  modifiers: (Modifiers & { shift?: boolean }) | null;
  disabled: boolean;
}

/** The Hotkeys pane's **Card keys during calls** rows, from `settings.copilot` (never a cached copy). */
export function cardKeyRows({ card_keys, dismiss_with_keys }: CopilotSettings): CardKeyRow[] {
  const off = !card_keys.enabled;
  return [
    { id: "pin", variant: "modifier-set", modifiers: card_keys.modifiers, disabled: off },
    { id: "dismiss", variant: "derived", modifiers: { ...card_keys.modifiers, shift: true }, disabled: off || !dismiss_with_keys },
    { id: "undo", variant: "single", modifiers: null, disabled: off },
  ];
}
