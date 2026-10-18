// Permission check row states (docs/features/ui/first-run.md § 4 › Permission row).
import type { PermissionKind, PermissionState } from "../../core/bindings";

export type PermissionRowState = "NOT_ASKED" | "MISSING" | "CHECKING" | "GRANTED" | "DENIED";
export type PermissionRowEvent =
  | { type: "prompt_answered"; granted: boolean } // the macOS prompt after Allow…
  | { type: "returned_from_settings" } // Noter is active again after Open System Settings…
  | { type: "read"; state: PermissionState }; // the core re-read the permission (setup:changed)

/** Row state for what the core reports; system audio starts in MISSING because macOS has no prompt for it. */
export function initialPermissionRow(kind: PermissionKind, state: PermissionState): PermissionRowState {
  if (state === "granted") return "GRANTED";
  if (state === "denied") return "DENIED";
  // shortcut: needs_relaunch is not in the spec, it shows as MISSING until Noter reopens
  return state === "needs_relaunch" || kind === "system_audio" ? "MISSING" : "NOT_ASKED";
}

// @cpt-state:cpt-noter-state-ui-first-run-permission-row:p1
export function permissionRowNext(state: PermissionRowState, event: PermissionRowEvent): PermissionRowState {
  switch (event.type) {
    case "prompt_answered":
      // @cpt-begin:cpt-noter-state-ui-first-run-permission-row:p1:inst-notasked-granted
      // @cpt-begin:cpt-noter-state-ui-first-run-permission-row:p1:inst-notasked-denied
      return state === "NOT_ASKED" ? (event.granted ? "GRANTED" : "DENIED") : state;
      // @cpt-end:cpt-noter-state-ui-first-run-permission-row:p1:inst-notasked-denied
      // @cpt-end:cpt-noter-state-ui-first-run-permission-row:p1:inst-notasked-granted
    case "returned_from_settings":
      // @cpt-begin:cpt-noter-state-ui-first-run-permission-row:p1:inst-missing-checking
      // @cpt-begin:cpt-noter-state-ui-first-run-permission-row:p1:inst-denied-checking
      return state === "MISSING" || state === "DENIED" ? "CHECKING" : state;
      // @cpt-end:cpt-noter-state-ui-first-run-permission-row:p1:inst-denied-checking
      // @cpt-end:cpt-noter-state-ui-first-run-permission-row:p1:inst-missing-checking
    case "read":
      // @cpt-begin:cpt-noter-state-ui-first-run-permission-row:p1:inst-checking-granted
      // @cpt-begin:cpt-noter-state-ui-first-run-permission-row:p1:inst-checking-missing
      return state === "CHECKING" ? (event.state === "granted" ? "GRANTED" : "MISSING") : state;
      // @cpt-end:cpt-noter-state-ui-first-run-permission-row:p1:inst-checking-missing
      // @cpt-end:cpt-noter-state-ui-first-run-permission-row:p1:inst-checking-granted
  }
}
