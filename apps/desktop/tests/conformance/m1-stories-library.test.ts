// M1 library story against the real core (Backend Teamlead TL-7, HoD D-26): each test names its
// DESIGN.md story and asserts the core-visible steps of it — state, events, rows and files — not
// only a command result. The change log and the call's files can only be seen in the real core's
// data folder, which the harness names (`harness.data_dir`); the fake has none, so those steps are
// skipped on it. All five library commands are called here: calls_list, call_get, call_update,
// call_types_list and calls_delete.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { exercised } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario, type World } from "../support/scenario";
import { LIVE_CALL, PAST_CALL, morePastCalls } from "../support/world-presets";

let s: Scenario;
let folder: string | null | undefined; // asked once per scenario
function open(world: (w: World) => void = () => {}): void {
  folder = undefined;
  s = openScenario({ alsoRecord: exercised, world });
}
afterEach(async () => {
  await s.dispose();
});

const listedRows = async () => ok(await s.core("main").callsList({ filter: {}, sort: "newest", page: {} })).rows;
const listed = async () => (await listedRows()).map((r) => r.id);

/** The real core's data folder; null on the fake. */
async function dataDir(): Promise<string | null> {
  if (s.target === "fake") return null;
  await listed(); // the starting world is applied before the first command answers
  // The Scenario keeps its StdioCore private; a control is a request on the same wire.
  const core = (s as unknown as { process: { invoke(window: string, cmd: string, args: unknown): Promise<{ path: string }> } }).process;
  return (folder ??= (await core.invoke("main", "harness.data_dir", {})).path);
}

