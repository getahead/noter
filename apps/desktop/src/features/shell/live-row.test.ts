import { describe, expect, it } from "vitest";

import { elapsedSeconds, isLive, shortTitle } from "./live-row";

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

  it("names the call by the part before its colon", () => {
    expect(shortTitle("Planning: VHI 8.0 drawer redesign")).toBe("Planning");
    expect(shortTitle("Standup")).toBe("Standup");
    expect(shortTitle(null)).toBe("");
  });
});
