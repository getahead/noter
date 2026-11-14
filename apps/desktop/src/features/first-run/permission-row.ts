// Permission check row states (docs/features/ui/first-run.md § 4 › Permission row).
import type { PermissionKind, PermissionState } from "../../core/bindings";

export type PermissionRowState = "NOT_ASKED" | "MISSING" | "CHECKING" | "GRANTED" | "DENIED";
export type PermissionRowEvent =
  | { type: "returned_from_settings" } // Noter is active again after Open System Settings…
  | { type: "self_test_zero_buffers" }; // the self-test heard only digital silence: macOS has not granted System Audio Recording

/** Row state for what the core reports; system audio starts in MISSING because macOS has no prompt for it. */
export function initialPermissionRow(kind: PermissionKind, state: PermissionState): PermissionRowState {
  // @cpt-begin:cpt-noter-state-ui-first-run-permission-row:p1:inst-notasked-granted
  if (state === "granted") return "GRANTED";
  // @cpt-end:cpt-noter-state-ui-first-run-permission-row:p1:inst-notasked-granted
  // @cpt-begin:cpt-noter-state-ui-first-run-permission-row:p1:inst-notasked-denied
  if (state === "denied") return "DENIED";
  // @cpt-end:cpt-noter-state-ui-first-run-permission-row:p1:inst-notasked-denied
  // shortcut: needs_relaunch is not in the spec, it shows as MISSING until Noter reopens
  return state === "needs_relaunch" || kind === "system_audio" ? "MISSING" : "NOT_ASKED";
}

export function permissionRowNext(state: PermissionRowState, event: PermissionRowEvent): PermissionRowState {
  switch (event.type) {
    case "returned_from_settings":
      // @cpt-begin:cpt-noter-state-ui-first-run-permission-row:p1:inst-missing-checking
      // @cpt-begin:cpt-noter-state-ui-first-run-permission-row:p1:inst-denied-checking
      return state === "MISSING" || state === "DENIED" ? "CHECKING" : state;
      // @cpt-end:cpt-noter-state-ui-first-run-permission-row:p1:inst-denied-checking
      // @cpt-end:cpt-noter-state-ui-first-run-permission-row:p1:inst-missing-checking
    case "self_test_zero_buffers":
      return "MISSING";
  }
}
