import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import type { PersonChip, SpeakerView } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { PersonPicker } from "./PersonPicker";
import { SpeakerRenamePopover } from "./SpeakerRenamePopover";

const chip = (id: string, name: string): PersonChip => ({ id, display_name: name, short_name: name.split(" ")[0], initials: name.slice(0, 2), is_you: false });
const spk = (over: Partial<SpeakerView> = {}): SpeakerView =>
  ({ id: "spk_3", call_id: "c1", label: { type: "unnamed", n: 3 }, channel: "system", segment_count: 4, talk_ms: null, sample: null, suggestion: null, named_by: null, ...over }) as SpeakerView;

const bridgeFor = (answer: unknown, sent: unknown[] = []) =>
  ({
    core: { peopleList: async () => ({ status: "error", error: { code: "not_implemented" } }), transcriptRenameSpeaker: async (a: unknown) => (sent.push(a), answer) },
    act: async (_k: string, _c: string, run: () => Promise<unknown>) => run(),
  }) as unknown as Bridge;

describe("PersonPicker", () => {
  it("lists In this call with the New Person… entry last, and offers the quoted query when nothing matches", () => {
    const html = renderToString(<PersonPicker bridge={bridgeFor(null)} variant="popover" participants={[chip("p1", "Pavel Romanov"), chip("p2", "Anna K.")]} speakers={[]} confirmLabel="Create and Name" onPick={() => {}} />);
    expect(html).toContain("In this call");
    expect(html.indexOf("Pavel Romanov")).toBeLessThan(html.indexOf("New Person…"));
    expect(html).toContain('role="combobox"');
    const none = renderToString(<PersonPicker bridge={bridgeFor(null)} variant="popover" participants={[chip("p1", "Pavel")]} speakers={[]} value="Lena" confirmLabel="x" onPick={() => {}} />);
    expect(none).toContain("No one called");
    expect(none).toContain("New Person");
  });
  it("an inline picker keeps its list closed until the field has focus", () => {
    const html = renderToString(<PersonPicker bridge={bridgeFor(null)} variant="inline" participants={[chip("p1", "Pavel")]} speakers={[]} confirmLabel="x" onPick={() => {}} />);
    expect(html).not.toContain('role="listbox"');
  });
});

describe("SpeakerRenamePopover", () => {
  const props = (bridge: Bridge, onNamed = vi.fn(), onClose = vi.fn()) => ({ bridge, callId: "c1", speaker: spk(), segmentId: "seg_9", participants: [chip("p1", "Pavel Romanov")], speakers: [spk()], anchor: null, onClose, onNamed });

  it("renames the whole call by default and reports the named line count with the change to undo", async () => {
    const sent: unknown[] = [];
    const named = spk({ label: { type: "person", person: chip("p1", "Pavel Romanov") }, segment_count: 7 });
    const p = props(bridgeFor({ status: "ok", data: { speakers: [named], change_id: "chg_1" } }, sent));
    const tree = rendered(SpeakerRenamePopover, p);
    const picker = find(tree, (pr) => "onConfirm" in pr && "confirmLabel" in pr);
    (picker.props.onConfirm as (r: unknown, n: string, isNew: boolean) => Promise<void>)({ type: "existing", person_id: "p1" }, "Pavel Romanov", false);
    await vi.waitFor(() => expect(p.onClose).toHaveBeenCalled());
    expect(sent).toEqual([{ call_id: "c1", speaker_id: "spk_3", person: { type: "existing", person_id: "p1" }, scope: { type: "whole_call" } }]);
    expect(p.onNamed).toHaveBeenCalledWith("Named Speaker 3 as Pavel · 7 lines", "chg_1");
    expect(p.onClose).toHaveBeenCalled();
  });

  it("says You added … for a created person", async () => {
    const named = spk({ label: { type: "person", person: chip("p9", "Lena") }, segment_count: 1 });
    const p = props(bridgeFor({ status: "ok", data: { speakers: [named], change_id: "chg_2" } }));
    const picker = find(rendered(SpeakerRenamePopover, p), (pr) => "onConfirm" in pr && "confirmLabel" in pr);
    (picker.props.onConfirm as (r: unknown, n: string, isNew: boolean) => Promise<void>)({ type: "new", display_name: "Lena", email: null }, "Lena", true);
    await vi.waitFor(() => expect(p.onNamed).toHaveBeenCalled());
    expect(p.onNamed).toHaveBeenCalledWith("You added Lena and named Speaker 3 as Lena · 1 line", "chg_2");
  });

  it("keeps the popover open on a failed command", async () => {
    const sent: unknown[] = [];
    const sentCount = () => sent.length;
    const p = props(bridgeFor({ status: "error", error: { code: "not_found" } }, sent));
    const picker = find(rendered(SpeakerRenamePopover, p), (pr) => "onConfirm" in pr && "confirmLabel" in pr);
    (picker.props.onConfirm as (r: unknown, n: string, isNew: boolean) => Promise<void>)({ type: "existing", person_id: "p1" }, "Pavel", false);
    await vi.waitFor(() => expect(sentCount()).toBe(1));
    expect(p.onNamed).not.toHaveBeenCalled();
    expect(p.onClose).not.toHaveBeenCalled();
  });
});
