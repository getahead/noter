// Today's pure projection of `TodayView` (docs/features/ui/today.md): the calendar region's state, the review line,
// the proposal preview and what dims Record. The core ranks and counts; nothing here reorders or invents a number.
import type { CallRow, EnvironmentState, ItemView, ProposalRow, SetupStatus, TodayView, UpcomingCall } from "../../core/bindings";

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

export type CardVariant = "today" | "this-week" | "live" | "unmatched";
export interface Card {
  variant: CardVariant;
  /** The calendar event, absent on the unmatched live card. */
  event: UpcomingCall | null;
  live: CallRow | null;
}

// @cpt-algo:cpt-noter-algo-ui-today-project:p1
/** The cards of `today`: the core's order, with the card of the recorded call first; a live call no event matches is its own card. */
export function cards(view: TodayView): Card[] {
  const live = view.live_call;
  // @cpt-begin:cpt-noter-algo-ui-today-project:p1:inst-order
  const day: Card[] = view.today.map((event) => ({ variant: live && event.call_id === live.id ? "live" : "today", event, live: live && event.call_id === live.id ? live : null }));
  const at = day.findIndex((c) => c.variant === "live");
  if (at > 0) day.unshift(...day.splice(at, 1));
  if (live && at < 0) day.unshift({ variant: "unmatched", event: null, live });
  return day;
  // @cpt-end:cpt-noter-algo-ui-today-project:p1:inst-order
}

/** This week's cards, in the core's order; they start collapsed. */
export const weekCards = (view: TodayView): Card[] => view.this_week.map((event) => ({ variant: "this-week", event, live: null }));

/** At most five combined action and question rows until **Show N More**; the core's order within each kind. */
export function cardRows(card: UpcomingCall, all: boolean): { rows: ItemView[]; more: number } {
  const every = [...card.items, ...card.questions];
  // @cpt-begin:cpt-noter-algo-ui-today-project:p1:inst-disclosures
  return all ? { rows: every, more: 0 } : { rows: every.slice(0, 5), more: Math.max(0, every.length - 5) };
  // @cpt-end:cpt-noter-algo-ui-today-project:p1:inst-disclosures
}

// @cpt-state:cpt-noter-state-ui-today-card:p1
/** Expanded or collapsed: the next call starts expanded, later and week cards collapsed, and the user's own choice (by event id) wins. */
export function isExpanded(eventId: string, user: ReadonlyMap<string, boolean>, isNext: boolean): boolean {
  // @cpt-begin:cpt-noter-state-ui-today-card:p1:inst-expand
  // @cpt-begin:cpt-noter-state-ui-today-card:p1:inst-collapse
  return user.get(eventId) ?? isNext;
  // @cpt-end:cpt-noter-state-ui-today-card:p1:inst-collapse
  // @cpt-end:cpt-noter-state-ui-today-card:p1:inst-expand
}

