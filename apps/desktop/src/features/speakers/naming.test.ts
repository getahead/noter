import { describe, expect, it } from "vitest";

import type {
  PersonChip,
  PlaybackState,
  SegmentView,
  SpeakerView,
} from "../../core/bindings";
import {
  chipsFor,
  firstLine,
  fixMessage,
  panelRows,
  rangeOf,
  samplePlaying,
  selectionRange,
  staleFix,
} from "./naming";

const chip = (id: string, name: string, is_you = false): PersonChip => ({
  id,
  display_name: name,
  short_name: name.split(" ")[0],
  initials: name.slice(0, 2),
  is_you,
});
const spk = (
  id: string,
  label: SpeakerView["label"],
  over: Partial<SpeakerView> = {},
): SpeakerView =>
  ({
    id,
    call_id: "c1",
    label,
    channel: "system",
    segment_count: 2,
    talk_ms: null,
    sample: null,
    suggestion: null,
    named_by: null,
    ...over,
  }) as SpeakerView;
const seg = (
  id: string,
  speaker_id: string,
  text: string,
  t0_ms: number,
): SegmentView =>
  ({ id, text, t0_ms, speaker: { speaker_id } }) as unknown as SegmentView;

describe("panelRows", () => {
  const speakers = [
    spk("a", { type: "you" }),
    spk("s3", { type: "unnamed", n: 3 }),
    spk("s4", { type: "unnamed", n: 4 }),
    spk("p", { type: "person", person: chip("p1", "Pavel R.") }),
  ];
  it("lists the unnamed speakers, and the skipped ones apart", () => {
    const r = panelRows(speakers, new Set(["s4"]));
    expect(r.open.map((s) => s.id)).toEqual(["s3"]);
    expect(r.skipped.map((s) => s.id)).toEqual(["s4"]);
    expect(r.unnamed).toBe(2);
  });
  it("a skipped speaker is never counted as named", () => {
    expect(panelRows(speakers, new Set(["s3", "s4"])).unnamed).toBe(2);
  });
  it("nothing unnamed leaves no rows", () => {
    expect(panelRows([speakers[0], speakers[3]], new Set()).unnamed).toBe(0);
  });
});

describe("chipsFor", () => {
  it("offers the speaker's suggestion first, then the participants no speaker carries, never you", () => {
    const speakers = [
      spk(
        "s3",
        { type: "unnamed", n: 3 },
        { suggestion: chip("p2", "Anna K.") },
      ),
      spk("p", { type: "person", person: chip("p1", "Pavel R.") }),
    ];
    const people = [
      chip("me", "Me", true),
      chip("p1", "Pavel R."),
      chip("p2", "Anna K."),
      chip("p3", "Dmitri S."),
    ];
    expect(chipsFor(speakers[0], speakers, people).map((c) => c.id)).toEqual([
      "p2",
      "p3",
    ]);
  });
});

describe("firstLine", () => {
  it("is the first confirmed line of that speaker by time", () => {
    const segs = [
      seg("1", "b", "other", 0),
      seg("3", "a", "later", 9),
      seg("2", "a", "first", 4),
    ];
    expect(firstLine(segs, "a")).toBe("first");
    expect(firstLine(segs, "zzz")).toBeNull();
  });
});

describe("samplePlaying", () => {
  const pb = (over: Partial<PlaybackState>): PlaybackState =>
    ({
      version: 5,
      playing: false,
      call_id: "c1",
      position_ms: 0,
      to_ms: null,
      route: "headphones",
      stopped_reason: null,
      ...over,
    }) as PlaybackState;
  it("shows Playing… until the core reports the sample ended", () => {
    expect(samplePlaying({ callId: "c1", since: 4 }, undefined)).toBe(true);
    expect(samplePlaying({ callId: "c1", since: 4 }, pb({ version: 4 }))).toBe(
      true,
    ); // an older report is not about it
    expect(
      samplePlaying({ callId: "c1", since: 4 }, pb({ playing: true })),
    ).toBe(true);
    expect(
      samplePlaying(
        { callId: "c1", since: 4 },
        pb({ stopped_reason: "ended" }),
      ),
    ).toBe(false);
    expect(samplePlaying(null, pb({ playing: true }))).toBe(false);
  });
});

describe("selection → TextRange", () => {
  it("counts UTF-16 units, so astral characters keep the range on the right word", () => {
    expect(rangeOf("😀 ab cd", 3, 5)).toEqual({ start: 3, end: 5 });
    expect(selectionRange("hello world", 6, 11)).toEqual({ start: 6, end: 11 });
  });
  it("an empty or reversed selection has no range", () => {
    expect(selectionRange("hello", 2, 2)).toBeNull();
    expect(selectionRange("hello", 4, 1)).toEqual({ start: 1, end: 4 });
    expect(selectionRange("hello", 0, 99)).toEqual({ start: 0, end: 5 });
  });
});

describe("fix results", () => {
  it("says added to the glossary only when the core returned a term", () => {
    expect(fixMessage("notification service", "gt_1")).toBe(
      "Fixed “notification service” · added to the glossary",
    );
    expect(fixMessage("notification service", null)).toBe(
      "Fixed “notification service”",
    );
  });
  it("a stale range or an invalid one asks to select again, anything else retries", () => {
    expect(staleFix("not_found")).toBe(true);
    expect(staleFix("invalid_input")).toBe(true);
    expect(staleFix("internal")).toBe(false);
  });
});
