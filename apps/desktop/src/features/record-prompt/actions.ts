import type { Bridge } from "../../app/bridge/bridge";
import type { CallDetection, CallEndChoice, DismissReason, NewMeetingChoice, Politeness } from "../../core/bindings";
import { t } from "../../i18n/format";

/** The native announcement the panel posts; VoiceOver reads it while the panel keeps no focus. */
// @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-api-announce
export const announce = (bridge: Bridge, text: string, politeness: Politeness) => bridge.core.windowAnnounce({ text, politeness });
// @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-api-announce

// @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-api-fit
/** The panel window fits the panel: `window_fit` with its size in whole points each time it changes (not while hidden). */
export function fitPanel(bridge: Bridge, panel: Element | null): (() => void) | undefined {
  if (!panel || typeof ResizeObserver === "undefined") return undefined;
  const fit = new ResizeObserver(() => {
    const { width, height } = panel.getBoundingClientRect();
    if (width > 0 && height > 0) void bridge.core.windowFit({ width: Math.ceil(width), height: Math.ceil(height) });
  });
  fit.observe(panel);
  return () => fit.disconnect();
}
// @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-api-fit

export type StartResult = { ok: true } | { ok: false; reason: "disk_full" | "model_missing" | "already_recording" | "other"; freeMb?: number };

const REFUSALS = { disk_full: "disk_full", model_missing: "model_missing", already_recording: "already_recording" } as const;

// @cpt-flow:cpt-noter-flow-ui-record-prompt-start-recording:p1
/** `capture_start` from the prompt; a refusal names the reason the panel shows (the core is not asked again). */
export async function startRecording(bridge: Bridge, d: CallDetection, sensitive: boolean): Promise<StartResult> {
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-api-start
  const res = await bridge.act("prompt:start", "capture_start", () => bridge.core.captureStart({ source: "record_prompt", sensitive, detection_id: d.id }), { screen: "record-prompt", named: REFUSALS });
  // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-api-start
  if (res.status === "ok") {
    void announce(bridge, t("prompt.announce_started"), "polite");
    return { ok: true };
  }
  const code = res.error.code;
  if (code === "disk_full") {
    const detail = res.error.detail;
    return { ok: false, reason: "disk_full", ...(detail?.type === "disk_space" ? { freeMb: detail.free_mb } : {}) };
  }
  return { ok: false, reason: code === "model_missing" || code === "already_recording" ? code : "other" };
}

// @cpt-flow:cpt-noter-flow-ui-record-prompt-missed-prompt:p1
/** The core closes the prompt but keeps the detection, so the menu bar keeps **Call Detected · Start Recording**. */
export function dismiss(bridge: Bridge, detectionId: string, reason: DismissReason) {
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-missed-prompt:p1:inst-api-dismiss
  return bridge.act("prompt:dismiss", "capture_dismiss_detection", () => bridge.core.captureDismissDetection({ detection_id: detectionId, reason }), { screen: "record-prompt" });
  // @cpt-end:cpt-noter-flow-ui-record-prompt-missed-prompt:p1:inst-api-dismiss
}

export function ignoreApp(bridge: Bridge, d: CallDetection) {
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-api-ignore
  return bridge.act("prompt:ignore", "capture_ignore_app", () => bridge.core.captureIgnoreApp({ bundle_id: d.bundle_id, app_name: d.app_name }), { screen: "record-prompt" });
  // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-api-ignore
}

/** **Open System Settings…** on the System Audio Recording pane (macOS may then ask to quit and reopen Noter). */
export function openSystemSettings(bridge: Bridge) {
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-open-settings
  return bridge.act("prompt:settings", "open_external", () => bridge.core.openExternal({ target: { type: "system_settings", permission: "system_audio" } }), { screen: "record-prompt" });
  // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-open-settings
}

/** **Delete Old Audio…**: the sheet is the main window's (dialogs host). */
export function openDeleteOldAudio(bridge: Bridge) {
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-delete-old
  return bridge.act("prompt:delete_old", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "delete_old_audio" } }), { screen: "record-prompt" });
  // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-delete-old
}

// @cpt-flow:cpt-noter-flow-ui-record-prompt-notice:p1
export function answerCallEnd(bridge: Bridge, callId: string, choice: CallEndChoice) {
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-notice:p1:inst-match-notice
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-notice:p1:inst-case-call-end
  return bridge.act("prompt:call_end", "capture_answer_call_end", () => bridge.core.captureAnswerCallEnd({ call_id: callId, choice }), { screen: "record-prompt" });
  // @cpt-end:cpt-noter-flow-ui-record-prompt-notice:p1:inst-case-call-end
  // @cpt-end:cpt-noter-flow-ui-record-prompt-notice:p1:inst-match-notice
}

export function answerNewMeeting(bridge: Bridge, callId: string, choice: NewMeetingChoice) {
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-notice:p1:inst-match-notice
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-notice:p1:inst-case-new-meeting
  return bridge.act("prompt:new_meeting", "capture_answer_new_meeting", () => bridge.core.captureAnswerNewMeeting({ call_id: callId, choice }), { screen: "record-prompt" });
  // @cpt-end:cpt-noter-flow-ui-record-prompt-notice:p1:inst-case-new-meeting
  // @cpt-end:cpt-noter-flow-ui-record-prompt-notice:p1:inst-match-notice
}

/** The pointer or focus is on the call-ended notice (wanted state): the core holds its countdown. */
export function holdNotice(bridge: Bridge, callId: string, held: boolean) {
  // @cpt-begin:cpt-noter-flow-ui-record-prompt-notice:p1:inst-api-hold
  return bridge.act("prompt:hold", "capture_hold_notice", () => bridge.core.captureHoldNotice({ call_id: callId, held }), { screen: "record-prompt" });
  // @cpt-end:cpt-noter-flow-ui-record-prompt-notice:p1:inst-api-hold
}
