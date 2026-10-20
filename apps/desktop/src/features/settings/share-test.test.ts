import { describe, expect, it } from "vitest";

import type { ShareTestRow } from "../../core/bindings";
import { resultRows, shareTestReduce, surfaceKey, visibilityKey } from "./share-test";

describe("shareTestReduce", () => {
  it("asks for Screen Recording once before running, and runs at once when it is granted", () => {
    expect(shareTestReduce("TABLE", { type: "run", screenRecording: "not_asked" })).toBe("ASKING");
    expect(shareTestReduce("TABLE", { type: "run", screenRecording: "granted" })).toBe("RUNNING");
    expect(shareTestReduce("RUNNING", { type: "run", screenRecording: "granted" })).toBe("RUNNING");
  });

  it("runs after Continue is granted and keeps the permission row with the Open System Settings… link when it is refused", () => {
    expect(shareTestReduce("ASKING", { type: "answered", granted: true })).toBe("RUNNING");
    expect(shareTestReduce("ASKING", { type: "answered", granted: false })).toBe("NEEDS_PERMISSION");
    expect(shareTestReduce("TABLE", { type: "answered", granted: true })).toBe("TABLE");
  });

  it("shows the result, the failure, or the table again when a call blocked it", () => {
    expect(shareTestReduce("RUNNING", { type: "outcome", outcome: { type: "passed", at: 1 } })).toBe("RAN");
    expect(shareTestReduce("RUNNING", { type: "outcome", outcome: { type: "failed", code: "offline" } })).toBe("FAILED");
    expect(shareTestReduce("RUNNING", { type: "outcome", outcome: { type: "blocked_by_call" } })).toBe("TABLE");
    expect(shareTestReduce("TABLE", { type: "outcome", outcome: { type: "passed", at: 1 } })).toBe("TABLE");
  });
});

describe("rows", () => {
  const row = (surface: ShareTestRow["surface"], window_share: ShareTestRow["window_share"]): ShareTestRow => ({ surface, window_share, app_share: window_share, display_share: window_share });

  it("judges each surface by the window share", () => {
    expect(resultRows([row("call_window", "hidden"), row("main_window", "visible"), row("menu_bar_title", "depends_on_app")])).toEqual([
      { surface: "call_window", message: "settings.share.result_hidden", ok: true },
      { surface: "main_window", message: "settings.share.result_visible", ok: false },
      { surface: "menu_bar_title", message: "settings.share.result_maybe", ok: false },
    ]);
  });

  it("names every visibility and surface in the catalogue", () => {
    expect(visibilityKey("depends_on_app")).toBe("settings.share.maybe");
    expect(surfaceKey("record_prompt")).toBe("settings.share.surface_record_prompt");
  });
});
