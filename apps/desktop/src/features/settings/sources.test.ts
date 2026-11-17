import { describe, expect, it, vi } from "vitest";
import type { SourceRow } from "../../core/bindings";
import { draftChanged, peopleChips, readPeople, withPeople, ALL_SCOPE, addFolder, addMcp, createSources, readCallTypes, scopeDraftOf, scopeOf, scopeValid, toggleCallType, orderedSources, readSources, announceFinished, finishedSources, reindexSource, sourceStatus, submitMcp } from "./sources";

const row = (o: Partial<SourceRow> = {}): SourceRow => ({ id: "s1", rev: 1, kind: "folder", name: "Docs", location: "/d", mode: "indexed", schedule: null, privacy: "normal", scope: { type: "all_calls" }, status: { type: "idle" }, documents: 3, last_sync_at: null, has_token: false, ...o });

describe("sourceStatus", () => {
  it("maps idle, indexing, failed and expired to word, icon and tone", () => {
    expect(sourceStatus(row(), "cloud_allowed", undefined)).toMatchObject({ tone: "ok", state: "up-to-date", word: "Up to date", icon: "checkCircle", working: false, canRetry: false });
    const run = sourceStatus(row({ status: { type: "indexing", done: 2, total: null } }), "cloud_allowed", undefined);
    expect(run).toMatchObject({ tone: "run", state: "indexing", working: true, progress: { done: 2, total: null }, progressText: "Indexing · 2 so far" });
    expect(sourceStatus(row({ status: { type: "indexing", done: 9, total: 24 } }), "cloud_allowed", undefined).progressText).toBe("Indexing 9 of 24 files");
    expect(sourceStatus(row({ kind: "mcp", status: { type: "indexing", done: 1, total: 4 } }), "cloud_allowed", undefined).progressText).toBe("Indexing 1 of 4 documents");
    expect(sourceStatus(row({ status: { type: "failed", code: "internal", at: 1 } }), "cloud_allowed", undefined)).toMatchObject({ tone: "err", word: "Failed", canRetry: true });
    expect(sourceStatus(row({ status: { type: "sign_in_expired" } }), "cloud_allowed", undefined)).toMatchObject({ tone: "warn", word: "Sign-in expired", canRetry: false });
  });
  it("a Live source reads Live and is never retried as an index", () => {
    expect(sourceStatus(row({ mode: "live" }), "cloud_allowed", undefined).word).toBe("Live");
    expect(sourceStatus(row({ mode: "live", status: { type: "failed", code: "internal", at: 1 } }), "cloud_allowed", undefined).canRetry).toBe(false);
  });
  it("keeps the count and last sync from the core", () => {
    expect(sourceStatus(row(), "cloud_allowed", undefined).subtitle).toContain("3 documents");
    expect(sourceStatus(row(), "cloud_allowed", undefined).subtitle).toContain("Not synced yet");
    expect(sourceStatus(row({ last_sync_at: 1_700_000_000_000 }), "cloud_allowed", undefined).subtitle).toContain("Last sync");
  });
  it("explains Sensitive and paused Live lookups", () => {
    expect(sourceStatus(row({ privacy: "sensitive" }), "cloud_allowed", undefined).subtitle).toContain("local models only");
    expect(sourceStatus(row({ mode: "live" }), "local_only", undefined).subtitle).toContain("Live lookups paused");
    expect(sourceStatus(row({ mode: "live" }), "cloud_allowed", undefined).subtitle).not.toContain("paused");
  });
  it("offers revoke only with a token and not while indexing", () => {
    expect(sourceStatus(row({ has_token: true }), "cloud_allowed", undefined).canRevoke).toBe(true);
    expect(sourceStatus(row(), "cloud_allowed", undefined).canRevoke).toBe(false);
    expect(sourceStatus(row({ has_token: true, status: { type: "indexing", done: 0, total: 1 } }), "cloud_allowed", undefined).canRevoke).toBe(false);
  });
  it("lists each source once", () => {
    expect(orderedSources([row(), row({ name: "x" }), row({ id: "s2" })]).map((r) => r.id)).toEqual(["s1", "s2"]);
  });
});

