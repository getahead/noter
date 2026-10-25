// Pure rules of the record prompt: which variant to draw for what the core reports, its texts, and the 15-second
// timer. Nothing here reads the store or draws.
import type { CallDetection, CaptureNotice, CaptureState, ModelBundle, StartBlocked } from "../../core/bindings";
import { t } from "../../i18n/format";

export type Variant = "default" | "disk-full" | "model-missing" | "system-audio-off" | "call-ended" | "new-meeting";
export type PanelState = "default" | "disabled" | "not-a-call" | "countdown-running" | "countdown-paused";

export interface PromptInput {
  setupComplete: boolean;
  /** Hidden for presenting: no panel on the shared screen. */
  presenting: boolean;
  capture: CaptureState | null;
  detection: CallDetection | null;
  /** The inline **Don't Ask for <app>…** confirmation is open. */
  dontAsk: boolean;
  systemAudioOff: boolean;
  /** The reason of a `capture_start` the core refused, until the core says it clears. */
  refused: StartBlocked | null;
  /** The pointer or keyboard focus is on the panel. */
  held: boolean;
}

// @cpt-algo:cpt-noter-algo-ui-record-prompt-variant:p1
/** The variant and state to draw, or `null` for no panel (the core shows the prompt only when it should; the UI never draws one it must not). */
export function chooseView(i: PromptInput): { variant: Variant; state: PanelState } | null {
  // @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-hidden-detected
  if (!i.setupComplete || i.presenting) return null;
  // @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-hidden-detected
  const notice = i.capture?.notice;
  // @cpt-begin:cpt-noter-algo-ui-record-prompt-variant:p1:inst-call-ended
  // @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-hidden-ended
  if (notice?.type === "call_ended" || notice?.type === "call_seems_ended") {
  // @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-hidden-ended
    // @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-ended-paused
    const paused = i.held || (notice.type === "call_ended" && notice.stops_at === null);
    // @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-ended-paused
    // @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-paused-ended
    return { variant: "call-ended", state: paused ? "countdown-paused" : "countdown-running" };
    // @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-paused-ended
  }
  // @cpt-end:cpt-noter-algo-ui-record-prompt-variant:p1:inst-call-ended
  // @cpt-begin:cpt-noter-algo-ui-record-prompt-variant:p1:inst-new-meeting
  // @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-hidden-newmeeting
  if (notice?.type === "new_meeting") return { variant: "new-meeting", state: "default" };
  // @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-hidden-newmeeting
  // @cpt-end:cpt-noter-algo-ui-record-prompt-variant:p1:inst-new-meeting
  const recording = i.capture?.phase === "recording" || i.capture?.phase === "paused";
  // @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-hidden-detected
  if (!i.detection || recording) return null;
  // @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-hidden-detected
  // @cpt-begin:cpt-noter-algo-ui-record-prompt-variant:p1:inst-not-a-call
  if (i.dontAsk) return { variant: "default", state: "not-a-call" };
  // @cpt-end:cpt-noter-algo-ui-record-prompt-variant:p1:inst-not-a-call
  // @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-hidden-refused
  const blocked = i.refused ?? i.detection.blocked;
  // @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-hidden-refused
  // @cpt-begin:cpt-noter-algo-ui-record-prompt-variant:p1:inst-disk-full
  if (blocked === "disk_full") return { variant: "disk-full", state: "disabled" };
  // @cpt-end:cpt-noter-algo-ui-record-prompt-variant:p1:inst-disk-full
  // @cpt-begin:cpt-noter-algo-ui-record-prompt-variant:p1:inst-model-missing
  if (blocked === "model_missing") return { variant: "model-missing", state: "disabled" };
  // @cpt-end:cpt-noter-algo-ui-record-prompt-variant:p1:inst-model-missing
  // @cpt-begin:cpt-noter-algo-ui-record-prompt-variant:p1:inst-sys-off
  if (i.systemAudioOff) return { variant: "system-audio-off", state: "default" };
  // @cpt-end:cpt-noter-algo-ui-record-prompt-variant:p1:inst-sys-off
  // @cpt-begin:cpt-noter-algo-ui-record-prompt-variant:p1:inst-default
  return { variant: "default", state: "default" };
  // @cpt-end:cpt-noter-algo-ui-record-prompt-variant:p1:inst-default
}

/** RP-R1's source line: the matched event's title, else the app using the microphone. */
export const sourceLine = (d: CallDetection): string => d.matched_event?.title ?? t("prompt.source", { app: d.app_name });

/** The speech model's download progress in whole percent, `null` when it is not downloading. */
export const modelPercent = (b: ModelBundle | undefined): number | null => (b && b.state === "downloading" ? Math.min(100, Math.max(0, Math.floor((b.done_mb / Math.max(1, b.size_mb)) * 100))) : null);

