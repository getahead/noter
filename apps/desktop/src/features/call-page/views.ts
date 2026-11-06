// Seam for what a feature delivers into the call page's body: Summary (call-page-outputs) and History (history-undo)
// register their view here, so each touches only its own register.tsx. Transcript is the page's own (PC-R5).
import type { ReactNode } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { CallPageTab } from "../../core/bindings";

export type ViewProps = { bridge: Bridge; callId: string; callTitle: string };
export const views: Partial<Record<CallPageTab, (p: ViewProps) => ReactNode>> = {};

/** The views a delivered feature registered, Transcript first (`callViews` puts them in DESIGN's order). */
export const registeredViews = (): CallPageTab[] => ["transcript", ...(Object.keys(views) as CallPageTab[])];
