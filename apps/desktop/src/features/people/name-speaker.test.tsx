import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PersonRow, UnnamedSpeaker } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { undoMode } from "../history/undo";
import { NameSpeakerPopover, nameSpeaker, readSample } from "./NameSpeakerPopover";

const u = (o: Partial<UnnamedSpeaker> = {}): UnnamedSpeaker => ({ call: { id: "call_1", title: "Sync", started_at: 0, call_type: "x" } as never, speaker_id: "spk_3", n: 3, segment_count: 4, sample: { call_id: "call_1", t0_ms: 0, t1_ms: 1 } as never, suggestion: null, ...o });
const bridgeOf = (res: unknown) => ({ act: vi.fn(async (_k: string, _c: string, run: () => unknown) => (run(), res)), core: { transcriptSpan: vi.fn(), transcriptRenameSpeaker: vi.fn() }, store: { getState: () => ({ entities: { person: {} } }), subscribe: () => () => {} } }) as never;
const flush = () => new Promise((r) => setTimeout(r));
const named = { status: "ok", data: { change_id: "chg_1", speakers: [{ id: "spk_3", segment_count: 4, label: { type: "person", person: { short_name: "Dmitri S." } } }] } };

describe("cpt-noter-flow-ui-people-name", () => {
  it("the sample is the first spoken line in its own language; no sample, or a failed read, shows none", async () => {
    expect(await readSample(bridgeOf({ status: "ok", data: { segments: [{ text: " ", lang: "en" }, { text: "Привет", lang: "ru" }] } }), u())).toEqual({ text: "Привет", lang: "ru" });
    expect(await readSample(bridgeOf({}), u({ sample: null }))).toBeNull();
    expect(await readSample(bridgeOf({ status: "error", error: { code: "internal" } }), u())).toBeNull();
  });
  it("names the speaker in its call and puts the core's change in the Undo strip; a refusal says no", async () => {
    const b = bridgeOf(named) as { core: { transcriptRenameSpeaker: ReturnType<typeof vi.fn> } };
    expect(await nameSpeaker(b as never, u(), { type: "existing", person_id: "per_d" }, "Dmitri")).toBe(true);
    expect(b.core.transcriptRenameSpeaker).toHaveBeenCalledWith({ call_id: "call_1", speaker_id: "spk_3", person: { type: "existing", person_id: "per_d" }, scope: { type: "whole_call" } });
    expect(undoMode()).toBe("undo");
    expect(await nameSpeaker(bridgeOf({ status: "error", error: { code: "not_found" } }), u(), { type: "new", display_name: "Zoya" }, "Zoya")).toBe(false);
  });
  it("the popover is named after the speaker and says the change covers this call only", () => {
    const people = [{ id: "per_d", display_name: "Dmitri Sokolov", short_name: "Dmitri S.", initials: "DS", aliases: [], is_you: false } as unknown as PersonRow];
    const h = renderToString(<NameSpeakerPopover bridge={bridgeOf({})} speaker={u()} people={people} anchor={null} onClose={() => {}} />);
    expect(h).toContain("Name Speaker 3");
    expect(h).toContain("Names Speaker 3 in this call as one change you can undo.");
    expect(h).not.toContain("all 3 calls");
  });
  it("the picker's confirm names the speaker and closes; a refused one stays open", async () => {
    const onClose = vi.fn();
    const onNamed = vi.fn();
    const tree = rendered(NameSpeakerPopover, { bridge: bridgeOf(named), speaker: u(), people: [], anchor: null, onClose, onNamed });
    const picker = find(tree, (p) => typeof p.onConfirm === "function");
    await (picker.props.onConfirm as (r: unknown, n: string) => Promise<void>)({ type: "existing", person_id: "per_d" }, "Dmitri");
    await flush();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onNamed).toHaveBeenCalledOnce(); // the list is read again: the core emits no person change for a rename
    const refused = rendered(NameSpeakerPopover, { bridge: bridgeOf({ status: "error", error: { code: "internal" } }), speaker: u(), people: [], anchor: null, onClose });
    await (find(refused, (p) => typeof p.onConfirm === "function").props.onConfirm as (r: unknown, n: string) => Promise<void>)({ type: "existing", person_id: "per_d" }, "Dmitri");
    await flush();
    expect(onClose).toHaveBeenCalledOnce();
    (picker.props.onPick as () => void)();
    (picker.props.onForm as (o: boolean) => void)(true);
  });
});
