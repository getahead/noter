// The record prompt (docs/features/ui/record-prompt.md, DESIGN › Screen — Record prompt): the small panel the core
// shows without activating Noter. RP-R1 holds the app icon, the title and the source line; RP-R3 the buttons of
// the variant. It never takes focus: the core places it and ⌃⌥⌘R is the core's hotkey.
import { useEffect, useReducer, useRef, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { Icon } from "../../ui/icons";
import { IconButton } from "../../ui/primitives/icon-button";
import { Menu, type MenuItem } from "../../ui/primitives/menu";
import { Popover } from "../../ui/primitives/popover";
import { PullDownButton } from "../../ui/primitives/pull-down-button";
import { PushButton } from "../../ui/primitives/push-button";
import { leaveTimer, tickWhile } from "../shell/shell-effects";
import { announce, answerCallEnd, answerNewMeeting, dismiss, holdNotice, ignoreApp, openDeleteOldAudio, openSystemSettings, startRecording } from "./actions";
import { activeRefusal, chooseView, countdownSeconds, createPromptTimer, INITIAL_LOCAL, isBrowser, isHeld, localReduce, meetingTitle, modelPercent, sourceLine, viewKey, type PromptTimer } from "./logic";
import "./record-prompt.css";

// @cpt-begin:cpt-noter-flow-ui-record-prompt-missed-prompt:p1:inst-fade
const FADE_MS = 200;
/** The fade is 200 ms, and none under Reduce motion. */
const fadeMs = (): number => (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : FADE_MS);
// @cpt-end:cpt-noter-flow-ui-record-prompt-missed-prompt:p1:inst-fade

/** **Not Now ▾**: close for now, or stop being asked for this app. */
// @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-if-dont-ask
export const notNowItems = (app: string, notNow: () => void, dontAsk: () => void): MenuItem[] => [
  { label: t("prompt.not_now"), onSelect: notNow },
  { divider: true },
  { label: t("prompt.dont_ask", { app }), onSelect: dontAsk },
];
// @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-if-dont-ask

// @cpt-component:cpt-noter-component-ui-record-prompt:p1
export function RecordPrompt({ bridge }: { bridge: Bridge }) {
  const [local, dispatch] = useReducer(localReduce, INITIAL_LOCAL);
  const held = isHeld(local);
  const panel = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<PromptTimer | null>(null);
  const setup = useWindow(bridge, (s) => s.whole.setup);
  const presenting = useWindow(bridge, (s) => s.whole.presenting);
  const capture = useWindow(bridge, (s) => s.whole.capture) ?? null;
  const detection = useWindow(bridge, (s) => s.whole.detection)?.detection ?? null;
  const env = useWindow(bridge, (s) => s.whole.environment);

  const notice = capture?.notice ?? null;
  const key = viewKey(detection, notice);
  // what a refusal was made in: it clears when the free space, the model or the core's reason changes
  const world = `${env?.disk_free_mb}/${detection?.blocked}/${setup?.models.bundles.map((b) => b.state).join()}`;
  const refusal = activeRefusal(local, world);
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-choose-variant
  const view = chooseView({
    setupComplete: setup?.complete ?? false,
    presenting: presenting?.hidden ?? false,
    capture,
    detection,
    dontAsk: local.dontAsk,
    systemAudioOff: env?.permissions.find((p) => p.kind === "system_audio")?.state === "denied",
    refused: refusal?.reason ?? null,
    held,
  });
  // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-choose-variant
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-missed-prompt:p1:inst-return-dismiss
  const shown = view !== null && key !== null && local.gone !== key;
  // @cpt-end:cpt-noter-flow-ui-record-prompt-missed-prompt:p1:inst-return-dismiss

  // a prompt that is over (the core cleared it) is forgotten, so the next one is drawn
  useEffect(() => void (key === null && dispatch({ type: "reset" })), [key]);
  // the fade lasts 200 ms, then the prompt is gone until the core's next one
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-missed-prompt:p1:inst-fade
  useEffect(() => leaveTimer(local.closing !== null, () => dispatch({ type: "gone" }), fadeMs()), [local.closing]);
  // @cpt-end:cpt-noter-flow-ui-record-prompt-missed-prompt:p1:inst-fade

  // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-render
  const variant = view?.variant;
  const announceKey = shown ? `${key}:${variant}` : null;
  useEffect(() => {
    if (!announceKey || !variant) return;
    // @cpt-begin:cpt-noter-flow-ui-record-prompt-notice:p1:inst-render-notice
    if (variant === "call-ended") void announce(bridge, t("prompt.announce_ended"), "assertive");
    else if (variant === "new-meeting") void announce(bridge, t("prompt.announce_meeting", { title: meetingTitle(notice) }), "assertive");
    // @cpt-end:cpt-noter-flow-ui-record-prompt-notice:p1:inst-render-notice
    else void announce(bridge, t("prompt.announce_appears"), "polite");
  }, [announceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-render

  // @cpt-begin:cpt-noter-flow-ui-record-prompt-missed-prompt:p1:inst-user-dismiss
  const close = (reason?: "not_now" | "closed" | "timed_out") => {
    if (!key) return;
    if (reason && detection) void dismiss(bridge, detection.id, reason);
    dispatch({ type: "closing", key });
  };
  // @cpt-end:cpt-noter-flow-ui-record-prompt-missed-prompt:p1:inst-user-dismiss

  // the 15 s the prompt waits: it runs for a detection with its buttons showing, and stops while the pointer or focus is on it
  const timed = shown && !!detection && variant !== "call-ended" && variant !== "new-meeting" && view.state !== "not-a-call";
  useEffect(() => {
    if (!timed) return;
    const t0 = createPromptTimer(15_000, () => close("timed_out"));
    timer.current = t0;
    return () => t0.stop();
  }, [timed, key]); // eslint-disable-line react-hooks/exhaustive-deps
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-missed-prompt:p1:inst-while-hover
  useEffect(() => (held ? timer.current?.pause() : timer.current?.resume()), [held]);
  // @cpt-end:cpt-noter-flow-ui-record-prompt-missed-prompt:p1:inst-while-hover

  // @cpt-begin:cpt-noter-flow-ui-record-prompt-notice:p1:inst-while-notice-hover
  // the core holds the call-ended countdown while the pointer or focus is on the panel
  const callId = capture?.call_id ?? null;
  const sentHold = useRef(false);
  useEffect(() => {
    if (variant !== "call-ended" || !callId || sentHold.current === held) return;
    sentHold.current = held;
    void holdNotice(bridge, callId, held);
  }, [held, variant, callId]); // eslint-disable-line react-hooks/exhaustive-deps
  // where the pointer is, read from every move: an enter or leave the browser dispatches late must not leave the panel held
  useEffect(() => {
    const where = (e: MouseEvent) => dispatch({ type: "pointer", on: !!panel.current?.contains(e.target as Node) });
    document.addEventListener("mousemove", where);
    return () => document.removeEventListener("mousemove", where);
  }, []);
  // @cpt-end:cpt-noter-flow-ui-record-prompt-notice:p1:inst-while-notice-hover
  const counting = variant === "call-ended" && view?.state === "countdown-running";
  useEffect(() => tickWhile(counting, setNow), [counting]);

  if (!shown || !view || !variant) return null;

  // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-user-record
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-return-start
  const record = async (sensitive: boolean) => {
    if (!detection) return;
    const r = await startRecording(bridge, detection, sensitive);
    // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-if-refused
    // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-refused
    if (!r.ok && (r.reason === "disk_full" || r.reason === "model_missing")) return dispatch({ type: "refused", reason: r.reason, ...(r.freeMb !== undefined ? { freeMb: r.freeMb } : {}), at: world });
    // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-refused
    // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-if-refused
    // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-if-already
    // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-already
    // started, or already running: the core shows the running call
    // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-already
    // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-if-already
    // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-close-open
    dispatch({ type: "closing", key: key! });
    // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-close-open
  };
  // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-return-start
  // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-user-record

  const root = {
    "data-component": "cpt-noter-component-ui-record-prompt",
    "data-variant": variant,
    "data-state": view.state,
    className: local.closing ? "rp-panel is-closing" : "rp-panel",
    role: "dialog",
    ref: panel,
    // an enter the browser dispatches after the pointer already left (a layout change under it) must not hold the panel
    onMouseEnter: (e: { currentTarget: Element }) => e.currentTarget.matches(":hover") && dispatch({ type: "pointer", on: true }),
    onMouseLeave: () => dispatch({ type: "pointer", on: false }),
    onFocus: () => dispatch({ type: "focus", on: true }),
    onBlur: () => dispatch({ type: "focus", on: false }),
  } as const;

  if (variant === "call-ended" && callId) {
    const at = notice?.type === "call_ended" || notice?.type === "call_seems_ended" ? notice.stops_at : null;
    const secs = countdownSeconds(at, now);
    const paused = view.state === "countdown-paused";
    return (
      <div {...root} aria-label={t("prompt.ended_title")}>
        <div className="rp-r1" data-region="RP-R1">
          <div className="rp-r1__text">
            <div className="rp-title">{t("prompt.ended_title")}</div>
            <div className="rp-sub">
              {t("prompt.ended_body", { app: detection?.app_name ?? capture?.title ?? "" })} {paused || secs === null ? t("prompt.ended_paused") : <span className="np-tnum">{t("prompt.ended_stopping", { seconds: secs })}</span>}
            </div>
            <div className="rp-countdown" aria-hidden="true">
              <span style={{ width: `${(secs ?? 10) * 10}%` }} />
            </div>
          </div>
        </div>
        {/* @cpt-begin:cpt-noter-flow-ui-record-prompt-notice:p1:inst-user-notice */}
        {/* @cpt-begin:cpt-noter-flow-ui-record-prompt-notice:p1:inst-return-notice */}
        {/* @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-ended-closing */}
        <div className="rp-r3" data-region="RP-R3">
          <PushButton label={t("prompt.stop_now")} onAction={() => void answerCallEnd(bridge, callId, "stop_now").then(() => close())} />
          <span className="np-tb__spacer" />
          <PushButton label={t("prompt.keep_recording")} variant="primary" onAction={() => void answerCallEnd(bridge, callId, "keep_recording").then(() => close())} />
        </div>
        {/* @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-ended-closing */}
        {/* @cpt-end:cpt-noter-flow-ui-record-prompt-notice:p1:inst-return-notice */}
        {/* @cpt-end:cpt-noter-flow-ui-record-prompt-notice:p1:inst-user-notice */}
      </div>
    );
  }

  if (variant === "new-meeting" && callId) {
    return (
      <div {...root} aria-label={t("prompt.meeting_title", { title: meetingTitle(notice) })}>
        <div className="rp-r1" data-region="RP-R1">
          <div className="rp-r1__text">
            <div className="rp-title">{t("prompt.meeting_title", { title: meetingTitle(notice) })}</div>
            <div className="rp-sub">{t("prompt.meeting_body", { call: capture?.title ?? "" })}</div>
          </div>
        </div>
        {/* @cpt-begin:cpt-noter-flow-ui-record-prompt-notice:p1:inst-user-notice */}
        {/* @cpt-begin:cpt-noter-flow-ui-record-prompt-notice:p1:inst-return-notice */}
        {/* @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-newmeeting-closing */}
        <div className="rp-r3" data-region="RP-R3">
          <PushButton label={t("prompt.meeting_keep")} onAction={() => void answerNewMeeting(bridge, callId, "keep_in_this_call").then(() => close())} />
          <span className="np-tb__spacer" />
          <PushButton label={t("prompt.meeting_new")} variant="primary" onAction={() => void answerNewMeeting(bridge, callId, "start_as_new_call").then(() => close())} />
        </div>
        {/* @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-newmeeting-closing */}
        {/* @cpt-end:cpt-noter-flow-ui-record-prompt-notice:p1:inst-return-notice */}
        {/* @cpt-end:cpt-noter-flow-ui-record-prompt-notice:p1:inst-user-notice */}
      </div>
    );
  }

  if (!detection) return null;
  const app = detection.app_name;
  const browser = isBrowser(detection.bundle_id);
  const notNow = (
    <>
      <PullDownButton id="rp-notnow" label={t("prompt.not_now")} variant="panel" open={menu !== null} onAction={() => setMenu(menu ? null : globalThis.document?.getElementById("rp-notnow") ?? null)} />
      {menu && (
        <Popover variant="item-menu" anchor={menu} label={t("prompt.not_now")} onClose={() => setMenu(null)}>
          <Menu items={notNowItems(app, () => close("not_now"), () => dispatch({ type: "dont-ask" }))} onClose={() => setMenu(null)} />
        </Popover>
      )}
    </>
  );
  const recordKey = <PushButton label={t("prompt.record")} variant="primary" kbd="⌃⌥⌘R" disabled={view.state === "disabled"} onAction={() => void record(false)} />;
  const reason = (text: string) => (
    <div className="rp-reason">
      <Icon name="warning" size={13} />
      <span>{text}</span>
    </div>
  );
  let actions;
  if (view.state === "not-a-call") {
    // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-inline-confirm
    actions = (
      <div className="rp-inline" role="group" aria-label={t("prompt.dont_ask", { app })}>
        <p>{browser ? t("prompt.browser_line", { app }) : t("prompt.app_line", { app })}</p>
        <div className="rp-inline__btns">
          <PushButton label={t("prompt.back")} onAction={() => dispatch({ type: "back" })} />
          {/* @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-notacall-closing */}
          <PushButton
            label={t("prompt.dont_ask_action")}
            variant="primary"
            onAction={() => void ignoreApp(bridge, detection).then(() => close())}
          />
          {/* @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-notacall-closing */}
        </div>
      </div>
    );
    // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-inline-confirm
  } else if (variant === "model-missing") {
    actions = (
      <>
        {reason(t("prompt.model_missing", { percent: modelPercent(setup?.models.bundles.find((b) => b.required_for_capture)) ?? 0 }))}
        <div className="rp-btnrow">
          {notNow}
          <span className="np-tb__spacer" />
          {recordKey}
        </div>
      </>
    );
  } else if (variant === "disk-full") {
    actions = (
      <>
        {reason(t("prompt.disk_full", { free: refusal?.freeMb ?? env?.disk_free_mb ?? 0 }))}
        <div className="rp-btnrow">
          {notNow}
          {/* @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-if-delete-old */}
          <PushButton label={t("prompt.delete_old")} onAction={() => void openDeleteOldAudio(bridge)} />
          {/* @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-if-delete-old */}
          <span className="np-tb__spacer" />
          {recordKey}
        </div>
      </>
    );
  } else if (variant === "system-audio-off") {
    actions = (
      <>
        {reason(t("prompt.sys_off"))}
        <div className="rp-btnrow">
          {notNow}
          {/* @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-if-open-settings */}
          <PushButton label={t("prompt.open_settings")} onAction={() => void openSystemSettings(bridge)} />
          {/* @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-if-open-settings */}
          <span className="np-tb__spacer" />
          {recordKey}
        </div>
      </>
    );
  } else {
    actions = (
      <div className="rp-btnrow">
        {notNow}
        <PushButton label={t("prompt.record_sensitive")} onAction={() => void record(true)} />
        <span className="np-tb__spacer" />
        {recordKey}
      </div>
    );
  }
  return (
    <div {...root} aria-label={t("prompt.title")}>
      <div className="rp-r1" data-region="RP-R1">
        <span className="rp-appicon" aria-hidden="true">
          <Icon name={browser ? "globe" : "people"} size={20} />
        </span>
        <div className="rp-r1__text">
          <div className="rp-title">{t("prompt.title")}</div>
          <div className="rp-sub">{sourceLine(detection)}</div>
        </div>
        <IconButton icon="x" label={t("prompt.close")} size="inline" onAction={() => close("closed")} />
      </div>
      <div className="rp-r3 rp-r3--stack" data-region="RP-R3">
        {actions}
      </div>
    </div>
  );
}
