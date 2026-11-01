// M2 speaker-naming stories against the real core (Backend Teamlead TL-18, HoD D-26): each test
// names its DESIGN.md sequence and asserts the core-visible steps — the speaker rows, the
// `entity:changed` event, the constraints file the archive pass will read, the change log and
// the call row after an audio delete. The popover and the Call page panel are UI; the fake has no
// data folder, so the steps that read it stop there and the commands still run on both.
// All five 2.13 commands succeed at least once here.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Core } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario, type World } from "../support/scenario";
import { LIVE_CALL, PAST_CALL } from "../support/world-presets";
import { dataDir, rows } from "./history-support";

let s: Scenario;
let main: Core;
afterEach(async () => {
  await s.dispose();
});

const open = (world?: (w: World) => void) => {
  s = openScenario({ alsoRecord: exercised, world });
  main = s.core("main");
};
const history = async () => ok(await main.historyList({ target: { type: "all" }, actor: "all", job_id: null, from: null, to: null, page: {} })).rows;
const label = (speakers: { id: string; label: { type: string; person?: { display_name: string } } }[], id: string) => {
  const l = speakers.find((x) => x.id === id)!.label;
  return l.type === "person" ? l.person!.display_name : l.type;
};

/** The past call gains a third voice nobody named, with one line of its own. */
const unnamedVoice = (w: World) => {
  const detail = w.call_details.find((d) => d.call.id === PAST_CALL)!;
  const snap = w.transcripts.find((t) => t.call_id === PAST_CALL)!;
  const speaker = { ...structuredClone(detail.speakers[0]), id: "spk_b_3", label: { type: "unnamed" as const, n: 3 }, named_by: null };
  const line = { ...structuredClone(snap.segments[1]), id: "seg_backend_003", text: "I think the kubernets rollout is fine", speaker: { speaker_id: "spk_b_3", label: speaker.label } };
  detail.speakers.push(speaker);
  snap.speakers.push(structuredClone(speaker));
  snap.segments.push(line);
};

describe("cpt-noter-seq-call-screen-name-speaker", () => {
  it("happy path: renaming an unnamed speaker live writes the name, publishes it and rewrites constraints.json", async () => {
    open();
    const changed = await s.events("entity:changed");
    const done = ok(await main.transcriptRenameSpeaker({ call_id: LIVE_CALL, speaker_id: "spk_3", person: { type: "new", display_name: "Lena" }, scope: { type: "whole_call" } }));
    expect(label(done.speakers, "spk_3")).toBe("Lena");
    expect(done.speakers.find((x) => x.id === "spk_3")?.named_by).toBe("you");

    if (s.target === "stdio") {
      await until(() => changed.all.some((e) => e.type === "speakers" && e.call_id === LIVE_CALL), "entity:changed for the call's speakers");
      const dir = (await dataDir(s))!;
      const constraints = JSON.parse(readFileSync(join(dir, "audio", LIVE_CALL, "constraints.json"), "utf8"));
      expect(Object.values(constraints.speaker_names)).toContain("Lena");
      expect((await rows<{ id: string }>(s, "SELECT id FROM changes WHERE id = ?", done.change_id))?.length).toBe(1);
    }
    expect((await history()).find((r) => r.id === done.change_id)).toMatchObject({ actor: { type: "you" }, status: "applied" });
  });

  it("empty — no matching person: naming a new person creates them; a blank name is refused and nothing changes", async () => {
    open();
    const logged = (await history()).length;
    const blank = refused(await main.transcriptRenameSpeaker({ call_id: LIVE_CALL, speaker_id: "spk_3", person: { type: "new", display_name: " " }, scope: { type: "whole_call" } }));
    expect(blank).toMatchObject({ code: "invalid_input", detail: { type: "validation", rule: "required" } });
    expect((await history()).length).toBe(logged);
    const made = ok(await main.transcriptRenameSpeaker({ call_id: LIVE_CALL, speaker_id: "spk_3", person: { type: "new", display_name: "Lena" }, scope: { type: "whole_call" } }));
    expect(label(made.speakers, "spk_3")).toBe("Lena");
  });

  it("other — one line only: naming a single line returns the change and undo takes it back", async () => {
    open();
    const done = ok(await main.transcriptRenameSpeaker({ call_id: LIVE_CALL, speaker_id: "spk_3", person: { type: "existing", person_id: "per_anna" }, scope: { type: "one_segment", segment_id: "seg_live_004" } }));
    expect(done.change_id).toBeTruthy();
    expect(ok(await main.changeUndo({ target: { type: "change", change_id: done.change_id } })).undone).toBe(1);
  });
});

