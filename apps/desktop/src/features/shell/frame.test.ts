import { describe, expect, it } from "vitest";

import type { CapturePhase } from "../../core/bindings";
import { frameState, type FrameInput } from "./frame";

const input = (o: Partial<FrameInput> = {}): FrameInput => ({ snapshotApplied: true, phase: "idle", hidden: false, ...o });

describe("frameState", () => {
  it("is LOADING until the app snapshot is applied, whatever else arrived", () => {
    expect(frameState(input({ snapshotApplied: false }))).toBe("LOADING");
    expect(frameState(input({ snapshotApplied: false, phase: "recording", hidden: true }))).toBe("LOADING");
  });

  it("is READY once applied and nothing records", () => {
    for (const phase of ["idle", "starting", "failed"] as CapturePhase[]) expect(frameState(input({ phase }))).toBe("READY");
  });

  it.each(["recording", "paused"] as CapturePhase[])("is CAPTURING while %s, and READY again when capture stops", (phase) => {
    expect(frameState(input({ phase }))).toBe("CAPTURING");
    expect(frameState(input())).toBe("READY");
  });

  it("is HIDDEN_FOR_PRESENTING from READY or CAPTURING, and returns to the state capture is in", () => {
    expect(frameState(input({ hidden: true }))).toBe("HIDDEN_FOR_PRESENTING");
    expect(frameState(input({ hidden: true, phase: "recording" }))).toBe("HIDDEN_FOR_PRESENTING");
    expect(frameState(input({ phase: "recording" }))).toBe("CAPTURING");
    expect(frameState(input())).toBe("READY");
  });
});
