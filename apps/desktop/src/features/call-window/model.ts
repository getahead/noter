// The call window's logic (docs/features/ui/call-window.md): what it shows for the core's capture,
// degraded, window and presenting state. Pure functions; the components render what they return.
import type { CallWindowState, CaptureNotice, CaptureState, DegradedState, PauseInfo, PermissionKind } from "../../core/bindings";
import type { AnnounceEvent } from "../../app/a11y/announce";
import type { Banner } from "../../ui/feedback/inline-banner";
import { t } from "../../i18n/format";

export type CaptureView = "RECORDING" | "MIC_ONLY" | "NO_MIC" | "PAUSED" | "NOT_RECORDING" | "NOTICE_CALL_ENDED" | "NOTICE_NEW_MEETING" | "NOTICE_NOTHING_HEARD" | "STOPPED";
export type IndicatorStatus = "recording" | "paused" | "mic-only" | "no-mic" | "not-recording" | "stopped";
export type LayoutState = "DEDICATED" | "FLOATING" | "COLLAPSED";
export type WindowView = "NOT_KEY" | "KEY" | "HIDDEN_BY_USER" | "HIDDEN_FOR_PRESENTING" | "CLOSING" | "CLOSED";

const has = (degraded: readonly DegradedState[], callId: string | null, type: DegradedState["type"]) => degraded.some((d) => d.type === type && "call_id" in d && d.call_id === callId);
export const stopped = (c: Pick<CaptureState, "phase">) => c.phase === "stopped" || c.phase === "stopping";
export const failed = (c: Pick<CaptureState, "phase" | "call_id">, degraded: readonly DegradedState[]) => c.phase === "failed" || has(degraded, c.call_id, "capture_failed");

// @cpt-state:cpt-noter-state-ui-call-window-capture:p1
/** The capture state as the window shows it: the core sends every transition, the window names the result. */
export function captureView(c: CaptureState, degraded: readonly DegradedState[]): CaptureView {
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-rec-stopped
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-ended-stopped
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-nothing-stopped
  if (stopped(c)) return "STOPPED";
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-nothing-stopped
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-ended-stopped
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-rec-stopped
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-rec-notrec
  if (failed(c, degraded)) return "NOT_RECORDING";
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-rec-notrec
  switch (c.notice?.type) {
    // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-rec-ended
    case "call_ended":
    case "call_seems_ended":
      return "NOTICE_CALL_ENDED";
    // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-rec-ended
    // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-rec-newmeeting
    case "new_meeting":
      return "NOTICE_NEW_MEETING";
    // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-rec-newmeeting
    // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-rec-nothing
    case "nothing_heard":
      return "NOTICE_NOTHING_HEARD";
    // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-rec-nothing
  }
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-rec-paused
  if (c.phase === "paused") return "PAUSED";
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-rec-paused
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-rec-miconly
  if (has(degraded, c.call_id, "system_audio_silent")) return "MIC_ONLY";
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-rec-miconly
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-rec-nomic
  if (has(degraded, c.call_id, "microphone_off")) return "NO_MIC";
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-rec-nomic
  // Every way back: system audio or the microphone returns, the user resumes, keeps recording,
  // answers the new-meeting notice, continues after a stop or retries after the engine stopped.
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-miconly-rec
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-nomic-rec
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-paused-rec
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-notrec-rec
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-ended-rec
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-newmeeting-rec
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-nothing-rec
  // @cpt-begin:cpt-noter-state-ui-call-window-capture:p1:inst-stopped-rec
  return "RECORDING";
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-stopped-rec
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-nothing-rec
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-newmeeting-rec
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-ended-rec
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-notrec-rec
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-paused-rec
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-nomic-rec
  // @cpt-end:cpt-noter-state-ui-call-window-capture:p1:inst-miconly-rec
}

/** The recording indicator's state word: a notice does not change it. */
export function indicatorStatus(c: CaptureState, degraded: readonly DegradedState[]): IndicatorStatus {
  if (stopped(c)) return "stopped";
  if (failed(c, degraded)) return "not-recording";
  if (c.phase === "paused") return "paused";
  if (has(degraded, c.call_id, "system_audio_silent")) return "mic-only";
  if (has(degraded, c.call_id, "microphone_off")) return "no-mic";
  return "recording";
}

export interface BannerHandlers {
  exclude: (bundleId: string) => void;
  keep: (bundleId: string) => void;
  openSettings: (permission: PermissionKind) => void;
  retry: () => void;
  deleteOldAudio: () => void;
}

