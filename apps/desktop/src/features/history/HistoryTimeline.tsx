// history-timeline (prototype C.historyTimeline): the changes of a call, item or person, newest first under date
// groups, with the actor and job filters. Rows call the core by id; the strip and the rows share one target.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { ActorFilter, ChangeRow as Change, HistoryTarget, UiPrefs, UndoTarget } from "../../core/bindings";
import { t } from "../../i18n/format";
import { useSheet } from "../../ui/dialogs/host";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PushButton } from "../../ui/primitives/push-button";
import { SegmentedControl } from "../../ui/primitives/segmented-control";
import { moveFocus } from "../../ui/primitives/roving";
import { afterTimer } from "../call-page/logic";
import { ChangeRow } from "./ChangeRow";
import { groupByDay, historyKey, historyState, jobsOf, sameTarget, undoTarget, type HistoryState } from "./history";
import { holdUndo, runUndo, undoWorking, useUndo } from "./undo";
import "./history.css";

export interface HistoryTimelineProps {
  bridge: Bridge;
  target: HistoryTarget;
  variant: "call" | "item" | "person";
  /** The call's title for **Export Log…** (call variant). */
  callId?: string;
  callTitle?: string;
}

const ACTORS: { value: ActorFilter; label: "history.all" | "history.you" | "history.jobs" | "history.models" }[] = [
  { value: "all", label: "history.all" },
  { value: "you", label: "history.you" },
  { value: "jobs", label: "history.jobs" },
  { value: "models", label: "history.models" },
];

// @cpt-component:cpt-noter-component-ui-history-timeline:p1
export function HistoryTimeline({ bridge, target, variant, callId, callTitle }: HistoryTimelineProps) {
  const sheets = useSheet();
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const strip = useUndo();
  const [actor, setActor] = useState<ActorFilter>("all");
  const [jobId, setJobId] = useState<string | null>(null);
  const [data, setData] = useState<{ key: string; rows: Change[]; jobs: { id: string; name: string }[] } | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [late, setLate] = useState(false);
  const token = useRef(0);
  const key = historyKey(target, actor, jobId);
  const cmd = useWindow(bridge, (s) => s.commands[key]);

  // @cpt-begin:cpt-noter-flow-ui-history-undo-read:p1:inst-read
  const load = useCallback(async () => {
    const mine = ++token.current;
    const res = await bridge.act(key, "history_list", () => bridge.core.historyList({ target, actor, job_id: jobId, page: {} }), { named: { change_log_unreadable: "history_unreadable" }, screen: "history" });
    // @cpt-begin:cpt-noter-flow-ui-history-undo-read:p1:inst-filter
    if (mine !== token.current || res.status !== "ok") return; // a newer read superseded this one
    // @cpt-end:cpt-noter-flow-ui-history-undo-read:p1:inst-filter
    setData((old) => ({ key, rows: res.data.rows, jobs: actor === "all" && !jobId ? jobsOf(res.data.rows) : (old?.jobs ?? jobsOf(res.data.rows)) }));
  }, [bridge, key]);
  // @cpt-end:cpt-noter-flow-ui-history-undo-read:p1:inst-read
  const reload = useRef(load);
  reload.current = load;
  // the strip's ⌘Z target outlives the page: after unmount its refresh reads nothing
  useEffect(() => () => void (reload.current = () => Promise.resolve()), []);
  // once per key and instance: a development remount must not ask the core twice
  const asked = useRef<string | null>(null);
  // @cpt-begin:cpt-noter-flow-ui-history-undo-read:p1:inst-open
  useEffect(() => {
    if (asked.current !== key) void load();
    asked.current = key;
  }, [load, key]);
  // @cpt-end:cpt-noter-flow-ui-history-undo-read:p1:inst-open

  // @cpt-begin:cpt-noter-flow-ui-history-undo-read:p1:inst-error
  const failed = cmd?.state === "ERROR";
  // @cpt-end:cpt-noter-flow-ui-history-undo-read:p1:inst-error
  const rows = data?.key === key ? data.rows : [];
  const loading = data?.key !== key && !failed;
  useEffect(() => afterTimer(300, loading, setLate), [loading]);
  const filtered = actor !== "all" || jobId !== null;
  const state = historyState({ loading, failed, rows: rows.length, filtered });

  const reverse = (row: Change, mode: "undo" | "redo") => {
    if (undoWorking()) return; // a second press while a command runs does nothing
    holdUndo({ target: undoTarget(row), message: row.summary, mode, refresh: () => reload.current() });
    void runUndo(bridge);
  };

  // @cpt-begin:cpt-noter-flow-ui-history-undo-read:p1:inst-retry
  // @cpt-begin:cpt-noter-state-ui-history-undo-read:p1:inst-retry
  const retry = () => void load(); // repeats this read only
  // @cpt-end:cpt-noter-state-ui-history-undo-read:p1:inst-retry
  // @cpt-end:cpt-noter-flow-ui-history-undo-read:p1:inst-retry
  const chooseActor = (a: string) => (setActor(a as ActorFilter), setJobId(null));
  const chooseJob = (v: string) => (setJobId(v || null), setActor(v ? "jobs" : actor));
  const jobs = data?.jobs ?? [];
  // @cpt-begin:cpt-noter-flow-ui-history-undo-export:p1:inst-open
  const exportLog = () => sheets.open("export-log", { bridge, callId, callTitle, onExported: setExported });
  // @cpt-end:cpt-noter-flow-ui-history-undo-export:p1:inst-open
  if (!prefs) return null;
  // @cpt-begin:cpt-noter-flow-ui-history-undo-read:p1:inst-return
  return (
    <TimelineView
      variant={variant}
      state={state}
      late={late}
      rows={rows}
      prefs={prefs}
      actor={actor}
      jobId={jobId}
      jobs={jobs}
      exported={exported}
      busyTarget={strip?.phase === "WORKING" ? strip.target : null}
      onActor={chooseActor}
      onJob={chooseJob}
      onExport={exportLog}
      onRetry={retry}
      onReverse={reverse}
    />
  );
  // @cpt-end:cpt-noter-flow-ui-history-undo-read:p1:inst-return
}

