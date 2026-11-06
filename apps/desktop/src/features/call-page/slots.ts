// Seam for what another M1 feature delivers into the frame: the delete alert (dialogs-host). It registers itself when
// it lands; until then the menu item is disabled, so nothing deletes without the alert.
import type { ComponentType } from "react";

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
} = { deleteCall: null, actionItemRow: null, rejectedList: null };