describe("finishedSources", () => {
  const prev = new Map([["s1", "indexing"], ["s2", "indexing"], ["s3", "idle"]]);
  it("names a finish or a failure once, and says nothing for progress or an unchanged row", () => {
    const out = finishedSources(prev, [row({ id: "s1", name: "Docs" }), row({ id: "s2", name: "Wiki", rev: 4, status: { type: "failed", error: "x" } as never }), row({ id: "s3" }), row({ id: "s4", status: { type: "indexing", done: 1, total: 2 } })]);
    expect(out).toEqual([{ text: "Docs finished indexing.", key: "source:s1:1" }, { text: "Wiki failed to index.", key: "source:s2:4" }]);
    expect(finishedSources(new Map([["s1", "indexing"]]), [row({ status: { type: "indexing", done: 2, total: 2 } })])).toEqual([]);
  });
});

describe("announceFinished", () => {
  it("says a finish once and remembers the new statuses", () => {
    const seen = new Map([["s1", "indexing"]]);
    const say = vi.fn();
    announceFinished(seen, [row({ id: "s1" })], say);
    announceFinished(seen, [row({ id: "s1" })], say);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith({ kind: "confirmation", text: "Docs finished indexing.", key: "source:s1:1" });
  });
});

describe("source commands", () => {
  const bridge = (res: unknown) => ({ act: vi.fn(async (_k: string, _c: string, f: () => unknown) => (void f(), res)), core: { sourcesList: vi.fn(), sourceAddFolder: vi.fn(), sourceAddMcp: vi.fn(), sourceReindex: vi.fn() } }) as never;
  it("reads the list or null", async () => {
    expect(await readSources(bridge({ status: "ok", data: { sources: [row()] } }))).toHaveLength(1);
    expect(await readSources(bridge({ status: "error" }))).toBeNull();
  });
  it("adds a folder or reports a field error", async () => {
    expect(await addFolder(bridge({ status: "ok", data: row() }), "normal", { type: "all_calls" })).toMatchObject({ ok: true });
    const err = { status: "error", error: { code: "invalid_input", detail: { type: "validation", field: "server", rule: "duplicate" } } };
    expect(await addMcp(bridge(err), { server: "x", mode: "indexed", schedule: null, privacy: "normal", scope: { type: "all_calls" } })).toEqual({ ok: false, code: "invalid_input", field: "server", rule: "duplicate" });
    expect(await addFolder(bridge({ status: "error", error: { code: "cancelled" } }), "normal", { type: "all_calls" })).toEqual({ ok: false, code: "cancelled", field: null, rule: null });
  });
  it("re-indexes", async () => {
    expect(await reindexSource(bridge({ status: "ok" }), "s1")).toBe(true);
    expect(await reindexSource(bridge({ status: "error" }), "s1")).toBe(false);
  });
});

describe("submitMcp", () => {
  const b = (res: unknown) => ({ act: vi.fn(async (_k: string, _c: string, f: () => unknown) => (void f(), res)), core: { sourceAddMcp: vi.fn() } }) as never;
  const draft = { server: " wiki ", mode: "indexed" as const, schedule: "daily", privacy: "normal" as const, scope: ALL_SCOPE };
  it("a blank server is refused before anything is sent", async () => {
    const bridge = b(null);
    expect(await submitMcp(bridge, { ...draft, server: "  " })).toBe("Enter the server name.");
    expect((bridge as unknown as { act: ReturnType<typeof vi.fn> }).act).not.toHaveBeenCalled();
  });
  it("success returns null; a live source sends no schedule", async () => {
    const bridge = b({ status: "ok", data: row() });
    expect(await submitMcp(bridge, { ...draft, mode: "live" })).toBeNull();
    const call = (bridge as unknown as { core: { sourceAddMcp: ReturnType<typeof vi.fn> } }).core.sourceAddMcp.mock.calls[0]![0];
    expect(call).toMatchObject({ server: "wiki", schedule: null });
  });
  it("a duplicate server and any other failure are worded", async () => {
    expect(await submitMcp(b({ status: "error", error: { code: "invalid_input", detail: { type: "validation", field: "server", rule: "duplicate" } } }), draft)).toContain("already a source");
    expect(await submitMcp(b({ status: "error", error: { code: "invalid_input", detail: { type: "validation", field: "server", rule: "invalid_format" } } }), draft)).toContain("does not know that server");
    expect(await submitMcp(b({ status: "error", error: { code: "internal" } }), draft)).toContain("could not be added");
  });
});

