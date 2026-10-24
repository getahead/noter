import type { CallRow, CallSort } from "../../core/bindings";
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