export interface TimelineViewProps {
  variant: "call" | "item" | "person";
  state: HistoryState;
  late: boolean;
  rows: Change[];
  prefs: UiPrefs;
  actor: ActorFilter;
  jobId: string | null;
  jobs: { id: string; name: string }[];
  exported: string | null;
  /** The target of the strip's running command, so its row shows the spinner. */
  busyTarget: UndoTarget | null;
  onActor: (a: string) => void;
  onJob: (id: string) => void;
  onExport: () => void;
  onRetry: () => void;
  onReverse: (row: Change, mode: "undo" | "redo") => void;
  now?: number;
}

/** The timeline's markup for a read state; the data and the commands stay with `HistoryTimeline`. */
export function TimelineView(p: TimelineViewProps) {
  const { variant, state, rows, prefs, actor, jobId, jobs } = p;
  const groups = groupByDay(rows, p.now ?? Date.now(), prefs);
  const filterName = jobId ? (jobs.find((j) => j.id === jobId)?.name ?? "") : t(ACTORS.find((a) => a.value === actor)!.label).toLowerCase();
  return (
    <section data-component="cpt-noter-component-ui-history-timeline" data-variant={variant} data-state={state.toLowerCase()} className={`pc-hist pc-hist--${variant}`} data-region={variant === "call" ? "PC-R8" : undefined} aria-label={t("history.title")}>
      <div className="pc-hist__filters">
        {variant === "item" ? (
          <PopupButton options={ACTORS.map((a) => ({ value: a.value, label: t(a.label) }))} value={actor} label={t("history.filter")} onAction={p.onActor} />
        ) : (
          <SegmentedControl variant="option" label={t("history.filter")} items={ACTORS.map((a) => ({ value: a.value, label: t(a.label) }))} value={actor} onAction={p.onActor} />
        )}
        {variant !== "item" && jobs.length > 0 && (
          <PopupButton options={[{ value: "", label: t("history.all_jobs") }, ...jobs.map((j) => ({ value: j.id, label: j.name }))]} value={jobId ?? ""} label={t("history.jobs_filter")} onAction={p.onJob} />
        )}
        {/* the returned count is announced politely and drawn nowhere: the prototype has no count line */}
        <span className="pc-hist__sr" role="status">{state === "READY" ? t("history.count", { count: rows.length }) : ""}</span>
        {p.exported && <span className="np-dim pc-hist__count" role="status">{t("history.exported", { path: p.exported })}</span>}
        <span className="np-tb__spacer" />
        {variant === "call" && <PushButton label={t("history.export")} size="small" onAction={p.onExport} />}
      </div>
      {/* @cpt-begin:cpt-noter-flow-ui-history-undo-read:p1:inst-end-error */}
      {state === "ERROR" && <InlineBanner banner={{ id: "history-error", severity: "error", text: t("history.error_call"), actions: [{ label: t("action.try_again"), onAction: p.onRetry }] }} />}
      {/* @cpt-end:cpt-noter-flow-ui-history-undo-read:p1:inst-end-error */}
      {state === "LOADING" && p.late && (
        <div className="pc-skel" role="status" aria-label={t("history.loading")}>
          {[0, 1, 2].map((i) => <div key={i} className="pc-skel__line" style={{ width: "90%" }} />)}
        </div>
      )}
      {state === "EMPTY" && <EmptyState variant="section" title={t("history.empty")} />}
      {state === "FILTERED_EMPTY" && <EmptyState variant="filtered" title={t("history.none_filtered", { filter: filterName })} />}
      {state === "READY" && (
        <div onKeyDown={(e) => moveFocus(e, ".pc-chg", false)}>
          {groups.map((g, gi) => (
            <div key={g.day} className="pc-hist__group">
              <h3 className="pc-hist__day">{g.day}</h3>
              <ul className="pc-hist__list">
                {g.rows.map((r, i) => (
                  <ChangeRow key={r.id} row={r} prefs={prefs} tabIndex={gi === 0 && i === 0 ? 0 : -1} busy={p.busyTarget !== null && sameTarget(p.busyTarget, undoTarget(r))} onReverse={p.onReverse} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
