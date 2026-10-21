import { describe, expect, it } from "vitest";

import { holdMore, onRecordKey, releasedSet, type RecorderKey } from "./recorder-key";

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

  it("holds a modifier set instead of sending it on the first modifier", () => {
    expect(onRecordKey(true, key({ code: "ControlLeft", altKey: false, metaKey: false }), "modifier-set")?.send).toEqual({
      type: "hold",
      modifiers: { control: true, option: false, command: false, shift: false },
    });
  });
});

describe("a modifier set is saved once, when the keys are released", () => {
  const down = (code: string, over: Partial<RecorderKey>) => key({ code, ctrlKey: false, altKey: false, metaKey: false, ...over });
  const up = { ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };

  it("collects Control, Option and Command pressed one after another and saves ⌃⌥⌘ on the last release", () => {
    let held = null as ReturnType<typeof holdMore> | null;
    for (const e of [down("ControlLeft", { ctrlKey: true }), down("AltLeft", { ctrlKey: true, altKey: true }), down("MetaLeft", { ctrlKey: true, altKey: true, metaKey: true })]) {
      const out = onRecordKey(true, e, "modifier-set");
      expect(out?.send?.type).toBe("hold");
      held = holdMore(held, (out!.send as { modifiers: Parameters<typeof holdMore>[1] }).modifiers);
      expect(releasedSet(held, e)).toBeNull(); // keys still down
    }
    expect(releasedSet(held, { ...up, ctrlKey: true })).toBeNull(); // one key let go, others still down
    expect(releasedSet(held, up)).toEqual({ control: true, option: true, command: true, shift: false });
  });

  it("saves nothing when nothing was held", () => expect(releasedSet(null, up)).toBeNull());
});
