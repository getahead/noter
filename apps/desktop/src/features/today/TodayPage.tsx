// The Today dashboard (docs/features/ui/today.md): TD-R3 the calendar region with its call cards, This week, TD-R5 due
// without a call, TD-R6 proposals waiting, TD-R7 Done today and the TD-R8 review line. Item rows are the Items feature's.
import { useEffect, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { ActionItemRow } from "../items/ActionItemRow";
import { Disclosure } from "../../ui/primitives/disclosure";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { afterTimer } from "../call-page/logic";
import { allowCalendar, loadToday, READ_KEY } from "./actions";
import { useToday } from "./cache";
import { calendarState, cards, isExpanded, proposalPreview, reviewLine, weekCards } from "./model";
import { UpcomingCallCard } from "./UpcomingCallCard";
import "./today.css";

/** True once `active` has held for `ms` (skeleton cards after 300 ms, never a flash for a quick read). */
function useAfter(ms: number, active: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => afterTimer(ms, active, setLate), [ms, active]);
  return active && late;
}

// @cpt-component:cpt-noter-component-screen-today:p1
// @cpt-flow:cpt-noter-flow-ui-today-tick:p1
export function TodayPage({ bridge }: { bridge: Bridge }) {
  const view = useToday();
  const read = useWindow(bridge, (s) => s.commands[READ_KEY]) ?? { state: "IDLE" };
  const ask = useWindow(bridge, (s) => s.commands["today:calendar"]);
  // the same read again when what it shows can have changed: capture, setup or environment, and an item or call
  const ready = useWindow(bridge, (s) => s.status === "READY"); // the snapshot is the window's first command
  const capture = useWindow(bridge, (s) => s.whole.capture?.version);
  const env = useWindow(bridge, (s) => s.whole.environment);
  const items = useWindow(bridge, (s) => s.entities.item);
  const calls = useWindow(bridge, (s) => s.entities.call);
  // @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-regions
  useEffect(() => void (ready && loadToday(bridge)), [bridge, ready, capture, env, items, calls]);
  // @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-regions
  const state = calendarState(read, view, ask?.state === "WAITING");
  const skeleton = useAfter(300, state === "LOADING" || (state === "ERROR" && read.state === "WAITING"));
  // the user's own open/closed choice by event id; the next call is the first card that is not live
  const [user, setUser] = useState<ReadonlyMap<string, boolean>>(new Map());
  const toggle = (id: string, now: boolean) => setUser((m) => new Map(m).set(id, !now));
  const [doneOpen, setDoneOpen] = useState<boolean | undefined>(undefined);
  const tryAgain = () => void loadToday(bridge);
  const review = view ? reviewLine(view) : null;
  const proposals = view ? proposalPreview(view) : null;
  const day = view ? cards(view) : [];
  const next = day.findIndex((c) => c.variant !== "live" && c.variant !== "unmatched");
  const week = view ? weekCards(view) : [];

  return (
    <div className="td" data-component="cpt-noter-component-screen-today">
      {review && (
        <section data-region="TD-R8" className="td-review">
          {t("today.review", { count: review.count })}
        </section>
      )}
      {view?.first_use && <EmptyState variant="first-use" icon="inbox" title={t("today.first_use_title")} body={t("today.first_use_body")} />}
      <section data-region="TD-R3" className="td-calendar" aria-label={t("today.title")}>
        {state === "LOADING" && skeleton && <div className="td-skel" role="status" aria-label={t("today.loading")} />}
        {state === "NOT_ASKED" && <EmptyState variant="first-use" icon="calendar" title={t("today.not_asked_title")} body={t("today.not_asked_body")} actionLabel={t("today.allow_calendar")} onAction={() => void allowCalendar(bridge)} />}
        {state === "ERROR" && <InlineBanner banner={{ id: "today-error", severity: "error", text: t("today.read_failed"), actions: [{ label: t("action.try_again"), onAction: tryAgain }] }} />}
        {state === "NO_CALLS" && <h2 className="td-h">{t("today.no_calls")}</h2>}
        {state === "READY" && view && <h2 className="td-h">{t("today.calls", { count: day.length })}</h2>}
        {/* @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-cards */}
        {state === "READY" && day.map((c, i) => (
          <UpcomingCallCard key={c.event?.event_id ?? "live"} bridge={bridge} card={c} expanded={isExpanded(c.event?.event_id ?? "", user, i === next)} next={i === next} onToggle={() => c.event && toggle(c.event.event_id, isExpanded(c.event.event_id, user, i === next))} />
        ))}
        {/* @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-cards */}
      </section>
      {week.length > 0 && state !== "DENIED" && state !== "NOT_ASKED" && (
        <section data-region="TD-R4" className="td-week">
          <h2 className="td-h">{t("today.this_week")}</h2>
          {week.map((c) => (
            <UpcomingCallCard key={c.event!.event_id} bridge={bridge} card={c} expanded={isExpanded(c.event!.event_id, user, false)} onToggle={() => toggle(c.event!.event_id, isExpanded(c.event!.event_id, user, false))} />
          ))}
        </section>
      )}
      {view && (
        <section data-region="TD-R5" className="td-due">
          <h2 className="td-h">{t("today.due")}</h2>
          {view.due_without_call.length === 0 ? <EmptyState variant="section" title={t("today.nothing_due")} /> : view.due_without_call.map((it) => <ActionItemRow key={it.id} bridge={bridge} item={it} variant="compact" />)}
        </section>
      )}
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
      {view && (
        <section data-region="TD-R7" className="td-done">
          <Disclosure label={t("today.done_today", { count: view.done_today.length })} open={doneOpen ?? view.done_today.length === 0} onAction={() => setDoneOpen(!(doneOpen ?? view.done_today.length === 0))} />
          {(doneOpen ?? view.done_today.length === 0) && (view.done_today.length === 0 ? <EmptyState variant="section" title={t("today.nothing_ticked")} /> : view.done_today.map((it) => <ActionItemRow key={it.id} bridge={bridge} item={it} variant="done" />))}
        </section>
      )}
    </div>
  );
}
