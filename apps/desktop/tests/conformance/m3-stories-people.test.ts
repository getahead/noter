// M3 people stories against the real core (Backend Teamlead TL-18/TL-44): each `describe` names its
// DESIGN.md sequence and asserts the core-visible steps — page contents, speaker rows, the change
// log's undo, the voice_profiles table and the archive install that names a speaker by voice.
// Steps that read the database or run a recorded call exist only in the real core and are guarded
// by `s.target === "stdio"`; the commands themselves run on the fake too. All eight 2.23 commands
// succeed at least once here.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import type { CallId, Core, PersonId, SpeakerId } from "../../src/core/bindings";
import { exercised, isFake } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario, type World } from "../support/scenario";
import * as W from "../support/world-presets";
import { LIVE_CALL, PAST_CALL } from "../support/world-presets";
import { dataDir, rows } from "./history-support";

let s: Scenario;
let main: Core;
let dir: string | null = null;
afterEach(async () => {
  await s.dispose();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const open = (world?: (w: World) => void) => {
  s = openScenario({ alsoRecord: exercised, world });
  main = s.core("main");
};
const wire = () => (s as unknown as { process: { invoke(window: string, cmd: string, args: unknown): Promise<unknown> } }).process;
const make = async (name: string) => ok(await main.personCreate({ display_name: name, email: null, role: null, org: null })).person;
const you = async () => ok(await main.peopleList({ query: null })).people.find((p) => p.is_you)!;
const label = (speakers: { id: string; label: { type: string; person?: { display_name: string } } }[], id: string) => {
  const l = speakers.find((x) => x.id === id)!.label;
  return l.type === "person" ? l.person!.display_name : l.type;
};
const count = async (sql: string, ...params: string[]) => (await rows<{ n: number }>(s, sql, ...params))![0].n;
const scriptedVoiceVector = (call: string) => {
  const seed = new TextEncoder().encode(call).reduce((h, b) => (Math.imul(h, 31) + b) >>> 0, 17);
  const bytes = new Uint8Array(256 * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 256; i++) {
    const value = (((seed + Math.imul(i, 2_654_435_761)) >>> 0) >>> 8) % 1000;
    view.setFloat32(i * 4, value / 1000, true);
  }
  return bytes;
};
const containsBytes = (haystack: Uint8Array, needle: Uint8Array) =>
  haystack.some((_, at) => at + needle.length <= haystack.length && needle.every((b, i) => haystack[at + i] === b));

/** The past call gains a third voice nobody named, with one line of its own. */
const unnamedVoice = (w: World) => {
  const detail = w.call_details.find((d) => d.call.id === PAST_CALL)!;
  const snap = w.transcripts.find((t) => t.call_id === PAST_CALL)!;
  const speaker = { ...structuredClone(detail.speakers[0]), id: "spk_b_3", label: { type: "unnamed" as const, n: 3 }, named_by: null };
  const line = { ...structuredClone(snap.segments[1]), id: "seg_backend_003", text: "Let's keep the old drawer for now", speaker: { speaker_id: "spk_b_3", label: speaker.label } };
  detail.speakers.push(speaker);
  snap.speakers.push(structuredClone(speaker));
  snap.segments.push(line);
};
const name = (id: PersonId) => ({ speaker_id: "spk_b_3", person: { type: "existing" as const, person_id: id } });

describe("cpt-noter-seq-people-prepare-one-on-one", () => {
  it("happy path: a person page lists calls and commitments, what is owed to you and the sections the other flows fill", async () => {
    open();
    const me = await you();
    const asked = ok(await main.itemCreate({ call_id: LIVE_CALL, kind: "action_item", text: "Send Anna the drawer spec", owner: { type: "existing", person_id: me.id } }));
    const page = ok(await main.personGet({ person_id: "per_anna" }));
    expect(page.person.display_name).toBe("Anna Kuznetsova");
    expect(page.calls.map((c) => c.id)).toContain(LIVE_CALL);
    expect(page.owns_open.length).toBeGreaterThan(0);
    expect(page.owns_open.every((i) => i.owner?.id === "per_anna")).toBe(true);
    expect(Array.isArray(page.topics) && Array.isArray(page.open_questions)).toBe(true);
    // Behaviour metrics are off: no talk share is computed.
    expect(page.talk_share).toBeNull();
    if (s.target === "stdio") expect(page.you_owe.map((i) => i.id)).toContain(asked.item.id);
    // The user's own page never lists what they owe themselves.
    expect(ok(await main.personGet({ person_id: me.id })).you_owe).toEqual([]);
  });

  it("empty — a newly created person has empty sections", async () => {
    open();
    const p = await make("Nobody Yet");
    const page = ok(await main.personGet({ person_id: p.id }));
    expect([page.calls, page.owns_open, page.you_owe, page.open_questions]).toEqual([[], [], [], []]);
    if (s.target === "stdio") expect(page.topics).toEqual([]); // the fake's page lists the fixture's topics for everyone
    expect(page.talk_share).toBeNull();
  });

  it("other — people_list finds a person by name and by alias", async () => {
    open();
    const p = await make("Zinaida Quill");
    ok(await main.personUpdate({ person_id: p.id, rev: p.rev, patch: { aliases: ["Zina"] } }));
    expect(ok(await main.peopleList({ query: "quill" })).people.map((x) => x.id)).toContain(p.id);
    expect(ok(await main.peopleList({ query: "zina" })).people.map((x) => x.id)).toContain(p.id);
    expect(ok(await main.peopleList({ query: "no such person" })).people).toEqual([]);
  });
});

describe("cpt-noter-seq-people-name-unnamed-speaker", () => {
  it("happy path: an alias finds the identity, naming an existing person links the speaker and change_undo takes it back", async () => {
    open(unnamedVoice);
    const dmitri = ok(await main.personGet({ person_id: "per_dmitri" })).person;
    ok(await main.personUpdate({ person_id: dmitri.id, rev: dmitri.rev, patch: { aliases: ["Дима"] } }));
    // The fake matches names only; the core also searches aliases.
    if (s.target === "stdio") expect(ok(await main.peopleList({ query: "Дима" })).people.map((x) => x.id)).toEqual(["per_dmitri"]);

    const done = ok(await main.transcriptNameSpeakers({ call_id: PAST_CALL, assignments: [name("per_dmitri")] }));
    expect(label(done.speakers, "spk_b_3")).toBe("Dmitri Sokolov");
    // The speaker that was already linked to Dmitri keeps its name.
    if (s.target === "stdio") expect(label(done.speakers, "spk_b_dmitri")).toBe("Dmitri Sokolov");
    if (s.target === "stdio") {
      expect(await rows(s, "SELECT person_id, named_by FROM speakers WHERE id = 'spk_b_3'")).toEqual([{ person_id: "per_dmitri", named_by: "you" }]);
    }
    expect(ok(await main.changeUndo({ target: { type: "change", change_id: done.change_id } })).undone).toBe(1);
    expect(label(ok(await main.callGet({ call_id: PAST_CALL })).speakers, "spk_b_3")).toBe("unnamed");
    if (s.target === "stdio") expect(await rows(s, "SELECT person_id FROM speakers WHERE id = 'spk_b_3'")).toEqual([{ person_id: null }]);
  });

  it("empty — Create and Name makes the person and no voice profile", async () => {
    open(unnamedVoice);
    const p = await make("Lena Fresh");
    const done = ok(await main.transcriptNameSpeakers({ call_id: PAST_CALL, assignments: [name(p.id)] }));
    expect(label(done.speakers, "spk_b_3")).toBe("Lena Fresh");
    if (s.target === "stdio") {
      expect(await count("SELECT count(*) AS n FROM voice_profiles")).toBe(0);
      expect(await count("SELECT voice_profile_optin AS n FROM people WHERE id = ?", p.id)).toBe(0);
    }
  });

  it("other — a stale revision is a conflict", async () => {
    open();
    const p = await make("Stale Person");
    ok(await main.personUpdate({ person_id: p.id, rev: p.rev, patch: { role: "A" } }));
    expect(refused(await main.personUpdate({ person_id: p.id, rev: p.rev, patch: { role: "B" } }))).toMatchObject({ code: "conflict", detail: { type: "conflict", current_rev: p.rev + 1 } });
  });

  it("other — merging moves calls, items and aliases in one batch and change_undo restores them", async () => {
    open(unnamedVoice);
    const source = await make("Dima Duplicate");
    const target = await make("Dmitri Original");
    ok(await main.personUpdate({ person_id: source.id, rev: source.rev, patch: { aliases: ["Dimka"] } }));
    ok(await main.transcriptNameSpeakers({ call_id: PAST_CALL, assignments: [name(source.id)] }));
    const item = ok(await main.itemCreate({ call_id: PAST_CALL, kind: "action_item", text: "Ping the duplicate", owner: { type: "existing", person_id: source.id } })).item;

    const merged = ok(await main.peopleMerge({ source: source.id, target: target.id }));
    expect(merged.person.aliases).toEqual(expect.arrayContaining(["Dima Duplicate", "Dimka"]));
    // The fake's merge moves no calls or items; the core moves them with the speakers and owners.
    if (s.target === "stdio") {
      const page = ok(await main.personGet({ person_id: target.id }));
      expect(page.calls.map((c) => c.id)).toContain(PAST_CALL);
      expect(page.owns_open.map((i) => i.id)).toContain(item.id);
    }
    expect(refused(await main.personGet({ person_id: source.id })).code).toBe("not_found");
    if (s.target === "stdio") expect(await count("SELECT count(*) AS n FROM speakers WHERE person_id = ?", source.id)).toBe(0);

    expect(ok(await main.changeUndo({ target: { type: "change", change_id: merged.change_id } })).undone).toBeGreaterThan(0);
    // The fake's undo does not bring the merged person back.
    if (s.target === "stdio") {
      expect(ok(await main.personGet({ person_id: source.id })).person.aliases).toContain("Dimka");
      const after = ok(await main.personGet({ person_id: target.id }));
      expect(after.calls).toEqual([]);
      expect(after.owns_open).toEqual([]);
      expect(ok(await main.personGet({ person_id: source.id })).owns_open.map((i) => i.id)).toContain(item.id);
    }
  });

  it("other — deleting a person unnames their speakers and keeps the segments", async () => {
    open(unnamedVoice);
    const p = await make("Short Lived");
    ok(await main.transcriptNameSpeakers({ call_id: PAST_CALL, assignments: [name(p.id)] }));
    const segments = s.target === "stdio" ? await count("SELECT count(*) AS n FROM segments WHERE call_id = ?", PAST_CALL) : 0;
    expect(ok(await main.personDelete({ person_id: p.id }))).toEqual({ deleted: 1 });
    expect(label(ok(await main.callGet({ call_id: PAST_CALL })).speakers, "spk_b_3")).toBe("unnamed");
    if (s.target === "stdio") {
      expect(await count("SELECT count(*) AS n FROM segments WHERE call_id = ?", PAST_CALL)).toBe(segments);
      expect(await rows(s, "SELECT person_id FROM speakers WHERE id = 'spk_b_3'")).toEqual([{ person_id: null }]);
    }
  });
});

describe("cpt-noter-seq-dialogs-set-up-voice-profile", () => {
  it("happy path: Create stores an enabled profile whose centroid is encrypted", async () => {
    open();
    const made = ok(await main.voiceProfileCreate({ person_id: "per_pavel" }));
    expect(made).toMatchObject({ person_id: "per_pavel", enabled: true });
    if (s.target === "stdio") expect(made.centroids).toBeGreaterThan(0);
    expect(made.opted_in_at).toEqual(expect.any(Number));
    expect(ok(await main.personGet({ person_id: "per_pavel" })).person.voice_profile).toBe(true);
    if (s.target === "stdio") {
      const stored = (await rows<{ embedding: Uint8Array }>(s, "SELECT embedding FROM voice_profiles WHERE person_id = 'per_pavel'"))!;
      expect(stored.length).toBe(made.centroids);
      // A plaintext centroid is 256 little-endian floats; the stored blob carries the cipher's nonce and tag too.
      expect(stored.every((r) => r.embedding.length > 256 * 4)).toBe(true);
      expect(stored.every((r) => !containsBytes(r.embedding, scriptedVoiceVector(LIVE_CALL)))).toBe(true);
      expect(await count("SELECT voice_profile_optin AS n FROM people WHERE id = 'per_pavel'")).toBe(1);
    }
  });

  it("empty — Delete Profile removes the centroids and keeps the speaker names", async () => {
    open();
    ok(await main.voiceProfileCreate({ person_id: "per_pavel" }));
    const gone = ok(await main.voiceProfileDelete({ person_id: "per_pavel" }));
    expect(gone).toMatchObject({ person_id: "per_pavel", enabled: false, centroids: 0 });
    expect(ok(await main.personGet({ person_id: "per_pavel" })).person.voice_profile).toBe(false);
    expect(label(ok(await main.callGet({ call_id: LIVE_CALL })).speakers, "spk_pavel")).toBe("Pavel Romanov");
    if (s.target === "stdio") {
      expect(await count("SELECT count(*) AS n FROM voice_profiles WHERE person_id = 'per_pavel'")).toBe(0);
      expect(await count("SELECT voice_profile_optin AS n FROM people WHERE id = 'per_pavel'")).toBe(0);
    }
  });

  it("other — a locked Keychain refuses with keychain_locked and stores nothing", async () => {
    open();
    if (s.target === "stdio") await wire().invoke("main", "harness.keychain", { locked: true });
    else await s.failNext("main", "voice_profile_create", "keychain_locked");
    expect(refused(await main.voiceProfileCreate({ person_id: "per_pavel" })).code).toBe("keychain_locked");
    if (s.target === "stdio") {
      expect(await count("SELECT count(*) AS n FROM voice_profiles")).toBe(0);
      expect(await count("SELECT voice_profile_optin AS n FROM people WHERE id = 'per_pavel'")).toBe(0);
      await wire().invoke("main", "harness.keychain", { locked: false });
    }
    expect(ok(await main.voiceProfileCreate({ person_id: "per_pavel" })).enabled).toBe(true);
  });
});

// A call recorded through the scripted engine whose archive pass (the same lines, two voices) is
// installed after the stop. The scripted engine's speaker embedding is one vector per call, so a
// profile seeded from one voice of the call matches the other voice of the same call.
describe.skipIf(isFake)("cpt-noter-seq-dialogs-set-up-voice-profile (archive install)", { timeout: 60_000 }, () => {
  const LINES = ["Let's ship the drawer redesign in 8.0.", "Anna takes the virtualised table.", "Who owns the reconnect is still open."];
  const voice = (n: number) => `spk_${(n % 2) + 1}`;
  const heard = (n: number, text: string, call: string) => ({
    id: `arc_${n}`, call_id: call, channel: "sys", t0_ms: n * 4000, t1_ms: n * 4000 + 3000, state: "confirmed", lang: "en", lang_p: 0.98,
    speaker_label: voice(n), text, words_path: null, avg_logprob: -0.1, no_speech_p: 0.01, corrections: [], crosstalk_labels: [],
  });

  type SetUp = (owner: PersonId, first: SpeakerId) => Promise<void>;
  /**
   * Records the call and runs `setUp` (the profile step) on its named first voice. `whileRecording`:
   * before the stop, so the archive pass answers at once; otherwise once the pass has read the live
   * names (it writes their constraints file next), so it starts without that name, and before it
   * answers. shortcut: the scripted pass answers 6 s later, the one fixed delay left; swap it for a
   * scripted-engine hold/release once noter-engine-client/src/scripted.rs offers one (#409, after #423).
   */
  const record = async (setUp: SetUp, whileRecording: boolean): Promise<{ call: CallId; owner: PersonId }> => {
    dir = mkdtempSync(join(tmpdir(), "noter-people-"));
    const archive = join(dir, "archive.json");
    writeFileSync(archive, JSON.stringify({ call_id: "call_recorded", backend: "whisper_large_v3", segments: LINES.map((t, i) => heard(i, t, "call_recorded")) }));
    const script = join(dir, "engine.jsonl");
    writeFileSync(script, JSON.stringify({ on: "offline_pass", after_ms: whileRecording ? 0 : 6000, event: { type: "offline_done", call_id: "call_recorded", result_path: archive } }) + "\n");
    const base = process.env.NOTER_CORE_CMD;
    process.env.NOTER_CORE_CMD = `${base} --engine-script ${script}`;
    try {
      open((w) => {
        W.idle(w);
        w.app.setup.self_test = { type: "passed", at: Date.now() };
        w.app.setup.detection_enabled = true;
      });
    } finally {
      process.env.NOTER_CORE_CMD = base;
    }
    const call = ok(await main.captureStart({ source: "today", sensitive: false })).call_id!;
    await until(async () => ok(await main.appSnapshot({})).capture.phase === "recording", "recording");
    for (const [n, text] of LINES.entries()) {
      const segment = { ...heard(n, text, call), id: `live_${n}` };
      await until(() => s.engineFact({ type: "segment", segment }), "the engine to hear the line");
    }
    await until(async () => (await rows(s, "SELECT id FROM segments WHERE call_id = ?", call))!.length === LINES.length, "the live lines persisted");
    const speakers = ok(await main.callGet({ call_id: call })).speakers.filter((x) => x.label.type === "unnamed");
    expect(speakers.length).toBe(2);
    const owner = (await make("Voice Owner")).id;
    const profile = async () => {
      // The owner's profile is seeded from the call's first voice, named by the user.
      ok(await main.transcriptNameSpeakers({ call_id: call, assignments: [{ speaker_id: speakers[0].id, person: { type: "existing", person_id: owner } }] }));
      await setUp(owner, speakers[0].id);
    };
    if (whileRecording) await profile();
    expect(ok(await main.captureStop({ call_id: call })).phase).toBe("stopped");
    if (!whileRecording) {
      const read = join((await dataDir(s))!, "audio", call, "constraints.json");
      await until(() => existsSync(read), "the archive pass to read the live names");
      await profile();
    }
    return { call, owner };
  };
  // The archive job's run ends after the pass is installed, its voices embedded and matched: wait
  // for it, then every archive voice has its stored centroid (none when nobody is opted in).
  const archived = async (call: CallId, embedded = true) => {
    const run = "SELECT r.status FROM job_runs r JOIN jobs j ON j.id = r.job_id WHERE j.kind = 'archive_pass' AND r.subject = ?";
    await until(async () => (await rows<{ status: string }>(s, run, call))!.some((r) => r.status === "succeeded"), "the archive job finished", 20_000);
    expect((await rows<{ archive_status: string }>(s, "SELECT archive_status FROM calls WHERE id = ?", call))![0].archive_status).toBe("done");
    if (embedded) expect(await count("SELECT count(*) AS n FROM speakers WHERE call_id = ? AND pass = 'archive' AND centroid IS NULL", call)).toBe(0);
  };
  const archiveSpeakers = (call: CallId) => rows<{ person_id: string | null; named_by: string | null }>(s, "SELECT person_id, named_by FROM speakers WHERE call_id = ? AND pass = 'archive' ORDER BY rowid", call);

  it("an archive install names the matching voice by voice_profile", async () => {
    const { call, owner } = await record(async (owner, first) => {
      ok(await main.voiceProfileCreate({ person_id: owner, from_speaker: first }));
    }, false);
    await archived(call);
    // The profile is created while the pass runs; its user-named source stays named by the user,
    // and the remaining archive voice is matched by the profile.
    expect(await archiveSpeakers(call)).toEqual([
      { person_id: owner, named_by: "you" },
      { person_id: owner, named_by: "voice_profile" },
    ]);
  });

  it("a profile unused for 90 days stops matching", async () => {
    const { call } = await record(async (owner, first) => {
      ok(await main.voiceProfileCreate({ person_id: owner, from_speaker: first }));
      // Stand-in for the injected clock (proved in noter-core's profiles tests): the profile was last used 91 days ago.
      const db = new DatabaseSync(join((await dataDir(s))!, "noter.db"));
      db.exec("PRAGMA busy_timeout = 5000");
      db.prepare("UPDATE voice_profiles SET last_used_at = last_used_at - ? WHERE person_id = ?").run(91 * 86_400_000, owner);
      db.close();
    }, true);
    // The first voice carries the live name; the second, unnamed one is what the profile would match.
    await archived(call);
    expect((await archiveSpeakers(call))!.filter((x) => x.named_by === "voice_profile")).toEqual([]);
  });

  it("Delete Profile stops matching and keeps the names", async () => {
    const { call, owner } = await record(async (owner, first) => {
      ok(await main.voiceProfileCreate({ person_id: owner, from_speaker: first }));
      ok(await main.voiceProfileDelete({ person_id: owner }));
    }, true);
    await archived(call, false);
    const speakers = (await archiveSpeakers(call))!;
    expect(speakers.filter((x) => x.named_by === "voice_profile")).toEqual([]);
    // The name the user gave the live voice stays.
    expect(await rows(s, "SELECT person_id, named_by FROM speakers WHERE call_id = ? AND pass = 'live' AND person_id IS NOT NULL", call)).toEqual([{ person_id: owner, named_by: "you" }]);
  });
});

describe("the eight people commands", () => {
  it("each succeeded at least once in this run", () => {
    const eight = ["people_list", "person_get", "person_create", "person_update", "people_merge", "person_delete", "voice_profile_create", "voice_profile_delete"] as const;
    expect(eight.filter((c) => !exercised.has(c))).toEqual([]);
  });
});
