// Shell — Call window with its dedicated layout (Screen — Call screen) and floating layout (Screen —
// Floating panel, collapsed strip) as surface('call') of the prototype's src/js/20-b-surface.js draws them in
// the Copilot flag off state (M1). One tree and one store for both layouts: the core places, shows, hides and
// keys the panel and sends `window:call`; the window renders the layout it names and sends wanted state.
import "./call-window.css";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { announcerFor, writeLive } from "../../app/a11y/announce";
import type { ActOptions, Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { CallLayoutPreference, CaptureState, CommandArgs, CommandName, DegradedState, HotkeyAction, NavTarget, PermissionKind, Result } from "../../core/bindings";
import { callTime, quote, t } from "../../i18n/format";
import { BannerSlot, InlineBanner } from "../../ui/feedback/inline-banner";
import { Icon } from "../../ui/icons";
import { cx } from "../../ui/primitives/attrs";
import { IconButton } from "../../ui/primitives/icon-button";
import type { MenuItem } from "../../ui/primitives/menu";
import { dbToLevel } from "../first-run/self-test";
import { capsOf } from "../settings/accelerator";
import { elapsedSeconds } from "../shell/live-row";
import { modeIndicator } from "../shell/mode-indicator";
import { tickWhile } from "../shell/shell-effects";
import { captureAnnouncements, captureView, closingTitle, degradedBanners, failureAnnouncements, indicatorStatus, layoutRegions, layoutState, pausedMinutes, stopped, windowState, type BannerHandlers, type Seen } from "./model";
import { CaptureNotice, ClosingState, type NoticeHandlers } from "./notice";
import { CallStatusStrip, CollapsedCallStrip, MoreMenu, PersonChip, RecordingIndicator, type Feedback } from "./strip";
import { TranscriptSlot } from "./transcript-slot";

const NO_STATES: readonly DegradedState[] = [];
const NO_IDS: ReadonlySet<string> = new Set();
const DEFAULT_KEYS: Partial<Record<HotkeyAction, string>> = {
  mark_moment: "⌃⌥⌘M",
  pause: "⌃⌥⌘P",
  start_stop: "⌃⌥⌘R",
  hide_for_presenting: "⌃⌥⌘0",
};
const live = (c: CaptureState | undefined) => !!c && (c.phase === "recording" || c.phase === "paused" || c.phase === "failed");
const hhmm = (ms: number) =>
  new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ms);

/** Keep one Channel open while `on` holds: snapshot then stream; the cleanup ends it. */
export function subscribeWhile<K extends "transcript_subscribe" | "levels_subscribe">(bridge: Bridge, on: boolean, cmd: K, args: CommandArgs[K]): (() => void) | undefined {
  if (!on) return undefined;
  void bridge.subscribe(cmd, args);
  return () => void bridge.unsubscribe(cmd);
}

