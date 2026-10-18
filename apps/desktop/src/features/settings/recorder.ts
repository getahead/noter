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
  | { type: "disable" }
  | { type: "enable" };

export const IDLE_RECORDER: RecorderState = { type: "IDLE" };

// @cpt-state:cpt-noter-state-ui-settings-hotkey-recorder:p1
export function recorderReduce(s: RecorderState, e: RecorderEvent): RecorderState {
  const recording = s.type === "RECORDING";
  switch (e.type) {
    case "start":
      return s.type === "DISABLED" || recording ? s : { type: "RECORDING", from: s.type === "CLEARED" ? "CLEARED" : "IDLE" };
    case "chord": {
      if (!recording) return s;
      const r = e.result;
      if (r.type === "cancel") return { type: s.from };
      if (r.type === "clear") return { type: "CLEARED" };
      if (r.type === "keep") return { type: r.reason === "no_modifier" ? "INVALID" : "CONFLICT", message: r.message };
      return s; // accepted: wait for the core's answer; `wait`: the chord is not complete yet
    }
    case "registered":
      return recording ? { type: "IDLE" } : s;
    case "refused":
      return s.type === "RECORDING" || s.type === "IDLE" ? { type: "CONFLICT", message: e.message } : s;
    case "clear":
      return recording || s.type === "IDLE" ? { type: "CLEARED" } : s;
    case "disable":
      return s.type === "IDLE" ? { type: "DISABLED" } : s;
    case "enable":
      return s.type === "DISABLED" ? { type: "IDLE" } : s;
  }
}
