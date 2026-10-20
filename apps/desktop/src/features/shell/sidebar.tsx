// MW-R2: the glass sidebar of the prototype's `sidebar()` (src/js/05-shell.js): the live-call row, the
// eight sections in three groups with their badges, and the status footer with the mode indicator.
import { Fragment } from "react";

import { callTime, t } from "../../i18n/format";
import { IconButton } from "../../ui/primitives/icon-button";
import { SourceList, SourceListGroup, SourceListItem, SourceListLive } from "../../ui/primitives/source-list";
import type { ModeView } from "./mode-indicator";
import { ModeIndicator } from "./mode-indicator-view";
import type { SectionKey } from "./history";
import { GROUPS } from "./sections";

export interface SidebarProps {
  selected: SectionKey;
  /** `proposals:counts`: the Activity badge. */
  waiting: number;
  problems: number;
  live: { title: string; paused: boolean; seconds: number } | null;
  mode: ModeView;
  /** The footer line (**Idle · API key · local fallback ready**, **Recording · Planning**…). */
  footer: string;
  /** The collapsed sidebar opened as an overlay. */
  overlay: boolean;
  /** pt; 220 by default, 180 to 320 at the split divider. */
  width: number;
  onSelect: (section: SectionKey) => void;
  onShowCall: () => void;
  onToggle: () => void;
  onOpenPrivacy: () => void;
}

export function Sidebar({ selected, waiting, problems, live, mode, footer, overlay, width, onSelect, onShowCall, onToggle, onOpenPrivacy }: SidebarProps) {
  return (
    <aside className={overlay ? "np-sidebar is-overlay" : "np-sidebar"} data-region="MW-R2" style={{ width }} aria-label={t("shell.sidebar")}>
      <div className="np-sidebar__top">
        <IconButton icon="sidebar" label={t("shell.hide_sidebar")} help={t("shell.hide_sidebar_help")} cls="np-sidebar__toggle" onAction={onToggle} />
      </div>
      <SourceList label={t("shell.sidebar")}>
        {/* @cpt-begin:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-live-row */}
        {live && (
          <SourceListLive>
            <button
              type="button"
              className="np-recind np-recind--row"
              data-component="cpt-noter-component-ui-recording-indicator"
              data-variant="live-row"
              data-state={live.paused ? "paused" : "recording"}
              title={t("shell.live_help")}
              onClick={onShowCall}
            >
              <span className={live.paused ? "np-recdot is-paused" : "np-recdot"} aria-hidden="true" />
              <span className="np-recind__title">{live.title}</span>
              <span className="np-recind__sep">·</span>
              {live.paused ? <span>{t("shell.live_paused")}</span> : <span className="np-tnum">{callTime(live.seconds)}</span>}
            </button>
          </SourceListLive>
        )}
        {/* @cpt-end:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-live-row */}
        {GROUPS.map((g) => (
          <Fragment key={g.title ?? "top"}>
            {g.title && <SourceListGroup>{t(g.title)}</SourceListGroup>}
            {g.sections.map((s) => {
              const activity = s.key === "activity";
              const label = t(s.label);
              const detail = activity ? [waiting > 0 && t("source_list.waiting", { count: waiting }), problems > 0 && t("source_list.problems", { count: problems })].filter(Boolean) : [];
              return (
                <SourceListItem
                  key={s.key}
                  icon={s.icon}
                  label={label}
                  selected={selected === s.key}
                  badge={activity && waiting > 0 ? waiting : undefined}
                  warn={activity && problems > 0}
                  help={t("section.help", { section: label, key: s.digit })}
                  ariaLabel={detail.length ? [label, ...detail].join(", ") : undefined}
                  onSelect={() => onSelect(s.key)}
                />
              );
            })}
          </Fragment>
        ))}
      </SourceList>
      {/* @cpt-begin:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-footer */}
      <div className="np-sidebar__footer" data-variant="footer">
        <ModeIndicator view={mode} variant="sidebar" text={footer} onOpenPrivacy={onOpenPrivacy} />
      </div>
      {/* @cpt-end:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-footer */}
    </aside>
  );
}

