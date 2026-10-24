// The capture notice (C.captureNotice of the prototype's src/js/20-b-components.js) in the notice slot
// CS-R0 / FP-R0, and the closing state after any stop (closingView of src/js/20-b-surface.js).
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { CaptureNotice as Notice } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Icon, type IconName } from "../../ui/icons";
import { cx } from "../../ui/primitives/attrs";
import { LevelMeter } from "../../ui/primitives/level-meter";
import { PushButton } from "../../ui/primitives/push-button";

type Variant = "call-ended" | "new-meeting" | "nothing-heard" | "stopped-automatically" | "stopped-by-you";
type Tone = "info" | "warning" | "success";

function NoticeFrame(p: {
  variant: Variant;
  state: string;
  tone: Tone;
  icon: IconName;
  title: string;
  floating: boolean;
  body?: ReactNode;
  actions: ReactNode;
  extra?: ReactNode;
  hold?: (held: boolean) => void;
}) {
  const hold = p.hold;
  return (
    <div
      data-component="cpt-noter-component-ui-capture-notice"
      data-variant={p.variant}
      data-state={p.state}
      className={cx("cw-notice", `cw-notice--${p.tone}`, p.floating && "is-floating")}
      role="alertdialog"
      aria-label={p.title}
      onMouseEnter={hold && (() => hold(true))}
      onMouseLeave={hold && (() => hold(false))}
      onFocus={hold && (() => hold(true))}
      // focus moving between the notice's own buttons is not a release
      onBlur={hold && ((e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && hold(false))}
    >
      <span className="cw-notice__icon">
        <Icon name={p.icon} size={18} />
      </span>
      <div className="cw-notice__main">
        <div className="cw-notice__title">{p.title}</div>
        {p.body && <div className="cw-notice__body">{p.body}</div>}
      </div>
      <div className="cw-notice__actions">{p.actions}</div>
      {p.extra}
    </div>
  );
}

export interface NoticeHandlers {
  keepRecording: () => void;
  stopNow: () => void;
  hold: (held: boolean) => void;
  startNewCall: () => void;
  keepInCall: () => void;
  keepNothingHeard: () => void;
  discard: () => void;
}

export interface CaptureNoticeProps {
  notice: Notice;
  floating: boolean;
  /** Seconds until the call-ended countdown stops capture (`null` while held). */
  seconds: number | null;
  /** The new meeting's start, as hh:mm. */
  detectedAt: string;
  /** 0–10 segments of the You and Others meters (nothing-heard). */
  levels: { mic: number; sys: number };
  on: NoticeHandlers;
}

// @cpt-component:cpt-noter-component-ui-capture-notice:p1
export function CaptureNotice({ notice: n, floating, seconds, detectedAt, levels, on }: CaptureNoticeProps) {
  const [confirming, setConfirming] = useState(false);
  const actions = useRef<HTMLSpanElement>(null);
  // the inline confirmation has no default button: focus waits on Back (D38)
  useEffect(() => void (confirming && actions.current?.parentElement?.querySelector<HTMLElement>('[data-back="true"]')?.focus()), [confirming]);
  const size = floating ? "regular" : "large";
  switch (n.type) {
    case "call_ended":
    case "call_seems_ended": {
      // @cpt-begin:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-while-hold
      // @cpt-begin:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-api-hold
      const held = seconds === null;
      const body = (
        <>
          {t("cw.notice.call_ended_since")} {held ? <b>{t("cw.notice.held")}</b> : <span className="np-tnum">{t("cw.notice.stopping", { seconds })}</span>}
        </>
      );
      // @cpt-end:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-api-hold
      // @cpt-end:cpt-noter-flow-ui-call-window-stop-at-call-end:p1:inst-while-hold
      return (
        <NoticeFrame
          variant="call-ended"
          state={held ? "countdown-paused" : "countdown-running"}
          tone="warning"
          icon="stop"
          title={t("cw.notice.call_ended")}
          floating={floating}
          body={body}
          hold={n.type === "call_ended" ? on.hold : undefined}
          actions={
            <>
              <PushButton label={t("cw.notice.keep_recording")} variant="primary" size={size} onAction={on.keepRecording} />
              <PushButton label={t("cw.notice.stop_now")} size={size} onAction={on.stopNow} />
            </>
          }
          extra={
            !held && (
              <div className="cw-notice__bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (seconds / 10) * 100)}%` }} />
              </div>
            )
          }
        />
      );
    }
    case "new_meeting":
      return (
        <NoticeFrame
          variant="new-meeting"
          state="default"
          tone="info"
          icon="calendar"
          title={n.event ? t("cw.notice.new_meeting", { title: n.event.title }) : t("cw.notice.new_meeting_untitled")}
          floating={floating}
          body={
            n.app_name
              ? t("cw.notice.new_meeting_body", {
                  app: n.app_name,
                  time: detectedAt,
                })
              : undefined
          }
          actions={
            <>
              <PushButton label={t("cw.notice.start_new")} variant="primary" size={size} onAction={on.startNewCall} />
              <PushButton label={t("cw.notice.keep_in_call")} size={size} onAction={on.keepInCall} />
            </>
          }
        />
      );
    case "nothing_heard":
      return (
        <NoticeFrame
          variant="nothing-heard"
          state={confirming ? "confirming-discard" : "default"}
          tone="warning"
          icon="warning"
          title={t("cw.notice.nothing_heard")}
          floating={floating}
          body={
            <span className="cw-meters">
              <span>{t("cw.notice.you")}</span>
              <LevelMeter level={levels.mic} label={t("cw.notice.mic_level")} />
              <span>{t("cw.notice.others")}</span>
              <LevelMeter level={levels.sys} label={t("cw.notice.call_level")} />
            </span>
          }
          actions={
            // @cpt-begin:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-nothing-heard
            confirming ? (
              <>
                <span ref={actions} className="cw-notice__confirm">
                  {t("cw.notice.discard_confirm")}
                </span>
                <PushButton label={t("cw.notice.discard")} variant="destructive" size={size} onAction={on.discard} />
                <PushButton label={t("cw.notice.back")} size={size} attrs={{ "data-back": "true" }} onAction={() => setConfirming(false)} />
              </>
            ) : (
              <>
                <PushButton label={t("cw.notice.discard_recording")} size={size} onAction={() => setConfirming(true)} />
                <PushButton label={t("cw.notice.keep_recording")} variant="quiet" size={size} onAction={on.keepNothingHeard} />
              </>
            )
            // @cpt-end:cpt-noter-flow-ui-call-window-recover-capture:p1:inst-nothing-heard
          }
        />
      );
    default:
      return null; // stopped_automatically is the closing state's
  }
}

export interface ClosingProps {
  title: { auto: boolean; text: string };
  floating: boolean;
  /** **Continue Recording** is offered until the core says the window closed. */
  canContinue: boolean;
  continuing: boolean;
  onContinue: () => void;
  onOpen: () => void;
  onClose: () => void;
}

/** The whole window for 10 s after any stop: the stopped notice and the line under it. */
export function ClosingState({ title, floating, canContinue, continuing, onContinue, onOpen, onClose }: ClosingProps) {
  const size = floating ? "regular" : "large";
  return (
    <div className={cx("cw-closing", floating && "is-floating")}>
      <NoticeFrame
        variant={title.auto ? "stopped-automatically" : "stopped-by-you"}
        state="default"
        tone="success"
        icon="checkCircle"
        title={title.text}
        floating={floating}
        actions={
          <>
            {canContinue && <PushButton label={t("cw.continue")} size={size} loading={continuing} onAction={onContinue} />}
            <PushButton label={t("cw.open_in_noter")} variant="primary" size={size} onAction={onOpen} />
            {!title.auto && <PushButton label={t("cw.close")} size={size} onAction={onClose} />}
          </>
        }
      />
      {/* @cpt-begin:cpt-noter-algo-ui-call-window-closing-state:p1:inst-closing-line */}
      <p className="np-dim cw-closing__hint">{t("cw.closing.line")}</p>
      {/* @cpt-end:cpt-noter-algo-ui-call-window-closing-state:p1:inst-closing-line */}
    </div>
  );
}