describe("createSources", () => {
  const b = (...answers: unknown[]) => ({ act: vi.fn(async () => answers.shift()), core: { sourcesList: vi.fn() } }) as never;
  it("starts empty-handed, then holds the rows; a failed read keeps them", async () => {
    const seen: unknown[] = [];
    const s = createSources(b({ status: "ok", data: { sources: [row()] } }, { status: "error" }), (v) => seen.push(v));
    expect(s.view()).toEqual({ rows: null, failed: false });
    await s.load();
    expect(s.view().rows).toHaveLength(1);
    await s.load();
    expect(s.view()).toMatchObject({ failed: true });
    expect(s.view().rows).toHaveLength(1);
    expect(seen).toHaveLength(2);
  });
});

describe("scope", () => {
  it("round-trips all calls and a limited scope, keeping the people", () => {
    expect(scopeDraftOf({ type: "all_calls" })).toEqual(ALL_SCOPE);
    const d = scopeDraftOf({ type: "limited", call_types: ["standup"], people: ["p1"] });
    expect(d).toEqual({ all: false, callTypes: ["standup"], people: ["p1"] });
    expect(scopeOf(d)).toEqual({ type: "limited", call_types: ["standup"], people: ["p1"] });
    expect(scopeOf(ALL_SCOPE)).toEqual({ type: "all_calls" });
  });
  it("a limited scope needs a call type or a person", () => {
    expect(scopeValid(ALL_SCOPE)).toBe(true);
    expect(scopeValid({ all: false, callTypes: [], people: [] })).toBe(false);
    expect(scopeValid({ all: false, callTypes: [], people: ["p"] })).toBe(true);
  });
  it("a stale call-type list does not make an all-calls scope look edited", () => {
    const r = { id: "s1", rev: 1, kind: "folder", name: "A", location: "/a", mode: "indexed", schedule: null, privacy: "normal", scope: { type: "all_calls" }, status: { type: "idle" }, documents: 0, last_sync_at: null, has_token: false } as never;
    expect(draftChanged(r, { name: "A", schedule: null, privacy: "normal", scope: { all: true, callTypes: ["leftover"], people: ["p"] } })).toBe(false);
  });
  it("toggles a call type once", () => {
    const on = toggleCallType(toggleCallType({ ...ALL_SCOPE, all: false }, "a", true), "a", true);
    expect(on.callTypes).toEqual(["a"]);
    expect(toggleCallType(on, "a", false).callTypes).toEqual([]);
  });
  it("an empty limited scope is refused by the MCP form before sending", async () => {
    const b = { act: vi.fn(), core: {} } as never;
    expect(await submitMcp(b, { server: "x", mode: "indexed", schedule: "daily", privacy: "normal", scope: { all: false, callTypes: [], people: [] } })).toContain("Choose at least one call type");
  });
  it("reads the call types, none on failure", async () => {
    const b = (res: unknown) => ({ act: vi.fn(async () => res), core: {} }) as never;
    expect(await readCallTypes(b({ status: "ok", data: { call_types: [{ id: "a", label: "A" }] } }))).toHaveLength(1);
    expect(await readCallTypes(b({ status: "error" }))).toEqual([]);
  });
});

describe("scope people", () => {
  const anna = { id: "per_anna", display_name: "Anna Kuz", short_name: "Anna", initials: "AK", is_you: false } as never;
  it("shows the scope's people as chips, an unknown id by its id, and writes ids back", () => {
    const chips = peopleChips(["per_anna", "per_gone"], [anna]);
    expect(chips[0]).toMatchObject({ id: "per_anna", short_name: "Anna" });
    expect(chips[1]).toMatchObject({ id: "per_gone", display_name: "per_gone" });
    expect(withPeople({ all: false, callTypes: ["a"], people: [] }, chips)).toEqual({ all: false, callTypes: ["a"], people: ["per_anna", "per_gone"] });
  });
  it("reads the directory, none on failure", async () => {
    const b = (res: unknown) => ({ act: vi.fn(async () => res), core: {} }) as never;
    expect(await readPeople(b({ status: "ok", data: { people: [anna], unnamed: [] } }))).toHaveLength(1);
    expect(await readPeople(b({ status: "error" }))).toEqual([]);
  });
});
