// Today's pure projection of `TodayView` (docs/features/ui/today.md): the calendar region's state, the review line,
// the proposal preview and what dims Record. The core ranks and counts; nothing here reorders or invents a number.
import type { EnvironmentState, ProposalRow, SetupStatus, TodayView } from "../../core/bindings";

export type CalendarState = "LOADING" | "NOT_ASKED" | "ASKING" | "DENIED" | "READY" | "NO_CALLS" | "ERROR";

// @cpt-state:cpt-noter-state-ui-today-calendar:p1
/** The calendar region from the `today_get` command's state and the view it last returned. */
export function calendarState(read: { state: string }, view: TodayView | undefined, asking = false): CalendarState {
  // @cpt-begin:cpt-noter-state-ui-today-calendar:p1:inst-ask
  // @cpt-begin:cpt-noter-state-ui-today-calendar:p1:inst-answer
  if (asking) return "ASKING";
  // @cpt-end:cpt-noter-state-ui-today-calendar:p1:inst-answer
  // @cpt-end:cpt-noter-state-ui-today-calendar:p1:inst-ask
  // @cpt-begin:cpt-noter-state-ui-today-calendar:p1:inst-read
  // a command-level error (`calendar_unavailable`) is the same retryable region as a read that failed inside the view
  if (read.state === "ERROR") return "ERROR";
  if (!view) return "LOADING";
  if (view.calendar === "not_asked") return "NOT_ASKED";
  if (view.calendar === "denied") return "DENIED";
  if (view.calendar === "read_failed") return "ERROR";
  return view.today.length > 0 || view.live_call ? "READY" : "NO_CALLS";
  // @cpt-end:cpt-noter-state-ui-today-calendar:p1:inst-read
}

/** TD-R8: the suggested items waiting for review, or no line when none wait. */
export const reviewLine = (v: TodayView): { count: number } | null => (v.review_waiting > 0 ? { count: v.review_waiting } : null);

/** TD-R6: up to three read-only proposals, with the core's total for the heading. */
export const proposalPreview = (v: TodayView): { rows: ProposalRow[]; total: number } => ({ rows: v.proposals.slice(0, 3), total: v.proposals_total });

/** Record's dimming reasons: the speech model is not ready, or under 500 MB is free (everything else degrades visibly). */
export function recordBlock(setup: Pick<SetupStatus, "models"> | undefined, env: Pick<EnvironmentState, "disk_free_mb"> | undefined): "model_missing" | "disk_full" | null {
  if (setup?.models.bundles.some((b) => b.required_for_capture && b.state !== "ready")) return "model_missing";
  if (env && env.disk_free_mb < 500) return "disk_full";
  return null;
}
