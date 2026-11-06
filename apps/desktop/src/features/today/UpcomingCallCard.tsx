// The upcoming call card (DESIGN › Upcoming call card): time, title, attendees, **Local only**, **Last time:** and the
// open count. The action and question rows inside it join with the Items rows (2.17).
import { useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { Disclosure } from "../../ui/primitives/disclosure";
import { Menu } from "../../ui/primitives/menu";
import { Popover } from "../../ui/primitives/popover";
import { PullDownButton } from "../../ui/primitives/pull-down-button";
import { PushButton } from "../../ui/primitives/push-button";
import { setCallType, setSensitive } from "../call-page/actions";
import { useTypes } from "../call-page/cache";
import { RecordingIndicator } from "../call-window/strip";
import { showCall, showPreviousCall } from "./actions";
import type { Card } from "./model";

const clock = (ms: number) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(ms);

// @cpt-component:cpt-noter-component-ui-upcoming-call-card:p1
export function UpcomingCallCard({ bridge, card, expanded, next = false, onToggle }: { bridge: Bridge; card: Card; expanded: boolean; /** The next call: expanded by default, with no Collapse. */ next?: boolean; onToggle: () => void }) {
  const e = card.event;
  const types = useTypes();
  const call = useWindow(bridge, (s) => (e?.call_id ? s.entities.call[e.call_id] : undefined));
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const live = card.variant === "live" || card.variant === "unmatched";
  const title = e?.title ?? card.live?.title ?? "";
  const open = e ? e.open_count : 0;
  const id = e?.event_id ?? "live"; // the opaque event id is unique on the page, so it is the opener's DOM id
  // @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-menu
  const menuItems = e && [
    // only a call that exists has a type and a sensitivity to change; a calendar-only event has no event-targeted command
    { label: t("callpage.call_type"), disabled: !call, children: types.map((x) => ({ label: x.label, checked: call?.call_type === x.id, onSelect: () => call && void setCallType(bridge, call.id, call.rev, x.id) })) },
    { label: t("callpage.mark_sensitive"), disabled: !call, checked: call?.privacy === "sensitive", onSelect: () => call && void setSensitive(bridge, call.id, call.privacy !== "sensitive") },
    { label: t("today.show_previous"), disabled: !e.last_time, onSelect: () => e.last_time && void showPreviousCall(bridge, e.last_time.call.id) },
  ];
  // @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-menu
  return (
    <article className="td-card" data-component="cpt-noter-component-ui-upcoming-call-card" data-variant={card.variant} data-state={live ? "live" : expanded ? "expanded" : "collapsed"} aria-label={title}>
      <header className="td-card__head">
        {e && <time className="td-card__time">{clock(e.starts_at)}</time>}
        {card.variant === "unmatched" && <RecordingIndicator variant="dot-text" status="recording" />}
        {live ? (
          <h3 className="td-card__title">{title}</h3>
        ) : (
          <h3 className="td-card__title">
            <Disclosure variant="row" label={card.variant === "this-week" ? t("today.week_row", { title, count: open }) : title} open={expanded} onAction={onToggle} />
          </h3>
        )}
        {e && !live && <span className="td-card__count">{open > 0 ? t("today.open_count", { count: open }) : t("today.nothing_open")}</span>}
        {expanded && !live && !next && <PushButton label={t("today.collapse")} variant="quiet" size="small" onAction={onToggle} />}
        {live && <PushButton label={t("today.open_call_screen")} variant="secondary" size="small" onAction={() => void showCall(bridge)} />}
        {menuItems && (
          <>
            <PullDownButton id={id} iconOnly icon="ellipsis" label={t("callpage.more")} ariaLabel={t("callpage.more")} variant="item-menu" size="small" open={menu !== null} onAction={() => setMenu(menu ? null : globalThis.document?.getElementById(id) ?? null)} />
            {menu && (
              <Popover variant="item-menu" anchor={menu} align="end" label={t("callpage.more")} onClose={() => setMenu(null)}>
                <Menu items={menuItems} onClose={() => setMenu(null)} />
              </Popover>
            )}
          </>
        )}
      </header>
      {e && (
        <div className="td-card__meta">
          {e.attendees.map((a, i) => (
            <span key={i} className="td-card__att">{a.name}</span>
          ))}
          {e.sensitive && <span className="td-card__local">{t("today.local_only")}</span>}
        </div>
      )}
      {e?.last_time && (
        <p className="td-card__last">
          <button type="button" className="td-card__link" onClick={() => void showPreviousCall(bridge, e.last_time!.call.id)}>{t("today.last_time", { line: e.last_time.line })}</button>
        </p>
      )}
    </article>
  );
}
