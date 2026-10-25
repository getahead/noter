import type { CallRow, CallSort, OutputsProgress, OutputsStatus } from "../../core/bindings";
import { t } from "../../i18n/format";
import { shortDay } from "./status-cell";

export type Column = "when" | "call" | "length";
const HOUR = 3_600_000;

// @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-user-sort
/** The sort a click on `col` asks for: When toggles; the contract has one order for Call and Length. */
export const nextSort = (cur: CallSort, col: Column): CallSort =>
  col === "when"
    ? cur === "newest"
      ? "oldest"
      : "newest"
    : col === "length"
      ? "longest"
      : "title";

/** The column's state for aria-sort, or undefined when it is not the sorted one. */
export function sortOf(
  sort: CallSort,
  col: Column,
): "asc" | "desc" | undefined {
  if (col === "when")
    return sort === "newest" ? "desc" : sort === "oldest" ? "asc" : undefined;
  if (col === "length") return sort === "longest" ? "desc" : undefined;
  return sort === "title" ? "asc" : undefined;
}
// @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-user-sort

export interface MonthGroup {
  label: string;
  rows: CallRow[];
}

/** Month groups in the order given (the sticky headers of the table). */
export function groupByMonth(
  rows: CallRow[],
  locale = "en-GB",
  tz?: string,
): MonthGroup[] {
  const fmt = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: tz,
  });
  const groups: MonthGroup[] = [];
  for (const r of rows) {
    const label = fmt.format(r.started_at);
    if (groups.at(-1)?.label === label) groups.at(-1)!.rows.push(r);
    else groups.push({ label, rows: [r] });
  }
  return groups;
}

// @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-render-table
/** "212 calls · 148 hours · since 2 Sep", plus "· 3 selected". */
export function subtitle(
  rows: CallRow[],
  total: number,
  selected: number,
  tz?: string,
): string {
  const hours = Math.round(
    rows.reduce((sum, r) => sum + r.duration_ms, 0) / HOUR,
  );
  const since = rows.length ? Math.min(...rows.map((r) => r.started_at)) : null;
  const parts = [
    t("library.calls.count", { count: total }),
    t("library.calls.hours", { count: hours }),
  ];
  if (since !== null)
    parts.push(t("library.calls.since", { date: shortDay(since, tz) }));
  if (selected > 1)
    parts.push(t("library.calls.selected", { count: selected }));
  return parts.join(" · ");
}
// @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-render-table

// @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-live-status
/** Whether any call's outputs are being written (the sidebar's glyph beside Calls). */
export const writing = (progress: Record<string, OutputsProgress>) =>
  Object.values(progress).some((p) => p.state.type === "writing");

/** Rows with what `outputs:progress` has said since: Writing while a section is, else failed or ready. */
export function withProgress(rows: CallRow[], progress: Record<string, OutputsProgress>): CallRow[] {
  const by = new Map<string, OutputsProgress[]>();
  for (const p of Object.values(progress)) by.set(p.call_id, [...(by.get(p.call_id) ?? []), p]);
  if (!by.size) return rows;
  const next = rows.map((r) => {
    const ps = by.get(r.id);
    if (!ps) return r;
    const outputs: OutputsStatus = ps.some((p) => p.state.type === "writing") ? "writing" : ps.some((p) => p.state.type === "failed") ? "failed" : "ready";
    return outputs === r.outputs ? r : { ...r, outputs };
  });
  return next.some((r, i) => r !== rows[i]) ? next : rows;
}
// @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-live-status
