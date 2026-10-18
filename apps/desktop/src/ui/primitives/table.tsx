// table and th of the prototype's src/js/02-primitives.js. The rows are the owner's: give the focusable ones
// tabIndex so ↑/↓, Home and End move between them (one tab stop per table, DESIGN 3.2 › table).
import type { ReactNode } from "react";
import { Icon } from "../icons";
import { base, cx, type Common } from "./attrs";
import { activates, moveFocus } from "./roving";
import "./table.css";

export interface TableProps extends Common {
  /** sortable (default) | multi-select | outline | grouped | virtualised */
  variant?: string;
  /** VoiceOver name of the table. */
  label?: string;
  wrapCls?: string;
  children?: ReactNode;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
export function Table({ variant = "sortable", label, wrapCls, cls, children, ...o }: TableProps) {
  return (
    <div className={cx("np-table-wrap", wrapCls)}>
      {/* the prototype never puts the id on the table */}
      <table className={cx("np-table", cls)} {...base("table", { ...o, variant, id: undefined })} aria-label={label} onKeyDown={(e) => moveFocus(e, "tbody tr[tabindex]", false)}>
        {children}
      </table>
    </div>
  );
}

export interface ThProps {
  label: ReactNode;
  sort?: "asc" | "desc";
  width?: string;
  cls?: string;
  /** Sorts by this column; makes the header a keyboard stop (Return or Space). */
  onSort?: () => void;
}

/** Column header; its sort state is announced through aria-sort ("sorted descending"). */
export function Th({ label, sort, width, cls, onSort }: ThProps) {
  return (
    <th
      scope="col"
      className={cls}
      aria-sort={sort ? (sort === "asc" ? "ascending" : "descending") : undefined}
      style={width ? { width } : undefined}
      tabIndex={onSort ? 0 : undefined}
      onClick={onSort}
      onKeyDown={onSort && ((e) => activates(e) && (e.preventDefault(), onSort()))}
    >
      {label}
      {sort && <Icon name={sort === "asc" ? "chevronUp" : "chevronDown"} size={10} cls="np-th__sort" />}
    </th>
  );
}

// @cpt-begin:cpt-noter-algo-ui-primitives-fit-labels:p1:inst-tail-truncate
/** A text cell: tail-truncates, with the full text in a help tag; VoiceOver reads the whole text. */
export const TextCell = ({ text, cls }: { text: string; cls?: string }) => (
  <td className={cx("np-td--trunc", cls)} title={text}>
    {text}
  </td>
);
// @cpt-end:cpt-noter-algo-ui-primitives-fit-labels:p1:inst-tail-truncate
