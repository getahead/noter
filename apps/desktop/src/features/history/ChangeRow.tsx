// change-row (prototype C.changeRow): one change of the log with its time, actor, description and the actions that
// call the core by the row's change or batch id. No batch members: the contract carries none.
import { useState, type KeyboardEvent } from "react";
import type { ChangeRow as Change, UiPrefs } from "../../core/bindings";
import { clock, t } from "../../i18n/format";
import { DiffView } from "../../ui/diff/DiffView";
import { Badge } from "../../ui/primitives/badge";
import { PushButton } from "../../ui/primitives/push-button";
import { runtimeLabel } from "../call-page/outputs-logic";
import { actorLabel } from "./history";

export interface ChangeRowProps {
  row: Change;
  prefs: UiPrefs;
  /** The row's own Undo or Redo is running. */
  busy: boolean;
  onReverse: (row: Change, mode: "undo" | "redo") => void;
  tabIndex?: number;
}

// @cpt-component:cpt-noter-component-ui-change-row:p1
export function ChangeRow({ row, prefs, busy, onReverse, tabIndex = -1 }: ChangeRowProps) {
  // @cpt-begin:cpt-noter-flow-ui-history-undo-read:p1:inst-diff
  const [diff, setDiff] = useState(false);
  // @cpt-end:cpt-noter-flow-ui-history-undo-read:p1:inst-diff
  const undone = row.status === "undone";
  const canUndo = row.status === "applied" && row.undoable;
  const canRedo = undone && row.redoable;
  const canDiff = row.before !== null && row.after !== null;
  const meta = [row.entity.label, row.field, row.actor.type === "model" && `${runtimeLabel(row.actor.runtime)} · ${row.actor.model}`].filter(Boolean).join(" · ");
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey || e.code !== "KeyU") return;
    e.preventDefault();
    if (canUndo) onReverse(row, "undo");
    else if (canRedo) onReverse(row, "redo");
  };
  return (
    <li
      data-component="cpt-noter-component-ui-change-row"
      data-variant={row.actor.type === "model" ? "model-run" : row.batch_size > 1 ? "batch" : undone ? "undone" : "single"}
      data-state={busy ? "undoing" : undone ? "undone" : "applied"}
      className={`pc-chg${undone ? " is-undone" : ""}`}
      tabIndex={tabIndex}
      onKeyDown={onKey}
    >
      <span className="pc-chg__time np-tnum">{clock(row.at, prefs)}</span>
      <div className="pc-chg__main">
        <div className="pc-chg__line">
          <span className="pc-chg__actor">{actorLabel(row)}</span>
          <span className="pc-chg__what">{row.summary}</span>
          {/* @cpt-begin:cpt-noter-flow-ui-history-undo-read:p1:inst-batch */}
          {row.batch_size > 1 && <Badge text={t("history.batch", { count: row.batch_size })} kind="kind" tone="neutral" />}
          {/* @cpt-end:cpt-noter-flow-ui-history-undo-read:p1:inst-batch */}
        </div>
        <div className="pc-chg__meta">{meta}</div>
        {diff && canDiff && <DiffView before={row.before!} after={row.after!} />}
      </div>
      <div className="pc-chg__actions">
        {canDiff && <PushButton label={t(diff ? "history.hide_diff" : "history.diff")} size="small" variant="quiet" onAction={() => setDiff(!diff)} />}
        {canRedo ? <PushButton label={t("undo.redo")} size="small" loading={busy} onAction={() => onReverse(row, "redo")} /> : canUndo && <PushButton label={t("undo.undo")} size="small" loading={busy} onAction={() => onReverse(row, "undo")} />}
      </div>
    </li>
  );
}
