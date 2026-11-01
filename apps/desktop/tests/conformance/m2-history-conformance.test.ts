// M2 history conformance (2.20): history_list, change_undo, change_redo and history_export answer
// the same on the fake and the real core — scopes, page shape, UndoResult and every typed error.
// @cpt-dod:cpt-noter-dod-core-history-undo-tests:p1
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ChangeId, Core, HistoryListArgs } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ok, refused } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import { PAST_CALL } from "../support/world-presets";
import { cancelNextSavePanel } from "./history-support";

let s: Scenario;
let main: Core;
beforeEach(() => {
  s = openScenario({ alsoRecord: exercised });
  main = s.core("main");
});
afterEach(async () => {
  await s.dispose();
});

const list = (over: Partial<HistoryListArgs> = {}) =>
  main.historyList({ target: { type: "all" }, actor: "all", job_id: null, from: null, to: null, page: {}, ...over });
const byChange = (change_id: ChangeId) => ({ target: { type: "change" as const, change_id } });

/** Renames the call and returns the change that logged it. */
async function rename(title: string): Promise<ChangeId> {
  // The list's rev is the live one on both cores (the fake's call detail keeps its first rev).
  const row = ok(await main.callsList({ filter: {}, sort: "newest", page: {} })).rows.find((r) => r.id === PAST_CALL)!;
  return ok(await main.callUpdate({ call_id: PAST_CALL, rev: row.rev, title })).change_id;
}

describe("history_list", () => {
  it("returns the page shape and filters by target and actor", async () => {
    const id = await rename("History A");
    const page = ok(await list());
    expect(page).toHaveProperty("rows");
    expect(page).toHaveProperty("next_cursor");
    const row = page.rows.find((r) => r.id === id)!;
    expect(row).toMatchObject({ actor: { type: "you" }, field: "title", after: "History A", status: "applied", undoable: true, redoable: false, batch_size: 1 });

    expect(ok(await list({ target: { type: "call", call_id: PAST_CALL } })).rows.some((r) => r.id === id)).toBe(true);
    expect(ok(await list({ target: { type: "call", call_id: "call_nobody" } })).rows).toEqual([]);
    expect(ok(await list({ actor: "you" })).rows.some((r) => r.id === id)).toBe(true);
    for (const actor of ["jobs", "models"] as const) expect(ok(await list({ actor })).rows.some((r) => r.id === id)).toBe(false);
  });

  it("pages newest first with a cursor (real core)", async () => {
    if (s.target === "fake") return; // the fake has no paging
    const a = await rename("First");
    const b = await rename("Second");
    const one = ok(await list({ page: { limit: 1 } }));
    expect(one.rows.map((r) => r.id)).toEqual([b]);
    expect(one.next_cursor).not.toBeNull();
    const two = ok(await list({ page: { limit: 1, cursor: one.next_cursor } }));
    expect(two.rows.map((r) => r.id)).toEqual([a]);
  });
});

describe("change_undo and change_redo", () => {
  it("undo then redo with the same handle returns exact counts and flips the row", async () => {
    const id = await rename("Undo me");
    expect(ok(await main.changeUndo(byChange(id)))).toEqual({ undone: 1, skipped_edited_later: 0 });
    const undone = ok(await list()).rows.find((r) => r.id === id)!;
    expect(undone).toMatchObject({ status: "undone", redoable: true });
    expect(ok(await main.changeRedo(byChange(id)))).toEqual({ undone: 1, skipped_edited_later: 0 });
  });

  it("every wrong state is its typed error", async () => {
    const missing = byChange("chg_missing" as ChangeId);
    expect(refused(await main.changeUndo(missing)).code).toBe("not_found");
    expect(refused(await main.changeRedo(missing)).code).toBe("not_found");

    const id = await rename("Errors");
    expect(refused(await main.changeRedo(byChange(id))).code).toBe("not_undone");
    ok(await main.changeUndo(byChange(id)));
    expect(refused(await main.changeUndo(byChange(id))).code).toBe("already_undone");
    await rename("Later edit");
    expect(refused(await main.changeRedo(byChange(id))).code).toBe("edited_later");

    ok(await main.callsDelete({ call_ids: [PAST_CALL] }));
    const tombstone = ok(await list()).rows.find((r) => r.entity.id === PAST_CALL && r.summary === "Deleted a call")!;
    expect(tombstone.undoable).toBe(false);
    expect(refused(await main.changeUndo(byChange(tombstone.id))).code).toBe("not_undoable");
  });
});

describe("history_export", () => {
  it("exports every scope and format and returns the file", async () => {
    await rename("Export me");
    const scopes = [
      { type: "call" as const, call_id: PAST_CALL },
      { type: "today" as const },
      { type: "last7_days" as const },
      { type: "last30_days" as const },
      { type: "period" as const, from: "2020-01-01", to: "2999-12-31" },
    ];
    for (const scope of scopes) for (const format of ["markdown", "json"] as const) {
      const done = ok(await main.historyExport({ scope, format }));
      expect(done.files).toBe(1);
      expect(done.path.endsWith(format === "json" ? ".json" : ".md")).toBe(true);
    }
  });

  it("refuses a bad scope with invalid_input or not_found before any panel", async () => {
    const period = (from: string, to: string) => ({ scope: { type: "period" as const, from, to }, format: "markdown" as const });
    expect(refused(await main.historyExport(period("2026-10-17", "2026-10-16"))).code).toBe("invalid_input");
    expect(refused(await main.historyExport(period("2026-13-01", "2026-13-02"))).code).toBe("invalid_input");
    expect(refused(await main.historyExport(period("yesterday", "today"))).code).toBe("invalid_input");
    expect(refused(await main.historyExport({ scope: { type: "call", call_id: "call_nobody" }, format: "json" })).code).toBe("not_found");
  });

  it("a cancelled panel is cancelled", async () => {
    await cancelNextSavePanel(s);
    expect(refused(await main.historyExport({ scope: { type: "today" }, format: "markdown" })).code).toBe("cancelled");
  });
});
