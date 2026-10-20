import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { applySnapshot } from "../../app/store/window-store";
import { t } from "../../i18n/format";
import type { HotkeyAction, Settings } from "../../core/bindings";
import { refusalLine } from "./chord";
import { editDraft, newDraft, toUpdateArgs, type DeepPartial, type SectionKey } from "./draft";

/** The dotted path of the setting an edit touches: down to the leaf, or the object that holds several (`card_keys.modifiers`). */
export function rowPath(edits: unknown): string {
  const path: string[] = [];
  let at = edits as Record<string, unknown> | null;
  while (at && typeof at === "object" && !Array.isArray(at) && Object.keys(at).length === 1) {
    const [key] = Object.keys(at);
    path.push(key!);
    at = at[key!] as Record<string, unknown> | null;
  }
  return path.length ? path.join(".") : Object.keys((edits ?? {}) as object).join(",");
}

/** The key under which the last save of one setting is tracked in the store's `commands`: a refusal belongs to the row that sent it. */
export const rowKey = (section: SectionKey, path: string) => `settings:${section}:${path}`;

// @cpt-flow:cpt-noter-flow-ui-settings-change-setting:p1
/** `settings_get` once per window; the panes render from the settings slice. */
export function loadSettings(bridge: Bridge) {
  // @cpt-begin:cpt-noter-flow-ui-settings-change-setting:p1:inst-api-get
  return bridge.act("settings:get", "settings_get", () => bridge.core.settingsGet({}), { slice: "settings" });
  // @cpt-end:cpt-noter-flow-ui-settings-change-setting:p1:inst-api-get
}

/**
 * A control changed: send the whole section as wanted state with the latest `rev`. The edit holds only
 * the touched leaves, so a newer sibling is never overwritten; a refusal leaves the stored value showing.
 */
export function saveSection<K extends SectionKey>(bridge: Bridge, section: K, edits: DeepPartial<Settings[K]>) {
  // @cpt-begin:cpt-noter-flow-ui-settings-change-setting:p1:inst-user-change
  // @cpt-begin:cpt-noter-flow-ui-settings-change-setting:p1:inst-match-control
  const settings = bridge.store.getState().whole.settings;
  if (!settings) return Promise.resolve(null);
  // @cpt-end:cpt-noter-flow-ui-settings-change-setting:p1:inst-match-control
  // @cpt-end:cpt-noter-flow-ui-settings-change-setting:p1:inst-user-change
  // @cpt-begin:cpt-noter-flow-ui-settings-change-setting:p1:inst-api-update
  const args = toUpdateArgs(settings, editDraft(newDraft(section), edits));
  return bridge.act(rowKey(section, rowPath(edits)), "settings_update", () => bridge.core.settingsUpdate(args), { slice: "settings" });
  // @cpt-end:cpt-noter-flow-ui-settings-change-setting:p1:inst-api-update
}

// @cpt-flow:cpt-noter-flow-ui-settings-set-hotkeys:p1
/** `hotkeys_list`: the core test-registers the whole set when the pane opens and reports each row's result. */
export function loadHotkeys(bridge: Bridge) {
  // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-api-list
  return bridge.act("hotkeys:list", "hotkeys_list", () => bridge.core.hotkeysList({}), { slice: "hotkeys" });
  // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-api-list
}

export type HotkeyAnswer = { ok: true } | { ok: false; message: string };

/** `hotkey_set`: the row shows the new chord, or the old one stays with the line the core's refusal gives. */
export async function setHotkey(bridge: Bridge, action: HotkeyAction, shortcut: string | null): Promise<HotkeyAnswer> {
  // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-api-set
  const res = await bridge.act(`hotkey:${action}`, "hotkey_set", () => bridge.core.hotkeySet({ action, shortcut }), { slice: "hotkeys" });
  // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-api-set
  if (res.status === "ok") return { ok: true };
  // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-conflict-line
  return { ok: false, message: refusalLine(res.error) ?? bridge.store.getState().commands[`hotkey:${action}`]?.error?.state ?? "" };
  // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-conflict-line
}

/** **Restore Defaults**: the core resets the set and checks it again. */
export function resetHotkeys(bridge: Bridge) {
  // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-if-restore
  // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-api-reset
  return bridge.act("hotkeys:reset", "hotkeys_reset", () => bridge.core.hotkeysReset({}), { slice: "hotkeys" });
  // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-api-reset
  // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-if-restore
}

/** The control key of **Remove** under **Apps Noter doesn't ask about**. */
export const unignoreKey = (bundleId: string) => `unignore:${bundleId}`;

/** The line a row shows when the last save of its own setting was refused; null once a later save of it succeeds. */
export function useRowErrors(bridge: Bridge): (section: SectionKey, path: string) => string | null {
  const commands = useWindow(bridge, (s) => s.commands);
  return (section, path) => (commands[rowKey(section, path)]?.state === "ERROR" ? t("settings.error.row") : null);
}

/** **Check Now**: read the core's current state again; true when no update is waiting, false when the core could not be read. */
export async function checkForUpdate(bridge: Bridge): Promise<"current" | "waiting" | "failed"> {
  const res = await bridge.core.appSnapshot({});
  if (res.status !== "ok") return "failed";
  bridge.store.setState((s) => applySnapshot(s, res.data));
  return res.data.environment.update?.ready ? "waiting" : "current";
}
