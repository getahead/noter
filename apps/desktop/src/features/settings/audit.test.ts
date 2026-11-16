import { describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../../core/bindings";
import { auditRows, exportAudit, forCall, formatBytes, mergePage, readAudit, requestCount, totalBytes } from "./audit";

const row = (id: string, o: Partial<AuditEntry> = {}): AuditEntry => ({ id, kind: "run", llm_run_id: null, at: 1_700_000_000_000, call: null, runtime: null, destination: "Claude", what: "full_transcript", bytes_out: 1800, redacted: false, ...o });
const call = (id: string) => ({ id, title: `Call ${id}`, started_at: 0, call_type: "t" });

describe("audit rows", () => {
  it("keeps each id once and the core order", () => {
    expect(mergePage([row("a"), row("b")], [row("b"), row("c")]).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("filters by call id, not title", () => {
    const rows = [row("a", { call: call("1") }), row("b", { call: { ...call("2"), title: "Call 1" } }), row("c")];
    expect(forCall(rows, "1").map((r) => r.id)).toEqual(["a"]);
    expect(forCall(rows, null)).toHaveLength(3);
  });
  it("counts runs and lookups, not tool results", () => {
    const rows = [row("a"), row("b", { kind: "tool_result" }), row("c", { kind: "lookup" })];
    expect(requestCount(rows)).toBe(2);
    expect(totalBytes(rows)).toBe(5400);
  });
  it("formats bytes", () => {
    expect(formatBytes(512)).toMatch(/512/);
    expect(formatBytes(1800)).toMatch(/1\.8/);
    expect(formatBytes(2_500_000)).toMatch(/2\.5/);
  });
  it("words the rows without payload", () => {
    const [r] = auditRows([row("a", { call: call("1"), redacted: true })], undefined);
    expect(r).toMatchObject({ id: "a", callId: "1", destination: "Claude", redacted: true });
    expect(r.what).toContain("Transcript");
    expect(r.what).toContain("Call 1");
    expect(auditRows([row("t", { kind: "tool_result" })], undefined)[0].what).toContain("Tool result");
  });
});

describe("audit commands", () => {
  const bridge = (res: unknown) => ({ act: vi.fn(async (_k: string, _c: string, f: () => unknown) => (void f(), res)), core: { auditList: vi.fn(), auditExport: vi.fn() } }) as never;
  it("reads a page or null on failure", async () => {
    expect(await readAudit(bridge({ status: "ok", data: { rows: [] } }), null)).toEqual({ rows: [] });
    expect(await readAudit(bridge({ status: "error" }), null)).toBeNull();
  });
  it("reports an export only from a returned path", async () => {
    expect(await exportAudit(bridge({ status: "ok", data: { path: "/x", files: 1 } }), "markdown")).toEqual({ path: "/x", files: 1 });
    expect(await exportAudit(bridge({ status: "error", error: { code: "cancelled" } }), "markdown")).toBeNull();
  });
});
