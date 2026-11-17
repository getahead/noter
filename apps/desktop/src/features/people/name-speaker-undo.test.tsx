import { describe, expect, it, vi } from "vitest";

import type { UnnamedSpeaker } from "../../core/bindings";
import { nameSpeaker } from "./NameSpeakerPopover";
import { bumpPerson } from "./person-store";

const held = vi.hoisted(() => vi.fn());
vi.mock("../history/undo", () => ({ holdUndo: held }));

describe("cpt-noter-flow-ui-people-name Undo", () => {
  it("Undo of a naming re-reads People: the strip's refresh bumps the page's reload counter", async () => {
    const u = { call: { id: "call_1", title: "Sync" }, speaker_id: "spk_3", n: 3, segment_count: 4, sample: null, suggestion: null } as unknown as UnnamedSpeaker;
    const res = { status: "ok", data: { change_id: "chg_1", speakers: [{ id: "spk_3", segment_count: 4, label: { type: "person", person: { short_name: "Dmitri S." } } }] } };
    const bridge = { act: async (_k: string, _c: string, run: () => unknown) => (run(), res), core: { transcriptRenameSpeaker: vi.fn() } } as never;
    expect(await nameSpeaker(bridge, u, { type: "existing", person_id: "per_d" }, "Dmitri")).toBe(true);
    expect(held.mock.calls[0]![0].refresh).toBe(bumpPerson);
    expect(held.mock.calls[0]![0].message).toBe("Named Speaker 3 as Dmitri S. in 1 call");
  });
});
