// M2 history story against the real core (Backend Teamlead TL-18, HoD D-26): the test names its
// DESIGN-core sequence and asserts the core-visible steps — rows, events and the exported file —
// not only a command result. The save panel is the harness's scripted `NativeOps`. The fake has
// no data folder or files, so the steps that read them stop there. All four history commands
// succeed at least once here (2.20 AC 5).
import { existsSync, readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { exercised } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import { PAST_CALL } from "../support/world-presets";
import { cancelNextSavePanel, rows } from "./history-support";

let s: Scenario;
afterEach(async () => {
  await s.dispose();
});

type Row = { id: string; status: string; redo_of: string | null; entity_id: string; field: string | null; after: string | null };
const changesOf = (call: string) =>
  rows<Row>(s, "SELECT id, status, redo_of, entity_id, field, after FROM changes WHERE entity_type = 'call' AND entity_id = ? ORDER BY rowid", call);

describe("cpt-noter-seq-core-review-undo", () => {
  it("happy path: a logged change is listed, undone, redone later with the same handle and exported through the panel", async () => {
    s = openScenario({ alsoRecord: exercised });
    const main = s.core("main");
    const changed = await s.events("entity:changed");
    const callRev = async () => ok(await main.callsList({ filter: {}, sort: "newest", page: {} })).rows.find((r) => r.id === PAST_CALL)!;
    const before = await callRev();

    // A logged change, and History shows it with who, what and whether it can be reversed.
    const done = ok(await main.callUpdate({ call_id: PAST_CALL, rev: before.rev, title: "Reviewed title" }));
    const page = ok(await main.historyList({ target: { type: "call", call_id: PAST_CALL }, actor: "all", job_id: null, from: null, to: null, page: {} }));
    expect(page.rows[0]).toMatchObject({ id: done.change_id, actor: { type: "you" }, field: "title", before: before.title, after: "Reviewed title", status: "applied", undoable: true, redoable: false });

    // Undo reverses it and the whole call is published; History now offers Redo.
    const handle = { type: "change" as const, change_id: done.change_id };
    expect(ok(await main.changeUndo({ target: handle }))).toEqual({ undone: 1, skipped_edited_later: 0 });
    const undone = ok(await main.historyList({ target: { type: "all" }, actor: "all", job_id: null, from: null, to: null, page: {} })).rows.find((r) => r.id === done.change_id)!;
    expect(undone).toMatchObject({ status: "undone", redoable: true });
    if (s.target === "stdio") {
      expect((await callRev()).title).toBe(before.title);
      await until(() => changed.all.some((e) => e.type === "call" && e.call.id === PAST_CALL && e.call.title === before.title), "entity:changed with the old title");
      expect((await changesOf(PAST_CALL))?.find((r) => r.id === done.change_id)?.status).toBe("undone");
    }

    // Redo later, with the same handle: the title is back, revisions advanced, a new row links to the original.
    expect(ok(await main.changeRedo({ target: handle }))).toEqual({ undone: 1, skipped_edited_later: 0 });
    if (s.target === "stdio") {
      const after = await callRev();
      expect(after.title).toBe("Reviewed title");
      expect(after.rev).toBeGreaterThan(before.rev + 1);
      const log = (await changesOf(PAST_CALL))!;
      expect(log.some((r) => r.redo_of === done.change_id && r.status === "applied" && r.after === "Reviewed title")).toBe(true);
    }

    // Export through the scripted save panel: the file exists once the answer arrives and has the line.
    const exported = ok(await main.historyExport({ scope: { type: "call", call_id: PAST_CALL }, format: "markdown" }));
    expect(exported.files).toBe(1);
    if (s.target === "stdio") {
      expect(existsSync(exported.path)).toBe(true);
      const lines = readFileSync(exported.path, "utf8").split("\n").filter((l) => l.startsWith("- "));
      expect(lines.some((l) => l.includes("Changed call info") && l.includes("Reviewed title"))).toBe(true);
      const json = ok(await main.historyExport({ scope: { type: "call", call_id: PAST_CALL }, format: "json" }));
      expect(JSON.parse(readFileSync(json.path, "utf8")).some((r: { id: string }) => r.id === done.change_id)).toBe(true);
    }
  });

  it("error path: a cancelled panel is cancelled and writes no file; an irreversible delete cannot be undone", async () => {
    s = openScenario({ alsoRecord: exercised });
    const main = s.core("main");
    await cancelNextSavePanel(s);
    expect(refused(await main.historyExport({ scope: { type: "today" }, format: "json" })).code).toBe("cancelled");
    // The next export is a new panel: the cancel was once.
    const done = ok(await main.historyExport({ scope: { type: "today" }, format: "json" }));
    if (s.target === "stdio") expect(existsSync(done.path)).toBe(true);

    ok(await main.callsDelete({ call_ids: [PAST_CALL] }));
    const tombstone = ok(await main.historyList({ target: { type: "all" }, actor: "all", job_id: null, from: null, to: null, page: {} })).rows.find((r) => r.entity.id === PAST_CALL)!;
    expect(refused(await main.changeUndo({ target: { type: "change", change_id: tombstone.id } })).code).toBe("not_undoable");
  });
});
