// The pure part of the History timeline: the read key, the day groups, the read state and the undo target of a row.
import type { ActorFilter, ChangeRow, HistoryTarget, UiPrefs, UndoTarget } from "../../core/bindings";
import { dayOf, shortDay, t } from "../../i18n/format";
import { runtimeLabel } from "../call-page/outputs-logic";

export type HistoryState = "LOADING" | "READY" | "EMPTY" | "FILTERED_EMPTY" | "ERROR";

const targetKey = (t: HistoryTarget) => (t.type === "all" ? "all" : `${t.type}:${Object.values(t)[1]}`);

/** The bridge command key of a read: one per target, actor and job, so a superseded read is told apart. */
export const historyKey = (target: HistoryTarget, actor: ActorFilter, jobId: string | null) => `history:${targetKey(target)}:${actor}:${jobId ?? ""}`;

// @cpt-flow:cpt-noter-flow-ui-history-undo-read:p1
/** Read pages for one filter and stop as soon as another read supersedes this one. */
export async function readHistoryPages<T extends { status: "ok"; data: { rows: ChangeRow[]; next_cursor: string | null } } | { status: "error" }>(
  read: (cursor?: string) => Promise<T>,
  current: () => boolean,
): Promise<{ rows: ChangeRow[]; failed: boolean } | null> {
  const rows: ChangeRow[] = [];
  let cursor: string | undefined;
  // @cpt-begin:cpt-noter-flow-ui-history-undo-read:p1:inst-read
  do {
    const page = await read(cursor);
    // @cpt-begin:cpt-noter-flow-ui-history-undo-read:p1:inst-filter
    if (!current()) return null;
    // @cpt-end:cpt-noter-flow-ui-history-undo-read:p1:inst-filter
    if (page.status !== "ok") return { rows: [], failed: true };
    rows.push(...page.data.rows);
    cursor = page.data.next_cursor ?? undefined;
  } while (cursor);
  // @cpt-end:cpt-noter-flow-ui-history-undo-read:p1:inst-read
  return { rows, failed: false };
}

// @cpt-begin:cpt-noter-flow-ui-history-undo-read:p1:inst-render
/** Newest first, grouped as Today, Yesterday, then dates. */
export function groupByDay(rows: ChangeRow[], now: number, prefs: UiPrefs): { day: string; rows: ChangeRow[] }[] {
  const groups: { key: string; day: string; rows: ChangeRow[] }[] = [];
  const yesterday = dayOf(now - 86_400_000, prefs);
  for (const r of [...rows].sort((a, b) => b.at - a.at)) {
    const key = dayOf(r.at, prefs);
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, day: key === dayOf(now, prefs) ? t("history.today") : key === yesterday ? t("history.yesterday") : shortDay(r.at, prefs), rows: [] }));
    g.rows.push(r);
  }
  return groups.map(({ day, rows }) => ({ day, rows }));
}
// @cpt-end:cpt-noter-flow-ui-history-undo-read:p1:inst-render

// @cpt-state:cpt-noter-state-ui-history-undo-read:p1
export function historyState(read: { loading: boolean; failed: boolean; rows: number; filtered: boolean }): HistoryState {
  // @cpt-begin:cpt-noter-state-ui-history-undo-read:p1:inst-error
  if (read.failed) return "ERROR";
  // @cpt-end:cpt-noter-state-ui-history-undo-read:p1:inst-error
  // @cpt-begin:cpt-noter-state-ui-history-undo-read:p1:inst-refilter
  if (read.loading) return "LOADING";
  // @cpt-end:cpt-noter-state-ui-history-undo-read:p1:inst-refilter
  // @cpt-begin:cpt-noter-state-ui-history-undo-read:p1:inst-ready
  if (read.rows) return "READY";
  // @cpt-end:cpt-noter-state-ui-history-undo-read:p1:inst-ready
  // @cpt-begin:cpt-noter-state-ui-history-undo-read:p1:inst-empty
  // @cpt-begin:cpt-noter-state-ui-history-undo-read:p1:inst-filtered
  return read.filtered ? "FILTERED_EMPTY" : "EMPTY";
  // @cpt-end:cpt-noter-state-ui-history-undo-read:p1:inst-filtered
  // @cpt-end:cpt-noter-state-ui-history-undo-read:p1:inst-empty
}

/** The jobs that made a change in these rows, for the job pop-up. */
export function jobsOf(rows: ChangeRow[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows) if (r.actor.type === "job") seen.set(r.actor.job_id, r.actor.name);
  return [...seen].map(([id, name]) => ({ id, name }));
}

/** The core's id of a row: its batch when it belongs to one, else the change; never a row index. */
export const undoTarget = (r: ChangeRow): UndoTarget => (r.batch_id && r.batch_size > 1 ? { type: "batch", batch_id: r.batch_id } : { type: "change", change_id: r.id });

export const sameTarget = (a: UndoTarget, b: UndoTarget) => JSON.stringify(a) === JSON.stringify(b);

export const actorLabel = (r: ChangeRow): string => (r.actor.type === "you" ? t("history.actor_you") : r.actor.type === "job" ? t("history.actor_job", { name: r.actor.name }) : t("history.actor_model", { runtime: runtimeLabel(r.actor.runtime) }));
