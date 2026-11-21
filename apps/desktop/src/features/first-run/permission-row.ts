// Permission check row states (docs/features/ui/first-run.md § 4 › Permission row).
import type { PermissionKind, PermissionState } from "../../core/bindings";

export type PermissionRowState = "NOT_ASKED" | "MISSING" | "CHECKING" | "GRANTED" | "DENIED" | "NEEDS_RELAUNCH";
export type PermissionRowEvent = { type: "returned_from_settings" };

/** Row state for what the core reports; system audio starts unverified because its TCC state cannot be queried. */
export function initialPermissionRow(kind: PermissionKind, state: PermissionState): PermissionRowState {
  // @cpt-begin:cpt-noter-state-ui-first-run-permission-row:p1:inst-notasked-granted
  if (state === "granted") return "GRANTED";
  // @cpt-end:cpt-noter-state-ui-first-run-permission-row:p1:inst-notasked-granted
  // @cpt-begin:cpt-noter-state-ui-first-run-permission-row:p1:inst-notasked-denied
  if (state === "denied") return "DENIED";
  // @cpt-end:cpt-noter-state-ui-first-run-permission-row:p1:inst-notasked-denied
  if (state === "needs_relaunch") return "NEEDS_RELAUNCH";
  return kind === "system_audio" ? "MISSING" : "NOT_ASKED";
}

export function permissionRowNext(state: PermissionRowState, event: PermissionRowEvent): PermissionRowState {
  switch (event.type) {
    case "returned_from_settings":
      // @cpt-begin:cpt-noter-state-ui-first-run-permission-row:p1:inst-missing-checking
      // @cpt-begin:cpt-noter-state-ui-first-run-permission-row:p1:inst-denied-checking
      return state === "MISSING" || state === "DENIED" || state === "NEEDS_RELAUNCH" ? "CHECKING" : state;
      // @cpt-end:cpt-noter-state-ui-first-run-permission-row:p1:inst-denied-checking
      // @cpt-end:cpt-noter-state-ui-first-run-permission-row:p1:inst-missing-checking
  }
}
