// The main window (cpt-noter-component-shell-main-window): the frame every page outside the call lives in,
// drawn as the prototype's `S.mainWindow()` does: sidebar MW-R2, toolbar MW-R1, banner slot MW-R5, content MW-R3
// and inspector slot MW-R4. It renders from the window store; the history, sidebar and zoom are view state.
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";

import { useWindowShortcuts } from "../../app/a11y/keys";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { BannerKind, CommandName, NavTarget, Result } from "../../core/bindings";
import type { WholeName } from "../../app/store/window-store";
import { t } from "../../i18n/format";
import { BannerSlot } from "../../ui/feedback/inline-banner";
import { SplitDivider } from "../../ui/primitives/split-divider";
import { appBanners, commandFailures, isBannerKind, type BannerActions } from "./app-banners";
import { frameState } from "./frame";
import { InspectorSlot } from "./inspector";
import { currentRoute, INITIAL_SHELL, SIDEBAR, shellReduce, zoomStyle } from "./shell-state";
import { elapsedSeconds, isLive, shortTitle } from "./live-row";
import { modeIndicator } from "./mode-indicator";
import { MODE_MSG } from "./mode-indicator-view";
import { shellShortcuts, type ShellAction } from "./menu-model";
import { pageFor } from "./pages";
import { actionEvent, createScrollMemory, escapeEvent, focusEffect, layoutFor, navEffect, scrollEffect, tickWhile, watchWidth, type NavFlags } from "./shell-effects";
import { searchRoute } from "./sections";
import { Sidebar } from "./sidebar";
import { ToolbarHost } from "./toolbar";
import "../call-page/register";
import { slots } from "../call-page/slots";
import { deleteFromPage } from "../../ui/dialogs/delete-calls";
import "./shell.css";

const NO_NEED = { full: 0, singleColumn: 0, fewerColumns: 0 };

