import type { Bridge } from "../../app/bridge/bridge";
import type { Settings } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";

/** What every pane gets: the bridge and the settings slice (a pane renders only once `settings_get` answered). */
export interface PaneProps {
  bridge: Bridge;
  settings: Settings;
}

/** Popup or radio choices of an enum setting, labelled from the catalogue. */
export const choices = <V extends string>(labels: Record<V, MsgKey>) => (Object.keys(labels) as V[]).map((value) => ({ value, label: t(labels[value]) }));
