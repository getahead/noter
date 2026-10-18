import { describe, expect, it } from "vitest";

import type { Result } from "../../src/core/bindings";
import { ahead, pending } from "./results";

const notImplemented = (message: string): Result<number> => ({
  status: "error",
  error: { code: "not_implemented", message, retryable: false, detail: null },
});

describe("pending and ahead judge not_implemented by milestone", () => {
  it("waits for a command of a later milestone", () => {
    expect(pending(notImplemented("capture_start"), "M0")).toBe(true); // M1
    expect(ahead(notImplemented("today_get"))).toBeNull(); // M2, later than the harness's current
  });

  it("fails once the command's milestone is current or past", () => {
    expect(() => pending(notImplemented("capture_start"), "M1")).toThrow("capture_start is delivered in M1 (current M1)");
    expect(() => pending(notImplemented("settings_get"), "M2")).toThrow(/delivered in M0/);
  });

  it("stays pending when the refusal names no placed command, and ignores other results", () => {
    expect(pending(notImplemented("harness.push: no scripted stream"), "M5")).toBe(true);
    expect(pending({ status: "ok", data: 1 }, "M5")).toBe(false);
    expect(pending({ status: "error", error: { code: "not_found", message: "x", retryable: false, detail: null } }, "M5")).toBe(false);
  });
});
