import type { Bridge } from "../../app/bridge/bridge";
import type { CoreError } from "../../core/bindings";
import { askAlert, deleteAlert, type Ask } from "./alerts";
import { nativeAsk } from "../../core/tauri-transport";

export type DeleteOutcome =
  | { outcome: "cancelled" | "deleted" }
  | { outcome: "failed"; error: CoreError };

// @cpt-flow:cpt-noter-flow-ui-dialogs-host-delete-call:p1
/** Asks first, then deletes through `calls_delete`; the caller shows the error and goes to Library › Calls. Never retries (D-31: a live call answers `already_recording`). */
export async function deleteCalls(
  bridge: Bridge,
  calls: { id: string; title: string }[],
  ask: Ask = nativeAsk,
): Promise<DeleteOutcome> {
  if (!calls.length) return { outcome: "cancelled" };
  // @cpt-begin:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-build-alert
  const alert = deleteAlert(calls);
  // @cpt-end:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-build-alert
  // @cpt-begin:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-if-cancel
  if (!(await askAlert(alert, ask))) {
    // @cpt-begin:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-return-cancel
    return { outcome: "cancelled" };
    // @cpt-end:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-return-cancel
  }
  // @cpt-end:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-if-cancel
  // @cpt-begin:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-api-delete
  const res = await bridge.act(
    "calls_delete",
    "calls_delete",
    () => bridge.core.callsDelete({ call_ids: calls.map((c) => c.id) }),
    { screen: "dialogs-host" },
  );
  // @cpt-end:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-api-delete
  // @cpt-begin:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-if-delete-error
  if (res.status === "ok") return { outcome: "deleted" };
  // @cpt-begin:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-return-delete-error
  return { outcome: "failed", error: res.error };
  // @cpt-end:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-return-delete-error
  // @cpt-end:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-if-delete-error
}
