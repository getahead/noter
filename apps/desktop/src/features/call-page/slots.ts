// Seams for what other M1 features deliver into the frame: the stored transcript (live-transcript, with the
// playback bar) and the delete alert (dialogs-host). Each registers itself when it lands; until then the frame
// shows its own placeholder and the menu item is disabled, so nothing deletes without the alert.
import type { ComponentType } from "react";

import type { Bridge } from "../../app/bridge/bridge";

export interface StoredTranscriptProps {
  bridge: Bridge;
  callId: string;
  /** Audio was deleted or never stored: no play controls. */
  audioKept: boolean;
  /** The span a notification or a link asked to highlight. */
  span?: string;
}

export const slots: {
  transcript: ComponentType<StoredTranscriptProps> | null;
  /** Opens the delete alert for the call (`cpt-noter-flow-ui-dialogs-host-delete-call`); the host deletes and navigates. */
  deleteCall: ((bridge: Bridge, callId: string) => void) | null;
} = { transcript: null, deleteCall: null };
