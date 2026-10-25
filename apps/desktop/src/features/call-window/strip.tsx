// The call window's small components of the prototype's src/js/04-shared.js and 20-b-components.js:
// C.recordingIndicator, C.personChip (call-window variants), C.callStatusStrip and C.collapsedCallStrip.
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { SpeakerView } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import { InlineStatus } from "../../ui/feedback/inline-status";
import type { StatusVariant } from "../../ui/feedback/status-timer";
import { Icon } from "../../ui/icons";
import { cx } from "../../ui/primitives/attrs";
import { IconButton } from "../../ui/primitives/icon-button";
import { Menu, type MenuItem } from "../../ui/primitives/menu";
import { Popover } from "../../ui/primitives/popover";
import { PushButton } from "../../ui/primitives/push-button";
import type { ModeView } from "../shell/mode-indicator";
import { ModeIndicator } from "../shell/mode-indicator-view";
import type { IndicatorStatus } from "./model";

const WORD: Record<IndicatorStatus, MsgKey> = {
  recording: "cw.indicator.recording",
  paused: "cw.indicator.paused",
  "mic-only": "cw.indicator.mic_only",
  "no-mic": "cw.indicator.no_mic",
  "not-recording": "cw.indicator.not_recording",
  stopped: "cw.indicator.stopped",
};

// @cpt-component:cpt-noter-component-ui-recording-indicator:p1
/** The dot (with its word as the image label) or the dot and word; the clock follows when given. */
export function RecordingIndicator({ variant, status, clock }: { variant: "dot" | "dot-text"; status: IndicatorStatus; clock?: string }) {
  const word = t(WORD[status]);
  const live = status !== "stopped" && status !== "not-recording";
  const dot = live && (
    <span className={cx("np-recdot", status === "paused" && "is-paused")} aria-hidden="true">
      {(status === "mic-only" || status === "no-mic") && <Icon name="warning" size={9} />}
    </span>
  );
  const root = {
    "data-component": "cpt-noter-component-ui-recording-indicator",
    "data-variant": variant,
    "data-state": status,
  };
  if (variant === "dot")
    return (
      <span {...root} className="np-recind np-recind--dot" role="img" aria-label={word}>
        {/* with no dot to draw (Not recording, Stopped) the word stands in for it */}
        {dot || <span className="np-recind__word">{word}</span>}
        {clock && <span className="np-tnum">{clock}</span>}
      </span>
    );
  return (
    <span {...root} className="np-recind np-recind--text">
      {dot}
      <span className={cx("np-recind__word", live && "is-rec")}>{word}</span>
      {clock && live && <span className="np-tnum">{clock}</span>}
    </span>
  );
}

// @cpt-component:cpt-noter-component-ui-person-chip:p1
// @cpt-dod:cpt-noter-dod-ui-call-window-person-chip:p1
/** A participant of the live call in CS-R1: **You**, a named person, or an unnamed **Speaker 3** (renaming is M2). */
export function PersonChip({ speaker }: { speaker: SpeakerView }) {
  const l = speaker.label;
  const [variant, initials, name] =
    l.type === "you"
      ? ["you", "Y", t("cw.speaker.you")]
      : l.type === "person"
        ? ["call-window", l.person.initials, l.person.short_name]
        : l.type === "unnamed"
          ? ["unnamed", "?", t("cw.speaker.unnamed", { n: l.n })]
          : ["unnamed", "?", t("cw.speaker.guest")];
  return (
    <span
      data-component="cpt-noter-component-ui-person-chip"
      data-variant={variant}
      className={cx("np-person np-person--cw", variant === "unnamed" && "is-secondary")}
      title={l.type === "person" ? l.person.display_name : undefined}
    >
      <span className="np-person__ini" aria-hidden="true">
        {initials}
      </span>{" "}
      <span className="np-person__name">{name}</span>{" "}
    </span>
  );
}

/** The ⋯ pull-down of the header and the compact strip: an icon button that opens an item menu under it. */
export function MoreMenu({ items, size = "toolbar" }: { items: MenuItem[]; size?: "toolbar" | "inline" }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const close = () => setAnchor(null);
  return (
    <span ref={ref} className="cw-more">
      <IconButton
        icon="ellipsis"
        label={t("cw.more")}
        size={size}
        attrs={{
          "data-primitive": "pull-down-button",
          "aria-haspopup": "menu",
          "aria-expanded": String(anchor !== null),
        }}
        // a click does not focus a button in WebKit: anchor on the button itself
        onAction={() => setAnchor(anchor ? null : (ref.current?.querySelector("button") ?? null))}
      />
      {anchor && (
        <Popover variant="item-menu" anchor={anchor} align="end" label={t("cw.more")} onClose={close}>
          <Menu items={items} label={t("cw.more")} onClose={close} />
        </Popover>
      )}
    </span>
  );
}

export interface Feedback {
  text: string;
  variant: StatusVariant;
}

export interface StripProps {
  variant: "dedicated" | "compact";
  status: IndicatorStatus;
  clock: string;
  mode: ModeView;
  /** Hotkey caps by control, such as ⌃⌥⌘M. */
  keys: { mark: string; pause: string; stop: string };
  /** Mark Moment's inline status, **Marked 00:21:08**, for 2 s. */
  marked: string | null;
  busy: { pause: boolean; stop: boolean; mark: boolean; retry: boolean };
  feedback: Feedback | null;
  onFeedbackExpire: () => void;
  onMark: () => void;
  onPause: (paused: boolean) => void;
  onStop: () => void;
  onRetry: () => void;
}