// @cpt-algo:cpt-noter-algo-ui-call-window-degraded-banner:p1
/** The transcript banners of the current call; `kept` holds the second sources the user chose to keep. */
export function degradedBanners(states: readonly DegradedState[], callId: string | null, compact: boolean, on: BannerHandlers, kept: ReadonlySet<string>): Banner[] {
  const out: Banner[] = [];
  // @cpt-begin:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-compact
  const banner = (b: Omit<Banner, "compact" | "dismissible">) => out.push({ ...b, compact, dismissible: false });
  // @cpt-end:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-compact
  const settings = (permission: PermissionKind) => [
    {
      label: t("cw.banner.open_settings"),
      onAction: () => on.openSettings(permission),
    },
  ];
  for (const d of states) {
    if ("call_id" in d && d.call_id !== callId) continue;
    // @cpt-begin:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-match-type
    switch (d.type) {
      // @cpt-begin:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-silent
      case "system_audio_silent":
        banner({
          id: d.type,
          severity: "error",
          text: t("cw.banner.system_audio_silent"),
          actions: settings("system_audio"),
        });
        break;
      // @cpt-end:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-silent
      // @cpt-begin:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-mic-off
      case "microphone_off":
        banner({
          id: d.type,
          severity: "error",
          text: t("cw.banner.microphone_off"),
          actions: settings("microphone"),
        });
        break;
      // @cpt-end:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-mic-off
      // @cpt-begin:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-failed
      case "capture_failed":
        banner({
          id: d.type,
          severity: "error",
          text: t("cw.banner.capture_failed"),
          actions: [
            {
              label: t("action.try_again"),
              variant: "primary",
              onAction: on.retry,
            },
          ],
        });
        break;
      // @cpt-end:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-failed
      // @cpt-begin:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-stalled
      case "transcription_stalled":
        banner({
          id: d.type,
          severity: "error",
          text: t("cw.banner.transcription_stalled"),
          actions: [],
        });
        break;
      // @cpt-end:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-stalled
      // @cpt-begin:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-second
      case "second_audio_source":
        if (kept.has(d.bundle_id)) break;
        banner({
          id: `${d.type}:${d.bundle_id}`,
          severity: "warning",
          text: t("cw.banner.second_source", { app: d.app_name }),
          actions: [
            {
              label: t("cw.banner.exclude", { app: d.app_name }),
              onAction: () => on.exclude(d.bundle_id),
            },
            {
              label: t("cw.banner.keep"),
              onAction: () => on.keep(d.bundle_id),
            },
          ],
        });
        break;
      // @cpt-end:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-second
      // @cpt-begin:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-disk
      case "disk_low":
        banner({
          id: d.type,
          severity: "warning",
          text: t("cw.banner.disk_low", {
            gb: Math.max(1, Math.round(d.free_mb / 1000)),
          }),
          actions: [
            {
              label: t("cw.banner.delete_old_audio"),
              onAction: on.deleteOldAudio,
            },
          ],
        });
        break;
      // @cpt-end:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-disk
      // @cpt-begin:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-device
      // The transcript shows the gap row the core sends (Microphone changed · 2 s lost); no banner.
      case "device_changed":
        break;
      // @cpt-end:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-device
      // @cpt-begin:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-copilot
      // Copilot banners belong to CS-R4d, which the copilot-off layout of M1 does not have.
      default:
        break;
      // @cpt-end:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-case-copilot
    }
    // @cpt-end:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-match-type
  }
  // @cpt-begin:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-return-banner
  return out; // the banner slot orders them by severity
  // @cpt-end:cpt-noter-algo-ui-call-window-degraded-banner:p1:inst-return-banner
}

/** The assertive native announcement of a capture failure; `key` names the occurrence so it is spoken once. */
export function failureAnnouncement(d: DegradedState): AnnounceEvent | null {
  switch (d.type) {
    case "system_audio_silent":
      return {
        kind: "capture_failure",
        text: t("cw.announce.system_audio_silent"),
        key: `${d.type}:${d.since}`,
      };
    case "microphone_off":
      return {
        kind: "capture_failure",
        text: t("cw.announce.microphone_off"),
        key: `${d.type}:${d.call_id}`,
      };
    case "capture_failed":
      return {
        kind: "capture_failure",
        text: t("cw.announce.capture_failed"),
        key: `${d.type}:${d.since}`,
      };
    default:
      return null;
  }
}

/** The failures of the current call to announce (the announcer speaks each occurrence once). */
export const failureAnnouncements = (degraded: readonly DegradedState[], callId: string | null): AnnounceEvent[] =>
  degraded.flatMap((d) => ("call_id" in d && d.call_id === callId ? (failureAnnouncement(d) ?? []) : []));

/** What the window had shown when the capture state last changed. */
export interface Seen {
  phase: CaptureState["phase"];
  notice: string | null;
}

