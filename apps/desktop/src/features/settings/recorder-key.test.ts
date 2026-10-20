import { describe, expect, it } from "vitest";

import { onRecordKey, type RecorderKey } from "./recorder-key";

const key = (over: Partial<RecorderKey> = {}): RecorderKey => ({ code: "KeyU", ctrlKey: true, altKey: true, metaKey: true, shiftKey: false, repeat: false, ...over });

describe("onRecordKey", () => {
  it("ignores keys while the field is not recording and held-key repeats", () => {
    expect(onRecordKey(false, key(), "single")).toBeNull();
    expect(onRecordKey(true, key({ repeat: true }), "single")).toBeNull();
  });

  it("sends the accepted chord by its physical code with the held modifiers", () => {
    expect(onRecordKey(true, key({ shiftKey: true }), "single")?.send).toEqual({
      type: "record",
      code: "KeyU",
      modifiers: { control: true, option: true, command: true, shift: true },
    });
  });

  it("sends a clear on backspace and nothing on cancel, wait or a refused chord", () => {
    const bare = { ctrlKey: false, altKey: false, metaKey: false };
    expect(onRecordKey(true, key({ ...bare, code: "Backspace" }), "single")?.send).toEqual({ type: "clear" });
    expect(onRecordKey(true, key({ ...bare, code: "Escape" }), "single")).toMatchObject({ event: { result: { type: "cancel" } }, send: null });
    expect(onRecordKey(true, key({ code: "ShiftLeft" }), "single")?.send).toBeNull();
    expect(onRecordKey(true, key({ ...bare, code: "KeyN" }), "single")).toMatchObject({ event: { result: { type: "keep", reason: "no_modifier" } }, send: null });
  });

  it("records a modifier set on the modifiers alone", () => {
    expect(onRecordKey(true, key({ code: "ControlLeft" }), "modifier-set")?.send).toMatchObject({ type: "record" });
  });
});
