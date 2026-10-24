import { describe, expect, it } from "vitest";

import { notificationContent, permissionState, sendRule, type SendInput } from "./notifications";

describe("notificationContent (titles and counts only, plural rules)", () => {
  it("NT-1 names the call and counts items and decisions", () => {
    expect(notificationContent({ kind: "summary_ready", call: "Planning: VHI 8.0 drawer redesign", actionItems: 4, decisions: 2 })).toEqual({
      title: "Summary ready",
      body: "Planning: VHI 8.0 drawer redesign · 4 action items, 2 decisions",
    });
    expect(notificationContent({ kind: "summary_ready", call: "Backend sync", actionItems: 1, decisions: 1 }).body).toBe("Backend sync · 1 action item, 1 decision");
    expect(notificationContent({ kind: "summary_ready", call: "Backend sync", actionItems: 0, decisions: 0 }).body).toBe("Backend sync · 0 action items, 0 decisions");
  });
  it("NT-2 asks to open the call to try again", () => {
    expect(notificationContent({ kind: "summary_failed", call: "Backend sync" })).toEqual({ title: "Couldn't write the summary", body: "Backend sync · open the call to try again" });
  });
  it("NT-3 has one title and line per capture problem", () => {
    expect(notificationContent({ kind: "capture_problem", problem: "system_audio_silent" })).toEqual({ title: "System audio silent", body: "Recording continues with your microphone." });
    expect(notificationContent({ kind: "capture_problem", problem: "microphone_off" })).toEqual({ title: "Microphone off", body: "Recording continues with the other side only." });
    expect(notificationContent({ kind: "capture_problem", problem: "engine_stopped" })).toEqual({ title: "Not recording · engine stopped", body: "Open the call window to try again." });
  });
});

const base = (o: Partial<SendInput> = {}): SendInput => ({ kind: "summary_ready", allowed: true, recording: false, presenting: false, windowShowsCall: false, callSurfaceVisible: false, ...o });

describe("sendRule (cpt-noter-algo-ui-notifications-send-rule)", () => {
  it("drops everything while notifications are off", () => {
    expect(sendRule(base({ allowed: false }))).toBe("drop");
    expect(sendRule(base({ allowed: false, kind: "capture_problem" }))).toBe("drop");
  });
  it("sends NT-3 at once, never held, unless hidden for presenting or a call surface is visible", () => {
    expect(sendRule(base({ kind: "capture_problem", recording: true }))).toBe("send");
    expect(sendRule(base({ kind: "capture_problem", presenting: true }))).toBe("drop");
    expect(sendRule(base({ kind: "capture_problem", callSurfaceVisible: true }))).toBe("drop");
  });
  it("drops NT-1 and NT-2 for the call the frontmost main window shows", () => {
    expect(sendRule(base({ windowShowsCall: true }))).toBe("drop");
    expect(sendRule(base({ kind: "summary_failed", windowShowsCall: true }))).toBe("drop");
  });
  it("holds NT-1 and NT-2 while a call records or Noter is hidden for presenting", () => {
    expect(sendRule(base({ recording: true }))).toBe("hold");
    expect(sendRule(base({ presenting: true }))).toBe("hold");
  });
  it("otherwise sends", () => {
    expect(sendRule(base())).toBe("send");
  });
});

describe("permissionState", () => {
  it("maps what macOS reports", () => {
    expect(permissionState("not_determined")).toBe("NOT_ASKED");
    expect(permissionState("authorized")).toBe("ALLOWED");
    expect(permissionState("denied")).toBe("DENIED");
    expect(permissionState(undefined)).toBe("NOT_ASKED");
  });
});
