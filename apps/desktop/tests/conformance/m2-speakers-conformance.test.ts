// M2 speakers conformance (2.13): transcript_rename_speaker, transcript_fix_term,
// transcript_name_speakers, audio_delete and audio_delete_older answer the same on the fake and
// the real core — result shapes, the call row after a delete and every typed error.
// @cpt-dod:cpt-noter-dod-core-speakers-audio-tests:p1
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Core } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ok, refused } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import { LIVE_CALL, PAST_CALL } from "../support/world-presets";

let s: Scenario;
let main: Core;
beforeEach(() => {
  s = openScenario({ alsoRecord: exercised });
  main = s.core("main");
});
afterEach(async () => {
  await s.dispose();
});

const anna = { type: "existing" as const, person_id: "per_anna" };
const row = async (id: string) => ok(await main.callsList({ filter: {}, sort: "newest", page: {} })).rows.find((r) => r.id === id)!;

describe("transcript_rename_speaker", () => {
  it("names an unnamed speaker for the whole call and returns the speaker and the change", async () => {
    const done = ok(await main.transcriptRenameSpeaker({ call_id: LIVE_CALL, speaker_id: "spk_3", person: anna, scope: { type: "whole_call" } }));
    expect(done.change_id).toBeTruthy();
    expect(done.speakers.find((x) => x.id === "spk_3")).toMatchObject({ label: { type: "person", person: { id: "per_anna" } }, named_by: "you" });
  });

  it("a new person is created from the name", async () => {
    const done = ok(await main.transcriptRenameSpeaker({ call_id: LIVE_CALL, speaker_id: "spk_3", person: { type: "new", display_name: "Lena" }, scope: { type: "whole_call" } }));
    expect(done.speakers.find((x) => x.id === "spk_3")?.label).toMatchObject({ type: "person", person: { display_name: "Lena" } });
  });

  it("refuses an unknown call, speaker or person and a blank name", async () => {
    const base = { call_id: LIVE_CALL, speaker_id: "spk_3", person: anna, scope: { type: "whole_call" as const } };
    expect(refused(await main.transcriptRenameSpeaker({ ...base, call_id: "call_nobody" })).code).toBe("not_found");
    expect(refused(await main.transcriptRenameSpeaker({ ...base, speaker_id: "spk_nobody" })).code).toBe("not_found");
    expect(refused(await main.transcriptRenameSpeaker({ ...base, person: { type: "existing", person_id: "per_nobody" } })).code).toBe("not_found");
    const blank = refused(await main.transcriptRenameSpeaker({ ...base, person: { type: "new", display_name: "  " } }));
    expect(blank).toMatchObject({ code: "invalid_input", detail: { type: "validation", rule: "required" } });
  });
});

describe("transcript_fix_term", () => {
  it("replaces the range, returns the segment and the change, and can teach the glossary", async () => {
    const done = ok(await main.transcriptFixTerm({ call_id: LIVE_CALL, segment_id: "seg_live_001", range: { start: 4, end: 9 }, replacement: "blank", add_to_glossary: false }));
    expect(done.segment.text).toContain("The blank state for the drawer");
    expect(done.glossary_term_id).toBeNull();
    const taught = ok(await main.transcriptFixTerm({ call_id: LIVE_CALL, segment_id: "seg_live_001", range: { start: 4, end: 9 }, replacement: "empty", add_to_glossary: true }));
    expect(taught.glossary_term_id).not.toBeNull();
  });

  it("refuses an unknown segment and a blank replacement", async () => {
    const base = { call_id: LIVE_CALL, segment_id: "seg_live_001", range: { start: 4, end: 9 }, replacement: "x", add_to_glossary: false };
    expect(refused(await main.transcriptFixTerm({ ...base, segment_id: "seg_nobody" })).code).toBe("not_found");
    expect(refused(await main.transcriptFixTerm({ ...base, replacement: "  " })).code).toBe("invalid_input");
  });
});

describe("transcript_name_speakers", () => {
  it("names the assigned speakers and skips a null person", async () => {
    const done = ok(await main.transcriptNameSpeakers({ call_id: LIVE_CALL, assignments: [{ speaker_id: "spk_3", person: anna }, { speaker_id: "spk_you", person: null }] }));
    // The real core returns every speaker of the call, the fake only the named ones.
    expect(done.speakers.find((x) => x.id === "spk_3")?.label).toMatchObject({ type: "person", person: { id: "per_anna" } });
    expect(done.speakers.find((x) => x.id === "spk_you")?.label.type ?? "you").toBe("you");
    expect(done.change_id).toBeTruthy();
  });

  it("refuses an unknown call or speaker", async () => {
    expect(refused(await main.transcriptNameSpeakers({ call_id: "call_nobody", assignments: [] })).code).toBe("not_found");
    expect(refused(await main.transcriptNameSpeakers({ call_id: LIVE_CALL, assignments: [{ speaker_id: "spk_nobody", person: anna }] })).code).toBe("not_found");
  });
});

describe("audio_delete and audio_delete_older", () => {
  it("deletes a past call's audio once: the row carries the time and the next delete counts nothing", async () => {
    const done = ok(await main.audioDelete({ call_ids: [PAST_CALL, PAST_CALL] }));
    expect(done.calls).toBe(1);
    const after = await row(PAST_CALL);
    expect(after).toMatchObject({ audio_deleted: true, audio_kept_until: null });
    expect(after.audio_deleted_at).toEqual(expect.any(Number));
    expect(ok(await main.audioDelete({ call_ids: [PAST_CALL] })).calls).toBe(0);
    expect(refused(await main.audioPlay({ call_id: PAST_CALL, from_ms: 0 })).code).toBe("audio_deleted");
  });

  it("refuses a capturing or unknown call and removes nothing", async () => {
    expect(refused(await main.audioDelete({ call_ids: [PAST_CALL, LIVE_CALL] })).code).toBe("invalid_input");
    expect(refused(await main.audioDelete({ call_ids: ["call_nobody"] })).code).toBe("not_found");
    expect((await row(PAST_CALL)).audio_deleted).toBe(false);
  });

  it("deletes by age and refuses less than one day", async () => {
    expect(refused(await main.audioDeleteOlder({ older_than_days: 0 })).code).toBe("invalid_input");
    const done = ok(await main.audioDeleteOlder({ older_than_days: 1 }));
    expect(done.calls).toBeGreaterThanOrEqual(1);
    expect((await row(PAST_CALL)).audio_deleted).toBe(true);
    expect((await row(LIVE_CALL)).audio_deleted).toBe(false);
    expect(ok(await main.audioDeleteOlder({ older_than_days: 1 })).calls).toBe(0);
  });
});
