import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PersonRow } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { createProfile, deleteProfile, findInPastCalls, rematchLine } from "./actions";
import { undoMode } from "../history/undo";
import { VoiceProfileSheet } from "./VoiceProfileSheet";
import { confirmDeleteProfile } from "./sheets";

const person = (o: Partial<PersonRow> = {}): PersonRow => ({
  id: "per_a", rev: 1, display_name: "Anna Kuznetsova", short_name: "Anna K.", initials: "AK", email: null, role: null, org: null,
  aliases: [], is_you: false, voice_profile: false, last_call_at: null, open_items: 0, you_owe: 0, notes: null, ...o,
});
const bridgeOf = (res: unknown) => ({ act: vi.fn(async (_k: string, _c: string, run: () => unknown) => (run(), res)), core: { voiceProfileCreate: vi.fn(), voiceProfileDelete: vi.fn(), voiceProfileRematch: vi.fn() } }) as never;
const enabled = { status: "ok", data: { person_id: "per_a", enabled: true, centroids: 1, opted_in_at: 1 } };
const flush = () => new Promise((r) => setTimeout(r));

describe("cpt-noter-flow-ui-people-voice-profile", () => {
  it("the sheet explains the profile, names the person and counts the calls; Create Profile is the only way in", () => {
    const h = renderToString(<VoiceProfileSheet bridge={bridgeOf({})} person={person()} calls={31} close={() => {}} />);
    for (const s of ["Set Up Voice Profile", "Anna Kuznetsova", "encrypted, stays on this Mac", "in 31 calls", "still unnamed in past calls", "Create Profile", "Cancel"]) expect(h).toContain(s);
    expect(renderToString(<VoiceProfileSheet bridge={bridgeOf({})} person={person()} calls={1} close={() => {}} />)).toContain("in 1 call.");
  });
  it("Create Profile sends voice_profile_create once and closes; a refusal stays with its error", async () => {
    const b = bridgeOf(enabled) as { act: ReturnType<typeof vi.fn>; core: { voiceProfileCreate: ReturnType<typeof vi.fn> } };
    const close = vi.fn();
    const sheet = rendered(VoiceProfileSheet, { bridge: b as never, person: person(), calls: 2, close });
    const create = (find(sheet, (p) => p.defaultButton !== undefined).props.defaultButton as { props: { onAction: () => Promise<void> } }).props.onAction;
    await create();
    await flush();
    expect(b.core.voiceProfileCreate).toHaveBeenCalledWith({ person_id: "per_a" });
    expect(close).toHaveBeenCalledOnce();
    const refused = rendered(VoiceProfileSheet, { bridge: bridgeOf({ status: "error", error: { code: "invalid_input" } }), person: person(), calls: 2, close });
    await (find(refused, (p) => p.defaultButton !== undefined).props.defaultButton as { props: { onAction: () => Promise<void> } }).props.onAction();
    await flush();
    expect(close).toHaveBeenCalledOnce();
  });
  it("a profile the core did not enable is a failure; deleting answers whether it is gone", async () => {
    expect(await createProfile(bridgeOf({ status: "ok", data: { enabled: false } }), person())).toBe(false);
    expect(await createProfile(bridgeOf(enabled), person())).toBe(true);
    expect(await deleteProfile(bridgeOf({ status: "ok", data: { enabled: false } }), person())).toBe(true);
    expect(await deleteProfile(bridgeOf({ status: "error", error: { code: "internal" } }), person())).toBe(false);
  });
  it("Delete Profile asks first with the design's words and Cancel as the way out", async () => {
    const ask = vi.fn(async () => false);
    const failed = vi.fn();
    expect(await confirmDeleteProfile(bridgeOf({}), person(), failed, ask)).toBe(false);
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ title: "Delete Anna K.'s voice profile?", message: "Noter stops recognising this voice in new calls. Names already given in past calls stay.", cancel: "Cancel", confirm: "Delete Profile", destructive: true }));
    expect(await confirmDeleteProfile(bridgeOf({ status: "ok", data: { enabled: false } }), person(), failed, async () => true)).toBe(true);
    expect(await confirmDeleteProfile(bridgeOf({ status: "error", error: { code: "internal" } }), person(), failed, async () => true)).toBe(false);
    expect(failed).toHaveBeenCalledWith("Couldn’t delete the voice profile. It was not changed.");
    await flush();
  });
  // #1278
  it("cpt-noter-seq-people-find-voice-in-past-calls: Create Profile re-matches past calls; a find offers Undo with the counts, none says so", async () => {
    const seq = (...res: unknown[]) => ({ act: vi.fn(async (_k: string, _c: string, run: () => unknown) => (run(), res.shift())), core: { voiceProfileCreate: vi.fn(), voiceProfileRematch: vi.fn() } }) as never;
    const b = seq(enabled, { status: "ok", data: { person_id: "per_a", calls: 6, speakers: 9, change_id: "chg_9" } }) as { core: { voiceProfileRematch: ReturnType<typeof vi.fn> } };
    expect(await createProfile(b as never, person())).toBe(true);
    expect(b.core.voiceProfileRematch).toHaveBeenCalledWith({ person_id: "per_a" });
    expect(undoMode()).toBe("undo");
    // the explicit button: nothing left to name is said, not hidden
    expect(await findInPastCalls(seq({ status: "ok", data: { person_id: "per_a", calls: 0, speakers: 0, change_id: null } }), person())).toBe(true);
    const r = (calls: number, speakers: number) => ({ person_id: "per_a", calls, speakers, change_id: calls ? "chg" : null });
    expect(rematchLine(person(), r(6, 9))).toBe("Found Anna K.’s voice in 6 calls · named 9 speakers");
    expect(rematchLine(person(), r(1, 1))).toBe("Found Anna K.’s voice in 1 call · named 1 speaker");
    expect(rematchLine(person(), r(0, 0))).toBe("No unnamed speakers in past calls match Anna K.’s voice");
    expect(await findInPastCalls(seq({ status: "error", error: { code: "internal" } }), person())).toBe(false);
  });
});
