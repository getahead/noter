import { describe, expect, it, vi } from "vitest";

import type { CommandState } from "../../app/store/window-store";
import type { CallRow, UiPrefs } from "../../core/bindings";
import { afterTimer, callInfo, callKey, callViews, pageState, parseCallKey, subtitleOf } from "./logic";

const PREFS: UiPrefs = { time_format: "h24", time_zone: "UTC", first_weekday: 1 };
const NOW = Date.UTC(2026, 9, 24, 12, 0);
const row = (o: Partial<CallRow> = {}): CallRow =>
  ({
    id: "call_x", rev: 5, title: "Backend sync", call_type: "planning", started_at: Date.UTC(2026, 9, 24, 10, 0), duration_ms: 52 * 60_000, platform: "Zoom",
    participants: [
      { id: "p1", display_name: "Dmitri S.", short_name: "Dmitri S.", initials: "DS", is_you: false },
      { id: "p2", display_name: "You", short_name: "You", initials: "Y", is_you: true },
    ],
    unnamed_speakers: 0, languages: ["en", "ru"], tags: [], privacy: "normal", status: "ready", outputs: "none", archive: "none",
    audio_kept_until: Date.UTC(2026, 10, 15), audio_deleted: false, open_items: 0, review_waiting: 0, ...o,
  }) as unknown as CallRow;

describe("route key", () => {
  it("round-trips call id and tab", () => {
    expect(parseCallKey(callKey("call_x", "transcript"))).toEqual({ callId: "call_x", tab: "transcript" });
  });
  it("is null for a key that is not a call page", () => {
    expect(parseCallKey("root")).toBeNull();
    expect(parseCallKey("item:i1")).toBeNull();
  });
});

describe("callViews (cpt-noter-algo-ui-call-page-frame-views)", () => {
  it("lists only registered views, in DESIGN's order", () => {
    expect(callViews(["history", "transcript"], "transcript").segments).toEqual(["transcript", "history"]);
  });
  it("falls back to Transcript when the requested tab is not registered", () => {
    expect(callViews(["transcript"], "summary").view).toBe("transcript");
    expect(callViews(["transcript"], "agent_reviews").view).toBe("transcript");
  });
  it("shows the requested tab when it is registered", () => {
    expect(callViews(["summary", "transcript"], "summary").view).toBe("summary");
  });
});

describe("pageState (cpt-noter-state-ui-call-page-frame-page)", () => {
  const cmd = (state: CommandState["state"], code: string | null = null): CommandState => ({ state, error: code ? ({ code, state: "section", tryAgain: true } as never) : null });
  it("is LOADING until the call is there", () => {
    expect(pageState(undefined, false)).toBe("LOADING");
    expect(pageState(cmd("WAITING"), false)).toBe("LOADING");
  });
  it("is READY once call_get returned the call, and stays READY while a later command runs", () => {
    expect(pageState(cmd("DONE"), true)).toBe("READY");
    expect(pageState(cmd("WAITING"), true)).toBe("READY");
  });
  it("shows a failed read even when a list already put the row in the store", () => {
    expect(pageState(cmd("ERROR", "not_found"), true)).toBe("NOT_FOUND");
    expect(pageState(cmd("ERROR", "internal"), true)).toBe("ERROR");
  });
  it("is NOT_FOUND for not_found and ERROR for any other failure", () => {
    expect(pageState(cmd("ERROR", "not_found"), false)).toBe("NOT_FOUND");
    expect(pageState(cmd("ERROR", "internal"), false)).toBe("ERROR");
  });
  it("is LOADING again when Try Again re-runs the read", () => {
    expect(pageState(cmd("WAITING"), false)).toBe("LOADING");
  });
});

describe("subtitle", () => {
  it("is when, length and the participants' short names", () => {
    expect(subtitleOf(row(), NOW, PREFS)).toBe("Today 10:00 · 52 min · Dmitri S., You");
  });
  it("names another day by its date", () => {
    expect(subtitleOf(row({ started_at: Date.UTC(2026, 9, 20, 9, 30) }), NOW, PREFS)).toMatch(/^Oct 20, 2026, 09:30 · 52 min/);
  });
});

describe("callInfo (PC-R4)", () => {
  it("has the five sections' rows", () => {
    const i = callInfo(row(), { audio_not_stored: false }, NOW, PREFS, "Planning");
    expect(i.participants.map((p) => p.short_name)).toEqual(["Dmitri S.", "You"]);
    expect(i.call.map((r) => r.label)).toEqual(["Type", "App", "When", "Length", "Languages"]);
    expect(i.call.find((r) => r.label === "Type")!.value).toBe("Planning");
    expect(i.call.find((r) => r.label === "App")!.value).toBe("Zoom");
    expect(i.call.find((r) => r.label === "Length")!.value).toBe("52 min");
    expect(i.call.find((r) => r.label === "Languages")!.value).toBe("EN, RU");
    expect(i.sensitive).toBe(false);
  });
  it("says until when the audio is kept", () => {
    expect(callInfo(row(), { audio_not_stored: false }, NOW, PREFS, "x").audio).toBe("Kept until Nov 15");
  });
  it("says the audio is deleted and the transcript kept", () => {
    const i = callInfo(row({ audio_deleted: true, audio_kept_until: null }), { audio_not_stored: false }, NOW, PREFS, "x");
    expect(i.audio).toBe("Audio deleted on Oct 24 · transcript kept"); // no date from the core: the call's own day
    expect(i.audioKept).toBe(false);
    expect(callInfo(row({ audio_deleted: true }), { audio_not_stored: false }, NOW, PREFS, "x").audio).toBe("Audio deleted on Nov 15 · transcript kept");
  });
  it("says the audio was never stored", () => {
    expect(callInfo(row({ audio_kept_until: null }), { audio_not_stored: true }, NOW, PREFS, "x").audio).toBe("Audio not stored");
  });
  it("marks a sensitive call, and shows an App placeholder when the platform is unknown", () => {
    const i = callInfo(row({ privacy: "sensitive", platform: null }), { audio_not_stored: false }, NOW, PREFS, "x");
    expect(i.sensitive).toBe(true);
    expect(i.call.find((r) => r.label === "App")!.value).toBe("—");
  });
});

describe("afterTimer (the skeleton after 300 ms)", () => {
  it("says late only once active has held for the time, and clears on cleanup or when it stops being active", () => {
    vi.useFakeTimers();
    const seen: boolean[] = [];
    const clean = afterTimer(300, true, (v) => seen.push(v))!;
    vi.advanceTimersByTime(299);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([true]);
    const quick = afterTimer(300, true, (v) => seen.push(v))!;
    quick();
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([true]); // the cleaned-up timer never fired
    clean();
    expect(afterTimer(300, false, (v) => seen.push(v))).toBeUndefined();
    expect(seen.at(-1)).toBe(false);
    vi.useRealTimers();
  });
});
