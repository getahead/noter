import { describe, expect, it, vi } from "vitest";

import { afterNaming, afterVoiceChange } from "./focus-return";

const doc = (found: string[]) => {
  const focus = vi.fn();
  return { focus, doc: { activeElement: null, body: {}, getElementById: (id: string) => (found.includes(id) ? { hasAttribute: () => false, focus: () => focus(id) } : null) } as never };
};

describe("cpt-noter-flow-ui-people-name focus return", () => {
  it("after naming, focus goes to the first Name…, else to Add Person", () => {
    const a = doc(["pe-name-first", "pl-add"]);
    expect(afterNaming(a.doc)).toBe(true);
    expect(a.focus).toHaveBeenCalledWith("pe-name-first");
    const b = doc(["pl-add"]);
    afterNaming(b.doc);
    expect(b.focus).toHaveBeenCalledWith("pl-add");
  });
  it("a changed voice profile hands focus to the other button; no change or no first read does nothing", () => {
    const created = doc(["pe-voice-delete"]);
    expect(afterVoiceChange(created.doc, false, true)).toBe(true);
    expect(created.focus).toHaveBeenCalledWith("pe-voice-delete");
    const deleted = doc(["pe-voice-setup"]);
    afterVoiceChange(deleted.doc, true, false);
    expect(deleted.focus).toHaveBeenCalledWith("pe-voice-setup");
    const none = doc(["pe-voice-setup", "pe-voice-delete"]);
    expect(afterVoiceChange(none.doc, true, true)).toBe(false);
    expect(afterVoiceChange(none.doc, undefined, false)).toBe(false);
    expect(none.focus).not.toHaveBeenCalled();
  });
});
