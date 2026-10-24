import { describe, expect, it, vi } from "vitest";

import type { CallWindowState, CaptureState, DegradedState } from "../../core/bindings";
import { captureAnnouncements, captureView, closingTitle, degradedBanners, failureAnnouncement, failureAnnouncements, indicatorStatus, layoutRegions, layoutState, pausedMinutes, windowState, type BannerHandlers } from "./model";

const cap = (patch: Partial<CaptureState> = {}): CaptureState => ({
  version: 1,
  phase: "recording",
  call_id: "call_live",
  title: "Planning: VHI 8.0 drawer redesign",
  started_at: 0,
  recorded_ms: 48 * 60_000,
  sensitive: false,
  pause: null,
  notice: null,
  continue_until: null,
  output_route: "headphones",
  replay_available: true,
  audio_not_stored: false,
  audio_writing: true,
  ...patch,
});
const win = (patch: Partial<CallWindowState> = {}): CallWindowState => ({ version: 1, visible: true, key: false, layout: "dedicated", collapsed: false, display_id: null, chosen_display_missing: false, show_share_warning: false, ...patch });
const SLACK: DegradedState = { type: "second_audio_source", call_id: "call_live", app_name: "Slack", bundle_id: "com.tinyspeck.slackmacgap", since: 1 };
const handlers = (): BannerHandlers => ({ exclude: vi.fn(), keep: vi.fn(), openSettings: vi.fn(), retry: vi.fn(), deleteOldAudio: vi.fn() });

describe("captureView (cpt-noter-state-ui-call-window-capture)", () => {
  it("names the state the window shows for each capture state", () => {
    expect(captureView(cap(), [])).toBe("RECORDING");
    expect(captureView(cap({ phase: "paused" }), [])).toBe("PAUSED");
    expect(captureView(cap(), [{ type: "system_audio_silent", call_id: "call_live", since: 1, confidence: 0.9 }])).toBe("MIC_ONLY");
    expect(captureView(cap(), [{ type: "microphone_off", call_id: "call_live" }])).toBe("NO_MIC");
    expect(captureView(cap({ phase: "failed" }), [])).toBe("NOT_RECORDING");
    expect(captureView(cap(), [{ type: "capture_failed", call_id: "call_live", since: 1 }])).toBe("NOT_RECORDING");
    expect(captureView(cap({ notice: { type: "call_ended", stops_at: 5 } }), [])).toBe("NOTICE_CALL_ENDED");
    expect(captureView(cap({ notice: { type: "call_seems_ended", stops_at: 5 } }), [])).toBe("NOTICE_CALL_ENDED");
    expect(captureView(cap({ notice: { type: "new_meeting", event: null, app_name: null, detected_at: 1, expires_at: 2, default_choice: "start_as_new_call" } }), [])).toBe("NOTICE_NEW_MEETING");
    expect(captureView(cap({ notice: { type: "nothing_heard", since: 1 } }), [])).toBe("NOTICE_NOTHING_HEARD");
    expect(captureView(cap({ phase: "stopped", continue_until: 9 }), [])).toBe("STOPPED");
    expect(captureView(cap({ phase: "stopping" }), [])).toBe("STOPPED");
  });

  it("ignores degraded states of another call", () => {
    expect(captureView(cap(), [{ type: "microphone_off", call_id: "call_other" }])).toBe("RECORDING");
  });
});

describe("indicatorStatus (cpt-noter-component-ui-recording-indicator)", () => {
  it("gives the six state words", () => {
    expect(indicatorStatus(cap(), [])).toBe("recording");
    expect(indicatorStatus(cap({ phase: "paused" }), [])).toBe("paused");
    expect(indicatorStatus(cap(), [{ type: "system_audio_silent", call_id: "call_live", since: 1, confidence: null }])).toBe("mic-only");
    expect(indicatorStatus(cap(), [{ type: "microphone_off", call_id: "call_live" }])).toBe("no-mic");
    expect(indicatorStatus(cap({ phase: "failed" }), [])).toBe("not-recording");
    expect(indicatorStatus(cap({ phase: "stopped" }), [])).toBe("stopped");
    expect(indicatorStatus(cap({ notice: { type: "nothing_heard", since: 1 } }), [])).toBe("recording");
  });
});

