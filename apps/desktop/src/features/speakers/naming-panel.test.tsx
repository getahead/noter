import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import type { PersonChip, SegmentView, SpeakerView } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { SpeakerNamingPanel } from "./SpeakerNamingPanel";

const chip = (id: string, name: string): PersonChip => ({
  id,
  display_name: name,
  short_name: name.split(" ")[0],
  initials: name.slice(0, 2),
  is_you: false,
});
const spk = (
  id: string,
  n: number,
  over: Partial<SpeakerView> = {},
): SpeakerView =>
  ({
    id,
    call_id: "c1",
    label: { type: "unnamed", n },
    channel: "system",
    segment_count: 4,
    talk_ms: null,
    sample: { call_id: "c1", t0_ms: 1000, t1_ms: 6000 },
    suggestion: null,
    named_by: null,
    ...over,
  }) as SpeakerView;
const seg = (id: string, speaker_id: string, text: string): SegmentView =>
  ({ id, text, t0_ms: 10, speaker: { speaker_id } }) as unknown as SegmentView;

const bridge = (over: Record<string, unknown> = {}) =>
  ({
    core: {
      peopleList: async () => ({
        status: "error",
        error: { code: "not_implemented" },
      }),
      transcriptNameSpeakers: async () => ({
        status: "error",
        error: { code: "not_found" },
      }),
      audioPlay: async () => ({ status: "ok", data: {} }),
      ...over,
    },
    act: async (_k: string, _c: string, run: () => Promise<unknown>) => run(),
    store: { getState: () => ({ whole: {} }), subscribe: () => () => {} },
  }) as unknown as Bridge;

const props = (over = {}) => ({
  bridge: bridge(),
  callId: "c1",
  speakers: [spk("s3", 3), spk("s4", 4, { sample: null })],
  segments: [seg("g1", "s3", "Hello from three")],
  participants: [chip("p1", "Pavel Romanov")],
  audio: true,
  ...over,
});

describe("SpeakerNamingPanel", () => {
  it("lists a row per unnamed speaker with its first line, count, sample and invitation chip", () => {
    const html = renderToString(<SpeakerNamingPanel {...props()} />);
    expect(html).toContain("Name speakers · 2 not named");
    expect(html).toContain("Hello from three");
    expect(html).toContain("4 lines");
    expect(html).toContain("Play Sample");
    expect(html).toContain("Pavel Romanov");
    expect(html).toContain('data-region="PC-R9"');
  });
  it("hides Play Sample when the audio is gone", () => {
    expect(
      renderToString(<SpeakerNamingPanel {...props({ audio: false })} />),
    ).not.toContain("Play Sample");
  });
  it("draws nothing when every speaker is named", () => {
    const named = spk("s1", 1, { label: { type: "you" } } as never);
    expect(
      renderToString(<SpeakerNamingPanel {...props({ speakers: [named] })} />),
    ).toBe("");
  });
  it("Skip sends the speaker with no person", async () => {
    const sent: unknown[] = [];
    const b = bridge({
      transcriptNameSpeakers: async (a: unknown) => (
        sent.push(a),
        { status: "ok", data: { speakers: [], change_id: "x" } }
      ),
    });
    const tree = rendered(SpeakerNamingPanel, props({ bridge: b }));
    (
      find(tree, (pr) => "onSkip" in pr).props as { onSkip: () => void }
    ).onSkip();
    await vi.waitFor(() =>
      expect(sent).toEqual([
        { call_id: "c1", assignments: [{ speaker_id: "s3", person: null }] },
      ]),
    );
  });
});
