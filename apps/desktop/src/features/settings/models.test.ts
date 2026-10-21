import { describe, expect, it } from "vitest";

import type { BundleState } from "../../core/bindings";
import { modelAction, modelKey, statusKey } from "./models";

describe("modelAction", () => {
  it.each([
    ["pending", "start", "settings.models.download"],
    ["paused", "resume", "settings.models.resume"],
    ["failed", "retry", "settings.models.retry"],
    ["checksum_failed", "retry", "settings.models.retry"],
  ] as const)("%s offers %s", (state, action, label) => expect(modelAction({ state })).toEqual({ action, label }));

  it.each(["ready", "downloading", "verifying"] as BundleState[])("%s offers nothing", (state) => expect(modelAction({ state })).toBeNull());

  it("names every state", () => expect(statusKey("ready")).toBe("settings.models.ready"));
  it("keys a bundle's button", () => expect(modelKey("turbo")).toBe("models:turbo"));
});