describe("degradedBanners (cpt-noter-algo-ui-call-window-degraded-banner)", () => {
  it("maps each capture problem to its banner and runs its fix", () => {
    const on = handlers();
    const states: DegradedState[] = [
      { type: "system_audio_silent", call_id: "call_live", since: 1, confidence: 0.9 },
      { type: "microphone_off", call_id: "call_live" },
      { type: "capture_failed", call_id: "call_live", since: 1 },
      { type: "transcription_stalled", call_id: "call_live", since: 1 },
      SLACK,
      { type: "disk_low", free_mb: 2_000 },
    ];
    const b = degradedBanners(states, "call_live", false, on, new Set());
    expect(b.map((x) => [x.severity, x.text, (x.actions ?? []).map((a) => a.label)])).toEqual([
      ["error", "System audio silent", ["Open System Settings…"]],
      ["error", "Microphone off", ["Open System Settings…"]],
      ["error", "Not recording · engine stopped", ["Try Again"]],
      ["error", "Transcription stalled · restarting", []],
      ["warning", "Slack is also playing audio", ["Exclude Slack", "Keep"]],
      ["warning", "2 GB free on this Mac. Recording continues.", ["Delete Old Audio…"]],
    ]);
    b.forEach((x) => x.actions?.forEach((a) => a.onAction?.()));
    expect(on.openSettings).toHaveBeenNthCalledWith(1, "system_audio");
    expect(on.openSettings).toHaveBeenNthCalledWith(2, "microphone");
    expect(on.retry).toHaveBeenCalledOnce();
    expect(on.exclude).toHaveBeenCalledWith("com.tinyspeck.slackmacgap");
    expect(on.keep).toHaveBeenCalledWith("com.tinyspeck.slackmacgap");
    expect(on.deleteOldAudio).toHaveBeenCalledOnce();
    expect(b.every((x) => x.dismissible === false && !x.compact)).toBe(true);
  });

  it("shows no banner for a device change, copilot states, another call or a source the user kept", () => {
    const states: DegradedState[] = [
      { type: "device_changed", call_id: "call_live", device_name: "AirPods Pro", gap_ms: 2000 },
      { type: "switched_to_local", call_id: "call_live", reason: "timeout" as never, retry_at: null },
      { type: "budget_paused", call_id: "call_live", spent_usd: 1, cap_usd: 1 },
      { type: "microphone_off", call_id: "call_other" },
      SLACK,
    ];
    expect(degradedBanners(states, "call_live", false, handlers(), new Set(["com.tinyspeck.slackmacgap"]))).toEqual([]);
  });

  it("uses the compact banner in the floating layout", () => {
    expect(degradedBanners([SLACK], "call_live", true, handlers(), new Set())[0]!.compact).toBe(true);
  });
});

describe("failureAnnouncement", () => {
  it("speaks capture failures once per occurrence, nothing else", () => {
    expect(failureAnnouncement({ type: "system_audio_silent", call_id: "c", since: 7, confidence: null })).toEqual({ kind: "capture_failure", text: "System audio silent. Recording continues with your microphone.", key: "system_audio_silent:7" });
    expect(failureAnnouncement({ type: "microphone_off", call_id: "c" })).toEqual({ kind: "capture_failure", text: "Microphone off.", key: "microphone_off:c" });
    expect(failureAnnouncement({ type: "capture_failed", call_id: "c", since: 3 })).toEqual({ kind: "capture_failure", text: "Not recording. The audio engine stopped.", key: "capture_failed:3" });
    expect(failureAnnouncement({ type: "transcription_stalled", call_id: "c", since: 3 })).toBeNull();
  });
});

describe("closingTitle (cpt-noter-algo-ui-call-window-closing-state)", () => {
  it("reads Saved · N min after a manual stop, and Stopped at hh:mm after an automatic one", () => {
    expect(closingTitle(cap({ phase: "stopped", continue_until: Date.UTC(2026, 9, 24, 11, 7) }), "UTC")).toEqual({ auto: false, text: "Saved · 48 min · Summary in about 2 minutes" });
    const auto = closingTitle(cap({ phase: "stopped", notice: { type: "stopped_automatically", call_id: "call_live" }, continue_until: Date.UTC(2026, 9, 24, 11, 7) }), "UTC");
    expect(auto).toEqual({ auto: true, text: "Stopped at 11:02 · the call had ended · 48 min saved" });
  });

  it("never says 0 min", () => {
    expect(closingTitle(cap({ phase: "stopped", recorded_ms: 10_000 }), "UTC").text).toContain("1 min");
  });
});

describe("layoutRegions (cpt-noter-algo-ui-call-window-layout-content)", () => {
  it("lists the regions of each layout with the copilot off", () => {
    expect(layoutRegions({ layout: "DEDICATED", notice: false, banners: true, replaying: false })).toEqual(["CS-R1", "CS-R3", "CS-R2", "CS-R5"]);
    expect(layoutRegions({ layout: "DEDICATED", notice: true, banners: false, replaying: true })).toEqual(["CS-R0", "CS-R1", "CS-R2", "CS-R2b", "CS-R5"]);
    expect(layoutRegions({ layout: "FLOATING", notice: false, banners: true, replaying: false })).toEqual(["FP-R1", "FP-R3", "FP-R5", "FP-R6"]);
    // the notice takes the place of the banner slot
    expect(layoutRegions({ layout: "FLOATING", notice: true, banners: true, replaying: false })).toEqual(["FP-R1", "FP-R0", "FP-R5", "FP-R6"]);
    expect(layoutRegions({ layout: "COLLAPSED", notice: false, banners: false, replaying: false })).toEqual(["FP-C1", "FP-C3"]);
  });
});

