import { useEffect, useReducer, useRef, type KeyboardEvent } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { SettingsPane } from "../../core/bindings";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { Icon, type IconName } from "../../ui/icons";
import { PushButton } from "../../ui/primitives/push-button";
import { SearchField } from "../../ui/primitives/search-field";
import { loadSettings } from "./actions";
import { AudioPane } from "./AudioPane";
import { CallScreenPane } from "./CallScreenPane";
import { GeneralPane } from "./GeneralPane";
import { HotkeysPane } from "./HotkeysPane";
import type { PaneProps } from "./pane-props";
import { PerformancePane } from "./PerformancePane";
import { PrivacyPane } from "./PrivacyPane";
import { laterNote, paneLabel, searchPanes } from "./search";
import { UpdatesPane } from "./UpdatesPane";
import { INITIAL_WINDOW, listStep, windowKind, windowReduce } from "./window";

const ICONS: Record<SettingsPane, IconName> = {
  general: "gear", audio_and_transcription: "mic", models_and_runtimes: "agent", privacy: "lock", call_screen_and_menu_bar: "display", hotkeys: "keyboard",
  repositories: "branch", knowledge_sources: "books", maintenance: "wand", performance: "gauge", updates: "download",
};

const PANES: Partial<Record<SettingsPane, (p: PaneProps) => React.ReactNode>> = {
  general: (p) => <GeneralPane {...p} />,
  audio_and_transcription: (p) => <AudioPane {...p} />,
  privacy: (p) => <PrivacyPane {...p} />,
  call_screen_and_menu_bar: (p) => <CallScreenPane {...p} />,
  hotkeys: (p) => <HotkeysPane bridge={p.bridge} />,
  performance: (p) => <PerformancePane {...p} />,
  updates: (p) => <UpdatesPane {...p} />,
};

/** The panes a later feature fills show their frame and the milestone, never a blank area. */
const LATER = new Set<SettingsPane>(["models_and_runtimes", "repositories", "knowledge_sources", "maintenance"]);

// @cpt-component:cpt-noter-component-screen-settings:p1
// @cpt-dod:cpt-noter-dod-ui-settings-window:p1
export function SettingsWindow({ bridge }: { bridge: Bridge }) {
  const [win, dispatch] = useReducer(windowReduce, INITIAL_WINDOW);
  const settings = useWindow(bridge, (s) => s.whole.settings);
  const nav = useWindow(bridge, (s) => s.nav);
  // ST-R3 is for pane-level errors only: the initial read failing. A refused change shows under its own row.
  const readFailed = useWindow(bridge, (s) => s.commands["settings:get"]?.state === "ERROR");
  const retryable = useWindow(bridge, (s) => !!s.commands["settings:get"]?.error?.tryAgain);
  const scroll = useRef<Partial<Record<SettingsPane, number>>>({});
  const main = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (!asked.current) void loadSettings(bridge);
    asked.current = true;
  }, [bridge]);
  // a deep link (`nav:request`) opens its pane
  useEffect(() => void (nav?.type === "settings" && dispatch({ type: "pane", pane: nav.pane })), [nav]);
  // each pane keeps its scroll position
  useEffect(() => void (main.current && (main.current.scrollTop = scroll.current[win.pane] ?? 0)), [win.pane]);

  const found = searchPanes(win.search);
  const kind = windowKind({ ...win, error: readFailed ? "settings:get" : win.error });
  // one result is always a tab stop: the open pane, or the first match when the open pane is filtered out
  const tabStop = found.panes.some((p) => p.id === win.pane) ? win.pane : found.panes[0]?.id;
  // @cpt-begin:cpt-noter-flow-ui-settings-change-setting:p1:inst-open-pane
  const open = (pane: SettingsPane) => {
    if (main.current) scroll.current[win.pane] = main.current.scrollTop;
    dispatch({ type: "pane", pane });
  };
  // @cpt-end:cpt-noter-flow-ui-settings-change-setting:p1:inst-open-pane
  // ↑ and ↓ move between the panes; Return opens the one in focus
  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=listitem]")];
    const at = items.indexOf(document.activeElement as HTMLElement);
    // ↓ in the search field moves into the results
    if (e.key === "ArrowDown" && (e.target as HTMLElement).tagName === "INPUT") return void (e.preventDefault(), items[0]?.focus());
    const to = listStep(e.key, at, items.length);
    if (to !== null) (e.preventDefault(), items[to]?.focus());
    else if (e.key === "Enter" && at >= 0) (e.preventDefault(), items[at]!.click());
  };

  const pane = PANES[win.pane];
  // @cpt-begin:cpt-noter-flow-ui-settings-change-setting:p1:inst-store-settings
  // @cpt-begin:cpt-noter-flow-ui-settings-change-setting:p1:inst-return-pane
  return (
    <div className="st-win" data-component="cpt-noter-component-screen-settings" data-variant={win.pane} data-state={kind.toLowerCase()}>
      <div className="st-body">
        <nav className="st-panes" aria-label={t("settings.panes")} data-region="ST-R1" onKeyDown={onListKey}>
          <SearchField placeholder={t("settings.search")} value={win.search} onChange={(text) => dispatch({ type: "search", text })} />
          {found.kind === "none" ? (
            <div className="st-nomatch" role="status">
              {t("settings.no_match", { text: found.text })}
            </div>
          ) : (
            <div className="st-panelist" role="list" data-variant="settings-panes">
              {found.panes.map((p) => (
                <a key={p.id} href="#" role="listitem" tabIndex={p.id === tabStop ? 0 : -1} className={p.id === win.pane ? "st-pane-item is-sel" : "st-pane-item"} aria-current={p.id === win.pane ? "page" : "false"} onClick={(e) => (e.preventDefault(), open(p.id))}>
                  <Icon name={ICONS[p.id]} size={15} />
                  <span>{paneLabel(p.id)}</span>
                </a>
              ))}
            </div>
          )}
        </nav>
        <div className="st-main" ref={main}>
          {readFailed && (
            <div className="st-banner" data-region="ST-R3" role="alert">
              {t("settings.error.loading_retry")}
              {retryable && <PushButton label={t("action.try_again")} size="small" onAction={() => void bridge.retry("settings:get")} />}
            </div>
          )}
          <section className="st-pane" data-region="ST-R2" aria-label={paneLabel(win.pane)}>
            <h2 className="t-title3 st-pane__title">{paneLabel(win.pane)}</h2>
            {!settings ? null : LATER.has(win.pane) ? (
              <EmptyState variant="section" title={laterNote(win.pane as Parameters<typeof laterNote>[0])} />
            ) : (
              pane?.({ bridge, settings })
            )}
          </section>
        </div>
      </div>
    </div>
  );
  // @cpt-end:cpt-noter-flow-ui-settings-change-setting:p1:inst-return-pane
  // @cpt-end:cpt-noter-flow-ui-settings-change-setting:p1:inst-store-settings
}
