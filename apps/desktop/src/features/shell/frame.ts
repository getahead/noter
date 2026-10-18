import type { CapturePhase } from "../../core/bindings";

export type FrameState = "LOADING" | "READY" | "CAPTURING" | "HIDDEN_FOR_PRESENTING";

export interface FrameInput {
  /** The app snapshot is applied to the store. */
  snapshotApplied: boolean;
  phase: CapturePhase;
  /** `app:presenting` reports hidden. */
  hidden: boolean;
}

// Derived from what the store holds, so a show action returns to READY or CAPTURING by itself
// and the window "comes back exactly as it was".
// @cpt-state:cpt-noter-state-ui-main-window-shell-frame:p1
export function frameState({ snapshotApplied, phase, hidden }: FrameInput): FrameState {
  if (!snapshotApplied) return "LOADING";
  if (hidden) return "HIDDEN_FOR_PRESENTING";
  return phase === "recording" || phase === "paused" ? "CAPTURING" : "READY";
}