describe("layoutState (cpt-noter-state-ui-call-window-layout)", () => {
  it("is collapsed only while floating without a notice", () => {
    expect(layoutState(win(), false)).toBe("DEDICATED");
    expect(layoutState(win({ layout: "floating" }), false)).toBe("FLOATING");
    expect(layoutState(win({ layout: "floating", collapsed: true }), false)).toBe("COLLAPSED");
    expect(layoutState(win({ layout: "floating", collapsed: true }), true)).toBe("FLOATING");
    expect(layoutState(win({ layout: "dedicated", collapsed: true }), false)).toBe("DEDICATED");
  });
});

describe("windowState (cpt-noter-state-ui-call-window-window)", () => {
  it("follows the core's window, presenting and capture state", () => {
    expect(windowState(win(), false, cap())).toBe("NOT_KEY");
    expect(windowState(win({ key: true }), false, cap())).toBe("KEY");
    expect(windowState(win({ visible: false }), false, cap())).toBe("HIDDEN_BY_USER");
    expect(windowState(win(), true, cap())).toBe("HIDDEN_FOR_PRESENTING");
    expect(windowState(win(), false, cap({ phase: "stopped" }))).toBe("CLOSING");
    expect(windowState(win(), false, cap({ phase: "idle", call_id: null }))).toBe("CLOSED");
  });
});

describe("pausedMinutes", () => {
  it("counts whole minutes since the pause, at least one", () => {
    expect(pausedMinutes({ since: 0, remind_at: null }, 3 * 60_000 + 5_000)).toBe(3);
    expect(pausedMinutes({ since: 0, remind_at: null }, 1_000)).toBe(1);
  });
});

describe("announcements (DESIGN › Keyboard and VoiceOver, announcement table)", () => {
  it("announces the failures of this call only", () => {
    const states: DegradedState[] = [{ type: "microphone_off", call_id: "call_live" }, { type: "microphone_off", call_id: "call_other" }, { type: "disk_low", free_mb: 1 }];
    expect(failureAnnouncements(states, "call_live").map((a) => a.text)).toEqual(["Microphone off."]);
  });

  it("says nothing for the capture state the window opened on, but speaks a notice it opened with", () => {
    expect(captureAnnouncements(null, cap({ phase: "paused" }), null)).toEqual([]);
    const ended = { type: "call_ended" as const, stops_at: 1 };
    expect(captureAnnouncements(null, cap({ notice: ended }), ended).map((a) => a.kind)).toEqual(["call_ended"]);
  });

  it("announces a new notice assertively, Paused and Resumed, and the stop with its minutes", () => {
    const ended = { type: "call_ended" as const, stops_at: 1 };
    expect(captureAnnouncements({ phase: "recording", notice: null }, cap({ notice: ended }), ended)).toEqual([{ kind: "call_ended", text: "The call seems to have ended", key: "call_live:1" }]);
    expect(captureAnnouncements({ phase: "recording", notice: "call_ended" }, cap({ notice: ended }), ended)).toEqual([]);
    const meeting = { type: "new_meeting" as const, event: null, app_name: null, detected_at: 1, expires_at: 2, default_choice: "start_as_new_call" as const };
    expect(captureAnnouncements({ phase: "recording", notice: null }, cap(), meeting)[0]).toMatchObject({ kind: "new_meeting", text: "A new meeting may have started" });
    const titled = { ...meeting, event: { id: "e", title: "1:1 with Anna K." } as never };
    expect(captureAnnouncements({ phase: "recording", notice: null }, cap(), titled)[0]!.text).toBe("A new meeting may have started: 1:1 with Anna K.");
    expect(captureAnnouncements({ phase: "recording", notice: null }, cap({ phase: "paused" }), null).map((a) => a.text)).toEqual(["Paused"]);
    expect(captureAnnouncements({ phase: "paused", notice: null }, cap(), null).map((a) => a.text)).toEqual(["Resumed"]);
    expect(captureAnnouncements({ phase: "recording", notice: null }, cap({ phase: "stopped" }), null)).toEqual([{ kind: "recording", text: "Recording stopped, saved 48 minutes", key: "stopped:call_live:1" }]);
    expect(captureAnnouncements({ phase: "stopped", notice: null }, cap({ phase: "stopped" }), null)).toEqual([]);
  });
});