// @cpt-component:cpt-noter-component-ui-call-status-strip:p1
/** CS-R5 (dedicated) and FP-R6 (compact) in the copilot-off variant: no budget, **Pinned** or **Catch Me Up**. */
export function CallStatusStrip(p: StripProps) {
  const stopped = p.status === "stopped";
  const failed = p.status === "not-recording";
  const paused = p.status === "paused";
  const state = stopped ? "stopped" : failed ? "engine-stopped" : paused ? "paused" : "recording";
  const fb = p.feedback && <InlineStatus key={p.feedback.text} text={p.feedback.text} variant={p.feedback.variant} onExpire={p.onFeedbackExpire} />;
  const mode = <ModeIndicator view={p.mode} variant="floating" />;
  if (p.variant === "compact") {
    const items: MenuItem[] = failed
      ? [{ label: t("action.try_again"), onSelect: p.onRetry }]
      : [
          {
            label: t(paused ? "cw.resume" : "cw.pause"),
            kbd: p.keys.pause || undefined,
            onSelect: () => p.onPause(!paused),
          },
          {
            label: t("cw.stop"),
            kbd: p.keys.stop || undefined,
            onSelect: p.onStop,
          },
        ];
    return (
      <div data-component="cpt-noter-component-ui-call-status-strip" data-variant="copilot-off" data-state={state} className="cw-strip cw-strip--compact">
        {fb && <div className="cw-strip__fb">{fb}</div>}
        <div className="cw-strip__row">
          {!stopped && (
            <PushButton
              label={t("cw.mark")}
              size="small"
              help={p.keys.mark ? t("cw.mark_help", { key: p.keys.mark }) : undefined}
              loading={p.busy.mark}
              flash={p.marked ?? undefined}
              onAction={p.onMark}
            />
          )}
          {!stopped && <MoreMenu items={items} size="inline" />}
          {stopped && <RecordingIndicator variant="dot-text" status={p.status} />}
          <span className="np-tb__spacer" />
          {mode}
        </div>
      </div>
    );
  }
  return (
    <div data-component="cpt-noter-component-ui-call-status-strip" data-variant="copilot-off" data-state={state} data-region="CS-R5" className="cw-strip cw-strip--dedicated">
      <span className="cw-strip__clock t-title2 np-tnum">{p.clock}</span>
      <RecordingIndicator variant="dot-text" status={p.status} />
      {mode}
      <span className="cw-strip__fb">{fb}</span>
      <span className="np-tb__spacer" />
      {stopped ? null : failed ? (
        <PushButton label={t("action.try_again")} variant="primary" loading={p.busy.retry} onAction={p.onRetry} />
      ) : (
        <>
          <PushButton label={t("cw.mark")} kbd={p.keys.mark || undefined} loading={p.busy.mark} flash={p.marked ?? undefined} onAction={p.onMark} />
          <PushButton
            label={t(paused ? "cw.resume" : "cw.pause")}
            kbd={p.keys.pause || undefined}
            variant={paused ? "primary" : "secondary"}
            loading={p.busy.pause}
            onAction={() => p.onPause(!paused)}
          />
          {/* 16 pt from Pause, so a slip does not end the recording */}
          <span className="cw-strip__gap" />
          <PushButton label={t("cw.stop")} kbd={p.keys.stop || undefined} icon="stop" cls="cw-stop" loading={p.busy.stop} onAction={p.onStop} />
        </>
      )}
    </div>
  );
}

// @cpt-component:cpt-noter-component-ui-collapsed-call-strip:p1
/** FP-C1 (dot, clock or **Paused 3 min**, mode glyph) and FP-C3 (**Expand Panel**); copilot off: no FP-C2 and no count badge. */
export function CollapsedCallStrip({ status, clock, pausedFor, mode, onExpand }: { status: IndicatorStatus; clock: string; pausedFor: number | null; mode: ModeView; onExpand: () => void }) {
  // Return or Space on the strip expands it, like the button
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    onExpand();
  };
  const state: ReactNode =
    pausedFor !== null ? (
      <>
        <RecordingIndicator variant="dot" status="paused" />
        <span className="np-tnum">{t("cw.paused_for", { count: pausedFor })}</span>
      </>
    ) : (
      <RecordingIndicator variant="dot" status={status} clock={clock} />
    );
  return (
    <div
      data-component="cpt-noter-component-ui-collapsed-call-strip"
      data-variant={pausedFor !== null ? "paused" : "copilot-off"}
      data-state="default"
      className="cw-cstrip"
      tabIndex={0}
      role="group"
      aria-label={t("cw.strip")}
      onKeyDown={onKeyDown}
    >
      <div className="cw-cstrip__state" data-region="FP-C1">
        {state}
        <ModeIndicator view={mode} variant="glyph" />
      </div>
      <div className="cw-cstrip__ctl" data-region="FP-C3">
        <IconButton icon="chevronDown" label={t("cw.expand")} onAction={onExpand} />
      </div>
    </div>
  );
}
