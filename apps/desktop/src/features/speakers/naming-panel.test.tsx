import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import type { PersonChip, SegmentView, SpeakerView } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { NameRow, SpeakerNamingPanel } from "./SpeakerNamingPanel";

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
  ({ id, text, t0_ms: 10, state: "confirmed", lang: "ru", speaker: { speaker_id } }) as unknown as SegmentView;

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
    store: { getState: () => ({ whole: {}, entities: { person: {} } }), subscribe: () => () => {} },
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
  it("keeps the count with the label and quote, sample, picker and person chips in the body", () => {
    const tree = rendered(NameRow, { p: props(), speaker: spk("s3", 3), people: null, line: seg("g1", "s3", "Обсудим план"), onSkip: () => {} });
    const label = find(tree, (p) => p.className === "pc-name__label");
    expect(renderToString(label)).toContain("4 lines");
    const body = find(tree, (p) => p.className === "pc-name__body");
    const html = renderToString(body);
    expect(html).toContain('<q class="pc-name__quote" lang="ru">Обсудим план</q>');
    expect(html).toContain("Play Sample");
    expect(html).toContain('data-component="cpt-noter-component-ui-person-chip"');
    expect(find(body, (p) => "onConfirm" in p)).toBeTruthy();
    const actions = find(tree, (p) => p.className === "pc-name__acts");
    expect(find(actions, (p) => p.label === "Name").props.size).toBe("small");
    expect(find(actions, (p) => p.label === "Skip").props.variant).toBe("quiet");
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
  it("claims the active sample row when requesting playback", () => {
    const tree = rendered(NameRow, { p: props(), speaker: spk("s3", 3), people: null, line: null, onSkip: () => {}, sampleActive: false, onSample: vi.fn() });
    expect(find(tree, (p) => p.label === "Play Sample")).toBeTruthy();
    const claim = vi.fn();
    const active = rendered(NameRow, { p: props(), speaker: spk("s4", 4), people: null, line: null, onSkip: () => {}, sampleActive: true, onSample: claim });
    (find(active, (p) => p.label === "Play Sample").props as { onAction: () => void }).onAction();
    expect(claim).toHaveBeenCalledOnce();
  });
  it("Name, a picked chip, the picker and Hide reach the core and the row's state", async () => {
    const sent: unknown[] = [];
    const b = bridge({
      transcriptNameSpeakers: async (a: unknown) => (sent.push(a), { status: "error", error: { code: "not_found" } }),
    });
    const sp = spk("s3", 3, { suggestion: { type: "existing", person_id: "p1" } } as never);
    const tree = rendered(NameRow, { p: props({ bridge: b, speakers: [sp] }), speaker: sp, people: null, line: seg("g1", "s3", "hi"), onSkip: () => {} });
    const picker = find(tree, (pr) => "onConfirm" in pr).props as {
      onPick: (r: unknown, to: string) => void;
      onConfirm: (r: unknown, to: string) => void;
    };
    picker.onPick({ type: "existing", person_id: "p1" }, "Pavel Romanov");
    picker.onPick(null, "x");
    picker.onConfirm({ type: "existing", person_id: "p1" }, "Pavel Romanov");
    (find(tree, (pr) => pr.label === "Name").props as { onAction: () => void }).onAction();
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    const panel = rendered(SpeakerNamingPanel, props());
    (find(panel, (pr) => pr.label === "Hide ▴").props as { onAction: () => void }).onAction();
  });
});
