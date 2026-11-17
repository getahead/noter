import { describe, expect, it, vi } from "vitest";

import { afterNaming, afterVoiceAlert, afterVoiceChange, settleNaming } from "./focus-return";

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
  it("a naming waits for the read, focuses once it is read, and is forgotten when the read fails", () => {
    const a = doc(["pl-add"]);
    expect(settleNaming(a.doc, true, "LOADING")).toBe(true);
    expect(a.focus).not.toHaveBeenCalled();
    expect(settleNaming(a.doc, true, "READ")).toBe(false);
    expect(a.focus).toHaveBeenCalledWith("pl-add");
    const b = doc(["pl-add"]);
    expect(settleNaming(b.doc, true, "ERROR")).toBe(false); // a later read must not take focus for a naming that is long past
    expect(b.focus).not.toHaveBeenCalled();
    expect(settleNaming(b.doc, false, "READ")).toBe(false);
    expect(b.focus).not.toHaveBeenCalled();
  });
  it("after the Delete Profile alert, focus goes back to Delete Profile…", () => {
    const a = doc(["pe-voice-delete"]);
    expect(afterVoiceAlert(a.doc)).toBe(true);
    expect(a.focus).toHaveBeenCalledWith("pe-voice-delete");
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
