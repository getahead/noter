// What the row's neighbours deliver once they land: the Item inspector (2.17 S2) and the Handoff drawer (2.21).
// Until one registers, its button is not drawn, so nothing offers what does not exist yet.
import type { Bridge } from "../../app/bridge/bridge";

export const slots: {
  /** Opens the Item inspector on an item (the row's (i) button, ⌘I and **Edit** on a compact row). */
  inspect: ((bridge: Bridge, itemId: string) => void) | null;
  /** Opens the Handoff drawer for an engineering item (`cpt-noter-component-ui-handoff-drawer`). */
  openHandoff: ((bridge: Bridge, itemId: string) => void) | null;
} = { inspect: null, openHandoff: null };