/** Whole seconds until the core stops the call; `null` while the core holds the notice. */
export const countdownSeconds = (stopsAt: number | null, now: number): number | null => (stopsAt === null ? null : Math.max(0, Math.ceil((stopsAt - now) / 1000)));

export interface PromptTimer {
  pause(): void;
  resume(): void;
  stop(): void;
}

// @cpt-begin:cpt-noter-flow-ui-record-prompt-missed-prompt:p1:inst-pause-timer
/** The 15 s the prompt waits for an answer; it does not run while the pointer or focus is on the panel (no visible countdown). */
export function createPromptTimer(ms: number, onElapsed: () => void): PromptTimer {
  let left = ms;
  let since: number | null = Date.now();
  let id: ReturnType<typeof setTimeout> | null = setTimeout(onElapsed, left);
  return {
    pause() {
      if (id === null || since === null) return;
      clearTimeout(id);
      id = null;
      left -= Date.now() - since;
      since = null;
    },
    resume() {
      if (id !== null || left <= 0) return;
      since = Date.now();
      id = setTimeout(onElapsed, left);
    },
    stop() {
      if (id !== null) clearTimeout(id);
      id = null;
      left = 0;
    },
  };
}
// @cpt-end:cpt-noter-flow-ui-record-prompt-missed-prompt:p1:inst-pause-timer

/** What the panel holds itself, apart from what the core reports. */
export interface PanelLocal {
  dontAsk: boolean;
  /** A `capture_start` the core refused, and the world it was refused in (`at`). */
  refused: { reason: StartBlocked; freeMb?: number; at: string } | null;
  /** The prompt fades out (200 ms), then it is gone: hidden until the core's next prompt. */
  closing: string | null;
  gone: string | null;
  /** The pointer is over the panel, and the keyboard focus is in it: either one holds it (no timer, no countdown). */
  pointer: boolean;
  focus: boolean;
}
export type PanelEvent =
  | { type: "dont-ask" | "back" | "gone" | "reset" }
  | { type: "refused"; reason: StartBlocked; freeMb?: number; at: string }
  | { type: "closing"; key: string }
  | { type: "pointer" | "focus"; on: boolean };

export const INITIAL_LOCAL: PanelLocal = { dontAsk: false, refused: null, closing: null, gone: null, pointer: false, focus: false };

export const isHeld = (s: PanelLocal): boolean => s.pointer || s.focus;

// @cpt-state:cpt-noter-state-ui-record-prompt-panel:p1
export function localReduce(s: PanelLocal, e: PanelEvent): PanelLocal {
  switch (e.type) {
    // @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-detected-notacall
    case "dont-ask":
      return { ...s, dontAsk: true };
    // @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-detected-notacall
    // @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-notacall-detected
    case "back":
      return { ...s, dontAsk: false };
    // @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-notacall-detected
    case "refused":
      return { ...s, refused: { reason: e.reason, ...(e.freeMb !== undefined ? { freeMb: e.freeMb } : {}), at: e.at } };
    // @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-detected-closing
    case "closing":
      return { ...s, closing: e.key };
    // @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-detected-closing
    // @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-closing-hidden
    case "gone":
      return { ...s, closing: null, gone: s.closing ?? s.gone };
    // @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-closing-hidden
    case "pointer":
      return s.pointer === e.on ? s : { ...s, pointer: e.on };
    case "focus":
      return s.focus === e.on ? s : { ...s, focus: e.on };
    case "reset":
      return INITIAL_LOCAL;
  }
}

/** The refusal to show, unless the world it was refused in has changed (old audio deleted, model in). */
// @cpt-begin:cpt-noter-state-ui-record-prompt-panel:p1:inst-refused-detected
export const activeRefusal = (s: PanelLocal, at: string): { reason: StartBlocked; freeMb?: number } | null => {
  if (!s.refused || s.refused.at !== at) return null;
  const { reason, freeMb } = s.refused;
  return freeMb === undefined ? { reason } : { reason, freeMb };
};
// @cpt-end:cpt-noter-state-ui-record-prompt-panel:p1:inst-refused-detected

/** What identifies the prompt on screen: the detection, else the notice. */
export const viewKey = (d: CallDetection | null, notice: CaptureNotice | null | undefined): string | null => (d ? `det:${d.id}` : notice ? `notice:${notice.type}` : null);

const BROWSERS = new Set(["com.apple.Safari", "com.google.Chrome", "org.mozilla.firefox", "company.thebrowser.Browser", "com.microsoft.edgemac", "com.brave.Browser", "com.operasoftware.Opera", "com.vivaldi.Vivaldi"]);
/** A browser's calls (Google Meet) are not an app of their own: its Don't Ask line says so. */
export const isBrowser = (bundleId: string): boolean => BROWSERS.has(bundleId);

/** The new meeting's title: its calendar event, else the app it joined. */
export const meetingTitle = (n: CaptureNotice | null | undefined): string => (n?.type === "new_meeting" ? (n.event?.title ?? n.app_name ?? "") : "");
