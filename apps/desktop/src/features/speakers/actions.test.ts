import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import type { SegmentView, SpeakerView } from "../../core/bindings";
import { selectedRange } from "../transcript/segment-row";
import { nameSpeaker } from "./SpeakerNamingPanel";
import { applyFix } from "./TermFixPopover";

const segment = { id: "seg1", call_id: "c1", text: "send the notification surface" } as unknown as SegmentView;
const speaker = { id: "s3", label: { type: "unnamed", n: 3 }, segment_count: 4 } as unknown as SpeakerView;
const bridge = (res: unknown) => {
  const setState = vi.fn();
  return { b: { act: async (_k: string, _c: string, run: () => unknown) => (run(), res), core: { transcriptFixTerm: () => 0, transcriptNameSpeakers: () => 0, transcriptSpan: async () => ({ status: "ok", data: { segments: [] } }) }, store: { setState } } as unknown as Bridge, setState };
};

describe("applyFix", () => {
  it("applies the returned segment and says what was fixed", async () => {
    const { b, setState } = bridge({ status: "ok", data: { segment, glossary_term_id: "g1", change_id: "ch1" } });
    const command = vi.spyOn(b.core, "transcriptFixTerm");
    expect(await applyFix(b, segment, { start: 9, end: 21 }, "alert service", true)).toEqual({ message: expect.stringContaining("alert service"), change_id: "ch1" });
    expect(setState).toHaveBeenCalled();
    expect(command).toHaveBeenCalledWith({ call_id: "c1", segment_id: "seg1", range: { start: 9, end: 21 }, replacement: "alert service", add_to_glossary: true });
  });
  it("refreshes the stale segment and requires a new selection before another correction", async () => {
    const { b, setState } = bridge({ status: "error", error: { code: "invalid_input" } });
    const fresh = { ...segment, text: "new wording" };
    const read = vi.spyOn(b.core, "transcriptSpan").mockResolvedValue({ status: "ok", data: { segments: [fresh] } } as never);
    const out = await applyFix(b, { ...segment, t0_ms: 100, t1_ms: 200 }, { start: 0, end: 4 }, "word", false);
    expect(read).toHaveBeenCalledWith({ span: { call_id: "c1", t0_ms: 100, t1_ms: 200 } });
    expect(setState).toHaveBeenCalledOnce();
    expect(out).toEqual({ error: expect.any(String), reselect: true });
  });
  it("a stale range asks to select again, any other failure says it failed", async () => {
    const stale = await applyFix(bridge({ status: "error", error: { code: "not_found" } }).b, segment, { start: 0, end: 1 }, "x", false);
    const other = await applyFix(bridge({ status: "error", error: { code: "internal" } }).b, segment, { start: 0, end: 1 }, "x", false);
    expect("error" in stale && "error" in other && stale.error !== other.error).toBe(true);
  });
});

describe("nameSpeaker", () => {
  it("returns the undo for the named speaker with its line count", async () => {
    const named = { ...speaker, label: { type: "person", person: { short_name: "Pavel" } }, segment_count: 7 };
    const { b } = bridge({ status: "ok", data: { speakers: [named], change_id: "ch" } });
    const out = await nameSpeaker(b, "c1", speaker, { type: "existing", person_id: "p1" }, "Pavel R.");
    expect(out).toEqual({ undo: { refresh: expect.any(Function), target: { type: "change", change_id: "ch" }, message: expect.stringContaining("Pavel") } });
    expect(JSON.stringify(out)).toContain("7");
  });
  it("the undo re-reads the call's speakers into the store", async () => {
    const { b, setState } = bridge({ status: "ok", data: { speakers: [], change_id: "ch" } });
    (b.core as unknown as { callGet: unknown }).callGet = async () => ({ status: "ok", data: { speakers: [speaker] } });
    const out = await nameSpeaker(b, "c1", speaker, { type: "existing", person_id: "p1" }, "P");
    await (out as { undo: { refresh: () => Promise<void> } }).undo.refresh();
    expect(setState).toHaveBeenCalledTimes(1);
  });
  it("falls back to the typed name and the speaker's own count", async () => {
    const { b } = bridge({ status: "ok", data: { speakers: [], change_id: "ch" } });
    expect(JSON.stringify(await nameSpeaker(b, "c1", speaker, { type: "new", display_name: "Zoya" } as never, "Zoya"))).toContain("Zoya");
  });
  it("says the speaker is gone on not_found, and that naming failed otherwise", async () => {
    const gone = await nameSpeaker(bridge({ status: "error", error: { code: "not_found" } }).b, "c1", speaker, { type: "existing", person_id: "p" }, "P");
    const failed = await nameSpeaker(bridge({ status: "error", error: { code: "internal" } }).b, "c1", speaker, { type: "existing", person_id: "p" }, "P");
    expect("error" in gone && "error" in failed && gone.error !== failed.error).toBe(true);
  });
});

describe("selectedRange", () => {
  const fakeDoc = (pre: string) => ({ createRange: () => ({ selectNodeContents() {}, setEnd() {}, toString: () => pre }) });
  const el = (inside: boolean) => ({ contains: () => inside }) as unknown as HTMLElement;
  const sel = (collapsed: boolean, text: string) => ({ rangeCount: 1, isCollapsed: collapsed, getRangeAt: () => ({ startContainer: {}, endContainer: {}, startOffset: 0, toString: () => text }) }) as unknown as Selection;
  it("maps a selection inside the line to text offsets", () => {
    vi.stubGlobal("document", fakeDoc("send the "));
    expect(selectedRange(el(true), sel(false, "notification"))).toEqual({ start: 9, end: 21 });
    vi.unstubAllGlobals();
  });
  it("is null for no selection, a collapsed one or one outside the line", () => {
    expect(selectedRange(el(true), null)).toBeNull();
    expect(selectedRange(el(true), sel(true, ""))).toBeNull();
    expect(selectedRange(el(false), sel(false, "x"))).toBeNull();
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
