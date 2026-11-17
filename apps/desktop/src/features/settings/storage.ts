import type { Bridge } from "../../app/bridge/bridge";
import type { JobRunStatus } from "../../core/bindings";

export type MoveOutcome = { kind: "accepted"; runId: string } | { kind: "cloud" } | { kind: "cancelled" } | { kind: "failed" };

// @cpt-begin:cpt-noter-flow-ui-privacy-sources-storage:p1:inst-move
/** No path: the core owns the open panel, the location checks and the move (draft command, M4 on the real core). */
export async function moveStorage(bridge: Bridge): Promise<MoveOutcome> {
  const res = await bridge.act("storage:move", "storage_move", () => bridge.core.storageMove({ path: null }));
  if (res.status === "ok") return { kind: "accepted", runId: res.data.job_run_id };
  // @cpt-begin:cpt-noter-flow-ui-privacy-sources-storage:p1:inst-warning
  if (res.error.code === "storage_in_cloud_folder") return { kind: "cloud" };
  // @cpt-end:cpt-noter-flow-ui-privacy-sources-storage:p1:inst-warning
  return res.error.code === "cancelled" ? { kind: "cancelled" } : { kind: "failed" };
}
// @cpt-end:cpt-noter-flow-ui-privacy-sources-storage:p1:inst-move

// @cpt-begin:cpt-noter-flow-ui-privacy-sources-storage:p1:inst-job
/** Settings are read again once the matching job finished; accepting the job never replaces the path. */
export const moveFinished = (status: JobRunStatus | undefined): boolean => status === "succeeded" || status === "failed" || status === "cancelled";
// @cpt-end:cpt-noter-flow-ui-privacy-sources-storage:p1:inst-job
