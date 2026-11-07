// M3 knowledge story against the real core (2.24, TL-44): a folder picked in Settings is indexed with
// progress, a document count and a last sync; its heading comes back as document evidence in
// `search`; removal stops those hits. Then each of the seven source commands once more on an
// indexed MCP source the harness scripts (`harness.mcp_server`, TL-42): update and its stale-rev
// conflict, reindex, revoke and remove. The folder panel and the scripted servers exist only in
// the real core's harness, so the fake skips this file.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Core, EntityChanged, SourceRow } from "../../src/core/bindings";
import { exercised, isFake } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";

let s: Scenario;
let settings: Core;
let main: Core;

/** The scenario's harness: controls are requests on the same wire. */
const harness = (cmd: string, args: unknown) =>
  (s as unknown as { process: { invoke(window: string, cmd: string, args: unknown): Promise<unknown> } }).process.invoke("main", `harness.${cmd}`, args);

const sourceOf = (e: EntityChanged, id?: string): SourceRow | undefined => (e.type === "source" && (id === undefined || e.source.id === id) ? e.source : undefined);
const search = async (query: string) => ok(await main.search({ query, filter: { people: [], call_types: [], tags: [], languages: [], from: null, to: null, has_open_items: null }, limit: null }));
/** Keyword (strong) document hits: what the text says now, not a vector neighbour. */
const strong = async (query: string) => (await search(query)).documents.filter((h) => h.strength === "strong");
const row = async (id: string) => ok(await settings.sourcesList({})).sources.find((r) => r.id === id);

describe.skipIf(isFake)("knowledge sources on the real core (2.24)", () => {
  beforeEach(() => {
    s = openScenario({ alsoRecord: exercised });
    settings = s.core("settings");
    main = s.core("main");
  });
  afterEach(async () => {
    await s.dispose();
  });

  it("cpt-noter-seq-settings-add-knowledge-source: a picked folder reports progress, count and last sync, its heading is document evidence in search, and removal stops the hits", async () => {
    expect(ok(await settings.sourcesList({})).sources).toEqual([]);
    // The folder the open panel answers, with one note in it.
    const { path } = (await harness("data_dir", {})) as { path: string };
    const folder = join(path, "exports", "Knowledge folder");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "Launch plan.md"), "# Launch plan\n\n## Rollout\n\nThe gradual rollout ships to the beta ring on Friday.\n");

    const changed = await s.events("entity:changed");
    const added = ok(await settings.sourceAddFolder({ path: null, privacy: "normal", scope: { type: "all_calls" } }));
    expect(added).toMatchObject({ kind: "folder", mode: "indexed", name: "Knowledge folder", has_token: false });
    const done = await until(
      () => changed.all.map((e) => sourceOf(e, added.id)).find((r) => r?.status.type === "idle" && r.last_sync_at !== null),
      "the folder's first sync through entity:changed",
    );
    expect(done.documents).toBe(1);
    expect(changed.all.some((e) => sourceOf(e, added.id)?.status.type === "indexing")).toBe(true);
    expect(await row(added.id)).toMatchObject({ documents: 1, last_sync_at: done.last_sync_at });

    // Its heading is document evidence: title, section and source name.
    const hits = (await search("rollout")).documents;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].target.type).toBe("document");
    expect(hits[0].provenance).toMatchObject({ type: "document", source_id: added.id, title: "Launch plan", section: "Rollout", source_name: "Knowledge folder" });

    // Removed: the source and its hits are gone; the file stays.
    const removed = ok(await settings.sourceRemove({ source_id: added.id }));
    expect(removed.deleted).toBe(2);
    expect(changed.all.some((e) => e.type === "removed" && e.kind === "source" && e.id === added.id)).toBe(true);
    expect((await search("rollout")).documents).toEqual([]);
    expect(ok(await settings.sourcesList({})).sources).toEqual([]);
  });

  it("an indexed MCP source signs in, syncs, edits with a revision guard, reindexes, revokes and is removed", async () => {
    await harness("mcp_server", {
      server: "notion",
      pages: [{ uri: "notion://roadmap", title: "Roadmap", hash: "h1", text: "# Roadmap\n\n## Milestones\n\nThe importer milestone closes in May.\n" }],
    });
    const added = ok(await settings.sourceAddMcp({ server: "notion", mode: "indexed", schedule: null, privacy: "normal", scope: { type: "all_calls" } }));
    expect(added).toMatchObject({ kind: "mcp", mode: "indexed", location: "notion", schedule: "daily", has_token: true });
    await until(async () => (await row(added.id))?.documents === 1 && (await row(added.id))?.last_sync_at !== null, "the first sync of the MCP source");
    expect((await search("importer")).documents[0]?.provenance).toMatchObject({ type: "document", source_name: "notion", section: "Milestones" });

    // An edit with the current rev, then the same rev again: conflict with the current one.
    const current = (await row(added.id))!;
    const edited = ok(await settings.sourceUpdate({ source_id: added.id, rev: current.rev, name: "Team wiki", schedule: "hourly", privacy: null, scope: null }));
    expect(edited).toMatchObject({ name: "Team wiki", schedule: "hourly", rev: current.rev + 1 });
    const stale = refused(await settings.sourceUpdate({ source_id: added.id, rev: current.rev, name: "Old", schedule: null, privacy: null, scope: null }));
    expect(stale).toMatchObject({ code: "conflict", detail: { type: "conflict", current_rev: current.rev + 1 } });

    // Reindex with a changed page: the new text replaces the old.
    await harness("mcp_server", {
      server: "notion",
      pages: [{ uri: "notion://roadmap", title: "Roadmap", hash: "h2", text: "# Roadmap\n\n## Milestones\n\nThe exporter milestone closes in June.\n" }],
    });
    ok(await settings.sourceReindex({ source_id: added.id }));
    await until(async () => (await strong("exporter")).length > 0, "the reindexed page in search");
    // The old text is gone from the keyword index (a vector match may still find the page).
    expect(await strong("importer")).toEqual([]);

    // Revoke: no token, sign-in expired, the index stays.
    const revoked = ok(await settings.sourceRevokeToken({ source_id: added.id }));
    expect(revoked).toMatchObject({ has_token: false, status: { type: "sign_in_expired" }, documents: 1 });

    // A live source is stored and never indexed.
    const live = ok(await settings.sourceAddMcp({ server: "jira", mode: "live", schedule: null, privacy: "normal", scope: { type: "all_calls" } }));
    expect(live).toMatchObject({ mode: "live", has_token: false, documents: 0 });
    expect(refused(await settings.sourceReindex({ source_id: live.id })).code).toBe("invalid_input");

    ok(await settings.sourceRemove({ source_id: added.id }));
    ok(await settings.sourceRemove({ source_id: live.id }));
    expect(ok(await settings.sourcesList({})).sources).toEqual([]);
  });
});
