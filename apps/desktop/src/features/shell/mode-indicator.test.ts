import { describe, expect, it } from "vitest";

import type { DegradedState, PrivacyMode } from "../../core/bindings";
import { modeIndicator, type ModeInput } from "./mode-indicator";

const switched = { type: "switched_to_local", call_id: null, reason: "unavailable", retry_at: null } as unknown as DegradedState;
const noAssistant: DegradedState = { type: "no_assistant" };
const input = (o: Partial<ModeInput> = {}): ModeInput => ({ mode: "cloud_redacted", degraded: [], sensitiveCall: false, ...o });

describe("modeIndicator", () => {
  it("starts CLOUD_REDACTED, the default privacy mode", () => {
    expect(modeIndicator(input())).toEqual({ state: "CLOUD_REDACTED", warning: false });
  });

  it.each([
    ["cloud_allowed", "CLOUD"],
    ["cloud_redacted", "CLOUD_REDACTED"],
    ["local_only", "LOCAL_ONLY"],
  ] as [PrivacyMode, string][])("maps the %s privacy mode", (mode, state) => {
    expect(modeIndicator(input({ mode }))).toEqual({ state, warning: false });
  });

  it("is SENSITIVE_LOCAL for a sensitive call in view", () => {
    expect(modeIndicator(input({ sensitiveCall: true }))).toEqual({ state: "SENSITIVE_LOCAL", warning: false });
  });

  it("warns on switched_to_local and no_assistant, and clears when the degraded set clears", () => {
    expect(modeIndicator(input({ degraded: [switched] }))).toEqual({ state: "SWITCHED_TO_LOCAL", warning: true });
    expect(modeIndicator(input({ degraded: [noAssistant] }))).toEqual({ state: "NO_ASSISTANT", warning: true });
    expect(modeIndicator(input({ degraded: [] })).state).toBe("CLOUD_REDACTED");
  });

  it("lets a degraded state win over the mode and over a sensitive call, and no assistant over a switch", () => {
    expect(modeIndicator(input({ mode: "local_only", sensitiveCall: true, degraded: [switched] })).state).toBe("SWITCHED_TO_LOCAL");
    expect(modeIndicator(input({ degraded: [switched, noAssistant] })).state).toBe("NO_ASSISTANT");
  });

  it("ignores degraded states that are not about the assistant", () => {
    expect(modeIndicator(input({ degraded: [{ type: "disk_full", free_mb: 1 }] })).state).toBe("CLOUD_REDACTED");
  });
});