/** Rows of the real core's database, read-only; null where there is no folder to look in (the fake). */
async function rows<T>(sql: string, ...params: string[]): Promise<T[] | null> {
  const dir = await dataDir();
  if (!dir) return null;
  const db = new DatabaseSync(join(dir, "noter.db"), { readOnly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

type Change = { entity_type: string; entity_id: string; undoable: number; field: string | null; before: string | null; after: string | null };
// The harness's own re-seed of a changed world leaves rows with another summary; the core's are these.
const deletions = (id: string) =>
  rows<Change>(
    "SELECT entity_type, entity_id, undoable, field, before, after FROM changes WHERE entity_type = 'call' AND entity_id = ? AND summary = 'Deleted a call'",
    id,
  );

/** Puts a file in the call's audio folder, the way capture does; null where there is no folder. */
async function withAudio(id: string): Promise<string | null> {
  const dir = await dataDir();
  if (!dir) return null;
  const audio = join(dir, "audio", id);
  mkdirSync(audio, { recursive: true });
  writeFileSync(join(audio, "mic.caf"), "x");
  return audio;
}

describe("cpt-noter-seq-dialogs-delete-call", () => {
  it("happy path: Delete removes the call and everything recorded in it — list, snapshot, rows, files, one change row", async () => {
    open();
    const main = s.core("main");
    const removed = await s.events("entity:changed");
    const audio = await withAudio(PAST_CALL);
    expect(await listed()).toContain(PAST_CALL);
    expect(ok(await main.callGet({ call_id: PAST_CALL })).call.id).toBe(PAST_CALL);

    expect(ok(await main.callsDelete({ call_ids: [PAST_CALL] }))).toEqual({ deleted: 1 });

    // state: gone from the list, the record and the transcript snapshot
    expect(await listed()).not.toContain(PAST_CALL);
    expect(refused(await main.callGet({ call_id: PAST_CALL })).code).toBe("not_found");
    expect(refused(await main.transcriptSubscribe({ call_id: PAST_CALL }, () => {})).code).toBe("not_found");
    // events: the removal of that call, once
    await until(() => removed.all.some((e) => e.type === "removed" && e.id === PAST_CALL), "entity:changed removed");
    expect(removed.all.filter((e) => e.type === "removed" && e.id === PAST_CALL)).toEqual([{ type: "removed", kind: "call", id: PAST_CALL }]);
    // rows and files (real core): nothing of the call is left, and one change row says so, not undoable and without content (D-22)
    if (audio) expect(existsSync(audio)).toBe(false);
    for (const table of ["calls", "segments", "speakers", "marks", "gaps", "call_tags"]) {
      const left = await rows(`SELECT 1 FROM ${table} WHERE ${table === "calls" ? "id" : "call_id"} = ?`, PAST_CALL);
      if (left) expect(left, table).toEqual([]);
    }
    const changes = await deletions(PAST_CALL);
    if (changes) expect(changes).toEqual([{ entity_type: "call", entity_id: PAST_CALL, undoable: 0, field: null, before: null, after: null }]);
  });

  it("other path — several calls selected: three go together, the list is without them, one change row each", async () => {
    let extra: string[] = [];
    open((w) => {
      extra = morePastCalls(w, 2);
    });
    const main = s.core("main");
    await listed(); // the starting world is in place
    await dataDir();
    const ids = [PAST_CALL, ...extra];
    expect(ids).toHaveLength(3);
    expect(await listed()).toEqual(expect.arrayContaining(ids));

    expect(ok(await main.callsDelete({ call_ids: ids }))).toEqual({ deleted: 3 });

    const left = await listed();
    for (const id of ids) expect(left).not.toContain(id);
    for (const id of ids) {
      const changes = await deletions(id);
      if (changes) expect(changes.map((c) => c.undoable)).toEqual([0]);
    }
    // a call that is already gone is skipped and not counted
    expect(ok(await main.callsDelete({ call_ids: [PAST_CALL] }))).toEqual({ deleted: 0 });
  });

  it("error path — the call being recorded cannot be deleted: already_recording, nothing is deleted (D-31)", async () => {
    open();
    await dataDir();
    const refusal = refused(await s.core("main").callsDelete({ call_ids: [PAST_CALL, LIVE_CALL] }));
    expect(refusal.code).toBe("already_recording");
    // nothing at all went: not the live call, and not the past call named beside it
    expect(await listed()).toEqual(expect.arrayContaining([PAST_CALL, LIVE_CALL]));
    const changes = await deletions(PAST_CALL);
    if (changes) expect(changes).toEqual([]);
  });

  it("only the main window deletes: the call window is refused with window_not_allowed", async () => {
    open();
    expect(refused(await s.core("call-screen").callsDelete({ call_ids: [PAST_CALL] })).code).toBe("window_not_allowed");
    expect(await listed()).toContain(PAST_CALL);
  });
});

describe("the call's page before the delete (cpt-noter-seq-dialogs-delete-call)", () => {
  it("a stale rev is a conflict that names the current rev; the edit with the current rev changes the row and says so", async () => {
    open();
    const main = s.core("main");
    const changed = await s.events("entity:changed");
    expect(ok(await main.callTypesList({})).call_types.length).toBeGreaterThan(0);
    const { call } = ok(await main.callGet({ call_id: PAST_CALL }));

    const renamed = ok(await main.callUpdate({ call_id: PAST_CALL, rev: call.rev, title: "Backend sync (renamed)" }));
    expect(renamed.call).toMatchObject({ title: "Backend sync (renamed)", rev: call.rev + 1 });
    await until(() => changed.all.some((e) => e.type === "call" && e.call.id === PAST_CALL && e.call.rev === call.rev + 1), "entity:changed call");
    expect((await listedRows()).find((r) => r.id === PAST_CALL)).toMatchObject({ title: "Backend sync (renamed)", rev: call.rev + 1 });

    const stale = refused(await main.callUpdate({ call_id: PAST_CALL, rev: call.rev, title: "again" }));
    expect(stale.code).toBe("conflict");
    expect(stale.detail).toEqual({ type: "conflict", current_rev: call.rev + 1 });
    expect((await listedRows()).find((r) => r.id === PAST_CALL)?.title).toBe("Backend sync (renamed)");
  });
});
