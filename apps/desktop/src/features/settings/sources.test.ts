import { describe, expect, it, vi } from "vitest";
import type { SourceRow } from "../../core/bindings";
import { addFolder, addMcp, orderedSources, readSources, reindexSource, sourceStatus } from "./sources";

const row = (o: Partial<SourceRow> = {}): SourceRow => ({ id: "s1", rev: 1, kind: "folder", name: "Docs", location: "/d", mode: "indexed", schedule: null, privacy: "normal", scope: { type: "all_calls" }, status: { type: "idle" }, documents: 3, last_sync_at: null, has_token: false, ...o });

describe("sourceStatus", () => {
  it("maps idle, indexing, failed and expired to word, icon and tone", () => {
    expect(sourceStatus(row(), "cloud_allowed", undefined)).toMatchObject({ tone: "ok", word: "Up to date", icon: "checkCircle", working: false, canRetry: false });
    const run = sourceStatus(row({ status: { type: "indexing", done: 2, total: null } }), "cloud_allowed", undefined);
    expect(run).toMatchObject({ tone: "run", working: true, progress: { done: 2, total: null } });
    expect(sourceStatus(row({ status: { type: "failed", code: "internal", at: 1 } }), "cloud_allowed", undefined)).toMatchObject({ tone: "err", word: "Failed", canRetry: true });
    expect(sourceStatus(row({ status: { type: "sign_in_expired" } }), "cloud_allowed", undefined)).toMatchObject({ tone: "warn", word: "Sign-in expired", canRetry: false });
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

describe("source commands", () => {
  const bridge = (res: unknown) => ({ act: vi.fn(async (_k: string, _c: string, f: () => unknown) => (void f(), res)), core: { sourcesList: vi.fn(), sourceAddFolder: vi.fn(), sourceAddMcp: vi.fn(), sourceReindex: vi.fn() } }) as never;
  it("reads the list or null", async () => {
    expect(await readSources(bridge({ status: "ok", data: { sources: [row()] } }))).toHaveLength(1);
    expect(await readSources(bridge({ status: "error" }))).toBeNull();
  });
  it("adds a folder or reports a field error", async () => {
    expect(await addFolder(bridge({ status: "ok", data: row() }), "normal", { type: "all_calls" })).toMatchObject({ ok: true });
    const err = { status: "error", error: { code: "invalid_input", detail: { type: "validation", field: "server", rule: "duplicate" } } };
    expect(await addMcp(bridge(err), { server: "x", mode: "indexed", schedule: null, privacy: "normal", scope: { type: "all_calls" } })).toEqual({ ok: false, code: "invalid_input", field: "server" });
    expect(await addFolder(bridge({ status: "error", error: { code: "cancelled" } }), "normal", { type: "all_calls" })).toEqual({ ok: false, code: "cancelled", field: null });
  });
  it("re-indexes", async () => {
    expect(await reindexSource(bridge({ status: "ok" }), "s1")).toBe(true);
    expect(await reindexSource(bridge({ status: "error" }), "s1")).toBe(false);
  });
});