/** The announcements of a capture state change: a notice that appeared, Paused, Resumed, and the stop. */
export function captureAnnouncements(was: Seen | null, c: CaptureState, notice: CaptureNotice | null): AnnounceEvent[] {
  if (!was) return []; // what the window opened on is not news
  const out: AnnounceEvent[] = [];
  const key = `${c.call_id}:${c.version}`;
  if (notice && notice.type !== was.notice) {
    if (notice.type === "call_ended" || notice.type === "call_seems_ended") out.push({ kind: "call_ended", text: t("cw.notice.call_ended"), key });
    if (notice.type === "new_meeting") out.push({ kind: "new_meeting", text: notice.event ? t("cw.notice.new_meeting", { title: notice.event.title }) : t("cw.notice.new_meeting_untitled"), key });
  }
  if (was.phase === "recording" && c.phase === "paused") out.push({ kind: "recording", text: t("cw.announce.paused"), key });
  if (was.phase === "paused" && c.phase === "recording") out.push({ kind: "recording", text: t("cw.announce.resumed"), key });
  if (!stopped({ phase: was.phase }) && stopped(c)) out.push(stoppedAnnouncement(c));
  return out;
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));
const CONTINUE_MS = 5 * 60_000;

/** The closing state's title: Continue Recording is offered for 5 minutes after the stop, so the stop was `continue_until` minus 5 minutes. */
export function closingTitle(c: CaptureState, timeZone?: string, h12 = false): { auto: boolean; text: string } {
  // @cpt-begin:cpt-noter-algo-ui-call-window-closing-state:p1:inst-if-auto
  if (c.notice?.type === "stopped_automatically") {
    // @cpt-begin:cpt-noter-algo-ui-call-window-closing-state:p1:inst-auto
    const at = (c.continue_until ?? Date.now() + CONTINUE_MS) - CONTINUE_MS;
    const time = new Intl.DateTimeFormat("en", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: h12 ? "h12" : "h23",
      timeZone: timeZone || undefined,
    }).format(at);
    return {
      auto: true,
      text: t("cw.closing.auto", { time, minutes: minutes(c.recorded_ms) }),
    };
    // @cpt-end:cpt-noter-algo-ui-call-window-closing-state:p1:inst-auto
  }
  // @cpt-end:cpt-noter-algo-ui-call-window-closing-state:p1:inst-if-auto
  // @cpt-begin:cpt-noter-algo-ui-call-window-closing-state:p1:inst-else-manual
  // @cpt-begin:cpt-noter-algo-ui-call-window-closing-state:p1:inst-manual
  return {
    auto: false,
    text: t("cw.closing.manual", { minutes: minutes(c.recorded_ms) }),
  };
  // @cpt-end:cpt-noter-algo-ui-call-window-closing-state:p1:inst-manual
  // @cpt-end:cpt-noter-algo-ui-call-window-closing-state:p1:inst-else-manual
}

/** "Recording stopped, saved 48 minutes". */
export const stoppedAnnouncement = (c: CaptureState): AnnounceEvent => ({
  kind: "recording",
  text: t("announce.recording_stopped", {
    duration: t("cw.minutes", { count: minutes(c.recorded_ms) }),
  }),
  key: `stopped:${c.call_id}:${c.version}`,
});

export const pausedMinutes = (pause: PauseInfo, now: number) => Math.max(1, Math.floor((now - pause.since) / 60_000));

// @cpt-algo:cpt-noter-algo-ui-call-window-layout-content:p1
/** The regions to render, in order, with the copilot flag off (M1). */
export function layoutRegions(o: { layout: LayoutState; notice: boolean; banners: boolean; replaying: boolean }): string[] {
  // @cpt-begin:cpt-noter-algo-ui-call-window-layout-content:p1:inst-if-dedicated
  if (o.layout === "DEDICATED") {
    // @cpt-begin:cpt-noter-algo-ui-call-window-layout-content:p1:inst-dedicated-regions
    // @cpt-begin:cpt-noter-algo-ui-call-window-layout-content:p1:inst-dedicated-copilot-off
    // No CS-R4 column: the transcript fills the width, and CS-R5 has no budget, Pinned or Catch Me Up.
    return [o.notice && "CS-R0", "CS-R1", o.banners && "CS-R3", "CS-R2", o.replaying && "CS-R2b", "CS-R5"].filter((r): r is string => !!r);
    // @cpt-end:cpt-noter-algo-ui-call-window-layout-content:p1:inst-dedicated-copilot-off
    // @cpt-end:cpt-noter-algo-ui-call-window-layout-content:p1:inst-dedicated-regions
  }
  // @cpt-end:cpt-noter-algo-ui-call-window-layout-content:p1:inst-if-dedicated
  if (o.layout === "COLLAPSED") return ["FP-C1", "FP-C3"]; // copilot off: no FP-C2 card line
  // @cpt-begin:cpt-noter-algo-ui-call-window-layout-content:p1:inst-else-floating
  // @cpt-begin:cpt-noter-algo-ui-call-window-layout-content:p1:inst-floating-regions
  // @cpt-begin:cpt-noter-algo-ui-call-window-layout-content:p1:inst-floating-copilot-off
  // The notice takes the place of the banners; no FP-R2 mode line or FP-R4 cards; the tail fills the panel.
  // @cpt-begin:cpt-noter-algo-ui-call-window-layout-content:p1:inst-return-regions
  return ["FP-R1", o.notice ? "FP-R0" : o.banners && "FP-R3", "FP-R5", "FP-R6"].filter((r): r is string => !!r);
  // @cpt-end:cpt-noter-algo-ui-call-window-layout-content:p1:inst-return-regions
  // @cpt-end:cpt-noter-algo-ui-call-window-layout-content:p1:inst-floating-copilot-off
  // @cpt-end:cpt-noter-algo-ui-call-window-layout-content:p1:inst-floating-regions
  // @cpt-end:cpt-noter-algo-ui-call-window-layout-content:p1:inst-else-floating
}