// @cpt-component:cpt-noter-component-shell-call-window:p1
// @cpt-component:cpt-noter-component-screen-call-screen:p1
// @cpt-component:cpt-noter-component-screen-floating-panel:p1
// @cpt-dod:cpt-noter-dod-ui-call-window-shell:p1
// @cpt-dod:cpt-noter-dod-ui-call-window-capture:p1
// @cpt-dod:cpt-noter-dod-ui-call-window-degraded:p1
// @cpt-flow:cpt-noter-flow-ui-call-window-recover-capture:p1
// @cpt-flow:cpt-noter-flow-ui-call-window-stop-at-call-end:p1
// @cpt-flow:cpt-noter-flow-ui-call-window-hide-for-presenting:p1
// @cpt-flow:cpt-noter-flow-ui-call-window-display-change:p1
// @cpt-flow:cpt-noter-flow-ui-call-window-collapse:p1
// @cpt-flow:cpt-noter-flow-ui-call-window-hide-reopen:p1
// @cpt-flow:cpt-noter-flow-ui-call-window-controls:p1
// @cpt-algo:cpt-noter-algo-ui-call-window-closing-state:p1
export function CallWindow({ bridge }: { bridge: Bridge }) {
  // @cpt-begin:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-core-degraded
  // @cpt-begin:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-core-notice
  // @cpt-begin:cpt-noter-flow-ui-call-window-display-change:p1:inst-core-display
  // @cpt-begin:cpt-noter-flow-ui-call-window-display-change:p1:inst-store-window
  // @cpt-begin:cpt-noter-flow-ui-call-window-hide-for-presenting:p1:inst-store-presenting
  // The core sends capture:state, degraded:changed, window:call and app:presenting whole; the bridge keeps
  // the newest of each in this window's store, beside the transcript, so a layout switch or a hide loses nothing.
  const cap = useWindow(bridge, (s) => s.whole.capture);
  const degraded = useWindow(bridge, (s) => s.whole.degraded?.states) ?? NO_STATES;
  // @cpt-begin:cpt-noter-flow-ui-call-window-hide-reopen:p1:inst-user-reopen
  // @cpt-begin:cpt-noter-flow-ui-call-window-hide-reopen:p1:inst-core-show
  const cw = useWindow(bridge, (s) => s.whole.callWindow);
  // @cpt-end:cpt-noter-flow-ui-call-window-hide-reopen:p1:inst-core-show
  // @cpt-end:cpt-noter-flow-ui-call-window-hide-reopen:p1:inst-user-reopen
  // @cpt-begin:cpt-noter-flow-ui-call-window-hide-for-presenting:p1:inst-core-hide
  // @cpt-begin:cpt-noter-flow-ui-call-window-hide-for-presenting:p1:inst-user-show
  // @cpt-begin:cpt-noter-flow-ui-call-window-hide-for-presenting:p1:inst-return-present
  const presenting = useWindow(bridge, (s) => s.whole.presenting?.hidden ?? false);
  // @cpt-end:cpt-noter-flow-ui-call-window-hide-for-presenting:p1:inst-return-present
  // @cpt-end:cpt-noter-flow-ui-call-window-hide-for-presenting:p1:inst-user-show
  // @cpt-end:cpt-noter-flow-ui-call-window-hide-for-presenting:p1:inst-core-hide
  // @cpt-end:cpt-noter-flow-ui-call-window-hide-for-presenting:p1:inst-store-presenting
  // @cpt-end:cpt-noter-flow-ui-call-window-display-change:p1:inst-store-window
  // @cpt-end:cpt-noter-flow-ui-call-window-display-change:p1:inst-core-display
  // @cpt-end:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-core-notice
  // @cpt-end:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-core-degraded
  const privacy = useWindow(bridge, (s) => s.whole.privacy?.mode ?? "cloud_redacted");
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const displays = useWindow(bridge, (s) => s.whole.environment?.displays.length ?? 1);
  const hotkeys = useWindow(bridge, (s) => s.whole.hotkeys?.bindings);
  const commands = useWindow(bridge, (s) => s.commands);
  const transcript = useWindow(bridge, (s) => s.streams.transcript_subscribe?.data);
  const levels = useWindow(bridge, (s) => s.streams.levels_subscribe?.data?.levels);

  // the second sources the user kept, for one call
  const [kept, setKept] = useState<{ call: string | null; ids: ReadonlySet<string> }>({ call: null, ids: new Set() });
  const [marked, setMarked] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [continueClosed, setContinueClosed] = useState<string | null>(null);
  const [warningSeen, setWarningSeen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const callId = cap?.call_id ?? null;
  const notice = cap && !stopped(cap) && cap.notice?.type !== "stopped_automatically" ? cap.notice : null;
  // @cpt-begin:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-if-hidden
  // @cpt-begin:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-return-hidden
  // Hidden by the user or for presenting: the record prompt or the menu bar shows the notice instead.
  const noticeShown = notice && cw?.visible && !presenting ? notice : null;
  // @cpt-end:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-return-hidden
  // @cpt-end:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-if-hidden

  // @cpt-begin:cpt-noter-flow-ui-call-window-hide-reopen:p1:inst-if-crash
  // @cpt-begin:cpt-noter-flow-ui-call-window-hide-reopen:p1:inst-crash-restore
  // A new WebView (first open, or after a crash) reads the snapshot (the bridge), then the window state, then the transcript.
  useEffect(() => void bridge.act("window_call_state", "window_call_state", () => bridge.core.windowCallState({}), { slice: "callWindow" }), [bridge]);
  const transcriptFor = cw && callId && live(cap) ? callId : null;
  useEffect(() => subscribeWhile(bridge, transcriptFor !== null, "transcript_subscribe", { call_id: transcriptFor! }), [bridge, transcriptFor]);
  // @cpt-end:cpt-noter-flow-ui-call-window-hide-reopen:p1:inst-crash-restore
  // @cpt-end:cpt-noter-flow-ui-call-window-hide-reopen:p1:inst-if-crash
  // The You and Others meters of the nothing-heard notice.
  const meters = noticeShown?.type === "nothing_heard";
  useEffect(() => subscribeWhile(bridge, meters, "levels_subscribe", { call_id: callId }), [bridge, meters, callId]);

  const receivedAt = useMemo(() => Date.now(), [cap?.version]);
  const ticking = cap?.phase === "recording" || cap?.phase === "paused" || (noticeShown?.type === "call_ended" && noticeShown.stops_at !== null);
  useEffect(() => tickWhile(ticking, setNow), [ticking]);

  // @cpt-begin:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-announce-failure
  // @cpt-begin:cpt-noter-flow-ui-call-window-controls:p1:inst-store-capture
  // The call window is usually not key, so the core speaks for it (native announcement); once per occurrence.
  const announce = useMemo(
    () =>
      announcerFor(bridge, {
        isKey: () => bridge.store.getState().whole.callWindow?.key ?? false,
        live: writeLive(globalThis.document),
      }),
    [bridge],
  );
  useEffect(() => failureAnnouncements(degraded, callId).forEach((a) => void announce(a)), [announce, degraded, callId]);
  const prev = useRef<Seen | null>(null);
  useEffect(() => {
    if (!cap) return;
    captureAnnouncements(prev.current, cap, noticeShown).forEach((a) => void announce(a));
    prev.current = { phase: cap.phase, notice: noticeShown?.type ?? null };
  }, [announce, cap, noticeShown]);
  // @cpt-end:cpt-noter-flow-ui-call-window-controls:p1:inst-store-capture
  // @cpt-end:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-announce-failure

  if (!cap || !cw || !callId) return null;
  const view = windowState(cw, presenting, cap);
  // @cpt-begin:cpt-noter-algo-ui-call-window-closing-state:p1:inst-auto-close
  if (view === "CLOSED") return null;
  // @cpt-end:cpt-noter-algo-ui-call-window-closing-state:p1:inst-auto-close

  /** A command of this window: WAITING until the core answers; a capture command's failure shows in the strip. */
  async function run<T>(cmd: CommandName, call: () => Promise<Result<T>>, opts: ActOptions = {}, strip = true): Promise<Result<T>> {
    const res = await bridge.act(cmd, cmd, call, opts);
    if (res.status === "error" && strip) setFeedback({ text: t("window.error"), variant: "notice" });
    return res;
  }
  const capture = { slice: "capture" } as const;
  const id = { call_id: callId };
  const navigate = (target: NavTarget) => void bridge.core.windowNavigate({ target });
  const openInNoter = () => navigate({ type: "call_page", call_id: callId, tab: "summary" });
  const busy = (cmd: CommandName) => commands[cmd]?.state === "WAITING";
  const key = (action: HotkeyAction) => {
    const b = hotkeys?.find((h) => h.action === action);
    return b ? capsOf(b.shortcut) : (DEFAULT_KEYS[action] ?? "");
  };

  // @cpt-begin:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-user-action
  // @cpt-begin:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-match-action
  const banners: BannerHandlers = {
    // @cpt-begin:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-case-exclude
    exclude: (bundle_id) => void run("capture_exclude_source", () => bridge.core.captureExcludeSource({ ...id, bundle_id }), capture),
    // @cpt-end:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-case-exclude
    // @cpt-begin:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-case-keep-source
    keep: (bundle_id) => {
      setKept((k) => ({ call: callId, ids: new Set(k.call === callId ? k.ids : []).add(bundle_id) })); // not shown again for that app in this call
      void run("capture_keep_source", () => bridge.core.captureKeepSource({ ...id, bundle_id }), capture);
    },
    // @cpt-end:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-case-keep-source
    // @cpt-begin:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-case-open
    openSettings: (permission: PermissionKind) =>
      void bridge.core.openExternal({
        target: { type: "system_settings", permission },
      }),
    // @cpt-end:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-case-open
    // @cpt-begin:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-case-retry
    retry: () => void run("capture_resume_interrupted", () => bridge.core.captureResumeInterrupted(id), capture),
    // @cpt-end:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-case-retry
    // @cpt-begin:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-case-delete-old
    // shortcut: Settings › Maintenance until NavTarget::DeleteOldAudio (D-17) is in the contract; then the main window's sheet.
    deleteOldAudio: () => navigate({ type: "settings", pane: "maintenance" }),
    // @cpt-end:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-case-delete-old
  };
  // @cpt-end:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-match-action
  // @cpt-end:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-user-action

  // @cpt-begin:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-user-answer
  const answers: NoticeHandlers = {
    keepRecording: () => void run("capture_answer_call_end", () => bridge.core.captureAnswerCallEnd({ ...id, choice: "keep_recording" }), capture),
    stopNow: () => void run("capture_answer_call_end", () => bridge.core.captureAnswerCallEnd({ ...id, choice: "stop_now" }), capture),
    hold: (held) => void run("capture_hold_notice", () => bridge.core.captureHoldNotice({ ...id, held }), capture, false),
    startNewCall: async () => {
      const saved = cap.title ?? "";
      const res = await run(
        "capture_answer_new_meeting",
        () =>
          bridge.core.captureAnswerNewMeeting({
            ...id,
            choice: "start_as_new_call",
          }),
        capture,
      );
      // @cpt-begin:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-if-new-call
      // @cpt-begin:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-new-call
      if (res.status === "ok" && res.data.call_id !== callId)
        setFeedback({
          text: t("cw.split", {
            saved: quote(saved, "und"),
            started: quote(res.data.title ?? "", "und"),
          }),
          variant: "blind",
        });
      // @cpt-end:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-new-call
      // @cpt-end:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-if-new-call
    },
    keepInCall: () =>
      void run(
        "capture_answer_new_meeting",
        () =>
          bridge.core.captureAnswerNewMeeting({
            ...id,
            choice: "keep_in_this_call",
          }),
        capture,
      ),
    keepNothingHeard: () => void run("capture_keep_recording", () => bridge.core.captureKeepRecording(id), capture),
    discard: () => void run("capture_discard", () => bridge.core.captureDiscard(id), capture),
  };
  // @cpt-end:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-user-answer

  // @cpt-begin:cpt-noter-flow-ui-call-window-controls:p1:inst-user-control
  // @cpt-begin:cpt-noter-flow-ui-call-window-controls:p1:inst-match-control
  // @cpt-begin:cpt-noter-flow-ui-call-window-controls:p1:inst-case-mark
  const mark = async () => {
    const res = await run("capture_mark_moment", () => bridge.core.captureMarkMoment(id));
    if (res.status !== "ok") return;
    setMarked(t("cw.marked", { time: callTime(res.data.at_ms / 1000) }));
    setTimeout(() => setMarked(null), 2000);
  };
  // @cpt-end:cpt-noter-flow-ui-call-window-controls:p1:inst-case-mark
  // @cpt-begin:cpt-noter-flow-ui-call-window-controls:p1:inst-case-pause
  const pause = (paused: boolean) => void run("capture_set_paused", () => bridge.core.captureSetPaused({ ...id, paused }), capture);
  // @cpt-end:cpt-noter-flow-ui-call-window-controls:p1:inst-case-pause
  // @cpt-begin:cpt-noter-flow-ui-call-window-controls:p1:inst-case-stop
  const stop = () => void run("capture_stop", () => bridge.core.captureStop(id), capture);
  // @cpt-end:cpt-noter-flow-ui-call-window-controls:p1:inst-case-stop
  // @cpt-begin:cpt-noter-flow-ui-call-window-controls:p1:inst-case-sensitive
  const makeSensitive = async () => {
    const res = await run("capture_set_sensitive", () => bridge.core.captureSetSensitive({ ...id, sensitive: true }), capture);
    if (res.status === "ok") setFeedback({ text: t("cw.sensitive_done"), variant: "blind" });
  };
  // @cpt-end:cpt-noter-flow-ui-call-window-controls:p1:inst-case-sensitive
  // @cpt-begin:cpt-noter-flow-ui-call-window-controls:p1:inst-case-layout
  // @cpt-begin:cpt-noter-flow-ui-call-window-display-change:p1:inst-user-switch
  // @cpt-begin:cpt-noter-flow-ui-call-window-display-change:p1:inst-api-layout
  const setLayout = (preference: CallLayoutPreference) => void run("window_set_call_layout", () => bridge.core.windowSetCallLayout({ preference }), { slice: "callWindow" }, false);
  // @cpt-end:cpt-noter-flow-ui-call-window-display-change:p1:inst-api-layout
  // @cpt-end:cpt-noter-flow-ui-call-window-display-change:p1:inst-user-switch
  // @cpt-end:cpt-noter-flow-ui-call-window-controls:p1:inst-case-layout
  // @cpt-end:cpt-noter-flow-ui-call-window-controls:p1:inst-match-control
  // @cpt-end:cpt-noter-flow-ui-call-window-controls:p1:inst-user-control
  // @cpt-begin:cpt-noter-flow-ui-call-window-collapse:p1:inst-user-collapse
  // @cpt-begin:cpt-noter-flow-ui-call-window-collapse:p1:inst-api-collapse
  const collapse = (collapsed: boolean) => void run("window_set_collapsed", () => bridge.core.windowSetCollapsed({ collapsed }), { slice: "callWindow" }, false);
  // @cpt-end:cpt-noter-flow-ui-call-window-collapse:p1:inst-api-collapse
  // @cpt-end:cpt-noter-flow-ui-call-window-collapse:p1:inst-user-collapse
  // @cpt-begin:cpt-noter-flow-ui-call-window-hide-reopen:p1:inst-user-hide-panel
  // @cpt-begin:cpt-noter-flow-ui-call-window-hide-reopen:p1:inst-api-hide-call
  const hide = () => void run("window_hide_call", () => bridge.core.windowHideCall({}), { slice: "callWindow" }, false);
  // @cpt-end:cpt-noter-flow-ui-call-window-hide-reopen:p1:inst-api-hide-call
  // @cpt-end:cpt-noter-flow-ui-call-window-hide-reopen:p1:inst-user-hide-panel
  // @cpt-begin:cpt-noter-flow-ui-call-window-hide-for-presenting:p1:inst-user-hide
  // @cpt-begin:cpt-noter-flow-ui-call-window-hide-for-presenting:p1:inst-api-hide
  const present = () => void run("app_set_hidden_for_presenting", () => bridge.core.appSetHiddenForPresenting({ hidden: true }), { slice: "presenting" }, false);
  // @cpt-end:cpt-noter-flow-ui-call-window-hide-for-presenting:p1:inst-api-hide
  // @cpt-end:cpt-noter-flow-ui-call-window-hide-for-presenting:p1:inst-user-hide
  // @cpt-begin:cpt-noter-algo-ui-call-window-closing-state:p1:inst-if-continue
  // @cpt-begin:cpt-noter-algo-ui-call-window-closing-state:p1:inst-api-continue
  const resume = async () => {
    const res = await run("capture_continue", () => bridge.core.captureContinue(id), { ...capture, named: { continue_window_closed: "closed" } }, false);
    // @cpt-begin:cpt-noter-algo-ui-call-window-closing-state:p1:inst-continue-closed
    if (res.status === "error" && res.error.code === "continue_window_closed") setContinueClosed(callId);
    // @cpt-end:cpt-noter-algo-ui-call-window-closing-state:p1:inst-continue-closed
  };
  // @cpt-end:cpt-noter-algo-ui-call-window-closing-state:p1:inst-api-continue
  // @cpt-end:cpt-noter-algo-ui-call-window-closing-state:p1:inst-if-continue

  const layout = layoutState(cw, !!noticeShown);
  const floating = layout !== "DEDICATED";
  const shareWarning = layout === "FLOATING" && cw.show_share_warning && !warningSeen;
  const bannerList = degradedBanners(degraded, callId, floating, banners, kept.call === callId ? kept.ids : NO_IDS);
  const regions = new Set(
    layoutRegions({
      layout,
      notice: !!noticeShown,
      banners: bannerList.length > 0 || shareWarning,
      replaying: false,
    }),
  );
  const status = indicatorStatus(cap, degraded);
  const clock = callTime(elapsedSeconds(cap, receivedAt, Math.max(now, receivedAt)));
  const mode = modeIndicator({
    mode: privacy,
    degraded,
    sensitiveCall: cap.sensitive,
  });
  const title = cap.title ?? "";
  const speakers = transcript?.call_id === callId ? transcript.speakers : [];
  const twoDisplays = displays > 1;

  // @cpt-begin:cpt-noter-flow-ui-call-window-controls:p1:inst-return-control
  const strip = (variant: "dedicated" | "compact") => (
    <CallStatusStrip
      variant={variant}
      status={status}
      clock={clock}
      mode={mode}
      keys={{
        mark: key("mark_moment"),
        pause: key("pause"),
        stop: key("start_stop"),
      }}
      marked={marked}
      busy={{
        pause: busy("capture_set_paused"),
        stop: busy("capture_stop"),
        mark: busy("capture_mark_moment"),
        retry: busy("capture_resume_interrupted"),
      }}
      feedback={feedback}
      onFeedbackExpire={() => setFeedback(null)}
      onMark={() => void mark()}
      onPause={pause}
      onStop={stop}
      onRetry={banners.retry}
    />
  );
  // @cpt-end:cpt-noter-flow-ui-call-window-controls:p1:inst-return-control
  const shareGlyph = (
    <span className="cw-shield" role="img" aria-label={t("cw.share_glyph")} title={t("cw.share_help")}>
      <Icon name="shield" size={15} />
    </span>
  );
  const hideForPresenting = (
    <IconButton icon="eyeSlash" label={t("cw.hide_presenting")} help={t("cw.hide_presenting_help", { key: key("hide_for_presenting") })} size={floating ? "inline" : "toolbar"} onAction={present} />
  );
  const moreItems: MenuItem[] = [
    {
      label: t("mode.make_sensitive"),
      disabled: cap.sensitive,
      onSelect: () => void makeSensitive(),
    },
    { divider: true },
    // @cpt-begin:cpt-noter-flow-ui-call-window-controls:p1:inst-case-open-noter
    { label: t("cw.open_in_noter"), onSelect: openInNoter },
    // @cpt-end:cpt-noter-flow-ui-call-window-controls:p1:inst-case-open-noter
    ...(layout === "DEDICATED"
      ? [{ label: t("cw.use_floating"), onSelect: () => setLayout("floating") }]
      : twoDisplays
        ? [
            {
              label: t("cw.open_call_screen"),
              onSelect: () => setLayout("auto"),
            },
          ]
        : []),
  ];
  const noticeSlot = noticeShown && (
    // @cpt-begin:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-show-notice
    // @cpt-begin:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-if-nothing
    // @cpt-begin:cpt-noter-flow-ui-call-window-collapse:p1:inst-if-notice-collapsed
    // @cpt-begin:cpt-noter-flow-ui-call-window-collapse:p1:inst-expand-notice
    <div className={floating ? "fp-r0" : "cs-r0"} data-region={floating ? "FP-R0" : "CS-R0"}>
      <CaptureNotice
        key={`${callId}:${noticeShown.type}`}
        notice={noticeShown}
        floating={floating}
        seconds={"stops_at" in noticeShown && noticeShown.stops_at !== null ? Math.max(0, Math.ceil((noticeShown.stops_at - now) / 1000)) : null}
        detectedAt={noticeShown.type === "new_meeting" ? hhmm(noticeShown.detected_at) : ""}
        levels={{
          mic: dbToLevel(levels?.mic_db ?? null),
          sys: dbToLevel(levels?.sys_db ?? null),
        }}
        on={answers}
      />
    </div>
    // @cpt-end:cpt-noter-flow-ui-call-window-collapse:p1:inst-expand-notice
    // @cpt-end:cpt-noter-flow-ui-call-window-collapse:p1:inst-if-notice-collapsed
    // @cpt-end:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-if-nothing
    // @cpt-end:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-show-notice
  );
  // @cpt-begin:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-map-degraded
  // @cpt-begin:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-show-banner
  // @cpt-begin:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-return-recover
  const bannerSlot = <BannerSlot banners={bannerList} />;
  // @cpt-end:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-return-recover
  // @cpt-end:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-show-banner
  // @cpt-end:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-map-degraded

  // @cpt-begin:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-if-stopped
  // @cpt-begin:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-closing
  // @cpt-begin:cpt-noter-algo-ui-call-window-closing-state:p1:inst-open-close
  // @cpt-begin:cpt-noter-algo-ui-call-window-closing-state:p1:inst-return-closing
  // @cpt-begin:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-return-stop
  const closing = view === "CLOSING" && (
    <ClosingState
      title={closingTitle(cap, prefs?.time_zone, prefs?.time_format === "h12")}
      floating={floating}
      canContinue={continueClosed !== callId && (cap.continue_until === null || cap.continue_until > now)}
      continuing={busy("capture_continue")}
      onContinue={() => void resume()}
      onOpen={openInNoter}
      onClose={hide}
    />
  );
  // @cpt-end:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-return-stop
  // @cpt-end:cpt-noter-algo-ui-call-window-closing-state:p1:inst-return-closing
  // @cpt-end:cpt-noter-algo-ui-call-window-closing-state:p1:inst-open-close
  // @cpt-end:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-closing
  // @cpt-end:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-if-stopped

  const state = view === "CLOSING" ? "closing" : captureView(cap, degraded).toLowerCase().replace(/_/g, "-");
  // @cpt-begin:cpt-noter-flow-ui-call-window-display-change:p1:inst-render-layout
  // @cpt-begin:cpt-noter-flow-ui-call-window-display-change:p1:inst-return-display
  let body;
  if (layout === "DEDICATED")
    body = (
      <div className="cs is-copilot-off" data-component="cpt-noter-component-screen-call-screen" data-variant="copilot-off" data-state={state}>
        {closing ? (
          <div className="cs-cols cs--closing">{closing}</div>
        ) : (
          <>
            {regions.has("CS-R0") && noticeSlot}
            <div className="cs-cols">
              <div className="cs-left">
                <header className="cs-r1" data-region="CS-R1" aria-label={t("cw.header")}>
                  <div className="cs-r1__line">
                    <RecordingIndicator variant="dot" status={status} />
                    <h2 className="cs-title t-title2" title={title}>
                      {title}
                    </h2>
                    <span className="np-tb__spacer" />
                    {shareGlyph}
                    {hideForPresenting}
                    <MoreMenu items={moreItems} />
                  </div>{" "}
                  <div className="cs-r1__line cs-r1__people">
                    {speakers.map((s) => (
                      <PersonChip key={s.id} speaker={s} />
                    ))}
                  </div>
                </header>
                {regions.has("CS-R3") && (
                  <div className="cs-r3" data-region="CS-R3">
                    {bannerSlot}
                  </div>
                )}
                <div className="cs-r2" data-region="CS-R2" aria-label={t("cw.transcript")}>
                  <TranscriptSlot bridge={bridge} callId={callId} />
                </div>
              </div>
            </div>
          </>
        )}
        {strip("dedicated")}
      </div>
    );
  else if (layout === "COLLAPSED")
    body = (
      // @cpt-begin:cpt-noter-flow-ui-call-window-collapse:p1:inst-render-strip
      // @cpt-begin:cpt-noter-flow-ui-call-window-collapse:p1:inst-return-collapse
      <CollapsedCallStrip status={status} clock={clock} pausedFor={cap.phase === "paused" && cap.pause ? pausedMinutes(cap.pause, now) : null} mode={mode} onExpand={() => collapse(false)} />
      // @cpt-end:cpt-noter-flow-ui-call-window-collapse:p1:inst-return-collapse
      // @cpt-end:cpt-noter-flow-ui-call-window-collapse:p1:inst-render-strip
    );
  else {
    // a double-click on the header collapses the panel; one on its buttons does not
    const onHeaderDouble = (e: MouseEvent) => !(e.target as Element).closest?.("button") && collapse(true);
    body = (
      <div className="fp" data-component="cpt-noter-component-screen-floating-panel" data-variant="copilot-off" data-state={state}>
        {closing || (
          <>
            <header className="fp-r1" data-region="FP-R1" aria-label={t("cw.panel_header")} onDoubleClick={onHeaderDouble}>
              <RecordingIndicator variant="dot" status={status} />
              <span className="fp-title" title={title}>
                {title}
              </span>
              <span className="np-tnum fp-clock">{clock}</span>
              {shareGlyph}
              {twoDisplays && <IconButton icon="displays" label={t("cw.move_display")} size="inline" onAction={() => setLayout("auto")} />}
              {hideForPresenting}
              <MoreMenu items={moreItems} size="inline" />
              <IconButton icon="chevronUp" label={t("cw.collapse")} size="inline" onAction={() => collapse(true)} />
              {/* @cpt-begin:cpt-noter-flow-ui-call-window-hide-reopen:p1:inst-return-reopen */}
              <IconButton icon="x" label={t("cw.hide")} help={t("cw.hide_help")} size="inline" onAction={hide} />
              {/* @cpt-end:cpt-noter-flow-ui-call-window-hide-reopen:p1:inst-return-reopen */}
            </header>
            {regions.has("FP-R0") && noticeSlot}
            {regions.has("FP-R3") && (
              <div className="fp-r3" data-region="FP-R3">
                {bannerSlot}
                {/* @cpt-begin:cpt-noter-flow-ui-call-window-hide-for-presenting:p1:inst-if-warning */}
                {shareWarning && (
                  // shortcut: Got It hides the warning for this window only until window_share_warning_seen (D-18) is in the contract.
                  <InlineBanner
                    banner={{
                      id: "share-warning",
                      severity: "info",
                      compact: true,
                      dismissible: false,
                      text: t("cw.banner.share_warning", {
                        key: key("hide_for_presenting"),
                      }),
                      actions: [
                        {
                          label: t("cw.banner.got_it"),
                          onAction: () => setWarningSeen(true),
                        },
                      ],
                    }}
                  />
                )}
                {/* @cpt-end:cpt-noter-flow-ui-call-window-hide-for-presenting:p1:inst-if-warning */}
              </div>
            )}
            <div className="fp-r5 fp-r5--full" data-region="FP-R5" aria-label={t("cw.transcript")}>
              <TranscriptSlot bridge={bridge} callId={callId} tailLines={8} />
            </div>
          </>
        )}
        <footer className="fp-r6" data-region="FP-R6">
          {strip("compact")}
        </footer>
      </div>
    );
  }
  return (
    <div
      className={cx("np-win cw-win", floating ? "cw-win--floating" : "cw-win--dedicated", layout === "COLLAPSED" && "is-collapsed")}
      data-component="cpt-noter-component-shell-call-window"
      data-variant={layout.toLowerCase()}
      data-state={view.toLowerCase().replace(/_/g, "-")}
    >
      {body}
    </div>
  );
  // @cpt-end:cpt-noter-flow-ui-call-window-display-change:p1:inst-return-display
  // @cpt-end:cpt-noter-flow-ui-call-window-display-change:p1:inst-render-layout
}
