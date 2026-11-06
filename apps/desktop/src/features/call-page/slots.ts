// Seam for what another M1 feature delivers into the frame: the delete alert (dialogs-host). It registers itself when
// it lands; until then the menu item is disabled, so nothing deletes without the alert.
import type { ComponentType, KeyboardEvent } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { ItemView } from "../../core/bindings";
import type { DeleteOutcome } from "../../ui/dialogs/delete-calls";

export interface ActionItemRowProps {
  bridge: Bridge;
  item: ItemView;
  variant?: "full" | "compact" | "done" | "read-only";
}

export const slots: {
  /** Opens the delete alert for the call (`cpt-noter-flow-ui-dialogs-host-delete-call`); the host deletes and navigates, the page shows a failure. */
  deleteCall: ((bridge: Bridge, callId: string) => Promise<DeleteOutcome>) | null;
  /** The review row of an action item (`cpt-noter-component-ui-action-item-row`, 2.17), rendered as `<Row />` because it holds hooks; until it registers the plain output row is drawn. The section passes every item of the kind, rejected ones too (the row draws nothing for them). */
  actionItemRow: ComponentType<ActionItemRowProps> | null;
  /** **Rejected (n)** under the section's list: the rejected items with **Restore** (2.17). */
  rejectedList: ComponentType<{ bridge: Bridge; items: ItemView[] }> | null;
  /** What follows a decision, question or risk row: its provenance time, review buttons and (i) (2.17). */
  itemTail: ComponentType<{ bridge: Bridge; item: ItemView }> | null;
  /** The review keys (A, E, R, ⇧A) on a decision, question or risk row (2.17). */
  itemKeys: ((bridge: Bridge, item: ItemView, e: KeyboardEvent) => void) | null;
  /** **Add Action Item** under the action items list (2.17); `callId` is the call the section belongs to. */
  addItem: ComponentType<{ bridge: Bridge; callId: string }> | null;
} = { deleteCall: null, actionItemRow: null, rejectedList: null, itemTail: null, itemKeys: null, addItem: null };
