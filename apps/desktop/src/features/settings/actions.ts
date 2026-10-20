import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { applySnapshot } from "../../app/store/window-store";
import { t } from "../../i18n/format";
import type { HotkeyAction, Settings } from "../../core/bindings";
import { refusalLine } from "./chord";
import { editDraft, newDraft, toUpdateArgs, type DeepPartial, type SectionKey } from "./draft";

/** The key under which a section's last save is tracked in the store's `commands`. */
export const sectionKey = (section: SectionKey) => `settings:${section}`;

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
  return bridge.act(sectionKey(section), "settings_update", () => bridge.core.settingsUpdate(args), { slice: "settings" });
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

/** The line a section's rows show when its last save was refused; null once a save succeeds. */
export const useRowError = (bridge: Bridge, section: SectionKey): string | null =>
  useWindow(bridge, (s) => (s.commands[sectionKey(section)]?.state === "ERROR" ? t("settings.error.row") : null));

/** **Check Now**: read the core's current state again; true when no update is waiting, false when the core could not be read. */
export async function checkForUpdate(bridge: Bridge): Promise<"current" | "waiting" | "failed"> {
  const res = await bridge.core.appSnapshot({});
  if (res.status !== "ok") return "failed";
  bridge.store.setState((s) => applySnapshot(s, res.data));
  return res.data.environment.update?.ready ? "waiting" : "current";
}