// @cpt-state:cpt-noter-state-ui-call-window-layout:p1
/** The layout the core's window state names; a notice expands a collapsed strip until it is answered. */
export function layoutState(w: CallWindowState, notice: boolean): LayoutState {
  // @cpt-begin:cpt-noter-state-ui-call-window-layout:p1:inst-floating-dedicated
  if (w.layout === "dedicated") return "DEDICATED";
  // @cpt-end:cpt-noter-state-ui-call-window-layout:p1:inst-floating-dedicated
  // @cpt-begin:cpt-noter-state-ui-call-window-layout:p1:inst-floating-collapsed
  if (w.collapsed && !notice) return "COLLAPSED";
  // @cpt-end:cpt-noter-state-ui-call-window-layout:p1:inst-floating-collapsed
  // @cpt-begin:cpt-noter-state-ui-call-window-layout:p1:inst-dedicated-floating
  // @cpt-begin:cpt-noter-state-ui-call-window-layout:p1:inst-collapsed-floating
  return "FLOATING";
  // @cpt-end:cpt-noter-state-ui-call-window-layout:p1:inst-collapsed-floating
  // @cpt-end:cpt-noter-state-ui-call-window-layout:p1:inst-dedicated-floating
}

// @cpt-state:cpt-noter-state-ui-call-window-window:p1
/** The window's state: the core shows, hides, keys and closes the panel; the window reflects it. */
export function windowState(w: CallWindowState, presenting: boolean, c: CaptureState): WindowView {
  // @cpt-begin:cpt-noter-state-ui-call-window-window:p1:inst-closing-closed
  if (c.phase === "idle" || !c.call_id) return "CLOSED";
  // @cpt-end:cpt-noter-state-ui-call-window-window:p1:inst-closing-closed
  // @cpt-begin:cpt-noter-state-ui-call-window-window:p1:inst-notkey-presenting
  if (presenting) return "HIDDEN_FOR_PRESENTING";
  // @cpt-end:cpt-noter-state-ui-call-window-window:p1:inst-notkey-presenting
  // @cpt-begin:cpt-noter-state-ui-call-window-window:p1:inst-notkey-closing
  if (stopped(c)) return "CLOSING";
  // @cpt-end:cpt-noter-state-ui-call-window-window:p1:inst-notkey-closing
  // @cpt-begin:cpt-noter-state-ui-call-window-window:p1:inst-notkey-hidden
  if (!w.visible) return "HIDDEN_BY_USER";
  // @cpt-end:cpt-noter-state-ui-call-window-window:p1:inst-notkey-hidden
  // @cpt-begin:cpt-noter-state-ui-call-window-window:p1:inst-notkey-key
  if (w.key) return "KEY";
  // @cpt-end:cpt-noter-state-ui-call-window-window:p1:inst-notkey-key
  // @cpt-begin:cpt-noter-state-ui-call-window-window:p1:inst-key-notkey
  // @cpt-begin:cpt-noter-state-ui-call-window-window:p1:inst-hidden-notkey
  // @cpt-begin:cpt-noter-state-ui-call-window-window:p1:inst-presenting-notkey
  // @cpt-begin:cpt-noter-state-ui-call-window-window:p1:inst-closing-notkey
  return "NOT_KEY";
  // @cpt-end:cpt-noter-state-ui-call-window-window:p1:inst-closing-notkey
  // @cpt-end:cpt-noter-state-ui-call-window-window:p1:inst-presenting-notkey
  // @cpt-end:cpt-noter-state-ui-call-window-window:p1:inst-hidden-notkey
  // @cpt-end:cpt-noter-state-ui-call-window-window:p1:inst-key-notkey
}
