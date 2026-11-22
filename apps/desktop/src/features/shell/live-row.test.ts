import { describe, expect, it, vi } from "vitest";

import { elapsedSeconds, isLive, receivedAtOf, shortTitle } from "./live-row";

describe("live row", () => {
  it("shows for recording and paused only", () => {
    expect(["recording", "paused"].map((phase) => isLive({ phase } as never))).toEqual([true, true]);
    expect(["idle", "starting", "stopped"].map((phase) => isLive({ phase } as never))).toEqual([false, false, false]);
    expect(isLive(undefined)).toBe(false);
  });

  it("counts on while recording and holds while paused", () => {
    expect(elapsedSeconds({ phase: "recording", recorded_ms: 1000 }, 5000, 7500)).toBe(3.5);
    expect(elapsedSeconds({ phase: "paused", recorded_ms: 1000 }, 5000, 7500)).toBe(1);
    expect(elapsedSeconds({ phase: "recording", recorded_ms: 0 }, 5000, 4000)).toBe(0); // a clock behind the core never runs backwards
  });

  it("names the call by the part before its colon and space", () => {
    expect(shortTitle("Planning: VHI 8.0 drawer redesign")).toBe("Planning");
    expect(shortTitle("Standup")).toBe("Standup");
    expect(shortTitle(null)).toBe("");
    expect(shortTitle("1:1 with Anna")).toBe("1:1 with Anna");
    expect(shortTitle("10:30 standup")).toBe("10:30 standup");
  });
});

// cpt-noter-seq-today-review-before-call (Return to a live call, #1039): a clock mounted later keeps the arrival time
describe("receivedAtOf", () => {
  it("stamps a capture version once, when it is first seen, for every clock in the window", () => {
    vi.useFakeTimers({ now: 1_000 });
    expect(receivedAtOf({ version: 7 })).toBe(1_000);
    vi.setSystemTime(61_000);
    expect(receivedAtOf({ version: 7 }), "Today mounted a minute later").toBe(1_000);
    expect(receivedAtOf({ version: 8 })).toBe(61_000);
    expect(receivedAtOf(undefined)).toBe(61_000);
    vi.setSystemTime(90_000);
    expect(receivedAtOf(undefined), "no state yet").toBe(90_000);
    expect(receivedAtOf({ version: 8 }), "a clock with no state yet left the stamp alone").toBe(61_000);
    vi.useRealTimers();
  });
});
