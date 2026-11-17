import { describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../../core/bindings";
import { auditCall, auditRows, exportAudit, formatBytes, mergePage, readAudit, requestCount, totalBytes } from "./audit";

const row = (id: string, o: Partial<AuditEntry> = {}): AuditEntry => ({ id, kind: "run", llm_run_id: null, at: 1_700_000_000_000, call: null, runtime: null, destination: "Claude", what: "full_transcript", bytes_out: 1800, redacted: false, ...o });
const call = (id: string) => ({ id, title: `Call ${id}`, started_at: 0, call_type: "t" });

describe("audit rows", () => {
  it("keeps each id once and the core order", () => {
    expect(mergePage([row("a"), row("b")], [row("b"), row("c")]).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("counts runs and lookups, not tool results", () => {
    const rows = [row("a"), row("b", { kind: "tool_result" }), row("c", { kind: "lookup" })];
    expect(requestCount(rows)).toBe(2);
    expect(totalBytes(rows)).toBe(5400);
  });
  it("formats bytes", () => {
    expect(formatBytes(612)).toBe("612 B");
    expect(formatBytes(1800)).toBe("1.8 KB");
    expect(formatBytes(2_500_000)).toBe("2.5 MB");
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
    expect(await exportAudit(bridge({ status: "error", error: { code: "cancelled" } }), "markdown")).toBe("cancelled");
    expect(await exportAudit(bridge({ status: "error", error: { code: "internal" } }), "markdown")).toBe("failed");
  });
});

import { createAudit, type AuditView } from "./audit";

describe("audit store", () => {
  const page = (ids: string[], next: string | null, total: number | null = null) => ({ status: "ok", data: { rows: ids.map((i) => row(i)), next_cursor: next, total } });
  function store(answers: unknown[], onExport?: () => unknown) {
    const gates: (() => void)[] = [];
    const act = vi.fn((_k: string, cmd: string) => (cmd === "audit_export" ? Promise.resolve(onExport?.() ?? { status: "error", error: { code: "cancelled" } }) : new Promise((res) => gates.push(() => res(answers.shift())))));
    const views: AuditView[] = [];
    const s = createAudit({ act, core: { auditList: vi.fn(), auditExport: vi.fn() } } as never, null, (v) => views.push(v));
    return { s, act, gates, views };
  }
  it("starts loading, then keeps the pages read", async () => {
    const { s, gates } = store([page(["a"], "c1"), page(["a", "b"], null)]);
    expect(s.view().status).toBe("loading");
    const p = s.load(); gates[0](); await p;
    expect(s.view()).toMatchObject({ status: "ready", cursor: "c1" });
    const q = s.load(); gates[1](); await q;
    expect(s.view().rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(s.view().cursor).toBeNull();
  });
  it("ignores a second read while one is in flight", async () => {
    const { s, act, gates } = store([page(["a"], null)]);
    const p = s.load(); void s.load(); void s.load();
    gates[0](); await p;
    expect(act).toHaveBeenCalledTimes(1);
    expect(s.view().busy).toBe(false);
  });
  it("a failed read keeps the rows and flags failure", async () => {
    const { s, gates } = store([page(["a"], "c1"), { status: "error" }, page(["b"], null)]);
    let p = s.load(); gates[0](); await p;
    p = s.load(); gates[1](); await p;
    expect(s.view()).toMatchObject({ failed: true, status: "ready", cursor: "c1" });
    expect(s.view().rows).toHaveLength(1);
    p = s.load(); gates[2](); await p;
    expect(s.view()).toMatchObject({ failed: false });
    expect(s.view().rows).toHaveLength(2);
  });
  it("drops a read that finishes after dispose", async () => {
    const { s, gates, views } = store([page(["a"], null)]);
    const p = s.load(); const n = views.length; s.dispose(); gates[0](); await p;
    expect(views.length).toBe(n);
  });
  it("exports once at a time and reports only a returned path", async () => {
    const { s, act } = store([], () => ({ status: "ok", data: { path: "/x", files: 1 } }));
    await Promise.all([s.export(), s.export()]);
    expect(act).toHaveBeenCalledTimes(1);
    expect(s.view().exported).toBe("/x");
    const c = store([]); await c.s.export();
    expect(c.s.view().exported).toBeNull();
    expect(c.s.view().exportFailed).toBe(false);
    const f = store([], () => ({ status: "error", error: { code: "internal" } })); await f.s.export();
    expect(f.s.view().exportFailed).toBe(true);
  });
});

describe("audit with a call", () => {
  it("sends the call id with every read and export, and keeps the core's total", async () => {
    const calls: unknown[] = [];
    const act = vi.fn(async (_k: string, cmd: string, f: () => unknown) => {
      void f();
      calls.push(cmd);
      return cmd === "audit_export" ? { status: "ok", data: { path: "/x", files: 1 } } : { status: "ok", data: { rows: [row("a", { call: { id: "c1", title: "T", started_at: 0, call_type: "t" } })], next_cursor: "n", total: 41 } };
    });
    const auditList = vi.fn();
    const auditExport = vi.fn();
    const s = createAudit({ act, core: { auditList, auditExport } } as never, "c1", () => {});
    await s.load();
    await s.export();
    expect(auditList).toHaveBeenCalledWith(expect.objectContaining({ call_id: "c1" }));
    expect(auditExport).toHaveBeenCalledWith({ call_id: "c1", format: "markdown" });
    expect(s.view().total).toBe(41);
  });
});

describe("auditCall", () => {
  const open = (call?: string) => ({ type: "settings", pane: "privacy", call_id: call }) as never;
  it("opens on the call of a settings request, and on none for other requests", () => {
    expect(auditCall(open("c1"), null)).toBe("c1");
    expect(auditCall(open(), null)).toBeNull();
    expect(auditCall(null, null)).toBeNull();
    expect(auditCall({ type: "ask" } as never, null)).toBeNull();
  });
  it("All calls drops that request only: a new request for the same call opens on it again", () => {
    const first = open("c1");
    expect(auditCall(first, first)).toBeNull();
    expect(auditCall(open("c1"), first)).toBe("c1");
  });
});
