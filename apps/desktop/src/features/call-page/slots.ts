// Seam for what another M1 feature delivers into the frame: the delete alert (dialogs-host). It registers itself when
// it lands; until then the menu item is disabled, so nothing deletes without the alert.
import type { Bridge } from "../../app/bridge/bridge";
import type { DeleteOutcome } from "../../ui/dialogs/delete-calls";

export const slots: {
  /** Opens the delete alert for the call (`cpt-noter-flow-ui-dialogs-host-delete-call`); the host deletes and navigates, the page shows a failure. */
  deleteCall: ((bridge: Bridge, callId: string) => Promise<DeleteOutcome>) | null;
} = { deleteCall: null };
