// Today projects core-ranked cards, due work, proposals and completed items through the shared Items rows.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { openReview } from "../items/review-banner";
import { ActionItemRow } from "../items/ActionItemRow";
import { Disclosure } from "../../ui/primitives/disclosure";
import { moveFocus } from "../../ui/primitives/roving";
import { positionOf, restorePosition } from "./position";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { Link } from "../../ui/primitives/link";
import { PushButton } from "../../ui/primitives/push-button";
import { afterTimer } from "../call-page/logic";
import { allowCalendar, loadToday, READ_KEY } from "./actions";
import { useToday } from "./cache";
import { expandLive, calendarState, cards, isExpanded, proposalPreview, reviewLine, weekCards } from "./model";
import { ProposalRow } from "./ProposalRow";
import { UpcomingCallCard } from "./UpcomingCallCard";
import "./today.css";

/** True once `active` has held for `ms` (skeleton cards after 300 ms, never a flash for a quick read). */
function useAfter(ms: number, active: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => afterTimer(ms, active, setLate), [ms, active]);
  return active && late;
}

// @cpt-component:cpt-noter-component-screen-today:p1
// @cpt-dod:cpt-noter-dod-ui-today-dashboard:p1
// @cpt-dod:cpt-noter-dod-ui-today-items:p1
// @cpt-flow:cpt-noter-flow-ui-today-tick:p1
export function TodayPage({ bridge }: { bridge: Bridge }) {
  const view = useToday();
  const root = useRef<HTMLDivElement>(null);
  const position = positionOf(bridge);
  const read = useWindow(bridge, (s) => s.commands[READ_KEY]) ?? { state: "IDLE" };
  const ask = useWindow(bridge, (s) => s.commands["today:calendar"]);
  // the same read again when what it shows can have changed: capture, setup or environment, and an item or call
  const ready = useWindow(bridge, (s) => s.status === "READY"); // the snapshot is the window's first command
  const live = useWindow(bridge, (s) => s.whole.capture?.phase === "recording" || s.whole.capture?.phase === "paused");
  const capture = useWindow(bridge, (s) => s.whole.capture?.version);
  const env = useWindow(bridge, (s) => s.whole.environment);
  const items = useWindow(bridge, (s) => s.entities.item);
  const settings = useWindow(bridge, (s) => s.whole.settings);
  const calls = useWindow(bridge, (s) => s.entities.call);
  // @cpt-begin:cpt-noter-algo-ui-today-project:p1:inst-refresh
  // @cpt-begin:cpt-noter-state-ui-today-calendar:p1:inst-settings
  // @cpt-begin:cpt-noter-state-ui-today-calendar:p1:inst-date
  // @cpt-begin:cpt-noter-flow-ui-today-tick:p1:inst-refresh
  useEffect(() => void (ready && loadToday(bridge)), [bridge, ready, capture, env, settings, items, calls]);
  // @cpt-end:cpt-noter-flow-ui-today-tick:p1:inst-refresh
  // @cpt-end:cpt-noter-state-ui-today-calendar:p1:inst-date
  // @cpt-end:cpt-noter-state-ui-today-calendar:p1:inst-settings
  // @cpt-end:cpt-noter-algo-ui-today-project:p1:inst-refresh
  // @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-calendar
  const state = calendarState(read, view, ask?.state === "WAITING");
  // @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-calendar
  const skeleton = useAfter(300, state === "LOADING" || (state === "ERROR" && read.state === "WAITING"));
  // the user's own open/closed choice by event id; the next call is the first card that is not live
  const [user, setUser] = useState<ReadonlyMap<string, boolean>>(position.expanded);
  const toggle = (id: string, now: boolean) => {
    position.expanded = new Map(position.expanded).set(id, !now);
    setUser(position.expanded);
  };
  const [doneOpen, setDoneOpen] = useState<boolean | undefined>(position.doneOpen);
  // @cpt-begin:cpt-noter-state-ui-today-calendar:p1:inst-retry
  const tryAgain = () => void loadToday(bridge);
  // @cpt-end:cpt-noter-state-ui-today-calendar:p1:inst-retry
  const review = view ? reviewLine(view) : null;
  const proposals = view ? proposalPreview(view) : null;
  const day = view ? cards(view) : [];
  const next = day.findIndex((c) => c.variant !== "live" && c.variant !== "unmatched");
  const week = view ? weekCards(view) : [];
  const liveEvent = day.find((card) => card.variant === "live")?.event?.event_id;
  useEffect(() => {
    position.expanded = expandLive(position.expanded, liveEvent);
    setUser(position.expanded);
  }, [position, liveEvent]);

  // @cpt-begin:cpt-noter-flow-ui-today-tick:p1:inst-return
  useLayoutEffect(() => restorePosition(root.current, position));
  // @cpt-end:cpt-noter-flow-ui-today-tick:p1:inst-return
  const rowKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // @cpt-begin:cpt-noter-flow-ui-today-tick:p1:inst-tick
    if (moveFocus(event, "[data-item-id]", false)) return;
    // @cpt-end:cpt-noter-flow-ui-today-tick:p1:inst-tick
    const target = event.target as HTMLElement;
    if (!target.matches("[data-item-id]") || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
    if (event.key === " ") {
      event.preventDefault();
      // @cpt-begin:cpt-noter-flow-ui-today-tick:p1:inst-tick
      target.querySelector<HTMLElement>('[role="checkbox"], input[type="checkbox"]')?.click();
      // @cpt-end:cpt-noter-flow-ui-today-tick:p1:inst-tick
    } else if (event.key === "Enter") {
      const item = view && [...view.due_without_call, ...view.done_today, ...view.today.flatMap((c) => [...c.items, ...c.questions, ...c.handed_off]), ...view.this_week.flatMap((c) => [...c.items, ...c.questions, ...c.handed_off])].find((it) => it.id === target.dataset.itemId);
      const span = item?.spans[0];
      if (span) {
        event.preventDefault();
        // @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-links
        void bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "call_page", call_id: span.call_id, tab: "transcript", span } }), { screen: "main-window-shell" });
        // @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-links
      }
    }
  };
  // @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-return
  // @cpt-begin:cpt-noter-algo-ui-today-project:p1:inst-return
  // @cpt-begin:cpt-noter-algo-ui-today-project:p1:inst-layout
  return (
    <div ref={root} onKeyDown={rowKey} onFocus={(event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-item-id]");
      if (row) {
        position.focused = row.dataset.itemId!;
        position.group = row.closest<HTMLElement>("[data-today-group]")?.dataset.todayGroup;
        // only focus on the row itself moves the roving stop; a control inside a row is reached by Tab without making its row one
        if (event.target === row) {
          position.stop = { id: row.dataset.itemId!, group: position.group };
          root.current?.querySelectorAll<HTMLElement>("[data-item-id]").forEach((it) => { it.tabIndex = it === row ? 0 : -1; });
        }
      }
    }} className="td" data-component="cpt-noter-component-screen-today">
      {/* @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-regions */}
      {review && (
        <section data-region="TD-R8" className="td-review">
          <div>
            <strong>{t("today.to_review")}</strong>
            {review.count > 0 && <> {t("today.review_items", { count: review.count })} {t("today.review_from", { count: review.calls.length })}</>}
            {review.unnamed > 0 && <>{review.count > 0 ? " · " : " "}{t("today.unnamed", { count: review.unnamed })}</>}
          </div>
          <div className="td-review__links">
            {review.calls.map((c) => <Link key={c.id} label={`${c.title} ›`} onAction={() => void openReview(bridge, c.id)} />)}
          </div>
        </section>
      )}
      {/* @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-regions */}
      {view?.first_use && <EmptyState variant="first-use" icon="inbox" title={t("today.first_use_title")} body={t("today.first_use_body")} />}
      <section data-region="TD-R3" className="td-calendar" aria-label={t("today.title")}>
        {(state === "NOT_ASKED" || state === "NO_CALLS") && <h2 className="td-h">{t("today.title")}</h2>}
        {skeleton && <div role="status" aria-label={t("today.loading")}><div className="td-skel" /><div className="td-skel" /></div>}
        {state === "NOT_ASKED" && <EmptyState variant="first-use" icon="calendar" title={t("today.not_asked_title")} body={t("today.not_asked_body")} actionLabel={live ? undefined : t("today.allow_calendar")} onAction={() => void allowCalendar(bridge)} />}
        {/* @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-failed */}
        {state === "ERROR" && <InlineBanner banner={{ id: "today-error", severity: "error", text: t("today.read_failed"), actions: [{ label: t("action.try_again"), onAction: tryAgain }] }} />}
        {/* @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-failed */}
        {/* @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-allowed */}
        {state === "NO_CALLS" && <p className="td-empty">{t("today.no_calls")}</p>}
        {state === "READY" && view && <h2 className="td-h">{t("today.calls", { count: day.length })}</h2>}
        {/* @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-allowed */}
        {/* @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-cards */}
        {/* the live call card comes from live_call, so it shows whatever the calendar says */}
        {(state === "READY" ? day : day.filter((c) => c.variant === "live" || c.variant === "unmatched")).map((c, i) => (
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
      {/* @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-regions */}
      {/* @cpt-begin:cpt-noter-algo-ui-today-project:p1:inst-empty */}
      {view && (
        <section data-region="TD-R5" data-today-group="due" className="td-due">
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
            <div className="td-props">
              {proposals.rows.map((p) => <ProposalRow key={p.id} proposal={p} />)}
            </div>
          )}
          <PushButton label={t("today.show_all_activity")} variant="quiet" disabled />
        </section>
      )}
      {view && (
        <section data-region="TD-R7" data-today-group="done" className="td-done">
          <Disclosure label={t("today.done_today", { count: view.done_today.length })} open={doneOpen ?? view.done_today.length === 0} onAction={() => {
            position.doneOpen = !(doneOpen ?? view.done_today.length === 0);
            setDoneOpen(position.doneOpen);
          }} />
          {(doneOpen ?? view.done_today.length === 0) && (view.done_today.length === 0 ? <EmptyState variant="section" title={t("today.nothing_ticked")} /> : view.done_today.map((it) => <ActionItemRow key={it.id} bridge={bridge} item={it} variant="done" />))}
        </section>
      )}
      {/* @cpt-end:cpt-noter-algo-ui-today-project:p1:inst-empty */}
      {/* @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-regions */}
    </div>
  );
  // @cpt-end:cpt-noter-algo-ui-today-project:p1:inst-layout
  // @cpt-end:cpt-noter-algo-ui-today-project:p1:inst-return
  // @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-return
}
