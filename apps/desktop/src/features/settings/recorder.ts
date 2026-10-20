import type { ChordResult } from "./chord";

export type RecorderState =
  /** `from` is what Esc returns to: a row with no chord reads **None** again. */
  | { type: "RECORDING"; from: "IDLE" | "CLEARED" }
  | { type: "IDLE" | "CLEARED" | "DISABLED" }
  | { type: "CONFLICT" | "INVALID"; message: string };

export type RecorderEvent =
  | { type: "start" }
  | { type: "chord"; result: ChordResult }
  /** The core registered the accepted chord (`hotkey_set` succeeded). */
  | { type: "registered" }
  /** The core refused it, or the pane's test registration reports the row's chord refused. */
  | { type: "refused"; message: string }
  /** The **Clear shortcut** button. */
  | { type: "clear" }
  /** Esc on a field that shows a hint of the user's own attempt: the hint goes, the old chord stays. */
  | { type: "dismiss" }
  | { type: "disable" }
  | { type: "enable" };

export const IDLE_RECORDER: RecorderState = { type: "IDLE" };

// @cpt-state:cpt-noter-state-ui-settings-hotkey-recorder:p1
export function recorderReduce(s: RecorderState, e: RecorderEvent): RecorderState {
  const recording = s.type === "RECORDING";
  switch (e.type) {
    case "start":
      // @cpt-begin:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-idle-recording
      // @cpt-begin:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-conflict-recording
      // @cpt-begin:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-invalid-recording
      return s.type === "DISABLED" || recording ? s : { type: "RECORDING", from: s.type === "CLEARED" ? "CLEARED" : "IDLE" };
      // @cpt-end:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-invalid-recording
      // @cpt-end:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-conflict-recording
      // @cpt-end:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-idle-recording
    case "chord": {
      if (!recording) return s;
      const r = e.result;
      // @cpt-begin:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-recording-idle
      if (r.type === "cancel") return { type: s.from };
      // @cpt-end:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-recording-idle
      // @cpt-begin:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-recording-cleared
      if (r.type === "clear") return { type: "CLEARED" };
      // @cpt-end:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-recording-cleared
      // @cpt-begin:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-recording-invalid
      // @cpt-begin:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-recording-conflict
      if (r.type === "keep") return { type: r.reason === "no_modifier" ? "INVALID" : "CONFLICT", message: r.message };
      // @cpt-end:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-recording-conflict
      // @cpt-end:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-recording-invalid
      return s; // accepted: wait for the core's answer; `wait`: the chord is not complete yet
    }
    case "registered":
      // @cpt-begin:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-recording-idle
      return recording ? { type: "IDLE" } : s;
      // @cpt-end:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-recording-idle
    case "refused":
      // @cpt-begin:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-idle-conflict
      // @cpt-begin:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-recording-conflict
      return s.type === "RECORDING" || s.type === "IDLE" ? { type: "CONFLICT", message: e.message } : s;
      // @cpt-end:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-recording-conflict
      // @cpt-end:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-idle-conflict
    case "clear":
      // @cpt-begin:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-recording-cleared
      return recording || s.type === "IDLE" ? { type: "CLEARED" } : s;
      // @cpt-end:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-recording-cleared
    case "dismiss":
      return s.type === "INVALID" || s.type === "CONFLICT" ? { type: "IDLE" } : s;
    case "disable":
      // @cpt-begin:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-idle-disabled
      return s.type === "IDLE" ? { type: "DISABLED" } : s;
      // @cpt-end:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-idle-disabled
    case "enable":
      // @cpt-begin:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-disabled-idle
      return s.type === "DISABLED" ? { type: "IDLE" } : s;
      // @cpt-end:cpt-noter-state-ui-settings-hotkey-recorder:p1:inst-disabled-idle
  }
}
