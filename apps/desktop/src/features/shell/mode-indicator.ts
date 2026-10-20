import type { DegradedState, PrivacyMode } from "../../core/bindings";

export type ModeState = "CLOUD" | "CLOUD_REDACTED" | "LOCAL_ONLY" | "SENSITIVE_LOCAL" | "SWITCHED_TO_LOCAL" | "NO_ASSISTANT";

export interface ModeInput {
  mode: PrivacyMode;
  /** The `degraded:changed` set. */
  degraded: readonly DegradedState[];
  /** The call in view is sensitive (call surfaces only). */
  sensitiveCall: boolean;
}

export interface ModeView {
  state: ModeState;
  /** The indicator's word (the prototype's `MODE_TEXT` keys). */
  word: string;
  /** Degraded: the warning glyph and word. */
  warning: boolean;
}

const BY_MODE: Record<PrivacyMode, ModeView> = {
  cloud_allowed: { state: "CLOUD", word: "Cloud", warning: false },
  cloud_redacted: { state: "CLOUD_REDACTED", word: "Cloud, redacted", warning: false },
  local_only: { state: "LOCAL_ONLY", word: "Local only", warning: false },
};

// @cpt-state:cpt-noter-state-ui-main-window-shell-mode-indicator:p1
export function modeIndicator({ mode, degraded, sensitiveCall }: ModeInput): ModeView {
  const has = (type: DegradedState["type"]) => degraded.some((d) => d.type === type);
  // @cpt-begin:cpt-noter-state-ui-main-window-shell-mode-indicator:p1:inst-redacted-none
  if (has("no_assistant")) return { state: "NO_ASSISTANT", word: "No assistant", warning: true };
  // @cpt-end:cpt-noter-state-ui-main-window-shell-mode-indicator:p1:inst-redacted-none
  // @cpt-begin:cpt-noter-state-ui-main-window-shell-mode-indicator:p1:inst-redacted-switched
  if (has("switched_to_local")) return { state: "SWITCHED_TO_LOCAL", word: "Switched to local", warning: true };
  // @cpt-end:cpt-noter-state-ui-main-window-shell-mode-indicator:p1:inst-redacted-switched
  // @cpt-begin:cpt-noter-state-ui-main-window-shell-mode-indicator:p1:inst-redacted-sensitive
  if (sensitiveCall) return { state: "SENSITIVE_LOCAL", word: "Sensitive · local", warning: false };
  // @cpt-end:cpt-noter-state-ui-main-window-shell-mode-indicator:p1:inst-redacted-sensitive
  // The mode the user chose answers when nothing degrades: Cloud allowed, Local only, or back to Cloud, redacted
  // once the degraded state clears or a key, an account or a local runtime becomes available.
  // @cpt-begin:cpt-noter-state-ui-main-window-shell-mode-indicator:p1:inst-redacted-cloud
  // @cpt-begin:cpt-noter-state-ui-main-window-shell-mode-indicator:p1:inst-redacted-local
  // @cpt-begin:cpt-noter-state-ui-main-window-shell-mode-indicator:p1:inst-switched-redacted
  // @cpt-begin:cpt-noter-state-ui-main-window-shell-mode-indicator:p1:inst-none-redacted
  return BY_MODE[mode];
  // @cpt-end:cpt-noter-state-ui-main-window-shell-mode-indicator:p1:inst-none-redacted
  // @cpt-end:cpt-noter-state-ui-main-window-shell-mode-indicator:p1:inst-switched-redacted
  // @cpt-end:cpt-noter-state-ui-main-window-shell-mode-indicator:p1:inst-redacted-local
  // @cpt-end:cpt-noter-state-ui-main-window-shell-mode-indicator:p1:inst-redacted-cloud
}
