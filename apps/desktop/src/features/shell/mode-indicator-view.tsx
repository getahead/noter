// The mode indicator (C.modeIndicator) and its explanation popover (overlay 'mode-info') of the prototype's
// src/js/04-shared.js: glyph and word, never colour alone, the warning form for the two degraded modes.
import { useState } from "react";

import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import { Icon, type IconName } from "../../ui/icons";
import { cx } from "../../ui/primitives/attrs";
import { Popover } from "../../ui/primitives/popover";
import { PushButton } from "../../ui/primitives/push-button";
import type { ModeState, ModeView } from "./mode-indicator";

export type ModeVariant = "call-header" | "floating" | "glyph" | "sidebar" | "ask" | "call-info" | "settings" | "menu-line";

interface ModeMsg {
  word: MsgKey;
  voice: MsgKey;
  text: MsgKey;
  icon: IconName;
}

export const MODE_MSG: Record<ModeState, ModeMsg> = {
  CLOUD: { word: "mode.cloud", voice: "mode.voice.cloud", text: "mode.text.cloud", icon: "cloud" },
  CLOUD_REDACTED: { word: "mode.cloud_redacted", voice: "mode.voice.cloud_redacted", text: "mode.text.cloud_redacted", icon: "cloudLock" },
  LOCAL_ONLY: { word: "mode.local_only", voice: "mode.voice.local_only", text: "mode.text.local_only", icon: "laptop" },
  SENSITIVE_LOCAL: { word: "mode.sensitive_local", voice: "mode.voice.sensitive_local", text: "mode.text.sensitive_local", icon: "lock" },
  SWITCHED_TO_LOCAL: { word: "mode.switched_to_local", voice: "mode.voice.switched_to_local", text: "mode.text.switched_to_local", icon: "warning" },
  NO_ASSISTANT: { word: "mode.no_assistant", voice: "mode.voice.no_assistant", text: "mode.text.no_assistant", icon: "warning" },
};

export interface ModeIndicatorProps {
  view: ModeView;
  variant?: ModeVariant;
  /** The line the host shows in place of the word (the sidebar footer's **Idle · API key · local fallback ready**). */
  text?: string;
  /** The runtime name, for the variants that have one. */
  runtime?: string;
  onOpenPrivacy?: () => void;
  /** Call window: **Make This Call Sensitive** (M1). Call page: **Mark as Sensitive** (M2). */
  onMakeSensitive?: () => void;
  onMarkSensitive?: () => void;
}

/** overlay('mode-info'): the mode's explanation with **Open Privacy Settings**, and the call surfaces' own action. */
export function ModeInfo({ view, variant, anchor, onClose, onOpenPrivacy, onMakeSensitive, onMarkSensitive }: Pick<ModeIndicatorProps, "view" | "onOpenPrivacy" | "onMakeSensitive" | "onMarkSensitive"> & { variant: ModeVariant; anchor: HTMLElement; onClose: () => void }) {
  const m = MODE_MSG[view.state];
  const word = t(m.word);
  return (
    <Popover variant="mode-info" anchor={anchor} width={340} label={word} onClose={onClose}>
      <div className="np-pop__body">
        <div className="np-pop__title">
          <Icon name={m.icon} size={14} /> {word}
        </div>
        <p className="np-pop__text">{t(m.text)}</p>
        <div className="np-pop__actions">
          {(variant === "call-header" || variant === "floating") && <PushButton label={t("mode.make_sensitive")} size="small" onAction={onMakeSensitive} />}
          {variant === "call-info" && <PushButton label={t("mode.mark_sensitive")} size="small" onAction={onMarkSensitive} />}
          {variant !== "settings" && (
            <PushButton
              label={t("mode.open_privacy")}
              size="small"
              variant="quiet"
              onAction={() => {
                onClose();
                onOpenPrivacy?.();
              }}
            />
          )}
        </div>
      </div>
    </Popover>
  );
}

// @cpt-component:cpt-noter-component-ui-mode-indicator:p1
// @cpt-flow:cpt-noter-flow-ui-main-window-shell-mode:p1
// @cpt-dod:cpt-noter-dod-ui-main-window-shell-mode-indicator:p1
export function ModeIndicator({ view, variant = "sidebar", text, runtime, onOpenPrivacy, onMakeSensitive, onMarkSensitive }: ModeIndicatorProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const m = MODE_MSG[view.state];
  const word = t(m.word);
  const root = { "data-component": "cpt-noter-component-ui-mode-indicator", "data-variant": variant, "data-state": view.warning ? "degraded" : "normal" };
  const label = text ?? (runtime ? `${runtime} · ${word}` : word);
  if (variant === "menu-line")
    return (
      <span {...root} className="np-mode np-mode--line">
        {label}
      </span>
    );
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-mode:p1:inst-return-mode
  // Esc closes the popover and focus returns to the indicator (the popover primitive restores it to its anchor).
  const close = () => setAnchor(null);
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-mode:p1:inst-return-mode
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-mode:p1:inst-render-mode
  return (
    <>
      <button
        type="button"
        {...root}
        className={cx("np-mode", `np-mode--${variant}`, view.warning && "is-warn")}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        aria-label={t("mode.label", { mode: t(m.voice) })}
        title={t("mode.help", { mode: word })}
        // @cpt-begin:cpt-noter-flow-ui-main-window-shell-mode:p1:inst-user-mode
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        // @cpt-end:cpt-noter-flow-ui-main-window-shell-mode:p1:inst-user-mode
      >
        <Icon name={m.icon} size={13} />
        {variant !== "glyph" && <span className="np-mode__word">{label}</span>}
      </button>
      {/* @cpt-end:cpt-noter-flow-ui-main-window-shell-mode:p1:inst-render-mode */}
      {/* @cpt-begin:cpt-noter-flow-ui-main-window-shell-mode:p1:inst-mode-popover */}
      {anchor && <ModeInfo view={view} variant={variant} anchor={anchor} onClose={close} onOpenPrivacy={onOpenPrivacy} onMakeSensitive={onMakeSensitive} onMarkSensitive={onMarkSensitive} />}
      {/* @cpt-end:cpt-noter-flow-ui-main-window-shell-mode:p1:inst-mode-popover */}
    </>
  );
}

