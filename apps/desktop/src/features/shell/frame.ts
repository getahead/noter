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
  // @cpt-begin:cpt-noter-state-ui-main-window-shell-frame:p1:inst-loading-ready
  if (!snapshotApplied) return "LOADING";
  // @cpt-end:cpt-noter-state-ui-main-window-shell-frame:p1:inst-loading-ready
  // @cpt-begin:cpt-noter-state-ui-main-window-shell-frame:p1:inst-ready-hidden
  // @cpt-begin:cpt-noter-state-ui-main-window-shell-frame:p1:inst-capturing-hidden
  if (hidden) return "HIDDEN_FOR_PRESENTING";
  // @cpt-end:cpt-noter-state-ui-main-window-shell-frame:p1:inst-capturing-hidden
  // @cpt-end:cpt-noter-state-ui-main-window-shell-frame:p1:inst-ready-hidden
  // @cpt-begin:cpt-noter-state-ui-main-window-shell-frame:p1:inst-ready-capturing
  // @cpt-begin:cpt-noter-state-ui-main-window-shell-frame:p1:inst-capturing-ready
  // @cpt-begin:cpt-noter-state-ui-main-window-shell-frame:p1:inst-hidden-ready
  // @cpt-begin:cpt-noter-state-ui-main-window-shell-frame:p1:inst-hidden-capturing
  return phase === "recording" || phase === "paused" ? "CAPTURING" : "READY";
  // @cpt-end:cpt-noter-state-ui-main-window-shell-frame:p1:inst-hidden-capturing
  // @cpt-end:cpt-noter-state-ui-main-window-shell-frame:p1:inst-hidden-ready
  // @cpt-end:cpt-noter-state-ui-main-window-shell-frame:p1:inst-capturing-ready
  // @cpt-end:cpt-noter-state-ui-main-window-shell-frame:p1:inst-ready-capturing
}
