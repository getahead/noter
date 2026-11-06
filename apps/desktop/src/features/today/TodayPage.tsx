// The Today dashboard (docs/features/ui/today.md): TD-R3 the calendar region, TD-R6 proposals waiting and TD-R8 the
// review line. The item regions (TD-R5 due, TD-R7 Done today) and the call cards join with the Items rows (2.17).
import { useEffect, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { afterTimer } from "../call-page/logic";
import { allowCalendar, loadToday, openCalendarSettings, READ_KEY } from "./actions";
import { useToday } from "./cache";
import { calendarState, proposalPreview, reviewLine } from "./model";
import "./today.css";

/** True once `active` has held for `ms` (skeleton cards after 300 ms, never a flash for a quick read). */
function useAfter(ms: number, active: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => afterTimer(ms, active, setLate), [ms, active]);
  return active && late;
}

// @cpt-component:cpt-noter-component-screen-today:p1
// @cpt-dod:cpt-noter-dod-ui-today-dashboard:p3
export function TodayPage({ bridge }: { bridge: Bridge }) {
  const view = useToday();
  const read = useWindow(bridge, (s) => s.commands[READ_KEY]) ?? { state: "IDLE" };
  const ask = useWindow(bridge, (s) => s.commands["today:calendar"]);
  // the same read again when what it shows can have changed: capture, setup or environment, and an item or call
  const capture = useWindow(bridge, (s) => s.whole.capture?.version);
  const env = useWindow(bridge, (s) => s.whole.environment);
  const items = useWindow(bridge, (s) => s.entities.item);
  const calls = useWindow(bridge, (s) => s.entities.call);
  // @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-regions
  useEffect(() => void loadToday(bridge), [bridge, capture, env, items, calls]);
  // @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-regions
  const state = calendarState(read, view, ask?.state === "WAITING");
  const skeleton = useAfter(300, state === "LOADING" || (state === "ERROR" && read.state === "WAITING"));
  const tryAgain = () => void loadToday(bridge);
  const review = view ? reviewLine(view) : null;
  const proposals = view ? proposalPreview(view) : null;

  return (
    <div className="td" data-component="cpt-noter-component-screen-today">
      {review && (
        <section data-region="TD-R8" className="td-review">
          {t("today.review", { count: review.count })}
        </section>
      )}
      <section data-region="TD-R3" className="td-calendar" aria-label={t("today.title")}>
        {state === "LOADING" && skeleton && <div className="td-skel" role="status" aria-label={t("today.loading")} />}
        {state === "NOT_ASKED" && <EmptyState variant="first-use" icon="calendar" title={t("today.not_asked_title")} body={t("today.not_asked_body")} actionLabel={t("today.allow_calendar")} onAction={() => void allowCalendar(bridge)} />}
        {state === "DENIED" && <InlineBanner banner={{ id: "today-denied", severity: "warning", text: t("today.denied"), actions: [{ label: t("today.open_settings"), onAction: () => void openCalendarSettings(bridge) }] }} />}
        {state === "ERROR" && <InlineBanner banner={{ id: "today-error", severity: "error", text: t("today.read_failed"), actions: [{ label: t("action.try_again"), onAction: tryAgain }] }} />}
        {state === "NO_CALLS" && <h2 className="td-h">{t("today.no_calls")}</h2>}
        {state === "READY" && view && <h2 className="td-h">{t("today.calls", { count: view.today.length })}</h2>}
      </section>
      {proposals && (
        <section data-region="TD-R6" className="td-proposals">
          <h2 className="td-h">{t("today.proposals", { count: proposals.total })}</h2>
          {proposals.rows.length === 0 ? (
            <p className="td-empty">{t("today.nothing_waiting")}</p>
          ) : (
            <ul>
              {proposals.rows.map((p) => (
                <li key={p.id}>{p.title}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