describe("cpt-noter-seq-call-page-name-speakers", () => {
  it("happy path: sample replay, skip, naming that keeps the edited wording, undo through change_undo", async () => {
    open(unnamedVoice);
    // Play Sample: a short span of the speaker's line while audio is kept.
    ok(await main.audioPlay({ call_id: PAST_CALL, from_ms: 0, to_ms: 3000 }));
    ok(await main.audioStop({}));

    // The user fixed the wording first; naming must keep it.
    const fix = ok(await main.transcriptFixTerm({ call_id: PAST_CALL, segment_id: "seg_backend_003", range: { start: 12, end: 21 }, replacement: "Kubernetes", add_to_glossary: false }));
    expect(fix.segment.text).toBe("I think the Kubernetes rollout is fine");

    // Skip: a null person names nobody and leaves the speaker unnamed.
    const skipped = ok(await main.transcriptNameSpeakers({ call_id: PAST_CALL, assignments: [{ speaker_id: "spk_b_3", person: null }] }));
    expect(skipped.speakers.find((x) => x.id === "spk_b_3")?.label.type ?? "unnamed").toBe("unnamed");

    // Name Speaker 3 as Dmitri: the call's speaker is named and the edited text stays.
    const done = ok(await main.transcriptNameSpeakers({ call_id: PAST_CALL, assignments: [{ speaker_id: "spk_b_3", person: { type: "existing", person_id: "per_dmitri" } }] }));
    expect(label(done.speakers, "spk_b_3")).toBe("Dmitri Sokolov");
    if (s.target === "stdio") {
      const line = (await rows<{ text: string }>(s, "SELECT text FROM segments WHERE id = ?", "seg_backend_003"))![0];
      expect(line.text).toBe("I think the Kubernetes rollout is fine");
    }

    // Undo returns the speaker to unnamed; the wording the user fixed is not part of that change.
    expect(ok(await main.changeUndo({ target: { type: "change", change_id: done.change_id } })).undone).toBe(1);
    expect(ok(await main.callGet({ call_id: PAST_CALL })).speakers.find((x) => x.id === "spk_b_3")?.label.type).toBe("unnamed");
    if (s.target === "stdio") expect((await rows<{ text: string }>(s, "SELECT text FROM segments WHERE id = ?", "seg_backend_003"))![0].text).toBe("I think the Kubernetes rollout is fine");
  });

  it("empty — audio no longer kept: text-only naming works, audio_delete sets the date and cannot be undone", async () => {
    open(unnamedVoice);
    const changed = await s.events("entity:changed");
    if (s.target === "stdio") {
      const folder = join((await dataDir(s))!, "audio", PAST_CALL);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "mic.1.aac"), Buffer.alloc(1_048_576));
      writeFileSync(join(folder, "transcript.jsonl"), "{}\n");
    }
    const deleted = ok(await main.audioDelete({ call_ids: [PAST_CALL] }));
    expect(deleted.calls).toBe(1);
    const call = ok(await main.callsList({ filter: {}, sort: "newest", page: {} })).rows.find((r) => r.id === PAST_CALL)!;
    expect(call).toMatchObject({ audio_deleted: true, audio_kept_until: null });
    expect(call.audio_deleted_at).toEqual(expect.any(Number));
    expect(refused(await main.audioPlay({ call_id: PAST_CALL, from_ms: 0, to_ms: 3000 })).code).toBe("audio_deleted"); // no Play Sample

    if (s.target === "stdio") {
      const folder = join((await dataDir(s))!, "audio", PAST_CALL);
      expect(existsSync(join(folder, "mic.1.aac"))).toBe(false);
      expect(existsSync(join(folder, "transcript.jsonl"))).toBe(true);
      await until(() => changed.all.some((e) => e.type === "call" && e.call.id === PAST_CALL && e.call.audio_deleted_at !== null), "entity:changed with audio_deleted_at");
    }

    // The change row is content-free and not undoable.
    const change = (await history()).find((r) => r.entity.id === PAST_CALL && !r.undoable)!;
    expect(change).toBeDefined();
    expect(refused(await main.changeUndo({ target: { type: "change", change_id: change.id } })).code).toBe("not_undoable");

    // Naming needs no audio.
    const done = ok(await main.transcriptNameSpeakers({ call_id: PAST_CALL, assignments: [{ speaker_id: "spk_b_3", person: { type: "existing", person_id: "per_dmitri" } }] }));
    expect(label(done.speakers, "spk_b_3")).toBe("Dmitri Sokolov");
  });

  it("other — retention: audio_delete_older takes this past call and never the one being recorded", async () => {
    open();
    const done = ok(await main.audioDeleteOlder({ older_than_days: 1 }));
    expect(done.calls).toBeGreaterThanOrEqual(1);
    const rowsNow = ok(await main.callsList({ filter: {}, sort: "newest", page: {} })).rows;
    expect(rowsNow.find((r) => r.id === PAST_CALL)?.audio_deleted).toBe(true);
    expect(rowsNow.find((r) => r.id === LIVE_CALL)?.audio_deleted).toBe(false);
  });
});