// @cpt-component:cpt-noter-component-shell-main-window:p1
// @cpt-dod:cpt-noter-dod-ui-main-window-shell-frame:p1
// @cpt-flow:cpt-noter-flow-ui-main-window-shell-app-state:p1
// @cpt-flow:cpt-noter-flow-ui-main-window-shell-resize:p1
export function MainWindow({ bridge }: { bridge: Bridge }) {
  const [shell, dispatch] = useReducer(shellReduce, INITIAL_SHELL);
  // Delete Call… on a call's page: the dialogs host's alert, then Library › Calls replaces the deleted page. Set while
  // rendering because the call page's toolbar, a child, reads it before any effect of this window runs.
  slots.deleteCall = (b, id) =>
    void deleteFromPage(b, { id, title: b.store.getState().entities.call[id]?.title ?? "" }, () =>
      dispatch({ type: "move", move: { type: "replace", route: { section: "library", key: "root" } } }),
    );
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewport, setViewport] = useState(() => globalThis.innerWidth ?? 1280);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrolls = useRef(createScrollMemory());

  // each read picks one slice, so a change elsewhere in the store does not re-render the frame
  const useWhole = <K extends WholeName>(k: K) => useWindow(bridge, (s) => s.whole[k]);
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-core-event
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-apply
  // The bridge applies each event with the version rule (keeps the highest `version`); the frame only reads the slices.
  const setup = useWhole("setup");
  const capture = useWhole("capture");
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-mode:p1:inst-core-privacy
  const privacy = useWhole("privacy");
  const degraded = useWhole("degraded");
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-mode:p1:inst-core-privacy
  const proposals = useWhole("proposals");
  const banners = useWhole("banners");
  const presenting = useWhole("presenting");
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-apply
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-core-event
  const nav = useWindow(bridge, (s) => s.nav);
  const snapshotApplied = useWindow(bridge, (s) => s.app !== null);
  const slow = useWindow(bridge, (s) => s.slow);
  const updateInstall = useWindow(bridge, (s) => s.commands["update_install"]);
  const commands = useWindow(bridge, (s) => s.commands);

  const shellRef = useRef(shell);
  shellRef.current = shell;
  const route = currentRoute(shell.history);
  const page = pageFor(route.section, route);
  const routeId = `${route.section}/${route.key}`;

  // Zoom: the layout width the page sees is the window width divided by the zoom (CSS zoom scales every length),
  // which is the width `collapse()` takes; zoom itself only feeds its sidebar rule.
  const zoom = shell.zoom / 100;
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-resize:p1:inst-user-resize
  // The window's width comes from the browser (resizing); zoom and the sidebar come from the shortcuts below.
  useEffect(() => watchWidth(window, setViewport), []);
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-resize:p1:inst-user-resize
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-resize:p1:inst-collapse
  const layout = layoutFor(
    {
      windowWidth: viewport / zoom,
      zoom: shell.zoom,
      sidebarWidth: shell.sidebarWidth,
      inspectorWidth: shell.history.inspectorOpen && page.inspector ? page.inspector.width : null,
      need: page.need ?? NO_NEED,
    },
    !shell.sidebar,
  );
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-resize:p1:inst-collapse
  // A page with a default inspector (Call info) docks it open on arrival at Wide width; it stays closed as an overlay.
  const wide = layout.inspector !== "overlay";
  useEffect(() => void (page.inspector?.openByDefault && wide && dispatch({ type: "open-inspector" })), [routeId, wide]); // eslint-disable-line react-hooks/exhaustive-deps
  const overlay = layout.sidebar === "overlay";
  const sidebarShown = overlay ? shell.overlayOpen : shell.sidebar;

  // @cpt-begin:cpt-noter-flow-ui-core-bridge-act:p1:inst-user-acts
  // Every control of the frame runs its command through the bridge's act(): WAITING, then DONE or the named error.
  const run = useCallback(<T,>(cmd: CommandName, f: () => Promise<Result<T>>, into?: WholeName) => void bridge.act(cmd, cmd, f, { screen: "main-window-shell", slice: into }), [bridge]);
  // @cpt-end:cpt-noter-flow-ui-core-bridge-act:p1:inst-user-acts
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-api-banner
  // a dismissal the core refused answers false, so the slot shows the banner again (the failure shows as its own banner)
  const dismissBanner = useCallback(async (banner: BannerKind) => (await bridge.act("banner_dismiss", "banner_dismiss", () => bridge.core.bannerDismiss({ banner }), { screen: "main-window-shell", slice: "banners" })).status === "ok", [bridge]);
  const navigate = useCallback((target: NavTarget) => run("window_navigate", () => bridge.core.windowNavigate({ target })), [bridge, run]);

  // @cpt-end:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-api-banner

  const act = useCallback(
    (a: ShellAction) => {
      const e = actionEvent(a, overlay, !!pageFor(currentRoute(shellRef.current.history).section, currentRoute(shellRef.current.history)).inspector);
      if (e) return dispatch(e);
      if (a.type === "open-settings") return navigate({ type: "settings", pane: "general" });
      setSearchOpen(true);
      void setTimeout(() => document.getElementById("mw-search")?.focus());
    },
    [overlay, navigate],
  );
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-navigate:p1:inst-user-nav
  const shortcuts = useMemo(() => ({ ...shellShortcuts(act), Escape: () => dispatch(escapeEvent(shellRef.current.history)) }), [act]);
  useWindowShortcuts(shortcuts);
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-navigate:p1:inst-user-nav

  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-if-nav
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-nav-request
  // A navigation request of the core (the Call page loaded in the background after a stop) shows its page without
  // moving focus: the heading is not focused for it, and the core decides whether the window activates.
  const flags = useRef<NavFlags>({ first: true, quiet: null });
  useEffect(() => navEffect(nav, flags.current, dispatch), [nav]);
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-nav-request
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-if-nav

  // The page's view state (scroll) comes back with Back and Forward.
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-navigate:p1:inst-render-page
  useLayoutEffect(() => scrollEffect(contentRef.current, scrolls.current, routeId), [routeId]);
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-navigate:p1:inst-render-page
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-navigate:p1:inst-focus-heading
  useEffect(() => focusEffect(flags.current, contentRef.current, routeId), [routeId]);
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-navigate:p1:inst-focus-heading

  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-if-capture
  const frame = frameState({ snapshotApplied, phase: capture?.phase ?? "idle", hidden: presenting?.hidden ?? false });
  const receivedAt = useMemo(() => Date.now(), [capture?.version]);
  const [now, setNow] = useState(() => Date.now());
  const recording = capture?.phase === "recording";
  useEffect(() => tickWhile(recording, setNow), [recording]);
  const live = capture && isLive(capture) ? { title: shortTitle(capture.title), paused: capture.phase === "paused", seconds: elapsedSeconds(capture, receivedAt, Math.max(now, receivedAt)) } : null;

  // @cpt-end:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-if-capture

  const mode = modeIndicator({ mode: privacy?.mode ?? "cloud_redacted", degraded: degraded?.states ?? [], sensitiveCall: false });
  const word = mode.warning || mode.state === "LOCAL_ONLY";
  const footer = word ? t(MODE_MSG[mode.state].word) : live ? t("footer.recording", { name: live.title }) : t("footer.idle");

  const bannerActions: BannerActions = {
    runSelfTest: () => navigate({ type: "first_run", step: "permissions" }),
    finishSetup: () => navigate({ type: "first_run" }),
    // @cpt-begin:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-if-banner-action
    restartNow: () => run("update_install", () => bridge.core.updateInstall({})),
    openCall: (id) => navigate({ type: "call_page", call_id: id, tab: "summary" }),
    resumeRecording: (id) => run("capture_resume_interrupted", () => bridge.core.captureResumeInterrupted({ call_id: id })),
    // @cpt-end:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-if-banner-action
    restart: { loading: updateInstall?.state === "WAITING", tryAgain: updateInstall?.state === "ERROR" && updateInstall.error?.tryAgain === true },
    retry: (key) => void bridge.retry(key),
  };
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-if-banners
  const bannerList = appBanners({ banners, setup }, bannerActions, commandFailures(commands));
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-if-banners

  const inspector = shell.history.inspectorOpen ? page.inspector : undefined;
  const subtitle = page.subtitle?.(route);
  const classes = ["np-win", "np-win--main", !sidebarShown && "no-sidebar", overlay && "is-sidebar-collapsed"].filter(Boolean).join(" ");

  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-return-frame
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-resize:p1:inst-apply-width
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-resize:p1:inst-return-reflow
  return (
    <div className={classes} style={zoomStyle(shell.zoom)} data-component="cpt-noter-component-shell-main-window" data-state={frame.toLowerCase()} data-width={layout.widthClass} data-collapse={layout.step}>
      {sidebarShown && (
        <>
          <Sidebar
            // @cpt-begin:cpt-noter-flow-ui-main-window-shell-navigate:p1:inst-mark-section
            selected={route.section}
            waiting={proposals?.waiting ?? 0}
            problems={proposals?.needs_attention ?? 0}
            live={live}
            mode={mode}
            footer={footer}
            overlay={overlay}
            width={shell.sidebarWidth}
            onSelect={(section) => act({ type: "section", section })}
            onShowCall={() => run("window_show_call", () => bridge.core.windowShowCall({}))}
            onToggle={() => act({ type: "toggle-sidebar" })}
            onOpenPrivacy={() => navigate({ type: "settings", pane: "privacy" })}
          />
          {overlay ? (
            <div className="np-sidebar-scrim" aria-hidden="true" onClick={() => dispatch({ type: "close-overlay" })} />
          ) : (
            <SplitDivider value={shell.sidebarWidth} min={SIDEBAR.min} max={SIDEBAR.max} step={10} label={t("shell.resize_sidebar")} onChange={(width) => dispatch({ type: "resize-sidebar", width })} onCollapse={() => act({ type: "toggle-sidebar" })} />
          )}
        </>
      )}
      <div className="np-main">
        <ToolbarHost
          page={page}
          route={route}
          bridge={bridge}
          inspectorOpen={shell.history.inspectorOpen}
          onToggleInspector={() => act({ type: "toggle-inspector" })}
          title={page.title(route)}
          subtitle={subtitle}
          actions={page.actions ?? []}
          hasSearch={page.search !== false}
          narrow={layout.widthClass === "narrow"}
          canBack={shell.history.index > 0}
          canForward={shell.history.index < shell.history.entries.length - 1}
          // @cpt-end:cpt-noter-flow-ui-main-window-shell-navigate:p1:inst-mark-section
          showToggle={!sidebarShown}
          search={search}
          searchOpen={searchOpen}
          onBack={() => act({ type: "back" })}
          onForward={() => act({ type: "forward" })}
          onToggleSidebar={() => act({ type: "toggle-sidebar" })}
          onSearch={setSearch}
          onRunSearch={(q) => dispatch({ type: "move", move: { type: "push", route: searchRoute(q.trim()) } })}
          onOpenSearch={() => act({ type: "focus-search" })}
        />
        {/* @cpt-begin:cpt-noter-state-ui-main-window-shell-banner-slot:p1:inst-empty-one */}
        {/* @cpt-begin:cpt-noter-state-ui-main-window-shell-banner-slot:p1:inst-one-several */}
        {/* @cpt-begin:cpt-noter-state-ui-main-window-shell-banner-slot:p1:inst-several-one */}
        {/* @cpt-begin:cpt-noter-state-ui-main-window-shell-banner-slot:p1:inst-one-empty */}
        <BannerSlot banners={bannerList} region="MW-R5" onDismiss={(id) => (isBannerKind(id) ? dismissBanner(id) : undefined)} />
        {/* @cpt-end:cpt-noter-state-ui-main-window-shell-banner-slot:p1:inst-one-empty */}
        {/* @cpt-end:cpt-noter-state-ui-main-window-shell-banner-slot:p1:inst-several-one */}
        {/* @cpt-end:cpt-noter-state-ui-main-window-shell-banner-slot:p1:inst-one-several */}
        {/* @cpt-end:cpt-noter-state-ui-main-window-shell-banner-slot:p1:inst-empty-one */}
        {page.banners && <page.banners route={route} bridge={bridge} appBanners={bannerList.length} />}
        <div className="np-body">
          <div ref={contentRef} className="np-content" data-region="MW-R3" role="main" tabIndex={0} aria-label={page.title(route)} data-width={layout.widthClass} data-grid={layout.grid} data-columns={layout.columns}>
            {/* @cpt-begin:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-skeleton */}
            {frame === "LOADING" && slow ? (
              <div className="np-skel" role="status" aria-label={t("shell.loading")}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} className="np-skel__row" />
                ))}
              </div>
            ) : (
              <div className="np-screen" data-state={frame === "LOADING" ? "loading" : undefined}>
                {/* @cpt-begin:cpt-noter-flow-ui-main-window-shell-navigate:p1:inst-return-page */}
                {page.render(route, bridge)}
                {/* @cpt-end:cpt-noter-flow-ui-main-window-shell-navigate:p1:inst-return-page */}
              </div>
            )}
            {/* @cpt-end:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-skeleton */}
          </div>
          <InspectorSlot def={inspector} route={route} bridge={bridge} overlay={layout.inspector === "overlay"} onClose={() => dispatch({ type: "close-inspector" })} />
        </div>
      </div>
    </div>
  );
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-resize:p1:inst-return-reflow
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-resize:p1:inst-apply-width
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-return-frame
}
